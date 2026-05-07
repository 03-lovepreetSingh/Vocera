import { describe, expect, it } from 'vitest';

describe('server/twilio/twiml', () => {
  it('emits self-closing <Stream> when customParameters is omitted', async () => {
    const { buildConnectStreamTwiML } = await import('../../../src/server/twilio/twiml');
    const out = buildConnectStreamTwiML({ wsUrl: 'wss://x.example/twilio/wsk_a' });
    const expected =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<Response>\n' +
      '  <Connect>\n' +
      '    <Stream url="wss://x.example/twilio/wsk_a"/>\n' +
      '  </Connect>\n' +
      '</Response>';
    expect(out).toBe(expected);
  });

  it('emits self-closing <Stream> when customParameters is empty', async () => {
    const { buildConnectStreamTwiML } = await import('../../../src/server/twilio/twiml');
    const out = buildConnectStreamTwiML({
      wsUrl: 'wss://x.example/twilio/wsk_a',
      customParameters: {},
    });
    const expected =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<Response>\n' +
      '  <Connect>\n' +
      '    <Stream url="wss://x.example/twilio/wsk_a"/>\n' +
      '  </Connect>\n' +
      '</Response>';
    expect(out).toBe(expected);
  });

  it('emits one <Parameter> child', async () => {
    const { buildConnectStreamTwiML } = await import('../../../src/server/twilio/twiml');
    const out = buildConnectStreamTwiML({
      wsUrl: 'wss://x.example/twilio/wsk_a',
      customParameters: { direction: 'outbound' },
    });
    const expected =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<Response>\n' +
      '  <Connect>\n' +
      '    <Stream url="wss://x.example/twilio/wsk_a">\n' +
      '      <Parameter name="direction" value="outbound"/>\n' +
      '    </Stream>\n' +
      '  </Connect>\n' +
      '</Response>';
    expect(out).toBe(expected);
  });

  it('emits two <Parameter> children in insertion order', async () => {
    const { buildConnectStreamTwiML } = await import('../../../src/server/twilio/twiml');
    const out = buildConnectStreamTwiML({
      wsUrl: 'wss://x.example/twilio/wsk_a',
      customParameters: { direction: 'outbound', callSid: 'CA1' },
    });
    const expected =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<Response>\n' +
      '  <Connect>\n' +
      '    <Stream url="wss://x.example/twilio/wsk_a">\n' +
      '      <Parameter name="direction" value="outbound"/>\n' +
      '      <Parameter name="callSid" value="CA1"/>\n' +
      '    </Stream>\n' +
      '  </Connect>\n' +
      '</Response>';
    expect(out).toBe(expected);
  });

  it('XML-escapes & < > " \' in attribute values', async () => {
    const { buildConnectStreamTwiML } = await import('../../../src/server/twilio/twiml');
    const out = buildConnectStreamTwiML({
      wsUrl: 'wss://x.example/twilio/wsk_a',
      customParameters: { weird: `& < > " '` },
    });
    const expected =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<Response>\n' +
      '  <Connect>\n' +
      '    <Stream url="wss://x.example/twilio/wsk_a">\n' +
      '      <Parameter name="weird" value="&amp; &lt; &gt; &quot; &apos;"/>\n' +
      '    </Stream>\n' +
      '  </Connect>\n' +
      '</Response>';
    expect(out).toBe(expected);
  });

  it('escapes & in URLs containing query strings', async () => {
    const { buildConnectStreamTwiML } = await import('../../../src/server/twilio/twiml');
    const out = buildConnectStreamTwiML({
      wsUrl: 'wss://x.example/twilio/wsk_a?foo=1&bar=2',
    });
    const expected =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<Response>\n' +
      '  <Connect>\n' +
      '    <Stream url="wss://x.example/twilio/wsk_a?foo=1&amp;bar=2"/>\n' +
      '  </Connect>\n' +
      '</Response>';
    expect(out).toBe(expected);
  });
});
