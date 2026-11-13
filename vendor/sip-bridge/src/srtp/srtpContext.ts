/**
 * Minimal SRTP context for AES_128_CM_HMAC_SHA1_80 (RFC 3711, RFC 4568).
 *
 * Implements symmetric-key SRTP using Node.js's built-in `crypto` module:
 *   - AES-128-CM (Counter Mode) encryption  — RFC 3711 §4.1.1
 *   - HMAC-SHA1-80 authentication tag       — RFC 3711 §4.2
 *   - Session-key derivation from master key+salt — RFC 3711 §4.3.1
 *
 * This covers the SDES (RFC 4568) key exchange used in SIP INVITE/Answer.
 * One SrtpContext instance handles one direction (encrypt XOR decrypt).
 */

import { createCipheriv, createHmac } from 'node:crypto';

// AES-128-CM key derivation labels (RFC 3711 §4.3.1)
const LABEL_ENC  = 0x00; // session encryption key
const LABEL_AUTH = 0x01; // session authentication key
const LABEL_SALT = 0x02; // session salt

/**
 * Derive a session key using the SRTP pseudo-random function (RFC 3711 §4.3.1).
 *
 * The PRF for AES-128 is AES-128-CTR applied to an all-zeros plaintext with
 * IV = (master_salt_padded XOR (label * 2^16)), where master_salt is left-padded
 * with two 0x00 bytes to reach 16 bytes and label * 2^16 affects byte 13 (0-indexed).
 *
 * @param masterKey  16-byte AES-128 master key
 * @param masterSalt 14-byte master salt
 * @param label      derivation label (0=enc, 1=auth, 2=salt)
 * @param length     desired output length in bytes
 */
function deriveKey(masterKey: Buffer, masterSalt: Buffer, label: number, length: number): Buffer {
  // Left-pad 14-byte salt with 2 zero bytes → 16-byte IV base
  const iv = Buffer.alloc(16, 0);
  masterSalt.copy(iv, 2); // iv[2..15] = masterSalt[0..13]

  // XOR label * 2^16 into the IV.
  // For labels 0,1,2: label * 65536 = label at byte[13] (big-endian 128-bit)
  iv[13] ^= label & 0xff;
  // For labels > 255, byte[12] would also be affected, but we only use 0,1,2.

  // AES-128-CTR with IV and counter=0 generates the pseudo-random key material.
  const blocks = Math.ceil(length / 16);
  const plaintext = Buffer.alloc(blocks * 16, 0);
  const cipher = createCipheriv('aes-128-ctr', masterKey, iv);
  return cipher.update(plaintext).subarray(0, length);
}

/**
 * Compute the 128-bit SRTP IV for AES-128-CM encryption (RFC 3711 §4.1.1):
 *   IV = (k_s * 2^16) XOR (SSRC * 2^64) XOR (i * 2^16)
 * where k_s is the 14-byte session salt (padded to 16 bytes), SSRC is 32 bits,
 * and i is the 48-bit packet index (ROC << 16 | SEQ).
 */
function computeIV(sessionSalt: Buffer, ssrc: number, packetIndex: bigint): Buffer {
  // Pad 14-byte session salt to 16 bytes (k_s * 2^16 in 128-bit big-endian)
  const iv = Buffer.alloc(16, 0);
  sessionSalt.copy(iv, 2); // iv[2..15] = sessionSalt[0..13]

  // XOR SSRC at bytes 4..7 (SSRC * 2^64 shifted to bits 95..64)
  iv[4] ^= (ssrc >>> 24) & 0xff;
  iv[5] ^= (ssrc >>> 16) & 0xff;
  iv[6] ^= (ssrc >>> 8)  & 0xff;
  iv[7] ^= ssrc          & 0xff;

  // XOR packet index (48 bits) at bytes 10..15 (i * 2^16 shifted to bits 63..16)
  const hi = Number(packetIndex >> 32n) & 0xffff; // top 16 bits of 48-bit index
  const lo = Number(packetIndex & 0xffffffffn);    // bottom 32 bits
  iv[10] ^= (hi >> 8)  & 0xff;
  iv[11] ^= hi         & 0xff;
  iv[12] ^= (lo >>> 24) & 0xff;
  iv[13] ^= (lo >>> 16) & 0xff;
  iv[14] ^= (lo >>> 8)  & 0xff;
  iv[15] ^= lo          & 0xff;

  return iv;
}

/** Sequence number range threshold for RFC 3711 §3.3.1 packet index estimation. */
const SEQ_WRAP_THRESHOLD = 32768;

