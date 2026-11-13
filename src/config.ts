/**
 * Plugin configuration, validated with zod. Mirrors openclaw.plugin.json so the
 * manifest and runtime never drift apart.
 */
import { z } from 'zod';
import { isIPv4 } from 'node:net';
import { sttProviderPresets, ttsProviderPresets } from './voice/providerPresets.js';
import { sipConfigForValidation } from './sipSecrets.js';

const httpsUrl = z.url().refine(value => new URL(value).protocol === 'https:', 'must use HTTPS');
const wssUrl = z.url().refine(value => new URL(value).protocol === 'wss:', 'must use WSS');
const preset = (url: typeof httpsUrl) => z.object({
  baseUrl: url.optional(), model: z.string().min(1).optional(),
}).strict().transform(value => ({
  ...(value.baseUrl !== undefined ? { baseUrl: value.baseUrl } : {}),
  ...(value.model !== undefined ? { model: value.model } : {}),
}));

export const sipConfigSchema = z.object({
  providerPresets: z.object({
    stt: z.object({ deepgram: preset(wssUrl).optional() }).strict().prefault({}),
    tts: z.object({
      deepgram: preset(httpsUrl).optional(), elevenlabs: preset(httpsUrl).optional(),
      custom: preset(httpsUrl).optional(),
    }).strict().prefault({}),
  }).strict().prefault({}),
  enabled: z.boolean().default(false),
  transport: z.enum(['embedded', 'bridge']).default('embedded'),
  sip: z
    .object({
      preset: z.enum(['sipgate', 'custom']).default('sipgate'),
      user: z.string().min(1).optional(),
      password: z.string().min(1).optional(),
      domain: z.string().min(1).optional(),
      registrar: z.string().min(1).optional(),
      listenAddr: z.string().refine(
        (value) => {
          const parts = value.split(':');
          const port = Number(parts[1]);
          return parts.length === 2 && isIPv4(parts[0] ?? '') && /^[1-9]\d{0,4}$/.test(parts[1] ?? '') && port >= 1 && port <= 65535;
        },
        'must be IPv4:port (1..65535)'
      ).default('0.0.0.0:5060'),
      publicIp: z.ipv4().optional(),
      srtp: z.boolean().default(false),
      srtpRequired: z.boolean().default(false),
    }).strict().superRefine((sip, context) => {
      if (sip.preset !== 'custom') return;
      for (const field of ['domain', 'registrar'] as const) {
        if (!sip[field]) context.addIssue({ code: 'custom', path: [field], message: `sip.${field} is required for custom preset` });
      }
    }).transform(sip => ({
      ...sip,
      domain: sip.domain ?? 'sipconnect.sipgate.de',
      registrar: sip.registrar ?? 'sipconnect.sipgate.de',
    }))
    .prefault({}),
  media: z
    .object({
      host: z.string().default('127.0.0.1'),
      port: z.number().int().min(1).max(65535).default(8080),
      path: z.string().default('/sip/media'),
      rtpPortMin: z.number().int().min(1024).max(65534).default(10000),
      rtpPortMax: z.number().int().min(1025).max(65535).default(10099),
      authToken: z.string().min(16).max(200).optional(),
    }).strict()
    .prefault({}),
  audio: z.object({ mode: z.enum(['twilio', 'best']).default('twilio') }).strict().prefault({}),
  inbound: z
    .object({
      policy: z.enum(['allowlist', 'open']).default('allowlist'),
      allowFrom: z.array(z.string()).default([]),
      callerCountryCode: z.string().regex(/^[1-9]\d{0,2}$/).optional(),
      callerNationalPrefix: z.string().regex(/^\d{1,4}$/).default('0'),
      greeting: z.string().default(''),
      agentId: z.string().optional(),
      maxConcurrent: z.number().int().min(1).default(2),
      toolsAllow: z.array(z.string().min(1).max(100)).max(100).default([]),
      pin: z
        .object({
          enabled: z.boolean().default(false),
          code: z.string().regex(/^\d{3,12}$/).optional(),
          promptText: z.string().min(1).max(500).default('Please enter your PIN, followed by the pound key.'),
          failureText: z.string().min(1).max(500).default('Incorrect PIN. Please try again.'),
          successText: z.string().min(0).max(500).default(''),
          lockoutText: z.string().min(1).max(500).default('Too many failed attempts. Goodbye.'),
          maxAttempts: z.number().int().min(1).max(10).default(3),
          maxDigits: z.number().int().min(3).max(12).default(8),
          timeoutMs: z.number().int().min(3000).max(120000).default(20000),
        })
        .strict()
        .prefault({}),
    }).strict()
    .prefault({}),
  stt: z.object({
    provider: z.enum(['deepgram']).default('deepgram'),
    apiKey: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    baseUrl: wssUrl.optional(),
    language: z.string().default('de'),
    keyterms: z.array(z.string().min(1).max(100)).max(100).default([]),
    endpointing: z.union([z.literal(false), z.number().int().min(1).max(5000)]).default(300),
    utteranceEndMs: z.number().int().min(1000).max(5000).default(1000),
    connectionTimeoutMs: z.number().int().min(1).max(60000).default(10000),
    maxBufferedBytes: z.number().int().min(160).max(1048576).default(32000),
  }).strict().prefault({}),
  tts: z.object({
    provider: z.enum(['deepgram', 'custom', 'elevenlabs']).default('deepgram'),
    apiKey: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    voice: z.string().min(1).optional(),
    baseUrl: httpsUrl.optional(),
    timeoutMs: z.number().int().min(1).max(120000).default(30000),
    sourceSampleRate: z.literal(24000).optional(),
  }).strict().prefault({}),
  voice: z.object({
    enabled: z.boolean().default(false),
    maxInboundBytes: z.number().int().min(160).max(1048576).default(32000),
    maxOutboundBytes: z.number().int().min(160).max(1048576).default(64000),
    playbackPrebufferMs: z.number().int().min(0).max(2000).multipleOf(20).default(0),
    engine: z.enum(['openclaw', 'deepgram-agent']).default('openclaw'),
    agent: z.object({
      baseUrl: wssUrl.default('wss://agent.deepgram.com'),
      prompt: z.string().min(1).max(25000).optional(),
      greeting: z.string().optional(),
      tools: z.boolean().default(false),
      think: z.object({
        provider: z.enum(['open_ai', 'anthropic', 'google', 'groq', 'aws_bedrock', 'nvidia']).default('open_ai'),
        model: z.string().min(1).optional(),
        temperature: z.number().min(0).max(2).optional(),
        endpoint: z.object({
          url: httpsUrl,
          headers: z.record(z.string(), z.string()).default({}),
        }).strict().optional(),
      }).strict().prefault({}),
    }).strict().prefault({}),
  }).strict().prefault({}),
}).strict().transform(config => {
  const sttPreset = { ...sttProviderPresets.deepgram, ...config.providerPresets.stt.deepgram };
  const ttsPreset: { baseUrl?: string; model?: string } = {
    ...ttsProviderPresets[config.tts.provider], ...config.providerPresets.tts[config.tts.provider],
  };
  // Parsed optional leaves can be undefined: never let them erase preset values.
  return {
    ...config,
    stt: {
      ...config.stt, model: config.stt.model ?? sttPreset.model,
      baseUrl: config.stt.baseUrl ?? sttPreset.baseUrl
    },
    tts: {
      ...config.tts, model: config.tts.model ?? ttsPreset.model,
      baseUrl: config.tts.baseUrl ?? ttsPreset.baseUrl
    },
  };
});

