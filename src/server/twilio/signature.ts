// Twilio webhook signature verification (X-Twilio-Signature).
// Algorithm: data = fullUrl + sortedParams.map(([k,v]) => k + v).join('')
//            expected = base64(HMAC-SHA1(authToken, data))
//            verify with constant-time compare against the header value.
// fullUrl is the literal URL Twilio called (scheme + host + path + ?query),
// reconstructed from x-forwarded-proto / x-forwarded-host when behind a proxy.
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface VerifyArgs {
  authToken: string;
  fullUrl: string;
  params: Record<string, string>;
  signature: string;
}

export function verifyTwilioSignature(args: VerifyArgs): boolean {
  const { authToken, fullUrl, params, signature } = args;
  if (!authToken || typeof signature !== 'string' || signature.length === 0) {
    return false;
  }
  const sortedKeys = Object.keys(params).sort();
  let data = fullUrl;
  for (const k of sortedKeys) {
    data += k + params[k];
  }
  const expected = createHmac('sha1', authToken).update(data, 'utf8').digest('base64');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function reconstructFullUrl(req: Request): string {
  const headers = req.headers;
  const parsed = new URL(req.url);
  const proto =
    headers.get('x-forwarded-proto')?.split(',')[0].trim() ||
    parsed.protocol.replace(/:$/, '') ||
    'https';
  const host =
    headers.get('x-forwarded-host')?.split(',')[0].trim() ||
    headers.get('host')?.trim() ||
    parsed.host;
  return `${proto}://${host}${parsed.pathname}${parsed.search}`;
}
