import { createHmac, timingSafeEqual } from 'node:crypto';
import { BridgeError } from './state.mjs';

// The device signs `${timestamp}.${rawBody}`; the secret lives in the macOS Keychain
// on this side and in device flash on the other. Nothing else authorizes a request.
export function sign(secret, timestamp, rawBody) {
  return createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

export function verifySignature({ secret, timestamp, signature, rawBody, now, windowSeconds = 120 }) {
  if (typeof secret !== 'string' || secret.length < 16) throw new BridgeError('ALARM shared secret must be at least 16 chars', 500);
  if (!/^\d{1,12}$/.test(String(timestamp ?? ''))) throw new BridgeError('ALARM missing or malformed timestamp header', 401);
  if (typeof signature !== 'string' || !/^[0-9a-f]{64}$/.test(signature)) throw new BridgeError('ALARM missing or malformed signature header', 401);
  if (Math.abs(now - Number(timestamp)) > windowSeconds) throw new BridgeError('ALARM signature timestamp outside the replay window', 401);
  const expected = Buffer.from(sign(secret, timestamp, rawBody), 'hex');
  const provided = Buffer.from(signature, 'hex');
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    throw new BridgeError('ALARM signature mismatch', 401);
  }
  return true;
}
