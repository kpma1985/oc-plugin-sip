import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createMaskedLogger } from '../vendor/sip-bridge/src/logger/index.js';
import { createRtpHandler } from '../vendor/sip-bridge/src/rtp/rtpHandler.js';

describe('vendored RTP handler', () => {
  it('drops audio sent after dispose instead of crashing the process', async () => {
    const rtp = await createRtpHandler({
      portMin: 41000, portMax: 41100, log: createMaskedLogger([], new Writable({ write: (_chunk, _enc, done) => done() })), audioPt: 0, dtmfPt: 101, silenceByte: 0xff,
    });
    rtp.setRemote('127.0.0.1', 9);
    rtp.sendAudio(Buffer.alloc(160, 0xff));
    rtp.dispose();
    expect(() => rtp.sendAudio(Buffer.alloc(160, 0xff))).not.toThrow();
  });
});
