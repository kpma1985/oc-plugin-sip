/** Static UI suggestions, not a restriction on custom provider/deployment IDs. */
export const sttProviderPresets = {
  deepgram: { baseUrl: 'wss://api.deepgram.com', model: 'nova-3' },
} as const;
export const sttModelPresets = ['nova-3', 'nova-2'] as const;
export const ttsModelPresets = [
  'aura-2-viktoria-de', 'aura-2-thalia-en',
  'eleven_multilingual_v2', 'eleven_flash_v2_5', 'eleven_turbo_v2_5',
] as const;
export const ttsProviderPresets = {
  deepgram: { baseUrl: 'https://api.deepgram.com', model: 'aura-2-viktoria-de' },
  elevenlabs: { baseUrl: 'https://api.elevenlabs.io', model: 'eleven_multilingual_v2' },
  // Custom OpenAI-compatible endpoints have no universal URL or model.
  custom: {},
} as const;

export function incompatibleTtsModel(provider: keyof typeof ttsProviderPresets, model: string): boolean {
  return (provider === 'deepgram' && model.startsWith('eleven_')) ||
    (provider === 'elevenlabs' && model.startsWith('aura-'));
}
