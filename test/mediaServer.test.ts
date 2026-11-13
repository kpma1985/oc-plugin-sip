import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

import { MediaServer } from '../src/media/mediaServer.js';
import { MULAW_FRAME_BYTES, buildMediaFrame, decodeMediaPayload, parseMediaStreamsFrame } from '../src/media/twilioFrames.js';

const servers: MediaServer[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.stop();
});

async function startServer(port = 0): Promise<MediaServer> {
  const server = new MediaServer({ host: '127.0.0.1', port, path: '/sip/media' });
  servers.push(server);
  await server.start();
  return server;
}

function openClient(server: MediaServer): Promise<WebSocket> {
  const port = server.address?.port;
  if (!port) throw new Error('media server has no port');
  const socket = new WebSocket(`ws://127.0.0.1:${port}/sip/media`);
  return new Promise((resolve, reject) => {
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
  });
}

function audioPayload(): Uint8Array {
  const audio = new Uint8Array(MULAW_FRAME_BYTES);
  for (let i = 0; i < audio.length; i += 1) audio[i] = (i * 3) & 0xff;
  return audio;
}

describe('MediaServer', () => {
  it.each([
    ['audio/G722', 16000, 'g722'],
    ['audio/x-alaw', 8000, 'pcma'],
  ] as const)('accepts negotiated %s and exposes its call codec', async (encoding, sampleRate, codec) => {
    const server = await startServer();
    const socket = await openClient(server);
    socket.send(JSON.stringify({ event: 'start', streamSid: 'MZcodec', start: { mediaFormat: { encoding, sampleRate, channels: 1 } } }));
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(server.registry.get('MZcodec')?.media.codec).toBe(codec);
    socket.close();
  });

  it('registers a call on start and surfaces frame parameters', async () => {
    const server = await startServer();
    const calls: Array<Record<string, string>> = [];
    server.on('call', (_session, custom) => calls.push(custom));

    const socket = await openClient(server);
    socket.send(
      JSON.stringify({
        event: 'start',
        streamSid: 'MZ1',
        start: { callSid: 'CA1', customParameters: { from: '+4915100000001', to: '+4921193674951' } },
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(server.registry.size).toBe(1);
    expect(calls[0]).toEqual({ from: '+4915100000001', to: '+4921193674951' });
    expect(server.registry.get('MZ1')?.from).toBe('+4915100000001');
    socket.close();
  });

  it('emits inbound audio, dtmf and mark, and ends on stop', async () => {
    const server = await startServer();
    const audio: Uint8Array[] = [];
    const digits: string[] = [];
    const marks: string[] = [];
    const ended: string[] = [];
    server.on('audio', (_session, frame) => audio.push(frame));
    server.on('dtmf', (_session, digit) => digits.push(digit));
    server.on('mark', (_session, name) => marks.push(name));
    server.on('end', (streamSid, reason) => ended.push(`${streamSid}:${reason}`));

    const socket = await openClient(server);
    socket.send(JSON.stringify({ event: 'connected' }));
    socket.send(JSON.stringify({ event: 'start', streamSid: 'MZ1', start: { mediaFormat: { encoding: 'audio/x-mulaw', sampleRate: 8000 } } }));
    socket.send(buildMediaFrame('MZ1', audioPayload()));
    socket.send(JSON.stringify({ event: 'dtmf', streamSid: 'MZ1', dtmf: { digit: '7' } }));
    socket.send(JSON.stringify({ event: 'mark', streamSid: 'MZ1', mark: { name: 'tts-1' } }));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(audio).toHaveLength(1);
    expect(audio[0]?.length).toBe(MULAW_FRAME_BYTES);
    expect(Array.from(audio[0] ?? [])).toEqual(Array.from(audioPayload()));
    expect(digits).toEqual(['7']);
    expect(marks).toEqual(['tts-1']);

    socket.send(JSON.stringify({ event: 'stop', streamSid: 'MZ1' }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(ended).toEqual(['MZ1:gateway-stop']);
    expect(server.registry.size).toBe(0);
    socket.close();
  });

  it('sends agent audio back to the gateway in 20 ms frames', async () => {
    const server = await startServer();
    server.on('audio', (session, frame) => session.sendAudio(frame));

    const socket = await openClient(server);
    const received: Uint8Array[] = [];
    socket.on('message', (data) => {
      const event = parseMediaStreamsFrame(String(data));
      if (event?.event === 'media') received.push(decodeMediaPayload(event));
    });
    socket.send(JSON.stringify({ event: 'start', streamSid: 'MZ1', start: {} }));
    socket.send(buildMediaFrame('MZ1', audioPayload()));

    const deadline = Date.now() + 2000;
    while (received.length < 1 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(received).toHaveLength(1);
    expect(Array.from(received[0] ?? [])).toEqual(Array.from(audioPayload()));
    socket.close();
  });

  it('rejects binding when the port is already taken', async () => {
    const first = await startServer();
    const port = first.address?.port as number;
    const second = new MediaServer({ host: '127.0.0.1', port, path: '/sip/media' });
    await expect(second.start()).rejects.toThrow();
  });
});
