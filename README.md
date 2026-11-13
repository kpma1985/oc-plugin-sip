# @1337.so/oc-plugin-sip

SIP telephony channel for OpenClaw. Bring your own SIP trunk — no Twilio account
required.

```
SIP trunk → SIP UAS + RTP → Media WebSocket → CallSession → STT → agent → TTS
```

## Install

```bash
openclaw plugins install clawhub:@1337.so/oc-plugin-sip
```

Or from GitHub:

```bash
openclaw plugins install github:kpma1985/oc-plugin-sip
```

## System requirements

| Requirement | When needed |
|---|---|
| Node ≥ 24 | always |
| `libspandsp2` (runtime) | `audio.mode: "best"` (G.722) |
| `build-essential` + `libspandsp-dev` | building from source |

Without `libspandsp`, the plugin works fine with `audio.mode: "twilio"` (mu-law 8 kHz).

## Configuration

```json
{
  "enabled": true,
  "transport": "embedded",
  "sip": {
    "user": "your-sip-user",
    "password": "…",
    "registrar": "sipconnect.sipgate.de",
    "publicIp": "203.0.113.10"
  },
  "inbound": {
    "policy": "allowlist",
    "allowFrom": ["+49301234567"]
  },
  "voice": { "enabled": true },
  "stt": {
    "apiKey": "…",
    "model": "nova-3",
    "language": "de"
  },
  "tts": {
    "provider": "deepgram",
    "apiKey": "…",
    "model": "aura-2-viktoria-de"
  }
}
```

**`transport`** — `"embedded"` (plugin owns SIP + RTP) or `"bridge"` (external
Twilio Media Streams gateway connects to the plugin's WebSocket).

**`sip.publicIp`** — required when behind NAT with `transport: "embedded"`.

**`media.authToken`** — shared secret for the media WebSocket (Bearer header or
`?token=` query). Required when `media.host` is not loopback.

Credentials support OpenClaw Store references:

```json
{ "source": "store", "provider": "default", "id": "SIP_PASSWORD" }
```

### PIN gate (DTMF)

Optional keypad PIN before the agent answers:

```json
{
  "inbound": {
    "pin": {
      "enabled": true,
      "code": "1234",
      "promptText": "Enter your PIN followed by #.",
      "maxAttempts": 3,
      "timeoutMs": 20000
    }
  }
}
```

### TTS providers

| Provider | `tts.provider` |
|---|---|
| Deepgram Aura | `"deepgram"` |
| ElevenLabs (via Deepgram Voice Agent) | `"elevenlabs"` |
| OpenAI-compatible PCM | `"custom"` |

Custom requires confirmed mono PCM16-LE at 24000 Hz.

### Audio mode

| `audio.mode` | Codec | Notes |
|---|---|---|
| `"twilio"` | PCMU 8 kHz | default, no native deps |
| `"best"` | G.722 → PCMA/PCMU | requires `libspandsp` |

## Status

| Component | State |
|---|---|
| Media WebSocket, codec, DTMF | ✅ tested |
| Embedded SIP UAS + RTP | ✅ local tests (no live trunk tested) |
| STT/TTS bridge | ✅ local tests (no live API tested) |
| OpenClaw SDK channel | ✅ registered; no live host call tested |
| SRTP anti-replay (RFC 3711) | ✅ |
| Guided setup wizard | ✅ |

## Source

<https://github.com/kpma1985/oc-plugin-sip>

### Signaling and media security limits

The embedded UDP SIP listener filters peers to the resolved registrar IP (or
explicit vendor `SIP_TRUSTED_PEERS`); loopback is not implicitly trusted. Responses
are bound to the registrar endpoint and an outstanding transaction. Inbound
retransmissions, ACK/BYE and CANCEL are additionally matched to their original
peer, dialog tags and transaction/CSeq as applicable. **IP filtering and SIP
identifiers are not cryptographic authentication**: a network attacker able to
spoof or observe UDP traffic remains a threat. Restrict listener access to your
carrier or use a protected signaling network. Native SIP TLS is not implemented.
SDES keys travel in signaling; SRTP alone does not protect those keys.

Media encryption policies:
- `sip.srtp: false` (default): plain RTP only; SAVP offers are rejected.
- `sip.srtp: true`: opportunistic SRTP; valid SAVP offers use installed crypto
  contexts, but AVP offers still use plaintext.
- `sip.srtpRequired: true`: require valid SAVP/SDES on inbound calls, regardless of
  the legacy `srtp` toggle; plain RTP is rejected. Only AES_128_CM_HMAC_SHA1_80 with
  an exact 30-byte key/salt and no lifetime, MKI or session parameters is supported.

The outbound B2BUA leg remains RTP-only and rejects SAVP answers; inbound required
mode is **not** an end-to-end encrypted forwarding guarantee. SRTP now uses the
RFC 3711 KDF/IV layout (checked against Appendix B vectors), which corrects the
previous non-interoperable layout. Live-carrier interoperability is not covered
by the automated local tests. Plain RTP source locking remains a source filter,
not media authentication; SRTP authenticates packets before learning their port.

Pending inbound setup has a 64-entry cap and a 30-second transaction lifetime.
Expired setup cannot establish a call when asynchronous allocation completes.
WebSocket media drains retain at most 5,000 items and 800,000 bytes; marks count
against both bounds and names are limited to 256 UTF-8 bytes. On overload, oldest
items (including marks) are discarded rather than falsely acknowledged as played.
WebSocket inbound messages are capped at 1 MiB. PIN timeout/attempt exhaustion is
terminal immediately, including the announcement-before-hangup window.
