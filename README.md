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
