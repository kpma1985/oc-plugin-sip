import { mergeSelectionPatches, selection, setting, selectionError } from './configDraft.js';
import { sipAccounts, accountSelection, accountChanges } from './sipAccounts.js';

const helpTexts = {
  'voice.engine': 'OpenClaw uses the selected agent and its configured model. Deepgram Voice Agent uses its own think provider, model and prompt.',
  'inbound.agentId': 'Default agent route. Explicit OpenClaw bindings can select another agent. Standard removes the explicit SIP agent override.',
  'tts.provider': 'ElevenLabs requires Deepgram Voice Agent. Custom is OpenAI-compatible PCM synthesis in OpenClaw mode.',
  'stt.baseUrl': 'OpenClaw mode only. Default: wss://api.deepgram.com. Enter a WSS base URL without /v1/listen.',
  'tts.baseUrl': 'Custom synthesis endpoint base URL. Existing explicit endpoints are preserved when switching providers.',
  'sip.account': 'Accounts come from Settings > Secrets: SIP_ACCOUNT01_USER and SIP_ACCOUNT01_PASSWORD as secret, SIP_ACCOUNT01_LABEL as env. Selecting an account changes trunk credentials on Save.',
  'sip.user': 'SIP trunk login. Environment placeholders and Store references are managed outside this field. Password is configured in Settings > Secrets or the host environment.',
  'sip.domain': 'SIP domain. sipgate defaults to sipconnect.sipgate.de. Custom requires an explicit domain.',
  'sip.registrar': 'SIP registration server. sipgate defaults to sipconnect.sipgate.de. Custom requires an explicit registrar.',
  'sip.publicIp': 'Public IPv4 advertised in SDP. Required for embedded transport behind NAT so RTP can reach the gateway.',
  'sip.srtp': 'Enable SRTP only when supported by your SIP trunk.',
  'inbound.policy': 'Allowlist accepts only listed caller numbers. Open accepts any caller; caller ID is not authentication.',
  'inbound.allowFrom': 'One allowed caller number per line. Empty allowlist rejects all callers.',
  'inbound.toolsAllow': 'Explicit tools allowed for phone calls. Empty list disables delegated tools.',
  'inbound.pin': 'DTMF keypad PIN. Blocks caller audio, the agent and its tools until the code is entered and confirmed with #.',
  'inbound.pin.enabled': 'Requires a keypad PIN (DTMF) before the agent or its tools can be reached.',
  'inbound.pin.code': 'Digits only, 3 to 12. Caller types the code and confirms with #; * clears the entry.',
  'inbound.pin.promptText': 'Spoken prompt played before the PIN entry.',
  'inbound.pin.failureText': 'Spoken message after a wrong PIN.',
  'inbound.pin.successText': 'Optional spoken message after a correct PIN. Empty stays silent.',
  'inbound.pin.lockoutText': 'Spoken message before the call is ended after too many attempts or a timeout.',
  'inbound.pin.maxAttempts': 'Wrong entries allowed before the call is ended.',
  'inbound.pin.maxDigits': 'Digits accepted per entry; the code is submitted automatically at this length.',
  'inbound.pin.timeoutMs': 'Milliseconds the caller has to enter the PIN before the call ends.',
  'voice.agent.tools': 'Allows Deepgram Voice Agent to delegate tasks to the selected OpenClaw agent. This does not change the speaking LLM.',
  'voice.playbackPrebufferMs': 'Audio buffered before playback. Multiples of 20 ms, from 0 to 2000.',
  'voice.agent.think.model': 'Models are filtered by Deepgram provider. Custom model ID preserves IDs for your own endpoint.',
};

