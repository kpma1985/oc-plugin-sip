# Vendored upstream: sipgate-sip-stream-bridge (node implementation)

`vendor/sip-bridge/src` is copied from `node/src`, with local deviations listed below, from
https://github.com/sipgate/sipgate-sip-stream-bridge (MIT, Copyright (c) 2026
sipgate GmbH & Co. KG — see `LICENSE`).

## Why it is vendored

The upstream package is `private: true` and cannot be installed from npm. The
code provides the parts we do not want to rewrite: SIP UAS/registration,
SDP and digest auth, RTP handling, SRTP (SDES), the Twilio Media Streams
WebSocket client, TwiML parsing and the REST control plane.

## Refresh

```bash
git clone --depth 1 --filter=blob:none --sparse https://github.com/sipgate/sipgate-sip-stream-bridge.git /tmp/upstream
cd /tmp/upstream && git sparse-checkout set node
rm -rf vendor/sip-bridge/src && cp -r /tmp/upstream/node/src vendor/sip-bridge/src
cp /tmp/upstream/LICENSE vendor/sip-bridge/LICENSE
npm run typecheck:vendor && npm test
```

Keep the upstream `LICENSE` and this notice when copying; do not relicense the
vendored files.

## Local deviations

- `src/webhook/voiceFetch.ts`: the upstream `@ts-expect-error` above
  `dispatcher: undefined` is unused with our `@types/node` (TS2578), so it is
  replaced by a plain comment. Behaviour is unchanged; the whole vendored tree
  still typechecks under `npm run typecheck:vendor`.
- `src/sip/userAgent.ts`: optional fourth `AbortSignal` argument supports the
  plugin's startup deadline. DNS uses a cancellable resolver. Abort and initial
  socket/auth/registration rejection clear timers and close UDP; stop is
  idempotent. Provisional REGISTER responses do not reject startup. Unregister
  resolves only after its UDP send callback and rejects send errors. Existing
  three-argument callers stay compatible. No registration deadline is imposed
  on upstream callers; the plugin owns its 15-second timer.
- `src/bridge/callManager.ts`: per-call logger derives from injected `this.log`
  rather than global `rootLogger`, preserving secret masking for RTP/WS logs.
- `src/bridge/callManager.ts`: G.722 idle and reconnect RTP packets use a
  per-call SpanDSP encoder fed 20 ms of 16-kHz PCM silence. Upstream's 160
  zero bytes decode as loud audio under G.722. PCMA/PCMU keep their original
  constant-byte silence behavior; the encoder state survives reconnect.- `src/rtp/rtpHandler.ts`: `sendAudio` is a no-op after `dispose()`. Upstream
  throws `ERR_SOCKET_DGRAM_NOT_RUNNING` when the WS outbound drain timer fires
  after call teardown; in-process that uncaught throw kills the gateway.
Reapply these deviations after refresh. Plugin transport logic remains in
`src/embedded/`; neither `vendor/src/index.ts` nor the env-loading config module
is imported at runtime. TypeScript project references generate declarations
using upstream strict settings without enabling plugin-only indexed checks.
