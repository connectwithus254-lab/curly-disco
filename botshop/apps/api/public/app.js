/* BotShop seller panel — dependency-free SPA.
   Security notes: all API calls are same-origin and carry the double-submit CSRF token;
   everything rendered from API data goes through textContent, never innerHTML. */
'use strict';

const state = { me: null, shops: [], bots: [], step: 1, dashboard: null };

/* ------------------------------------------------------------------ helpers */

function cookie(name) {
  return document.cookie
    .split(';')
    .map((c) => c.trim())
    .filter((c) => c.startsWith(name + '='))
    .map((c) => decodeURIComponent(c.slice(name.length + 1)))[0];
}

async function api(method, path, body) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  const csrf = cookie('bs_csrf');
  if (csrf) headers['x-csrf-token'] = csrf;
  const res = await fetch(path, {
    method,
    headers,
    credentials: 'same-origin',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const message = (data.error && data.error.message) || res.statusText;
    const problems = data.error && data.error.details && data.error.details.problems;
    throw new Error(problems ? `${message}: ${problems.join('; ')}` : message);
  }
  return data;
}

function toast(message, kind) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = 'toast ' + (kind || '');
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (el.hidden = true), 4200);
}

function show(view) {
  document.querySelectorAll('.view').forEach((el) => el.classList.toggle('active', el.id === 'view-' + view));
  document.querySelectorAll('.nav-btn[data-view]').forEach((el) => el.classList.toggle('active', el.dataset.view === view));
  if (view === 'dashboard') refreshDashboard();
  if (view === 'preview') refreshOutbox();
  if (view === 'customers') refreshCustomers();
}

function table(container, columns, rows) {
  container.textContent = '';
  if (!rows || rows.length === 0) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = 'Nothing yet.';
    container.append(p);
    return;
  }
  const t = document.createElement('table');
  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  columns.forEach((c) => {
    const th = document.createElement('th');
    th.textContent = c;
    hr.append(th);
  });
  thead.append(hr);
  const tbody = document.createElement('tbody');
  rows.forEach((row) => {
    const tr = document.createElement('tr');
    columns.forEach((c) => {
      const td = document.createElement('td');
      const value = row[c];
      td.textContent = value === null || value === undefined ? '—' : String(value);
      tr.append(td);
    });
    tbody.append(tr);
  });
  t.append(thead, tbody);
  container.append(t);
}

function badge(text, kind) {
  const s = document.createElement('span');
  s.className = 'badge ' + (kind || '');
  s.textContent = text;
  return s;
}

/* --------------------------------------------------------------------- auth */

async function boot() {
  try {
    const meta = await fetch('/api/v1/meta').then((r) => r.json());
    document.getElementById('meta-line').textContent =
      `seller panel · ${meta.milestone} · telegram: ${meta.telegramMode}`;
  } catch {
    /* meta is cosmetic */
  }
  try {
    const me = await api('GET', '/api/v1/auth/me');
    state.me = me;
    await afterLogin();
  } catch {
    show('login');
  }
}

async function afterLogin() {
  document.getElementById('logout').hidden = false;
  const { shops } = await api('GET', '/api/v1/shops');
  state.shops = shops;
  const { bots } = await api('GET', '/api/v1/bots');
  state.bots = bots;
  state.step = shops.length > 0 ? Math.min(shops[0].onboardingStep || 1, 6) : 1;
  if (shops.length === 0) {
    show('wizard');
    renderWizard();
    return;
  }
  renderShopSummary();
  renderBotSummary();
  show('dashboard');
}

document.getElementById('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  try {
    await api('POST', '/api/v1/auth/login', {
      email: form.get('email'),
      password: form.get('password'),
      ...(form.get('workspace') ? { workspace: form.get('workspace') } : {}),
    });
    state.me = await api('GET', '/api/v1/auth/me');
    toast('Signed in', 'ok');
    await afterLogin();
  } catch (error) {
    toast(error.message, 'error');
  }
});

