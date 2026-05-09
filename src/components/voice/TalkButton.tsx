'use client';

import { useEffect, useRef, useState } from 'react';
import { Mic, Square } from '@/components/icons';
import { VoiceClient } from '@/lib/audio/client';

interface Props {
  agentExternalId: string;
}

interface TranscriptLine {
  role: 'user' | 'agent';
  text: string;
  language?: string;
}

export function TalkButton({ agentExternalId }: Props) {
  const [active, setActive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [partial, setPartial] = useState<string>('');
  const [ttft, setTtft] = useState<number | null>(null);
  const clientRef = useRef<VoiceClient | null>(null);
  const liveAgentRef = useRef<string>('');
  // Ref-tracked "currently starting" used inside async start() — refs don't
  // close over stale React renders the way state does, so this is the safe
  // re-entrancy guard. The button's `disabled` state below uses the React
  // state mirror so the UI updates instantly.
  const startingRef = useRef(false);

  // Tear down on unmount (route change, HMR, navigation away).
  useEffect(
    () => () => {
      try {
        clientRef.current?.stop();
      } catch {}
      clientRef.current = null;
      startingRef.current = false;
    },
    [],
  );

  async function start() {
    if (startingRef.current || clientRef.current) return;
    startingRef.current = true;
    setStarting(true);
    setError(null);
    setLines([]);
    setPartial('');
    setTtft(null);
    liveAgentRef.current = '';
    const client = new VoiceClient({
      agentExternalId,
      onEvent: (e) => {
        switch (e.type) {
          case 'partial':
            setPartial(e.text);
            break;
          case 'final':
            setPartial('');
            setLines((prev) => [...prev, { role: 'user', text: e.text, language: e.language }]);
            liveAgentRef.current = '';
            setLines((prev) => [...prev, { role: 'agent', text: '' }]);
            break;
          case 'agent_text':
            liveAgentRef.current += e.delta;
            setLines((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last?.role === 'agent') last.text = liveAgentRef.current;
              return next;
            });
            break;
          case 'metrics':
            setTtft(e.ttftMs);
            break;
          case 'error':
            setError(e.error);
            break;
          case 'closed':
            // WS died (server restart, network blip, normal end). Clear the
            // client ref so the next click can call start() again — without
            // this, the start() guard `if (clientRef.current) return` blocks
            // re-connect silently and the button looks dead.
            clientRef.current = null;
            startingRef.current = false;
            setActive(false);
            setStarting(false);
            break;
        }
      },
    });
    try {
      await client.start();
      clientRef.current = client;
      setActive(true);
    } catch (err) {
      setError(String(err));
      client.stop();
    } finally {
      // Always reset the starting flags — without this, a failed start would
      // permanently lock the button until the component unmounts.
      startingRef.current = false;
      setStarting(false);
    }
  }

  function stop() {
    try {
      clientRef.current?.stop();
    } catch (err) {
      console.warn('TalkButton stop error', err);
    }
    clientRef.current = null;
    startingRef.current = false;
    setStarting(false);
    setActive(false);
    setPartial('');
  }

  return (
    <div>
      <button
        type="button"
        onClick={active ? stop : start}
        disabled={starting}
        className={`flex h-14 w-full items-center justify-center gap-2 rounded-md font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${
          active ? 'bg-red-500 text-white' : 'bg-accent text-paper'
        } hover:opacity-90`}
      >
        {active ? <Square className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
        {starting ? 'Connecting…' : active ? 'End conversation' : 'Talk to agent'}
      </button>

      {error && <p className="mt-2 text-sm text-red-500">{error}</p>}

      {ttft !== null && (
        <p className="mt-3 text-[11px] text-ink-3">last response TTFT: {ttft}ms</p>
      )}

      {(lines.length > 0 || partial) && (
        <div className="mt-3 max-h-72 overflow-auto rounded-md border border-line-soft bg-fill p-3 text-sm">
          {lines.map((l, i) => (
            <div
              key={i}
              className={`mb-2 ${l.role === 'user' ? 'text-ink' : 'text-accent'}`}
            >
              <span className="mr-2 font-mono text-[10px] uppercase text-ink-3">
                {l.role}
                {l.language ? ` · ${l.language}` : ''}
              </span>
              {l.text}
            </div>
          ))}
          {partial && (
            <div className="text-ink-3 italic">
              <span className="mr-2 font-mono text-[10px] uppercase">user…</span>
              {partial}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
