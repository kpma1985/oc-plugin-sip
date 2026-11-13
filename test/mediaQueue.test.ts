import { describe, it, expect, vi, afterEach } from 'vitest';
import { makeDrainForTest } from '../vendor/sip-bridge/src/ws/wsClient.js';

afterEach(() => vi.useRealTimers());
describe('bounded media retention', () => {
  it('bounds bytes independently of item count and rejects single oversize items', () => {
    vi.useFakeTimers();
    const sent: Buffer[] = [];
    const drain = makeDrainForTest(pkt => sent.push(pkt), () => {});
    for (let i = 0; i < 10; i++) drain.enqueue(Buffer.alloc(200_000, i));
    drain.enqueue(Buffer.alloc(800_001));
    vi.runAllTimers();
    expect(sent.map(pkt => pkt[0])).toEqual([6, 7, 8, 9]);
    expect(sent.reduce((total, pkt) => total + pkt.length, 0)).toBe(800_000);
  });

  it('bounds mark-only floods behind audio and rejects overlong UTF-8 names', () => {
    vi.useFakeTimers();
    const sent = vi.fn(); const marks: string[] = [];
    const drain = makeDrainForTest(sent, name => marks.push(name));
    drain.enqueue(Buffer.alloc(160));
    for (let i = 0; i < 6000; i++) drain.enqueueMark(String(i));
    drain.enqueueMark('💥'.repeat(65));
    vi.runAllTimers();
    expect(sent).not.toHaveBeenCalled();
    expect(marks).toEqual(Array.from({ length: 5000 }, (_, i) => String(i + 1000)));
  });

  it('copies tiny retained slices out of large mutable backing stores', () => {
    vi.useFakeTimers();
    const sent: Buffer[] = [];
    const drain = makeDrainForTest(pkt => sent.push(pkt), () => {});
    const backing = Buffer.alloc(10_000_000, 42);
    drain.enqueue(backing.subarray(100, 260));
    backing.fill(0);
    vi.runAllTimers();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual(Buffer.alloc(160, 42));
    expect(sent[0]!.buffer.byteLength).toBe(160);
  });

  it('clear flushes audio and echoes retained marks exactly once, then restarts', () => {
    vi.useFakeTimers();
    const sent = vi.fn(); const mark = vi.fn();
    const drain = makeDrainForTest(sent, mark);
    drain.enqueue(Buffer.alloc(160)); drain.enqueueMark('done'); drain.stop(); drain.stop();
    vi.runAllTimers();
    expect(sent).not.toHaveBeenCalled(); expect(mark).toHaveBeenCalledExactlyOnceWith('done');
    drain.enqueue(Buffer.alloc(160)); vi.runAllTimers(); expect(sent).toHaveBeenCalledTimes(1);
  });
});

it('counts UTF-8 mark bytes toward the independent byte bound', () => {
  vi.useFakeTimers();
  const marks: string[] = [];
  const drain = makeDrainForTest(() => {}, name => marks.push(name));
  drain.enqueue(Buffer.alloc(1));
  for (let i = 0; i < 5000; i++) drain.enqueueMark('💥'.repeat(64));
  vi.runAllTimers();
  expect(marks).toHaveLength(3125); // exactly 800000 / 256, not the 5000 item cap
});