const fields = [
  ['voice', 'engine', 'Voice mode', [['openclaw', 'OpenClaw'], ['deepgram-agent', 'Deepgram Voice Agent']]],
  ['stt', 'provider', 'STT Provider', [['deepgram', 'Deepgram']]],
  ['tts', 'provider', 'TTS Provider', [['deepgram', 'Deepgram'], ['custom', 'Custom'], ['elevenlabs', 'ElevenLabs']]],
  ['voice', 'agent', 'LLM Provider', [['open_ai', 'OpenAI'], ['anthropic', 'Anthropic'], ['google', 'Google'], ['groq', 'Groq'], ['aws_bedrock', 'AWS Bedrock'], ['nvidia', 'NVIDIA']], ['voice', 'agent', 'think', 'provider']],
  ['voice', 'model', 'LLM Model', 'think-model', ['voice', 'agent', 'think', 'model']],
  ['sip', 'preset', 'SIP', [['sipgate', 'sipgate'], ['custom', 'Custom']]],
  ['inbound', 'agentId', 'OpenClaw Agent', []],
];

const advancedFields = [
  [['voice', 'enabled'], 'Voice enabled', 'checkbox'],
  [['sip', 'domain'], 'SIP domain', 'text'],
  [['sip', 'registrar'], 'SIP registrar', 'text'],
  [['sip', 'publicIp'], 'Public IP', 'text'],
  [['sip', 'listenAddr'], 'SIP listen address', 'text'],
  [['sip', 'srtp'], 'SRTP', 'checkbox'],
  [['voice', 'agent', 'prompt'], 'Voice Agent prompt', 'textarea'],
  [['voice', 'agent', 'greeting'], 'Voice Agent greeting', 'text'],
  [['voice', 'agent', 'tools'], 'Delegation tools', 'checkbox'],
  [['stt', 'model'], 'STT model', 'text'],
  [['stt', 'baseUrl'], 'STT URL', 'url'],
  [['tts', 'model'], 'TTS model', 'text'],
  [['tts', 'voice'], 'TTS voice', 'text'],
  [['tts', 'baseUrl'], 'TTS URL', 'url'],
  [['tts', 'timeoutMs'], 'TTS timeout (ms)', 'number'],
  [['tts', 'sourceSampleRate'], 'Custom TTS sample rate', 'number'],
  [['voice', 'playbackPrebufferMs'], 'Playback prebuffer (ms)', 'number'],
  [['voice', 'maxInboundBytes'], 'Inbound queue (bytes)', 'number'],
  [['voice', 'maxOutboundBytes'], 'Outbound queue (bytes)', 'number'],
  [['inbound', 'policy'], 'Inbound policy', [['allowlist', 'Allowlist'], ['open', 'Open']]],
  [['inbound', 'allowFrom'], 'Allowed callers (one per line)', 'lines'],
  [['inbound', 'greeting'], 'Inbound greeting', 'text'],
  [['inbound', 'maxConcurrent'], 'Maximum concurrent calls', 'number'],
  [['inbound', 'toolsAllow'], 'Allowed tools (one per line)', 'lines'],
  [['inbound', 'pin', 'enabled'], 'Enable PIN gate (keypad)', 'checkbox'],
  [['inbound', 'pin', 'code'], 'PIN code (digits only, 3-12)', 'text'],
  [['inbound', 'pin', 'promptText'], 'PIN prompt announcement', 'text'],
  [['inbound', 'pin', 'failureText'], 'Incorrect PIN announcement', 'text'],
  [['inbound', 'pin', 'successText'], 'Correct PIN announcement (optional)', 'text'],
  [['inbound', 'pin', 'lockoutText'], 'Lockout announcement', 'text'],
  [['inbound', 'pin', 'maxAttempts'], 'Maximum failed attempts', 'number'],
  [['inbound', 'pin', 'maxDigits'], 'Maximum PIN length (digits)', 'number'],
  [['inbound', 'pin', 'timeoutMs'], 'PIN entry timeout (ms)', 'number'],
  [['stt', 'language'], 'STT language', 'text'],
  [['stt', 'keyterms'], 'STT keyterms (one per line)', 'lines'],
  [['stt', 'endpointing'], 'STT endpointing (ms)', 'number'],
  [['stt', 'utteranceEndMs'], 'Utterance end (ms)', 'number'],
  [['stt', 'connectionTimeoutMs'], 'STT connection timeout (ms)', 'number'],
  [['stt', 'maxBufferedBytes'], 'STT buffer (bytes)', 'number'],
  [['media', 'host'], 'Media host', 'text'],
  [['media', 'port'], 'Media port', 'number'],
  [['media', 'rtpPortMin'], 'RTP port min', 'number'],
  [['media', 'rtpPortMax'], 'RTP port max', 'number'],
  [['audio', 'mode'], 'Audio codec', [['twilio', 'G.711'], ['best', 'Best available']]],
];

