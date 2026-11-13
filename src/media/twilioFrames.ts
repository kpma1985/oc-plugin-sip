/**
 * Twilio Media Streams wire format, as produced by Twilio and by
 * sipgate-sip-stream-bridge (same shape, so gateways are interchangeable).
 *
 * Frames carry base64-encoded mu-law 8 kHz audio in `media.payload`, plus
 * control events for turn taking (`mark`, `clear`) and keypad input (`dtmf`).
 */
export const MULAW_FRAME_BYTES = 160; // 20 ms of 8 kHz G.711
export const TELEPHONY_SAMPLE_RATE = 8000;

export interface TwilioConnectedEvent {
  event: 'connected';
  protocol?: string;
  version?: string;
}

export interface TwilioStartEvent {
  event: 'start';
  sequenceNumber?: string;
  streamSid: string;
  start: {
    streamSid?: string;
    accountSid?: string;
    callSid?: string;
    tracks?: string[];
    customParameters?: Record<string, string>;
    mediaFormat?: { encoding?: string; sampleRate?: number; channels?: number };
  };
}

export interface TwilioMediaEvent {
  event: 'media';
  sequenceNumber?: string;
  streamSid: string;
  media: { track?: string; chunk?: string; timestamp?: string; payload: string };
}

export interface TwilioMarkEvent {
  event: 'mark';
  streamSid: string;
  mark: { name: string };
}

export interface TwilioClearEvent {
  event: 'clear';
  streamSid: string;
}

export interface TwilioDtmfEvent {
  event: 'dtmf';
  streamSid: string;
  dtmf: { digit: string };
}

export interface TwilioStopEvent {
  event: 'stop';
  streamSid: string;
  stop?: { callSid?: string; accountSid?: string };
}

export type TwilioMediaStreamsEvent =
  | TwilioConnectedEvent
  | TwilioStartEvent
  | TwilioMediaEvent
  | TwilioMarkEvent
  | TwilioClearEvent
  | TwilioDtmfEvent
  | TwilioStopEvent;

