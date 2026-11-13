# @1337.so/oc-plugin-sip

Independent SIP telephony channel plugin for OpenClaw. Own SIP trunk, no
Twilio account, no LiveKit, no dependency on the `voice-call` plugin.

```
SIP trunk (sipgate, …)                                            OpenClaw
        │                                                             │
        ▼                                                             │
  SIP UAS + RTP            Twilio Media Streams WS            CallSession
  (vendored, embedded) ──────────────────────────────▶  ──▶  STT → agent turn
  or external gateway     8 kHz mu-law, mark/clear/dtMF       TTS → back
```

The agent side never speaks SIP: it sees call sessions with 20 ms mu-law
frames. Which gateway produced them is a config switch (`transport`).

## Status

| Part | State |
| --- | --- |
| G.711 mu-law codec + Twilio Media Streams frame codec | implemented, unit-tested |
| Media WebSocket server, call registry, 20 ms audio pacing, barge-in (`clear`), `mark`, DTMF | implemented, integration-tested |
| Config schema (zod + plugin manifest) | implemented |
| Echo mode (no STT/LLM/TTS) for trunk bring-up | implemented |
| SIP UAS/RTP wiring (`transport: "embedded"`) | implemented via loopback WS; mapping/lifecycle/UDP cleanup tested locally; no live trunk call tested |
| STT/TTS bridge | implemented; local fake WS/HTTP tests, no paid API or real voice call tested |
| OpenClaw channel adapter (SDK entry) | implemented against 2026.9.9; fake host and real SDK registration tests; embedded only, no live host turn/call tested |

## Transports

