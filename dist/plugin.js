// src/plugin.ts
import { buildJsonChannelConfigSchema, createChatChannelPlugin, defineChannelPluginEntry } from "openclaw/plugin-sdk/core";

// openclaw.plugin.json
var openclaw_plugin_default = {
  id: "sip",
  controlUi: {
    entry: "dist/control-ui/controlUi.js",
    styles: [
      "dist/control-ui/controlUi.css"
    ]
  },
  uiCapabilities: [
    "page",
    "navigation"
  ],
  channels: [
    "sip"
  ],
  channelConfigs: {
    sip: {
      label: "SIP Telephony",
      description: "SIP trunk and voice settings. Explicit channel fields override legacy plugins.entries.sip.config; omitted fields retain legacy values.",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          providerPresets: {
            type: "object",
            additionalProperties: false,
            properties: {
              stt: {
                type: "object",
                additionalProperties: false,
                properties: {
                  deepgram: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      baseUrl: {
                        type: "string",
                        format: "uri",
                        pattern: "^wss://"
                      },
                      model: {
                        type: "string",
                        minLength: 1,
                        examples: [
                          "nova-3",
                          "nova-2"
                        ]
                      }
                    }
                  }
                }
              },
              tts: {
                type: "object",
                additionalProperties: false,
                properties: {
                  deepgram: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      baseUrl: {
                        type: "string",
                        format: "uri",
                        pattern: "^https://"
                      },
                      model: {
                        type: "string",
                        minLength: 1,
                        examples: [
                          "aura-2-viktoria-de",
                          "aura-2-thalia-en"
                        ]
                      }
                    }
                  },
                  elevenlabs: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      baseUrl: {
                        type: "string",
                        format: "uri",
                        pattern: "^https://"
                      },
                      model: {
                        type: "string",
                        minLength: 1,
                        examples: [
                          "eleven_multilingual_v2",
                          "eleven_flash_v2_5",
                          "eleven_turbo_v2_5"
                        ]
                      }
                    }
                  },
                  custom: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      baseUrl: {
                        type: "string",
                        format: "uri",
                        pattern: "^https://"
                      },
                      model: {
                        type: "string",
                        minLength: 1,
                        examples: []
                      }
                    }
                  }
                }
              }
            },
            description: "Optional provider defaults. Built-ins merge with these presets; explicit stt/tts leaves win. No API keys in presets."
          },
          enabled: {
            type: "boolean",
            default: false
          },
          transport: {
            type: "string",
            enum: [
              "embedded",
              "bridge"
            ],
            default: "embedded",
            description: "embedded = SIP/RTP in this plugin process, bridge = consume an external Twilio-Media-Streams WebSocket (e.g. sipgate-sip-stream-bridge)."
          },
          sip: {
            type: "object",
            additionalProperties: false,
            properties: {
              preset: {
                type: "string",
                enum: [
                  "sipgate",
                  "custom"
                ],
                default: "sipgate"
              },
              user: {
                anyOf: [
                  {
                    type: "string",
                    minLength: 1
                  },
                  {
                    type: "object",
                    additionalProperties: false,
                    required: [
                      "source",
                      "provider",
                      "id"
                    ],
                    properties: {
                      source: {
                        const: "store"
                      },
                      provider: {
                        const: "default"
                      },
                      id: {
                        type: "string",
                        pattern: "^[A-Z][A-Z0-9_]{0,127}$"
                      }
                    }
                  }
                ]
              },
              password: {
                anyOf: [
                  {
                    type: "string",
                    minLength: 1
                  },
                  {
                    type: "object",
                    additionalProperties: false,
                    required: [
                      "source",
                      "provider",
                      "id"
                    ],
                    properties: {
                      source: {
                        const: "store"
                      },
                      provider: {
                        const: "default"
                      },
                      id: {
                        type: "string",
                        pattern: "^[A-Z][A-Z0-9_]{0,127}$"
                      }
                    }
                  }
                ]
              },
              domain: {
                type: "string",
                minLength: 1
              },
              registrar: {
                type: "string",
                minLength: 1
              },
              listenAddr: {
                type: "string",
                default: "0.0.0.0:5060",
                pattern: "^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])\\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9]):(?:[1-9][0-9]{0,3}|[1-5][0-9]{4}|6[0-4][0-9]{3}|65[0-4][0-9]{2}|655[0-2][0-9]|6553[0-5])$"
              },
              publicIp: {
                type: "string",
                format: "ipv4"
              },
              srtp: {
                type: "boolean",
                default: false
              },
              srtpRequired: {
                type: "boolean",
                default: false
              }
            }
          },
          media: {
            type: "object",
            additionalProperties: false,
            properties: {
              host: {
                type: "string",
                default: "127.0.0.1"
              },
              port: {
                type: "integer",
                default: 8080,
                minimum: 1,
                maximum: 65535
              },
              path: {
                type: "string",
                default: "/sip/media"
              },
              rtpPortMin: {
                type: "integer",
                default: 1e4,
                minimum: 1024,
                maximum: 65534
              },
              rtpPortMax: {
                type: "integer",
                default: 10099,
                minimum: 1025,
                maximum: 65535,
                description: "Must be strictly greater than rtpPortMin (runtime cross-field validation)."
              },
              authToken: {
                type: "string",
                minLength: 16,
                maxLength: 200,
                description: "Shared secret required on the media WebSocket endpoint (Bearer token or ?token=). Strongly recommended when media.host is not loopback."
              }
            }
          },
          audio: {
            type: "object",
            additionalProperties: false,
            properties: {
              mode: {
                type: "string",
                enum: [
                  "twilio",
                  "best"
                ],
                default: "twilio"
              }
            }
          },
          inbound: {
            type: "object",
            additionalProperties: false,
            properties: {
              policy: {
                type: "string",
                enum: [
                  "allowlist",
                  "open"
                ],
                default: "allowlist"
              },
              allowFrom: {
                type: "array",
                items: {
                  type: "string"
                },
                default: []
              },
              callerCountryCode: {
                type: "string",
                pattern: "^[1-9]\\d{0,2}$",
                description: "Country calling code without +; enables national caller normalization. Leave unset for E.164 only."
              },
              callerNationalPrefix: {
                type: "string",
                pattern: "^\\d{1,4}$",
                default: "0",
                description: "National trunk prefix removed before adding the configured country calling code."
              },
              greeting: {
                type: "string",
                default: ""
              },
              agentId: {
                type: "string"
              },
              maxConcurrent: {
                type: "integer",
                default: 2,
                minimum: 1
              },
              toolsAllow: {
                type: "array",
                items: {
                  type: "string",
                  minLength: 1,
                  maxLength: 100
                },
                maxItems: 100,
                default: [],
                description: "Tool names the phone agent may use. Empty disables tools (caller ID is not authentication)."
              },
              pin: {
                type: "object",
                additionalProperties: false,
                default: {},
                properties: {
                  enabled: {
                    type: "boolean",
                    default: false
                  },
                  code: {
                    type: "string",
                    pattern: "^\\d{3,12}$"
                  },
                  promptText: {
                    type: "string",
                    minLength: 1,
                    maxLength: 500,
                    default: "Please enter your PIN, followed by the pound key."
                  },
                  failureText: {
                    type: "string",
                    minLength: 1,
                    maxLength: 500,
                    default: "Incorrect PIN. Please try again."
                  },
                  successText: {
                    type: "string",
                    maxLength: 500,
                    default: ""
                  },
                  lockoutText: {
                    type: "string",
                    minLength: 1,
                    maxLength: 500,
                    default: "Too many failed attempts. Goodbye."
                  },
                  maxAttempts: {
                    type: "integer",
                    minimum: 1,
                    maximum: 10,
                    default: 3
                  },
                  maxDigits: {
                    type: "integer",
                    minimum: 3,
                    maximum: 12,
                    default: 8
                  },
                  timeoutMs: {
                    type: "integer",
                    minimum: 3e3,
                    maximum: 12e4,
                    default: 2e4
                  }
                }
              }
            }
          },
          stt: {
            type: "object",
            additionalProperties: false,
            properties: {
              provider: {
                type: "string",
                enum: [
                  "deepgram"
                ],
                default: "deepgram"
              },
              apiKey: {
                type: "string",
                sensitive: true,
                minLength: 1
              },
              model: {
                type: "string",
                minLength: 1,
                examples: [
                  "nova-3",
                  "nova-2"
                ],
                description: "Custom models accepted. Default nova-3 unless providerPresets overrides it."
              },
              language: {
                type: "string",
                default: "de"
              },
              keyterms: {
                type: "array",
                items: {
                  type: "string",
                  minLength: 1,
                  maxLength: 100
                },
                maxItems: 100,
                default: []
              },
              endpointing: {
                anyOf: [
                  {
                    type: "boolean",
                    const: false
                  },
                  {
                    type: "integer",
                    minimum: 1,
                    maximum: 5e3
                  }
                ],
                default: 300
              },
              utteranceEndMs: {
                type: "integer",
                default: 1e3,
                minimum: 1e3,
                maximum: 5e3
              },
              connectionTimeoutMs: {
                type: "integer",
                default: 1e4,
                minimum: 1,
                maximum: 6e4
              },
              maxBufferedBytes: {
                type: "integer",
                default: 32e3,
                minimum: 160,
                maximum: 1048576
              },
              baseUrl: {
                type: "string",
                format: "uri",
                pattern: "^wss://",
                description: "WSS base URL; /v1/listen appended. Default wss://api.deepgram.com."
              }
            }
          },
          tts: {
            type: "object",
            additionalProperties: false,
            properties: {
              provider: {
                type: "string",
                enum: [
                  "deepgram",
                  "custom",
                  "elevenlabs"
                ],
                default: "deepgram"
              },
              model: {
                type: "string",
                minLength: 1,
                examples: [
                  "aura-2-viktoria-de",
                  "aura-2-thalia-en",
                  "eleven_multilingual_v2",
                  "eleven_flash_v2_5",
                  "eleven_turbo_v2_5"
                ],
                description: "Custom models accepted. Default aura-2-viktoria-de for Deepgram, eleven_multilingual_v2 for ElevenLabs. Custom requires an explicit model when voice is enabled."
              },
              baseUrl: {
                type: "string",
                format: "uri",
                pattern: "^https://",
                description: "HTTPS base URL; provider API path appended. Custom requires an explicit URL."
              },
              apiKey: {
                type: "string",
                minLength: 1
              },
              voice: {
                type: "string",
                minLength: 1,
                description: "Voice identifier; required for ElevenLabs and Custom when voice.enabled (runtime validation). No default voice."
              },
              timeoutMs: {
                type: "integer",
                default: 3e4,
                minimum: 1,
                maximum: 12e4
              },
              sourceSampleRate: {
                type: "integer",
                const: 24e3
              }
            }
          },
          voice: {
            type: "object",
            additionalProperties: false,
            properties: {
              enabled: {
                type: "boolean",
                default: false
              },
              maxInboundBytes: {
                type: "integer",
                default: 32e3,
                minimum: 160,
                maximum: 1048576
              },
              maxOutboundBytes: {
                type: "integer",
                default: 64e3,
                minimum: 160,
                maximum: 1048576
              },
              playbackPrebufferMs: {
                type: "integer",
                default: 0,
                minimum: 0,
                maximum: 2e3,
                multipleOf: 20,
                description: "Streaming playback prebuffer; 0 disables. Rebuffers after underrun, capped by outbound queue limit."
              },
              engine: {
                type: "string",
                enum: [
                  "openclaw",
                  "deepgram-agent"
                ],
                default: "openclaw",
                description: "openclaw: STT/TTS pipeline with OpenClaw agent. deepgram-agent: Deepgram Voice Agent runs STT, LLM and TTS itself."
              },
              agent: {
                type: "object",
                additionalProperties: false,
                properties: {
                  baseUrl: {
                    type: "string",
                    default: "wss://agent.deepgram.com"
                  },
                  prompt: {
                    type: "string",
                    minLength: 1,
                    maxLength: 25e3
                  },
                  greeting: {
                    type: "string"
                  },
                  think: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      provider: {
                        type: "string",
                        enum: [
                          "open_ai",
                          "anthropic",
                          "google",
                          "groq",
                          "aws_bedrock",
                          "nvidia"
                        ],
                        default: "open_ai"
                      },
                      model: {
                        type: "string",
                        minLength: 1
                      },
                      temperature: {
                        type: "number",
                        minimum: 0,
                        maximum: 2
                      },
                      endpoint: {
                        type: "object",
                        additionalProperties: false,
                        required: [
                          "url"
                        ],
                        properties: {
                          url: {
                            type: "string"
                          },
                          headers: {
                            type: "object",
                            additionalProperties: {
                              type: "string"
                            },
                            default: {}
                          }
                        }
                      }
                    }
                  },
                  tools: {
                    type: "boolean",
                    default: false,
                    description: "Expose openclaw_task to the Deepgram agent; runs the OpenClaw agent with inbound.toolsAllow."
                  }
                }
              }
            }
          }
        }
      },
      uiHints: {
        "sip.preset": {
          label: "SIP provider",
          help: "sipgate supplies server defaults; custom requires domain and registrar under advanced settings. Existing overrides are preserved."
        },
        "sip.domain": {
          label: "SIP Domain",
          advanced: true,
          placeholder: "sipconnect.sipgate.de"
        },
        sip: {
          label: "SIP account"
        },
        inbound: {
          label: "Calls and access"
        },
        voice: {
          label: "Voice assistant"
        },
        stt: {
          label: "Speech recognition"
        },
        tts: {
          label: "Speech output"
        },
        audio: {
          label: "Audio quality"
        },
        media: {
          label: "Network and media",
          advanced: true
        },
        "voice.enabled": {
          label: "Enable voice assistant"
        },
        "voice.playbackPrebufferMs": {
          label: "Audio prebuffer (ms)",
          advanced: true,
          placeholder: "100"
        },
        "inbound.agentId": {
          label: "OpenClaw Agent",
          help: "Agent ID for voice.engine openclaw and OpenClaw tool delegation from deepgram-agent. Not the Deepgram agent's own LLM model."
        },
        transport: {
          label: "SIP transport",
          advanced: true
        },
        "sip.listenAddr": {
          label: "SIP listen address",
          advanced: true
        },
        "sip.srtp": {
          label: "SRTP",
          advanced: true
        },
        "media.host": {
          label: "Media WebSocket host",
          advanced: true
        },
        "media.path": {
          label: "Media WebSocket path",
          advanced: true
        },
        "media.rtpPortMin": {
          label: "RTP port minimum",
          advanced: true
        },
        "media.rtpPortMax": {
          label: "RTP port maximum",
          advanced: true
        },
        "stt.connectionTimeoutMs": {
          label: "STT connection timeout (ms)",
          advanced: true
        },
        "stt.maxBufferedBytes": {
          label: "STT buffer limit (bytes)",
          advanced: true
        },
        "stt.endpointing": {
          label: "STT endpointing",
          advanced: true
        },
        "stt.utteranceEndMs": {
          label: "STT utterance end (ms)",
          advanced: true
        },
        "tts.timeoutMs": {
          label: "TTS timeout (ms)",
          advanced: true
        },
        "tts.sourceSampleRate": {
          label: "TTS source sample rate (Hz)",
          advanced: true
        },
        "voice.maxInboundBytes": {
          label: "Inbound audio buffer limit (bytes)",
          advanced: true
        },
        "voice.maxOutboundBytes": {
          label: "Outbound audio buffer limit (bytes)",
          advanced: true
        },
        "inbound.greeting": {
          label: "Greeting"
        },
        "inbound.policy": {
          label: "Access policy"
        },
        "inbound.allowFrom": {
          label: "Allowed numbers",
          placeholder: "+491234567890"
        },
        "inbound.maxConcurrent": {
          label: "Concurrent calls"
        },
        "tts.voice": {
          label: "Voice / Voice ID"
        },
        "stt.language": {
          label: "Language",
          placeholder: "de"
        },
        "sip.user": {
          label: "SIP-ID / user"
        },
        "sip.password": {
          label: "SIP password",
          sensitive: true
        },
        "sip.registrar": {
          label: "Registrar",
          advanced: true,
          placeholder: "sipconnect.sipgate.de"
        },
        "sip.publicIp": {
          label: "Public IP (SDP Contact)",
          advanced: true,
          help: "Mandatory behind NAT, otherwise no RTP arrives."
        },
        "media.port": {
          label: "Media WebSocket port",
          advanced: true
        },
        "audio.mode": {
          label: "Codec mode",
          help: "twilio = PCMU/mu-law 8 kHz; best = G.722 16 kHz, then PCMA/PCMU. G.722 needs system SpanDSP."
        },
        "stt.provider": {
          label: "Speech recognition (STT)",
          help: "Select speech recognition provider. Currently Deepgram."
        },
        "tts.provider": {
          label: "Speech output (TTS)",
          help: "Deepgram or Custom for voice.engine openclaw. Native ElevenLabs only via voice.engine deepgram-agent; requires tts.apiKey and tts.voice (Voice-ID). Custom requires model, base URL and Voice-ID."
        },
        "stt.apiKey": {
          label: "STT API key",
          sensitive: true
        },
        "tts.apiKey": {
          label: "TTS API key",
          sensitive: true
        },
        enabled: {
          label: "Enable SIP",
          help: "Channel values override legacy plugins.entries.sip.config. Migrate existing config before first channel edit."
        },
        providerPresets: {
          label: "Provider presets",
          help: "Optional defaults per provider. Explicit STT/TTS fields override these values. Switching provider selects its preset only for omitted fields.",
          advanced: true
        },
        "stt.model": {
          label: "STT model",
          help: "Suggestions: nova-3, nova-2. Custom model/deployment IDs remain supported; SDK has no editable dropdown hint.",
          placeholder: "nova-3"
        },
        "tts.model": {
          label: "TTS model",
          help: "Suggestions: aura-2-viktoria-de, aura-2-thalia-en, eleven_multilingual_v2, eleven_flash_v2_5, eleven_turbo_v2_5. Custom model/deployment IDs remain supported; SDK has no editable dropdown hint.",
          placeholder: "aura-2-viktoria-de"
        },
        "stt.baseUrl": {
          label: "STT base URL",
          advanced: true,
          placeholder: "wss://api.deepgram.com",
          help: "WSS base URL; /v1/listen appended. Explicit value overrides preset."
        },
        "tts.baseUrl": {
          label: "TTS base URL",
          advanced: true,
          placeholder: "https://api.deepgram.com",
          help: "HTTPS base URL; provider API path appended. Custom requires an explicit URL."
        },
        "voice.engine": {
          label: "Voice assistant mode",
          help: "openclaw uses inbound.agentId with STT/TTS; its LLM is configured in OpenClaw. deepgram-agent uses its own LLM and prompt; supports native ElevenLabs TTS."
        },
        "voice.agent.baseUrl": {
          label: "Agent endpoint",
          advanced: true
        },
        "voice.agent.prompt": {
          label: "Agent system prompt",
          help: "System prompt for the Deepgram Voice Agent (voice.engine deepgram-agent)."
        },
        "voice.agent.greeting": {
          label: "Agent greeting",
          help: "Falls back to inbound.greeting."
        },
        "voice.agent.think.provider": {
          label: "LLM provider"
        },
        "voice.agent.think.model": {
          label: "LLM",
          help: "Model ID for voice.engine deepgram-agent only; not the OpenClaw agent's model. Managed models: GET https://agent.deepgram.com/v1/agent/settings/think/models"
        },
        "voice.agent.think.temperature": {
          label: "LLM temperature",
          advanced: true
        },
        "voice.agent.think.endpoint.url": {
          label: "Custom LLM URL",
          advanced: true
        },
        "voice.agent.think.endpoint.headers": {
          label: "Custom LLM headers",
          advanced: true,
          sensitive: true
        },
        "inbound.toolsAllow": {
          label: "Allowed phone tools",
          help: "Tool names the phone agent may call. Empty = no tools."
        },
        "voice.agent.tools": {
          label: "Agent tools via OpenClaw",
          help: "Lets the Deepgram agent delegate tasks to the OpenClaw agent."
        },
        "inbound.pin": {
          label: "Keypad PIN (DTMF)",
          help: "Protects the phone agent and its MCP tools behind a keypad PIN entry."
        },
        "inbound.pin.enabled": {
          label: "Enable PIN gate",
          help: "Requires a keypad PIN (DTMF) before the agent or its tools can be reached."
        },
        "inbound.pin.code": {
          label: "PIN code",
          help: "Digits only (3-12). Entered on the phone keypad, confirmed with the pound key (#).",
          sensitive: true,
          placeholder: "1234"
        },
        "inbound.pin.promptText": {
          label: "PIN prompt announcement",
          help: "Text spoken to prompt for PIN entry.",
          advanced: true
        },
        "inbound.pin.failureText": {
          label: "Incorrect PIN announcement",
          help: "Text played after a wrong PIN entry.",
          advanced: true
        },
        "inbound.pin.successText": {
          label: "Correct PIN announcement (optional)",
          help: "Optionaler Bestaetigungstext vor der eigentlichen Greeting.",
          advanced: true
        },
        "inbound.pin.lockoutText": {
          label: "Lockout announcement",
          help: "Text played when too many attempts failed, before the call is hung up.",
          advanced: true
        },
        "inbound.pin.maxAttempts": {
          label: "Maximum failed attempts",
          advanced: true
        },
        "inbound.pin.maxDigits": {
          label: "Maximum PIN length (digits)",
          advanced: true
        },
        "inbound.pin.timeoutMs": {
          label: "PIN entry timeout (ms)",
          advanced: true
        },
        "media.authToken": {
          label: "Media endpoint auth token",
          help: "Optional secret required for attaching to the media WebSocket. Protects the media server against unauthorized stream injection."
        }
      }
    }
  },
  name: "SIP Telephony",
  description: "Independent SIP telephony channel for OpenClaw: embedded SIP UAS + RTP (any SIP trunk, e.g. sipgate), mu-law media over WebSocket, optional external media-stream bridge.",
  categories: [
    "voice"
  ],
  activation: {
    onStartup: true
  },
  contracts: {
    tools: []
  },
  uiHints: {
    "sip.preset": {
      label: "SIP provider",
      help: "sipgate supplies server defaults; custom requires domain and registrar under advanced settings. Existing overrides are preserved."
    },
    "sip.domain": {
      label: "SIP Domain",
      advanced: true,
      placeholder: "sipconnect.sipgate.de"
    },
    sip: {
      label: "SIP account"
    },
    inbound: {
      label: "Calls and access"
    },
    voice: {
      label: "Voice assistant"
    },
    stt: {
      label: "Speech recognition"
    },
    tts: {
      label: "Speech output"
    },
    audio: {
      label: "Audio quality"
    },
    media: {
      label: "Network and media",
      advanced: true
    },
    "voice.enabled": {
      label: "Enable voice assistant"
    },
    "voice.playbackPrebufferMs": {
      label: "Audio prebuffer (ms)",
      advanced: true,
      placeholder: "100"
    },
    "inbound.agentId": {
      label: "OpenClaw Agent",
      help: "Agent ID for voice.engine openclaw and OpenClaw tool delegation from deepgram-agent. Not the Deepgram agent's own LLM model."
    },
    transport: {
      label: "SIP transport",
      advanced: true
    },
    "sip.listenAddr": {
      label: "SIP listen address",
      advanced: true
    },
    "sip.srtp": {
      label: "SRTP",
      advanced: true
    },
    "media.host": {
      label: "Media WebSocket host",
      advanced: true
    },
    "media.path": {
      label: "Media WebSocket path",
      advanced: true
    },
    "media.rtpPortMin": {
      label: "RTP port minimum",
      advanced: true
    },
    "media.rtpPortMax": {
      label: "RTP port maximum",
      advanced: true
    },
    "stt.connectionTimeoutMs": {
      label: "STT connection timeout (ms)",
      advanced: true
    },
    "stt.maxBufferedBytes": {
      label: "STT buffer limit (bytes)",
      advanced: true
    },
    "stt.endpointing": {
      label: "STT endpointing",
      advanced: true
    },
    "stt.utteranceEndMs": {
      label: "STT utterance end (ms)",
      advanced: true
    },
    "tts.timeoutMs": {
      label: "TTS timeout (ms)",
      advanced: true
    },
    "tts.sourceSampleRate": {
      label: "TTS source sample rate (Hz)",
      advanced: true
    },
    "voice.maxInboundBytes": {
      label: "Inbound audio buffer limit (bytes)",
      advanced: true
    },
    "voice.maxOutboundBytes": {
      label: "Outbound audio buffer limit (bytes)",
      advanced: true
    },
    "inbound.greeting": {
      label: "Greeting"
    },
    "inbound.policy": {
      label: "Access policy"
    },
    "inbound.allowFrom": {
      label: "Allowed numbers",
      placeholder: "+491234567890"
    },
    "inbound.maxConcurrent": {
      label: "Concurrent calls"
    },
    "tts.voice": {
      label: "Voice / Voice ID"
    },
    "stt.language": {
      label: "Language",
      placeholder: "de"
    },
    "sip.user": {
      label: "SIP-ID / user"
    },
    "sip.password": {
      label: "SIP password",
      sensitive: true
    },
    "sip.registrar": {
      label: "Registrar",
      advanced: true,
      placeholder: "sipconnect.sipgate.de"
    },
    "sip.publicIp": {
      label: "Public IP (SDP Contact)",
      advanced: true,
      help: "Mandatory behind NAT, otherwise no RTP arrives."
    },
    "media.port": {
      label: "Media WebSocket port",
      advanced: true
    },
    "audio.mode": {
      label: "Codec mode",
      help: "twilio = PCMU/mu-law 8 kHz; best = G.722 16 kHz, then PCMA/PCMU. G.722 needs system SpanDSP."
    },
    "stt.provider": {
      label: "Speech recognition (STT)",
      help: "Select speech recognition provider. Currently Deepgram."
    },
    "tts.provider": {
      label: "Speech output (TTS)",
      help: "Deepgram or Custom for voice.engine openclaw. Native ElevenLabs only via voice.engine deepgram-agent; requires tts.apiKey and tts.voice (Voice-ID). Custom requires model, base URL and Voice-ID."
    },
    "stt.apiKey": {
      label: "STT API key",
      sensitive: true
    },
    "tts.apiKey": {
      label: "TTS API key",
      sensitive: true
    },
    enabled: {
      label: "Enable SIP",
      help: "Channel values override legacy plugins.entries.sip.config. Migrate existing config before first channel edit."
    },
    providerPresets: {
      label: "Provider presets",
      help: "Optional defaults per provider. Explicit STT/TTS fields override these values. Switching provider selects its preset only for omitted fields.",
      advanced: true
    },
    "stt.model": {
      label: "STT model",
      help: "Suggestions: nova-3, nova-2. Custom model/deployment IDs remain supported; SDK has no editable dropdown hint.",
      placeholder: "nova-3"
    },
    "tts.model": {
      label: "TTS model",
      help: "Suggestions: aura-2-viktoria-de, aura-2-thalia-en, eleven_multilingual_v2, eleven_flash_v2_5, eleven_turbo_v2_5. Custom model/deployment IDs remain supported; SDK has no editable dropdown hint.",
      placeholder: "aura-2-viktoria-de"
    },
    "stt.baseUrl": {
      label: "STT base URL",
      advanced: true,
      placeholder: "wss://api.deepgram.com",
      help: "WSS base URL; /v1/listen appended. Explicit value overrides preset."
    },
    "tts.baseUrl": {
      label: "TTS base URL",
      advanced: true,
      placeholder: "https://api.deepgram.com",
      help: "HTTPS base URL; provider API path appended. Custom requires an explicit URL."
    },
    "voice.engine": {
      label: "Voice assistant mode",
      help: "openclaw uses inbound.agentId with STT/TTS; its LLM is configured in OpenClaw. deepgram-agent uses its own LLM and prompt; supports native ElevenLabs TTS."
    },
    "voice.agent.baseUrl": {
      label: "Agent endpoint",
      advanced: true
    },
    "voice.agent.prompt": {
      label: "Agent system prompt",
      help: "System prompt for the Deepgram Voice Agent (voice.engine deepgram-agent)."
    },
    "voice.agent.greeting": {
      label: "Agent greeting",
      help: "Falls back to inbound.greeting."
    },
    "voice.agent.think.provider": {
      label: "LLM provider"
    },
    "voice.agent.think.model": {
      label: "LLM",
      help: "Model ID for voice.engine deepgram-agent only; not the OpenClaw agent's model. Managed models: GET https://agent.deepgram.com/v1/agent/settings/think/models"
    },
    "voice.agent.think.temperature": {
      label: "LLM temperature",
      advanced: true
    },
    "voice.agent.think.endpoint.url": {
      label: "Custom LLM URL",
      advanced: true
    },
    "voice.agent.think.endpoint.headers": {
      label: "Custom LLM headers",
      advanced: true,
      sensitive: true
    },
    "inbound.toolsAllow": {
      label: "Allowed phone tools",
      help: "Tool names the phone agent may call. Empty = no tools."
    },
    "voice.agent.tools": {
      label: "Agent tools via OpenClaw",
      help: "Lets the Deepgram agent delegate tasks to the OpenClaw agent."
    },
    "inbound.pin": {
      label: "Keypad PIN (DTMF)",
      help: "Protects the phone agent and its MCP tools behind a keypad PIN entry."
    },
    "inbound.pin.enabled": {
      label: "Enable PIN gate",
      help: "Requires a keypad PIN (DTMF) before the agent or its tools can be reached."
    },
    "inbound.pin.code": {
      label: "PIN code",
      help: "Digits only (3-12). Entered on the phone keypad, confirmed with the pound key (#).",
      sensitive: true,
      placeholder: "1234"
    },
    "inbound.pin.promptText": {
      label: "PIN prompt announcement",
      help: "Text spoken to prompt for PIN entry.",
      advanced: true
    },
    "inbound.pin.failureText": {
      label: "Incorrect PIN announcement",
      help: "Text played after a wrong PIN entry.",
      advanced: true
    },
    "inbound.pin.successText": {
      label: "Correct PIN announcement (optional)",
      help: "Optionaler Bestaetigungstext vor der eigentlichen Greeting.",
      advanced: true
    },
    "inbound.pin.lockoutText": {
      label: "Lockout announcement",
      help: "Text played when too many attempts failed, before the call is hung up.",
      advanced: true
    },
    "inbound.pin.maxAttempts": {
      label: "Maximum failed attempts",
      advanced: true
    },
    "inbound.pin.maxDigits": {
      label: "Maximum PIN length (digits)",
      advanced: true
    },
    "inbound.pin.timeoutMs": {
      label: "PIN entry timeout (ms)",
      advanced: true
    },
    "media.authToken": {
      label: "Media endpoint auth token",
      help: "Optional secret required for attaching to the media WebSocket. Protects the media server against unauthorized stream injection."
    }
  },
  configSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      providerPresets: {
        type: "object",
        additionalProperties: false,
        properties: {
          stt: {
            type: "object",
            additionalProperties: false,
            properties: {
              deepgram: {
                type: "object",
                additionalProperties: false,
                properties: {
                  baseUrl: {
                    type: "string",
                    format: "uri",
                    pattern: "^wss://"
                  },
                  model: {
                    type: "string",
                    minLength: 1,
                    examples: [
                      "nova-3",
                      "nova-2"
                    ]
                  }
                }
              }
            }
          },
          tts: {
            type: "object",
            additionalProperties: false,
            properties: {
              deepgram: {
                type: "object",
                additionalProperties: false,
                properties: {
                  baseUrl: {
                    type: "string",
                    format: "uri",
                    pattern: "^https://"
                  },
                  model: {
                    type: "string",
                    minLength: 1,
                    examples: [
                      "aura-2-viktoria-de",
                      "aura-2-thalia-en"
                    ]
                  }
                }
              },
              elevenlabs: {
                type: "object",
                additionalProperties: false,
                properties: {
                  baseUrl: {
                    type: "string",
                    format: "uri",
                    pattern: "^https://"
                  },
                  model: {
                    type: "string",
                    minLength: 1,
                    examples: [
                      "eleven_multilingual_v2",
                      "eleven_flash_v2_5",
                      "eleven_turbo_v2_5"
                    ]
                  }
                }
              },
              custom: {
                type: "object",
                additionalProperties: false,
                properties: {
                  baseUrl: {
                    type: "string",
                    format: "uri",
                    pattern: "^https://"
                  },
                  model: {
                    type: "string",
                    minLength: 1,
                    examples: []
                  }
                }
              }
            }
          }
        },
        description: "Optional provider defaults. Built-ins merge with these presets; explicit stt/tts leaves win. No API keys in presets."
      },
      enabled: {
        type: "boolean",
        default: false
      },
      transport: {
        type: "string",
        enum: [
          "embedded",
          "bridge"
        ],
        default: "embedded",
        description: "embedded = SIP/RTP in this plugin process, bridge = consume an external Twilio-Media-Streams WebSocket (e.g. sipgate-sip-stream-bridge)."
      },
      sip: {
        type: "object",
        additionalProperties: false,
        properties: {
          preset: {
            type: "string",
            enum: [
              "sipgate",
              "custom"
            ],
            default: "sipgate"
          },
          user: {
            anyOf: [
              {
                type: "string",
                minLength: 1
              },
              {
                type: "object",
                additionalProperties: false,
                required: [
                  "source",
                  "provider",
                  "id"
                ],
                properties: {
                  source: {
                    const: "store"
                  },
                  provider: {
                    const: "default"
                  },
                  id: {
                    type: "string",
                    pattern: "^[A-Z][A-Z0-9_]{0,127}$"
                  }
                }
              }
            ]
          },
          password: {
            anyOf: [
              {
                type: "string",
                minLength: 1
              },
              {
                type: "object",
                additionalProperties: false,
                required: [
                  "source",
                  "provider",
                  "id"
                ],
                properties: {
                  source: {
                    const: "store"
                  },
                  provider: {
                    const: "default"
                  },
                  id: {
                    type: "string",
                    pattern: "^[A-Z][A-Z0-9_]{0,127}$"
                  }
                }
              }
            ]
          },
          domain: {
            type: "string",
            minLength: 1
          },
          registrar: {
            type: "string",
            minLength: 1
          },
          listenAddr: {
            type: "string",
            default: "0.0.0.0:5060",
            pattern: "^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])\\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9]):(?:[1-9][0-9]{0,3}|[1-5][0-9]{4}|6[0-4][0-9]{3}|65[0-4][0-9]{2}|655[0-2][0-9]|6553[0-5])$"
          },
          publicIp: {
            type: "string",
            format: "ipv4"
          },
          srtp: {
            type: "boolean",
            default: false
          },
          srtpRequired: {
            type: "boolean",
            default: false
          }
        }
      },
      media: {
        type: "object",
        additionalProperties: false,
        properties: {
          host: {
            type: "string",
            default: "127.0.0.1"
          },
          port: {
            type: "integer",
            default: 8080,
            minimum: 1,
            maximum: 65535
          },
          path: {
            type: "string",
            default: "/sip/media"
          },
          rtpPortMin: {
            type: "integer",
            default: 1e4,
            minimum: 1024,
            maximum: 65534
          },
          rtpPortMax: {
            type: "integer",
            default: 10099,
            minimum: 1025,
            maximum: 65535,
            description: "Must be strictly greater than rtpPortMin (runtime cross-field validation)."
          },
          authToken: {
            type: "string",
            minLength: 16,
            maxLength: 200,
            description: "Shared secret required on the media WebSocket endpoint (Bearer token or ?token=). Strongly recommended when media.host is not loopback."
          }
        }
      },
      audio: {
        type: "object",
        additionalProperties: false,
        properties: {
          mode: {
            type: "string",
            enum: [
              "twilio",
              "best"
            ],
            default: "twilio"
          }
        }
      },
      inbound: {
        type: "object",
        additionalProperties: false,
        properties: {
          policy: {
            type: "string",
            enum: [
              "allowlist",
              "open"
            ],
            default: "allowlist"
          },
          allowFrom: {
            type: "array",
            items: {
              type: "string"
            },
            default: []
          },
          callerCountryCode: {
            type: "string",
            pattern: "^[1-9]\\d{0,2}$",
            description: "Country calling code without +; enables national caller normalization. Leave unset for E.164 only."
          },
          callerNationalPrefix: {
            type: "string",
            pattern: "^\\d{1,4}$",
            default: "0",
            description: "National trunk prefix removed before adding the configured country calling code."
          },
          greeting: {
            type: "string",
            default: ""
          },
          agentId: {
            type: "string"
          },
          maxConcurrent: {
            type: "integer",
            default: 2,
            minimum: 1
          },
          toolsAllow: {
            type: "array",
            items: {
              type: "string",
              minLength: 1,
              maxLength: 100
            },
            maxItems: 100,
            default: [],
            description: "Tool names the phone agent may use. Empty disables tools (caller ID is not authentication)."
          },
          pin: {
            type: "object",
            additionalProperties: false,
            default: {},
            properties: {
              enabled: {
                type: "boolean",
                default: false
              },
              code: {
                type: "string",
                pattern: "^\\d{3,12}$"
              },
              promptText: {
                type: "string",
                minLength: 1,
                maxLength: 500,
                default: "Please enter your PIN, followed by the pound key."
              },
              failureText: {
                type: "string",
                minLength: 1,
                maxLength: 500,
                default: "Incorrect PIN. Please try again."
              },
              successText: {
                type: "string",
                maxLength: 500,
                default: ""
              },
              lockoutText: {
                type: "string",
                minLength: 1,
                maxLength: 500,
                default: "Too many failed attempts. Goodbye."
              },
              maxAttempts: {
                type: "integer",
                minimum: 1,
                maximum: 10,
                default: 3
              },
              maxDigits: {
                type: "integer",
                minimum: 3,
                maximum: 12,
                default: 8
              },
              timeoutMs: {
                type: "integer",
                minimum: 3e3,
                maximum: 12e4,
                default: 2e4
              }
            }
          }
        }
      },
      stt: {
        type: "object",
        additionalProperties: false,
        properties: {
          provider: {
            type: "string",
            enum: [
              "deepgram"
            ],
            default: "deepgram"
          },
          apiKey: {
            type: "string",
            sensitive: true,
            minLength: 1
          },
          model: {
            type: "string",
            minLength: 1,
            examples: [
              "nova-3",
              "nova-2"
            ],
            description: "Custom models accepted. Default nova-3 unless providerPresets overrides it."
          },
          language: {
            type: "string",
            default: "de"
          },
          keyterms: {
            type: "array",
            items: {
              type: "string",
              minLength: 1,
              maxLength: 100
            },
            maxItems: 100,
            default: []
          },
          endpointing: {
            anyOf: [
              {
                type: "boolean",
                const: false
              },
              {
                type: "integer",
                minimum: 1,
                maximum: 5e3
              }
            ],
            default: 300
          },
          utteranceEndMs: {
            type: "integer",
            default: 1e3,
            minimum: 1e3,
            maximum: 5e3
          },
          connectionTimeoutMs: {
            type: "integer",
            default: 1e4,
            minimum: 1,
            maximum: 6e4
          },
          maxBufferedBytes: {
            type: "integer",
            default: 32e3,
            minimum: 160,
            maximum: 1048576
          },
          baseUrl: {
            type: "string",
            format: "uri",
            pattern: "^wss://",
            description: "WSS base URL; /v1/listen appended. Default wss://api.deepgram.com."
          }
        }
      },
      tts: {
        type: "object",
        additionalProperties: false,
        properties: {
          provider: {
            type: "string",
            enum: [
              "deepgram",
              "custom",
              "elevenlabs"
            ],
            default: "deepgram"
          },
          model: {
            type: "string",
            minLength: 1,
            examples: [
              "aura-2-viktoria-de",
              "aura-2-thalia-en",
              "eleven_multilingual_v2",
              "eleven_flash_v2_5",
              "eleven_turbo_v2_5"
            ],
            description: "Custom models accepted. Default aura-2-viktoria-de for Deepgram, eleven_multilingual_v2 for ElevenLabs. Custom requires an explicit model when voice is enabled."
          },
          baseUrl: {
            type: "string",
            format: "uri",
            pattern: "^https://",
            description: "HTTPS base URL; provider API path appended. Custom requires an explicit URL."
          },
          apiKey: {
            type: "string",
            minLength: 1
          },
          voice: {
            type: "string",
            minLength: 1,
            description: "Voice identifier; required for ElevenLabs and Custom when voice.enabled (runtime validation). No default voice."
          },
          timeoutMs: {
            type: "integer",
            default: 3e4,
            minimum: 1,
            maximum: 12e4
          },
          sourceSampleRate: {
            type: "integer",
            const: 24e3
          }
        }
      },
      voice: {
        type: "object",
        additionalProperties: false,
        properties: {
          enabled: {
            type: "boolean",
            default: false
          },
          maxInboundBytes: {
            type: "integer",
            default: 32e3,
            minimum: 160,
            maximum: 1048576
          },
          maxOutboundBytes: {
            type: "integer",
            default: 64e3,
            minimum: 160,
            maximum: 1048576
          },
          playbackPrebufferMs: {
            type: "integer",
            default: 0,
            minimum: 0,
            maximum: 2e3,
            multipleOf: 20,
            description: "Streaming playback prebuffer; 0 disables. Rebuffers after underrun, capped by outbound queue limit."
          },
          engine: {
            type: "string",
            enum: [
              "openclaw",
              "deepgram-agent"
            ],
            default: "openclaw",
            description: "openclaw: STT/TTS pipeline with OpenClaw agent. deepgram-agent: Deepgram Voice Agent runs STT, LLM and TTS itself."
          },
          agent: {
            type: "object",
            additionalProperties: false,
            properties: {
              baseUrl: {
                type: "string",
                default: "wss://agent.deepgram.com"
              },
              prompt: {
                type: "string",
                minLength: 1,
                maxLength: 25e3
              },
              greeting: {
                type: "string"
              },
              think: {
                type: "object",
                additionalProperties: false,
                properties: {
                  provider: {
                    type: "string",
                    enum: [
                      "open_ai",
                      "anthropic",
                      "google",
                      "groq",
                      "aws_bedrock",
                      "nvidia"
                    ],
                    default: "open_ai"
                  },
                  model: {
                    type: "string",
                    minLength: 1
                  },
                  temperature: {
                    type: "number",
                    minimum: 0,
                    maximum: 2
                  },
                  endpoint: {
                    type: "object",
                    additionalProperties: false,
                    required: [
                      "url"
                    ],
                    properties: {
                      url: {
                        type: "string"
                      },
                      headers: {
                        type: "object",
                        additionalProperties: {
                          type: "string"
                        },
                        default: {}
                      }
                    }
                  }
                }
              },
              tools: {
                type: "boolean",
                default: false,
                description: "Expose openclaw_task to the Deepgram agent; runs the OpenClaw agent with inbound.toolsAllow."
              }
            }
          }
        }
      }
    }
  }
};

