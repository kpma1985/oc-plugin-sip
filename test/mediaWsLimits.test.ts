import { expect, it, vi } from 'vitest';
import { WebSocketServer } from 'ws';
import { createWsClient } from '../vendor/sip-bridge/src/ws/wsClient.js';

it('rejects oversized websocket frames at the transport boundary', async () => {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  if (typeof address === 'string' || !address) throw new Error('Expected TCP listener');
  const peerReady = new Promise<import('ws').WebSocket>(resolve => server.once('connection', resolve));
  const log = { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any;
  const client = await createWsClient(`ws://127.0.0.1:${address.port}`, {
    streamSid: 'stream', callSid: 'call', from: 'from', to: 'to', sipCallId: 'sip',
    mediaFormat: { encoding: 'audio/x-mulaw', sampleRate: 8000, channels: 1 },
  }, log);
  try {
    const audio = vi.fn(); client.onAudio(audio);
    const peer = await peerReady;
    const closed = new Promise<number>(resolve => peer.once('close', resolve));
    peer.send('x'.repeat(1024 * 1024 + 1));
    expect(await closed).toBe(1009);
    expect(audio).not.toHaveBeenCalled();
  } finally {
    client.stop();
    for (const peer of server.clients) peer.terminate();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
