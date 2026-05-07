// TwiML builder for Twilio Programmable Voice Media Streams.
// Pure string construction — no I/O, no deps. Output is a complete
// XML document ready to return from the voice webhook handler.

export interface BuildConnectStreamArgs {
  /** Full wss:// URL to the Twilio Media Stream WS endpoint, e.g. wss://host/twilio/wsk_xyz */
  wsUrl: string;
  /** Custom <Parameter name=… value=…/> children Twilio will deliver in the stream's `start` event customParameters. Values are XML-escaped. */
  customParameters?: Record<string, string>;
}

function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function buildConnectStreamTwiML(args: BuildConnectStreamArgs): string {
  const { wsUrl, customParameters } = args;
  const urlAttr = escapeXmlAttr(wsUrl);
  const entries = customParameters ? Object.entries(customParameters) : [];

  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<Response>');
  // Use <Connect><Stream> for full-duplex bidirectional audio. Do NOT switch to
  // <Start><Stream> — that is a one-way fork (Twilio→us only) and breaks TTS playback.
  lines.push('  <Connect>');
  if (entries.length === 0) {
    lines.push(`    <Stream url="${urlAttr}"/>`);
  } else {
    lines.push(`    <Stream url="${urlAttr}">`);
    for (const [name, value] of entries) {
      lines.push(
        `      <Parameter name="${escapeXmlAttr(name)}" value="${escapeXmlAttr(value)}"/>`,
      );
    }
    lines.push('    </Stream>');
  }
  lines.push('  </Connect>');
  lines.push('</Response>');
  return lines.join('\n');
}