// src/config.ts
import { z } from "zod";
import { isIPv4 } from "node:net";

// src/voice/providerPresets.ts
var sttProviderPresets = {
  deepgram: { baseUrl: "wss://api.deepgram.com", model: "nova-3" }
};
var ttsProviderPresets = {
  deepgram: { baseUrl: "https://api.deepgram.com", model: "aura-2-viktoria-de" },
  elevenlabs: { baseUrl: "https://api.elevenlabs.io", model: "eleven_multilingual_v2" },
  // Custom OpenAI-compatible endpoints have no universal URL or model.
  custom: {}
};

// src/sipSecrets.ts
import { resolveConfiguredSecretInputString } from "openclaw/plugin-sdk/secret-input-runtime";
function isSipStoreRef(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const ref = value;
  return Object.keys(ref).length === 3 && ref["source"] === "store" && ref["provider"] === "default" && typeof ref["id"] === "string" && /^[A-Z][A-Z0-9_]{0,127}$/.test(ref["id"]);
}
function sipConfigForValidation(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const copy = structuredClone(value);
  const sip = copy["sip"];
  if (sip && typeof sip === "object" && !Array.isArray(sip)) {
    const trunk = sip;
    for (const field of ["user", "password"]) {
      if (isSipStoreRef(trunk[field])) trunk[field] = "secret-reference-pending";
    }
  }
  return copy;
}
async function resolveSipSecretInputs(config, input, root, resolve = resolveConfiguredSecretInputString) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const copy = structuredClone(input);
  const sip = copy["sip"];
  if (!sip || typeof sip !== "object" || Array.isArray(sip)) return copy;
  const trunk = sip;
  for (const field of ["user", "password"]) {
    if (!isSipStoreRef(trunk[field])) continue;
    const result = await resolve({ config, env: process.env, value: trunk[field], path: `${root}.sip.${field}` });
    if (!result.value) throw new Error(`SIP ${field} secret unavailable`);
    trunk[field] = result.value;
  }
  return copy;
}