- `transport: "bridge"` (recommended first bring-up): an external
  Twilio-Media-Streams gateway attaches to the plugin's WebSocket. Works with
  [sipgate-sip-stream-bridge](https://github.com/sipgate/sipgate-sip-stream-bridge)
  and with any carrier that speaks the same protocol.
- `transport: "embedded"`: the plugin registers the SIP trunk itself and owns
  RTP, using the vendored upstream code in `vendor/sip-bridge` (see
  `vendor/sip-bridge/UPSTREAM.md`).

Same wire format either way, so switching transports never touches the agent
side.

## Installation

### Via ClawHub (recommended)

```bash
openclaw plugins install clawhub:@1337.so/oc-plugin-sip
```

### From GitHub or local build

```bash
# Direct from GitHub
openclaw plugins install github:kpma1985/oc-plugin-sip

# Or build locally
npm install
npm run build
npm pack
openclaw plugins install ./1337.so-oc-plugin-sip-0.1.0.tgz
```
## System requirements

| Requirement | Needed for | Install |
|-------------|-----------|---------|
| Node >= 24 | always | — |
| `libspandsp` (runtime) | G.722 / `audio.mode: "best"` | Debian/Ubuntu: `apt-get install libspandsp2t64` |
| C toolchain + `libspandsp-dev` | building `g722-spandsp` from source | Debian/Ubuntu: `apt-get install build-essential libspandsp-dev` |

Without `libspandsp` the plugin still installs, but loading `g722-spandsp` fails at
runtime. Use `audio.mode: "twilio"` (PCMU/mu-law 8 kHz) and skip G.722 if you
cannot install the system library.

## Configuration

Validated with zod (`src/config.ts`), mirrored by `openclaw.plugin.json`:

```json
{
  "enabled": true,
  "transport": "bridge",
  "media": { "host": "127.0.0.1", "port": 8080, "path": "/sip/media" },
  "audio": { "mode": "twilio" },
  "inbound": { "policy": "allowlist", "allowFrom": ["+4915100000000"], "maxConcurrent": 2 },
  "sip": { "user": "…", "password": "…", "registrar": "sipconnect.sipgate.de", "publicIp": "203.0.113.10" }
}
```

- `audio.mode: "twilio"` = PCMU/mu-law 8 kHz (matches the wire format 1:1).
  `"best"` negotiates G.722 (16 kHz) before PCMA/PCMU (8 kHz). The channel
  converts negotiated audio to PCM for Deepgram STT and encodes TTS back to
  the RTP codec. G.722 requires `g722-spandsp` and system SpanDSP at runtime.
- OpenClaw TTS waits for playback capacity instead of overflowing the outbound
  queue. `voice.maxOutboundBytes` bounds queued audio, not the whole response.
  Each TTS request is limited to 120 seconds of source audio; `tts.timeoutMs`
  also covers time spent waiting for playback capacity. Cancellation and hangup
  stop pending producers. The Deepgram Voice Agent WebSocket path retains its
  existing queue-overflow policy.
- `sip.publicIp` is mandatory for `transport: "embedded"` behind NAT —
  without it the SDP advertises a private address and no RTP arrives.
- `sip.listenAddr` must be IPv4:port (1..65535); `sip.publicIp` must be IPv4.
- RTP bounds: min 1024..65534, max 1025..65535, max strictly greater than min.
- Runtime credentials must be resolved non-empty strings. SIP username/password
  support `{ "source": "store", "provider": "default", "id": "SIP_ACCOUNT01_USER" }`
  references through the OpenClaw SDK before channel startup; unresolved Store
  credentials fail closed. Other unresolved SecretRef objects remain rejected.
  Sensitive UI hints mask SIP password and STT/TTS API keys; masking
  does not encrypt storage or implement secret resolution. Never commit credentials.
- Embedded binds media first and uses its actual address for loopback WS.
  Wildcard hosts `0.0.0.0`/`::` map to `127.0.0.1`/`::1`.
- Registration startup deadline: 15 seconds, including cancellable DNS.
  Abort/rejection closes UDP and timers. No vendor env loader is used.
- `await handle.stop()` is idempotent: terminate calls, send unregister, stop
  SIP, close media sockets. Every step runs even after earlier failures;
  failures are aggregated. Unregister waits for UDP send, not registrar ACK.
- SDK entry `src/plugin.ts` registers channel, discovery RPC and lifecycle service
  synchronously. Disabled service never binds media or registers trunk. SDK channel
  requires `transport: "embedded"`; bridge lacks verified SIP hangup control.
- SDK inbound admission validates E.164, fails closed without caller, enforces
  exact allowlist and counts accepted calls only. Rejected calls receive real TTS;
  hangup follows gateway mark ACK. TTS failure or missing ACK ends call on deadline.
- Voice defaults off. SDK channel rejects calls when voice is disabled and logs
  explicit audible-rejection limitation. No silence placeholder remains.
- SDK-independent `startSipPlugin()` remains explicit low-level media/echo starter;
  it does not enforce `enabled` or allowlist unless caller supplies admission hooks.
- Unknown config keys now fail consistently at every object level (previous
  runtime zod schema stripped them; manifest already disallowed them).

### Keypad PIN gate (DTMF)

To protect the phone agent and its tools from unauthorized callers, an optional
DTMF keypad PIN gate runs before speech recognition and the agent greeting:

```json
{
  "inbound": {
    "pin": {
      "enabled": true,
      "code": "1234",
      "promptText": "Please enter your PIN, followed by the pound key.",
      "failureText": "Incorrect PIN. Please try again.",
      "successText": "",
      "lockoutText": "Too many failed attempts. Goodbye.",
      "maxAttempts": 3,
      "maxDigits": 8,
      "timeoutMs": 20000
    }
  }
}
```

- Inbound audio is silenced until the PIN is verified.
- Digits arrive as RFC 4733 telephone events. `#` submits, `*` clears.
- After `maxAttempts` failed attempts or `timeoutMs` without input, the call hangs up.

### Provider presets and model settings

Built-in defaults apply only to omitted fields:

| Provider | Base URL | Model |
| --- | --- | --- |
| Deepgram STT | `wss://api.deepgram.com` | `nova-3` |
| Deepgram TTS | `https://api.deepgram.com` | `aura-2-viktoria-de` |
| ElevenLabs TTS | `https://api.elevenlabs.io` | `eleven_multilingual_v2` |
| Custom TTS (OpenAI-compatible PCM) | explicit HTTPS base URL | explicit deployment model |

Optional `providerPresets.stt.deepgram` and
`providerPresets.tts.{deepgram,elevenlabs,custom}` accept `baseUrl` and `model`.
Merge order: built-ins, configured provider preset, explicit `stt`/`tts` fields.
Channel preset leaves override legacy preset leaves without erasing siblings.
Presets contain no credentials; API keys stay in `stt.apiKey` / `tts.apiKey`.
Switching provider selects its defaults only for omitted fields; existing explicit
model/URL values are preserved, never silently reset. Remove explicit fields to
return to preset defaults.

Example: `providerPresets: { tts: { custom: { model: 'my-speech-deployment', baseUrl: 'https://speech.example' } } }`
with `tts.provider: 'custom'`. Custom model/deployment IDs remain valid for all
providers. STT requires WSS, TTS HTTPS. URLs are base URLs; runtime appends
`/v1/listen`, `/v1/speak`, `/v1/text-to-speech/{voice}/stream`, or
`/v1/audio/speech`. One trailing slash is normalized.

Verified SDK 2026.9.9 UI hints support labels, help, placeholders, sensitive and
advanced fields, but no editable model dropdown/suggestion hook. Provider enums
render dropdowns. Model fields remain free text, with JSON Schema `examples` and
visible suggestion/help text; no restrictive model `enum` or unsupported UI hints.
This change does not deploy or verify live UI/provider connectivity.

### OpenClaw channel settings UI and migration

`channelConfigs.sip` in the manifest and SDK `plugin.configSchema` expose real
settings under **Channels / SIP Telephony** (`channels.sip`). Verified against
local OpenClaw 2026.9.9 schema builder: channel schemas attach to `channels.<id>`;
there is no supported schema-path redirect to plugin config. Plugin settings
remain available under `plugins.entries.sip.config` for backwards compatibility.
Both service startup and channel account resolution use the same resolver.

Precedence: explicit `channels.sip` leaves override legacy plugin leaves. Nested
sections merge once, arrays replace (including empty arrays), then runtime defaults
apply. Absent channel or old `{}` placeholder leaves legacy behaviour unchanged.
Invalid channel values fail rather than silently reverting. SDK runtime validation
preserves sparse input; defaults must not override legacy fields during validation.
Service reload watches both paths. Plugin loading still requires
`plugins.entries.sip.enabled: true`; channel `enabled` controls SIP service only.

Deployment (not performed by this change):

1. Package bundle and manifest together with `npm pack`, then install the
  tarball using `openclaw plugins install` as described above. Installation
  changes the host's plugin state; it is not a dry run. Keep existing gateway
  config and securely back it up without printing credentials.
2. Before first Channels UI edit, move complete existing
   `plugins.entries.sip.config` object to `channels.sip` in managed configuration.
   Keep plugin entry `enabled: true` and its installation/load metadata. Remove
   old `config` only after verifying the moved object; no secret values need to
   be retyped or logged. Prefer one atomic managed config change. Existing live
   plugin config requires no migration merely to run updated code.
3. Restart gateway through existing service procedure to refresh manifest/schema
   caches; reload browser. Verify SIP fields in Channels and use Save/Apply.
   Confirm saved values reside in `channels.sip`, SIP service restarts as expected,
   and trunk/call smoke test succeeds. No live UI/trunk test performed locally.

Migrate before editing because UI may save displayed defaults as explicit values.
Partial channel overlays remain supported, but deleting an overridden leaf restores
legacy value until legacy config is removed. Do not migrate unresolved SecretRef
objects without verifying host resolution at the new path; this plugin adds no
secret resolver. Sensitive hints exist at both config paths.

### Guided SIP channel setup

SDK 2026.9.9 distinguishes config forms from onboarding: `configSchema` and
manifest `channelConfigs.sip` do not implement **Guided channel setup**.
`src/setup.ts` now supplies `plugin.setupWizard` and the preferred channel-owned
`plugin.setupContract`, wired through the real SDK channel factory. Public
`openclaw/plugin-sdk/channel-setup` exports `ChannelSetupWizard` and
`defineChannelSetupContract`; installed `docs/plugins/sdk-setup.md` describes both.
Required declarative wizard fields are `channel`, `status` (labels and
`resolveConfigured`) and `credentials`. Contract adapter requires
`applyAccountConfig`; this implementation also resolves/rejects account IDs and
validates effective config. No unsupported UI hints or custom gateway wizard RPC.

Only account `default` is supported. Wizard asks for operator-supplied SIP user,
domain, registrar, public IPv4, password and E.164 caller allowlist. Existing open
inbound policy stays open; existing allowlist can be kept. Voice activation is an
explicit choice; enabled voice asks for TTS provider and missing STT/TTS credentials,
plus model/voice for ElevenLabs or Custom. Custom requires explicit confirmation
of mono PCM16-LE at 24000 Hz. Existing model, endpoint, media, caller numbering,
greeting, agent and other settings remain untouched. Explicit bridge transport
requires confirmation before switching to embedded. Voice off keeps channel unable
to answer agent calls, as before; it is not a completed voice-connectivity test.

Each step patches only changed leaves under `channels.sip`; legacy plugin config
is not migrated or rewritten. Keep-credential prompts retain existing raw strings,
environment placeholders and SecretRef objects server-side, without sending their
values to client. New credential steps use SDK secret-input handling, including
its reference mode. SIP Store references are resolved before channel startup;
other secret types still require host materialization. Final validation enables channel only
after required config is present. Cancellation throws without modifying input config;
host owns final persistence. No trunk/provider network calls during setup.
Non-interactive contract can validate and enable existing settings; it deliberately
publishes no CLI credential flags. Repository README URL replaces nonexistent
`/channels/sip` official documentation link in runtime and package catalog metadata.

Tests cover actual SDK setup-only registration and declarative step callbacks,
fresh inputs, legacy/channel preservation, opaque references, cancellation,
default-account restriction and invalid inputs. Browser wizard and live trunk
connectivity remain untested. No deployment performed.

## Voice bridge (goal 2)

```ts
const handle = await startSipPlugin({
  transport: 'bridge',
  voice: { enabled: true, maxInboundBytes: 32000, maxOutboundBytes: 64000 },
  stt: {
    apiKey: process.env.DEEPGRAM_API_KEY,
    model: 'nova-3', language: 'de', keyterms: ['Telefon'],
    endpointing: 300, utteranceEndMs: 1000,
    connectionTimeoutMs: 10000, maxBufferedBytes: 32000,
  },
  tts: { provider: 'deepgram', apiKey: process.env.DEEPGRAM_API_KEY,
    model: 'aura-2-viktoria-de', timeoutMs: 30000 },
  inbound: { greeting: 'Willkommen. Wie kann ich helfen?' },
}, {
  // SDK-independent: caller supplies agent implementation and obeys signal.
  onUtterance: async (text, signal, session) => agent.answer(text, signal, session),
  onMark: (session, name) => recordPlayout(session.streamSid, name),
  onEnd: (streamSid, reason) => releaseAgentSession(streamSid, reason),
});
```

`agent`, `recordPlayout`, and `releaseAgentSession` above are application-provided,
not plugin exports. Do not combine echo audio hook with voice playback.

Deepgram listen uses mono raw mu-law 8000 Hz, interim results, VAD, configurable
endpointing and utterance end. Final segments accumulate; duplicate final ranges
and redundant end events do not create extra turns. Interim speech or
`SpeechStarted` aborts agent/TTS, clears audio and pending marks; generation gates
prevent late agent answers from playing. Hooks receive transcripts explicitly;
logs never contain transcripts, remote error bodies or credentials.

Aura HTTP requests use `encoding=mulaw&sample_rate=8000&container=none`. Response
chunks preserve 160-byte framing, final frame pads with silence, playback paces
at 20 ms and each sentence queues an ordered mark. Marks forwarded back from
bridge measure actual playout; local queue completion alone does not.

Optional `voice.playbackPrebufferMs` (default `0`, range `0..2000`, multiples of
20) delays streaming playback until that much full-frame audio is queued.
For example, `100` absorbs a simulated initial 100 ms chunk gap after a first
20 ms chunk; this is a local reproduction, not a measured provider/network gap.
After the pump observes an empty queue it buffers again. Threshold is capped at
outbound queue capacity; sentence marks flush short responses and partial frames.
Complete `sendAudio()` clips bypass prebuffer (echo behaviour unchanged).
Barge-in/end discard buffered audio. This adds startup/rebuffer latency, cannot
fix sustained slower-than-realtime production, and does not prefetch subsequent
sentence requests. Default remains off until actual chunk timing warrants tuning.

ElevenLabs is available only through Deepgram Voice Agent (`voice.engine:
"deepgram-agent"`). Native ElevenLabs HTTP TTS is disabled; configurations using
ElevenLabs with the OpenClaw engine are rejected rather than silently migrated.
Set the agent prompt and think model as described in the Voice Agent section.

```ts
tts: {
  provider: 'elevenlabs', apiKey: process.env.ELEVENLABS_API_KEY,
  voice: process.env.ELEVENLABS_VOICE_ID,
  model: 'eleven_turbo_v2_5', baseUrl: 'https://api.elevenlabs.io',
  timeoutMs: 30000,
}
```

`voice` is required when voice is enabled; no default voice. `model`, `baseUrl`,
API key and timeout are configurable. Omitted model defaults to
`eleven_multilingual_v2` for ElevenLabs and `aura-2-viktoria-de` for Deepgram;
Custom requires an explicit or preset deployment model and HTTPS base URL when voice is enabled.
The Settings message uses `agent.speak.provider.type: "eleven_labs"`, `model_id`
and a BYO endpoint with `xi-api-key`. Streaming models use the WSS
`/v1/text-to-speech/{voice_id}/multi-stream-input` endpoint; `eleven_v3` uses
HTTPS `/v1/text-to-speech/{voice_id}`. Deepgram receives the ElevenLabs credential
and handles synthesis; the plugin receives negotiated audio from Deepgram.
See [Deepgram TTS models](https://developers.deepgram.com/docs/voice-agent-tts-models).

Optional OpenAI-compatible Custom config replaces `tts` above:

```ts
tts: {
  provider: 'custom', apiKey: process.env.TTS_API_KEY,
  baseUrl: 'https://speech.example', model: 'my-deployment', voice: 'alloy',
  sourceSampleRate: 24000, timeoutMs: 30000,
}
```

Only explicitly confirmed OpenAI-compatible mono PCM16-LE at 24000 Hz supported.
PCM groups of three average to 8000 Hz before mu-law encoding (basic box filter,
not studio-quality resampling). Custom endpoints may route other providers; operator must
verify upstream format/rate. No generic unknown-rate PCM accepted. `baseUrl` is
origin/API prefix; plugin appends provider endpoint path. Runtime config
requires HTTPS; private fake endpoints enter only through trusted test injection.
TLS verification remains enabled; redirects rejected.

Per-call caps: preconnect audio (`maxInboundBytes`), STT socket buffered bytes
(`maxBufferedBytes`), outbound audio/marks (`maxOutboundBytes`, including partial
frames), and TTS response total (mu-law cap; PCM six times cap). Overflow fails
closed rather than storing unlimited audio. Gateway send buffer additionally
caps at 256 KiB. Large/fast TTS responses may abort playback when queues fill;
no unbounded waiting queue or retry. Session end/server stop clears STT timers,
terminates sockets, aborts agent/TTS and drops queues. STT failures end call;
TTS failures clear playback and emit generic `voice-error` only. No agent deadline
provided: application hook must obey cancellation and supply its own deadline.

Protocol references:
- [Deepgram live listen](https://developers.deepgram.com/reference/speech-to-text/listen-streaming)
- [UtteranceEnd semantics](https://developers.deepgram.com/docs/utterance-end)
- [Aura request](https://developers.deepgram.com/reference/text-to-speech/speak-request)
- [Raw mu-law output combinations](https://developers.deepgram.com/docs/tts-media-output-settings)
- [OpenAI raw PCM format](https://developers.openai.com/api/docs/guides/text-to-speech)

`test/voice.test.ts` uses local WS/HTTP, fake keys and mock agent. No secrets
fetched, paid API invoked or actual phone call proven by these tests.

## Dynamic Deepgram model catalog

Server-side public exports from `src/index.ts`:

```ts
import { discoverDeepgramModels, registerDeepgramModelDiscovery } from './src/index.js';

// config is parsed plugin config with already resolved server-side credentials.
const catalog = await discoverDeepgramModels({
  apiKey: config.stt.apiKey!, language: 'de-DE',
  streamingOnly: true, timeoutMs: 10000, signal: controller.signal,
});
// catalog.stt / catalog.tts: canonicalName and languages; STT also streaming.
// Use canonicalName as stt.model / tts.model, not provider display name.
```

Calls `GET https://api.deepgram.com/v1/models` with `Authorization: Token ...`.
[Provider schema](https://developers.deepgram.com/reference/manage/models/list)
returns latest public models, not project/custom models or an entitlement promise.
Missing/invalid canonical names, languages, STT streaming flags or catalog arrays
reject the response. Only canonical identifiers and validated capabilities leave
this function; provider metadata/error payloads are not returned or logged.
`de-DE` matches exact `de-DE` or base `de`, case-insensitively, not another dialect
such as `de-AT`. `multi` is not silently treated as support for every language.
TTS has no streaming flag in this API; streaming filtering applies only to STT.
Without language, all validated languages are included; `streamingOnly: false`
includes batch-only STT models.

Total request/body deadline defaults to 10 seconds (maximum 60 seconds), response
limit 1 MiB, redirects rejected, TLS enabled, caller `AbortSignal` supported.
Completed catalogs cache for five minutes, maximum 32 credential identities;
process-salted HMAC keys contain no raw credentials. No failed/stale fallback,
no shared inflight cancellation, results copied before return. Trusted test fetch
injection bypasses cache. No credentials fetched automatically; importing module
or starting plugin does not contact Deepgram. Manifest remains static; no generated
offline model enum.

### OpenClaw RPC versus native config UI

Verified locally against **OpenClaw 2026.9.7**, installed at
`/usr/lib/node_modules/openclaw` (`/usr/bin/openclaw`, global npm prefix `/usr`).
SDK supports `api.registerGatewayMethod(name, handler, { scope })`; helper type
was checked against public `OpenClawPluginApi` from `plugin-sdk/core`.
An actual plugin entry can explicitly register:

```ts
// Inside real OpenClaw plugin register(api), not startSipPlugin().
registerDeepgramModelDiscovery(api, () => resolvedConfig.stt.apiKey);
```

Registers `sip.deepgram.models`, scope `operator.read`. Parameters are only
`language?: string` and `streamingOnly?: boolean`; credentials come from server
callback, never RPC parameters. Host in-process cancellation signal is forwarded.
Call same helper with TTS credential instead if a separate server key is intended.
This repo still has no OpenClaw SDK channel entry (goal 3), so registration is
**opt-in**, not automatically active. RPC helper alone does not add a dropdown.

**Native plugin config form has no verified remote-options hook.** Installed
`PluginConfigUiHint` supports labels/help/tags/advanced/sensitive/placeholder and
presentation, not a model-list RPC binding. Form select options derive from JSON
Schema `enum`/`const`; the renderer does not invoke discovery RPC. Current
`stt.model` / `tts.model` therefore remain text inputs. Custom UI/client may invoke
registered RPC and build its own picker; no working native dynamic picker claimed.

Verification sources (installed paths, version-specific):
- `dist/plugin-sdk/core.d.ts`: public plugin API export.
- `dist/agent-harness-runtime-BbN1SctJ.d.ts`: `registerGatewayMethod`,
  `GatewayRequestOptions.signal`, `RespondFn`.
- `dist/types.openclaw-REKjHf5F.d.ts`: `PluginConfigUiHint`.
- `dist/control-ui/assets/config-form-BmcNs1OM.js` and
  `config-form.node.shared-cpUXf7u5.js`: schema-derived select rendering.
- [Gateway SDK docs](https://docs.openclaw.ai/plugins/sdk-runtime/gateway-and-nodes)
  (`docs/plugins/sdk-runtime/gateway-and-nodes.md`).
- [UI hints docs](https://docs.openclaw.ai/plugins/manifest/setup-and-auth#uihints-reference)
  (`docs/plugins/manifest/setup-and-auth.md`).

`test/deepgramModels.test.ts` uses fake fetch only, including malformed responses,
limits, cancellation, timeout, cache isolation/expiry/cap and RPC validation.
No live provider request, paid API or UI end-to-end test performed.

## OpenClaw SDK channel (goal 3)

Package entry is `src/plugin.ts`; `src/index.ts` remains SDK-independent.
SDK types are exact dev dependency `openclaw@2026.9.9`, not vendored declarations
or absolute runtime imports. Host peer requirement is `>=2026.9.9`. Target host
2026.9.9 entry/dispatch signatures were inspected read-only; no remote writes.

`defineChannelPluginEntry` and `createChatChannelPlugin` from
`openclaw/plugin-sdk/core` register direct-call channel. Host service lifecycle
owns asynchronous startup and stop. `sip.deepgram.models` RPC is registered with
`operator.read`, using parsed server-side STT or Deepgram TTS key, never browser key.
No native dynamic config dropdown is provided by this adapter.

Agent turns use host `runtime.channel.routing.resolveAgentRoute`, per-channel-peer
E.164 session keys, `finalizeInboundContext`, and
`dispatchReplyWithBufferedBlockDispatcher`. Host model policy remains intact;
commands and all tools are deliberately disabled for unauthenticated phone ingress
(`CommandAuthorized: false`, `toolsAllow: []`, `disableTools: true`). MCP/message
execution is therefore not supported yet, rather than granting ambient operator
permissions. AbortSignal reaches host dispatch; cancelled/stale replies cannot play.
Voice prompt guidance requests short plain-text answers with numbers spelled out.

Embedded hangup uses existing `CallManager.terminateByCallSid`; closing media alone
is insufficient because upstream reconnects. No new vendor edits for this adapter.
Rejected calls do not create STT sockets or agent turns. Rejection TTS is bounded;
only matching gateway mark ACK triggers normal rejection hangup, with bounded
fallback on TTS failure or missing ACK. Marks prove gateway queue drain, not human
perception. Bridge remains available through low-level starter, not SDK service.

Tests use fake SDK/runtime, local HTTP/WS, and real SDK registration smoke test.
No paid requests, production credentials, real host agent turn, trunk call, deploy,
restart, commit or push performed. Gateway loopback 18789 and nginx ingress 18788
remain unchanged. Development SDK install reported eight npm audit findings;
no forced dependency upgrade applied.
