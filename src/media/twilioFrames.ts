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

/** Parse one WebSocket text frame into a typed event; returns null for unknown shapes. */
export function parseMediaStreamsFrame(raw: string): TwilioMediaStreamsEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const frame = parsed as Record<string, unknown>;
  const event = frame['event'];
  if (event !== 'connected' && (typeof frame['streamSid'] !== 'string' || !frame['streamSid'])) return null;
  const hasStringField = (value: unknown, key: string): boolean =>
    typeof value === 'object' && value !== null && !Array.isArray(value) &&
    typeof (value as Record<string, unknown>)[key] === 'string';
  switch (event) {
    case 'media':
      if (!hasStringField(frame['media'], 'payload')) return null;
      return parsed as TwilioMediaStreamsEvent;
    case 'mark':
      if (!hasStringField(frame['mark'], 'name')) return null;
      return parsed as TwilioMediaStreamsEvent;
    case 'dtmf':
      if (!hasStringField(frame['dtmf'], 'digit')) return null;
      return parsed as TwilioMediaStreamsEvent;
    case 'connected':
    case 'start':
    case 'clear':
    case 'stop':
      return parsed as TwilioMediaStreamsEvent;
    default:
      return null;
  }
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