// src/config.ts
var httpsUrl = z.url().refine((value) => new URL(value).protocol === "https:", "must use HTTPS");
var wssUrl = z.url().refine((value) => new URL(value).protocol === "wss:", "must use WSS");
var preset = (url) => z.object({
  baseUrl: url.optional(),
  model: z.string().min(1).optional()
}).strict().transform((value) => ({
  ...value.baseUrl !== void 0 ? { baseUrl: value.baseUrl } : {},
  ...value.model !== void 0 ? { model: value.model } : {}
}));
var sipConfigSchema = z.object({
  providerPresets: z.object({
    stt: z.object({ deepgram: preset(wssUrl).optional() }).strict().prefault({}),
    tts: z.object({
      deepgram: preset(httpsUrl).optional(),
      elevenlabs: preset(httpsUrl).optional(),
      custom: preset(httpsUrl).optional()
    }).strict().prefault({})
  }).strict().prefault({}),
  enabled: z.boolean().default(false),
  transport: z.enum(["embedded", "bridge"]).default("embedded"),
  sip: z.object({
    preset: z.enum(["sipgate", "custom"]).default("sipgate"),
    user: z.string().min(1).optional(),
    password: z.string().min(1).optional(),
    domain: z.string().min(1).optional(),
    registrar: z.string().min(1).optional(),
    listenAddr: z.string().refine(
      (value) => {
        const parts = value.split(":");
        const port = Number(parts[1]);
        return parts.length === 2 && isIPv4(parts[0] ?? "") && /^[1-9]\d{0,4}$/.test(parts[1] ?? "") && port >= 1 && port <= 65535;
      },
      "must be IPv4:port (1..65535)"
    ).default("0.0.0.0:5060"),
    publicIp: z.ipv4().optional(),
    srtp: z.boolean().default(false),
    srtpRequired: z.boolean().default(false)
  }).strict().superRefine((sip, context) => {
    if (sip.preset !== "custom") return;
    for (const field of ["domain", "registrar"]) {
      if (!sip[field]) context.addIssue({ code: "custom", path: [field], message: `sip.${field} is required for custom preset` });
    }
  }).transform((sip) => ({
    ...sip,
    domain: sip.domain ?? "sipconnect.sipgate.de",
    registrar: sip.registrar ?? "sipconnect.sipgate.de"
  })).prefault({}),
  media: z.object({
    host: z.string().default("127.0.0.1"),
    port: z.number().int().min(1).max(65535).default(8080),
    path: z.string().default("/sip/media"),
    rtpPortMin: z.number().int().min(1024).max(65534).default(1e4),
    rtpPortMax: z.number().int().min(1025).max(65535).default(10099),
    authToken: z.string().min(16).max(200).optional()
  }).strict().prefault({}),
  audio: z.object({ mode: z.enum(["twilio", "best"]).default("twilio") }).strict().prefault({}),
  inbound: z.object({
    policy: z.enum(["allowlist", "open"]).default("allowlist"),
    allowFrom: z.array(z.string()).default([]),
    callerCountryCode: z.string().regex(/^[1-9]\d{0,2}$/).optional(),
    callerNationalPrefix: z.string().regex(/^\d{1,4}$/).default("0"),
    greeting: z.string().default(""),
    agentId: z.string().optional(),
    maxConcurrent: z.number().int().min(1).default(2),
    toolsAllow: z.array(z.string().min(1).max(100)).max(100).default([]),
    pin: z.object({
      enabled: z.boolean().default(false),
      code: z.string().regex(/^\d{3,12}$/).optional(),
      promptText: z.string().min(1).max(500).default("Please enter your PIN, followed by the pound key."),
      failureText: z.string().min(1).max(500).default("Incorrect PIN. Please try again."),
      successText: z.string().min(0).max(500).default(""),
      lockoutText: z.string().min(1).max(500).default("Too many failed attempts. Goodbye."),
      maxAttempts: z.number().int().min(1).max(10).default(3),
      maxDigits: z.number().int().min(3).max(12).default(8),
      timeoutMs: z.number().int().min(3e3).max(12e4).default(2e4)
    }).strict().prefault({})
  }).strict().prefault({}),
  stt: z.object({
    provider: z.enum(["deepgram"]).default("deepgram"),
    apiKey: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    baseUrl: wssUrl.optional(),
    language: z.string().default("de"),
    keyterms: z.array(z.string().min(1).max(100)).max(100).default([]),
    endpointing: z.union([z.literal(false), z.number().int().min(1).max(5e3)]).default(300),
    utteranceEndMs: z.number().int().min(1e3).max(5e3).default(1e3),
    connectionTimeoutMs: z.number().int().min(1).max(6e4).default(1e4),
    maxBufferedBytes: z.number().int().min(160).max(1048576).default(32e3)
  }).strict().prefault({}),
  tts: z.object({
    provider: z.enum(["deepgram", "custom", "elevenlabs"]).default("deepgram"),
    apiKey: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    voice: z.string().min(1).optional(),
    baseUrl: httpsUrl.optional(),
    timeoutMs: z.number().int().min(1).max(12e4).default(3e4),
    sourceSampleRate: z.literal(24e3).optional()
  }).strict().prefault({}),
  voice: z.object({
    enabled: z.boolean().default(false),
    maxInboundBytes: z.number().int().min(160).max(1048576).default(32e3),
    maxOutboundBytes: z.number().int().min(160).max(1048576).default(64e3),
    playbackPrebufferMs: z.number().int().min(0).max(2e3).multipleOf(20).default(0),
    engine: z.enum(["openclaw", "deepgram-agent"]).default("openclaw"),
    agent: z.object({
      baseUrl: wssUrl.default("wss://agent.deepgram.com"),
      prompt: z.string().min(1).max(25e3).optional(),
      greeting: z.string().optional(),
      tools: z.boolean().default(false),
      think: z.object({
        provider: z.enum(["open_ai", "anthropic", "google", "groq", "aws_bedrock", "nvidia"]).default("open_ai"),
        model: z.string().min(1).optional(),
        temperature: z.number().min(0).max(2).optional(),
        endpoint: z.object({
          url: httpsUrl,
          headers: z.record(z.string(), z.string()).default({})
        }).strict().optional()
      }).strict().prefault({})
    }).strict().prefault({})
  }).strict().prefault({})
}).strict().transform((config) => {
  const sttPreset = { ...sttProviderPresets.deepgram, ...config.providerPresets.stt.deepgram };
  const ttsPreset = {
    ...ttsProviderPresets[config.tts.provider],
    ...config.providerPresets.tts[config.tts.provider]
  };
  return {
    ...config,
    stt: {
      ...config.stt,
      model: config.stt.model ?? sttPreset.model,
      baseUrl: config.stt.baseUrl ?? sttPreset.baseUrl
    },
    tts: {
      ...config.tts,
      model: config.tts.model ?? ttsPreset.model,
      baseUrl: config.tts.baseUrl ?? ttsPreset.baseUrl
    }
  };
});
var authoredSipConfigSchema = z.preprocess(sipConfigForValidation, sipConfigSchema);
function parseSipConfig(input) {
  const result = sipConfigSchema.safeParse(input ?? {});
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`).join("; ");
    throw new Error(`invalid sip plugin config: ${issues}`);
  }
  return result.data;
}
function validateForTransport(config) {
  const problems = [];
  if (config.transport === "embedded") {
    if (!config.sip.user) problems.push('sip.user is required for transport "embedded"');
    if (!config.sip.password) problems.push('sip.password is required for transport "embedded"');
    if (!config.sip.publicIp) problems.push("sip.publicIp is required behind NAT, otherwise no RTP arrives");
  }
  if (config.media.rtpPortMax <= config.media.rtpPortMin) {
    problems.push("media.rtpPortMax must be > media.rtpPortMin");
  }
  if (config.inbound.pin.enabled && !config.inbound.pin.code) {
    problems.push("inbound.pin.code is required when inbound.pin.enabled is true");
  }
  if (config.media.host !== "127.0.0.1" && config.media.host !== "localhost" && !config.media.authToken) {
    problems.push("media.authToken is required when media.host is not loopback, to prevent unauthenticated media connections");
  }
  if (config.voice.enabled && config.voice.engine === "deepgram-agent") {
    const agent = config.voice.agent;
    if (!config.stt.apiKey) problems.push('stt.apiKey is required for voice.engine "deepgram-agent"');
    if (!agent.think.model) problems.push('voice.agent.think.model is required for voice.engine "deepgram-agent"');
    if (!agent.prompt) problems.push('voice.agent.prompt is required for voice.engine "deepgram-agent"');
    if (config.tts.provider === "custom") problems.push('tts.provider must be "deepgram" or "elevenlabs" for voice.engine "deepgram-agent"');
    if (config.tts.provider === "elevenlabs") {
      if (!config.tts.apiKey) problems.push("tts.apiKey is required for elevenlabs via Deepgram");
      if (!config.tts.voice) problems.push("tts.voice is required for elevenlabs via Deepgram");
    }
    if (!(config.tts.voice ?? config.tts.model)) problems.push('tts.voice or tts.model is required for voice.engine "deepgram-agent"');
    if (["google", "groq", "aws_bedrock"].includes(agent.think.provider) && !agent.think.endpoint) {
      problems.push(`voice.agent.think.endpoint is required for provider "${agent.think.provider}"`);
    }
  } else if (config.voice.enabled) {
    if (config.tts.provider === "elevenlabs") problems.push('elevenlabs requires voice.engine "deepgram-agent"; native ElevenLabs TTS is disabled');
    if (!config.stt.apiKey) problems.push("stt.apiKey is required when voice.enabled");
    if (!config.tts.apiKey) problems.push("tts.apiKey is required when voice.enabled");
    if (config.tts.provider === "elevenlabs" && !config.tts.voice) {
      problems.push("tts.voice is required for elevenlabs");
    }
    if (config.tts.provider === "custom") {
      if (!config.tts.baseUrl) problems.push("tts.baseUrl is required for custom");
      if (!config.tts.model) problems.push("tts.model is required for custom");
      if (!config.tts.voice) problems.push("tts.voice is required for custom");
      if (config.tts.sourceSampleRate !== 24e3) problems.push("tts.sourceSampleRate must explicitly be 24000 for OpenAI-compatible PCM");
    }
  }
  return problems;
}

// src/channelConfig.ts
var sections = ["sip", "media", "audio", "inbound", "stt", "tts", "voice"];
var isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
function resolveSipConfig(cfg, legacy = cfg?.plugins?.entries?.["sip"]?.config) {
  const channel = cfg?.channels?.["sip"];
  if (channel === void 0) return parseSipConfig(legacy);
  if (!isObject(channel)) throw new Error("invalid sip plugin config: channels.sip must be an object");
  if (legacy != null && !isObject(legacy)) return parseSipConfig(legacy);
  const base = legacy ?? {};
  const merged = { ...base, ...channel };
  delete merged["heartbeatVisibility"];
  const mergePresets = (left, right) => {
    if (!isObject(left) || !isObject(right)) return right;
    const result = { ...left, ...right };
    for (const key of Object.keys(right)) {
      if (isObject(left[key]) && isObject(right[key])) result[key] = mergePresets(left[key], right[key]);
    }
    return result;
  };
  for (const section of sections) {
    if (isObject(base[section]) && isObject(channel[section])) {
      merged[section] = mergePresets(base[section], channel[section]);
    }
  }
  if (channel["providerPresets"] !== void 0) {
    merged["providerPresets"] = mergePresets(base["providerPresets"], channel["providerPresets"]);
  }
  return parseSipConfig(merged);
}

// src/setup.ts
import { defineChannelSetupContract } from "openclaw/plugin-sdk/channel-setup";
import { isIPv4 as isIPv42 } from "node:net";
var object = (value) => value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
function setupValue(cfg, section, key) {
  const channel = object(cfg.channels?.["sip"]);
  const legacy = object(cfg.plugins?.entries?.["sip"]?.config);
  return object(channel[section])[key] ?? object(legacy[section])[key];
}
function patchSipSetup(cfg, patch) {
  const channel = object(cfg.channels?.["sip"]);
  const next = { ...channel, ...patch };
  for (const [key, value] of Object.entries(patch)) {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      next[key] = { ...object(channel[key]), ...object(value) };
    }
  }
  return { ...cfg, channels: { ...cfg.channels, sip: next } };
}
function defaultAccount(accountId) {
  if (accountId && accountId !== "default") throw new Error('SIP supports only account "default"');
  return "default";
}
function setupProblems(cfg) {
  let candidate = cfg;
  for (const [section, key] of [["sip", "password"], ["stt", "apiKey"], ["tts", "apiKey"]]) {
    const value = setupValue(cfg, section, key);
    if (value && typeof value === "object") candidate = patchSipSetup(candidate, { [section]: { [key]: "secret-reference" } });
  }
  try {
    const config = resolveSipConfig(candidate);
    const problems = validateForTransport(config);
    if (config.transport !== "embedded") problems.push("SIP channel requires embedded transport");
    if (config.inbound.policy === "allowlist" && !config.inbound.allowFrom.length) problems.push("inbound.allowFrom requires at least one E.164 caller");
    if (config.inbound.allowFrom.some((value) => !/^\+[1-9]\d{1,14}$/.test(value))) problems.push("inbound.allowFrom must contain E.164 callers");
    return problems;
  } catch {
    return ["SIP configuration invalid; check channel settings"];
  }
}
var sipSetupContract = defineChannelSetupContract({
  fields: {},
  adapter: {
    resolveAccountId: ({ accountId }) => defaultAccount(accountId),
    validateInput: ({ cfg, accountId }) => {
      defaultAccount(accountId);
      return setupProblems(cfg).join("; ") || null;
    },
    applyAccountConfig: ({ cfg, accountId }) => {
      defaultAccount(accountId);
      const problems = setupProblems(cfg);
      if (problems.length) throw new Error(problems.join("; "));
      return patchSipSetup(cfg, { enabled: true });
    }
  }
});
function text(section, key, message, validate) {
  return {
    inputKey: `${section}.${key}`,
    message,
    required: true,
    currentValue: ({ cfg }) => {
      const value = setupValue(cfg, section, key);
      return typeof value === "string" ? value : void 0;
    },
    confirmCurrentValue: true,
    applyCurrentValue: false,
    keepPrompt: "Keep the existing value?",
    validate: ({ value }) => validate?.(value) ?? (value.trim() ? void 0 : "A value is required"),
    normalizeValue: ({ value }) => value.trim(),
    applySet: ({ cfg, value }) => patchSipSetup(cfg, { [section]: { [key]: value } })
  };
}
function credential(section, key, label) {
  return {
    inputKey: `${section}.${key}`,
    providerHint: "sip",
    credentialLabel: label,
    envPrompt: "Use an environment value?",
    keepPrompt: `Keep ${label}?`,
    inputPrompt: `Enter ${label}`,
    allowEnv: () => false,
    shouldPrompt: ({ cfg }) => section === "sip" || setupValue(cfg, "voice", "enabled") === true,
    inspect: ({ cfg }) => {
      const value = setupValue(cfg, section, key);
      return { accountConfigured: Boolean(value), hasConfiguredValue: Boolean(value) };
    },
    applySet: ({ cfg, value }) => patchSipSetup(cfg, { [section]: { [key]: value } })
  };
}
var sipSetupWizard = {
  channel: "sip",
  status: {
    configuredLabel: "SIP configured",
    unconfiguredLabel: "SIP not configured",
    resolveConfigured: ({ cfg }) => setupProblems(cfg).length === 0
  },
  resolveAccountIdForConfigure: ({ accountOverride }) => defaultAccount(accountOverride),
  resolveShouldPromptAccountIds: () => false,
  introNote: { title: "SIP Telephony", lines: ["One account: default. Existing settings and credentials are preserved.", "Embedded SIP needs a public IPv4 and open SIP/RTP ports. No connectivity tests run during setup."] },
  prepare: async ({ cfg, prompter }) => {
    const voice = await prompter.confirm({ message: "Enable voice replies (STT and TTS required)?", initialValue: setupValue(cfg, "voice", "enabled") === true });
    if (object(cfg.channels?.["sip"])["transport"] === "bridge" || object(cfg.channels?.["sip"])["transport"] === void 0 && object(cfg.plugins?.entries?.["sip"]?.config)["transport"] === "bridge") {
      if (!await prompter.confirm({ message: "The SIP channel requires embedded transport. Change transport to embedded?", initialValue: false })) throw new Error("SIP channel requires embedded transport");
    }
    let next = patchSipSetup(cfg, { transport: "embedded", voice: { enabled: voice } });
    if (voice) {
      const current = setupValue(cfg, "tts", "provider");
      const provider = await prompter.select({ message: "TTS provider", options: ["deepgram", "elevenlabs", "custom"].map((value) => ({ value, label: value })), initialValue: typeof current === "string" ? current : void 0 });
      next = patchSipSetup(next, { tts: { provider } });
      if (provider === "custom" && setupValue(next, "tts", "sourceSampleRate") !== 24e3) {
        if (!await prompter.confirm({ message: "Does this TTS endpoint return mono PCM16-LE at 24000 Hz? Confirm only after verifying.", initialValue: false })) {
          throw new Error("Custom TTS requires confirmed mono PCM16-LE at 24000 Hz");
        }
        next = patchSipSetup(next, { tts: { sourceSampleRate: 24e3 } });
      }
    }
    return { cfg: next };
  },
  stepOrder: "text-first",
  textInputs: [
    text("sip", "user", "SIP user"),
    text("sip", "domain", "SIP domain"),
    text("sip", "registrar", "SIP registrar"),
    text("sip", "publicIp", "Public IPv4 for SIP/RTP", (value) => isIPv42(value) ? void 0 : "IPv4 required"),
    {
      inputKey: "allowFrom",
      message: "Allowed callers (E.164, comma or space separated)",
      required: true,
      shouldPrompt: ({ cfg }) => setupValue(cfg, "inbound", "policy") !== "open",
      currentValue: ({ cfg }) => {
        const value = setupValue(cfg, "inbound", "allowFrom");
        return Array.isArray(value) ? value.join(", ") : void 0;
      },
      confirmCurrentValue: true,
      applyCurrentValue: false,
      validate: ({ value }) => value.trim().split(/[\s,;]+/).every((entry2) => /^\+[1-9]\d{1,14}$/.test(entry2)) ? void 0 : "E.164 required",
      applySet: ({ cfg, value }) => patchSipSetup(cfg, { inbound: { allowFrom: value.trim().split(/[\s,;]+/) } })
    },
    ...["model", "voice"].map((key) => ({
      ...text("tts", key, `TTS ${key}`),
      shouldPrompt: ({ cfg }) => setupValue(cfg, "voice", "enabled") === true && ["elevenlabs", "custom"].includes(String(setupValue(cfg, "tts", "provider")))
    }))
  ],
  credentials: [credential("sip", "password", "SIP password"), credential("stt", "apiKey", "STT API key"), credential("tts", "apiKey", "TTS API key")],
  finalize: ({ cfg }) => {
    const problems = setupProblems(cfg);
    if (problems.length) throw new Error(problems.join("; "));
    return { cfg: patchSipSetup(cfg, { enabled: true }) };
  },
  disable: (cfg) => patchSipSetup(cfg, { enabled: false })
};

// src/media/mediaServer.ts
import { EventEmitter } from "node:events";
import { WebSocketServer } from "ws";

// src/media/twilioFrames.ts
var MULAW_FRAME_BYTES = 160;
var TELEPHONY_SAMPLE_RATE = 8e3;
var MAX_FRAME_CHARS = 262144;
var MAX_IDENTIFIER_CHARS = 256;
var MAX_CUSTOM_PARAMETERS = 128;
var MAX_CUSTOM_VALUE_CHARS = 2048;
var MAX_PAYLOAD_CHARS = 65536;
function isObject2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function boundedString(value, max, nonempty = false) {
  return typeof value === "string" && value.length <= max && (!nonempty || value.trim().length > 0);
}
function optionalString(object2, key, max, nonempty = false) {
  return !Object.hasOwn(object2, key) || boundedString(object2[key], max, nonempty);
}
function validStart(value, streamSid) {
  if (!isObject2(value)) return false;
  if (!optionalString(value, "streamSid", MAX_IDENTIFIER_CHARS, true) || Object.hasOwn(value, "streamSid") && value["streamSid"] !== streamSid || !optionalString(value, "callSid", MAX_IDENTIFIER_CHARS, true) || // The embedded bridge deliberately sends an empty accountSid.
  !optionalString(value, "accountSid", MAX_IDENTIFIER_CHARS)) return false;
  if (Object.hasOwn(value, "tracks")) {
    const tracks = value["tracks"];
    if (!Array.isArray(tracks) || tracks.length > 2 || !tracks.every((track) => track === "inbound" || track === "outbound")) return false;
  }
  if (Object.hasOwn(value, "customParameters")) {
    const custom = value["customParameters"];
    if (!isObject2(custom)) return false;
    const entries = Object.entries(custom);
    if (entries.length > MAX_CUSTOM_PARAMETERS || !entries.every(([key, entry2]) => boundedString(key, MAX_IDENTIFIER_CHARS, true) && boundedString(entry2, MAX_CUSTOM_VALUE_CHARS))) return false;
  }
  if (Object.hasOwn(value, "mediaFormat")) {
    const format = value["mediaFormat"];
    if (!isObject2(format) || !boundedString(format["encoding"], 128, true) || typeof format["sampleRate"] !== "number" || !Number.isSafeInteger(format["sampleRate"]) || format["sampleRate"] <= 0 || format["sampleRate"] > 192e3 || Object.hasOwn(format, "channels") && (typeof format["channels"] !== "number" || !Number.isSafeInteger(format["channels"]) || format["channels"] <= 0 || format["channels"] > 32)) return false;
  }
  return true;
}
function validPayload(value) {
  if (!boundedString(value, MAX_PAYLOAD_CHARS)) return false;
  if (/[^A-Za-z0-9+/=]/.test(value)) return false;
  const padding = value.indexOf("=");
  if (padding < 0) return value.length % 4 !== 1;
  return value.length % 4 === 0 && (value.endsWith("==") ? padding === value.length - 2 : padding === value.length - 1);
}
function parseMediaStreamsFrame(raw) {
  if (typeof raw !== "string" || raw.length > MAX_FRAME_CHARS) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObject2(parsed)) return null;
  const frame = parsed;
  const event = frame["event"];
  if (event !== "connected" && !boundedString(frame["streamSid"], MAX_IDENTIFIER_CHARS, true)) return null;
  if (!optionalString(frame, "sequenceNumber", 32, true)) return null;
  switch (event) {
    case "start":
      if (Object.hasOwn(frame, "start") && !validStart(frame["start"], frame["streamSid"])) return null;
      break;
    case "media": {
      const media = frame["media"];
      if (!isObject2(media) || !validPayload(media["payload"]) || !optionalString(media, "track", 32, true) || !optionalString(media, "chunk", 32, true) || !optionalString(media, "timestamp", 32, true)) return null;
      break;
    }
    case "mark":
      if (!isObject2(frame["mark"]) || !boundedString(frame["mark"]["name"], 256, true)) return null;
      break;
    case "dtmf":
      if (!isObject2(frame["dtmf"]) || typeof frame["dtmf"]["digit"] !== "string" || !/^[0-9A-Da-d*#]$/.test(frame["dtmf"]["digit"]) || !optionalString(frame["dtmf"], "track", 32, true)) return null;
      break;
    case "stop":
      if (Object.hasOwn(frame, "stop") && (!isObject2(frame["stop"]) || !optionalString(frame["stop"], "callSid", MAX_IDENTIFIER_CHARS, true) || !optionalString(frame["stop"], "accountSid", MAX_IDENTIFIER_CHARS))) return null;
      break;
    case "connected":
      if (!optionalString(frame, "protocol", 128, true) || !optionalString(frame, "version", 128, true) || !optionalString(frame, "streamSid", MAX_IDENTIFIER_CHARS, true)) return null;
      break;
    case "clear":
      break;
    default:
      return null;
  }
  return parsed;
}
function decodeMediaPayload(event) {
  return new Uint8Array(Buffer.from(event.media.payload, "base64"));
}
function buildMediaFrame(streamSid, mulaw) {
  return JSON.stringify({
    event: "media",
    streamSid,
    media: { payload: Buffer.from(mulaw).toString("base64") }
  });
}
function buildMarkFrame(streamSid, name) {
  return JSON.stringify({ event: "mark", streamSid, mark: { name } });
}
function buildClearFrame(streamSid) {
  return JSON.stringify({ event: "clear", streamSid });
}

// src/media/codecs.ts
import { G722Decoder, G722Encoder } from "g722-spandsp";

// src/media/ulaw.ts
var MULAW_BIAS = 132;
var MULAW_CLIP = 32635;
function mulawDecodeSample(byte) {
  const u = ~byte & 255;
  let sample = ((u & 15) << 3) + MULAW_BIAS;
  sample <<= (u & 112) >> 4;
  sample -= MULAW_BIAS;
  const signed = (u & 128) !== 0 ? -sample : sample;
  return signed === 0 ? 0 : signed;
}
function mulawEncodeSample(sample) {
  let value = sample;
  let sign2 = 0;
  if (value < 0) {
    value = -value;
    sign2 = 128;
  }
  if (value > MULAW_CLIP) value = MULAW_CLIP;
  value += MULAW_BIAS;
  let exponent = 7;
  for (let mask = 16384; exponent > 0 && (value & mask) === 0; mask >>= 1) {
    exponent -= 1;
  }
  const mantissa = value >> exponent + 3 & 15;
  return ~(sign2 | exponent << 4 | mantissa) & 255;
}
function mulawToPcm16(mulaw) {
  const out = new Uint8Array(mulaw.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < mulaw.length; i += 1) {
    view.setInt16(i * 2, mulawDecodeSample(mulaw[i]), true);
  }
  return out;
}
function pcm16ToMulaw(pcm) {
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const out = new Uint8Array(Math.floor(pcm.byteLength / 2));
  for (let i = 0; i < out.length; i += 1) {
    out[i] = mulawEncodeSample(view.getInt16(i * 2, true));
  }
  return out;
}
function mulawDecodeTable(byte) {
  const u = ~byte & 255;
  const sign2 = u & 128;
  const exponent = (u & 112) >> 4;
  const mantissa = u & 15;
  const sample = (mantissa << 3) + MULAW_BIAS << exponent;
  const signed = sample - MULAW_BIAS;
  const value = sign2 !== 0 ? -signed : signed;
  return value === 0 ? 0 : value;
}
var MULAW_DECODE_TABLE = (() => {
  const table = new Int16Array(256);
  for (let i = 0; i < 256; i += 1) table[i] = mulawDecodeTable(i);
  return table;
})();

// src/media/codecs.ts
function codecFromFormat(encoding, sampleRate) {
  if (sampleRate === TELEPHONY_SAMPLE_RATE && encoding === "audio/x-mulaw") return "pcmu";
  if (sampleRate === TELEPHONY_SAMPLE_RATE && encoding === "audio/x-alaw") return "pcma";
  if (sampleRate === TELEPHONY_SAMPLE_RATE * 2 && encoding === "audio/G722") return "g722";
  return void 0;
}
function alawDecodeSample(byte) {
  const value = byte ^ 85;
  const segment = (value & 112) >> 4;
  let sample = (value & 15) << 4;
  sample += segment === 0 ? 8 : 264;
  if (segment > 1) sample <<= segment - 1;
  return value & 128 ? sample : -sample;
}
function alawEncodeSample(sample) {
  let value = sample;
  const mask = value >= 0 ? 213 : 85;
  if (value < 0) value = -value - 1;
  value = Math.min(value, 32767);
  let segment = 0;
  for (let limit = 255; value > limit && segment < 7; limit = limit << 1 | 1) segment++;
  const quantized = segment < 2 ? value >> 4 & 15 : value >> segment + 3 & 15;
  return (segment << 4 | quantized) ^ mask;
}
function alawToPcm16(data) {
  const result = Buffer.allocUnsafe(data.length * 2);
  for (let index = 0; index < data.length; index++) result.writeInt16LE(alawDecodeSample(data[index]), index * 2);
  return result;
}
function pcm16ToAlaw(data) {
  if (data.length % 2) throw new Error("Incomplete PCM sample");
  const source = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const result = Buffer.allocUnsafe(data.length / 2);
  for (let index = 0; index < result.length; index++) result[index] = alawEncodeSample(source.readInt16LE(index * 2));
  return result;
}
var CallCodec = class {
  constructor(codec = "pcmu") {
    this.codec = codec;
    this.sampleRate = codec === "g722" ? TELEPHONY_SAMPLE_RATE * 2 : TELEPHONY_SAMPLE_RATE;
    if (codec === "g722") {
      this.encoder = new G722Encoder();
      this.decoder = new G722Decoder();
    }
  }
  codec;
  sampleRate;
  frameBytes = MULAW_FRAME_BYTES;
  encoder;
  decoder;
  decode(data) {
    if (this.codec === "g722") return this.decoder.decode(Buffer.from(data));
    if (this.codec === "pcma") return alawToPcm16(data);
    return Buffer.from(mulawToPcm16(data));
  }
  encode(data) {
    if (data.length % 2) throw new Error("Incomplete PCM sample");
    if (this.codec === "g722") {
      if (data.length % 4) throw new Error("Incomplete G.722 sample pair");
      return this.encoder.encode(Buffer.from(data));
    }
    if (this.codec === "pcma") return pcm16ToAlaw(data);
    return Buffer.from(pcm16ToMulaw(data));
  }
  silence() {
    if (this.codec === "pcmu") return Buffer.alloc(this.frameBytes, 255);
    if (this.codec === "pcma") return Buffer.alloc(this.frameBytes, 213);
    return this.encode(Buffer.alloc(this.sampleRate / 50 * 2));
  }
  reset() {
    this.encoder?.reset();
    this.decoder?.reset();
  }
};

// src/media/callSession.ts
var CallSession = class {
  streamSid;
  media;
  callSid;
  from;
  to;
  startedAt = Date.now();
  state = "starting";
  queue = [];
  partial = Buffer.alloc(0);
  maxQueuedBytes = 64e3;
  prebufferBytes = 0;
  pumping = false;
  pumpTimer = null;
  capacityWaiters = /* @__PURE__ */ new Set();
  playbackGeneration = 0;
  onSend;
  onEndCb;
  constructor(options) {
    this.streamSid = options.streamSid;
    this.media = new CallCodec(options.codec);
    this.callSid = options.callSid;
    this.from = options.from;
    this.to = options.to;
    this.onSend = options.onSend;
    this.onEndCb = options.onEnd;
    this.maxQueuedBytes = options.maxQueuedBytes ?? 64e3;
  }
  get currentState() {
    return this.state;
  }
  setQueueLimit(bytes) {
    this.maxQueuedBytes = bytes;
  }
  /** Streaming-only threshold; completed clips/marks bypass it. */
  setPlaybackPrebuffer(ms) {
    if (!Number.isInteger(ms) || ms < 0 || ms > 2e3 || ms % 20) throw new Error("Invalid playback prebuffer");
    this.prebufferBytes = ms * (TELEPHONY_SAMPLE_RATE / 1e3);
  }
  get queuedBytes() {
    return this.partial.length + this.queue.reduce((total, frame) => total + (typeof frame === "string" ? Buffer.byteLength(frame) : frame.length), 0);
  }
  /** Mark the call active once the gateway reported `start`. */
  activate() {
    if (this.state === "starting") this.state = "active";
  }
  /** Queue outbound mu-law audio (8 kHz) for 20 ms paced playback. */
  sendAudio(mulaw) {
    this.sendAudioChunk(mulaw);
    this.flushAudio();
    this.startPump(true);
  }
  sendAudioChunk(mulaw) {
    if (this.state === "ended") return;
    if (this.queuedBytes + mulaw.length > this.maxQueuedBytes) throw new Error("Outbound audio queue limit");
    const data = Buffer.concat([this.partial, mulaw]);
    let offset = 0;
    for (; offset + MULAW_FRAME_BYTES <= data.length; offset += MULAW_FRAME_BYTES) {
      this.queue.push(Buffer.from(data.subarray(offset, offset + MULAW_FRAME_BYTES)));
    }
    this.partial = Buffer.from(data.subarray(offset));
    this.startPump();
  }
  async waitForCapacity(bytes, signal, generation) {
    if (bytes > this.maxQueuedBytes) throw new Error("Outbound audio queue limit");
    while (true) {
      signal.throwIfAborted();
      if (this.currentState === "ended" || generation !== this.playbackGeneration) throw new Error("Playback cancelled");
      if (this.queuedBytes + bytes <= this.maxQueuedBytes) return;
      this.startPump(true);
      await new Promise((resolve) => {
        const wake = () => {
          this.capacityWaiters.delete(wake);
          signal.removeEventListener("abort", wake);
          resolve();
        };
        this.capacityWaiters.add(wake);
        signal.addEventListener("abort", wake, { once: true });
      });
    }
  }
  async sendAudioChunkAsync(audio, signal) {
    const generation = this.playbackGeneration;
    for (let offset = 0; offset < audio.length; ) {
      const length = Math.min(MULAW_FRAME_BYTES - this.partial.length, audio.length - offset);
      await this.waitForCapacity(length, signal, generation);
      this.sendAudioChunk(audio.subarray(offset, offset + length));
      offset += length;
    }
  }
  async markAsync(name, signal) {
    const generation = this.playbackGeneration;
    await this.waitForCapacity(this.partial.length ? MULAW_FRAME_BYTES - this.partial.length : 0, signal, generation);
    this.flushAudio();
    await this.waitForCapacity(Buffer.byteLength(name), signal, generation);
    this.mark(name);
  }
  flushAudio() {
    if (!this.partial.length) return;
    if (this.queuedBytes + MULAW_FRAME_BYTES - this.partial.length > this.maxQueuedBytes) throw new Error("Outbound audio queue limit");
    const frame = this.media.silence();
    this.partial.copy(frame);
    this.partial = Buffer.alloc(0);
    this.queue.push(frame);
    this.startPump();
  }
  /** Barge-in: drop buffered audio on the gateway and locally. */
  interrupt() {
    this.playbackGeneration++;
    for (const wake of this.capacityWaiters) wake();
    this.queue = [];
    this.partial = Buffer.alloc(0);
    this.media.reset();
    this.pumping = false;
    if (this.pumpTimer) clearInterval(this.pumpTimer);
    this.pumpTimer = null;
    if (this.state !== "ended") this.onSend(buildClearFrame(this.streamSid));
  }
  /** Ask the gateway to confirm playout of everything queued so far. */
  mark(name) {
    if (this.state === "ended") return;
    this.flushAudio();
    if (this.queuedBytes + Buffer.byteLength(name) > this.maxQueuedBytes) throw new Error("Outbound mark queue limit");
    this.queue.push(name);
    this.startPump(true);
  }
  end(reason) {
    if (this.state === "ended") return;
    this.state = "ended";
    for (const wake of this.capacityWaiters) wake();
    this.pumping = false;
    this.queue = [];
    this.partial = Buffer.alloc(0);
    if (this.pumpTimer) {
      clearInterval(this.pumpTimer);
      this.pumpTimer = null;
    }
    this.onEndCb?.(reason);
  }
  startPump(force = false) {
    if (this.pumping || this.state === "ended") return;
    const threshold = Math.min(this.prebufferBytes, Math.floor(this.maxQueuedBytes / MULAW_FRAME_BYTES) * MULAW_FRAME_BYTES);
    const audioBytes = this.queue.reduce((total, frame) => total + (typeof frame === "string" ? 0 : frame.length), 0);
    if (!force && audioBytes < threshold) return;
    this.pumping = true;
    const tick = () => {
      const frame = this.queue.shift();
      for (const wake of this.capacityWaiters) wake();
      if (!frame) {
        this.pumping = false;
        if (this.pumpTimer) {
          clearInterval(this.pumpTimer);
          this.pumpTimer = null;
        }
        return;
      }
      if (typeof frame === "string") this.onSend(buildMarkFrame(this.streamSid, frame));
      else this.onSend(buildMediaFrame(this.streamSid, frame));
    };
    this.pumpTimer = setInterval(tick, MULAW_FRAME_BYTES / (TELEPHONY_SAMPLE_RATE / 1e3));
  }
};
var CallRegistry = class {
  calls = /* @__PURE__ */ new Map();
  add(session) {
    if (this.calls.has(session.streamSid)) throw new Error("Duplicate active streamSid");
    this.calls.set(session.streamSid, session);
  }
  get(streamSid) {
    return this.calls.get(streamSid);
  }
  remove(session) {
    if (this.calls.get(session.streamSid) === session) this.calls.delete(session.streamSid);
  }
  get size() {
    return this.calls.size;
  }
  list() {
    return [...this.calls.values()];
  }
  /** Hang up every live call, e.g. on plugin deactivation. */
  terminateAll(reason) {
    for (const call of this.calls.values()) call.end(reason);
    this.calls.clear();
  }
};

// src/media/mediaServer.ts
var MediaServer = class extends EventEmitter {
  registry = new CallRegistry();
  server = null;
  stopping = null;
  options;
  constructor(options) {
    super();
    this.options = options;
  }
  /** Bind the media endpoint. Rejects when host/port/path are unusable. */
  start() {
    if (this.server) return Promise.resolve();
    const { host, port, path } = this.options;
    return new Promise((resolve, reject) => {
      const server = new WebSocketServer({
        host,
        port,
        path,
        verifyClient: (info, callback) => {
          if (!this.options.authToken) {
            callback(true);
            return;
          }
          const authHeader = info.req.headers["authorization"];
          let token;
          if (authHeader?.startsWith("Bearer ")) {
            token = authHeader.slice(7).trim();
          } else {
            try {
              const parsedUrl = new URL(info.req.url ?? "", `http://${info.req.headers.host ?? "localhost"}`);
              token = parsedUrl.searchParams.get("token") ?? void 0;
            } catch {
            }
          }
          if (token && token === this.options.authToken) {
            callback(true);
          } else {
            this.options.onLog?.("media-unauthorized", {
              remote: info.req.socket.remoteAddress ?? "unknown"
            });
            callback(false, 401, "Unauthorized");
          }
        }
      });
      server.once("listening", () => {
        this.server = server;
        resolve();
      });
      server.once("error", (err) => {
        server.close();
        reject(err);
      });
      server.on(
        "connection",
        (socket, request) => this.attach(socket, request.socket.remoteAddress ?? "unknown")
      );
    });
  }
  get address() {
    const addr = this.server?.address();
    return typeof addr === "object" && addr !== null ? { address: addr.address, port: addr.port } : null;
  }
  stop() {
    if (this.stopping) return this.stopping;
    this.registry.terminateAll("server-stop");
    const server = this.server;
    this.server = null;
    this.stopping = new Promise((resolve, reject) => {
      if (!server) {
        resolve();
        return;
      }
      for (const socket of server.clients) socket.terminate();
      server.close((error) => error ? reject(error) : resolve());
    });
    return this.stopping;
  }
  /** Diagnostics must not become an unhandled EventEmitter error (or throw from a listener). */
  reportError(error) {
    try {
      if (this.listenerCount("error"))
        this.emit("error", error instanceof Error ? error : new Error(String(error)));
    } catch {
    }
  }
  log(message, fields) {
    try {
      this.options.onLog?.(message, fields);
    } catch (error) {
      this.reportError(error);
    }
  }
  attach(socket, remote) {
    let session = null;
    const fail = (error) => {
      try {
        session?.end("media-message-error");
      } catch (cleanupError) {
        this.reportError(cleanupError);
      } finally {
        socket.terminate();
      }
      this.reportError(error);
    };
    this.log("media-connection-open", { remote });
    socket.on("message", (data) => {
      try {
        const event = parseMediaStreamsFrame(String(data));
        if (!event)
          return;
        if (event.event !== "start" && "streamSid" in event && (!session || event.streamSid !== session.streamSid || session.currentState === "ended"))
          return;
        switch (event.event) {
          case "start": {
            if (session || this.registry.get(event.streamSid)) {
              socket.terminate();
              return;
            }
            const start = event.start;
            const format = start.mediaFormat;
            const codec = format ? codecFromFormat(format.encoding ?? "", format.sampleRate ?? 0) : "pcmu";
            if (!codec || format?.channels !== void 0 && format.channels !== 1) {
              throw new Error("Unsupported mono media stream codec or sample rate");
            }
            const custom = start.customParameters ?? {};
            const started = new CallSession({
              streamSid: event.streamSid,
              codec,
              callSid: start.callSid,
              from: custom["From"] ?? custom["from"] ?? custom["caller"],
              to: custom["To"] ?? custom["to"] ?? custom["dialed"],
              onSend: (payload) => {
                try {
                  if (socket.readyState !== socket.OPEN)
                    return;
                  if (socket.bufferedAmount + Buffer.byteLength(payload) > 262144) {
                    started.end("media-backpressure");
                    return;
                  }
                  socket.send(payload, (error) => {
                    if (error)
                      fail(error);
                  });
                } catch (error) {
                  fail(error);
                }
              },
              onEnd: (reason) => {
                this.registry.remove(started);
                try {
                  this.emit("end", started.streamSid, reason, started);
                } catch (error) {
                  this.reportError(error);
                } finally {
                  socket.terminate();
                }
              }
            });
            session = started;
            this.registry.add(started);
            started.activate();
            this.options.onLog?.("call-start", { streamSid: started.streamSid, remote });
            this.emit("call", started, custom);
            break;
          }
          case "media":
            if (session)
              this.emit("audio", session, decodeMediaPayload(event));
            break;
          case "dtmf":
            if (session)
              this.emit("dtmf", session, event.dtmf.digit);
            break;
          case "mark":
            if (session)
              this.emit("mark", session, event.mark.name);
            break;
          case "stop":
            session?.end("gateway-stop");
            break;
          default:
            break;
        }
      } catch (error) {
        fail(error);
      }
    });
    socket.on("close", () => {
      try {
        session?.end("websocket-close");
      } catch (error) {
        this.reportError(error);
      }
      this.log("media-connection-close", { remote });
    });
    socket.on("error", fail);
  }
};

// src/embedded/embeddedTransport.ts
import { Writable as Writable2 } from "node:stream";

// vendor/sip-bridge/src/bridge/callManager.ts
import crypto from "node:crypto";
import os from "node:os";
import { G722Encoder as G722Encoder2 } from "g722-spandsp";

// vendor/sip-bridge/src/config/listenAddr.ts
function listenParts(addr) {
  const i = addr.lastIndexOf(":");
  return { host: addr.slice(0, i), port: parseInt(addr.slice(i + 1), 10) };
}

// vendor/sip-bridge/src/rtp/rtpHandler.ts
import { randomBytes } from "node:crypto";
import * as dgram from "node:dgram";
import { EventEmitter as EventEmitter2 } from "node:events";

