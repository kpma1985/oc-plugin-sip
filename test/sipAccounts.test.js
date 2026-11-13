import { expect, it } from 'vitest';
import { sipAccounts, accountSelection, accountChanges } from '../src/ui/sipAccounts.js';
import { setting, mergeSelectionPatches } from '../src/ui/configDraft.js';

it('lists only complete accounts with secret credentials and visible labels', () => {
  const entries = [
    { name: 'SIP_ACCOUNT01_LABEL', kind: 'env', value: 'Private trunk' },
    { name: 'SIP_ACCOUNT01_USER', kind: 'secret' },
    { name: 'SIP_ACCOUNT01_PASSWORD', kind: 'secret' },
    { name: 'SIP_ACCOUNT02_LABEL', kind: 'env', value: 'Incomplete' },
    { name: 'SIP_ACCOUNT02_USER', kind: 'env', value: 'not-a-secret' },
    { name: 'SIP_ACCOUNT02_PASSWORD', kind: 'secret' },
  ];
  expect(sipAccounts(entries)).toEqual([{ id: 'SIP_ACCOUNT01', label: 'Private trunk' }]);
  expect(sipAccounts(undefined)).toEqual([]);
});

it('writes only credential references and preserves trunk overrides', () => {
  const changes = accountChanges('SIP_ACCOUNT01');
  const patch = mergeSelectionPatches({}, changes);
  expect(patch).toEqual({ channels: { sip: { sip: {
    user: { source: 'store', provider: 'default', id: 'SIP_ACCOUNT01_USER' },
    password: { source: 'store', provider: 'default', id: 'SIP_ACCOUNT01_PASSWORD' },
  } } } });
  expect(accountSelection(patch, setting)).toBe('SIP_ACCOUNT01');
  expect(() => accountChanges('../secret')).toThrow('Invalid SIP account');
  expect(accountSelection({ channels: { sip: { sip: { user: 'old', password: 'old' } } } }, setting)).toBe('');
});
