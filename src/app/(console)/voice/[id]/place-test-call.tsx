/**
 * Inline outbound dialer used on the voice deployment page.
 *
 * POSTs /api/v1/calls/outbound and surfaces the call SID so dev/QA can
 * sanity-check the Twilio leg without leaving the deployment page.
 *
 * Trial caveat: with a Twilio trial account this only succeeds against
 * verified destinations and Twilio prepends a "trial account" preamble —
 * surfaced via the note above the form.
 *
 * Split out of `client.tsx` to keep that file under the 350-line cap.
 */
'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Phone } from '@/components/icons';

interface Props {
  agentExternalId: string;
  deploymentExternalId: string;
}

export function PlaceTestCall({ agentExternalId, deploymentExternalId }: Props) {
  const [to, setTo] = useState('');
  const [opener, setOpener] = useState('');
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState<{ to: string; callSid: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsTwilio, setNeedsTwilio] = useState(false);

  function clearMessages() {
    if (success) setSuccess(null);
    if (error) setError(null);
    if (needsTwilio) setNeedsTwilio(false);
  }

  async function call() {
    if (busy || !to.trim()) return;
    setBusy(true);
    setSuccess(null);
    setError(null);
    setNeedsTwilio(false);
    try {
      const res = await fetch('/api/v1/calls/outbound', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          to: to.trim(),
          agent_id: agentExternalId,
          deployment_id: deploymentExternalId,
          opener: opener.trim() || undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 201) {
        setSuccess({ to: json?.to ?? to.trim(), callSid: json?.call_sid ?? '' });
        return;
      }
      const errMsg =
        typeof json?.error === 'string'
          ? json.error
          : json?.error?.fieldErrors
            ? Object.entries(json.error.fieldErrors as Record<string, string[]>)
                .map(([k, v]) => `${k}: ${v?.[0] ?? ''}`)
                .join('; ')
            : `Request failed (${res.status})`;
      if (
        res.status === 400 &&
        typeof json?.error === 'string' &&
        json.error.toLowerCase().includes('twilio not configured')
      ) {
        setNeedsTwilio(true);
      }
      setError(errMsg);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-line-soft bg-paper p-5">
      <div className="mb-1 flex items-center gap-2">
        <Phone className="h-3.5 w-3.5 text-accent" />
        <span className="text-sm font-semibold">Place test call</span>
      </div>
      <p className="mb-3 text-[11px] text-ink-3">
        Outbound calls require Twilio credentials connected in Integrations and a paid
        Twilio number (or a verified destination on trial).
      </p>

      <label className="mb-1 block text-[11px] font-medium">Phone number</label>
      <input
        type="tel"
        value={to}
        onChange={(e) => {
          setTo(e.target.value);
          clearMessages();
        }}
        placeholder="+14155551234"
        spellCheck={false}
        className="mb-3 w-full rounded-md border border-line-soft bg-paper px-3 py-2 font-mono text-xs focus:border-accent focus:outline-none"
      />

      <label className="mb-1 block text-[11px] font-medium">Opener (optional)</label>
      <textarea
        value={opener}
        onChange={(e) => {
          setOpener(e.target.value);
          clearMessages();
        }}
        placeholder="Hi, this is Vocera calling about..."
        rows={2}
        className="mb-3 w-full resize-y rounded-md border border-line-soft bg-paper px-3 py-2 text-xs focus:border-accent focus:outline-none"
      />

      <button
        type="button"
        onClick={call}
        disabled={busy || !to.trim()}
        className="flex w-full items-center justify-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-paper disabled:opacity-60"
      >
        <Phone className="h-3 w-3" />
        {busy ? 'Calling…' : 'Call now'}
      </button>

      {success && (
        <p className="mt-3 rounded-md bg-accent-soft px-3 py-2 text-[11px] text-accent">
          Calling {success.to}…
          {success.callSid && (
            <>
              {' '}
              <span className="font-mono">(CallSid: {success.callSid})</span>
            </>
          )}
        </p>
      )}

      {error && !needsTwilio && (
        <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-[11px] text-red-600">{error}</p>
      )}

      {needsTwilio && (
        <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
          Twilio is not connected for this workspace.{' '}
          <Link href="/integrations" className="underline hover:text-amber-900">
            Connect it in Integrations
          </Link>{' '}
          to place outbound calls.
        </p>
      )}
    </div>
  );
}
