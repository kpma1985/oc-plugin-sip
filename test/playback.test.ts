import { afterEach, describe, expect, it, vi } from 'vitest';
import { CallSession } from '../src/media/callSession.js';
import { parseSipConfig } from '../src/config.js';
import { speakAnnouncement } from '../src/voice/voiceCall.js';
import { makeDrainForTest } from '../vendor/sip-bridge/src/ws/wsClient.js';

const calls: CallSession[] = [];
afterEach(() => { for (const call of calls.splice(0)) call.end('test'); vi.useRealTimers(); });
function setup() {
  vi.useFakeTimers(); vi.setSystemTime(0);
  const sent: Array<{ time: number; event: string; media?: { payload: string }; mark?: { name: string } }> = [];
  const call = new CallSession({ streamSid: 'MZ-test', onSend: payload => sent.push({ ...JSON.parse(payload), time: Date.now() }) });
  call.activate(); calls.push(call);
  return { call, sent };
}

describe('streaming playback evidence and prebuffer', () => {
  it('reproduces an underrun when first chunk holds only 20 ms of audio', () => {
    const { call, sent } = setup();
    call.sendAudioChunk(Buffer.alloc(160, 1));
    vi.advanceTimersByTime(100);
    call.sendAudioChunk(Buffer.alloc(640, 2)); call.mark('done');
    vi.advanceTimersByTime(120);
    expect(sent.filter(x => x.event === 'media').map(x => x.time)).toEqual([20, 120, 140, 160, 180]);
    // 100 ms packet spacing with only 20 ms audio: 80 ms missing playout.
  });

  it('absorbs same chunk gap with 100 ms prebuffer, preserving bytes and mark order', () => {
    const { call, sent } = setup(); call.setPlaybackPrebuffer(100);
    call.sendAudioChunk(Buffer.alloc(160, 1)); vi.advanceTimersByTime(100);
    expect(sent).toEqual([]);
    call.sendAudioChunk(Buffer.alloc(640, 2)); call.mark('done'); vi.advanceTimersByTime(120);
    expect(sent.filter(x => x.event === 'media').map(x => x.time)).toEqual([120, 140, 160, 180, 200]);
    expect(Buffer.concat(sent.filter(x => x.media).map(x => Buffer.from(x.media!.payload, 'base64'))))
      .toEqual(Buffer.concat([Buffer.alloc(160, 1), Buffer.alloc(640, 2)]));
    expect(sent.at(-1)?.mark?.name).toBe('done');
  });

  it('rearms after underrun and interruption without a stale timer bypassing threshold', () => {
    const { call, sent } = setup(); call.setPlaybackPrebuffer(100);
    call.sendAudioChunk(Buffer.alloc(800)); vi.advanceTimersByTime(140);
    call.sendAudioChunk(Buffer.alloc(160)); vi.advanceTimersByTime(100);
    expect(sent.filter(x => x.event === 'media')).toHaveLength(5);
    call.sendAudioChunk(Buffer.alloc(640)); call.interrupt();
    call.sendAudioChunk(Buffer.alloc(160)); vi.advanceTimersByTime(100);
    expect(sent.filter(x => x.event === 'media')).toHaveLength(5);
    expect(call.queuedBytes).toBe(160);
    call.mark('new'); vi.advanceTimersByTime(40);
    expect(sent.slice(-2).map(x => x.event)).toEqual(['media', 'mark']);
    expect(call.queuedBytes).toBe(0);
  });

  it('flushes short/partial completed clips and caps threshold by queue limit', () => {
    const { call, sent } = setup(); call.setPlaybackPrebuffer(2000);
    call.sendAudioChunk(Buffer.alloc(1, 1)); call.mark('short'); vi.advanceTimersByTime(40);
    expect(sent.map(x => x.event)).toEqual(['media', 'mark']);
    expect(Buffer.from(sent[0]!.media!.payload, 'base64')).toEqual(Buffer.concat([Buffer.from([1]), Buffer.alloc(159, 0xff)]));
    call.sendAudio(Buffer.alloc(160)); vi.advanceTimersByTime(40);
    expect(sent.filter(x => x.event === 'media')).toHaveLength(2);
    call.setQueueLimit(320); call.sendAudioChunk(Buffer.alloc(320)); vi.advanceTimersByTime(60);
    expect(sent.filter(x => x.event === 'media')).toHaveLength(4);
    call.sendAudioChunk(Buffer.alloc(1)); call.end('test'); vi.advanceTimersByTime(100);
    expect(call.queuedBytes).toBe(0);
    expect(sent.filter(x => x.event === 'media')).toHaveLength(4);
  });

  it('keeps two paced stages at 20 ms, not 40 ms, under ideal scheduling', () => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    const times: number[] = [];
    const drain = makeDrainForTest(() => times.push(Date.now()), () => undefined);
    const call = new CallSession({
      streamSid: 'MZ-test', onSend: payload => {
        const frame = JSON.parse(payload);
        if (frame.event === 'media') drain.enqueue(Buffer.from(frame.media.payload, 'base64'));
      }
    }); calls.push(call);
    call.sendAudio(Buffer.alloc(800)); vi.advanceTimersByTime(140);
    expect(times).toHaveLength(5);
    expect(times.slice(1).map((time, i) => time - times[i]!)).toEqual([20, 20, 20, 20]);
    drain.stop();
  });

  it('validates opt-in config and mirrors manifest constraints', async () => {
    expect(parseSipConfig({}).voice.playbackPrebufferMs).toBe(0);
    for (const value of [-20, 1, 21, 2020]) {
      expect(() => parseSipConfig({ voice: { playbackPrebufferMs: value } })).toThrow();
    }
    const { readFile } = await import('node:fs/promises');
    const manifest = JSON.parse(await readFile(new URL('../openclaw.plugin.json', import.meta.url), 'utf8'));
    expect(manifest.configSchema.properties.voice.properties.playbackPrebufferMs)
      .toMatchObject({ default: 0, minimum: 0, maximum: 2000, multipleOf: 20 });
  });

  it('applies prebuffer through announcement path and lets completion mark release short audio', async () => {
    const { call, sent } = setup();
    const config = parseSipConfig({ voice: { playbackPrebufferMs: 100 }, tts: { apiKey: 'fake' } });
    await speakAnnouncement(call, config, 'Test.', new AbortController().signal, () => true, {
      fetch: async () => new Response(Buffer.alloc(160), { headers: { 'Content-Type': 'audio/mulaw' } }),
    });
    vi.advanceTimersByTime(100); expect(sent).toEqual([]);
    call.mark('complete'); vi.advanceTimersByTime(40);
    expect(sent.map(x => x.event)).toEqual(['media', 'mark']);
  });
});