document.getElementById('signup-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  try {
    await api('POST', '/api/v1/auth/signup', {
      workspaceName: form.get('workspaceName'),
      fullName: form.get('fullName'),
      email: form.get('email'),
      password: form.get('password'),
    });
    state.me = await api('GET', '/api/v1/auth/me');
    toast('Workspace created', 'ok');
    await afterLogin();
  } catch (error) {
    toast(error.message, 'error');
  }
});

document.getElementById('logout').addEventListener('click', async () => {
  await api('POST', '/api/v1/auth/logout');
  location.reload();
});

document.querySelectorAll('.nav-btn[data-view]').forEach((btn) =>
  btn.addEventListener('click', () => show(btn.dataset.view)),
);

/* ---------------------------------------------------------------- dashboard */

function renderShopSummary() {
  const shop = state.shops[0];
  const box = document.getElementById('shop-summary');
  box.textContent = '';
  if (!shop) {
    box.append(badge('no shop yet', 'warn'));
    return;
  }
  const lines = [
    ['Name', shop.name],
    ['Category', shop.category || '—'],
    ['Currency', shop.currency],
    ['Languages', (shop.supportedLocales || []).join(', ')],
    ['Timezone', shop.timezone],
    ['Support hours', shop.supportHours || '—'],
  ];
  lines.forEach(([label, value]) => {
    const row = document.createElement('div');
    row.className = 'row';
    const l = document.createElement('span');
    l.className = 'muted';
    l.textContent = label + ':';
    const v = document.createElement('strong');
    v.textContent = value;
    row.append(l, v);
    box.append(row);
  });
  const status = document.createElement('div');
  status.append(badge(shop.status, shop.status === 'active' ? 'ok' : 'warn'));
  box.append(status);
}

function renderBotSummary() {
  const bot = state.bots.find((b) => b.status !== 'revoked');
  const box = document.getElementById('bot-summary');
  box.textContent = '';
  if (!bot) {
    box.append(badge('no bot connected', 'warn'));
    const hint = document.createElement('p');
    hint.className = 'muted';
    hint.textContent = 'Open the setup wizard, step 4, to connect your Telegram bot.';
    box.append(hint);
    return;
  }
  const rows = [
    ['Username', bot.username ? '@' + bot.username : '—'],
    ['Mode', bot.mode],
    ['Token', bot.tokenLast4],
    ['Webhook', bot.webhookUrl || '—'],
    ['Last error', bot.lastError || '—'],
  ];
  rows.forEach(([label, value]) => {
    const row = document.createElement('div');
    row.className = 'row';
    const l = document.createElement('span');
    l.className = 'muted';
    l.textContent = label + ':';
    const v = document.createElement('strong');
    v.textContent = value;
    row.append(l, v);
    box.append(row);
  });
  box.append(badge(bot.status, bot.status === 'active' ? 'ok' : bot.status === 'error' ? 'bad' : 'warn'));
}

async function refreshDashboard() {
  if (state.shops.length === 0) return;
  try {
    const data = await api('GET', '/api/v1/dashboard');
    state.dashboard = data;
    const metrics = document.getElementById('metrics');
    metrics.textContent = '';
    [
      ['Customers', data.customers],
      ['Updates (24h)', data.updates24h],
      ['Replies sent (24h)', data.sent24h],
      ['Failed updates', data.failedUpdates],
      ['Failed sends', data.failedSends],
    ].forEach(([label, value]) => {
      const cell = document.createElement('div');
      cell.className = 'metric';
      const v = document.createElement('div');
      v.className = 'value';
      v.textContent = String(value);
      const l = document.createElement('div');
      l.className = 'label';
      l.textContent = label;
      cell.append(v, l);
      metrics.append(cell);
    });
    table(
      document.getElementById('recent-updates'),
      ['update_id', 'status', 'received_at'],
      data.recentUpdates.map((r) => ({ update_id: r.update_id, status: r.status, received_at: new Date(r.received_at).toLocaleTimeString() })),
    );
    table(
      document.getElementById('recent-audit'),
      ['action', 'entity_type', 'when'],
      data.recentAudit.map((r) => ({ action: r.action, entity_type: r.entity_type, when: new Date(r.created_at).toLocaleTimeString() })),
    );
  } catch (error) {
    toast(error.message, 'error');
  }
}

