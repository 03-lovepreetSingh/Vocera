/**
 * Right-rail client component for the voice setup page.
 *
 * Owns the bits that need browser interactivity:
 *   • Surface checkboxes (IVR / Outbound / Custom) — PATCHes the deployment.
 *   • Copy buttons for the IVR + custom URLs.
 *   • Reveal-toggle for the signing secret.
 *
 * Everything else (initial state, the URLs themselves) is passed in from the
 * server component so we don't double-fetch.
 */
'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  Check,
  Copy,
  Eye,
  EyeOff,
  FileText,
  Globe,
  Phone,
  Upload,
  Wrench,
  Zap,
} from '@/components/icons';

interface SurfaceFlags {
  ivr: boolean;
  outbound: boolean;
  custom: boolean;
}

interface Props {
  deploymentExternalId: string;
  initialSurfaces: SurfaceFlags;
  ivrUrl: string;
  customUrl: string;
  agentExternalId: string;
  signingSecret: string;
}

const SURFACE_OPTIONS: Array<{
  key: keyof SurfaceFlags;
  title: string;
  desc: string;
  Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
}> = [
  {
    key: 'ivr',
    title: 'IVR — Inbound',
    desc: 'Plug a webhook URL into your Twilio number.',
    Icon: Phone,
  },
  {
    key: 'outbound',
    title: 'Calling agent — Outbound',
    desc: 'Trigger calls from your CRM or a CSV.',
    Icon: Zap,
  },
  {
    key: 'custom',
    title: 'Custom integration',
    desc: 'Use the webhook anywhere — web, mobile, IoT.',
    Icon: Wrench,
  },
];

export function VoiceSetupClient({
  deploymentExternalId,
  initialSurfaces,
  ivrUrl,
  customUrl,
  agentExternalId,
  signingSecret,
}: Props) {
  const [surfaces, setSurfaces] = useState<SurfaceFlags>(initialSurfaces);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealSecret, setRevealSecret] = useState(false);

  async function toggleSurface(key: keyof SurfaceFlags) {
    const next = { ...surfaces, [key]: !surfaces[key] };
    setSurfaces(next); // optimistic
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/deployments/${deploymentExternalId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ surfaces: next }),
      });
      if (!res.ok) throw new Error(`PATCH failed (${res.status})`);
    } catch (e) {
      setError(String(e));
      // Roll back on failure so the UI reflects truth.
      setSurfaces(surfaces);
    } finally {
      setSaving(false);
    }
  }

  // Mask the secret unless the user clicked the eye icon. The masked form
  // shows a short tail so customers can sanity-check rotations without leaking
  // the full secret on screen-share.
  const maskedSecret = signingSecret
    ? `${signingSecret.slice(0, 6)}${'•'.repeat(8)}${signingSecret.slice(-4)}`
    : '—';

  return (
    <div className="grid gap-4">
      {/* ── Usage card ── */}
      <div className="rounded-lg border border-line-soft bg-paper p-5">
        <div className="mb-1 text-sm font-semibold">5 · How will this agent be used?</div>
        <p className="mb-3 text-xs text-ink-3">Pick all that apply.</p>
        <div className="grid gap-2">
          {SURFACE_OPTIONS.map(({ key, title, desc, Icon }) => {
            const sel = surfaces[key];
            return (
              <button
                key={key}
                type="button"
                onClick={() => toggleSurface(key)}
                disabled={saving}
                className={`flex items-start gap-3 rounded-md border px-3 py-3 text-left transition disabled:opacity-70 ${
                  sel
                    ? 'border-accent bg-accent-soft'
                    : 'border-line-soft bg-paper hover:bg-fill'
                }`}
              >
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-paper">
                  <Icon className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{title}</div>
                  <div className="text-xs text-ink-3">{desc}</div>
                </div>
                <span
                  className={`mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded border-2 ${
                    sel ? 'border-accent bg-accent' : 'border-line-soft'
                  }`}
                >
                  {sel && <Check className="h-2.5 w-2.5 text-paper" />}
                </span>
              </button>
            );
          })}
        </div>
        {error && <p className="mt-2 text-[11px] text-red-500">{error}</p>}
      </div>

      {/* ── IVR webhook ── */}
      <div className="rounded-lg border border-line-soft bg-paper p-5">
        <div className="mb-1 flex items-center gap-2">
          <Phone className="h-3.5 w-3.5 text-accent" />
          <span className="text-sm font-semibold">IVR webhook URL</span>
        </div>
        <p className="mb-3 text-[11px] text-ink-3">
          Paste this into Twilio → Phone numbers → "A call comes in".
        </p>

        <div className="flex items-center gap-2 rounded-md bg-ink px-3 py-2 text-paper">
          <Globe className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1 truncate font-mono text-[11px]">{ivrUrl}</span>
          <CopyButton value={ivrUrl} />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-3">
          <span>Method: POST</span>
          <span className="flex items-center gap-1.5">
            Signature:
            <span className="font-mono">{revealSecret ? signingSecret : maskedSecret}</span>
            <button
              type="button"
              onClick={() => setRevealSecret((v) => !v)}
              className="text-ink-3 hover:text-ink"
              aria-label={revealSecret ? 'Hide signing secret' : 'Reveal signing secret'}
            >
              {revealSecret ? (
                <EyeOff className="h-3.5 w-3.5" />
              ) : (
                <Eye className="h-3.5 w-3.5" />
              )}
            </button>
            {signingSecret && (
              <RotateSecretButton deploymentExternalId={deploymentExternalId} />
            )}
          </span>
        </div>
      </div>

      {/* ── Outbound calling ── */}
      <div className="rounded-lg border border-line-soft bg-paper p-5">
        <div className="mb-1 flex items-center gap-2">
          <Zap className="h-3.5 w-3.5 text-accent" />
          <span className="text-sm font-semibold">Outbound calling</span>
        </div>
        <p className="mb-3 text-[11px] text-ink-3">Trigger by API or upload a CSV.</p>

        <pre className="overflow-x-auto rounded-md bg-fill px-3 py-2 font-mono text-[11px] text-ink">
          {`POST /v1/calls/outbound  { "to": "+1...", "agent_id": "${agentExternalId}" }`}
        </pre>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled
            className="flex items-center gap-1.5 rounded-md border border-line-soft bg-paper px-2.5 py-1.5 text-[11px] text-ink-3 disabled:cursor-not-allowed"
            title="CSV upload — coming soon"
          >
            <Upload className="h-3 w-3" />
            Upload CSV
          </button>
          <Link
            href="/docs/outbound"
            className="flex items-center gap-1.5 rounded-md border border-line-soft bg-paper px-2.5 py-1.5 text-[11px] text-ink-3 hover:text-ink"
          >
            <FileText className="h-3 w-3" />
            API docs
          </Link>
        </div>
      </div>

      {/* ── Custom integration ── */}
      <div className="rounded-lg border border-line-soft bg-paper p-5">
        <div className="mb-1 flex items-center gap-2">
          <Wrench className="h-3.5 w-3.5 text-ink-3" />
          <span className="text-sm font-semibold">Custom integration</span>
        </div>
        <p className="mb-3 text-[11px] text-ink-3">
          Use the same webhook anywhere — mobile, web, IoT.
        </p>
        <div className="flex items-center gap-2 rounded-md border border-line-soft bg-paper px-3 py-2">
          <span className="flex-1 truncate font-mono text-[11px]">{customUrl}</span>
          <CopyButton value={customUrl} variant="light" />
        </div>
      </div>
    </div>
  );
}

