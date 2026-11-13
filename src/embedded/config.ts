import type { Config } from '../../vendor/sip-bridge/src/config/index.js';
import type { SipPluginConfig } from '../config.js';

/** No vendor env loader: every upstream setting is supplied explicitly. */
export function mapEmbeddedConfig(config: SipPluginConfig, address: { address: string; port: number }): Config {
  let host = address.address;
  if (host === '0.0.0.0') host = '127.0.0.1';
  if (host === '::') host = '::1';
  if (host.includes(':')) host = `[${host}]`;
  return {
    SIP_USER: config.sip.user!, SIP_PASSWORD: config.sip.password!,
    SIP_DOMAIN: config.sip.domain, SIP_REGISTRAR: config.sip.registrar,
    SIP_LISTEN_ADDR: config.sip.listenAddr, SDP_CONTACT_IP: config.sip.publicIp,
    RTP_PORT_MIN: config.media.rtpPortMin, RTP_PORT_MAX: config.media.rtpPortMax,
    SRTP_ENABLED: config.sip.srtp, AUDIO_MODE: config.audio.mode,
    WS_TARGET_URL: `ws://${host}:${address.port}${config.media.path}${config.media.authToken ? `?token=${encodeURIComponent(config.media.authToken)}` : ''}`,
    SIP_EXPIRES: 120, SIP_OPTIONS_INTERVAL: 30, LOG_LEVEL: 'info', HTTP_PORT: 9090,
    VOICE_URL: undefined, VOICE_METHOD: 'POST', VOICE_FALLBACK_URL: undefined,
    VOICE_FALLBACK_METHOD: 'POST', VOICE_TIMEOUT_S: 5,
    AUTH_TOKEN: '', PUBLIC_BASE_URL: undefined, SIP_OUTBOUND_TARGET_PORT: 0,
    STATUS_CALLBACK_DEFAULT_URL: undefined, STATUS_CALLBACK_DEFAULT_METHOD: 'POST',
    STATUS_CALLBACK_DEFAULT_EVENTS: 'initiated,ringing,answered,completed',
    DIAL_ALLOWED_PREFIXES: '', DIAL_DEFAULT_CALLER_ID: undefined,
    DIAL_CALLER_ID_COUNTRY_CODE: undefined, DIAL_RING_TIMEOUT_S: 30,
    DIAL_MAX_PER_SESSION: 3, DIAL_MAX_PER_MINUTE: 60,
  };
}