/** SRTP context for one direction of a media stream. */
export class SrtpContext {
  private readonly encKey: Buffer;  // 16-byte session encryption key
  private readonly authKey: Buffer; // 20-byte session authentication key (HMAC-SHA1)
  private readonly saltKey: Buffer; // 14-byte session salt

  // Per-direction packet index tracking (ROC + SEQ → 48-bit packet index)
  private roc = 0;
  private lastSeq = -1;

  // RFC 3711 §3.3.2 64-packet replay window for decryption
  private replayMaxIndex = -1n;
  private replayWindow = 0n; // bitmask of received packets relative to replayMaxIndex

  /**
   * Create an SRTP context for a single direction.
   *
   * @param masterKey  16-byte AES-128 master key (from the a=crypto: inline value)
   * @param masterSalt 14-byte master salt (from the a=crypto: inline value)
   */
  constructor(masterKey: Buffer, masterSalt: Buffer) {
    this.encKey  = deriveKey(masterKey, masterSalt, LABEL_ENC,  16);
    this.authKey = deriveKey(masterKey, masterSalt, LABEL_AUTH, 20);
    this.saltKey = deriveKey(masterKey, masterSalt, LABEL_SALT, 14);
  }

  /**
   * Encrypt a plain RTP packet into an SRTP packet.
   *
   * The input buffer must contain a valid 12-byte RTP header followed by the payload.
   * Returns a new Buffer: RTP header + encrypted payload + 10-byte HMAC-SHA1-80 auth tag.
   */
  encrypt(rtpPacket: Buffer): Buffer {
    if (rtpPacket.length < 12) throw new Error('SRTP encrypt: RTP packet too short');

    const ssrc = rtpPacket.readUInt32BE(8);
    const seq  = rtpPacket.readUInt16BE(2);
    const packetIndex = this.getOutboundPacketIndex(seq);

    const headerLen = this.rtpHeaderLength(rtpPacket);
    const header  = rtpPacket.subarray(0, headerLen);
    const payload = rtpPacket.subarray(headerLen);

    // AES-128-CTR encryption of the payload
    const iv = computeIV(this.saltKey, ssrc, packetIndex);
    const cipher = createCipheriv('aes-128-ctr', this.encKey, iv);
    const encryptedPayload = cipher.update(payload);

    const encPacket = Buffer.concat([header, encryptedPayload]);

    // HMAC-SHA1-80: authenticate (header + encrypted_payload + ROC)
    const rocBuf = Buffer.alloc(4);
    rocBuf.writeUInt32BE(this.roc, 0);
    const hmac = createHmac('sha1', this.authKey);
    hmac.update(encPacket);
    hmac.update(rocBuf);
    const tag = hmac.digest().subarray(0, 10); // 80-bit tag

    return Buffer.concat([encPacket, tag]);
  }

  /**
   * Decrypt an SRTP packet into a plain RTP packet.
   *
   * The input buffer must be a valid SRTP packet: RTP header + encrypted payload + 10-byte auth tag.
   * Returns a new Buffer: RTP header + decrypted payload (auth tag stripped).
   * Throws on authentication failure or malformed input.
   */
  /**
   * Estimate candidate packet index and candidate ROC WITHOUT mutating any
   * persistent state (RFC 3711 §3.3.1).
   */
  private estimateIndex(seq: number): { index: bigint; candidateRoc: number; advancesLastSeq: boolean } {
    if (this.lastSeq < 0) {
      return { index: BigInt(this.roc) * 65536n + BigInt(seq), candidateRoc: this.roc, advancesLastSeq: true };
    }
    const diff = seq - this.lastSeq;
    if (diff < -SEQ_WRAP_THRESHOLD) {
      // Forward sequence wrap (65535 -> 0): candidate ROC is current + 1
      const candRoc = this.roc + 1;
      return { index: BigInt(candRoc) * 65536n + BigInt(seq), candidateRoc: candRoc, advancesLastSeq: true };
    }
    if (diff > SEQ_WRAP_THRESHOLD) {
      // Late / reordered packet from before the previous wrap: candidate ROC - 1
      const candRoc = Math.max(0, this.roc - 1);
      return { index: BigInt(candRoc) * 65536n + BigInt(seq), candidateRoc: candRoc, advancesLastSeq: false };
    }
    // Normal sequential packet
    return { index: BigInt(this.roc) * 65536n + BigInt(seq), candidateRoc: this.roc, advancesLastSeq: true };
  }