// vendor/sip-bridge/src/srtp/srtpContext.ts
import { createCipheriv, createHmac, timingSafeEqual } from "node:crypto";
var LABEL_ENC = 0;
var LABEL_AUTH = 1;
var LABEL_SALT = 2;
function deriveKey(masterKey, masterSalt, label, length) {
  const iv = Buffer.alloc(16, 0);
  masterSalt.copy(iv);
  iv[7] ^= label;
  const blocks = Math.ceil(length / 16);
  const plaintext = Buffer.alloc(blocks * 16, 0);
  const cipher = createCipheriv("aes-128-ctr", masterKey, iv);
  return cipher.update(plaintext).subarray(0, length);
}
function computeIV(sessionSalt, ssrc, packetIndex) {
  const iv = Buffer.alloc(16, 0);
  sessionSalt.copy(iv);
  iv[4] ^= ssrc >>> 24 & 255;
  iv[5] ^= ssrc >>> 16 & 255;
  iv[6] ^= ssrc >>> 8 & 255;
  iv[7] ^= ssrc & 255;
  for (let byte = 0; byte < 6; byte++) {
    iv[13 - byte] ^= Number(packetIndex >> BigInt(byte * 8) & 0xffn);
  }
  return iv;
}
var SEQ_WRAP_THRESHOLD = 32768;
var SrtpContext = class {
  encKey;
  // 16-byte session encryption key
  authKey;
  // 20-byte session authentication key (HMAC-SHA1)
  saltKey;
  // 14-byte session salt
  // Per-direction packet index tracking (ROC + SEQ → 48-bit packet index)
  roc = 0;
  lastSeq = -1;
  // RFC 3711 §3.3.2 64-packet replay window for decryption
  replayMaxIndex = -1n;
  replayWindow = 0n;
  // bitmask of received packets relative to replayMaxIndex
  /**
   * Create an SRTP context for a single direction.
   *
   * @param masterKey  16-byte AES-128 master key (from the a=crypto: inline value)
   * @param masterSalt 14-byte master salt (from the a=crypto: inline value)
   */
  constructor(masterKey, masterSalt) {
    if (masterKey.length !== 16 || masterSalt.length !== 14) throw new Error("Invalid SRTP key length");
    this.encKey = deriveKey(masterKey, masterSalt, LABEL_ENC, 16);
    this.authKey = deriveKey(masterKey, masterSalt, LABEL_AUTH, 20);
    this.saltKey = deriveKey(masterKey, masterSalt, LABEL_SALT, 14);
  }
  /**
   * Encrypt a plain RTP packet into an SRTP packet.
   *
   * The input buffer must contain a valid 12-byte RTP header followed by the payload.
   * Returns a new Buffer: RTP header + encrypted payload + 10-byte HMAC-SHA1-80 auth tag.
   */
  encrypt(rtpPacket) {
    if (rtpPacket.length < 12) throw new Error("SRTP encrypt: RTP packet too short");
    const ssrc = rtpPacket.readUInt32BE(8);
    const seq = rtpPacket.readUInt16BE(2);
    const headerLen = this.rtpHeaderLength(rtpPacket);
    this.validatePadding(rtpPacket, headerLen);
    const packetIndex = this.getOutboundPacketIndex(seq);
    const header = rtpPacket.subarray(0, headerLen);
    const payload = rtpPacket.subarray(headerLen);
    const iv = computeIV(this.saltKey, ssrc, packetIndex);
    const cipher = createCipheriv("aes-128-ctr", this.encKey, iv);
    const encryptedPayload = cipher.update(payload);
    const encPacket = Buffer.concat([header, encryptedPayload]);
    const rocBuf = Buffer.alloc(4);
    rocBuf.writeUInt32BE(Number(packetIndex >> 16n), 0);
    const hmac = createHmac("sha1", this.authKey);
    hmac.update(encPacket);
    hmac.update(rocBuf);
    const tag = hmac.digest().subarray(0, 10);
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
  estimateIndex(seq) {
    if (this.lastSeq < 0) {
      return { index: BigInt(this.roc) * 65536n + BigInt(seq), candidateRoc: this.roc, advancesLastSeq: true };
    }
    const diff = seq - this.lastSeq;
    if (diff < -SEQ_WRAP_THRESHOLD) {
      const candRoc = this.roc + 1;
      return { index: BigInt(candRoc) * 65536n + BigInt(seq), candidateRoc: candRoc, advancesLastSeq: true };
    }
    if (diff > SEQ_WRAP_THRESHOLD) {
      const candRoc = this.roc - 1;
      return { index: BigInt(candRoc) * 65536n + BigInt(seq), candidateRoc: candRoc, advancesLastSeq: false };
    }
    return { index: BigInt(this.roc) * 65536n + BigInt(seq), candidateRoc: this.roc, advancesLastSeq: seq > this.lastSeq };
  }
  /**
   * Commit verified receiver state (ROC, lastSeq) only AFTER HMAC verification
   * has succeeded (RFC 3711 §3.3.1). Never called on unauthenticated input.
   */
  commitVerifiedIndex(seq, candidateRoc, advancesLastSeq) {
    if (this.lastSeq < 0 || advancesLastSeq) {
      this.lastSeq = seq;
      this.roc = candidateRoc;
    }
  }
  /**
   * Compute the 48-bit SRTP packet index for an OUTBOUND packet. Sender side is
   * authoritative, so state advances immediately.
   */
  getOutboundPacketIndex(seq) {
    const est = this.estimateIndex(seq);
    if (est.candidateRoc < 0 || est.candidateRoc > 4294967295) throw new Error("SRTP packet index exhausted or invalid");
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
  decrypt(srtpPacket) {
    if (srtpPacket.length < 12 + 10) throw new Error("SRTP decrypt: packet too short");
    const tagStart = srtpPacket.length - 10;
    const encPacket = srtpPacket.subarray(0, tagStart);
    const receivedTag = srtpPacket.subarray(tagStart);
    const headerLen = this.rtpHeaderLength(encPacket);
    const ssrc = encPacket.readUInt32BE(8);
    const seq = encPacket.readUInt16BE(2);
    const estimate = this.estimateIndex(seq);
    if (estimate.candidateRoc < 0 || estimate.candidateRoc > 4294967295) throw new Error("SRTP packet index exhausted or invalid");
    const rocBuf = Buffer.alloc(4);
    rocBuf.writeUInt32BE(estimate.candidateRoc, 0);
    const hmac = createHmac("sha1", this.authKey);
    hmac.update(encPacket);
    hmac.update(rocBuf);
    const expectedTag = hmac.digest().subarray(0, 10);
    if (!timingSafeEqual(expectedTag, receivedTag)) {
      throw new Error("SRTP decrypt: authentication tag mismatch");
    }
    const header = encPacket.subarray(0, headerLen);
    const encPayload = encPacket.subarray(headerLen);
    const iv = computeIV(this.saltKey, ssrc, estimate.index);
    const decipher = createCipheriv("aes-128-ctr", this.encKey, iv);
    const decPayload = decipher.update(encPayload);
    const plain = Buffer.concat([header, decPayload]);
    this.validatePadding(plain, headerLen);
    if (!this.checkAndUpdateReplay(estimate.index)) {
      throw new Error("SRTP decrypt: replayed packet dropped");
    }
    this.commitVerifiedIndex(seq, estimate.candidateRoc, estimate.advancesLastSeq);
    return plain;
  }
  validatePadding(pkt, headerLen) {
    if ((pkt[0] & 32) !== 0) {
      const padding = pkt[pkt.length - 1];
      if (!padding || padding > pkt.length - headerLen) throw new Error("Malformed RTP padding");
    }
  }
  rtpHeaderLength(pkt) {
    if (pkt.length < 12 || pkt[0] >>> 6 !== 2) throw new Error("Malformed RTP header");
    const csrcCount = pkt[0] & 15;
    const hasExt = (pkt[0] & 16) !== 0;
    let len = 12 + csrcCount * 4;
    if (len > pkt.length) throw new Error("Malformed RTP CSRC");
    if (hasExt) {
      if (pkt.length < len + 4) throw new Error("Malformed RTP extension");
      len += 4 + pkt.readUInt16BE(len + 2) * 4;
    }
    if (len > pkt.length) throw new Error("Malformed RTP extension length");
    return len;
  }
  /**
   * RFC 3711 §3.3.2 anti-replay check and window advance for decryption.
   * Returns true when the packet index is accepted, false for a duplicate or
   * a packet older than the 64-packet window (replay or stale delivery).
   */
  checkAndUpdateReplay(index) {
    if (this.replayMaxIndex < 0n) {
      this.replayMaxIndex = index;
      this.replayWindow = 1n;
      return true;
    }
    const diff = index - this.replayMaxIndex;
    if (diff > 0n) {
      this.replayWindow = diff >= 64n ? 1n : (this.replayWindow << diff | 1n) & (1n << 64n) - 1n;
      this.replayMaxIndex = index;
      return true;
    }
    const behind = -diff;
    if (behind >= 64n) return false;
    const mask = 1n << behind;
    if ((this.replayWindow & mask) !== 0n) return false;
    this.replayWindow |= mask;
    return true;
  }
};

// vendor/sip-bridge/src/rtp/rtpHandler.ts
var DTMF_DIGIT = {
  0: "0",
  1: "1",
  2: "2",
  3: "3",
  4: "4",
  5: "5",
  6: "6",
  7: "7",
  8: "8",
  9: "9",
  10: "*",
  11: "#",
  12: "A",
  13: "B",
  14: "C",
  15: "D"
};
var nextPort;
var RtpHandlerImpl = class extends EventEmitter2 {
  constructor(socket, localPort, log, audioPt, dtmfPt, silenceByte, decCtx, encCtx) {
    super();
    this.socket = socket;
    this.log = log;
    this.audioPt = audioPt;
    this.dtmfPt = dtmfPt;
    this.localPort = localPort;
    this.silenceByte = silenceByte;
    this.outSsrc = randomBytes(4).readUInt32BE(0);
    this.decCtx = decCtx;
    this.encCtx = encCtx;
    socket.on("message", (buf, rinfo) => this.onMessage(buf, rinfo));
    socket.on("error", (err) => {
      log.error({ err }, "RTP socket error");
    });
  }
  socket;
  log;
  audioPt;
  dtmfPt;
  localPort;
  silenceByte;
  forwardingEnabled = false;
  remoteIp = "";
  remotePort = 0;
  outSeq = 0;
  outTimestamp = 0;
  outSsrc;
  /** RTP timestamp of the last emitted DTMF event — deduplicates RFC 4733 redundant End packets */
  lastDtmfTimestamp = -1;
  /** Locked inbound SSRC (learned from first valid packet) */
  inboundSsrc = null;
  /** True once symmetric RTP has locked the inbound source port */
  symmetricLearned = false;
  /** SRTP decryption context for inbound packets (undefined = plain RTP) */
  decCtx;
  /** SRTP encryption context for outbound packets (undefined = plain RTP) */
  encCtx;
  disposed = false;
  startForwarding() {
    this.forwardingEnabled = true;
  }
  setRemote(ip, port) {
    this.remoteIp = ip;
    this.remotePort = port;
  }
  sendAudio(payload) {
    if (this.disposed) return;
    if (!this.remoteIp || !this.remotePort) {
      this.log.warn("sendAudio called before setRemote — dropping packet");
      return;
    }
    const header = Buffer.allocUnsafe(12);
    header[0] = 128;
    header[1] = this.audioPt & 127;
    header.writeUInt16BE(this.outSeq & 65535, 2);
    this.outSeq++;
    header.writeUInt32BE(this.outTimestamp >>> 0, 4);
    this.outTimestamp = this.outTimestamp + 160 >>> 0;
    header.writeUInt32BE(this.outSsrc, 8);
    let packet = Buffer.concat([header, payload]);
    if (this.encCtx) {
      let encrypted;
      try {
        encrypted = this.encCtx.encrypt(packet);
      } catch (err) {
        this.log.warn({ err }, "SRTP encrypt failed — dropping packet");
        return;
      }
      this.socket.send(encrypted, this.remotePort, this.remoteIp);
      return;
    }
    this.socket.send(packet, this.remotePort, this.remoteIp);
  }
  dispose() {
    this.disposed = true;
    this.forwardingEnabled = false;
    this.socket.removeAllListeners();
    this.removeAllListeners();
    try {
      this.socket.close();
    } catch {
    }
  }
  onMessage(buf, rinfo) {
    if (this.disposed || !this.remoteIp || !this.remotePort || buf.length < 12) return;
    if (this.remoteIp && rinfo.address !== this.remoteIp) {
      this.log.trace({ drop: "ip_mismatch", src: rinfo.address, expected: this.remoteIp }, "RTP dropped: unauthorized source address");
      return;
    }
    if (this.remotePort > 0) {
      if (rinfo.port !== this.remotePort) {
        if (!this.symmetricLearned && this.remoteIp && rinfo.address === this.remoteIp) {
        } else {
          this.log.trace({ drop: "port_mismatch", srcPort: rinfo.port, expected: this.remotePort }, "RTP dropped: unauthorized source port");
          return;
        }
      }
    }
    if (buf.length < 12) return;
    let rtpBuf = buf;
    if (this.decCtx) {
      try {
        rtpBuf = this.decCtx.decrypt(buf);
      } catch {
        this.log.trace("SRTP decrypt failed — dropping inbound packet");
        return;
      }
    }
    if (rtpBuf.length < 12) return;
    const byte0 = rtpBuf[0];
    const csrcCount = byte0 & 15;
    const extBit = (byte0 & 16) !== 0;
    let headerLen = 12 + csrcCount * 4;
    if (extBit) {
      if (rtpBuf.length < headerLen + 4) return;
      headerLen += 4 + rtpBuf.readUInt16BE(headerLen + 2) * 4;
    }
    if (rtpBuf.length < headerLen) return;
    if (rtpBuf[0] >>> 6 !== 2) return;
    let payloadEnd = rtpBuf.length;
    if ((byte0 & 32) !== 0) {
      const padding = rtpBuf[rtpBuf.length - 1];
      if (!padding || padding > payloadEnd - headerLen) return;
      payloadEnd -= padding;
    }
    const payload = rtpBuf.subarray(headerLen, payloadEnd);
    const payloadType = rtpBuf[1] & 127;
    if (payloadType !== this.audioPt && payloadType !== this.dtmfPt) return;
    if (payloadType === this.audioPt && payload.length === 0) return;
    if (payloadType === this.dtmfPt && (payload.length !== 4 || DTMF_DIGIT[payload[0]] === void 0 || (payload[1] & 64) !== 0)) return;
    const packetSsrc = rtpBuf.readUInt32BE(8);
    if (this.inboundSsrc !== null && packetSsrc !== this.inboundSsrc) {
      this.log.trace({ drop: "ssrc_mismatch", ssrc: packetSsrc, expected: this.inboundSsrc }, "RTP dropped: SSRC changed mid-call");
      return;
    }
    this.inboundSsrc = packetSsrc;
    this.remotePort = rinfo.port;
    this.symmetricLearned = true;
    if (!this.forwardingEnabled) return;
    if (payloadType === this.audioPt) {
      this.emit("audio", payload);
      return;
    }
    if (payloadType === this.dtmfPt) {
      if (payload.length < 4) return;
      const isEnd = (payload[1] & 128) !== 0;
      if (isEnd) {
        const eventCode = payload[0];
        const digit = DTMF_DIGIT[eventCode];
        const rtpTimestamp = rtpBuf.readUInt32BE(4);
        if (digit !== void 0 && rtpTimestamp !== this.lastDtmfTimestamp) {
          this.lastDtmfTimestamp = rtpTimestamp;
          this.emit("dtmf", { digit });
        }
      }
      return;
    }
    this.log.trace({ payloadType }, "ignoring unknown RTP payload type");
  }
};
async function createRtpHandler(opts) {
  const {
    portMin,
    portMax,
    log,
    audioPt,
    dtmfPt,
    silenceByte,
    localSrtpKey,
    localSrtpSalt,
    remoteSrtpKey,
    remoteSrtpSalt
  } = opts;
  const materials = [localSrtpKey, localSrtpSalt, remoteSrtpKey, remoteSrtpSalt];
  if (materials.some(Boolean) && !materials.every(Boolean)) throw new Error("Incomplete SRTP keys");
  let decCtx;
  let encCtx;
  if (localSrtpKey && localSrtpSalt && remoteSrtpKey && remoteSrtpSalt) {
    decCtx = new SrtpContext(remoteSrtpKey, remoteSrtpSalt);
    encCtx = new SrtpContext(localSrtpKey, localSrtpSalt);
  }
  if (nextPort === void 0 || nextPort < portMin) {
    nextPort = portMin;
  }
  const rangeSize = portMax - portMin + 1;
  for (let attempt = 0; attempt < rangeSize; attempt++) {
    const port = nextPort;
    nextPort = port >= portMax ? portMin : port + 1;
    try {
      const handler = await bindSocketOnPort(port, log, audioPt, dtmfPt, silenceByte, decCtx, encCtx);
      const portsAhead = portMax - port;
      if (Math.floor(portsAhead / 2) < 10) {
        log.warn({ portsAhead }, "fewer than 10 RTP ports remain free");
      }
      return handler;
    } catch (err) {
      const error = err;
      if (error.code === "EADDRINUSE") {
        log.trace({ port }, "RTP port in use, trying next");
        continue;
      }
      throw err;
    }
  }
  throw new Error(
    `All RTP ports in range ${portMin}–${portMax} are in use. Cannot allocate a port.`
  );
}
function bindSocketOnPort(port, log, audioPt, dtmfPt, silenceByte, decCtx, encCtx) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket("udp4");
    function onError(err) {
      socket.removeListener("listening", onListening);
      reject(err);
    }
    function onListening() {
      socket.removeListener("error", onError);
      const info = socket.address();
      const localPort = typeof info === "object" ? info.port : port;
      resolve(new RtpHandlerImpl(socket, localPort, log, audioPt, dtmfPt, silenceByte, decCtx, encCtx));
    }
    socket.once("error", onError);
    socket.once("listening", onListening);
    socket.bind(port);
  });
}

// vendor/sip-bridge/src/sip/sdp.ts
import { randomBytes as randomBytes2 } from "node:crypto";
import { isIPv4 as isIPv43 } from "node:net";
function selectAudioCodec(offered, mode) {
  const CODEC_MAP = {
    9: { pt: 9, encoding: "audio/G722", sampleRate: 16e3, silenceByte: 0 },
    8: { pt: 8, encoding: "audio/x-alaw", sampleRate: 8e3, silenceByte: 213 },
    0: { pt: 0, encoding: "audio/x-mulaw", sampleRate: 8e3, silenceByte: 255 }
  };
  const PCMU = CODEC_MAP[0];
  if (mode === "best") {
    for (const pref of [9, 8, 0]) {
      if (offered.includes(pref)) return CODEC_MAP[pref];
    }
    return PCMU;
  }
  return PCMU;
}
function parseSdpOffer(sdpBody) {
  const cMatch = sdpBody.match(/^c=IN IP4 (\S+)/m);
  if (!cMatch) return null;
  const remoteIp = cMatch[1];
  if (!isIPv43(remoteIp) || remoteIp === "0.0.0.0" || remoteIp === "255.255.255.255") return null;
  if (/^22[4-9]\./.test(remoteIp) || /^23[0-9]\./.test(remoteIp) || /^24[0-9]\./.test(remoteIp) || /^25[0-5]\./.test(remoteIp)) return null;
  const mMatch = sdpBody.match(/^m=audio\s+(\d+)\s+(RTP\/S?AVP)\s+([\d ]+)/m);
  if (!mMatch) return null;
  const remotePort = parseInt(mMatch[1], 10);
  if (!Number.isInteger(remotePort) || remotePort < 1 || remotePort > 65535) return null;
  const protocol = mMatch[2];
  const payloadTypes = mMatch[3].trim().split(/\s+/);
  const isSrtp = protocol === "RTP/SAVP";
  const rtpmaps = {};
  for (const m of sdpBody.matchAll(/^a=rtpmap:(\d+) ([^/\r\n]+)/gm)) {
    rtpmaps[parseInt(m[1], 10)] = m[2].trim().toLowerCase();
  }
  let dtmfPt = 101;
  const audioPts = [];
  for (const ptStr of payloadTypes) {
    const pt = parseInt(ptStr, 10);
    const codecName = rtpmaps[pt];
    if (codecName === "telephone-event") {
      dtmfPt = pt;
    } else {
      audioPts.push(pt);
    }
  }
  let remoteSrtpKey;
  let remoteSrtpSalt;
  if (isSrtp) {
    for (const m of sdpBody.matchAll(/^a=crypto:\d+\s+AES_128_CM_HMAC_SHA1_80\s+inline:([A-Za-z0-9+/]+)\r?$/gim)) {
      try {
        const keyAndSalt = Buffer.from(m[1], "base64");
        if (/^[A-Za-z0-9+/]{40}$/.test(m[1]) && keyAndSalt.length === 30) {
          remoteSrtpKey = keyAndSalt.subarray(0, 16);
          remoteSrtpSalt = keyAndSalt.subarray(16, 30);
          break;
        }
      } catch {
      }
    }
  }
  if (isSrtp && (!remoteSrtpKey || !remoteSrtpSalt)) return null;
  return { remoteIp, remotePort, dtmfPt, audioPts, isSrtp, remoteSrtpKey, remoteSrtpSalt };
}
function buildSdpAnswer(localIp, localRtpPort, offer, mode, srtpEnabled, localSrtpKey, localSrtpSalt) {
  if (offer.isSrtp && (!srtpEnabled || offer.remoteSrtpKey?.length !== 16 || offer.remoteSrtpSalt?.length !== 14)) throw new Error("Cannot answer SAVP without SRTP");
  if (localSrtpKey && localSrtpKey.length !== 16 || localSrtpSalt && localSrtpSalt.length !== 14) throw new Error("Invalid local SRTP keys");
  const { dtmfPt, audioPts } = offer;
  const preferredCodecs = [];
  if (mode === "best") {
    for (const c of [
      { pt: 9, name: "G722" },
      { pt: 8, name: "PCMA" },
      { pt: 0, name: "PCMU" }
    ]) {
      if (audioPts.includes(c.pt)) preferredCodecs.push(c);
    }
  } else {
    preferredCodecs.push({ pt: 0, name: "PCMU" });
  }
  const fmtPts = [...preferredCodecs.map((c) => c.pt), dtmfPt].join(" ");
  const useSrtp = srtpEnabled && offer.isSrtp;
  const protocol = useSrtp ? "RTP/SAVP" : "RTP/AVP";
  const lines = [
    "v=0",
    `o=sipgate-sip-stream-bridge 0 0 IN IP4 ${localIp}`,
    "s=sipgate-sip-stream-bridge",
    `c=IN IP4 ${localIp}`,
    "t=0 0",
    `m=audio ${localRtpPort} ${protocol} ${fmtPts}`
  ];
  let outLocalSrtpKey;
  let outLocalSrtpSalt;
  if (useSrtp) {
    outLocalSrtpKey = localSrtpKey ?? randomBytes2(16);
    outLocalSrtpSalt = localSrtpSalt ?? randomBytes2(14);
    const keyAndSalt = Buffer.concat([outLocalSrtpKey, outLocalSrtpSalt]);
    lines.push(`a=crypto:1 AES_128_CM_HMAC_SHA1_80 inline:${keyAndSalt.toString("base64")}`);
  }
  lines.push(
    ...preferredCodecs.map((c) => `a=rtpmap:${c.pt} ${c.name}/8000`),
    `a=rtpmap:${dtmfPt} telephone-event/8000`,
    `a=fmtp:${dtmfPt} 0-16`,
    "a=ptime:20",
    "a=sendrecv"
  );
  return { sdp: lines.join("\r\n") + "\r\n", localSrtpKey: outLocalSrtpKey, localSrtpSalt: outLocalSrtpSalt };
}

// vendor/sip-bridge/src/ws/wsClient.ts
import { WebSocket } from "ws";
function createWsClient(url, params, log) {
  const { streamSid, callSid, from, to, sipCallId, mediaFormat, extraCustomParameters } = params;
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { maxPayload: 1024 * 1024 });
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error(`WS connect timeout after 2000ms to ${url}`));
    }, 2e3);
    ws.once("open", () => {
      clearTimeout(timer);
      log.info({ event: "ws_connected", url }, "WS connected to backend");
      ws.send(
        JSON.stringify({
          event: "connected",
          protocol: "Call",
          version: "1.0.0"
        })
      );
      const reservedCustomParams = { From: from, To: to, sipCallId };
      const customParameters = { ...extraCustomParameters, ...reservedCustomParams };
      ws.send(
        JSON.stringify({
          event: "start",
          sequenceNumber: "1",
          start: {
            streamSid,
            accountSid: "",
            callSid,
            tracks: ["inbound", "outbound"],
            customParameters,
            mediaFormat
          },
          streamSid
        })
      );
      log.info({ event: "ws_start_sent", streamSid, callSid }, "connected + start events sent");
      resolve(buildClient());
    });
    ws.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    let seq = 2;
    let chunk = 0;
    let rtpTimestamp = 0;
    function buildClient() {
      const PACKET_MS = 20;
      const PACKET_BYTES = 160;
      const inboundDrain = makeDrain(
        (pkt) => {
          if (ws.readyState !== WebSocket.OPEN) return;
          ws.send(
            JSON.stringify({
              event: "media",
              sequenceNumber: String(seq++),
              media: {
                track: "inbound",
                chunk: String(chunk++),
                timestamp: String(rtpTimestamp),
                payload: pkt.toString("base64")
              },
              streamSid
            })
          );
          rtpTimestamp += 160;
        },
        () => {
        }
        // inbound drain has no mark sentinels — no-op onMarkReady
      );
      let outboundHandler = null;
      let markHandler = null;
      const outboundDrain = makeDrain(
        (pkt) => outboundHandler?.(pkt),
        (name) => markHandler?.(name)
        // routes mark echoes to registered handler
      );
      function enqueueOutbound(decoded) {
        for (let off = 0; off < decoded.length; off += PACKET_BYTES) {
          const slice = decoded.subarray(off, off + PACKET_BYTES);
          if (slice.length < PACKET_BYTES) {
            const padded = Buffer.alloc(PACKET_BYTES, 255);
            slice.copy(padded);
            outboundDrain.enqueue(padded);
          } else {
            outboundDrain.enqueue(slice);
          }
        }
      }
      return {
        sendAudio(payload) {
          if (ws.readyState !== WebSocket.OPEN) {
            log.warn({ event: "ws_send_skipped", reason: "not_open" }, "WS not OPEN — dropping audio packet");
            return;
          }
          inboundDrain.enqueue(payload);
        },
        sendDtmf(digit) {
          if (ws.readyState !== WebSocket.OPEN) {
            log.warn({ event: "ws_send_skipped", reason: "not_open" }, "WS not OPEN — dropping DTMF digit");
            return;
          }
          ws.send(
            JSON.stringify({
              event: "dtmf",
              streamSid,
              sequenceNumber: String(seq++),
              dtmf: {
                track: "inbound_track",
                digit
              }
            })
          );
        },
        stop() {
          inboundDrain.stop();
          outboundDrain.stop();
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                event: "stop",
                sequenceNumber: String(seq++),
                stop: {
                  accountSid: "",
                  callSid
                },
                streamSid
              })
            );
            ws.close();
          } else {
            ws.terminate();
          }
        },
        onAudio(handler) {
          outboundHandler = handler;
          ws.on("message", (data) => {
            let msg;
            try {
              msg = JSON.parse(data.toString());
            } catch {
              return;
            }
            if (!msg || typeof msg !== "object") return;
            switch (msg.event) {
              case "media":
                if (typeof msg.media?.payload === "string") {
                  enqueueOutbound(Buffer.from(msg.media.payload, "base64"));
                }
                break;
              case "mark":
                if (typeof msg.mark?.name === "string" && Buffer.byteLength(msg.mark.name) <= 256) {
                  log.debug({ event: "mark_received", name: msg.mark.name }, "mark event received");
                  outboundDrain.enqueueMark(msg.mark.name);
                }
                break;
              case "clear":
                log.debug({ event: "clear_received" }, "clear event received");
                outboundDrain.stop();
                break;
              default:
                break;
            }
          });
        },
        onDisconnect(handler) {
          ws.once("close", handler);
          ws.once("error", (err) => {
            log.error({ err, event: "ws_error" }, "WS error");
            handler();
          });
        },
        onMark(handler) {
          markHandler = handler;
        },
        sendMark(markName) {
          if (ws.readyState !== WebSocket.OPEN) {
            log.warn({ event: "ws_send_skipped", reason: "not_open" }, "WS not OPEN — dropping mark echo");
            return;
          }
          if (typeof markName !== "string" || Buffer.byteLength(markName) > 256) return;
          log.debug({ event: "mark_echoed", name: markName }, "mark echo sent to WS backend");
          ws.send(
            JSON.stringify({
              event: "mark",
              sequenceNumber: String(seq++),
              streamSid,
              mark: { name: markName }
            })
          );
        },
        sendClear() {
          outboundDrain.stop();
        }
      };
    }
  });
}
function makeDrain(sendPacket, onMarkReady) {
  const queue = [];
  let timer = null;
  let base = 0;
  let count = 0;
  const PACKET_MS = 20;
  const MAX_QUEUE_ITEMS = 5e3;
  const MAX_QUEUE_BYTES = 8e5;
  const MAX_MARK_BYTES = 256;
  let queuedBytes = 0;
  const size = (item) => Buffer.isBuffer(item) ? item.length : Buffer.byteLength(item.markName);
  function shift() {
    const item = queue.shift();
    if (item !== void 0) queuedBytes -= size(item);
    return item;
  }
  function reserve(bytes) {
    if (bytes > MAX_QUEUE_BYTES) return false;
    while (queue.length >= MAX_QUEUE_ITEMS || queuedBytes + bytes > MAX_QUEUE_BYTES) shift();
    return true;
  }
  function schedule() {
    const now = Date.now();
    const deadline = base + count * PACKET_MS;
    if (now - deadline > PACKET_MS) {
      base = now;
      count = 0;
    }
    timer = setTimeout(() => {
      timer = null;
      const item = shift();
      if (item !== void 0) {
        if (Buffer.isBuffer(item)) {
          count++;
          sendPacket(item);
        } else {
          onMarkReady(item.markName);
        }
      }
      if (queue.length > 0 && timer === null) schedule();
    }, Math.max(0, base + count * PACKET_MS - now));
  }
  function start() {
    if (timer === null) {
      base = Date.now();
      count = 0;
      schedule();
    }
  }
  return {
    enqueue(pkt) {
      if (pkt.length === 0 || !reserve(pkt.length)) return;
      const copy = Buffer.allocUnsafeSlow(pkt.length);
      pkt.copy(copy);
      queue.push(copy);
      queuedBytes += copy.length;
      start();
    },
    enqueueMark(name) {
      if (typeof name !== "string") return;
      const bytes = Buffer.byteLength(name);
      if (bytes > MAX_MARK_BYTES) return;
      if (queue.length === 0 && timer === null) {
        onMarkReady(name);
        return;
      }
      if (!reserve(bytes)) return;
      queue.push({ markName: name });
      queuedBytes += bytes;
      start();
    },
    stop() {
      const pending = queue.splice(0);
      queuedBytes = 0;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      for (const item of pending) {
        if (!Buffer.isBuffer(item)) onMarkReady(item.markName);
      }
    }
  };
}

// vendor/sip-bridge/src/identity/sid.ts
import { randomBytes as randomBytes3, createHash } from "node:crypto";
function deriveAccountSid(sipUser) {
  const sum = createHash("sha256").update(sipUser, "utf8").digest();
  return "AC" + sum.subarray(0, 16).toString("hex");
}

// vendor/sip-bridge/src/version.ts
var USER_AGENT = "sipgate-sip-stream-bridge/3.1";

// vendor/sip-bridge/src/webhook/callbackForm.ts
var WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function rfc2822(d) {
  const p2 = (n) => String(n).padStart(2, "0");
  return `${WEEKDAYS[d.getUTCDay()]}, ${p2(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())} +0000`;
}
function buildStatusForm(input) {
  const form = {
    CallSid: input.callSid,
    AccountSid: input.accountSid,
    From: input.from,
    To: input.to,
    Caller: input.from,
    Called: input.to,
    Direction: input.direction,
    ApiVersion: "2010-04-01",
    CallStatus: input.callStatus,
    Timestamp: rfc2822(input.timestamp),
    SequenceNumber: String(input.sequenceNumber),
    CallbackSource: "call-progress-events"
  };
  if (input.callDurationSec !== void 0) {
    form.CallDuration = String(input.callDurationSec);
    form.Duration = String(Math.max(1, Math.ceil(input.callDurationSec / 60)));
  }
  if (input.sipResponseCode !== void 0 && input.sipResponseCode > 0) {
    form.SipResponseCode = String(input.sipResponseCode);
  }
  return form;
}

// vendor/sip-bridge/src/webhook/subscription.ts
var TERMINAL_EVENTS = /* @__PURE__ */ new Set(["completed", "busy", "failed", "no-answer", "canceled"]);
function isTerminalEvent(eventName) {
  return TERMINAL_EVENTS.has(eventName);
}
function subscriptionMatches(events, eventName) {
  if (events === void 0 || events.size === 0) {
    return true;
  }
  if (events.has(eventName)) {
    return true;
  }
  if (isTerminalEvent(eventName) && events.has("completed")) {
    return true;
  }
  return false;
}

// vendor/sip-bridge/src/webhook/voiceFetch.ts
import { Agent as HttpAgent } from "node:http";
import { Agent as HttpsAgent } from "node:https";

// vendor/sip-bridge/src/webhook/signer.ts
import { createHmac as createHmac2 } from "node:crypto";
function toMultiMap(params) {
  if (params instanceof URLSearchParams) {
    const out = {};
    for (const [k, v] of params) {
      (out[k] ??= []).push(v);
    }
    return out;
  }
  return params;
}
function sign(authToken, url, params) {
  const map = toMultiMap(params);
  const keys = Object.keys(map).sort();
  let s = url;
  for (const k of keys) {
    const values = map[k];
    const unique = Array.from(new Set(values)).sort();
    for (const v of unique) {
      s += k + v;
    }
  }
  return createHmac2("sha1", authToken).update(s, "utf8").digest("base64");
}

