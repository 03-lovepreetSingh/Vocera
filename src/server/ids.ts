import { customAlphabet } from 'nanoid';

// URL-safe alphabet, no ambiguous chars (0/O, l/1).
const alphabet = '23456789abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
const nano = customAlphabet(alphabet, 10);

export type IdPrefix =
  | 'ws' // workspace
  | 'usr' // user
  | 'mem' // membership (rare — not currently used as external id)
  | 'key' // api key
  | 'ag' // agent
  | 'av' // agent version
  | 'kf' // knowledge file
  | 'kc' // knowledge chunk
  | 'ca' // conversation
  | 'msg' // message
  | 'lead'
  | 'sess'; // ephemeral session (e.g. talk-to-agent test)

export function newId(prefix: IdPrefix): string {
  return `${prefix}_${nano()}`;
}

/** Helper: derive Pinecone namespace from workspace + agent ids. */
export function pineconeNamespace(workspaceExternalId: string, agentExternalId: string): string {
  return `${workspaceExternalId}__${agentExternalId}`;
}
