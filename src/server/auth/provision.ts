/**
 * Provisioning a new user creates a workspace + admin membership + default API key
 * in one transaction. Called from:
 *   • the signup server action (email/password)
 *   • the Auth.js Google signIn callback (lazy, on first OAuth sign-in)
 */
import { hash as argon2Hash } from '@node-rs/argon2';
import { db } from '@/db/client';
import { apiKeys, memberships, users, workspaces } from '@/db/schema';
import { newId } from '../ids';
import { slugify } from '@/lib/utils';

interface ProvisionInput {
  email: string;
  name: string | null;
  image?: string | null;
  password?: string; // omitted for OAuth sign-ins
}

export interface ProvisionResult {
  userExternalId: string;
  workspaceExternalId: string;
  apiKeyPrefix: string;
  /** The raw API key — shown to the user once, never stored in plaintext. */
  apiKeyPlaintext: string;
}

export async function provisionUser(input: ProvisionInput): Promise<ProvisionResult> {
  const email = input.email.toLowerCase();
  const passwordHash = input.password ? await argon2Hash(input.password) : null;

  return db.transaction(async (tx) => {
    // 1) workspace
    const wsExt = newId('ws');
    const baseSlug = slugify(input.name ?? email.split('@')[0]);
    const slug = `${baseSlug}-${wsExt.slice(3)}`; // ws_xxxxx → xxxxx — keeps slug unique
    const [ws] = await tx
      .insert(workspaces)
      .values({
        externalId: wsExt,
        name: input.name ?? `${email.split('@')[0]}'s workspace`,
        slug,
      })
      .returning({ id: workspaces.id });

    // 2) user
    const userExt = newId('usr');
    const [user] = await tx
      .insert(users)
      .values({
        externalId: userExt,
        email,
        name: input.name,
        image: input.image ?? null,
        passwordHash,
      })
      .returning({ id: users.id });

    // 3) membership (admin)
    await tx.insert(memberships).values({
      workspaceId: ws.id,
      userId: user.id,
      role: 'admin',
    });

    // 4) default API key — show plaintext once, store argon2 hash.
    const keyExt = newId('key');
    const secret = newId('key').slice(4); // random 10-char secret
    const prefix = `voc_live_${keyExt.slice(4, 10)}`;
    const plaintext = `${prefix}_${secret}`;
    const hash = await argon2Hash(plaintext);
    await tx.insert(apiKeys).values({
      externalId: keyExt,
      workspaceId: ws.id,
      name: 'Default key',
      prefix,
      hash,
      scope: 'live',
      createdBy: user.id,
    });

    return {
      userExternalId: userExt,
      workspaceExternalId: wsExt,
      apiKeyPrefix: prefix,
      apiKeyPlaintext: plaintext,
    };
  });
}