// vendor/sip-bridge/src/webhook/voiceFetch.ts
function buildFormBody(params) {
  const pairs = [
    ["CallSid", params.callSid],
    ["AccountSid", params.accountSid],
    ["From", params.from],
    ["To", params.to],
    ["CallStatus", "ringing"],
    ["Direction", "inbound"],
    ["ApiVersion", "2010-04-01"],
    ["ForwardedFrom", ""]
  ];
  return pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
}
function isLocalhostHTTP(url) {
  if (!url.startsWith("http://")) return false;
  const rest = url.slice("http://".length);
  return rest.startsWith("localhost") || rest.startsWith("127.0.0.1");
}
function isAllowedVoiceURL(url) {
  return url.startsWith("https://") || isLocalhostHTTP(url);
}
var httpsAgent = new HttpsAgent({ keepAlive: true, maxSockets: 4 });
var httpAgent = new HttpAgent({ keepAlive: true, maxSockets: 4 });
async function fetchOne(url, method, body, authToken, timeoutMs) {
  if (!isAllowedVoiceURL(url)) {
    throw new Error(`voice-url: non-https URL not permitted: ${url}`);
  }
  const headers = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/xml, text/xml, */*"
  };
  if (authToken) {
    const formParams = new URLSearchParams(body);
    headers["X-Twilio-Signature"] = sign(authToken, url, formParams);
  }
  const agent = url.startsWith("https://") ? httpsAgent : httpAgent;
  const resp = await fetch(url, {
    method: method.toUpperCase(),
    headers,
    body: method.toUpperCase() === "POST" ? body : void 0,
    signal: AbortSignal.timeout(timeoutMs),
    // upstream expected an error here (undici DispatchOptions); the directive is
    // unused with our @types/node — see vendor/sip-bridge/UPSTREAM.md
    dispatcher: void 0
    // use keep-alive agents via globalThis.fetch override if needed
  });
  if (!resp.ok) {
    throw new Error(`voice-url: HTTP ${resp.status} from ${url}`);
  }
  const buf = await resp.arrayBuffer();
  return new Uint8Array(buf);
}
async function fetchVoiceUrl(params, cfg) {
  const timeoutMs = (cfg.VOICE_TIMEOUT_S ?? 5) * 1e3;
  const formBody = buildFormBody(params);
  if (!cfg.VOICE_URL) {
    throw new Error("voice-url: VOICE_URL is not configured");
  }
  try {
    const body = await fetchOne(cfg.VOICE_URL, cfg.VOICE_METHOD ?? "POST", formBody, cfg.AUTH_TOKEN, timeoutMs);
    return { body, urlUsed: "primary" };
  } catch (primaryErr) {
    if (!cfg.VOICE_FALLBACK_URL) throw primaryErr;
    try {
      const body = await fetchOne(
        cfg.VOICE_FALLBACK_URL,
        cfg.VOICE_FALLBACK_METHOD ?? "POST",
        formBody,
        cfg.AUTH_TOKEN,
        timeoutMs
      );
      return { body, urlUsed: "fallback" };
    } catch (fallbackErr) {
      throw new Error(
        `voice-url: all attempts failed — primary: ${primaryErr.message}; fallback: ${fallbackErr.message}`
      );
    }
  }
}

// vendor/sip-bridge/src/twiml/parse.ts
var ERROR_CODE_MALFORMED = 12100;
var TwimlError = class extends Error {
  code;
  constructor(code, message) {
    super(`twiml error ${code}: ${message}`);
    this.name = "TwimlError";
    this.code = code;
  }
};
var Tokenizer = class {
  s;
  pos = 0;
  constructor(s) {
    this.s = s;
  }
  /** Returns the next token, or null at end of input. */
  next() {
    if (this.pos >= this.s.length) {
      return null;
    }
    if (this.s[this.pos] !== "<") {
      const start = this.pos;
      const lt = this.s.indexOf("<", this.pos);
      const end = lt === -1 ? this.s.length : lt;
      this.pos = end;
      return { type: "chardata", text: unescapeEntities(this.s.slice(start, end)) };
    }
    if (this.s.startsWith("<!--", this.pos)) {
      const close = this.s.indexOf("-->", this.pos + 4);
      if (close === -1) {
        throw new TwimlError(ERROR_CODE_MALFORMED, "unterminated comment");
      }
      this.pos = close + 3;
      return this.next();
    }
    if (this.s.startsWith("<![CDATA[", this.pos)) {
      const close = this.s.indexOf("]]>", this.pos + 9);
      if (close === -1) {
        throw new TwimlError(ERROR_CODE_MALFORMED, "unterminated CDATA");
      }
      const text2 = this.s.slice(this.pos + 9, close);
      this.pos = close + 3;
      return { type: "chardata", text: text2 };
    }
    if (this.s.startsWith("<?", this.pos)) {
      const close = this.s.indexOf("?>", this.pos + 2);
      if (close === -1) {
        throw new TwimlError(ERROR_CODE_MALFORMED, "unterminated processing instruction");
      }
      this.pos = close + 2;
      return this.next();
    }
    if (this.s.startsWith("<!", this.pos)) {
      const close = this.s.indexOf(">", this.pos + 2);
      if (close === -1) {
        throw new TwimlError(ERROR_CODE_MALFORMED, "unterminated declaration");
      }
      this.pos = close + 1;
      return this.next();
    }
    const gt = this.s.indexOf(">", this.pos);
    if (gt === -1) {
      throw new TwimlError(ERROR_CODE_MALFORMED, "unterminated tag");
    }
    let inner = this.s.slice(this.pos + 1, gt);
    this.pos = gt + 1;
    if (inner.startsWith("/")) {
      const name = inner.slice(1).trim();
      if (name === "") {
        throw new TwimlError(ERROR_CODE_MALFORMED, "empty end tag");
      }
      return { type: "end", name: localName(name) };
    }
    let selfClosing = false;
    if (inner.endsWith("/")) {
      selfClosing = true;
      inner = inner.slice(0, -1);
    }
    const parsed = parseStartTag(inner);
    return { type: "start", name: parsed.name, attrs: parsed.attrs, selfClosing };
  }
};
function parseStartTag(inner) {
  let i = 0;
  const n = inner.length;
  const skipWs = () => {
    while (i < n && isXmlSpace(inner[i])) i++;
  };
  skipWs();
  const nameStart = i;
  while (i < n && !isXmlSpace(inner[i])) i++;
  const rawName = inner.slice(nameStart, i);
  if (rawName === "") {
    throw new TwimlError(ERROR_CODE_MALFORMED, "empty start tag");
  }
  const attrs = {};
  for (; ; ) {
    skipWs();
    if (i >= n) break;
    const attrStart = i;
    while (i < n && inner[i] !== "=" && !isXmlSpace(inner[i])) i++;
    const attrName = inner.slice(attrStart, i);
    if (attrName === "") break;
    skipWs();
    if (i >= n || inner[i] !== "=") {
      attrs[localName(attrName)] = "";
      continue;
    }
    i++;
    skipWs();
    if (i >= n) {
      throw new TwimlError(ERROR_CODE_MALFORMED, `attribute ${attrName} missing value`);
    }
    const quote = inner[i];
    if (quote !== '"' && quote !== "'") {
      throw new TwimlError(ERROR_CODE_MALFORMED, `attribute ${attrName} value not quoted`);
    }
    i++;
    const valStart = i;
    while (i < n && inner[i] !== quote) i++;
    if (i >= n) {
      throw new TwimlError(ERROR_CODE_MALFORMED, `attribute ${attrName} value unterminated`);
    }
    const rawVal = inner.slice(valStart, i);
    i++;
    attrs[localName(attrName)] = unescapeEntities(rawVal);
  }
  return { name: localName(rawName), attrs };
}
function localName(qname) {
  const colon = qname.indexOf(":");
  return colon === -1 ? qname : qname.slice(colon + 1);
}
function isXmlSpace(c) {
  return c === " " || c === "	" || c === "\n" || c === "\r";
}
function unescapeEntities(s) {
  if (s.indexOf("&") === -1) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (match, body) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      if (Number.isNaN(code)) return match;
      return String.fromCodePoint(code);
    }
    switch (body) {
      case "amp":
        return "&";
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "quot":
        return '"';
      case "apos":
        return "'";
      default:
        return match;
    }
  });
}
var VALID_STATUS_CALLBACK_EVENTS = /* @__PURE__ */ new Set([
  "initiated",
  "ringing",
  "answered",
  "in-progress",
  "completed",
  "busy",
  "failed",
  "no-answer",
  "canceled"
]);
function parseStatusCallbackEvents(raw) {
  const tokens = raw.split(/[\s,]+/);
  const out = [];
  for (const t of tokens) {
    const tok = t.trim();
    if (tok === "") continue;
    if (!VALID_STATUS_CALLBACK_EVENTS.has(tok)) {
      throw new TwimlError(ERROR_CODE_MALFORMED, `StatusCallbackEvent: unknown value "${tok}"`);
    }
    out.push(tok);
  }
  return out.length === 0 ? void 0 : out;
}
function parseResponse(xml) {
  if (xml.length === 0) {
    throw new TwimlError(ERROR_CODE_MALFORMED, "empty document");
  }
  const tz = new Tokenizer(xml);
  for (; ; ) {
    const tok = tz.next();
    if (tok === null) {
      throw new TwimlError(ERROR_CODE_MALFORMED, "empty document");
    }
    if (tok.type === "chardata") {
      continue;
    }
    if (tok.type === "end") {
      throw new TwimlError(ERROR_CODE_MALFORMED, `unexpected </${tok.name}> before root`);
    }
    if (tok.name !== "Response") {
      throw new TwimlError(ERROR_CODE_MALFORMED, "root is not <Response>");
    }
    if (tok.selfClosing) {
      return { verbs: [] };
    }
    return parseResponseChildren(tz);
  }
}
function parseResponseChildren(tz) {
  const verbs = [];
  for (; ; ) {
    const tok = tz.next();
    if (tok === null) {
      throw new TwimlError(ERROR_CODE_MALFORMED, "unexpected EOF inside <Response>");
    }
    if (tok.type === "chardata") {
      continue;
    }
    if (tok.type === "end") {
      if (tok.name === "Response") {
        return { verbs };
      }
      throw new TwimlError(
        ERROR_CODE_MALFORMED,
        `unexpected </${tok.name}> at Response level`
      );
    }
    switch (tok.name) {
      case "Connect":
        verbs.push(parseConnect(tz, tok.selfClosing));
        break;
      case "Dial":
        verbs.push(parseDial(tz, tok.attrs, tok.selfClosing));
        break;
      case "Hangup":
        if (!tok.selfClosing) skipToEnd(tz, "Hangup");
        verbs.push({ kind: "Hangup", name: "Hangup" });
        break;
      case "Redirect":
        verbs.push(parseRedirect(tz, tok.attrs, tok.selfClosing));
        break;
      case "Reject":
        if (!tok.selfClosing) skipToEnd(tz, "Reject");
        verbs.push({ kind: "Reject", name: "Reject", reason: tok.attrs.reason });
        break;
      default:
        if (!tok.selfClosing) skipToEnd(tz, tok.name);
        verbs.push({ kind: "Unknown", name: tok.name });
    }
  }
}
function parseConnect(tz, selfClosing) {
  const connect = { kind: "Connect", name: "Connect" };
  if (selfClosing) return connect;
  for (; ; ) {
    const tok = tz.next();
    if (tok === null) {
      throw new TwimlError(ERROR_CODE_MALFORMED, "unexpected EOF inside <Connect>");
    }
    if (tok.type === "end") {
      if (tok.name === "Connect") return connect;
      continue;
    }
    if (tok.type === "start") {
      if (tok.name === "Stream") {
        connect.stream = parseStream(tz, tok.attrs, tok.selfClosing);
      } else if (!tok.selfClosing) {
        skipToEnd(tz, tok.name);
      }
    }
  }
}
function parseStream(tz, attrs, selfClosing) {
  const stream = {};
  if (attrs.url !== void 0) stream.url = attrs.url;
  if (attrs.name !== void 0) stream.name = attrs.name;
  if (attrs.track !== void 0) stream.track = attrs.track;
  if (selfClosing) return stream;
  for (; ; ) {
    const tok = tz.next();
    if (tok === null) {
      throw new TwimlError(ERROR_CODE_MALFORMED, "unexpected EOF inside <Stream>");
    }
    if (tok.type === "end") {
      if (tok.name === "Stream") return stream;
      continue;
    }
    if (tok.type === "start") {
      if (tok.name === "Parameter") {
        const pn = tok.attrs.name;
        const pv = tok.attrs.value ?? "";
        if (pn !== void 0 && pn !== "") {
          stream.parameters ??= {};
          stream.parameters[pn] = pv;
        }
      }
      if (!tok.selfClosing) skipToEnd(tz, tok.name);
    }
  }
}
function parseDial(tz, attrs, selfClosing) {
  const dial = {
    kind: "Dial",
    name: "Dial",
    hangupOnStar: attrs.hangupOnStar === "true",
    hasSip: false,
    hasClient: false,
    hasConference: false,
    hasQueue: false
  };
  if (attrs.callerId !== void 0) dial.callerId = attrs.callerId;
  const timeout = parseIntStrict(attrs.timeout);
  if (timeout !== void 0) dial.timeout = timeout;
  const timeLimit = parseIntStrict(attrs.timeLimit);
  if (timeLimit !== void 0) dial.timeLimit = timeLimit;
  if (attrs.action !== void 0) dial.action = attrs.action;
  if (attrs.method !== void 0) dial.method = attrs.method;
  if (attrs.answerOnBridge !== void 0) dial.answerOnBridge = attrs.answerOnBridge === "true";
  if (attrs.statusCallback !== void 0) dial.statusCallback = attrs.statusCallback;
  if (attrs.statusCallbackMethod !== void 0) {
    dial.statusCallbackMethod = attrs.statusCallbackMethod;
  }
  if (attrs.statusCallbackEvent !== void 0) {
    try {
      dial.statusCallbackEvents = parseStatusCallbackEvents(attrs.statusCallbackEvent);
    } catch (e) {
      throw rewrapStatusError(e, "<Dial>");
    }
  }
  if (selfClosing) return dial;
  let numberText = "";
  for (; ; ) {
    const tok = tz.next();
    if (tok === null) {
      throw new TwimlError(ERROR_CODE_MALFORMED, "unexpected EOF inside <Dial>");
    }
    if (tok.type === "chardata") {
      numberText += tok.text;
      continue;
    }
    if (tok.type === "end") {
      if (tok.name === "Dial") {
        if (numberText !== "") dial.numberText = numberText;
        return dial;
      }
      continue;
    }
    switch (tok.name) {
      case "Number":
        dial.number = parseNumber(tz, tok.attrs, tok.selfClosing);
        break;
      case "Sip":
        dial.hasSip = true;
        if (!tok.selfClosing) skipToEnd(tz, "Sip");
        break;
      case "Client":
        dial.hasClient = true;
        if (!tok.selfClosing) skipToEnd(tz, "Client");
        break;
      case "Conference":
        dial.hasConference = true;
        if (!tok.selfClosing) skipToEnd(tz, "Conference");
        break;
      case "Queue":
        dial.hasQueue = true;
        if (!tok.selfClosing) skipToEnd(tz, "Queue");
        break;
      default:
        if (!tok.selfClosing) skipToEnd(tz, tok.name);
    }
  }
}
function parseNumber(tz, attrs, selfClosing) {
  const number = { text: "" };
  if (attrs.statusCallback !== void 0) number.statusCallback = attrs.statusCallback;
  if (attrs.statusCallbackMethod !== void 0) {
    number.statusCallbackMethod = attrs.statusCallbackMethod;
  }
  if (attrs.statusCallbackEvent !== void 0) {
    try {
      number.statusCallbackEvents = parseStatusCallbackEvents(attrs.statusCallbackEvent);
    } catch (e) {
      throw rewrapStatusError(e, "<Number>");
    }
  }
  if (selfClosing) return number;
  let text2 = "";
  for (; ; ) {
    const tok = tz.next();
    if (tok === null) {
      throw new TwimlError(ERROR_CODE_MALFORMED, "unexpected EOF inside <Number>");
    }
    if (tok.type === "chardata") {
      text2 += tok.text;
      continue;
    }
    if (tok.type === "end") {
      if (tok.name === "Number") {
        number.text = text2;
        return number;
      }
      continue;
    }
    if (tok.type === "start" && !tok.selfClosing) {
      skipToEnd(tz, tok.name);
    }
  }
}
function parseRedirect(tz, attrs, selfClosing) {
  const redirect = { kind: "Redirect", name: "Redirect" };
  if (attrs.method !== void 0) redirect.method = attrs.method;
  if (selfClosing) return redirect;
  let url = "";
  for (; ; ) {
    const tok = tz.next();
    if (tok === null) {
      throw new TwimlError(ERROR_CODE_MALFORMED, "unexpected EOF inside <Redirect>");
    }
    if (tok.type === "chardata") {
      url += tok.text;
      continue;
    }
    if (tok.type === "end") {
      if (tok.name === "Redirect") {
        if (url !== "") redirect.url = url;
        return redirect;
      }
      continue;
    }
    if (tok.type === "start" && !tok.selfClosing) {
      skipToEnd(tz, tok.name);
    }
  }
}
function skipToEnd(tz, name) {
  let depth = 0;
  for (; ; ) {
    const tok = tz.next();
    if (tok === null) {
      throw new TwimlError(ERROR_CODE_MALFORMED, `unexpected EOF skipping <${name}>`);
    }
    if (tok.type === "start") {
      if (!tok.selfClosing) depth++;
    } else if (tok.type === "end") {
      if (depth === 0 && tok.name === name) return;
      if (depth > 0) depth--;
    }
  }
}
function extractStreamURL(resp) {
  for (const verb of resp.verbs) {
    if (verb.kind !== "Connect") continue;
    const connect = verb;
    if (!connect.stream?.url) continue;
    return { url: connect.stream.url, params: connect.stream.parameters ?? {} };
  }
  throw new Error('twiml: no <Connect><Stream url="..."> found in response');
}
function parseIntStrict(v) {
  if (v === void 0) return void 0;
  const s = v.trim();
  if (!/^[+-]?\d+$/.test(s)) return void 0;
  const n = Number.parseInt(s, 10);
  return Number.isNaN(n) ? void 0 : n;
}
function rewrapStatusError(e, ctx) {
  if (e instanceof TwimlError) {
    return new TwimlError(e.code, `${ctx}: ${e.message.replace(/^twiml error \d+: /, "")}`);
  }
  return new TwimlError(ERROR_CODE_MALFORMED, `${ctx}: ${String(e)}`);
}

// vendor/sip-bridge/src/bridge/state.ts
function isActiveState(state) {
  return state !== "terminated" /* Terminated */ && state !== "hung-up" /* HungUp */;
}
function twilioStatus(state, terminalReason) {
  if (state === "terminated" /* Terminated */ || state === "hung-up" /* HungUp */) {
    return mapTerminalReason(terminalReason);
  }
  switch (state) {
    case "dispatching" /* Dispatching */:
      return "queued";
    case "streaming" /* Streaming */:
    case "dialing-out" /* DialingOut */:
    case "forwarding" /* Forwarding */:
      return "in-progress";
    default:
      return "in-progress";
  }
}
function mapTerminalReason(reason) {
  switch (reason) {
    case "busy":
      return "busy";
    case "no-answer":
      return "no-answer";
    case "canceled":
    case "remote_cancel":
      return "canceled";
    case "failed":
    case "ws_reconnect_failed":
      return "failed";
    // "completed", "hangup", "remote_bye", "shutdown" and anything else → completed
    default:
      return "completed";
  }
}