export type SipPluginConfig = z.infer<typeof sipConfigSchema>;

export const authoredSipConfigSchema = z.preprocess(sipConfigForValidation, sipConfigSchema);

/** Parse config, failing loud on unknown/invalid keys instead of half-starting. */
export function parseSipConfig(input: unknown): SipPluginConfig {
  const result = sipConfigSchema.safeParse(input ?? {});
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('; ');
    throw new Error(`invalid sip plugin config: ${issues}`);
  }
  return result.data;
}

/** Transport "embedded" needs trunk credentials; "bridge" only needs the WS. */
export function validateForTransport(config: SipPluginConfig): string[] {
  const problems: string[] = [];
  if (config.transport === 'embedded') {
    if (!config.sip.user) problems.push('sip.user is required for transport "embedded"');
    if (!config.sip.password) problems.push('sip.password is required for transport "embedded"');
    if (!config.sip.publicIp) problems.push('sip.publicIp is required behind NAT, otherwise no RTP arrives');
  }
  if (config.media.rtpPortMax <= config.media.rtpPortMin) {
    problems.push('media.rtpPortMax must be > media.rtpPortMin');
  }
  if (config.inbound.pin.enabled && !config.inbound.pin.code) {
    problems.push('inbound.pin.code is required when inbound.pin.enabled is true');
  }
  if (config.media.host !== '127.0.0.1' && config.media.host !== 'localhost' && !config.media.authToken) {
    problems.push('media.authToken is required when media.host is not loopback, to prevent unauthenticated media connections');
  }
  if (config.voice.enabled && config.voice.engine === 'deepgram-agent') {
    const agent = config.voice.agent;
    if (!config.stt.apiKey) problems.push('stt.apiKey is required for voice.engine "deepgram-agent"');
    if (!agent.think.model) problems.push('voice.agent.think.model is required for voice.engine "deepgram-agent"');
    if (!agent.prompt) problems.push('voice.agent.prompt is required for voice.engine "deepgram-agent"');
    if (config.tts.provider === 'custom') problems.push('tts.provider must be "deepgram" or "elevenlabs" for voice.engine "deepgram-agent"');
    if (config.tts.provider === 'elevenlabs') {
      if (!config.tts.apiKey) problems.push('tts.apiKey is required for elevenlabs via Deepgram');
      if (!config.tts.voice) problems.push('tts.voice is required for elevenlabs via Deepgram');
    }
    if (!(config.tts.voice ?? config.tts.model)) problems.push('tts.voice or tts.model is required for voice.engine "deepgram-agent"');
    if (['google', 'groq', 'aws_bedrock'].includes(agent.think.provider) && !agent.think.endpoint) {
      problems.push(`voice.agent.think.endpoint is required for provider "${agent.think.provider}"`);
    }
  } else if (config.voice.enabled) {
    if (config.tts.provider === 'elevenlabs') problems.push('elevenlabs requires voice.engine "deepgram-agent"; native ElevenLabs TTS is disabled');
    if (!config.stt.apiKey) problems.push('stt.apiKey is required when voice.enabled');
    if (!config.tts.apiKey) problems.push('tts.apiKey is required when voice.enabled');
    if (config.tts.provider === 'elevenlabs' && !config.tts.voice) {
      problems.push('tts.voice is required for elevenlabs');
    }
    if (config.tts.provider === 'custom') {
      if (!config.tts.baseUrl) problems.push('tts.baseUrl is required for custom');
      if (!config.tts.model) problems.push('tts.model is required for custom');
      if (!config.tts.voice) problems.push('tts.voice is required for custom');
      if (config.tts.sourceSampleRate !== 24000) problems.push('tts.sourceSampleRate must explicitly be 24000 for OpenAI-compatible PCM');
    }
  }
  return problems;
}