// Bound input before constructing sessions or decoding audio. IDs remain opaque
// rather than Twilio-specific, because the embedded SIP bridge also sends them.
const MAX_FRAME_CHARS = 262_144;
const MAX_IDENTIFIER_CHARS = 256;
const MAX_CUSTOM_PARAMETERS = 128;
const MAX_CUSTOM_VALUE_CHARS = 2048;
const MAX_PAYLOAD_CHARS = 65_536;
type JsonObject = Record<string, unknown>;
function isObject(value: unknown): value is JsonObject {
return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function boundedString(value: unknown, max: number, nonempty = false): value is string {
return typeof value === 'string' && value.length <= max && (!nonempty || value.trim().length > 0);
}
function optionalString(object: JsonObject, key: string, max: number, nonempty = false): boolean {
return !Object.hasOwn(object, key) || boundedString(object[key], max, nonempty);
}
function validStart(value: unknown, streamSid: string): boolean {
if (!isObject(value)) return false;
if (!optionalString(value, 'streamSid', MAX_IDENTIFIER_CHARS, true) ||
(Object.hasOwn(value, 'streamSid') && value['streamSid'] !== streamSid) ||
!optionalString(value, 'callSid', MAX_IDENTIFIER_CHARS, true) ||
// The embedded bridge deliberately sends an empty accountSid.
!optionalString(value, 'accountSid', MAX_IDENTIFIER_CHARS)) return false;
if (Object.hasOwn(value, 'tracks')) {
const tracks = value['tracks'];
if (!Array.isArray(tracks) || tracks.length > 2 ||
!tracks.every(track => track === 'inbound' || track === 'outbound')) return false;
}
if (Object.hasOwn(value, 'customParameters')) {
const custom = value['customParameters'];
if (!isObject(custom)) return false;
const entries = Object.entries(custom);
if (entries.length > MAX_CUSTOM_PARAMETERS || !entries.every(([key, entry]) =>
boundedString(key, MAX_IDENTIFIER_CHARS, true) && boundedString(entry, MAX_CUSTOM_VALUE_CHARS))) return false;
}
if (Object.hasOwn(value, 'mediaFormat')) {
const format = value['mediaFormat'];
if (!isObject(format) || !boundedString(format['encoding'], 128, true) ||
typeof format['sampleRate'] !== 'number' || !Number.isSafeInteger(format['sampleRate']) ||
format['sampleRate'] <= 0 || format['sampleRate'] > 192_000 ||
(Object.hasOwn(format, 'channels') && (typeof format['channels'] !== 'number' ||
!Number.isSafeInteger(format['channels']) || format['channels'] <= 0 || format['channels'] > 32))) return false;
// Codec/rate support and mono-only negotiation remain the server's responsibility.
}
return true;
}
function validPayload(value: unknown): value is string {
if (!boundedString(value, MAX_PAYLOAD_CHARS)) return false;
// Standard base64, padded or unpadded; never Buffer's permissive whitespace,
// garbage, or base64url coercions. Empty audio remains a harmless legacy frame.
if (/[^A-Za-z0-9+/=]/.test(value)) return false;
const padding = value.indexOf('=');
if (padding < 0) return value.length % 4 !== 1;
return value.length % 4 === 0 && (value.endsWith('==')
? padding === value.length - 2 : padding === value.length - 1);
}
/** Parse untrusted JSON without coercion; malformed/oversized frames return null.
 * Legacy start frames may omit `start`; when present, all consumed fields are
 * validated. Returned events preserve the supported wire representation.
 */
export function parseMediaStreamsFrame(raw: string): TwilioMediaStreamsEvent | null {
if (typeof raw !== 'string' || raw.length > MAX_FRAME_CHARS) return null;
let parsed: unknown;
try {
parsed = JSON.parse(raw);
} catch {
return null;
}
if (!isObject(parsed)) return null;
const frame = parsed;
const event = frame['event'];
if (event !== 'connected' && !boundedString(frame['streamSid'], MAX_IDENTIFIER_CHARS, true)) return null;
if (!optionalString(frame, 'sequenceNumber', 32, true)) return null;
switch (event) {
case 'start':
if (Object.hasOwn(frame, 'start') && !validStart(frame['start'], frame['streamSid'] as string)) return null;
break;
case 'media': {
const media = frame['media'];
if (!isObject(media) || !validPayload(media['payload']) ||
!optionalString(media, 'track', 32, true) ||
!optionalString(media, 'chunk', 32, true) ||
!optionalString(media, 'timestamp', 32, true)) return null;
break;
}
case 'mark':
if (!isObject(frame['mark']) || !boundedString(frame['mark']['name'], 256, true)) return null;
break;
case 'dtmf':
if (!isObject(frame['dtmf']) || typeof frame['dtmf']['digit'] !== 'string' ||
! /^[0-9A-Da-d*#]$/.test(frame['dtmf']['digit']) ||
!optionalString(frame['dtmf'], 'track', 32, true)) return null;
break;
case 'stop':
if (Object.hasOwn(frame, 'stop') && (!isObject(frame['stop']) ||
!optionalString(frame['stop'], 'callSid', MAX_IDENTIFIER_CHARS, true) ||
!optionalString(frame['stop'], 'accountSid', MAX_IDENTIFIER_CHARS))) return null;
break;
case 'connected':
if (!optionalString(frame, 'protocol', 128, true) || !optionalString(frame, 'version', 128, true) ||
!optionalString(frame, 'streamSid', MAX_IDENTIFIER_CHARS, true)) return null;
break;
case 'clear':
break;
default:
return null;
}
return parsed as unknown as TwilioMediaStreamsEvent;
}

/** Decode the mu-law payload of a `media` event. */
export function decodeMediaPayload(event: TwilioMediaEvent): Uint8Array {
  return new Uint8Array(Buffer.from(event.media.payload, 'base64'));
}

/** Build the JSON text frame that sends one chunk of mu-law audio upstream. */
export function buildMediaFrame(streamSid: string, mulaw: Uint8Array): string {
  return JSON.stringify({
    event: 'media',
    streamSid,
    media: { payload: Buffer.from(mulaw).toString('base64') },
  });
}

/** Build a `mark` frame; the gateway echoes it once the audio has played out. */
export function buildMarkFrame(streamSid: string, name: string): string {
  return JSON.stringify({ event: 'mark', streamSid, mark: { name } });
}

/** Build a `clear` frame to flush buffered outbound audio (barge-in). */
export function buildClearFrame(streamSid: string): string {
  return JSON.stringify({ event: 'clear', streamSid });
}

/** Split a mu-law buffer into 20 ms frames for pacing toward the gateway. */
export function frameMulaw(mulaw: Uint8Array): Uint8Array[] {
  const frames: Uint8Array[] = [];
  for (let offset = 0; offset < mulaw.length; offset += MULAW_FRAME_BYTES) {
    frames.push(mulaw.subarray(offset, Math.min(offset + MULAW_FRAME_BYTES, mulaw.length)));
  }
  return frames;
}
