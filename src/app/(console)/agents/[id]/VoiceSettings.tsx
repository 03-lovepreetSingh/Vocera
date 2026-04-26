'use client';

import { Mic, Square } from '@/components/icons';
import { LANGUAGES } from '@/lib/languages';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

interface Props {
  agentExternalId: string;
  languages: string[];
  initialVoiceMap: Record<string, string>;
  initialSpeed: number;
}

interface VoiceCard {
  id: string;
  name: string;
  gender: 'Female' | 'Male';
  accent: string;
  description: string;
}

/**
 * Curated voice gallery. The IDs are real ElevenLabs voice IDs (same set used
 * in src/lib/languages.ts as the per-language defaults). When the user picks
 * a card we apply it to the language they're currently editing.
 */
const VOICE_GALLERY: VoiceCard[] = [
  {
    id: '21m00Tcm4TlvDq8ikWAM',
    name: 'Rachel',
    gender: 'Female',
    accent: 'en-US',
    description: 'Warm and clear — works well for support.',
  },
  {
    id: 'EXAVITQu4vr4xnSDxMaL',
    name: 'Bella',
    gender: 'Female',
    accent: 'en-US',
    description: 'Bright and friendly. Good multilingual coverage.',
  },
  {
    id: 'ErXwobaYiN019PkySvjV',
    name: 'Antoni',
    gender: 'Male',
    accent: 'en-US',
    description: 'Calm, considered tone. Great for outbound.',
  },
  {
    id: 'VR6AewLTigWG4xSOukaG',
    name: 'Arnold',
    gender: 'Male',
    accent: 'en-US',
    description: 'Deep and grounded — confident even in long replies.',
  },
  {
    id: 'pNInz6obpgDQGcFmaJgB',
    name: 'Adam',
    gender: 'Male',
    accent: 'en-US',
    description: 'Neutral, broadcast-ready voice.',
  },
];

const VOICES_BY_ID: Record<string, VoiceCard> = Object.fromEntries(
  VOICE_GALLERY.map((v) => [v.id, v]),
);