const CUSTOM_MODEL = '__custom__';
// Fallback snapshot of https://agent.deepgram.com/v1/agent/settings/think/models (2026-10-12).
// The page replaces it with the live list from sip.deepgram.thinkModels when available.
const staticThinkModels = [
  ...['gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano', 'gpt-4o', 'gpt-4o-mini', 'gpt-5', 'gpt-5-mini', 'gpt-5-nano',
    'gpt-5.1', 'gpt-5.2', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-5.5', 'gpt-5.6-luna', 'gpt-5.6-terra',
    'gpt-6-luna'].map(id => ({ id, name: id, provider: 'open_ai' })),
  ...['claude-haiku-4-5', 'claude-haiku-5-5', 'claude-sonnet-4-5', 'claude-sonnet-4-6', 'claude-sonnet-5',
    'claude-sonnet-5-5'].map(id => ({ id, name: id, provider: 'anthropic' })),
  ...['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-3-flash-preview', 'gemini-3.1-flash-lite',
    'gemini-3.1-pro-preview', 'gemini-3.5-flash', 'gemini-3.8-flash'].map(id => ({ id, name: id, provider: 'google' })),
  { id: 'openai/gpt-oss-20b', name: 'openai/gpt-oss-20b', provider: 'groq' },
  { id: 'nvidia/nemotron-3.5-lightning-30b-a3b', name: 'nvidia/nemotron-3.5-lightning-30b-a3b', provider: 'nvidia' },
];
const isDeepgramAgent = draft => draft('voice.engine') === 'deepgram-agent';
const visibility = {
  'voice.agent.think.provider': isDeepgramAgent,
  'voice.agent.think.model': isDeepgramAgent,
  'voice.agent.think.customModel': draft => isDeepgramAgent(draft) && draft('voice.agent.think.modelChoice') === CUSTOM_MODEL,
  'voice.agent.prompt': isDeepgramAgent,
  'voice.agent.greeting': isDeepgramAgent,
  'voice.agent.tools': isDeepgramAgent,
  'inbound.toolsAllow': draft => !isDeepgramAgent(draft) || draft('voice.agent.tools') === true,
  'tts.baseUrl': draft => draft('tts.provider') === 'custom',
  'tts.sourceSampleRate': draft => draft('tts.provider') === 'custom',
  'tts.voice': draft => draft('tts.provider') !== 'deepgram' || isDeepgramAgent(draft),
  'sip.domain': draft => draft('sip.preset') === 'custom',
  'sip.registrar': draft => draft('sip.preset') === 'custom',
  'inbound.allowFrom': draft => draft('inbound.policy') !== 'open',
  'inbound.pin.code': draft => draft('inbound.pin.enabled') === true,
  'inbound.pin.promptText': draft => draft('inbound.pin.enabled') === true,
  'inbound.pin.failureText': draft => draft('inbound.pin.enabled') === true,
  'inbound.pin.successText': draft => draft('inbound.pin.enabled') === true,
  'inbound.pin.lockoutText': draft => draft('inbound.pin.enabled') === true,
  'inbound.pin.maxAttempts': draft => draft('inbound.pin.enabled') === true,
  'inbound.pin.maxDigits': draft => draft('inbound.pin.enabled') === true,
  'inbound.pin.timeoutMs': draft => draft('inbound.pin.enabled') === true,
};

const defaults = {
  'tts.timeoutMs': 30000, 'voice.playbackPrebufferMs': 0,
  'voice.maxInboundBytes': 32000, 'voice.maxOutboundBytes': 64000,
  'inbound.maxConcurrent': 2, 'stt.language': 'de', 'stt.endpointing': 300,
  'inbound.pin.promptText': 'Please enter your PIN, followed by the pound key.',
  'inbound.pin.failureText': 'Incorrect PIN. Please try again.',
  'inbound.pin.successText': '',
  'inbound.pin.lockoutText': 'Too many failed attempts. Goodbye.',
  'inbound.pin.maxAttempts': 3, 'inbound.pin.maxDigits': 8, 'inbound.pin.timeoutMs': 20000,
  'stt.utteranceEndMs': 1000, 'stt.connectionTimeoutMs': 10000,
  'stt.maxBufferedBytes': 32000, 'media.host': '127.0.0.1',
  'media.port': 8080, 'media.rtpPortMin': 10000, 'media.rtpPortMax': 10099,
};