  /**
   * Commit verified receiver state (ROC, lastSeq) only AFTER HMAC verification
   * has succeeded (RFC 3711 §3.3.1). Never called on unauthenticated input.
   */
  private commitVerifiedIndex(seq: number, candidateRoc: number, advancesLastSeq: boolean): void {
    if (this.lastSeq < 0 || advancesLastSeq) {
      this.lastSeq = seq;
      this.roc = candidateRoc;
    }
  }

  /**
   * Compute the 48-bit SRTP packet index for an OUTBOUND packet. Sender side is
   * authoritative, so state advances immediately.
   */
  private getOutboundPacketIndex(seq: number): bigint {
    const est = this.estimateIndex(seq);
    this.commitVerifiedIndex(seq, est.candidateRoc, est.advancesLastSeq);
    return est.index;
  }

  /**
   * Decrypt an SRTP packet into a plain RTP packet.
   *
   * The input must be a valid SRTP packet: RTP header + encrypted payload +
   * 10-byte auth tag. Returns new Buffer: RTP header + decrypted payload.
   * Throws on authentication failure or malformed input.
   *
   * Internal state (ROC, lastSeq, replay window) is committed ONLY after HMAC
   * verification and the replay check pass. A tampered packet therefore cannot
   * advance the rollover counter and desynchronise the receiver (DoS).
   */
  decrypt(srtpPacket: Buffer): Buffer {
    if (srtpPacket.length < 12 + 10) throw new Error('SRTP decrypt: packet too short');

    const tagStart = srtpPacket.length - 10;
    const encPacket = srtpPacket.subarray(0, tagStart);
    const receivedTag = srtpPacket.subarray(tagStart);

    const ssrc = encPacket.readUInt32BE(8);
    const seq  = encPacket.readUInt16BE(2);

    // 1. Estimate candidate index without touching persistent ROC / lastSeq
    const estimate = this.estimateIndex(seq);

    // 2. Verify HMAC-SHA1-80 against the candidate ROC
    const rocBuf = Buffer.alloc(4);
    rocBuf.writeUInt32BE(estimate.candidateRoc, 0);
    const hmac = createHmac('sha1', this.authKey);
    hmac.update(encPacket);
    hmac.update(rocBuf);
    const expectedTag = hmac.digest().subarray(0, 10);
    if (!expectedTag.equals(receivedTag)) {
      throw new Error('SRTP decrypt: authentication tag mismatch');
    }

    // 3. RFC 3711 §3.3.2 anti-replay (64-packet sliding window)
    if (!this.checkAndUpdateReplay(estimate.index)) {
      throw new Error('SRTP decrypt: replayed packet dropped');
    }

    // 4. Commit receiver state only after authentication + replay acceptance
    this.commitVerifiedIndex(seq, estimate.candidateRoc, estimate.advancesLastSeq);

    const headerLen = this.rtpHeaderLength(encPacket);
    const header    = encPacket.subarray(0, headerLen);
    const encPayload = encPacket.subarray(headerLen);

    // AES-128-CTR decryption (CTR mode is symmetric)
    const iv = computeIV(this.saltKey, ssrc, estimate.index);
    const decipher = createCipheriv('aes-128-ctr', this.encKey, iv);
    const decPayload = decipher.update(encPayload);

    return Buffer.concat([header, decPayload]);
  }
  private rtpHeaderLength(pkt: Buffer): number {
    const csrcCount = pkt[0] & 0x0f;
    const hasExt    = (pkt[0] & 0x10) !== 0;
    let len = 12 + csrcCount * 4;
    if (hasExt && pkt.length >= len + 4) {
      len += 4 + pkt.readUInt16BE(len + 2) * 4;
    }
    return len;
  }

  /**
   * RFC 3711 §3.3.2 anti-replay check and window advance for decryption.
   * Returns true when the packet index is accepted, false for a duplicate or
   * a packet older than the 64-packet window (replay or stale delivery).
   */
  private checkAndUpdateReplay(index: bigint): boolean {
    if (this.replayMaxIndex < 0n) {
      this.replayMaxIndex = index;
      this.replayWindow = 1n;
      return true;
    }

    const diff = index - this.replayMaxIndex;
    if (diff > 0n) {
      // Packet is newer than the current max index: advance the window.
      this.replayWindow = diff >= 64n ? 1n : (this.replayWindow << diff) | 1n;
      this.replayMaxIndex = index;
      return true;
    }

    const behind = -diff;
    if (behind >= 64n) return false; // older than the 64-packet window

    const mask = 1n << behind;
    if ((this.replayWindow & mask) !== 0n) return false; // already seen

    this.replayWindow |= mask;
    return true;
  }
}
