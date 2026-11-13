const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const channel = config => isObject(config?.channels?.sip) ? config.channels.sip : {};
const legacy = config => isObject(config?.plugins?.entries?.sip?.config) ? config.plugins.entries.sip.config : {};

const atPath = (object, path) => path.reduce((value, key) => value?.[key], object);

export function setting(config, path, fallback) {
  return atPath(channel(config), path) ?? atPath(legacy(config), path) ?? fallback;
}

export function settingPatch(config, path, value) {
  if (path.join('.') === 'inbound.agentId' && value === '') {
    const remove = () => path.reduceRight((nested, key) => ({ [key]: nested }), null);
    return {
      ...(atPath(channel(config), path) !== undefined ? { channels: { sip: remove() } } : {}),
      ...(atPath(legacy(config), path) !== undefined ? { plugins: { entries: { sip: { config: remove() } } } } : {}),
    };
  }
  return { channels: { sip: path.reduceRight((nested, key) => ({ [key]: nested }), value) } };
}

export function selection(config, section, field, fallback) {
  return setting(config, [section, field], fallback);
}

export function selectionError(config, changes) {
  const chosen = (path, fallback) =>
    changes.find(change => (change.length === 3 ? change.slice(0, 2) : change[0]).join('.') === path.join('.'))?.at(-1)
    ?? setting(config, path, fallback);
  const preset = chosen(['sip', 'preset'], 'sipgate');
  if (preset === 'custom' && (!chosen(['sip', 'domain'], '') || !chosen(['sip', 'registrar'], ''))) {
    return 'Custom SIP requires domain and registrar';
  }
  const min = chosen(['media', 'rtpPortMin'], 10000);
  const max = chosen(['media', 'rtpPortMax'], 10099);
  const bounds = [
    [['media', 'port'], 1, 65535], [['media', 'rtpPortMin'], 1024, 65534],
    [['media', 'rtpPortMax'], 1025, 65535], [['inbound', 'maxConcurrent'], 1, Number.MAX_SAFE_INTEGER],
    [['voice', 'playbackPrebufferMs'], 0, 2000], [['voice', 'maxInboundBytes'], 160, 1048576],
    [['voice', 'maxOutboundBytes'], 160, 1048576], [['tts', 'timeoutMs'], 1, 120000],
    [['stt', 'utteranceEndMs'], 1000, 5000], [['stt', 'connectionTimeoutMs'], 1, 60000],
    [['stt', 'maxBufferedBytes'], 160, 1048576],
  ];
  for (const [path, lower, upper] of bounds) {
    const value = chosen(path, undefined);
    if (value !== undefined && (!Number.isInteger(value) || value < lower || value > upper)) {
      return `${path.join('.')} must be an integer from ${lower} to ${upper}`;
    }
  }
  if (chosen(['voice', 'playbackPrebufferMs'], 0) % 20 !== 0) return 'Playback prebuffer must be a multiple of 20 ms';
  if (max <= min) return 'RTP port max must exceed RTP port min';
  const engine = chosen(['voice', 'engine'], 'openclaw');
  if (!chosen(['voice', 'enabled'], false)) return null;
  const provider = chosen(['tts', 'provider'], 'deepgram');
  if (engine === 'openclaw' && provider === 'elevenlabs') return 'ElevenLabs requires Deepgram Voice Agent';
  if (engine === 'openclaw' && provider === 'custom' &&
    (!chosen(['tts', 'baseUrl'], '') || !chosen(['tts', 'model'], '') ||
      !chosen(['tts', 'voice'], '') || chosen(['tts', 'sourceSampleRate'], '') !== 24000)) {
    return 'Custom TTS requires URL, model, voice and 24000 Hz sample rate';
  }
  if (engine === 'deepgram-agent') {
    if (provider === 'custom') return 'Custom TTS is unavailable with Deepgram Voice Agent';
    const prompt = chosen(['voice', 'agent', 'prompt'], '');
    const model = chosen(['voice', 'agent', 'think', 'model'], '');
    if (!prompt || !model) return 'Deepgram Voice Agent requires prompt and think model in Channels settings';
    if (!chosen(['stt', 'apiKey'], '') || (provider === 'elevenlabs' && !chosen(['tts', 'apiKey'], ''))) {
      return 'Deepgram Voice Agent requires provider credentials in Channels settings';
    }
    if (!chosen(['tts', 'voice'], '') && !chosen(['tts', 'model'], '')) {
      return 'Deepgram Voice Agent requires TTS voice or model in Channels settings';
    }
  }
  return null;
}

export function selectionPatch(config, section, field, value) {
  return settingPatch(config, [section, field], value);
}

function mergeInto(target, source) {
  for (const [key, value] of Object.entries(source)) {
    if (isObject(value)) mergeInto(target[key] ??= {}, value);
    else target[key] = value;
  }
}

export function mergeSelectionPatches(config, changes) {
  const patch = {};
  for (const change of changes) {
    const [path, value] = change.length === 3 ? [[change[0], change[1]], change[2]] : change;
    mergeInto(patch, settingPatch(config, path, value));
  }
  return patch;
}