document.getElementById('bot-check').addEventListener('click', async () => {
  const bot = state.bots.find((b) => b.status !== 'revoked');
  if (!bot) return toast('No bot connected yet', 'error');
  const result = await api('POST', `/api/v1/bots/${bot.id}/check`);
  toast(result.healthy ? 'Bot is healthy' : 'Bot problem: ' + result.error, result.healthy ? 'ok' : 'error');
  state.bots = (await api('GET', '/api/v1/bots')).bots;
  renderBotSummary();
});

/* ------------------------------------------------------------------- wizard */

function renderWizard() {
  const steps = ['Identity', 'Languages', 'Policies', 'Bot', 'Preview', 'Launch'];
  const box = document.getElementById('wizard-steps');
  box.textContent = '';
  steps.forEach((label, index) => {
    const el = document.createElement('span');
    el.className = 'step' + (index + 1 === state.step ? ' active' : index + 1 < state.step ? ' done' : '');
    el.textContent = `${index + 1}. ${label}`;
    box.append(el);
  });
  document.querySelectorAll('#wizard-form fieldset').forEach((fs) => {
    fs.hidden = Number(fs.dataset.step) !== state.step;
  });
  document.getElementById('wizard-next').hidden = state.step >= 6;
  document.getElementById('wizard-launch').hidden = state.step !== 6;
  if (state.step === 4) document.getElementById('demo-token-hint').textContent = demoTokenHint();
  if (state.step === 3 && state.shops[0]) fillForm(state.shops[0]);
  if (state.step === 2 && state.shops[0]) {
    const shop = state.shops[0];
    const form = document.getElementById('wizard-form');
    form.defaultLocale.value = shop.defaultLocale || 'en';
    (shop.supportedLocales || ['en']).forEach((code) => {
      const box = form['locale_' + code];
      if (box) box.checked = true;
    });
  }
}

function fillForm(shop) {
  const form = document.getElementById('wizard-form');
  const map = {
    name: shop.name,
    category: shop.category,
    currency: shop.currency,
    country: shop.country,
    timezone: shop.timezone,
    contactEmail: shop.contactEmail,
    contactPhone: shop.contactPhone,
    description: shop.description,
    rulesMd: shop.rulesMd,
    refundPolicyMd: shop.refundPolicyMd,
    deliveryPolicyMd: shop.deliveryPolicyMd,
    supportHours: shop.supportHours,
    supportChatId: shop.supportChatId,
  };
  Object.entries(map).forEach(([key, value]) => {
    if (form[key] && value) form[key].value = value;
  });
}

function demoTokenHint() {
  const meta = document.querySelector('#meta-line').textContent;
  return meta.includes('fake')
    ? 'Demo mode is on (TELEGRAM_MODE=fake): the token is not sent to Telegram, so any token shaped like 123456789:AAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa works. Real mode uses the actual token.'
    : 'Live mode: paste the real token from @BotFather.';
}

document.getElementById('wizard-back').addEventListener('click', () => {
  state.step = Math.max(1, state.step - 1);
  renderWizard();
});

