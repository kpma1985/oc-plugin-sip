export function sipAccounts(entries) {
  if (!Array.isArray(entries)) return [];
  const inventory = new Map(entries.map(entry => [entry.name, entry]));
  return entries.filter(entry => /^SIP_ACCOUNT[0-9]{2}_LABEL$/.test(entry.name) && entry.kind === 'env')
    .flatMap(entry => {
      const prefix = entry.name.slice(0, -6);
      if (inventory.get(`${prefix}_USER`)?.kind !== 'secret' || inventory.get(`${prefix}_PASSWORD`)?.kind !== 'secret') return [];
      return [{ id: prefix, label: String(entry.value ?? '').slice(0, 120) || prefix }];
    }).sort((left, right) => left.id.localeCompare(right.id));
}

export function accountSelection(config, read) {
  const user = read(config, ['sip', 'user']);
  const password = read(config, ['sip', 'password']);
  if (user?.source !== 'store' || password?.source !== 'store' ||
    user.provider !== 'default' || password.provider !== 'default') return '';
  const match = /^SIP_ACCOUNT([0-9]{2})_USER$/.exec(user.id);
  const prefix = match ? `SIP_ACCOUNT${match[1]}` : '';
  return prefix && password.id === `${prefix}_PASSWORD` ? prefix : '';
}

export function accountChanges(id) {
  if (!/^SIP_ACCOUNT[0-9]{2}$/.test(id)) throw Error('Invalid SIP account');
  return ['user', 'password'].map(field => [['sip', field], {
    source: 'store', provider: 'default', id: `${id}_${field.toUpperCase()}`,
  }]);
}
