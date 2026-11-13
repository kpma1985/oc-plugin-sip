import { expect, it, vi } from 'vitest';
import ui from '../src/ui/controlUi.js';

function createElement(tag) {
  return {
    tag, children: [], listeners: {}, textContent: '', value: '', disabled: false, dataset: {},
    get options() { return this.children.filter(child => child.tag === 'option'); },
    replaceChildren(...items) { this.children = items; },
    setAttribute() { },
    addEventListener(event, listener) { this.listeners[event] = listener; },
    append(...items) { this.children.push(...items); },
    insertBefore(item, sibling) { this.children.splice(this.children.indexOf(sibling), 0, item); },
    remove() { },
  };
}

function find(root, predicate) {
  if (predicate(root)) return root;
  for (const child of root.children ?? []) {
    const match = find(child, predicate);
    if (match) return match;
  }
}

it('selects Store account references and protects environment usernames', async () => {
  const originalDocument = globalThis.document;
  globalThis.document = { createElement };
  try {
    let page;
    let persisted = { channels: { sip: { sip: { user: '${OPENCLAW_SIP_USER}' } } } };
    let sentPatch;
    const request = vi.fn(async (method, params) => {
      if (method === 'secrets.store.list') return { entries: [
        { name: 'SIP_ACCOUNT01_LABEL', kind: 'env', value: 'Trunk label' },
        { name: 'SIP_ACCOUNT01_USER', kind: 'secret' },
        { name: 'SIP_ACCOUNT01_PASSWORD', kind: 'secret' },
      ] };
      if (method === 'sip.deepgram.thinkModels') return { models: [] };
      if (method === 'config.patch') {
        sentPatch = JSON.parse(params.raw);
        persisted = sentPatch;
        return { ok: true };
      }
      return { valid: true, hash: 'revision', parsed: persisted };
    });
    const stop = ui.activate({
      ui: { registerPage(value) { page = value; return () => {}; }, registerNavigation: () => () => {} },
      connection: { canRead: true, canAdmin: true }, agents: { rows: [] }, request,
    });
    let root;
    const view = page.mount({ append: item => { root = item; } });
    await vi.waitFor(() => expect(root.children[1].textContent).toBe('Settings loaded'));
    const label = text => find(root, child => child.tag === 'label' && child.textContent === text);
    expect(label('SIP username')).toBeUndefined();
    const account = label('SIP account').children[0];
    expect(account.options.map(option => option.textContent)).toContain('Trunk label (SIP_ACCOUNT01)');
    expect(account.title).toContain('Settings > Secrets');
    account.value = 'SIP_ACCOUNT01';
    account.listeners.change();
    await root.children[2].listeners.submit({ preventDefault() {} });
    expect(sentPatch.channels.sip.sip.user).toEqual({ source: 'store', provider: 'default', id: 'SIP_ACCOUNT01_USER' });
    expect(sentPatch.channels.sip.sip.password).toEqual({ source: 'store', provider: 'default', id: 'SIP_ACCOUNT01_PASSWORD' });
    expect(root.children[1].textContent).toBe('Settings saved');
    expect(label('SIP username')).toBeUndefined();
    view.dispose();
    stop();
  } finally { globalThis.document = originalDocument; }
});

it('registers and disposes the SIP settings page', () => {
  const remove = vi.fn();
  const heading = { textContent: '', remove };
  const originalDocument = globalThis.document;
  globalThis.document = {
    createElement: tag => tag === 'h1' ? heading : {
      children: [], setAttribute() { }, addEventListener() { },
      append(...items) { this.children.push(...items); },
      remove() { remove(); },
    }
  };
  try {
    const disposePage = vi.fn();
    const disposeNavigation = vi.fn();
    let page;
    const registerPage = vi.fn(value => { page = value; return disposePage; });
    const registerNavigation = vi.fn(() => disposeNavigation);
    const stop = ui.activate({ ui: { registerPage, registerNavigation }, connection: { canRead: false } });
    const container = { append: vi.fn() };
    const view = page.mount(container);
    expect(ui.id).toBe('sip');
    expect(registerNavigation).toHaveBeenCalledWith(expect.objectContaining({ page: { id: 'settings' } }));
    expect(container.append).toHaveBeenCalledOnce();
    expect(heading.textContent).toBe('SIP Telephony');
    view.dispose();
    stop();
    expect(remove).toHaveBeenCalledOnce();
    expect(disposeNavigation).toHaveBeenCalledOnce();
    expect(disposePage).toHaveBeenCalledOnce();
  } finally {
    globalThis.document = originalDocument;
  }
});