function CopyButton({
  value,
  variant = 'dark',
}: {
  value: string;
  variant?: 'dark' | 'light';
}) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard API blocked — surface a fallback prompt so power-users still get the URL.
      window.prompt('Copy to clipboard:', value);
    }
  }
  const cls =
    variant === 'dark'
      ? 'rounded border border-paper/20 bg-paper/10 px-2 py-0.5 text-[10.5px] text-paper hover:bg-paper/20'
      : 'rounded border border-line-soft bg-fill px-2 py-0.5 text-[10.5px] text-ink-3 hover:text-ink';
  return (
    <button type="button" onClick={copy} className={cls}>
      {copied ? (
        <span className="flex items-center gap-1">
          <Check className="h-3 w-3" />
          Copied
        </span>
      ) : (
        <span className="flex items-center gap-1">
          <Copy className="h-3 w-3" />
          Copy
        </span>
      )}
    </button>
  );
}

/**
 * Calls PATCH with `rotate_secret: true` and reloads the page so the new secret
 * shows up in the masked display. We force a hard reload (router.refresh would
 * also work, but the secret value is held in a server prop so we want a fresh
 * round-trip).
 */
function RotateSecretButton({ deploymentExternalId }: { deploymentExternalId: string }) {
  const [busy, setBusy] = useState(false);
  async function rotate() {
    if (!confirm('Rotate the signing secret? Existing webhook signatures will break.')) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/deployments/${deploymentExternalId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rotate_secret: true }),
      });
      if (!res.ok) throw new Error(`Rotate failed (${res.status})`);
      window.location.reload();
    } catch (e) {
      alert(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <button
      type="button"
      onClick={rotate}
      disabled={busy}
      className="text-[10.5px] text-ink-3 underline-offset-2 hover:text-ink hover:underline disabled:opacity-60"
    >
      {busy ? 'Rotating…' : 'Rotate'}
    </button>
  );
}