export function VoiceSettings({
  agentExternalId,
  languages,
  initialVoiceMap,
  initialSpeed,
}: Props) {
  const router = useRouter();
  const [voiceMap, setVoiceMap] = useState<Record<string, string>>(() => {
    // Ensure every enabled language has an entry — fall back to first gallery voice.
    const seed: Record<string, string> = {};
    for (const code of languages) {
      seed[code] = initialVoiceMap[code] ?? VOICE_GALLERY[0].id;
    }
    return seed;
  });
  const [editingLang, setEditingLang] = useState<string>(languages[0] ?? 'en-US');
  const [speed, setSpeed] = useState<number>(initialSpeed);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<string | null>(null);

  const dirty =
    speed !== initialSpeed ||
    JSON.stringify(voiceMap) !== JSON.stringify(seedFrom(initialVoiceMap, languages));

  async function onSave() {
    setError(null);
    setSavedMsg(null);
    const res = await fetch(`/api/v1/agents/${agentExternalId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ voiceMap, speechSpeed: speed }),
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
    setSavedMsg(j?.versionBumped ? `Saved as v${j.currentVersion}.` : 'No changes to save.');
    startTransition(() => router.refresh());
  }

  function previewVoice(voiceId: string) {
    // Stub: the real preview pipeline would stream a sample MP3 from the
    // voice provider. For now just toggle the icon for ~1.2s so the UI
    // feels responsive.
    setPreviewing(voiceId);
    window.setTimeout(() => setPreviewing((p) => (p === voiceId ? null : p)), 1200);
  }

  function pickVoiceForCurrentLang(voiceId: string) {
    setVoiceMap((m) => ({ ...m, [editingLang]: voiceId }));
    setSavedMsg(null);
  }

  return (
    <div className="grid gap-5">
      {/* Voice gallery */}
      <div className="rounded-lg border border-line-soft bg-paper px-5 py-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold">Voice</div>
            <div className="text-xs text-ink-3">
              Picking applies to{' '}
              <span className="font-medium text-ink-2">
                {LANGUAGES.find((l) => l.code === editingLang)?.label ?? editingLang}
              </span>
              . Switch language below.
            </div>
          </div>
          <select
            className="rounded-md border border-line-soft bg-paper px-2 py-1 text-xs"
            value={editingLang}
            onChange={(e) => setEditingLang(e.target.value)}
          >
            {languages.map((c) => (
              <option key={c} value={c}>
                {LANGUAGES.find((l) => l.code === c)?.label ?? c}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {VOICE_GALLERY.map((v) => {
            const selected = voiceMap[editingLang] === v.id;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => pickVoiceForCurrentLang(v.id)}
                className={`text-left rounded-lg border px-3 py-3 transition ${
                  selected
                    ? 'border-accent bg-accent-soft'
                    : 'border-line-soft bg-paper hover:bg-fill'
                }`}
              >
                <div className="mb-2 flex items-center justify-between">
                  <div
                    className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold text-paper"
                    style={{
                      background:
                        v.gender === 'Female'
                          ? 'linear-gradient(135deg, #f472b6, #60a5fa)'
                          : 'linear-gradient(135deg, #6366f1, #14b8a6)',
                    }}
                  >
                    {v.name[0]}
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      previewVoice(v.id);
                    }}
                    aria-label={`Preview ${v.name}`}
                    className="flex h-6 w-6 items-center justify-center rounded-full border border-line-soft bg-paper hover:bg-fill"
                  >
                    {previewing === v.id ? (
                      <Square className="h-3 w-3" />
                    ) : (
                      <Mic className="h-3 w-3" />
                    )}
                  </button>
                </div>
                <div className="text-sm font-semibold">{v.name}</div>
                <div className="text-[11px] text-ink-3">
                  {v.gender} · {v.accent}
                </div>
                <div className="mt-1 text-[11px] text-ink-3 line-clamp-2">{v.description}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Speech speed */}
      <div className="rounded-lg border border-line-soft bg-paper px-5 py-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold">Speech speed</div>
            <div className="text-xs text-ink-3">How fast the agent talks. 1× is natural pace.</div>
          </div>
          <div className="rounded-md border border-line-soft bg-paper px-2 py-1 text-xs">
            {speed.toFixed(2)}×
          </div>
        </div>
        <div className="grid grid-cols-[60px_1fr_60px] items-center gap-3">
          <span className="text-xs text-ink-3">0.7×</span>
          <input
            type="range"
            min={0.7}
            max={1.3}
            step={0.05}
            value={speed}
            onChange={(e) => {
              setSpeed(Number(e.target.value));
              setSavedMsg(null);
            }}
            className="w-full accent-[var(--accent,#3b82f6)]"
          />
          <span className="text-right text-xs text-ink-3">1.3×</span>
        </div>
      </div>

      {/* Per-language voice map */}
      <div className="rounded-lg border border-line-soft bg-paper px-5 py-4">
        <div className="mb-3">
          <div className="text-sm font-semibold">Voice per language</div>
          <div className="text-xs text-ink-3">
            Swap voices independently for each enabled language.
          </div>
        </div>
        <div className="grid gap-2">
          {languages.map((code) => {
            const lang = LANGUAGES.find((l) => l.code === code);
            const currentId = voiceMap[code] ?? VOICE_GALLERY[0].id;
            const currentName = VOICES_BY_ID[currentId]?.name ?? currentId.slice(0, 6);
            return (
              <div
                key={code}
                className="grid grid-cols-[160px_1fr_auto] items-center gap-3 border-b border-line-softer py-2 last:border-b-0"
              >
                <div className="text-sm">
                  <div className="font-medium">{lang?.label ?? code}</div>
                  <div className="text-[11px] text-ink-3">{lang?.native}</div>
                </div>
                <select
                  className="rounded-md border border-line-soft bg-paper px-2 py-1.5 text-sm"
                  value={currentId}
                  onChange={(e) => {
                    setVoiceMap((m) => ({ ...m, [code]: e.target.value }));
                    setSavedMsg(null);
                  }}
                >
                  {VOICE_GALLERY.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name} · {v.gender}
                    </option>
                  ))}
                  {/* Allow keeping a custom voice id that's not in the gallery. */}
                  {!VOICES_BY_ID[currentId] && (
                    <option value={currentId}>{currentName} (custom)</option>
                  )}
                </select>
                <button
                  type="button"
                  onClick={() => previewVoice(currentId)}
                  className="rounded-md border border-line-soft bg-paper px-2 py-1 text-xs hover:bg-fill"
                >
                  {previewing === currentId ? 'Stop' : 'Preview'}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-between">
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
              setVoiceMap(seedFrom(initialVoiceMap, languages));
              setSpeed(initialSpeed);
              setError(null);
              setSavedMsg(null);
            }}
            disabled={!dirty || pending}
            className="rounded-md border border-line-soft bg-paper px-3 py-1.5 text-sm hover:bg-fill disabled:opacity-50"
          >
            Discard
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={!dirty || pending}
            className="rounded-md bg-accent px-3 py-1.5 text-sm text-paper disabled:opacity-50"
          >
            {pending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function seedFrom(map: Record<string, string>, languages: string[]): Record<string, string> {
  const seed: Record<string, string> = {};
  for (const code of languages) {
    seed[code] = map[code] ?? VOICE_GALLERY[0].id;
  }
  return seed;
}