// vendor/sip-bridge/src/bridge/callManager.ts
var RECENTLY_TERMINATED_TTL_MS = 5 * 6e4;
var RECENTLY_TERMINATED_SWEEP_MS = 3e4;
function tagOf(header) {
  return header.match(/;tag=([^;\s>]+)/i)?.[1] ?? "";
}
function branchOf(raw) {
  return extractHeader(raw, "Via").match(/;branch=([^;\s]+)/i)?.[1] ?? "";
}
function parseCseq(raw, method) {
  const match = extractHeader(raw, "CSeq").match(/^(\d+) ([A-Z]+)$/);
  const seq = match ? Number(match[1]) : NaN;
  return match?.[2] === method && Number.isSafeInteger(seq) && seq >= 0 && seq < 2147483648 ? seq : null;
}
function sameInviteTransaction(invite, request, cancel) {
  return branchOf(invite) === branchOf(request) && extractHeader(invite, "Via").split(";")[0] === extractHeader(request, "Via").split(";")[0] && extractHeader(invite, "From") === extractHeader(request, "From") && extractHeader(invite, "To") === extractHeader(request, "To") && invite.split(" ")[1] === request.split(" ")[1] && parseCseq(invite, "INVITE") === parseCseq(request, cancel ? "CANCEL" : "INVITE") && (cancel || invite.split("\r\n\r\n").slice(1).join("\r\n\r\n") === request.split("\r\n\r\n").slice(1).join("\r\n\r\n"));
}
function extractHeader(raw, name) {
  const m = raw.match(new RegExp(`^${name}:\\s*(.+)$`, "im"));
  return m ? m[1].trim() : "";
}
function extractAllVias(raw) {
  const vias = [];
  for (const line of raw.split("\r\n")) {
    const m = line.match(/^Via:\s*(.+)$/i);
    if (m) vias.push(m[1].trim());
  }
  return vias;
}
function extractAllRecordRoutes(raw) {
  const rrs = [];
  for (const line of raw.split("\r\n")) {
    const m = line.match(/^Record-Route:\s*(.+)$/i);
    if (m) rrs.push(m[1].trim());
  }
  return rrs;
}
function buildResponse(p) {
  const lines = [
    `SIP/2.0 ${p.status} ${p.reason}`,
    ...p.vias.map((v) => `Via: ${v}`),
    `From: ${p.from}`,
    `To: ${p.to}`,
    `Call-ID: ${p.callId}`,
    `CSeq: ${p.cseq}`,
    `User-Agent: ${USER_AGENT}`
  ];
  if (p.recordRoutes?.length) {
    lines.push(...p.recordRoutes.map((rr) => `Record-Route: ${rr}`));
  }
  if (p.status === 200 && p.sdpBody) {
    lines.push(`Contact: <sip:${p.sipUser}@${p.localIp}:${p.localSipPort}>`);
    lines.push("Content-Type: application/sdp");
    lines.push(`Content-Length: ${Buffer.byteLength(p.sdpBody)}`);
    lines.push("");
    return lines.join("\r\n") + "\r\n" + p.sdpBody;
  } else {
    lines.push("Content-Length: 0", "");
    return lines.join("\r\n") + "\r\n";
  }
}
function buildBye(p) {
  const branch = "z9hG4bK" + crypto.randomBytes(6).toString("hex");
  const lines = [
    `BYE ${p.remoteTarget} SIP/2.0`,
    `Via: SIP/2.0/UDP ${p.localIp}:${p.localSipPort};branch=${branch};rport`,
    "Max-Forwards: 70",
    `From: <${p.fromUri}>;tag=${p.fromTag}`,
    `To: <${p.toUri}>;tag=${p.toTag}`,
    `Call-ID: ${p.callId}`,
    `CSeq: ${p.cseq} BYE`
  ];
  if (p.recordRoutes?.length) {
    for (const rr of p.recordRoutes) lines.push(`Route: ${rr}`);
  }
  lines.push(`User-Agent: ${USER_AGENT}`, "Content-Length: 0", "");
  return lines.join("\r\n") + "\r\n";
}
function shouldReconnectWs(state, sessionPresent) {
  return sessionPresent && state === "streaming" /* Streaming */;
}
function byeSendTarget(recordRoutes, remoteTarget) {
  if (recordRoutes.length > 0) {
    return parseContactTarget(recordRoutes[0]);
  }
  return parseContactTarget(remoteTarget);
}
function getLocalIp() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces ?? []) {
      if (!iface.internal && iface.family === "IPv4") return iface.address;
    }
  }
  return "127.0.0.1";
}
function parseContactTarget(uri) {
  const m = uri.match(/[@:]([a-zA-Z0-9._-]+):(\d+)/);
  if (m) return [m[1], parseInt(m[2], 10)];
  const host = uri.match(/[@:]([a-zA-Z0-9._-]+)/)?.[1] ?? "127.0.0.1";
  return [host, 5060];
}
var CallManager = class {
  sessions = /* @__PURE__ */ new Map();
  /** CallSid → live session, for the REST control plane (active calls only) */
  callSidIdx = /* @__PURE__ */ new Map();
  /** CallSid → snapshot of recently-terminated calls (TTL-swept) */
  recentlyTerminated = /* @__PURE__ */ new Map();
  /** Call-IDs currently being set up (between first INVITE and 200 OK stored) — dedup retransmissions */
  pendingInvites = /* @__PURE__ */ new Map();
  /** Call-IDs for which CANCEL was received before 200 OK was sent */
  cancelledInvites = /* @__PURE__ */ new Set();
  config;
  /** AC… account identifier, derived once from SIP_USER */
  accountSid;
  /** Local SIP port (Via/Contact) from SIP_LISTEN_ADDR. */
  localSipPort;
  sipHandle;
  // set via setSipHandle() before any calls arrive
  log;
  metrics;
  statusClient;
  /** Set to true during terminateAll() — causes new INVITEs to receive 503 (LCY-01) */
  isShuttingDown = false;
  sweepTimer;
  constructor(config, log, metrics) {
    this.config = config;
    this.log = log;
    this.metrics = metrics;
    this.accountSid = deriveAccountSid(config.SIP_USER);
    this.localSipPort = listenParts(config.SIP_LISTEN_ADDR).port;
    this.sweepTimer = setInterval(() => this.sweepRecentlyTerminated(), RECENTLY_TERMINATED_SWEEP_MS);
    this.sweepTimer.unref?.();
  }
  sweepRecentlyTerminated() {
    const cutoff = Date.now() - RECENTLY_TERMINATED_TTL_MS;
    for (const [callSid, snap] of this.recentlyTerminated) {
      if (snap.terminatedAt < cutoff) this.recentlyTerminated.delete(callSid);
    }
  }
  /** Wire the SipHandle produced by createSipUserAgent into the manager */
  setSipHandle(handle) {
    this.sipHandle = handle;
  }
  /** Wire the StatusClient used to deliver call-progress callbacks. */
  setStatusClient(client) {
    this.statusClient = client;
  }
  /** Build the operator-default StatusCallback subscription, if configured. */
  defaultStatusCallback() {
    const url = this.config.STATUS_CALLBACK_DEFAULT_URL;
    if (!url) return null;
    const events = new Set(
      this.config.STATUS_CALLBACK_DEFAULT_EVENTS.split(",").map((e) => e.trim()).filter((e) => e.length > 0)
    );
    return { url, method: this.config.STATUS_CALLBACK_DEFAULT_METHOD, events, trusted: true };
  }
  /** Replace a session's status-callback subscription (REST StatusCallback=). */
  setStatusCallback(session, cfg) {
    session.statusCallback = cfg;
  }
  /**
   * Emit a single status-callback event if the session has a matching subscription.
   * SequenceNumber is monotonic per call; terminal events carry CallDuration.
   */
  emitStatusEvent(session, event, callStatus, extras) {
    const sub = session.statusCallback;
    if (!sub || !this.statusClient) return;
    if (!subscriptionMatches(sub.events, event)) return;
    const form = buildStatusForm({
      callSid: session.callSid,
      accountSid: session.accountSid,
      from: session.fromNumber,
      to: session.toNumber,
      direction: "inbound",
      callStatus,
      sequenceNumber: session.seqCounter++,
      timestamp: /* @__PURE__ */ new Date(),
      callDurationSec: extras?.callDurationSec,
      sipResponseCode: extras?.sipResponseCode
    });
    const evt = {
      url: sub.url,
      method: sub.method,
      form,
      event,
      trusted: sub.trusted
    };
    this.statusClient.enqueue(session.callSid, evt);
  }
  /** Returns SipCallbacks to pass to createSipUserAgent */
  getCallbacks() {
    return {
      onInvite: (raw, rinfo) => {
        void this.handleInvite(raw, rinfo).catch((err) => {
          this.log.error({ err, event: "invite_unhandled_error" }, "Unhandled error in INVITE handler");
        });
      },
      onAck: (raw, rinfo) => {
        const callId = extractHeader(raw, "Call-ID");
        const session = this.sessions.get(callId);
        if (!session || !this.matchesDialog(session, raw, rinfo, "ACK")) return;
        if (session?.okRetransmitTimer !== null && session?.okRetransmitTimer !== void 0) {
          clearTimeout(session.okRetransmitTimer);
          session.okRetransmitTimer = null;
          session.log.debug({ event: "ack_received" }, "ACK received — 200 OK retransmit stopped");
        }
      },
      onBye: (raw, rinfo) => {
        this.handleBye(raw, rinfo);
      },
      onCancel: (raw, rinfo) => {
        this.handleCancel(raw, rinfo);
      }
    };
  }
  // ── v3 control-plane query + modify surface ─────────────────────────────────
  /** Build the read-only BridgeCall projection from a live session. */
  toBridgeCall(s, endTime) {
    const end = endTime ?? null;
    const durationSec = end && s.answeredAt ? Math.max(0, Math.round((end.getTime() - s.answeredAt.getTime()) / 1e3)) : null;
    return {
      callSid: s.callSid,
      accountSid: s.accountSid,
      from: s.fromNumber,
      to: s.toNumber,
      status: twilioStatus(s.state, s.terminalReason ?? void 0),
      direction: "inbound",
      startTime: s.startTime,
      endTime: end,
      duration: durationSec,
      answeredBy: null,
      parentCallSid: null
    };
  }
  /** List active + recently-terminated calls, most-recently-started first. */
  list() {
    const out = [];
    for (const s of this.sessions.values()) out.push(this.toBridgeCall(s));
    for (const t of this.recentlyTerminated.values()) out.push(t);
    out.sort((a, b) => (b.startTime?.getTime() ?? 0) - (a.startTime?.getTime() ?? 0));
    return out;
  }
  /**
   * Count of sessions currently in a B2BUA <Dial> forward (callee leg up).
   * Mirrors Go's CallManager.ActiveForwardCount() for the /health contract.
   */
  activeForwardCount() {
    let n = 0;
    for (const s of this.sessions.values()) {
      if (s.forwardDialog !== null) n++;
    }
    return n;
  }
  /** Look up a call by CallSid (active wins over a stale terminated snapshot). */
  getByCallSid(callSid) {
    const live = this.callSidIdx.get(callSid);
    if (live) return this.toBridgeCall(live);
    return this.recentlyTerminated.get(callSid);
  }
  /** Resolve the live session for mid-call modify; undefined if not active. */
  getSessionByCallSid(callSid) {
    return this.callSidIdx.get(callSid);
  }
  /** True while the session is modifiable (neither terminated nor hung up). */
  isActive(callSid) {
    const s = this.callSidIdx.get(callSid);
    return s !== void 0 && isActiveState(s.state);
  }
  /**
   * Privacy gate primitive: close the WS stream cleanly (bot disconnected) while
   * leaving the RTP path alive, so a subsequent <Dial> can relay media. Idempotent.
   */
  closeStream(session, reason) {
    if (session.state === "dialing-out" /* DialingOut */ || !isActiveState(session.state)) return;
    session.state = "dialing-out" /* DialingOut */;
    if (session.silenceInterval !== null) {
      clearInterval(session.silenceInterval);
      session.silenceInterval = null;
    }
    if (session.keepaliveInterval !== null) {
      clearInterval(session.keepaliveInterval);
      session.keepaliveInterval = null;
    }
    session.ws.stop();
    session.log.info({ event: "stream_closed", reason }, "WS stream closed (privacy gate)");
  }
  /**
   * REST-driven termination by CallSid (sends BYE to the caller). Returns true if
   * a live session was found and torn down. Idempotent for already-terminated calls.
   */
  terminateByCallSid(callSid, reason) {
    const session = this.callSidIdx.get(callSid);
    if (!session) return false;
    this.terminateSession(session, reason, true);
    return true;
  }
  /** Terminate all active sessions in parallel — for graceful shutdown */
  async terminateAll() {
    this.isShuttingDown = true;
    clearInterval(this.sweepTimer);
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.all(
      sessions.map(async (session) => {
        this.sessions.set(session.callId, session);
        this.terminateSession(session, "shutdown", true);
      })
    );
  }
  // ── Private: INVITE handler ─────────────────────────────────────────────────
  async handleInvite(raw, rinfo) {
    if (!this.isTrustedPeer(rinfo)) return;
    const from = extractHeader(raw, "From");
    const toHeader = extractHeader(raw, "To");
    const sipCallId = extractHeader(raw, "Call-ID");
    const cseq = extractHeader(raw, "CSeq");
    const seq = parseCseq(raw, "INVITE");
    if (!sipCallId || !tagOf(from) || seq === null || !branchOf(raw).startsWith("z9hG4bK")) return;
    if (this.isShuttingDown) {
      const resp503 = buildResponse({
        status: 503,
        reason: "Service Unavailable",
        vias: extractAllVias(raw),
        from,
        to: toHeader,
        callId: sipCallId,
        cseq
      });
      this.sipHandle.sendRaw(Buffer.from(resp503), rinfo.port, rinfo.address);
      return;
    }
    if (this.pendingInvites.has(sipCallId)) return;
    const existing = this.sessions.get(sipCallId);
    if (existing) {
      if (!this.matchesPeer(existing, rinfo) || !existing.inviteRaw || !sameInviteTransaction(existing.inviteRaw, raw, false)) return;
      const localIp = this.config.SDP_CONTACT_IP ?? getLocalIp();
      const ok200 = buildResponse({
        status: 200,
        reason: "OK",
        vias: extractAllVias(raw),
        from,
        to: `${toHeader};tag=${existing.localTag}`,
        callId: sipCallId,
        cseq,
        sdpBody: existing.sdpAnswer,
        localIp,
        sipUser: this.config.SIP_USER,
        sipDomain: this.config.SIP_DOMAIN,
        localSipPort: this.localSipPort
      });
      this.sipHandle.sendRaw(Buffer.from(ok200), rinfo.port, rinfo.address);
      return;
    }
    if (this.pendingInvites.size >= 64) return;
    const pending = { raw, address: rinfo.address, port: rinfo.port, expires: Date.now() + 3e4, timer: void 0 };
    this.pendingInvites.set(sipCallId, pending);
    pending.timer = setTimeout(() => {
      if (this.pendingInvites.get(sipCallId) === pending) {
        this.pendingInvites.delete(sipCallId);
        this.cancelledInvites.delete(sipCallId);
      }
    }, 3e4);
    pending.timer.unref?.();
    let allocatedRtp;
    try {
      const remoteTag = tagOf(from);
      const remoteUri = raw.match(/^From:[^<\r\n]*<([^>]+)>/im)?.[1] ?? "";
      const remoteContact = raw.match(/Contact:\s*<([^>]+)>/i)?.[1] ?? `sip:${rinfo.address}:${rinfo.port}`;
      const localUri = toHeader.match(/<([^>]+)>/)?.[1] ?? toHeader.replace(/;.*$/, "").trim();
      this.log.debug(
        {
          event: "dialog_headers",
          sipCallId,
          toHeader,
          contact: remoteContact,
          recordRoutes: extractAllRecordRoutes(raw)
        },
        "inbound dialog headers"
      );
      const pai = extractHeader(raw, "P-Asserted-Identity");
      const fromUri = pai ? pai.match(/<([^>]+)>/)?.[1] ?? pai.trim() : remoteUri;
      const requestUri = raw.split("\r\n")[0].match(/INVITE\s+(\S+)\s+SIP/i)?.[1] ?? `sip:${this.config.SIP_USER}@${this.config.SIP_DOMAIN}`;
      const toUri = requestUri;
      const vias = extractAllVias(raw);
      const recordRoutes = extractAllRecordRoutes(raw);
      const trying = buildResponse({
        status: 100,
        reason: "Trying",
        vias,
        from,
        to: toHeader,
        callId: sipCallId,
        cseq
      });
      this.sipHandle.sendRaw(Buffer.from(trying), rinfo.port, rinfo.address);
      const sdpBody = raw.split("\r\n\r\n").slice(1).join("\r\n\r\n");
      const sdpOffer = parseSdpOffer(sdpBody);
      const supportedPts = /* @__PURE__ */ new Set([0, 8, 9]);
      if (!sdpOffer || !sdpOffer.audioPts.some((pt) => supportedPts.has(pt)) || sdpOffer.isSrtp && !this.config.SRTP_ENABLED || this.config.SRTP_REQUIRED && !sdpOffer.isSrtp) {
        const resp488 = buildResponse({
          status: 488,
          reason: "Not Acceptable Here",
          vias,
          from,
          to: toHeader,
          callId: sipCallId,
          cseq
        });
        this.sipHandle.sendRaw(Buffer.from(resp488), rinfo.port, rinfo.address);
        this.log.warn({ event: "invite_rejected_sdp", sipCallId }, "INVITE rejected — no supported codec in SDP offer");
        return;
      }
      const codecInfo = selectAudioCodec(sdpOffer.audioPts, this.config.AUDIO_MODE);
      const g722SilenceEncoder = codecInfo.pt === 9 ? new G722Encoder2() : void 0;
      const silentPcm = g722SilenceEncoder ? Buffer.alloc(640) : void 0;
      const encodeSilence = () => g722SilenceEncoder ? g722SilenceEncoder.encode(silentPcm) : Buffer.alloc(160, codecInfo.silenceByte);
      const useSrtp = this.config.SRTP_ENABLED && sdpOffer.isSrtp;
      let localSrtpKey;
      let localSrtpSalt;
      if (useSrtp) {
        localSrtpKey = crypto.randomBytes(16);
        localSrtpSalt = crypto.randomBytes(14);
      }
      const callLog = this.log.child({ component: "call", call_id: sipCallId });
      if (this.config.SRTP_ENABLED && !sdpOffer.isSrtp) {
        callLog.warn({ event: "srtp_fallback", sipCallId }, "SRTP desired but caller offered plain RTP/AVP — proceeding unencrypted");
      }
      const rtp = await createRtpHandler({
        portMin: this.config.RTP_PORT_MIN,
        portMax: this.config.RTP_PORT_MAX,
        log: callLog,
        audioPt: codecInfo.pt,
        dtmfPt: sdpOffer.dtmfPt,
        silenceByte: codecInfo.silenceByte,
        localSrtpKey,
        localSrtpSalt,
        remoteSrtpKey: sdpOffer.remoteSrtpKey,
        remoteSrtpSalt: sdpOffer.remoteSrtpSalt
      });
      allocatedRtp = rtp;
      rtp.setRemote(sdpOffer.remoteIp, sdpOffer.remotePort);
      rtp.sendAudio(encodeSilence());
      if (this.cancelledInvites.has(sipCallId) || this.pendingInvites.get(sipCallId) !== pending || Date.now() >= pending.expires || this.isShuttingDown) {
        rtp.dispose();
        return;
      }
      const callSid = "CA" + crypto.randomBytes(16).toString("hex");
      const streamSid = "MZ" + crypto.randomBytes(16).toString("hex");
      const localTag = crypto.randomBytes(6).toString("hex");
      const ringing = buildResponse({
        status: 180,
        reason: "Ringing",
        vias,
        from,
        to: `${toHeader};tag=${localTag}`,
        callId: sipCallId,
        cseq
      });
      this.sipHandle.sendRaw(Buffer.from(ringing), rinfo.port, rinfo.address);
      let streamURL;
      let extraCustomParameters;
      if (this.config.WS_TARGET_URL) {
        streamURL = this.config.WS_TARGET_URL;
      } else {
        try {
          const { body, urlUsed } = await fetchVoiceUrl(
            { callSid, accountSid: this.accountSid, from: fromUri, to: toUri },
            this.config
          );
          callLog.debug({ event: "voice_url_fetched", urlUsed }, "voice-url fetch ok");
          const twimlText = new TextDecoder().decode(body);
          const resp = parseResponse(twimlText);
          const extracted = extractStreamURL(resp);
          streamURL = extracted.url;
          extraCustomParameters = Object.keys(extracted.params).length > 0 ? extracted.params : void 0;
        } catch (err) {
          callLog.warn({ err, event: "voice_url_failed" }, "voice-url fetch/parse failed — sending 503");
          const resp503 = buildResponse({
            status: 503,
            reason: "Service Unavailable",
            vias,
            from,
            to: toHeader,
            callId: sipCallId,
            cseq
          });
          this.sipHandle.sendRaw(Buffer.from(resp503), rinfo.port, rinfo.address);
          rtp.dispose();
          return;
        }
      }
      let ws;
      try {
        ws = await createWsClient(
          streamURL,
          {
            streamSid,
            callSid,
            from: fromUri,
            to: toUri,
            sipCallId,
            mediaFormat: { encoding: codecInfo.encoding, sampleRate: codecInfo.sampleRate, channels: 1 },
            extraCustomParameters
          },
          callLog
        );
      } catch (err) {
        callLog.warn({ err, event: "ws_connect_failed" }, "WS connect failed — sending 503");
        const resp503 = buildResponse({
          status: 503,
          reason: "Service Unavailable",
          vias,
          from,
          to: toHeader,
          callId: sipCallId,
          cseq
        });
        this.sipHandle.sendRaw(Buffer.from(resp503), rinfo.port, rinfo.address);
        rtp.dispose();
        return;
      }
      if (this.cancelledInvites.has(sipCallId) || this.pendingInvites.get(sipCallId) !== pending || Date.now() >= pending.expires || this.isShuttingDown) {
        ws.stop();
        rtp.dispose();
        return;
      }
      const localIp = this.config.SDP_CONTACT_IP ?? getLocalIp();
      const { sdp: sdpAnswerStr } = buildSdpAnswer(
        localIp,
        rtp.localPort,
        sdpOffer,
        this.config.AUDIO_MODE,
        this.config.SRTP_ENABLED,
        localSrtpKey,
        localSrtpSalt
      );
      const ok = buildResponse({
        status: 200,
        reason: "OK",
        vias,
        recordRoutes,
        from,
        to: `${toHeader};tag=${localTag}`,
        callId: sipCallId,
        cseq,
        sdpBody: sdpAnswerStr,
        localIp,
        sipUser: this.config.SIP_USER,
        sipDomain: this.config.SIP_DOMAIN,
        localSipPort: this.localSipPort
      });
      const okBuf = Buffer.from(ok);
      callLog.info(
        { event: "200_ok_sent", dest: `${rinfo.address}:${rinfo.port}`, recordRoutes: recordRoutes.length },
        "200 OK sent"
      );
      this.sipHandle.sendRaw(okBuf, rinfo.port, rinfo.address);
      const session = {
        callId: sipCallId,
        callSid,
        streamSid,
        rtp,
        ws,
        localTag,
        remoteTag,
        signalingPeer: { address: rinfo.address, port: rinfo.port },
        inviteRaw: raw,
        remoteCseq: seq,
        remoteUri,
        remoteTarget: remoteContact,
        recordRoutes,
        localUri,
        remoteRtpIp: sdpOffer.remoteIp,
        remoteRtpPort: sdpOffer.remotePort,
        localRtpPort: rtp.localPort,
        cseq: 1,
        log: callLog,
        okRetransmitTimer: null,
        wsReconnecting: false,
        silenceInterval: null,
        keepaliveInterval: null,
        lastRtpTxAt: 0,
        sdpAnswer: sdpAnswerStr,
        silenceByte: rtp.silenceByte,
        encodeSilence,
        wsStreamURL: streamURL,
        accountSid: this.accountSid,
        fromNumber: fromUri,
        toNumber: toUri,
        startTime: /* @__PURE__ */ new Date(),
        answeredAt: /* @__PURE__ */ new Date(),
        state: "streaming" /* Streaming */,
        terminalReason: null,
        sipFinalCode: 200,
        seqCounter: 0,
        statusCallback: this.defaultStatusCallback(),
        forwardRtp: null,
        forwardDialog: null,
        onForwardEnd: null,
        hangupOnStar: false
      };
      this.sessions.set(sipCallId, session);
      this.callSidIdx.set(callSid, session);
      this.metrics?.incActiveCalls();
      this.emitStatusEvent(session, "initiated", "queued");
      this.emitStatusEvent(session, "ringing", "ringing");
      this.emitStatusEvent(session, "answered", "in-progress");
      let retransmitInterval = 500;
      const scheduleOkRetransmit = () => {
        if (!this.sessions.has(sipCallId)) return;
        this.sipHandle.sendRaw(okBuf, rinfo.port, rinfo.address);
        callLog.info({ event: "200_ok_retransmit", interval: retransmitInterval }, "200 OK retransmitted");
        retransmitInterval = Math.min(retransmitInterval * 2, 4e3);
        session.okRetransmitTimer = setTimeout(scheduleOkRetransmit, retransmitInterval);
      };
      session.okRetransmitTimer = setTimeout(scheduleOkRetransmit, retransmitInterval);
      callLog.info({ event: "call_started", from: fromUri, to: toUri }, "Call started");
      if (useSrtp) {
        callLog.info({ event: "srtp_negotiated" }, "SRTP negotiated — media encrypted with AES-128-CM-HMAC-SHA1-80");
      }
      let firstRtp = true;
      rtp.on("audio", (payload) => {
        this.metrics?.incRtpRx();
        if (session.forwardRtp) {
          session.forwardRtp.sendAudio(payload);
          return;
        }
        if (session.wsReconnecting) return;
        if (firstRtp) {
          callLog.info({ event: "first_rtp_audio", bytes: payload.length }, "First RTP audio packet received from sipgate");
          firstRtp = false;
        }
        session.ws.sendAudio(payload);
      });
      rtp.on("dtmf", ({ digit }) => {
        if (session.forwardRtp) {
          if (session.hangupOnStar && digit === "*") {
            callLog.info({ event: "dial_hangup_on_star" }, "caller pressed * — ending forwarded call");
            session.onForwardEnd?.();
          }
          return;
        }
        session.ws.sendDtmf(digit);
      });
      let firstWsAudio = true;
      ws.onAudio((payload) => {
        if (firstWsAudio) {
          callLog.info({ event: "first_ws_audio", bytes: payload.length }, "First audio from WS backend — sending to sipgate");
          firstWsAudio = false;
        }
        this.metrics?.incRtpTx();
        session.lastRtpTxAt = Date.now();
        rtp.sendAudio(payload);
      });
      ws.onMark((markName) => {
        session.ws.sendMark(markName);
      });
      const wsParams = {
        streamSid: session.streamSid,
        callSid: session.callSid,
        from: fromUri,
        to: toUri,
        sipCallId,
        mediaFormat: { encoding: codecInfo.encoding, sampleRate: codecInfo.sampleRate, channels: 1 },
        extraCustomParameters
      };
      ws.onDisconnect(() => {
        if (!shouldReconnectWs(session.state, this.sessions.has(session.callId))) return;
        session.wsReconnecting = true;
        void this.startWsReconnectLoop(session, wsParams).catch((err) => {
          session.log.error({ err }, "Reconnect loop unhandled error");
        });
      });
      rtp.startForwarding();
      session.keepaliveInterval = setInterval(() => {
        if (session.forwardRtp !== null || session.wsReconnecting) return;
        if (Date.now() - session.lastRtpTxAt < 20) return;
        this.metrics?.incRtpTx();
        session.lastRtpTxAt = Date.now();
        session.rtp.sendAudio(encodeSilence());
      }, 20);
    } finally {
      clearTimeout(pending.timer);
      if (this.pendingInvites.get(sipCallId) === pending) {
        this.pendingInvites.delete(sipCallId);
        this.cancelledInvites.delete(sipCallId);
      }
      if (allocatedRtp && !this.sessions.has(sipCallId)) {
        try {
          allocatedRtp.dispose();
        } catch {
        }
      }
    }
  }
  // IP filtering is defense in depth, not cryptographic signaling authentication.
  isTrustedPeer(peer) {
    return peer.address === this.sipHandle.registrarIp || (this.config.SIP_TRUSTED_PEERS ?? "").split(",").map((s) => s.trim()).includes(peer.address);
  }
  matchesPeer(session, peer) {
    return this.isTrustedPeer(peer) && session.signalingPeer?.address === peer.address && session.signalingPeer?.port === peer.port;
  }
  matchesDialog(session, raw, peer, method) {
    const seq = parseCseq(raw, method);
    return this.matchesPeer(session, peer) && tagOf(extractHeader(raw, "From")) === session.remoteTag && tagOf(extractHeader(raw, "To")) === session.localTag && branchOf(raw).startsWith("z9hG4bK") && seq !== null && (method === "ACK" ? seq === parseCseq(session.inviteRaw ?? "", "INVITE") : seq > (session.remoteCseq ?? -1));
  }
  // ── Private: CANCEL handler ─────────────────────────────────────────────────
  handleCancel(raw, rinfo) {
    if (!this.isTrustedPeer(rinfo)) return;
    const pending = this.pendingInvites.get(extractHeader(raw, "Call-ID"));
    if (this.sessions.has(extractHeader(raw, "Call-ID"))) return;
    if (!pending || pending.expires <= Date.now() || pending.address !== rinfo.address || pending.port !== rinfo.port || !sameInviteTransaction(pending.raw, raw, true)) return;
    const callId = extractHeader(raw, "Call-ID");
    const vias = extractAllVias(raw);
    const from = extractHeader(raw, "From");
    const to = extractHeader(raw, "To");
    const cseq = extractHeader(raw, "CSeq");
    const cancelOk = buildResponse({ status: 200, reason: "OK", vias, from, to, callId, cseq });
    this.sipHandle.sendRaw(Buffer.from(cancelOk), rinfo.port, rinfo.address);
    if (this.pendingInvites.has(callId)) {
      this.cancelledInvites.add(callId);
      const resp487 = buildResponse({
        status: 487,
        reason: "Request Terminated",
        vias: extractAllVias(raw),
        from,
        to,
        callId,
        cseq: extractHeader(raw, "CSeq").replace("CANCEL", "INVITE")
      });
      this.sipHandle.sendRaw(Buffer.from(resp487), rinfo.port, rinfo.address);
      this.log.info({ event: "cancel_pending", callId }, "CANCEL received during setup — 487 sent");
      return;
    }
    this.log.warn({ event: "cancel_unknown", callId }, "CANCEL for unknown call-id");
  }
  // ── Private: BYE handler ────────────────────────────────────────────────────
  handleBye(raw, rinfo) {
    if (!this.isTrustedPeer(rinfo)) return;
    const callId = extractHeader(raw, "Call-ID");
    const session = this.sessions.get(callId);
    if (!session) {
      this.log.warn({ event: "bye_unknown_call", callId }, "BYE for unknown call-id — ignoring");
      return;
    }
    if (!this.matchesDialog(session, raw, rinfo, "BYE")) return;
    session.remoteCseq = parseCseq(raw, "BYE");
    const byeOk = buildResponse({
      status: 200,
      reason: "OK",
      vias: extractAllVias(raw),
      from: extractHeader(raw, "From"),
      to: extractHeader(raw, "To"),
      callId,
      cseq: extractHeader(raw, "CSeq")
    });
    this.sipHandle.sendRaw(Buffer.from(byeOk), rinfo.port, rinfo.address);
    this.terminateSession(session, "remote_bye", false);
  }
  // ── Private: session teardown ───────────────────────────────────────────────
  /**
   * Tear down a CallSession.
   *
   * @param sendBye - true if we are initiating termination (WS disconnect,
   *   shutdown) and must send SIP BYE to the caller first; false if the remote
   *   already sent BYE and we must NOT send another BYE (protocol violation).
   */
  terminateSession(session, reason, sendBye) {
    if (!this.sessions.has(session.callId)) return;
    this.sessions.delete(session.callId);
    this.callSidIdx.delete(session.callSid);
    session.state = reason === "remote_bye" ? "hung-up" /* HungUp */ : "terminated" /* Terminated */;
    session.terminalReason = reason;
    const endTime = /* @__PURE__ */ new Date();
    this.recentlyTerminated.set(session.callSid, {
      ...this.toBridgeCall(session, endTime),
      terminatedAt: endTime.getTime()
    });
    this.metrics?.decActiveCalls();
    if (this.statusClient && session.statusCallback) {
      const terminalStatus = twilioStatus(session.state, reason);
      const callDurationSec = session.answeredAt ? Math.max(0, Math.round((endTime.getTime() - session.answeredAt.getTime()) / 1e3)) : void 0;
      this.emitStatusEvent(session, terminalStatus, terminalStatus, {
        callDurationSec,
        sipResponseCode: session.sipFinalCode
      });
      void this.statusClient.drainAndClose(session.callSid);
    }
    if (session.okRetransmitTimer !== null) {
      clearTimeout(session.okRetransmitTimer);
      session.okRetransmitTimer = null;
    }
    if (session.silenceInterval !== null) {
      clearInterval(session.silenceInterval);
      session.silenceInterval = null;
    }
    if (session.keepaliveInterval !== null) {
      clearInterval(session.keepaliveInterval);
      session.keepaliveInterval = null;
    }
    session.log.info({ event: "call_ended", reason, sendBye }, "Call terminated");
    if (sendBye) {
      const localIp = this.config.SDP_CONTACT_IP ?? getLocalIp();
      const bye = buildBye({
        remoteTarget: session.remoteTarget,
        localIp,
        localSipPort: this.localSipPort,
        fromUri: session.localUri,
        // dialog-local URI (the INVITE To-URI), NOT SIP_USER
        fromTag: session.localTag,
        toUri: session.remoteUri,
        toTag: session.remoteTag,
        callId: session.callId,
        cseq: session.cseq,
        recordRoutes: session.recordRoutes
      });
      const [byeHost, byePort] = byeSendTarget(session.recordRoutes, session.remoteTarget);
      this.sipHandle.sendRaw(Buffer.from(bye), byePort, byeHost);
      session.log.info({ event: "bye_sent", sendTo: `${byeHost}:${byePort}` }, "SIP BYE sent");
      session.log.debug({ event: "bye_message", bye }, "BYE message");
    }
    if (session.forwardDialog) {
      void session.forwardDialog.bye();
      session.forwardDialog = null;
    }
    if (session.forwardRtp) {
      session.forwardRtp.dispose();
      session.forwardRtp = null;
    }
    const onEnd = session.onForwardEnd;
    session.onForwardEnd = null;
    onEnd?.();
    session.ws.stop();
    session.rtp.dispose();
  }
  // ── Private: WS reconnect loop ──────────────────────────────────────────────
  /**
   * Attempt to reconnect the WebSocket with exponential backoff.
   *
   * - Sends μ-law silence to caller every 20ms throughout the reconnect window (WSR-01).
   * - Re-calls createWsClient with the same params so backend receives fresh
   *   connected + start events on reconnect (WSR-02).
   * - Inbound RTP is dropped via session.wsReconnecting gate (WSR-03).
   * - Exits early if caller sends BYE while loop is sleeping (anti-zombie guard).
   * - Calls terminateSession on budget exhaustion (30s) to send SIP BYE.
   */
  async startWsReconnectLoop(session, params) {
    const BUDGET_MS = 3e4;
    const CAP_MS = 4e3;
    const started = Date.now();
    let delay = 1e3;
    session.silenceInterval = setInterval(() => {
      this.metrics?.incRtpTx();
      session.rtp.sendAudio(session.encodeSilence());
    }, 20);
    const cleanup = () => {
      if (session.silenceInterval !== null) {
        clearInterval(session.silenceInterval);
        session.silenceInterval = null;
      }
    };
    const attempt = async (n) => {
      if (!shouldReconnectWs(session.state, this.sessions.has(session.callId))) {
        cleanup();
        return;
      }
      this.metrics?.incWsReconnect();
      session.log.info({ event: "ws_reconnect_attempt", attempt: n, delay }, "Attempting WS reconnect");
      try {
        const newWs = await createWsClient(session.wsStreamURL, params, session.log);
        cleanup();
        session.wsReconnecting = false;
        session.ws = newWs;
        newWs.onAudio((payload) => {
          this.metrics?.incRtpTx();
          session.lastRtpTxAt = Date.now();
          session.rtp.sendAudio(payload);
        });
        newWs.onMark((markName) => {
          session.ws.sendMark(markName);
        });
        newWs.onDisconnect(() => {
          if (!shouldReconnectWs(session.state, this.sessions.has(session.callId))) return;
          session.wsReconnecting = true;
          void this.startWsReconnectLoop(session, params).catch((err) => {
            session.log.error({ err }, "Reconnect loop unhandled error");
          });
        });
        session.log.info({ event: "ws_reconnected", attempt: n }, "WS reconnected — resuming audio bridge");
      } catch {
        const elapsed = Date.now() - started;
        if (elapsed + delay >= BUDGET_MS) {
          cleanup();
          session.log.warn({ event: "ws_reconnect_failed", elapsed }, "WS reconnect budget exhausted — sending BYE");
          this.terminateSession(session, "ws_reconnect_failed", true);
          return;
        }
        session.log.info({ event: "ws_reconnect_wait", delay, elapsed }, "WS reconnect failed — waiting before retry");
        await new Promise((res) => setTimeout(res, delay));
        delay = Math.min(delay * 2, CAP_MS);
        await attempt(n + 1);
      }
    };
    await attempt(1);
  }
};

// vendor/sip-bridge/src/logger/index.ts
import { Writable } from "node:stream";
import pino from "pino";
var MASK_REPLACEMENT = "***";
function prepareSecrets(secrets) {
  const nonempty = secrets.filter((s) => s !== "");
  if (nonempty.length === 0) return null;
  nonempty.sort((a, b) => b.length - a.length);
  return nonempty;
}
function maskChunk(chunk, secrets) {
  let masked = chunk;
  for (const s of secrets) {
    masked = masked.split(s).join(MASK_REPLACEMENT);
  }
  return masked;
}
function newSecretMaskWriter(underlying, ...secrets) {
  const prepared = prepareSecrets(secrets);
  if (prepared === null) {
    return underlying;
  }
  return new Writable({
    write(chunk, _encoding, callback) {
      const text2 = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      try {
        underlying.write(maskChunk(text2, prepared));
      } catch (err) {
        callback(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      callback();
    }
  });
}
var rootLogger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: "sipgate-sip-stream-bridge" }
});
function createMaskedLogger(secrets, dest = process.stdout) {
  const sink = newSecretMaskWriter(dest, ...secrets);
  return pino(
    {
      level: process.env.LOG_LEVEL ?? "info",
      base: { service: "sipgate-sip-stream-bridge" }
    },
    sink
  );
}