it('retains draft when a guarded config patch fails', async () => {
  const originalDocument = globalThis.document;
  globalThis.document = { createElement };
  try {
    let page;
    const request = vi.fn(async method => {
      if (method === 'config.get') return { valid: true, hash: 'revision', parsed: { channels: { sip: {} } } };
      throw Error('configuration changed; re-run config.get');
    });
    const stop = ui.activate({
      ui: { registerPage(value) { page = value; return () => { }; }, registerNavigation: () => () => { } },
      connection: { canRead: true, canAdmin: true }, agents: { rows: [] }, request,
    });
    let root;
    const view = page.mount({ append: item => { root = item; } });
    await vi.waitFor(() => expect(root.children[1].textContent).toBe('Settings loaded'));
    const form = root.children[2];
    const voiceLabel = find(form, child => child.tag === 'label' && child.textContent === 'Voice mode');
    const save = find(form, child => child.type === 'submit');
    const cancel = find(form, child => child.type === 'button');
    const voice = voiceLabel.children[0];
    voice.value = 'deepgram-agent';
    voice.listeners.change();
    expect(save.disabled).toBe(false);
    await root.children[2].listeners.submit({ preventDefault() { } });
    expect(request).toHaveBeenCalledWith('config.patch', expect.objectContaining({ baseHash: 'revision' }));
    expect(voice.value).toBe('deepgram-agent');
    expect(save.disabled).toBe(false);
    expect(cancel.disabled).toBe(false);
    expect(root.children[1].textContent).toMatch(/Save failed/);
    view.dispose();
    stop();
  } finally {
    globalThis.document = originalDocument;
  }
});

it('shows fields for selected voice engine and providers', async () => {
  const originalDocument = globalThis.document;
  globalThis.document = { createElement };
  try {
    let page;
    const stop = ui.activate({
      ui: { registerPage(value) { page = value; return () => { }; }, registerNavigation: () => () => { } },
      connection: { canRead: true, canAdmin: true }, agents: { rows: [] },
      request: async () => ({ valid: true, hash: 'revision', parsed: { channels: { sip: {} } } }),
    });
    let root;
    const view = page.mount({ append: item => { root = item; } });
    await vi.waitFor(() => expect(root.children[1].textContent).toBe('Settings loaded'));
    const label = text => find(root, child => child.tag === 'label' && child.textContent === text);
    expect(label('LLM Provider').hidden).toBe(true);
    expect(label('TTS URL').hidden).toBe(true);
    expect(label('SIP domain').hidden).toBe(true);
    label('Voice mode').children[0].value = 'deepgram-agent';
    label('Voice mode').children[0].listeners.change();
    label('TTS Provider').children[0].value = 'custom';
    label('TTS Provider').children[0].listeners.change();
    label('SIP').children[0].value = 'custom';
    label('SIP').children[0].listeners.change();
    expect(label('LLM Provider').hidden).toBe(false);
    expect(label('Voice Agent prompt').hidden).toBe(false);
    expect(label('TTS URL').hidden).toBe(false);
    expect(label('SIP domain').hidden).toBe(false);
    view.dispose();
    stop();
  } finally {
    globalThis.document = originalDocument;
  }
});