document.getElementById('wizard-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  try {
    if (state.step === 1) {
      const payload = {
        name: form.name.value,
        description: form.description.value || null,
        category: form.category.value || null,
        country: form.country.value ? form.country.value.toUpperCase() : null,
        currency: form.currency.value ? form.currency.value.toUpperCase() : undefined,
        timezone: form.timezone.value || undefined,
        contactEmail: form.contactEmail.value || null,
        contactPhone: form.contactPhone.value || null,
      };
      if (state.shops.length === 0) {
        const created = await api('POST', '/api/v1/shops', {
          name: payload.name,
          ...(payload.category ? { category: payload.category } : {}),
          ...(payload.country ? { country: payload.country } : {}),
          ...(payload.currency ? { currency: payload.currency } : {}),
          ...(payload.timezone ? { timezone: payload.timezone } : {}),
          ...(payload.contactEmail ? { contactEmail: payload.contactEmail } : {}),
          ...(payload.contactPhone ? { contactPhone: payload.contactPhone } : {}),
        });
        state.shops = [created.shop];
      }
      await api('PATCH', `/api/v1/shops/${state.shops[0].id}`, payload);
    } else if (state.step === 2) {
      const supported = ['en', 'sw', 'ru'].filter((code) => form['locale_' + code].checked);
      await api('PATCH', `/api/v1/shops/${state.shops[0].id}`, {
        defaultLocale: form.defaultLocale.value,
        supportedLocales: supported.length > 0 ? supported : ['en'],
      });
    } else if (state.step === 3) {
      await api('PATCH', `/api/v1/shops/${state.shops[0].id}`, {
        rulesMd: form.rulesMd.value || null,
        refundPolicyMd: form.refundPolicyMd.value || null,
        deliveryPolicyMd: form.deliveryPolicyMd.value || null,
        supportHours: form.supportHours.value || null,
        supportChatId: form.supportChatId.value || null,
      });
    }
    state.shops = (await api('GET', '/api/v1/shops')).shops;
    state.step = Math.min(6, state.step + 1);
    renderWizard();
    if (state.step === 4) document.getElementById('demo-token-hint').textContent = demoTokenHint();
    toast('Saved', 'ok');
  } catch (error) {
    toast(error.message, 'error');
  }
});

document.getElementById('connect-bot').addEventListener('click', async () => {
  const form = document.getElementById('wizard-form');
  const box = document.getElementById('bot-result');
  box.textContent = 'Connecting…';
  try {
    const result = await api('POST', '/api/v1/bots/connect', {
      shopId: state.shops[0].id,
      token: form.botToken.value.trim(),
      mode: form.botMode.value,
    });
    state.bots = (await api('GET', '/api/v1/bots')).bots;
    box.textContent = '';
    const ok = document.createElement('div');
    ok.append(badge(result.bot.status, result.bot.status === 'active' ? 'ok' : 'bad'));
    const text = document.createElement('p');
    text.textContent =
      result.bot.status === 'active'
        ? `Connected as @${result.bot.username}. Open Telegram and send /start to it.`
        : `Telegram rejected the connection: ${result.bot.lastError}`;
    box.append(ok, text);
    toast('Bot connected', 'ok');
  } catch (error) {
    box.textContent = '';
    toast(error.message, 'error');
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = error.message;
    box.append(p);
  }
});

document.getElementById('wizard-launch').addEventListener('click', async () => {
  const box = document.getElementById('launch-result');
  try {
    const result = await api('POST', `/api/v1/shops/${state.shops[0].id}/launch`);
    state.shops = (await api('GET', '/api/v1/shops')).shops;
    box.textContent = '';
    const p = document.createElement('p');
    p.append(badge('shop active', 'ok'));
    const link = document.createElement('p');
    link.textContent = result.botUsername ? `Customers can now message https://t.me/${result.botUsername}` : 'Shop launched.';
    box.append(p, link);
    toast('Shop launched', 'ok');
    renderShopSummary();
    renderBotSummary();
  } catch (error) {
    toast(error.message, 'error');
  }
});