export default {
  id: 'sip',
  activate(host) {
    const disposePage = host.ui.registerPage({
      id: 'settings',
      label: 'SIP Telephony',
      mount(container) {
        const controller = new AbortController();
        const root = document.createElement('section');
        root.className = 'sip-ui';
        const header = document.createElement('header');
        header.className = 'sip-ui__header';
        const eyebrow = document.createElement('span');
        eyebrow.className = 'sip-ui__eyebrow';
        eyebrow.textContent = 'TELEPHONY / CONFIGURATION';
        const heading = document.createElement('h1');
        heading.textContent = 'SIP Telephony';
        const intro = document.createElement('p');
        intro.className = 'sip-ui__intro';
        intro.textContent = 'Voice, providers and call routing for your SIP channel.';
        header.append(eyebrow, heading, intro);
        const status = document.createElement('p');
        status.setAttribute('role', 'status');
        status.className = 'sip-ui__status';
        const form = document.createElement('form');
        const section = (index, title) => {
          const wrapper = document.createElement('section');
          wrapper.className = 'sip-ui__section';
          const head = document.createElement('div');
          head.className = 'sip-ui__section-head';
          const number = document.createElement('span');
          number.className = 'sip-ui__index';
          number.textContent = index;
          const heading = document.createElement('h2');
          heading.textContent = title;
          head.append(number, heading);
          const grid = document.createElement('div');
          grid.className = 'sip-ui__grid';
          wrapper.append(head, grid);
          form.append(wrapper);
          return grid;
        };
        const voiceFields = section('01', 'Voice experience');
        const routingFields = section('02', 'Providers & routing');
        const advanced = document.createElement('details');
        advanced.className = 'sip-ui__advanced';
        const advancedTitle = document.createElement('summary');
        advancedTitle.textContent = 'Advanced settings';
        advanced.append(advancedTitle);
        const advancedGroups = new Map();
        for (const title of ['SIP & network', 'Speech & playback', 'Voice Agent', 'Inbound security']) {
          const group = document.createElement('section');
          group.className = 'sip-ui__advanced-group';
          const heading = document.createElement('h3');
          heading.textContent = title;
          const grid = document.createElement('div');
          grid.className = 'sip-ui__grid';
          group.append(heading, grid);
          grid.section = group;
          advanced.append(group);
          advancedGroups.set(title, grid);
        }
        const save = document.createElement('button');
        save.type = 'submit';
        save.textContent = 'Save';
        save.disabled = true;
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.textContent = 'Cancel';
        cancel.disabled = true;
        const actions = document.createElement('div');
        actions.className = 'sip-ui__actions';
        actions.append(save, cancel);
        form.append(advanced, actions);
        root.append(header, status, form);
        container.append(root);
        let snapshot;
        let controls = [];
        let busy = false;
        let accounts = [];
        let accountsError = false;
        let thinkModels = staticThinkModels;
        let refreshThinkModels = () => undefined;
        const valueOf = control => {
          if (control.type === 'think-model') {
            return control.select.value === CUSTOM_MODEL ? control.customInput.value.trim() : control.select.value;
          }
          if (control.type === 'checkbox') return control.select.checked;
          if (control.type === 'number') return control.select.value === '' ? control.original === '' ? '' : undefined : Number(control.select.value);
          if (control.type === 'lines') return control.select.value.split('\n').map(value => value.trim()).filter(Boolean);
          return control.select.value;
        };
        const editable = () => controls.filter(control => control.type !== 'virtual' && !control.managed);
        const changed = () => editable().some(control => JSON.stringify(valueOf(control)) !== JSON.stringify(control.original));
        const setStatus = text => { if (!controller.signal.aborted) status.textContent = text; };
        const render = () => {
          controls.forEach(control => control.label.remove());
          controls = [];
          const renderThinkModel = (title, path) => {
            const label = document.createElement('label');
            label.className = 'sip-ui__field';
            label.textContent = title;
            const select = document.createElement('select');
            select.disabled = !host.connection.canAdmin;
            select.addEventListener('change', onChange, { signal: controller.signal });
            label.append(select);
            routingFields.append(label);
            const customLabel = document.createElement('label');
            customLabel.className = 'sip-ui__field';
            customLabel.textContent = 'Custom model ID';
            const customInput = document.createElement('input');
            customInput.type = 'text';
            customInput.disabled = !host.connection.canAdmin;
            customInput.addEventListener('input', onChange, { signal: controller.signal });
            customLabel.append(customInput);
            routingFields.append(customLabel);
            const original = setting(snapshot.parsed, path, '');
            select.append(Object.assign(document.createElement('option'), { value: original, textContent: original }));
            select.value = original;
            controls.push({ path, label, select, customInput, original, type: 'think-model', thinkModel: true });
            controls.push({ path: ['voice', 'agent', 'think', 'customModel'], label: customLabel, select: customInput, original: '', type: 'virtual' });
          };
          const draft = key => {
            if (key === 'voice.agent.think.modelChoice') return controls.find(item => item.thinkModel)?.select.value;
            const control = controls.find(item => item.path.join('.') === key);
            return control ? valueOf(control) : setting(snapshot.parsed, key.split('.'), defaults[key]);
          };
          const updateVisibility = () => {
            for (const control of controls) {
              const visible = visibility[control.path.join('.')]?.(draft) ?? true;
              control.label.hidden = !visible;
            }
            for (const group of advancedGroups.values()) {
              group.section.hidden = controls.every(control => control.group !== group || control.label.hidden);
            }
          };
          const fillThinkModels = (providerChanged = false) => {
            const think = controls.find(control => control.thinkModel);
            if (!think) return;
            const provider = draft('voice.agent.think.provider');
            if (providerChanged) {
              think.select.value = '';
              think.customInput.value = '';
            }
            const selected = think.select.value;
            const ids = thinkModels.filter(model => model.provider === provider);
            think.select.replaceChildren();
            const empty = document.createElement('option');
            empty.value = '';
            empty.textContent = 'Select model';
            think.select.append(empty);
            for (const model of ids) {
              const option = document.createElement('option');
              option.value = model.id;
              option.textContent = model.name === model.id ? model.id : `${model.name} (${model.id})`;
              think.select.append(option);
            }
            const custom = document.createElement('option');
            custom.value = CUSTOM_MODEL;
            custom.textContent = 'Custom model ID';
            think.select.append(custom);
            const known = ids.some(model => model.id === selected);
            think.select.value = known || selected === CUSTOM_MODEL || selected === '' ? selected : CUSTOM_MODEL;
            if (!known && selected && selected !== CUSTOM_MODEL) think.customInput.value = selected;
          };
          const onChange = event => {
            if (event?.target?.dataset?.path === 'voice.agent.think.provider') fillThinkModels(true);
            updateVisibility();
            save.disabled = busy || !host.connection.canAdmin || !changed();
            cancel.disabled = busy || save.disabled;
          };
          const accountLabel = document.createElement('label');
          accountLabel.className = 'sip-ui__field';
          accountLabel.textContent = 'SIP account';
          const accountInput = document.createElement('select');
          const originalAccount = accountSelection(snapshot.parsed, setting);
          const existing = document.createElement('option');
          existing.value = '';
          existing.textContent = accountsError ? 'Secret store unavailable' : 'Keep current credentials';
          accountInput.append(existing);
          for (const account of accounts) {
            const option = document.createElement('option');
            option.value = account.id;
            option.textContent = `${account.label} (${account.id})`;
            accountInput.append(option);
          }
          if (originalAccount && !accounts.some(account => account.id === originalAccount)) {
            const option = document.createElement('option');
            option.value = originalAccount;
            option.textContent = `${originalAccount} (unavailable)`;
            accountInput.append(option);
          }
          accountInput.value = originalAccount;
          accountInput.disabled = !host.connection.canAdmin || accountsError || accounts.length === 0;
          accountInput.addEventListener('change', onChange, { signal: controller.signal });
          accountLabel.append(accountInput);
          const accountGroup = advancedGroups.get('SIP & network');
          accountGroup.append(accountLabel);
          controls.push({ path: ['sip', 'account'], label: accountLabel, select: accountInput,
            original: originalAccount, type: 'account', group: accountGroup });
          for (const [section, field, title, options, nestedPath] of fields) {
            if (options === 'think-model') {
              renderThinkModel(title, nestedPath);
              continue;
            }
            const label = document.createElement('label');
            label.className = 'sip-ui__field';
            label.textContent = title;
            const select = document.createElement(options === null ? 'input' : 'select');
            const path = nestedPath ?? [section, field];
            const choices = field === 'agentId'
              ? [['', 'Standard'], ...host.agents.rows.map(agent => [agent.id, agent.name ?? agent.id])]
              : options ?? [];
            for (const [value, name] of choices) {
              const option = document.createElement('option');
              option.value = value;
              option.textContent = name;
              select.append(option);
            }
            const current = setting(snapshot.parsed, path, field === 'agentId' || options === null ? '' : options[0][0]);
            if (options !== null && ![...select.options].some(option => option.value === current)) {
              const option = document.createElement('option');
              option.value = current;
              option.textContent = `${current} (unavailable)`;
              select.append(option);
            }
            select.value = current;
            select.dataset.path = path.join('.');
            select.disabled = !host.connection.canAdmin;
            select.addEventListener('change', onChange, { signal: controller.signal });
            label.append(select);
            (section === 'voice' && field === 'engine' ? voiceFields : routingFields).append(label);
            controls.push({ section, field, path, label, select, original: current, type: 'select' });
          }
          for (const [path, title, type] of advancedFields) {
            const label = document.createElement('label');
            label.className = `sip-ui__field${type === 'checkbox' ? ' sip-ui__field--toggle' : type === 'textarea' || type === 'lines' ? ' sip-ui__field--wide' : ''}`;
            label.textContent = title;
            const input = document.createElement(Array.isArray(type) ? 'select' : type === 'textarea' || type === 'lines' ? 'textarea' : 'input');
            if (Array.isArray(type)) {
              for (const [value, name] of type) {
                const option = document.createElement('option');
                option.value = value;
                option.textContent = name;
                input.append(option);
              }
            } else if (type !== 'textarea' && type !== 'lines') input.type = type;
            const fallback = type === 'checkbox' ? false : type === 'lines' ? [] : defaults[path.join('.')] ?? '';
            const original = setting(snapshot.parsed, path, fallback);
            if (type === 'checkbox') input.checked = original === true;
            else input.value = type === 'lines' ? (Array.isArray(original) ? original : []).join('\n')
              : original && typeof original === 'object' ? 'Managed in Settings > Secrets' : String(original);
            const managed = path.join('.') === 'sip.user' &&
              (typeof original === 'object' || /\$\{[A-Z][A-Z0-9_]*\}/.test(String(original)));
            input.disabled = !host.connection.canAdmin || managed;
            input.addEventListener(Array.isArray(type) || type === 'checkbox' ? 'change' : 'input', onChange, { signal: controller.signal });
            label.append(input);
            const group = path[0] === 'sip' || path[0] === 'media' || path[0] === 'audio' ? 'SIP & network'
              : path[0] === 'inbound' ? 'Inbound security' : path[0] === 'voice' && path[1] === 'agent' ? 'Voice Agent' : 'Speech & playback';
            advancedGroups.get(group).append(label);
            controls.push({ path, label, select: input, original, type, managed, group: advancedGroups.get(group) });
          }
          for (const control of controls) {
            const text = helpTexts[control.path.join('.')] ?? `Configure ${control.label.childNodes?.[0]?.textContent ?? control.path.join('.')}. Changes apply only on Save.`;
            control.select.title = text;
            control.label.title = text;
            const help = document.createElement('span');
            help.className = 'sip-ui__help';
            help.tabIndex = 0;
            help.setAttribute('role', 'img');
            help.setAttribute('aria-label', text);
            help.setAttribute('data-help', text);
            help.title = text;
            help.textContent = '?';
            control.label.append(help);
          }
          refreshThinkModels = () => { fillThinkModels(); updateVisibility(); };
          fillThinkModels();
          updateVisibility();
          save.disabled = true;
          cancel.disabled = true;
        };
        const load = async () => {
          setStatus('Loading settings');
          try {
            const result = await host.request('config.get');
            if (controller.signal.aborted) return;
            if (!result.valid || !result.hash || !result.parsed) throw Error('Configuration unavailable');
            snapshot = result;
            if (host.connection.canAdmin) {
              try {
                const inventory = await host.request('secrets.store.list', {});
                if (controller.signal.aborted) return;
                accounts = sipAccounts(inventory?.entries);
              } catch { accountsError = true; }
            }
            render();
            setStatus(host.connection.canAdmin ? 'Settings loaded' : 'Administrator access required to save');
            void host.request('sip.deepgram.thinkModels', {}).then(result => {
              if (controller.signal.aborted || !Array.isArray(result?.models) || !result.models.length) return;
              thinkModels = result.models;
              refreshThinkModels();
            }).catch(() => undefined);
          } catch { setStatus('Could not load settings. Retry by reopening this page.'); }
        };
        form.addEventListener('submit', async event => {
          event.preventDefault();
          if (busy || !snapshot || !host.connection.canAdmin) return;
          const selectedAccount = controls.find(control => control.type === 'account');
          if (selectedAccount.select.value !== selectedAccount.original &&
            (!selectedAccount.select.value || !accounts.some(account => account.id === selectedAccount.select.value))) {
            setStatus('Select an available SIP account or Cancel to keep current credentials');
            return;
          }
          const changes = editable().filter(control => control.type !== 'account' && JSON.stringify(valueOf(control)) !== JSON.stringify(control.original))
            .map(control => [control.path, valueOf(control)]);
          if (selectedAccount.select.value !== selectedAccount.original) {
            changes.push(...accountChanges(selectedAccount.select.value));
          }
          if (!changes.length) return;
          if (changes.some(([, value]) => value === undefined || (typeof value === 'number' && !Number.isFinite(value)))) {
            setStatus('Enter valid numeric values before saving');
            return;
          }
          const error = selectionError(snapshot.parsed, changes);
          if (error) { setStatus(error); return; }
          busy = true;
          save.disabled = true;
          cancel.disabled = true;
          controls.forEach(control => { control.select.disabled = true; });
          setStatus('Saving settings');
          try {
            await host.request('config.patch', {
              raw: JSON.stringify(mergeSelectionPatches(snapshot.parsed, changes)), baseHash: snapshot.hash,
            });
            const result = await host.request('config.get');
            if (controller.signal.aborted) return;
            if (!result.valid || !result.hash || !result.parsed ||
              changes.some(([path, value]) => JSON.stringify(setting(result.parsed, path, '')) !== JSON.stringify(value))) {
              throw Error('Saved configuration could not be confirmed');
            }
            snapshot = result;
            render();
            setStatus('Settings saved');
          } catch {
            setStatus('Save failed or could not be confirmed. Check Channels settings before retrying. Draft retained.');
            if (!controller.signal.aborted) {
              save.disabled = false;
              cancel.disabled = false;
            }
          } finally {
            busy = false;
            if (!controller.signal.aborted) controls.forEach(control => {
              control.select.disabled = !host.connection.canAdmin || control.managed ||
                (control.type === 'account' && (accountsError || accounts.length === 0));
            });
          }
        }, { signal: controller.signal });
        cancel.addEventListener('click', () => { render(); setStatus('Changes discarded'); }, { signal: controller.signal });
        if (host.connection.canRead) void load();
        else setStatus('Operator read access required');
        return { dispose: () => { controller.abort(); root.remove(); } };
      },
    });
    const disposeNavigation = host.ui.registerNavigation({
      id: 'settings', label: 'SIP Telephony', page: { id: 'settings' }, icon: 'phone',
    });
    return () => { disposeNavigation(); disposePage(); };
  },
};
