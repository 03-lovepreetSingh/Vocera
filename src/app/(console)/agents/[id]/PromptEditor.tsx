'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';

interface Props {
  agentExternalId: string;
  version: number;
  initialPrompt: string;
}

/**
 * Monospace editor for the agent's systemPrompt.
 *
 * - Tracks a "dirty" state vs the server-loaded prompt.
 * - On Save, PATCHes the agent. The API forks a new agent_version when
 *   systemPrompt actually differs, so we surface "v{n+1} created" feedback.
 * - Resets cleanly when the user discards.
 */
export function PromptEditor({ agentExternalId, version, initialPrompt }: Props) {
  const router = useRouter();
  const [prompt, setPrompt] = useState(initialPrompt);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // If the server data changes (e.g. router.refresh after save), accept it.
  useEffect(() => {
    setPrompt(initialPrompt);
  }, [initialPrompt]);

  const dirty = prompt !== initialPrompt;
  const tokenEstimate = Math.ceil(prompt.length / 4);

  async function onSave() {
    setError(null);
    setSavedMsg(null);
    if (prompt.trim().length === 0) {
      setError('Prompt cannot be empty.');
      return;
    }
    const res = await fetch(`/api/v1/agents/${agentExternalId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ systemPrompt: prompt }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => null);
      setError(typeof j?.error === 'string' ? j.error : 'Failed to save');
      return;
    }
    const j = (await res.json().catch(() => null)) as {
      ok: true;
      currentVersion: number;
      versionBumped: boolean;
    } | null;
    if (j?.versionBumped) {
      setSavedMsg(`Saved as v${j.currentVersion}.`);
    } else {
      setSavedMsg('No changes to save.');
    }
    startTransition(() => router.refresh());
  }

  return (
    <div className="rounded-lg border border-line-soft bg-paper">
      <div className="flex items-center justify-between border-b border-line-softer bg-fill px-4 py-2 text-xs text-ink-3">
        <div className="flex items-center gap-2">
          <span>System prompt</span>
          <span>·</span>
          <span>v{version}</span>
          <span>·</span>
          <span>~{tokenEstimate.toLocaleString()} tokens</span>
        </div>
        <div className="flex items-center gap-2">
          {dirty ? <span className="text-accent">● unsaved</span> : <span>saved</span>}
        </div>
      </div>
      <textarea
        spellCheck={false}
        value={prompt}
        onChange={(e) => {
          setPrompt(e.target.value);
          setSavedMsg(null);
        }}
        className="block min-h-[420px] w-full resize-y bg-paper px-4 py-3 font-mono text-[12.5px] leading-6 text-ink focus:outline-none"
      />
      <div className="flex items-center justify-between border-t border-line-softer px-4 py-3">
        <div className="text-xs">
          {error ? (
            <span className="text-red-500">{error}</span>
          ) : savedMsg ? (
            <span className="text-ink-3">{savedMsg}</span>
          ) : (
            <span className="text-ink-3">Saving forks a new version automatically.</span>
          )}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              setPrompt(initialPrompt);
              setError(null);
              setSavedMsg(null);
            }}
            disabled={!dirty || pending}
            className="rounded-md border border-line-soft bg-paper px-3 py-1.5 text-xs hover:bg-fill disabled:opacity-50"
          >
            Discard
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={!dirty || pending}
            className="rounded-md bg-accent px-3 py-1.5 text-xs text-paper disabled:opacity-50"
          >
            {pending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