// vendor/sip-bridge/src/sip/userAgent.ts
import crypto2 from "node:crypto";
import dgram2 from "node:dgram";
import dns from "node:dns/promises";
import net from "node:net";
import os2 from "node:os";
function randomHex(n) {
  return crypto2.randomBytes(n).toString("hex");
}
function md5(s) {
  return crypto2.createHash("md5").update(s).digest("hex");
}
function getLocalIp2() {
  for (const ifaces of Object.values(os2.networkInterfaces())) {
    for (const iface of ifaces ?? []) {
      if (!iface.internal && iface.family === "IPv4") return iface.address;
    }
  }
  return "127.0.0.1";
}
function parseAuthChallenge(header) {
  const result = {};
  let m;
  const re = /(\w+)="([^"]*)"/g;
  while ((m = re.exec(header)) !== null) result[m[1]] = m[2];
  return result;
}
function buildRegister(p) {
  const sipUri = `sip:${p.user}@${p.domain}`;
  const registrarUri = `sip:${p.registrar}`;
  const contactUri = `sip:${p.user}@${p.localIp}:${p.localPort}`;
  const lines = [
    `REGISTER ${registrarUri} SIP/2.0`,
    `Via: SIP/2.0/UDP ${p.localIp}:${p.localPort};branch=${p.branch};rport`,
    `Max-Forwards: 70`,
    `From: <${sipUri}>;tag=${p.fromTag}`,
    `To: <${sipUri}>`,
    `Call-ID: ${p.callId}`,
    `CSeq: ${p.seq} REGISTER`,
    `Contact: <${contactUri}>`,
    `Expires: ${p.expires}`,
    `User-Agent: ${USER_AGENT}`
  ];
  if (p.auth) lines.push(`Authorization: ${p.auth}`);
  lines.push("Content-Length: 0", "");
  return lines.join("\r\n") + "\r\n";
}
function parseStatusLine(raw) {
  const m = raw.split("\r\n")[0].match(/^SIP\/2\.0 ([1-6]\d{2}) (.*)$/);
  return m ? { status: +m[1], reason: m[2] } : { status: 0, reason: "unparseable" };
}
function getHeader(raw, name) {
  const m = raw.match(new RegExp(`^${name}:\\s*(.+)$`, "im"));
  return m ? m[1].trim() : null;
}
function applyOptionsResponse(consecutiveFailures, status, isError) {
  const threshold = 2;
  const isAuth = status === 401 || status === 407;
  const isFailure = isError || status === 404 || status >= 500;
  if (isAuth) return { newCount: 0, triggerRegister: false };
  if (isFailure) {
    const next = consecutiveFailures + 1;
    if (next >= threshold) return { newCount: 0, triggerRegister: true };
    return { newCount: next, triggerRegister: false };
  }
  return { newCount: 0, triggerRegister: false };
}
async function createSipUserAgent(config, log, callbacks, signal) {
  signal?.throwIfAborted();
  const registrar = config.SIP_REGISTRAR;
  const registrarPort = config.SIP_REGISTRAR_PORT ?? 5060;
  const registrarIp = await resolveRegistrar(registrar, signal);
  signal?.throwIfAborted();
  const localIp = config.SDP_CONTACT_IP ?? getLocalIp2();
  const { host: bindHost, port: localPort } = listenParts(config.SIP_LISTEN_ADDR);
  const callId = `${randomHex(10)}@sipgate-sip-stream-bridge`;
  const fromTag = randomHex(6);
  let cseq = 1;
  let refreshTimer = null;
  let consecutiveFailures = 0;
  let optionsTimer = null;
  let settled = false;
  let stopped = false;
  const socket = dgram2.createSocket("udp4");
  const transactions = /* @__PURE__ */ new Map();
  const maxAuthRetries = 2;
  function retireTransaction(method) {
    const transaction = transactions.get(method);
    if (transaction) clearTimeout(transaction.timer);
    transactions.delete(method);
  }
  function trackTransaction(method, seq, branch, authRetries = 0) {
    retireTransaction(method);
    const timeout = method === "OPTIONS" ? 5e3 : 32e3;
    const transaction = {
      seq: String(seq),
      branch,
      sentBy: `${localIp}:${localPort}`,
      deadline: Date.now() + timeout,
      authRetries,
      timer: setTimeout(() => {
        if (transactions.get(method) !== transaction) return;
        retireTransaction(method);
        if (method === "OPTIONS") handleOptionsResponse(0, new Error("OPTIONS timeout"));
        else registrationFailed(new Error("REGISTER timeout"));
      }, timeout)
    };
    transactions.set(method, transaction);
  }
  let registrationFailed = () => {
  };
  const dialogs = /* @__PURE__ */ new Map();
  function sendRegister(authHeader, authRetries = 0) {
    if (stopped) return;
    const branch = `z9hG4bK${randomHex(6)}`;
    const seq = cseq++;
    const msg = buildRegister({
      user: config.SIP_USER,
      domain: config.SIP_DOMAIN,
      registrar,
      localIp,
      localPort,
      callId,
      fromTag,
      seq,
      expires: config.SIP_EXPIRES,
      branch,
      auth: authHeader
    });
    trackTransaction("REGISTER", seq, branch, authRetries);
    const buf = Buffer.from(msg);
    socket.send(buf, registrarPort, registrarIp, (err) => {
      if (err) {
        log.error({ err, event: "sip_send_error" }, "Failed to send REGISTER");
        socket.emit("error", err);
      }
    });
  }
  function buildOptions(seq, branch) {
    const sipUri = `sip:${config.SIP_USER}@${config.SIP_DOMAIN}`;
    const registrarUri = `sip:${registrar}`;
    const lines = [
      `OPTIONS ${registrarUri} SIP/2.0`,
      `Via: SIP/2.0/UDP ${localIp}:${localPort};branch=${branch};rport`,
      "Max-Forwards: 70",
      `From: <${sipUri}>;tag=${fromTag}`,
      `To: <${sipUri}>`,
      `Call-ID: ${callId}`,
      `CSeq: ${seq} OPTIONS`,
      `User-Agent: ${USER_AGENT}`,
      "Content-Length: 0",
      ""
    ];
    return lines.join("\r\n") + "\r\n";
  }
  function handleOptionsResponse(status, err) {
    const result = applyOptionsResponse(consecutiveFailures, status, err !== null);
    consecutiveFailures = result.newCount;
    if (result.triggerRegister) {
      log.warn({ event: "options_reregister" }, "OPTIONS keepalive: 2 consecutive failures — re-registering");
      sendRegister();
    } else if (err !== null || status === 404 || status >= 500) {
      log.warn({ event: "options_failure", consecutiveFailures }, "OPTIONS keepalive failure");
    } else if (status === 401 || status === 407) {
      log.debug({ event: "options_auth", status }, "OPTIONS 401/407 — server reachable");
    } else {
      log.debug({ event: "options_ok" }, "OPTIONS keepalive success");
    }
  }
  log.info({ event: "ua_starting", registrar, localIp, localPort }, "Starting SIP registrar (UDP)");
  return new Promise((resolve, reject) => {
    function cleanup() {
      if (stopped) return;
      stopped = true;
      signal?.removeEventListener("abort", abort);
      if (refreshTimer) clearTimeout(refreshTimer);
      if (optionsTimer) clearInterval(optionsTimer);
      for (const method of transactions.keys()) retireTransaction(method);
      dialogs.clear();
      socket.removeAllListeners("message");
      try {
        socket.close();
      } catch (error) {
        if (error.code !== "ERR_SOCKET_DGRAM_NOT_RUNNING") throw error;
      }
    }
    function fail(error) {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    }
    registrationFailed = (error) => {
      if (!settled) fail(error);
      else log.error({ err: error, event: "sip_register_failed" }, error.message);
    };
    function abort() {
      fail(signal?.reason instanceof Error ? signal.reason : new Error("SIP startup aborted"));
    }
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) {
      abort();
      return;
    }
    socket.on("error", (err) => {
      log.error({ err, event: "sip_udp_error" }, "SIP UDP socket error");
      fail(err);
    });
    socket.on("message", (buf, rinfo) => {
      const raw = buf.toString();
      const firstLine = raw.split("\r\n")[0];
      const msgCallId = getHeader(raw, "Call-ID") ?? "";
      const dialog = msgCallId !== "" ? dialogs.get(msgCallId) : void 0;
      if (dialog) {
        if (firstLine.startsWith("SIP/2.0")) {
          dialog.onResponse?.(raw, rinfo);
        } else {
          dialog.onRequest?.(firstLine.split(" ")[0], raw, rinfo);
        }
        return;
      }
      if (firstLine.startsWith("SIP/2.0")) {
        if (rinfo.address !== registrarIp || rinfo.port !== registrarPort) return;
        const headers = raw.split("\r\n\r\n", 1)[0];
        const uniqueHeader = (name) => {
          const values = [...headers.matchAll(new RegExp(`^${name}:[ 	]*([^\r
]+)`, "gim"))];
          return values.length === 1 ? values[0][1].trim() : null;
        };
        const cseqVal = uniqueHeader("CSeq");
        const parsedCseq = cseqVal?.match(/^(\d+) (REGISTER|OPTIONS)$/);
        if (!parsedCseq || uniqueHeader("Call-ID") !== callId) return;
        const method = parsedCseq[2];
        const transaction = transactions.get(method);
        if (!transaction || parsedCseq[1] !== transaction.seq) return;
        const via = getHeader(headers, "Via")?.split(",")[0];
        const parsedVia = via?.match(/^SIP\/2\.0\/UDP ([^;\s]+)((?:;.*)?)$/);
        const branches = parsedVia ? [...parsedVia[2].matchAll(/;branch=([^;\s,]+)/g)] : [];
        if (!parsedVia || parsedVia[1] !== transaction.sentBy || branches.length !== 1 || branches[0][1] !== transaction.branch) return;
        if (Date.now() >= transaction.deadline) return;
        const { status, reason } = parseStatusLine(raw);
        if (status < 200 || status > 699) return;
        retireTransaction(method);
        if (method === "OPTIONS") {
          handleOptionsResponse(status, null);
          return;
        }
        if (status === 401 || status === 407) {
          const challengeHeader = getHeader(raw, status === 401 ? "WWW-Authenticate" : "Proxy-Authenticate");
          if (!challengeHeader) {
            log.error({ event: "auth_missing", status }, `Got ${status} without auth challenge header`);
            registrationFailed(new Error(`SIP ${status} without challenge`));
            return;
          }
          if (transaction.authRetries >= maxAuthRetries) {
            registrationFailed(new Error("SIP REGISTER authentication retry limit exceeded"));
            return;
          }
          const params = parseAuthChallenge(challengeHeader);
          const registrarUri = `sip:${registrar}`;
          const ha1 = md5(`${config.SIP_USER}:${params["realm"]}:${config.SIP_PASSWORD}`);
          const ha2 = md5(`REGISTER:${registrarUri}`);
          const response = md5(`${ha1}:${params["nonce"]}:${ha2}`);
          const auth = `Digest username="${config.SIP_USER}", realm="${params["realm"]}", nonce="${params["nonce"]}", uri="${registrarUri}", response="${response}", algorithm=MD5`;
          log.debug({ event: "auth_challenge", status }, `Responding to ${status} auth challenge`);
          sendRegister(auth, transaction.authRetries + 1);
        } else if (status === 200) {
          log.info({ event: "sip_registered", expires: config.SIP_EXPIRES }, "SIP 200 OK — registration confirmed");
          const refreshMs = Math.floor(config.SIP_EXPIRES * 0.9) * 1e3;
          if (refreshTimer) clearTimeout(refreshTimer);
          refreshTimer = setTimeout(() => {
            log.debug({ event: "sip_reregister" }, "Re-registering before expiry");
            sendRegister();
          }, refreshMs);
          if (optionsTimer) clearInterval(optionsTimer);
          optionsTimer = setInterval(() => {
            const branch = `z9hG4bK${randomHex(6)}`;
            if (transactions.has("OPTIONS")) return;
            const seq = cseq++;
            const optBuf = Buffer.from(buildOptions(seq, branch));
            trackTransaction("OPTIONS", seq, branch);
            socket.send(optBuf, registrarPort, registrarIp, (err) => {
              if (err && transactions.get("OPTIONS")?.branch === branch) {
                retireTransaction("OPTIONS");
                handleOptionsResponse(0, err);
              }
            });
          }, config.SIP_OPTIONS_INTERVAL * 1e3);
          if (!settled) {
            settled = true;
            signal?.removeEventListener("abort", abort);
            resolve({
              registrarIp,
              stop() {
                cleanup();
              },
              sendRaw(sendBuf, port, host) {
                socket.send(sendBuf, port, host, (err) => {
                  if (err) log.error({ err, event: "sip_send_raw_error" }, "sendRaw failed");
                });
              },
              registerDialog(dialogCallId, handlers) {
                dialogs.set(dialogCallId, handlers);
              },
              unregisterDialog(dialogCallId) {
                dialogs.delete(dialogCallId);
              },
              unregister() {
                retireTransaction("REGISTER");
                const branch = `z9hG4bK${randomHex(6)}`;
                const sipUri = `sip:${config.SIP_USER}@${config.SIP_DOMAIN}`;
                const registrarUri = `sip:${registrar}`;
                const msg = [
                  `REGISTER ${registrarUri} SIP/2.0`,
                  `Via: SIP/2.0/UDP ${localIp}:${localPort};branch=${branch};rport`,
                  "Max-Forwards: 70",
                  `From: <${sipUri}>;tag=${fromTag}`,
                  `To: <${sipUri}>`,
                  `Call-ID: ${callId}`,
                  `CSeq: ${cseq++} REGISTER`,
                  "Contact: *",
                  "Expires: 0",
                  "Content-Length: 0",
                  ""
                ].join("\r\n") + "\r\n";
                return new Promise((resolveSend, rejectSend) => {
                  socket.send(Buffer.from(msg), registrarPort, registrarIp, (err) => {
                    if (err) {
                      log.error({ err, event: "sip_unregister_error" }, "unregister send failed");
                      rejectSend(err);
                    } else resolveSend();
                  });
                });
              }
            });
          }
        } else {
          log.error({ event: "sip_register_failed", status, reason }, `SIP registration rejected: ${status} ${reason}`);
          registrationFailed(new Error(`SIP ${status} ${reason}`));
        }
      } else if (firstLine.startsWith("INVITE ")) {
        callbacks?.onInvite?.(raw, rinfo);
      } else if (firstLine.startsWith("ACK ")) {
        callbacks?.onAck?.(raw, rinfo);
      } else if (firstLine.startsWith("BYE ")) {
        callbacks?.onBye?.(raw, rinfo);
      } else if (firstLine.startsWith("CANCEL ")) {
        callbacks?.onCancel?.(raw, rinfo);
      } else if (firstLine.startsWith("OPTIONS ")) {
        const via = getHeader(raw, "Via") ?? "";
        const from = getHeader(raw, "From") ?? "";
        const to = getHeader(raw, "To") ?? "";
        const callIdVal = getHeader(raw, "Call-ID") ?? "";
        const cseqVal = getHeader(raw, "CSeq") ?? "";
        const response = [
          "SIP/2.0 200 OK",
          `Via: ${via}`,
          `From: ${from}`,
          `To: ${to}`,
          `Call-ID: ${callIdVal}`,
          `CSeq: ${cseqVal}`,
          `User-Agent: ${USER_AGENT}`,
          "Content-Length: 0",
          ""
        ].join("\r\n") + "\r\n";
        socket.send(Buffer.from(response), rinfo.port, rinfo.address);
      }
    });
    socket.bind(localPort, bindHost, () => {
      if (!stopped) sendRegister();
    });
  });
}
async function resolveRegistrar(registrar, signal) {
  if (net.isIPv4(registrar)) return registrar;
  const resolver = new dns.Resolver();
  const cancel = () => resolver.cancel();
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    signal?.throwIfAborted();
    const addresses = await resolver.resolve4(registrar);
    if (!addresses[0]) throw new Error("SIP registrar has no IPv4 address");
    return addresses[0];
  } finally {
    signal?.removeEventListener("abort", cancel);
  }
}

// src/embedded/config.ts
function mapEmbeddedConfig(config, address) {
  let host = address.address;
  if (host === "0.0.0.0") host = "127.0.0.1";
  if (host === "::") host = "::1";
  if (host.includes(":")) host = `[${host}]`;
  return {
    SIP_USER: config.sip.user,
    SIP_PASSWORD: config.sip.password,
    SIP_DOMAIN: config.sip.domain,
    SIP_REGISTRAR: config.sip.registrar,
    SIP_LISTEN_ADDR: config.sip.listenAddr,
    SDP_CONTACT_IP: config.sip.publicIp,
    RTP_PORT_MIN: config.media.rtpPortMin,
    RTP_PORT_MAX: config.media.rtpPortMax,
    SRTP_ENABLED: config.sip.srtp || config.sip.srtpRequired,
    SRTP_REQUIRED: config.sip.srtpRequired,
    AUDIO_MODE: config.audio.mode,
    WS_TARGET_URL: `ws://${host}:${address.port}${config.media.path}${config.media.authToken ? `?token=${encodeURIComponent(config.media.authToken)}` : ""}`,
    SIP_EXPIRES: 120,
    SIP_OPTIONS_INTERVAL: 30,
    LOG_LEVEL: "info",
    HTTP_PORT: 9090,
    VOICE_URL: void 0,
    VOICE_METHOD: "POST",
    VOICE_FALLBACK_URL: void 0,
    VOICE_FALLBACK_METHOD: "POST",
    VOICE_TIMEOUT_S: 5,
    AUTH_TOKEN: "",
    PUBLIC_BASE_URL: void 0,
    SIP_OUTBOUND_TARGET_PORT: 0,
    STATUS_CALLBACK_DEFAULT_URL: void 0,
    STATUS_CALLBACK_DEFAULT_METHOD: "POST",
    STATUS_CALLBACK_DEFAULT_EVENTS: "initiated,ringing,answered,completed",
    DIAL_ALLOWED_PREFIXES: "",
    DIAL_DEFAULT_CALLER_ID: void 0,
    DIAL_CALLER_ID_COUNTRY_CODE: void 0,
    DIAL_RING_TIMEOUT_S: 30,
    DIAL_MAX_PER_SESSION: 3,
    DIAL_MAX_PER_MINUTE: 60
  };
}

// src/embedded/embeddedTransport.ts
var defaults = {
  createManager: (config, log) => new CallManager(config, log),
  createAgent: createSipUserAgent,
  startupTimeoutMs: 15e3
};
async function cleanupAll(steps) {
  const errors = [];
  for (const step of steps) {
    try {
      await step();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length) throw new AggregateError(errors, "SIP cleanup failed");
}
async function startEmbeddedTransport(config, address, onLog, overrides = {}) {
  const deps = { ...defaults, ...overrides };
  const mapped = mapEmbeddedConfig(config, address);
  const destination = onLog ? new Writable2({
    write(chunk, _encoding, done) {
      try {
        const entry2 = JSON.parse(String(chunk));
        onLog(String(entry2["msg"] ?? "sip"), entry2);
        done();
      } catch (error) {
        done(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }) : process.stdout;
  const log = createMaskedLogger([mapped.SIP_PASSWORD, mapped.SIP_USER], destination);
  const manager = deps.createManager(mapped, log);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("SIP registration startup timeout")), deps.startupTimeoutMs);
  let sip;
  try {
    sip = await deps.createAgent(mapped, log, manager.getCallbacks(), controller.signal);
    manager.setSipHandle(sip);
  } catch (error) {
    try {
      await cleanupAll([() => manager.terminateAll(), () => sip?.stop()]);
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "SIP startup and cleanup failed");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
  const handle = sip;
  let stopping;
  return {
    terminateCall: (callSid, reason) => manager.terminateByCallSid?.(callSid, reason) ?? false,
    stop: () => stopping ??= cleanupAll([
      () => manager.terminateAll(),
      () => handle.unregister(),
      () => handle.stop()
    ])
  };
}

// src/voice/deepgramAgent.ts
import WebSocket3 from "ws";

// src/voice/voiceCall.ts
import WebSocket2 from "ws";

// src/voice/textLimits.ts
var MAX_VOICE_REPLY_CHARS = 32768;
var MAX_TTS_CHUNK_CHARS = 500;

// src/voice/voiceCall.ts
function splitSentences(text2) {
  const chunks = [];
  for (const sentence of text2.match(/.+?(?:[.!?]+(?=\s|$)|$)/gs) ?? [text2]) {
    let remaining = sentence.trim();
    while (remaining.length > MAX_TTS_CHUNK_CHARS) {
      const boundary = remaining.lastIndexOf(" ", MAX_TTS_CHUNK_CHARS);
      const length = boundary > 0 ? boundary : MAX_TTS_CHUNK_CHARS;
      chunks.push(remaining.slice(0, length));
      remaining = remaining.slice(length).trim();
    }
    if (remaining) chunks.push(remaining);
  }
  return chunks;
}
function pcm24kToPcm(data, sampleRate) {
  if (data.length % 6) throw new Error("Incomplete 24 kHz PCM group");
  if (sampleRate !== 8e3 && sampleRate !== 16e3) throw new Error("Unsupported output sample rate");
  const source = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const samples = source.length / 2;
  const output = Buffer.alloc(sampleRate === 8e3 ? samples / 3 * 2 : samples / 3 * 4);
  for (let index = 0; index < samples / 3; index++) {
    const first = source.readInt16LE(index * 6);
    const second = source.readInt16LE(index * 6 + 2);
    const third = source.readInt16LE(index * 6 + 4);
    if (sampleRate === 8e3) output.writeInt16LE(Math.round((first + second + third) / 3), index * 2);
    else {
      output.writeInt16LE(Math.round((3 * first + 2 * second + third) / 6), index * 4);
      output.writeInt16LE(Math.round((first + 2 * second + 3 * third) / 6), index * 4 + 2);
    }
  }
  return output;
}
var VoiceCall = class {
  constructor(session, config, utterance, log, dependencies = {}) {
    this.session = session;
    this.config = config;
    this.utterance = utterance;
    this.log = log;
    this.dependencies = dependencies;
    session.setQueueLimit(config.voice.maxOutboundBytes);
    const url = new URL(dependencies.listenUrl ?? `${config.stt.baseUrl.replace(/\/$/, "")}/v1/listen`);
    const params = {
      encoding: session.media.codec === "pcmu" ? "mulaw" : "linear16",
      sample_rate: String(session.media.sampleRate),
      channels: "1",
      interim_results: "true",
      vad_events: "true",
      model: config.stt.model,
      language: config.stt.language,
      endpointing: String(config.stt.endpointing),
      utterance_end_ms: String(config.stt.utteranceEndMs)
    };
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    for (const term of config.stt.keyterms) url.searchParams.append("keyterm", term);
    this.socket = new WebSocket2(url, {
      headers: { Authorization: `Token ${config.stt.apiKey}` },
      handshakeTimeout: config.stt.connectionTimeoutMs,
      maxPayload: 65536
    });
    this.connectTimer = setTimeout(() => this.fail("stt-connect-timeout"), config.stt.connectionTimeoutMs);
    this.socket.on("error", (error) => this.fail("stt-socket-error", error.message));
    this.socket.on("close", () => {
      if (!this.stopped) this.fail("stt-socket-closed");
    });
    this.socket.on("open", () => {
      clearTimeout(this.connectTimer);
      for (const audio of this.pending) this.send(audio);
      this.pending = [];
      this.pendingBytes = 0;
      if (this.stopped) return;
      this.keepalive = setInterval(() => {
        if (this.socket.bufferedAmount + 20 > config.stt.maxBufferedBytes) {
          this.fail("stt-buffer-overflow");
          return;
        }
        this.socket.send(JSON.stringify({ type: "KeepAlive" }), (error) => {
          if (error) this.fail("stt-keepalive-failed");
        });
      }, 4e3);
    });
    this.socket.on("message", (data) => {
      if (this.stopped) return;
      try {
        this.result(JSON.parse(String(data)));
      } catch {
        this.fail("stt-bad-message");
      }
    });
    if (config.inbound.pin?.enabled && config.inbound.pin?.code) {
      this.pinState = { digits: "", attempts: 0 };
      this.pinTimeout = setTimeout(() => {
        if (this.stopped || this.pinLocked || this.pinAuthenticated) return;
        this.pinLocked = true;
        this.respond(config.inbound.pin.lockoutText, false);
        this.pinHangup = setTimeout(() => this.session.end("pin-timeout"), 3e3);
      }, config.inbound.pin.timeoutMs);
      if (config.inbound.pin.promptText) this.respond(config.inbound.pin.promptText, false);
    } else {
      this.pinAuthenticated = true;
      if (config.inbound.greeting) this.respond(config.inbound.greeting, false);
    }
  }
  session;
  config;
  utterance;
  log;
  dependencies;
  socket;
  pending = [];
  pendingBytes = 0;
  stopped = false;
  generation = 0;
  controller;
  connectTimer;
  keepalive;
  finalText = "";
  thinking = "";
  lastFinalEnd = -1;
  emittedEnd = -1;
  pinState = null;
  pinAuthenticated = false;
  pinLocked = false;
  pinHangup;
  pinTimeout;
  /** Caller keypad input; drives the DTMF-PIN gate until authenticated. */
  dtmf(digit) {
    if (this.stopped || this.pinLocked || this.pinAuthenticated) return;
    const pin = this.config.inbound.pin;
    if (!pin?.enabled || !pin.code) return;
    if (digit === "#") {
      if ((this.pinState?.digits ?? "") === pin.code) {
        clearTimeout(this.pinTimeout);
        this.pinState = null;
        this.pinAuthenticated = true;
        this.log?.("pin-accepted");
        const afterPin = [pin.successText, this.config.inbound.greeting].filter(Boolean).join(" ").trim();
        if (afterPin) this.respond(afterPin, false);
        return;
      }
      const attempts = (this.pinState?.attempts ?? 0) + 1;
      if (attempts >= pin.maxAttempts) {
        clearTimeout(this.pinTimeout);
        this.pinState = { digits: "", attempts };
        this.pinLocked = true;
        this.log?.("pin-lockout", { attempts });
        this.respond(pin.lockoutText, false);
        this.pinHangup = setTimeout(() => this.session.end("pin-failed"), 3e3);
        return;
      }
      this.pinState = { digits: "", attempts };
      this.log?.("pin-rejected", { attempts });
      this.respond(pin.failureText, false);
      return;
    }
    if (digit === "*") {
      if (this.pinState) this.pinState.digits = "";
      return;
    }
    if (!/^\d$/.test(digit)) return;
    if (!this.pinState) this.pinState = { digits: "", attempts: 0 };
    if (this.pinState.digits.length >= pin.maxDigits) return;
    this.pinState.digits += digit;
    if (this.pinState.digits.length === pin.maxDigits) this.dtmf("#");
  }
  audio(audio) {
    if (this.stopped) return;
    if (this.pinLocked || !this.pinAuthenticated) return;
    const input = this.session.media.codec === "pcmu" ? audio : this.session.media.decode(audio);
    if (this.socket.readyState === WebSocket2.OPEN) {
      this.send(input);
      return;
    }
    if (this.pendingBytes + input.length > this.config.voice.maxInboundBytes) {
      this.fail("stt-pending-overflow");
      return;
    }
    this.pending.push(Buffer.from(input));
    this.pendingBytes += input.length;
  }
  send(audio) {
    if (this.stopped || this.pinLocked || !this.pinAuthenticated) return;
    if (this.socket.bufferedAmount + audio.length > this.config.stt.maxBufferedBytes) {
      this.fail("stt-buffer-overflow");
      return;
    }
    this.socket.send(audio, { binary: true }, (error) => {
      if (error) this.fail("stt-send-failed");
    });
  }
  result(event) {
    if (this.stopped || this.pinLocked || !this.pinAuthenticated) return;
    if (event.type === "Error") {
      this.fail("stt-error-event");
      return;
    }
    if (event.type === "SpeechStarted") {
      this.log?.("stt-speech-start");
      return;
    }
    if (event.type === "UtteranceEnd") {
      if (typeof event.last_word_end === "number" && event.last_word_end > this.emittedEnd) this.finish(event.last_word_end);
      return;
    }
    if (event.type !== "Results") return;
    const alternative = event.channel?.alternatives?.[0];
    const text2 = alternative?.transcript?.trim() ?? "";
    if (text2) {
      this.log?.("voice-barge-in", { source: "transcript", final: event.is_final === true });
      this.bargeIn();
    }
    if (event.is_final && typeof event.start === "number" && typeof event.duration === "number") {
      const end = event.start + event.duration;
      if (end > this.lastFinalEnd) {
        this.lastFinalEnd = end;
        if (text2) this.finalText += (this.finalText ? " " : "") + text2;
        if (this.finalText.length > 4096) {
          this.fail("stt-text-limit");
          return;
        }
      }
    }
    if (event.speech_final) this.finish(this.lastFinalEnd);
  }
  finish(end) {
    if (!this.finalText) return;
    const text2 = this.thinking ? `${this.thinking} ${this.finalText}` : this.finalText;
    this.finalText = "";
    this.emittedEnd = Math.max(this.emittedEnd, end);
    this.respond(text2, true);
  }
  /** Caller speech stops playback; a pending agent turn survives until a new utterance supersedes it. */
  bargeIn() {
    if (this.thinking) {
      this.session.interrupt();
      return;
    }
    this.interrupt();
  }
  interrupt() {
    this.thinking = "";
    this.generation++;
    this.controller?.abort();
    this.controller = void 0;
    this.session.interrupt();
  }
  respond(text2, agent) {
    if (this.stopped || agent && (this.pinLocked || !this.pinAuthenticated)) return;
    this.interrupt();
    const generation = this.generation;
    const controller = new AbortController();
    this.controller = controller;
    const current = () => !this.stopped && !controller.signal.aborted && generation === this.generation;
    void (async () => {
      try {
        if (agent) this.thinking = text2;
        const answer = agent ? await this.utterance?.(text2, controller.signal, this.session) : text2;
        if (current()) this.thinking = "";
        if (!current() || !answer) return;
        if (answer.length > MAX_VOICE_REPLY_CHARS) throw new Error("Answer limit");
        const sentences = splitSentences(answer);
        for (let i = 0; i < sentences.length; i++) {
          if (!current()) return;
          const started = Date.now();
          this.log?.("tts-start", { chars: sentences[i].length, sentence: i });
          await this.speak(sentences[i], controller.signal, current);
          this.log?.("tts-end", { ms: Date.now() - started, sentence: i, interrupted: !current() });
          if (current()) await this.session.markAsync(`voice-${generation}-${i}`, controller.signal);
        }
      } catch (error) {
        if (current()) {
          this.session.interrupt();
          this.log?.("voice-turn-error", { message: error instanceof Error ? error.message : String(error) });
        }
      } finally {
        if (this.controller === controller) {
          this.controller = void 0;
          this.thinking = "";
        }
      }
    })();
  }
  async speak(text2, parent, current) {
    return speakAnnouncement(this.session, this.config, text2, parent, current, this.dependencies);
  }
  fail(reason, detail) {
    if (!this.stopped) {
      this.log?.("voice-error", { reason, ...detail ? { detail } : {} });
      this.stop();
      this.session.end("voice-error");
    }
  }
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    if (this.pinTimeout) clearTimeout(this.pinTimeout);
    if (this.pinHangup) clearTimeout(this.pinHangup);
    this.interrupt();
    clearTimeout(this.connectTimer);
    if (this.keepalive) clearInterval(this.keepalive);
    this.pending = [];
    this.pendingBytes = 0;
    this.finalText = "";
    this.socket.terminate();
  }
};
async function speakAnnouncement(session, config, text2, parent, current, dependencies = {}) {
  session.setPlaybackPrebuffer(config.voice.playbackPrebufferMs);
  const tts = config.tts;
  if (tts.provider === "elevenlabs") throw new Error("Native ElevenLabs TTS is disabled; use Deepgram Voice Agent");
  const controller = new AbortController();
  const abort = () => controller.abort();
  parent.addEventListener("abort", abort, { once: true });
  if (parent.aborted) controller.abort();
  const timer = setTimeout(abort, tts.timeoutMs);
  let reader;
  try {
    const deepgram = tts.provider === "deepgram";
    const rawMulaw = deepgram && session.media.codec === "pcmu";
    if (!tts.baseUrl && !dependencies.speakUrl) throw new Error("TTS base URL is required");
    const baseUrl = tts.baseUrl?.replace(/\/$/, "");
    const url = new URL(dependencies.speakUrl ?? (deepgram ? `${baseUrl}/v1/speak` : `${baseUrl}/v1/audio/speech`));
    if (deepgram) for (const [key, value] of Object.entries({
      model: tts.voice ?? tts.model,
      encoding: rawMulaw ? "mulaw" : "linear16",
      sample_rate: String(session.media.sampleRate),
      container: "none"
    })) url.searchParams.set(key, value);
    const headers = { "Content-Type": "application/json" };
    headers.Authorization = `${deepgram ? "Token" : "Bearer"} ${tts.apiKey}`;
    const response = await (dependencies.fetch ?? fetch)(url, {
      method: "POST",
      headers,
      body: JSON.stringify(deepgram ? { text: text2 } : { model: tts.model, voice: tts.voice, input: text2, response_format: "pcm" }),
      signal: controller.signal,
      redirect: "error"
    });
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new Error("TTS request failed");
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (deepgram && !(rawMulaw ? /^audio\/mulaw(?:;|$)/i : /^audio\/(?:l16|linear16|pcm)(?:;|$)/i).test(contentType)) {
      await response.body.cancel();
      throw new Error("Unexpected TTS format");
    }
    if (!deepgram && !/^(application\/octet-stream|audio\/pcm)(?:;|$)/i.test(contentType)) {
      await response.body.cancel();
      throw new Error("Unexpected PCM format");
    }
    if (!deepgram && tts.sourceSampleRate !== 24e3) throw new Error("Unverified PCM sample rate");
    reader = response.body.getReader();
    let remainder = Buffer.alloc(0);
    let total = 0;
    while (current()) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!current() || controller.signal.aborted) return;
      total += value.length;
      const sourceBytesPerSecond = rawMulaw ? 8e3 : (!deepgram ? 24e3 : session.media.sampleRate) * 2;
      if (total > sourceBytesPerSecond * 120) throw new Error("TTS response limit");
      const data = Buffer.concat([remainder, value]);
      const pcm24k = !deepgram;
      const alignment = pcm24k ? 6 : session.media.codec === "g722" && !rawMulaw ? 4 : rawMulaw ? 1 : 2;
      const length = data.length - data.length % alignment;
      if (length) {
        const chunk = data.subarray(0, length);
        await session.sendAudioChunkAsync(rawMulaw ? chunk : session.media.encode(pcm24k ? pcm24kToPcm(chunk, session.media.sampleRate) : chunk), controller.signal);
      }
      remainder = Buffer.from(data.subarray(length));
    }
    if (remainder.length) throw new Error("Incomplete PCM audio");
    if (controller.signal.aborted) throw new Error("TTS timeout");
    if (!total) throw new Error("Empty TTS audio");
  } finally {
    clearTimeout(timer);
    parent.removeEventListener("abort", abort);
    await reader?.cancel().catch(() => void 0);
  }
}

