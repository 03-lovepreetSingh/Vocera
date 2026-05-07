// Look up a voice deployment by its public webhook token (`wsk_...`).
// Unlike `takeSession` in `src/server/ws/sessions.ts`, non-destructive — Twilio
// webhooks may retry. Runs once per inbound webhook (low QPS); no caching, so
// rotated workspace creds take effect immediately.
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import {
  agentVersions, agents, deployments, telephonyCredentials, voiceDeployments, workspaces,
} from '@/db/schema';
import type { AgentContext } from '@/server/ai/pipeline';
import { decrypt } from '@/server/crypto/secrets';

type Surfaces = { ivr: boolean; outbound: boolean; custom: boolean };

export interface LoadedDeployment {
  agent: AgentContext;
  /** Numeric workspace id (FK), used by webhook handlers that need RLS-scoped writes. */
  workspaceId: number;
  deployment: {
    id: number; externalId: string; webhookToken: string;
    surfaces: Surfaces; voiceId: string | null; speechSpeed: number;
  };
  /** Twilio creds, decrypted. null if not configured. authToken must not be logged. */
  telephony: {
    provider: string; accountSid: string; authToken: string; phoneNumber: string;
  } | null;
}

export async function loadDeploymentByToken(
  webhookToken: string,
): Promise<LoadedDeployment | null> {
  // Cheap format gate — avoid hitting the DB on garbage / probing traffic.
  if (typeof webhookToken !== 'string' || !webhookToken.startsWith('wsk_')) return null;

  const [row] = await db
    .select({
      vd: voiceDeployments,
      dep: deployments,
      agent: agents,
      ws: workspaces,
      av: agentVersions,
    })
    .from(voiceDeployments)
    .innerJoin(deployments, eq(deployments.id, voiceDeployments.deploymentId))
    .innerJoin(agents, eq(agents.id, deployments.agentId))
    .innerJoin(workspaces, eq(workspaces.id, agents.workspaceId))
    .innerJoin(
      agentVersions,
      sql`${agentVersions.agentId} = ${agents.id} AND ${agentVersions.version} = ${agents.currentVersion}`,
    )
    .where(eq(voiceDeployments.webhookToken, webhookToken))
    .limit(1);
  if (!row) return null;

  const [creds] = await db
    .select()
    .from(telephonyCredentials)
    .where(and(
      eq(telephonyCredentials.workspaceId, row.ws.id),
      eq(telephonyCredentials.provider, 'twilio'),
    ))
    .limit(1);

  let telephony: LoadedDeployment['telephony'] = null;
  if (creds) {
    try {
      telephony = {
        provider: creds.provider,
        accountSid: creds.accountSid,
        authToken: decrypt(creds.authTokenEncrypted),
        phoneNumber: creds.phoneNumber,
      };
    } catch {
      // Bad key / corrupt blob. Route 403s via sig mismatch. Do not log ciphertext.
      console.warn('[twilio.loader] decrypt failed for workspace', row.ws.id);
    }
  }

  return {
    agent: {
      agentId: row.agent.id,
      agentExternalId: row.agent.externalId,
      workspaceExternalId: row.ws.externalId,
      systemPrompt: row.av.systemPrompt,
      languages: row.av.languages,
      defaultLanguage: row.av.defaultLanguage,
      voiceMap: (row.av.voiceMap ?? {}) as Record<string, string>,
    },
    workspaceId: row.ws.id,
    deployment: {
      id: row.vd.id,
      externalId: row.dep.externalId,
      webhookToken: row.vd.webhookToken,
      surfaces: row.vd.surfaces as Surfaces,
      voiceId: row.vd.voiceId,
      speechSpeed: row.vd.speechSpeed,
    },
    telephony,
  };
}