document.querySelectorAll('[data-preview]').forEach((btn) =>
  btn.addEventListener('click', async () => {
    const map = {
      main: null,
      language: 'm:lang',
      rules: 'rl:rules',
      support: 'su:support',
      help: 'm:help',
    };
    const shop = state.shops[0];
    if (!shop) return toast('Create a shop first', 'error');
    try {
      const body = { shopId: shop.id };
      if (map[btn.dataset.preview]) body.callbackData = map[btn.dataset.preview];
      const result = await api('POST', '/api/v1/preview/render', body);
      renderPhone(result.preview);
      const pre = document.getElementById('wizard-preview');
      if (pre) pre.textContent = result.preview.text;
    } catch (error) {
      toast(error.message, 'error');
    }
  }),
);

function renderPhone(preview) {
  document.getElementById('phone-text').textContent = preview.text;
  const buttons = document.getElementById('phone-buttons');
  buttons.textContent = '';
  preview.keyboard.forEach((row) => {
    row.forEach((btn) => {
      const el = document.createElement('button');
      el.textContent = btn.text;
      if (btn.callbackData) {
        el.addEventListener('click', () => simulate(null, btn.callbackData));
      }
      buttons.append(el);
    });
  });
}

async function simulate(text, callbackData) {
  const shop = state.shops[0];
  if (!shop) return;
  try {
    const body = { shopId: shop.id };
    if (text) body.text = text;
    if (callbackData) body.callbackData = callbackData;
    const result = await api('POST', '/api/v1/preview/simulate', body);
    document.getElementById('sim-out').textContent = JSON.stringify(result, null, 2);
    document.getElementById('sim-text').value = text || result.effects.map((e) => e.kind).join(', ');
    const sendEffect = result.effects.find((e) => e.kind === 'send' || e.kind === 'edit');
    if (sendEffect) renderPhone({ text: sendEffect.text, keyboard: keyboardFrom(sendEffect) });
  } catch (error) {
    toast(error.message, 'error');
  }
}

function keyboardFrom(effect) {
  const rows = (effect.reply_markup && effect.reply_markup.inline_keyboard) || [];
  return rows.map((row) => row.map((b) => ({ text: b.text, callbackData: b.callback_data || null })));
}

document.getElementById('sim-send').addEventListener('click', () => {
  const value = document.getElementById('sim-text').value;
  if (value.startsWith('m:') || value.startsWith('l:') || value.startsWith('rl:') || value.startsWith('su:')) simulate(null, value);
  else simulate(value);
});

document.querySelectorAll('[data-sim]').forEach((btn) =>
  btn.addEventListener('click', () => {
    const value = btn.dataset.sim;
    if (value.includes(':')) simulate(null, value);
    else simulate(value);
  }),
);

async function refreshOutbox() {
  const bot = state.bots.find((b) => b.status !== 'revoked');
  if (!bot) return;
  try {
    const result = await api('GET', `/api/v1/preview/outbox?botId=${bot.id}`);
    document.getElementById('outbox').textContent =
      result.mode === 'fake'
        ? (result.calls || []).map((c) => `${c.at}  ${c.method}  ${JSON.stringify(c.params).slice(0, 160)}`).join('\n') || 'No calls yet.'
        : 'Live mode: calls are sent to Telegram (see the audit log for a record).';
  } catch (error) {
    document.getElementById('outbox').textContent = error.message;
  }
}

/* ---------------------------------------------------------------- customers */

async function refreshCustomers() {
  try {
    const { customers } = await api('GET', '/api/v1/customers');
    table(
      document.getElementById('customers-table'),
      ['telegram_user_id', 'username', 'first_name', 'locale', 'last_seen_at'],
      customers.map((c) => ({
        telegram_user_id: c.telegram_user_id,
        username: c.username ? '@' + c.username : '—',
        first_name: c.first_name,
        locale: c.locale || '—',
        last_seen_at: new Date(c.last_seen_at).toLocaleString(),
      })),
    );
  } catch (error) {
    toast(error.message, 'error');
  }
}

boot();