it('offers think models per provider, keeps unknown IDs as custom and saves selections', async () => {
  const originalDocument = globalThis.document;
  globalThis.document = { createElement };
  try {
    let page;
    let sentPatch;
    const request = vi.fn(async (method, params) => {
      if (method === 'sip.deepgram.thinkModels') return { models: [
        { id: 'gpt-live', name: 'GPT Live', provider: 'open_ai' },
        { id: 'claude-live', name: 'Claude Live', provider: 'anthropic' },
      ] };
      if (method === 'config.patch') { sentPatch = JSON.parse(params.raw); return { ok: true }; }
      return { valid: true, hash: 'revision', parsed: { channels: { sip: {
        voice: { engine: 'deepgram-agent', agent: { think: { provider: 'open_ai', model: 'my-private-model' } } },
      } } } };
    });
    const stop = ui.activate({
      ui: { registerPage(value) { page = value; return () => { }; }, registerNavigation: () => () => { } },
      connection: { canRead: true, canAdmin: true }, agents: { rows: [] }, request,
    });
    let root;
    const view = page.mount({ append: item => { root = item; } });
    await vi.waitFor(() => expect(request).toHaveBeenCalledWith('sip.deepgram.thinkModels', {}));
    const label = text => find(root, child => child.tag === 'label' && child.textContent === text);
    const model = label('LLM Model').children[0];
    await vi.waitFor(() => expect(model.options.map(option => option.value)).toContain('gpt-live'));
    expect(model.options.map(option => option.value)).not.toContain('claude-live');
    expect(model.value).toBe('__custom__');
    expect(label('Custom model ID').children[0].value).toBe('my-private-model');
    expect(label('Custom model ID').hidden).toBe(false);
    const provider = label('LLM Provider').children[0];
    provider.value = 'anthropic';
    provider.listeners.change({ target: provider });
    expect(model.options.map(option => option.value)).toContain('claude-live');
    expect(model.options.map(option => option.value)).not.toContain('gpt-live');
    model.value = 'claude-live';
    model.listeners.change({ target: model });
    expect(label('Custom model ID').hidden).toBe(true);
    await root.children[2].listeners.submit({ preventDefault() { } });
    expect(sentPatch).toEqual({ channels: { sip: { voice: { agent: { think: { provider: 'anthropic', model: 'claude-live' } } } } } });
    view.dispose();
    stop();
  } finally {
    globalThis.document = originalDocument;
  }
});

it('confirms saved settings only after reading persisted config', async () => {
  const originalDocument = globalThis.document;
  globalThis.document = { createElement };
  try {
    let page;
    let reads = 0;
    let sentPatch;
    const request = vi.fn(async (method, params) => {
      if (method === 'config.patch') {
        sentPatch = JSON.parse(params.raw);
        return { ok: true };
      }
      if (method === 'sip.deepgram.thinkModels') return { models: [] };
      if (method === 'secrets.store.list') return { entries: [] };
      reads++;
      return {
        valid: true, hash: `revision-${reads}`, parsed: {
          channels: { sip: { sip: { preset: reads === 1 ? 'sipgate' : 'custom', domain: 'example.org', registrar: 'example.org' } } },
        }
      };
    });
    const stop = ui.activate({
      ui: { registerPage(value) { page = value; return () => { }; }, registerNavigation: () => () => { } },
      connection: { canRead: true, canAdmin: true }, agents: { rows: [] }, request,
    });
    let root;
    const view = page.mount({ append: item => { root = item; } });
    await vi.waitFor(() => expect(root.children[1].textContent).toBe('Settings loaded'));
    const form = root.children[2];
    const sip = find(form, child => child.tag === 'label' && child.textContent === 'SIP').children[0];
    sip.value = 'custom';
    sip.listeners.change();
    await form.listeners.submit({ preventDefault() { } });
    expect(sentPatch).toEqual({ channels: { sip: { sip: { preset: 'custom' } } } });
    expect(request).toHaveBeenCalledWith('config.patch', expect.objectContaining({ baseHash: 'revision-1' }));
    expect(reads).toBe(2);
    expect(root.children[1].textContent).toBe('Settings saved');
    expect(find(form, child => child.tag === 'label' && child.textContent === 'SIP').children[0].value).toBe('custom');
    view.dispose();
    stop();
  } finally {
    globalThis.document = originalDocument;
  }
});