// src/voice/deepgramAgent.ts
var OPENCLAW_TASK = {
  name: "openclaw_task",
  description: "Run a task with the OpenClaw agent tools (lookups, research, actions) and return the result as a short spoken sentence.",
  parameters: {
    type: "object",
    properties: { request: { type: "string", description: "The caller's request as a complete sentence." } },
    required: ["request"]
  }
};
var CONNECT_TIMEOUT_MS = 1e4;
var KEEPALIVE_MS = 4e3;
function buildSettings(config, codec, sampleRate) {
  const agent = config.voice.agent;
  const encoding = codec === "pcmu" ? "mulaw" : "linear16";
  const think = {
    provider: {
      type: agent.think.provider,
      model: agent.think.model,
      ...agent.think.temperature !== void 0 ? { temperature: agent.think.temperature } : {}
    },
    prompt: agent.prompt,
    ...agent.tools ? { functions: [OPENCLAW_TASK] } : {}
  };
  if (agent.think.endpoint) think.endpoint = { url: agent.think.endpoint.url, headers: agent.think.endpoint.headers };
  const greeting = agent.greeting ?? config.inbound.greeting;
  return {
    type: "Settings",
    audio: {
      input: { encoding, sample_rate: sampleRate },
      output: { encoding, sample_rate: sampleRate, container: "none" }
    },
    agent: {
      listen: {
        provider: {
          type: "deepgram",
          model: config.stt.model,
          language: config.stt.language,
          ...config.stt.keyterms.length ? { keyterms: config.stt.keyterms } : {}
        }
      },
      think,
      speak: config.tts.provider === "elevenlabs" ? {
        provider: { type: "eleven_labs", model_id: config.tts.model },
        endpoint: {
          url: config.tts.model === "eleven_v3" ? `${config.tts.baseUrl.replace(/\/$/, "")}/v1/text-to-speech/${encodeURIComponent(config.tts.voice)}` : `${config.tts.baseUrl.replace(/^https:/, "wss:").replace(/\/$/, "")}/v1/text-to-speech/${encodeURIComponent(config.tts.voice)}/multi-stream-input`,
          headers: { "xi-api-key": config.tts.apiKey }
        }
      } : { provider: { type: "deepgram", model: config.tts.voice ?? config.tts.model } },
      ...greeting ? { greeting } : {}
    }
  };
}
var DeepgramAgentCall = class {
  constructor(session, config, log, dependencies = {}, utterance) {
    this.session = session;
    this.config = config;
    this.log = log;
    this.utterance = utterance;
    session.setQueueLimit(config.voice.maxOutboundBytes);
    session.setPlaybackPrebuffer(config.voice.playbackPrebufferMs);
    const url = new URL(dependencies.agentUrl ?? `${config.voice.agent.baseUrl.replace(/\/$/, "")}/v1/agent/converse`);
    this.socket = new WebSocket3(url, {
      headers: { Authorization: `Token ${config.stt.apiKey}` },
      handshakeTimeout: CONNECT_TIMEOUT_MS,
      maxPayload: 1048576
    });
    this.connectTimer = setTimeout(() => this.fail("agent-connect-timeout"), CONNECT_TIMEOUT_MS);
    this.socket.on("error", (error) => this.fail("agent-socket-error", error.message));
    this.socket.on("close", () => {
      if (!this.stopped) this.fail("agent-socket-closed");
    });
    this.socket.on("open", () => clearTimeout(this.connectTimer));
    this.socket.on("message", (data, isBinary) => this.message(data, isBinary));
    this.log?.("agent-connecting", { model: config.voice.agent.think.model, provider: config.voice.agent.think.provider });
    const pin = config.inbound.pin;
    if (pin.enabled && pin.code) {
      this.pinState = { digits: "", attempts: 0 };
      this.pinTimeout = setTimeout(() => {
        if (this.stopped || this.pinLocked || this.pinAuthenticated) return;
        this.pinLocked = true;
        this.speak(pin.lockoutText);
        this.pinHangup = setTimeout(() => this.session.end("pin-timeout"), 3e3);
      }, pin.timeoutMs);
      if (pin.promptText) this.speak(pin.promptText);
    } else {
      this.pinAuthenticated = true;
    }
  }
  session;
  config;
  log;
  utterance;
  socket;
  connectTimer;
  keepalive;
  ready = false;
  stopped = false;
  playing = true;
  turn = 0;
  pending = [];
  pendingBytes = 0;
  remainder = Buffer.alloc(0);
  tasks = new AbortController();
  // DTMF PIN gate (same semantics as VoiceCall)
  pinAuthenticated = false;
  pinLocked = false;
  pinHangup;
  pinState = null;
  pinTimeout;
  /** Caller keypad input; drives the DTMF PIN gate until authenticated. */
  dtmf(digit) {
    if (this.stopped || this.pinLocked || this.pinAuthenticated) return;
    const pin = this.config.inbound.pin;
    if (!pin.enabled || !pin.code) return;
    if (digit === "#") {
      if ((this.pinState?.digits ?? "") === pin.code) {
        clearTimeout(this.pinTimeout);
        this.pinState = null;
        this.pinAuthenticated = true;
        this.log?.("pin-accepted");
        return;
      }
      const attempts = (this.pinState?.attempts ?? 0) + 1;
      if (attempts >= pin.maxAttempts) {
        clearTimeout(this.pinTimeout);
        this.pinState = { digits: "", attempts };
        this.pinLocked = true;
        this.log?.("pin-lockout", { attempts });
        this.speak(pin.lockoutText);
        this.pinHangup = setTimeout(() => this.session.end("pin-failed"), 3e3);
        return;
      }
      this.pinState = { digits: "", attempts };
      this.log?.("pin-rejected", { attempts });
      this.speak(pin.failureText);
      return;
    }
    if (digit === "*") {
      if (this.pinState) this.pinState.digits = "";
      return;
    }
    if (!/^\d$/.test(digit)) return;
    if (!this.pinState) this.pinState = { digits: "", attempts: 0 };
    if (this.pinState.digits.length >= pin.maxDigits) return;
    this.pinState.digits += digit;
    if (this.pinState.digits.length === pin.maxDigits) this.dtmf("#");
  }
  /** Speak a short local prompt (PIN gate) without going through the agent turn. */
  speak(text2) {
    if (this.stopped || !text2) return;
    void (async () => {
      try {
        await speakAnnouncement(
          this.session,
          this.config,
          text2,
          this.tasks.signal,
          () => !this.stopped
        );
      } catch (error) {
        this.log?.("agent-announcement-error", {
          message: error instanceof Error ? error.message : String(error)
        });
      }
    })();
  }
  audio(audio) {
    if (this.stopped) return;
    if (this.pinLocked || !this.pinAuthenticated) return;
    const input = this.session.media.codec === "pcmu" ? audio : this.session.media.decode(audio);
    if (this.ready && this.socket.readyState === WebSocket3.OPEN) {
      this.send(input);
      return;
    }
    if (this.pendingBytes + input.length > this.config.voice.maxInboundBytes) {
      this.fail("agent-pending-overflow");
      return;
    }
    this.pending.push(Buffer.from(input));
    this.pendingBytes += input.length;
  }
  send(audio) {
    if (this.stopped || this.pinLocked || !this.pinAuthenticated) return;
    if (this.socket.bufferedAmount + audio.length > this.config.voice.maxInboundBytes) {
      this.fail("agent-buffer-overflow");
      return;
    }
    this.socket.send(audio, { binary: true }, (error) => {
      if (error) this.fail("agent-send-failed");
    });
  }
  message(data, isBinary) {
    if (this.stopped || this.pinLocked) return;
    if (isBinary) {
      if (!this.pinAuthenticated || !this.playing) return;
      try {
        this.play(Buffer.from(data));
      } catch {
        this.fail("agent-playback-overflow");
      }
      return;
    }
    let event;
    try {
      event = JSON.parse(String(data));
    } catch {
      this.fail("agent-bad-message");
      return;
    }
    switch (event.type) {
      case "Welcome":
        this.socket.send(
          JSON.stringify(buildSettings(this.config, this.session.media.codec, this.session.media.sampleRate)),
          (error) => {
            if (error) this.fail("agent-settings-failed");
          }
        );
        break;
      case "SettingsApplied":
        this.ready = true;
        for (const chunk of this.pending) this.send(chunk);
        this.pending = [];
        this.pendingBytes = 0;
        this.keepalive = setInterval(() => {
          if (this.socket.readyState === WebSocket3.OPEN) this.socket.send(JSON.stringify({ type: "KeepAlive" }));
        }, KEEPALIVE_MS);
        this.log?.("agent-ready");
        break;
      case "UserStartedSpeaking":
        this.log?.("user-speaking");
        this.playing = false;
        this.remainder = Buffer.alloc(0);
        this.session.interrupt();
        break;
      case "AgentStartedSpeaking":
        this.playing = true;
        this.log?.("tts-start", { turn: this.turn });
        break;
      case "AgentAudioDone":
        this.playing = true;
        this.remainder = Buffer.alloc(0);
        try {
          this.session.mark(`agent-${this.turn++}`);
        } catch {
          this.fail("agent-mark-overflow");
        }
        this.log?.("tts-end", { turn: this.turn - 1 });
        break;
      case "FunctionCallRequest":
        for (const call of event.functions ?? []) void this.callFunction(call);
        break;
      case "Error":
        this.fail("agent-error-event", event.code ?? event.description);
        break;
      case "ConversationText":
        if (event.role === "assistant") {
          this.playing = true;
          this.log?.("tts-start", { turn: this.turn });
        }
        this.log?.("agent-text", { role: event.role, content: (event.content ?? "").slice(0, 200) });
        break;
      case "AgentThinking":
        this.log?.("agent-thinking");
        break;
      case "Warning":
      case "InjectionRefused":
        this.log?.("agent-warning", { type: event.type, description: event.description });
        break;
    }
  }
  async callFunction(call) {
    if (this.stopped || this.pinLocked || !this.pinAuthenticated) return;
    if (call.client_side === false) return;
    let content;
    const started = Date.now();
    try {
      if (call.name !== OPENCLAW_TASK.name || !this.config.voice.agent.tools || !this.utterance) throw new Error("unknown function");
      const request = String(JSON.parse(call.arguments ?? "{}").request ?? "").trim();
      if (!request) throw new Error("empty request");
      content = (await this.utterance(request, this.tasks.signal, this.session)).slice(0, 4096) || "No answer.";
      this.log?.("agent-function", { name: call.name, ms: Date.now() - started, chars: content.length, preview: content.slice(0, 160) });
    } catch (error) {
      content = "The task could not be completed.";
      this.log?.("agent-function-error", { name: call.name, message: error instanceof Error ? error.message : String(error) });
    }
    if (this.stopped || this.pinLocked || !this.pinAuthenticated || this.socket.readyState !== WebSocket3.OPEN) return;
    this.socket.send(JSON.stringify({ type: "FunctionCallResponse", id: call.id, name: call.name, content }));
  }
  play(chunk) {
    if (this.session.media.codec === "pcmu") {
      this.session.sendAudioChunk(chunk);
      return;
    }
    const data = Buffer.concat([this.remainder, chunk]);
    const alignment = this.session.media.codec === "g722" ? 4 : 2;
    const length = data.length - data.length % alignment;
    if (length) this.session.sendAudioChunk(this.session.media.encode(data.subarray(0, length)));
    this.remainder = Buffer.from(data.subarray(length));
  }
  fail(reason, detail) {
    if (this.stopped) return;
    this.log?.("voice-error", { reason, ...detail ? { detail } : {} });
    this.stop();
    this.session.end("voice-error");
  }
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.tasks.abort();
    if (this.pinTimeout) clearTimeout(this.pinTimeout);
    if (this.pinHangup) clearTimeout(this.pinHangup);
    clearTimeout(this.connectTimer);
    if (this.keepalive) clearInterval(this.keepalive);
    this.pending = [];
    this.pendingBytes = 0;
    this.socket.terminate();
  }
};

// src/voice/deepgramModels.ts
import { createHmac as createHmac3, randomBytes as randomBytes4 } from "node:crypto";
import { z as z2 } from "zod";
var modelSchema = z2.object({
  canonical_name: z2.string().min(1).max(128).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/),
  languages: z2.array(z2.string().min(2).max(35).regex(/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$|^multi$/)).max(256)
});
var catalogSchema = z2.object({
  stt: z2.array(modelSchema.extend({ streaming: z2.boolean() })).max(4096),
  tts: z2.array(modelSchema).max(4096)
});
var salt = randomBytes4(32);
var cache = /* @__PURE__ */ new Map();
var ttlMs = 3e5;
var maxEntries = 32;
var maxBytes = 1048576;
function failure(message) {
  return new Error(`Deepgram model discovery: ${message}`);
}
function filter(catalog, options) {
  const requested = options.language?.toLowerCase();
  const matches = (model) => !requested || model.languages.some((language) => {
    const tag = language.toLowerCase();
    return tag === requested || tag === requested.split("-")[0];
  });
  return structuredClone({
    stt: catalog.stt.filter((model) => matches(model) && (options.streamingOnly === false || model.streaming)),
    tts: catalog.tts.filter(matches)
  });
}
async function discoverDeepgramModels(options, dependencies = {}) {
  if (typeof options.apiKey !== "string" || !options.apiKey.trim() || /[\r\n]/.test(options.apiKey)) throw failure("credential required");
  if (options.language !== void 0 && !/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$|^multi$/.test(options.language)) throw failure("invalid language");
  const timeoutMs = options.timeoutMs ?? 1e4;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 6e4) throw failure("invalid timeout");
  if (options.signal?.aborted) throw failure("aborted");
  const identity = createHmac3("sha256", salt).update(options.apiKey).digest("hex");
  const now = Date.now();
  for (const [key, entry2] of cache) if (entry2.expires <= now) cache.delete(key);
  const hit = dependencies.fetch ? void 0 : cache.get(identity);
  if (hit) return filter(hit.catalog, options);
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => {
    controller.abort();
  };
  options.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    abort();
  }, timeoutMs);
  let reader;
  const aborted = new Promise((_resolve, reject) => {
    controller.signal.addEventListener("abort", () => reject(failure(timedOut ? "timeout" : "aborted")), { once: true });
  });
  const request = async () => {
    const response = await (dependencies.fetch ?? fetch)("https://api.deepgram.com/v1/models", {
      method: "GET",
      headers: { Authorization: `Token ${options.apiKey}`, Accept: "application/json" },
      redirect: "error",
      signal: controller.signal
    });
    if (controller.signal.aborted) {
      void response.body?.cancel().catch(() => void 0);
      throw failure("aborted");
    }
    if (!response.ok) {
      void response.body?.cancel().catch(() => void 0);
      throw failure(`HTTP ${response.status}`);
    }
    if (!response.body || !/^application\/json(?:;|$)/i.test(response.headers.get("content-type") ?? "")) {
      void response.body?.cancel().catch(() => void 0);
      throw failure("invalid response");
    }
    const length = response.headers.get("content-length");
    if (length && (!/^\d+$/.test(length) || Number(length) > maxBytes)) {
      void response.body.cancel().catch(() => void 0);
      throw failure("response limit");
    }
    reader = response.body.getReader();
    const chunks = [];
    let bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (controller.signal.aborted) throw failure("aborted");
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw failure("response limit");
      chunks.push(value);
    }
    let parsed;
    try {
      parsed = catalogSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    } catch {
      throw failure("invalid catalog");
    }
    const unique = (models) => {
      const result = /* @__PURE__ */ new Map();
      for (const model of models) {
        const previous = result.get(model.canonicalName);
        if (previous) {
          previous.languages = [.../* @__PURE__ */ new Set([...previous.languages, ...model.languages])];
          if ("streaming" in previous && "streaming" in model) previous.streaming = previous.streaming || model.streaming;
        } else result.set(model.canonicalName, model);
      }
      return [...result.values()].sort((a, b) => a.canonicalName.localeCompare(b.canonicalName));
    };
    return {
      stt: unique(parsed.stt.map((model) => ({ canonicalName: model.canonical_name, languages: model.languages, streaming: model.streaming }))),
      tts: unique(parsed.tts.map((model) => ({ canonicalName: model.canonical_name, languages: model.languages })))
    };
  };
  try {
    const catalog = await Promise.race([request(), aborted]);
    if (!dependencies.fetch) {
      cache.delete(identity);
      if (cache.size >= maxEntries) cache.delete(cache.keys().next().value);
      cache.set(identity, { expires: Date.now() + ttlMs, catalog });
    }
    return filter(catalog, options);
  } catch (error) {
    if (controller.signal.aborted) throw failure(timedOut ? "timeout" : "aborted");
    if (error instanceof Error && /^Deepgram model discovery: (HTTP \d{3}|invalid response|response limit|invalid catalog)$/.test(error.message)) throw error;
    throw failure("request failed");
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
    controller.abort();
    void reader?.cancel().catch(() => void 0);
  }
}
var thinkSchema = z2.object({
  models: z2.array(z2.object({
    id: z2.string().min(1).max(128).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/),
    name: z2.string().min(1).max(128),
    provider: z2.string().min(1).max(32).regex(/^[a-z][a-z0-9_]*$/)
  }).passthrough()).max(1024)
});
var thinkCache;
async function discoverDeepgramThinkModels(options = {}, dependencies = {}) {
  const fail = (message) => new Error(`Deepgram think model discovery: ${message}`);
  const timeoutMs = options.timeoutMs ?? 1e4;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 6e4) throw fail("invalid timeout");
  if (!dependencies.fetch && thinkCache && thinkCache.expires > Date.now()) return structuredClone(thinkCache.models);
  const controller = new AbortController();
  const abort = () => {
    controller.abort();
  };
  options.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
  const aborted = new Promise((_resolve, reject) => {
    controller.signal.addEventListener("abort", () => reject(fail("timeout or aborted")), { once: true });
  });
  aborted.catch(() => void 0);
  try {
    const response = await Promise.race([(dependencies.fetch ?? fetch)("https://agent.deepgram.com/v1/agent/settings/think/models", {
      method: "GET",
      headers: { Accept: "application/json" },
      redirect: "error",
      signal: controller.signal
    }), aborted]);
    if (!response.ok) {
      void response.body?.cancel().catch(() => void 0);
      throw fail(`HTTP ${response.status}`);
    }
    const text2 = await Promise.race([response.text(), aborted]);
    if (text2.length > maxBytes) throw fail("response limit");
    let parsed;
    try {
      parsed = thinkSchema.parse(JSON.parse(text2));
    } catch {
      throw fail("invalid catalog");
    }
    const seen = /* @__PURE__ */ new Set();
    const models = parsed.models.map(({ id, name, provider }) => ({ id, name, provider })).filter((model) => {
      const key = `${model.provider}
${model.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort((a, b) => a.provider.localeCompare(b.provider) || a.id.localeCompare(b.id));
    if (!dependencies.fetch) thinkCache = { expires: Date.now() + ttlMs, models };
    return structuredClone(models);
  } catch (error) {
    if (controller.signal.aborted) throw fail("timeout or aborted");
    if (error instanceof Error && error.message.startsWith("Deepgram think model discovery:")) throw error;
    throw fail("request failed");
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
    controller.abort();
  }
}
function registerDeepgramModelDiscovery(api, getApiKey, dependencies = {}) {
  api.registerGatewayMethod("sip.deepgram.models", async ({ params, respond, signal }) => {
    if (Object.keys(params).some((key) => key !== "language" && key !== "streamingOnly") || params.language !== void 0 && typeof params.language !== "string" || params.streamingOnly !== void 0 && typeof params.streamingOnly !== "boolean") {
      respond(false, void 0, { code: "INVALID_REQUEST", message: "Invalid model discovery parameters" });
      return;
    }
    try {
      const catalog = await discoverDeepgramModels({
        apiKey: getApiKey() ?? "",
        signal,
        language: params.language,
        streamingOnly: params.streamingOnly
      }, dependencies);
      respond(true, catalog);
    } catch {
      respond(false, void 0, { code: "UNAVAILABLE", message: "Deepgram model discovery unavailable" });
    }
  }, { scope: "operator.read" });
  api.registerGatewayMethod("sip.deepgram.thinkModels", async ({ params, respond, signal }) => {
    if (Object.keys(params).length) {
      respond(false, void 0, { code: "INVALID_REQUEST", message: "Invalid think model parameters" });
      return;
    }
    try {
      respond(true, { models: await discoverDeepgramThinkModels({ signal }, dependencies) });
    } catch {
      respond(false, void 0, { code: "UNAVAILABLE", message: "Deepgram think model discovery unavailable" });
    }
  }, { scope: "operator.read" });
}

// src/index.ts
async function startSipPlugin(rawConfig, hooks = {}, dependencies = {}) {
  const config = parseSipConfig(rawConfig);
  const problems = validateForTransport(config);
  if (problems.length > 0) {
    throw new Error(`sip plugin config rejected: ${problems.join("; ")}`);
  }
  const server = new MediaServer({
    host: config.media.host,
    port: config.media.port,
    path: config.media.path,
    authToken: config.media.authToken,
    onLog: hooks.onLog
  });
  let embedded;
  const sessions = /* @__PURE__ */ new Set();
  const voices = /* @__PURE__ */ new Map();
  const log = (event, fields) => {
    try {
      hooks.onLog?.(event, fields);
    } catch {
    }
  };
  server.on("call", (session, custom) => {
    sessions.add(session);
    if (hooks.admitCall && !hooks.admitCall(session, custom)) {
      session.end("sip-rejected");
      return;
    }
    if (session.currentState === "ended")
      return;
    if (config.voice.enabled) {
      if (voices.size >= config.inbound.maxConcurrent) {
        session.end("voice-call-limit");
        return;
      }
      const voice = config.voice.engine === "deepgram-agent" ? new DeepgramAgentCall(session, config, log, dependencies.agent, hooks.onUtterance) : new VoiceCall(session, config, hooks.onUtterance, log, dependencies.voice);
      if (!sessions.has(session)) {
        voice.stop();
        return;
      }
      voices.set(session, voice);
    }
    void Promise.resolve().then(() => {
      if (session.currentState !== "ended")
        return hooks.onCall?.(session, custom);
    }).catch(() => {
      log("call-hook-error");
      session.end("call-hook-error");
    });
  });
  server.on("audio", (session, audio) => {
    if (!sessions.has(session))
      return;
    voices.get(session)?.audio(audio);
    hooks.onAudio?.(session, audio);
  });
  server.on("dtmf", (session, digit) => {
    if (!sessions.has(session))
      return;
    voices.get(session)?.dtmf?.(digit);
    hooks.onDtmf?.(session, digit);
  });
  server.on("mark", (session, name) => {
    if (sessions.has(session))
      hooks.onMark?.(session, name);
  });
  server.on("end", (_streamSid, reason, session) => {
    if (!sessions.delete(session))
      return;
    const voice = voices.get(session);
    voices.delete(session);
    try {
      voice?.stop();
    } catch {
      log("voice-stop-error");
    }
    try {
      if (session.callSid)
        embedded?.terminateCall?.(session.callSid, reason);
    } catch {
      log("call-terminate-error");
    }
    try {
      hooks.onSessionEnd?.(session, reason);
    } finally {
      try {
        hooks.onEnd?.(session.streamSid, reason);
      } finally {
        log("call-end", { reason });
      }
    }
  });
  server.on("error", (err) => log("media-error", { message: err.message }));
  await server.start();
  try {
    if (config.transport === "embedded") {
      if (!server.address) throw new Error("Media server has no bound address");
      embedded = await (dependencies.startEmbeddedTransport ?? startEmbeddedTransport)(config, server.address, hooks.onLog);
    }
    hooks.onLog?.("sip-plugin-started", { port: server.address?.port, path: config.media.path, transport: config.transport });
  } catch (error) {
    try {
      await cleanupAll([() => embedded?.stop(), () => server.stop()]);
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Plugin startup and cleanup failed");
    }
    throw error;
  }
  let stopping;
  return {
    server,
    config,
    hangup: (session, reason) => {
      if (session.callSid) embedded?.terminateCall?.(session.callSid, reason);
      session.end(reason);
    },
    stop: () => stopping ??= cleanupAll([() => embedded?.stop(), () => server.stop()])
  };
}

// src/channel.ts
function callerE164(session, custom, numbering) {
  const value = session.from ?? custom["from"] ?? custom["From"] ?? custom["caller"];
  if (typeof value !== "string" || value.length === 0 || value.length > 1024) return void 0;
  const uri = value.trim();
  const national = /^(?:sip:|tel:)?(\d{3,15})(?:@[^\s;>]+)?(?:;[^\s>]*)?$/.exec(uri)?.[1];
  const prefix = numbering?.callerNationalPrefix ?? "0";
  const normalized = numbering?.callerCountryCode && national?.startsWith(prefix) && /^[1-9]\d+$/.test(national.slice(prefix.length)) ? `+${numbering.callerCountryCode}${national.slice(prefix.length)}` : uri;
  const match = /^(?:sip:|tel:)?(\+[1-9]\d{1,14})(?:@[^\s;>]+)?(?:;[^\s>]*)?$/.exec(normalized);
  return match?.[1];
}
var SipAdmission = class {
  constructor(config) {
    this.config = config;
  }
  config;
  accepted = /* @__PURE__ */ new Map();
  admit(session, custom) {
    const existing = this.accepted.get(session.streamSid);
    if (existing) return existing.session === session;
    const caller = callerE164(session, custom, this.config.inbound);
    if (!caller || !this.config.voice.enabled || this.config.inbound.policy === "allowlist" && !this.config.inbound.allowFrom.includes(caller) || this.accepted.size >= this.config.inbound.maxConcurrent) return false;
    this.accepted.set(session.streamSid, { session, caller });
    return true;
  }
  caller(session) {
    const accepted = this.accepted.get(session.streamSid);
    return accepted?.session === session ? accepted.caller : void 0;
  }
  end(session) {
    if (this.accepted.get(session.streamSid)?.session === session) this.accepted.delete(session.streamSid);
  }
};
async function dispatchSipTurn(api, config, caller, text2, signal) {
  if (signal.aborted) return "";
  const channel = api.runtime.channel;
  const route = channel.routing.resolveAgentRoute({
    cfg: api.config,
    channel: "sip",
    accountId: "default",
    defaultAgentId: config.inbound.agentId,
    peer: { kind: "direct", id: caller },
    dmScope: "per-channel-peer"
  });
  const answers = [];
  await channel.reply.dispatchReplyWithBufferedBlockDispatcher({
    cfg: api.config,
    ctx: channel.reply.finalizeInboundContext({
      Body: text2,
      RawBody: text2,
      BodyForAgent: text2,
      From: caller,
      To: "sip:default",
      SenderId: caller,
      SessionKey: route.sessionKey,
      AccountId: "default",
      ChatType: "direct",
      Provider: "sip",
      Surface: "sip",
      OriginatingChannel: "sip",
      OriginatingTo: caller,
      CommandAuthorized: false,
      // Phone identity is caller-supplied, never an operator/owner credential.
      BodyForCommands: ""
    }),
    // Empty allow set (default) disables tools on caller-ID-only phone ingress; opt in per tool name.
    toolsAllow: config.inbound.toolsAllow,
    dispatcherOptions: {
      deliver: async (payload) => {
        if (signal.aborted) return;
        if (payload.text) answers.push(payload.text);
        if (answers.join(" ").length > MAX_VOICE_REPLY_CHARS) throw new Error("SIP reply limit");
      }
    },
    replyOptions: { abortSignal: signal, disableTools: config.inbound.toolsAllow.length === 0 }
  });
  return signal.aborted ? "" : answers.join(" ");
}

// src/plugin.ts
var activeRun;
var HEARTBEAT_MS = 6e4;
var waitUntilAbort = (signal) => new Promise((resolve) => {
  if (signal.aborted) return resolve();
  signal.addEventListener("abort", () => resolve(), { once: true });
});
function registerSipRuntime(api, start = startSipPlugin) {
  registerDeepgramModelDiscovery(api, () => {
    const config = resolveSipConfig({ ...api.config, channels: {
      ...api.config?.channels,
      sip: sipConfigForValidation(api.config?.channels?.["sip"])
    } }, sipConfigForValidation(api.pluginConfig));
    return config.stt.apiKey ?? (config.tts.provider === "deepgram" ? config.tts.apiKey : void 0);
  });
  const run = async (ctx) => {
    const hostConfig = ctx.cfg ?? api.config;
    const authored = hostConfig?.channels?.["sip"];
    const legacy = api.pluginConfig ?? hostConfig?.plugins?.entries?.["sip"]?.config;
    const checked = resolveSipConfig({ ...hostConfig, channels: {
      ...hostConfig?.channels,
      sip: sipConfigForValidation(authored)
    } }, sipConfigForValidation(legacy));
    if (!checked.enabled) {
      await waitUntilAbort(ctx.abortSignal);
      return;
    }
    const legacyCopy = structuredClone(legacy);
    const channelTrunk = authored?.sip;
    for (const field of ["user", "password"]) {
      if (channelTrunk?.[field] !== void 0 && legacyCopy?.sip) delete legacyCopy.sip[field];
    }
    const hasRefs = (input) => {
      const sip = input?.sip;
      return isSipStoreRef(sip?.["user"]) || isSipStoreRef(sip?.["password"]);
    };
    const channelInput = hasRefs(authored) ? await resolveSipSecretInputs(hostConfig, authored, "channels.sip") : authored;
    const legacyInput = hasRefs(legacyCopy) ? await resolveSipSecretInputs(hostConfig, legacyCopy, "plugins.entries.sip.config") : legacyCopy;
    const config = resolveSipConfig({ ...hostConfig, channels: {
      ...hostConfig?.channels,
      sip: channelInput
    } }, legacyInput);
    if (!config.enabled) {
      await waitUntilAbort(ctx.abortSignal);
      return;
    }
    if (config.transport !== "embedded") throw new Error("SIP SDK channel requires embedded transport: bridge has no verified SIP hangup control");
    let handle;
    let stopping = false;
    const admission = new SipAdmission(config);
    const hangup = (session, reason) => {
      if (handle) handle.hangup(session, reason);
      else session.end(reason);
    };
    const report = (connected) => {
      ctx.setStatus?.({
        ...ctx.getStatus?.() ?? {},
        accountId: ctx.accountId,
        connected,
        lastTransportActivityAt: Date.now()
      });
    };
    let heartbeat;
    try {
      handle = await start(config, {
        admitCall: (session, custom) => {
          if (stopping) {
            hangup(session, "sip-stopping");
            return false;
          }
          if (admission.admit(session, custom)) {
            report(true);
            return true;
          }
          hangup(session, config.voice.enabled ? "sip-rejected" : "sip-voice-disabled");
          return false;
        },
        onUtterance: (text2, signal, session) => {
          const caller = admission.caller(session);
          if (!caller) throw new Error("SIP call not admitted");
          report(true);
          return dispatchSipTurn(api, config, caller, text2, signal);
        },
        onSessionEnd: (session) => {
          admission.end(session);
        },
        onLog: (message, fields) => api.logger.info(fields ? `${message} ${JSON.stringify(fields)}` : message)
      });
      report(true);
      heartbeat = setInterval(() => report(true), HEARTBEAT_MS);
      heartbeat.unref?.();
      await waitUntilAbort(ctx.abortSignal);
    } finally {
      stopping = true;
      if (heartbeat) clearInterval(heartbeat);
      const current = handle;
      handle = void 0;
      await current?.stop();
      report(false);
    }
  };
  activeRun = run;
  return run;
}
var plugin = createChatChannelPlugin({
  base: {
    id: "sip",
    meta: {
      id: "sip",
      label: "SIP Telephony",
      selectionLabel: "SIP Telephony",
      docsPath: "https://github.com/kpma1985/oc-plugin-sip/blob/main/README.md",
      blurb: "Inbound voice over own SIP trunk."
    },
    setupContract: sipSetupContract,
    setupWizard: sipSetupWizard,
    capabilities: { chatTypes: ["direct"] },
    gateway: {
      startAccount: (ctx) => {
        if (!activeRun) return Promise.reject(new Error("SIP runtime not registered"));
        return activeRun(ctx);
      }
    },
    configSchema: buildJsonChannelConfigSchema(openclaw_plugin_default.channelConfigs.sip.schema, {
      uiHints: openclaw_plugin_default.channelConfigs.sip.uiHints,
      runtime: {
        safeParse: (value) => {
          const result = authoredSipConfigSchema.safeParse(value);
          return result.success ? { success: true, data: value } : {
            success: false,
            issues: result.error.issues.map((issue) => ({
              path: issue.path.map((part) => typeof part === "number" ? part : String(part)),
              message: issue.message,
              code: issue.code
            }))
          };
        }
      }
    }),
    config: {
      listAccountIds: () => ["default"],
      resolveAccount: (cfg) => ({
        accountId: "default",
        ...resolveSipConfig({ ...cfg, channels: {
          ...cfg.channels,
          sip: sipConfigForValidation(cfg.channels?.["sip"])
        } }, sipConfigForValidation(cfg.plugins?.entries?.["sip"]?.config))
      }),
      isEnabled: (account) => account.enabled
    },
    agentPrompt: { messageToolHints: () => ["SIP voice: reply in one or two short sentences, no Markdown; spell out numbers."] }
  }
});
var entry = defineChannelPluginEntry({
  id: "sip",
  name: "SIP Telephony",
  description: "Independent inbound SIP voice channel",
  plugin,
  registerFull: registerSipRuntime
});
var plugin_default = entry;
export {
  plugin_default as default,
  registerSipRuntime
};
//# sourceMappingURL=plugin.js.map
