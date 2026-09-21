/* BotShop seller panel — dependency-free SPA.
   Security notes: all API calls are same-origin and carry the double-submit CSRF token;
   everything rendered from API data goes through textContent, never innerHTML. */
'use strict';

const state = { me: null, shops: [], bots: [], step: 1, dashboard: null, sessionToken: null, sessionMode: null };

/* Session transport.
   Cookies are the preferred (httpOnly) transport, but browsers refuse to store them when the
   panel runs inside a cross-site frame — exactly what happens in an embedded preview — so the
   API also returns a session token we can send as `Authorization: Bearer`. Whichever works is
   used; the active one is shown in the header so this is never a mystery again. */
const TOKEN_KEY = 'bs_session_token';

function loadToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function saveToken(token) {
  state.sessionToken = token || null;
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable (private mode) — the in-memory copy still works for this page */
  }
}

function setSessionMode(mode) {
  state.sessionMode = mode;
  const el = document.getElementById('meta-line');
  if (!el) return;
  const label = { cookie: 'cookie', token: 'token', 'cookie+token': 'cookie + token', none: 'not signed in' }[mode] || mode;
  el.textContent = `${el.dataset.meta || 'seller panel'} · session: ${label}`;
}

/** Does the browser actually keep and return our session cookie? (Probed without any bearer header.) */
async function cookieSessionWorks() {
  try {
    const res = await fetch('/api/v1/auth/me', { credentials: 'same-origin' });
    return res.ok;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ helpers */

function cookie(name) {
  return document.cookie
    .split(';')
    .map((c) => c.trim())
    .filter((c) => c.startsWith(name + '='))
    .map((c) => decodeURIComponent(c.slice(name.length + 1)))[0];
}

async function api(method, path, body, retried) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  const csrf = cookie('bs_csrf');
  if (csrf) headers['x-csrf-token'] = csrf;
  const token = state.sessionToken || loadToken();
  if (token) headers['authorization'] = `Bearer ${token}`;
  const res = await fetch(path, {
    method,
    headers,
    credentials: 'same-origin',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const error = data.error || {};
    // A stale/missing security token (e.g. the preview iframe dropped the cookie, or the page was
    // left open across a restart) is recoverable: refresh it once and replay the request.
    if (res.status === 403 && error.code === 'csrf_failed' && !retried) {
      try {
        await fetch('/api/v1/meta', { credentials: 'same-origin' });
      } catch {
        /* ignore */
      }
      return api(method, path, body, true);
    }
    const details = error.details || {};
    const issues = Array.isArray(details.issues) ? details.issues : [];
    const problems = Array.isArray(details.problems) ? details.problems : [];
    const parts = [
      ...issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)),
      ...problems,
    ];
    const message = parts.length > 0 ? `${error.message} — ${parts.join('; ')}` : error.message || res.statusText;
    const failure = new Error(message);
    failure.code = error.code;
    failure.issues = issues;
    failure.problems = problems;
    throw failure;
  }
  return data;
}

/** The wizard and every shop-scoped action needs a saved shop; never crash, always explain. */
function requireShop() {
  const shop = state.shops[0];
  if (shop) return shop;
  toast('No shop yet — fill in step 1 and press “Save & continue” first.', 'error');
  state.step = 1;
  show('wizard');
  renderWizard();
  return null;
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

function showWizardError(error) {
  const banner = document.getElementById('wizard-error');
  document.querySelectorAll('#wizard-form .invalid').forEach((el) => el.classList.remove('invalid'));
  if (!error) {
    banner.hidden = true;
    banner.textContent = '';
    return;
  }
  banner.textContent = '';
  const title = document.createElement('strong');
  title.textContent = 'Could not save: ';
  banner.append(title, document.createTextNode(error.message || String(error)));

  const issues = error.issues || [];
  if (issues.length > 0) {
    const list = document.createElement('ul');
    issues.forEach((issue) => {
      const li = document.createElement('li');
      li.textContent = issue.path ? `${issue.path}: ${issue.message}` : issue.message;
      list.append(li);
      const field = issue.path && document.querySelector(`#wizard-form [name="${issue.path}"]`);
      if (field) field.classList.add('invalid');
    });
    banner.append(list);
  }
  banner.hidden = false;
  banner.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function badge(text, kind) {
  const s = document.createElement('span');
  s.className = 'badge ' + (kind || '');
  s.textContent = text;
  return s;
}

/* --------------------------------------------------------------------- auth */

async function boot() {
  state.sessionToken = loadToken();
  try {
    const meta = await fetch('/api/v1/meta', { credentials: 'same-origin' }).then((r) => r.json());
    const el = document.getElementById('meta-line');
    el.dataset.meta = `seller panel · ${meta.milestone} · telegram: ${meta.telegramMode}`;
    el.textContent = el.dataset.meta;
  } catch {
    /* meta is cosmetic */
  }
  try {
    const me = await api('GET', '/api/v1/auth/me');
    state.me = me;
    setSessionMode((await cookieSessionWorks()) ? 'cookie' : state.sessionToken ? 'token' : 'cookie');
    await afterLogin();
  } catch {
    if (state.sessionToken) {
      // The stored token is stale (server restarted with a fresh database, or it expired).
      saveToken(null);
    }
    setSessionMode(cookie('bs_session') ? 'cookie' : 'none');
    show('login');
  }
}

async function afterLogin() {
  document.getElementById('logout').hidden = false;
  const { shops } = await api('GET', '/api/v1/shops');
  state.shops = shops;
  const { bots } = await api('GET', '/api/v1/bots');
  state.bots = bots;
  const shop = shops[0];
  state.step = shop ? Math.min(shop.onboardingStep || 1, 6) : 1;
  renderShopSummary();
  renderBotSummary();
  if (!shop || !shop.onboardingCompletedAt) {
    // Still being set up (or not created yet): land in the wizard, at the step they left off.
    show('wizard');
    renderWizard();
    return;
  }
  show('dashboard');
}

document.getElementById('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  try {
    const result = await api('POST', '/api/v1/auth/login', {
      email: form.get('email'),
      password: form.get('password'),
      ...(form.get('workspace') ? { workspace: form.get('workspace') } : {}),
    });
    await adoptSession(result);
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
    const result = await api('POST', '/api/v1/auth/signup', {
      workspaceName: form.get('workspaceName'),
      fullName: form.get('fullName'),
      email: form.get('email'),
      password: form.get('password'),
    });
    await adoptSession(result);
    toast('Workspace created', 'ok');
    await afterLogin();
  } catch (error) {
    toast(error.message, 'error');
  }
});

document.getElementById('logout').addEventListener('click', async () => {
  try {
    await api('POST', '/api/v1/auth/logout');
  } catch {
    /* the session may already be gone */
  }
  saveToken(null);
  location.reload();
});

/**
 * After login/signup the server hands back a session token. If the browser also accepted the
 * cookie we can use it (more secure, httpOnly); if it did not — which is normal inside an
 * embedded preview — we keep the token and send it as a bearer header instead.
 */
async function adoptSession(result) {
  const token = result && result.sessionToken;
  if (!token) {
    setSessionMode('cookie');
    return;
  }
  // Keep the token in memory before probing, so a browser that dropped the cookie is not left
  // unauthenticated for even one request.
  state.sessionToken = token;
  const cookiesWork = await cookieSessionWorks();
  saveToken(cookiesWork ? null : token);
  setSessionMode(cookiesWork ? 'cookie' : 'token');
  if (!cookiesWork) {
    toast('This browser blocks cookies in embedded frames — using a token session instead.', 'ok');
  }
}

document.querySelectorAll('.nav-btn[data-view]').forEach((btn) =>
  btn.addEventListener('click', () => {
    if (btn.dataset.view === 'wizard') renderWizard();
    show(btn.dataset.view);
  }),
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
  if (state.shops.length === 0) {
    const metrics = document.getElementById('metrics');
    if (metrics) {
      metrics.textContent = '';
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = 'No shop yet — open the setup wizard to create one.';
      metrics.append(p);
    }
    return;
  }
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

  // Prefill from the saved shop on every step, so revisiting a step never shows empty fields
  // (and re-saving can therefore never wipe data that was entered earlier).
  const shop = state.shops[0];
  if (shop) fillForm(shop);
  if (state.step === 2 && shop) {
    const form = document.getElementById('wizard-form');
    form.defaultLocale.value = shop.defaultLocale || 'en';
    ['en', 'sw', 'ru'].forEach((code) => {
      if (form['locale_' + code]) form['locale_' + code].checked = (shop.supportedLocales || ['en']).includes(code);
    });
  }
  if (state.step === 4) {
    document.getElementById('demo-token-hint').textContent = demoTokenHint();
    const hint = document.getElementById('bot-step-hint');
    hint.textContent = state.shops.length === 0
      ? 'No shop saved yet — press “Save & continue” on step 1 first, or just click Connect bot and we will save it for you.'
      : '';
    renderBotStep();
  }
}

/** Step 4: show whether a bot is already connected, and let the seller replace it. */
function renderBotStep() {
  const shop = state.shops[0];
  const box = document.getElementById('bot-result');
  box.textContent = '';
  if (!shop) return;
  const bot = state.bots.find((b) => b.shopId === shop.id && b.status !== 'revoked');
  if (!bot) return;

  const line = document.createElement('p');
  line.append(badge(bot.status, bot.status === 'active' ? 'ok' : bot.status === 'error' ? 'bad' : 'warn'));
  const detail = document.createElement('span');
  detail.textContent = `  ${bot.username ? '@' + bot.username : 'unnamed bot'} · ${bot.mode} · token ${bot.tokenLast4}`;
  line.append(detail);
  box.append(line);

  const actions = document.createElement('div');
  actions.className = 'row';
  const check = document.createElement('button');
  check.type = 'button';
  check.textContent = 'Run health check';
  check.addEventListener('click', () => runBotCheck(bot.id));
  const disconnect = document.createElement('button');
  disconnect.type = 'button';
  disconnect.textContent = 'Disconnect (to use a different bot)';
  disconnect.addEventListener('click', () => disconnectBot(bot.id));
  actions.append(check, disconnect);
  box.append(actions);
}

async function runBotCheck(botId) {
  const result = await api('POST', `/api/v1/bots/${botId}/check`);
  toast(result.healthy ? 'Bot is healthy' : 'Bot problem: ' + result.error, result.healthy ? 'ok' : 'error');
  state.bots = (await api('GET', '/api/v1/bots')).bots;
  renderBotStep();
  renderBotSummary();
}

async function disconnectBot(botId) {
  if (!confirm('Disconnect this bot? The shop stops answering until you connect one again.')) return;
  await api('DELETE', `/api/v1/bots/${botId}`);
  state.bots = (await api('GET', '/api/v1/bots')).bots;
  toast('Bot disconnected', 'ok');
  renderBotStep();
  renderBotSummary();
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

/** Saves the current wizard step. Returns true on success; shows exactly what failed otherwise. */
async function saveStep(step) {
  const form = document.getElementById('wizard-form');
  const values = Object.fromEntries(new FormData(form).entries());
  const text = (key) => (values[key] || '').toString().trim();
  // Empty inputs must be OMITTED (not sent as null/''), so the API keeps whatever is already stored.
  const orUndefined = (value) => (value ? value : undefined);

  try {
    if (step === 1) {
      const payload = {
        name: text('name'),
        description: orUndefined(text('description')),
        category: orUndefined(text('category')),
        country: orUndefined(text('country').toUpperCase()),
        currency: orUndefined(text('currency').toUpperCase()),
        timezone: orUndefined(text('timezone')),
        contactEmail: orUndefined(text('contactEmail')),
        contactPhone: orUndefined(text('contactPhone')),
        onboardingStep: 2,
      };
      if (!payload.name) {
        showWizardError({ message: 'Business name is required — it is what customers see in the bot.' });
        return false;
      }
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
      const patched = await api('PATCH', `/api/v1/shops/${state.shops[0].id}`, payload);
      state.shops = [patched.shop];
    } else if (step === 2) {
      const shop = requireShop();
      if (!shop) return false;
      const supported = ['en', 'sw', 'ru'].filter((code) => form['locale_' + code] && form['locale_' + code].checked);
      const patched = await api('PATCH', `/api/v1/shops/${shop.id}`, {
        defaultLocale: values.defaultLocale,
        supportedLocales: supported.length > 0 ? supported : ['en'],
        onboardingStep: 3,
      });
      state.shops = [patched.shop];
    } else if (step === 3) {
      const shop = requireShop();
      if (!shop) return false;
      const patched = await api('PATCH', `/api/v1/shops/${shop.id}`, {
        rulesMd: orUndefined(text('rulesMd')),
        refundPolicyMd: orUndefined(text('refundPolicyMd')),
        deliveryPolicyMd: orUndefined(text('deliveryPolicyMd')),
        supportHours: orUndefined(text('supportHours')),
        supportChatId: orUndefined(text('supportChatId')),
        onboardingStep: 4,
      });
      state.shops = [patched.shop];
    }
    state.shops = (await api('GET', '/api/v1/shops')).shops;
    showWizardError(null);
    return true;
  } catch (error) {
    showWizardError(error);
    toast(error.message, 'error');
    return false;
  }
}

document.getElementById('wizard-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (state.step >= 6) return; // the launch button handles step 6
  const saved = await saveStep(state.step);
  if (!saved) return;
  state.step = Math.min(6, state.step + 1);
  renderWizard();
  toast('Saved', 'ok');
});
document.getElementById('connect-bot').addEventListener('click', async () => {
  const form = document.getElementById('wizard-form');
  const box = document.getElementById('bot-result');
  const token = form.botToken.value.trim();

  // Recovery path: the seller may click Connect before step 1 was saved. Rather than sending them
  // back with an error, save step 1 with whatever is in the form and continue if it succeeds.
  let shop = state.shops[0];
  if (!shop) {
    box.textContent = 'No shop saved yet — saving step 1 first…';
    const saved = await saveStep(1);
    if (!saved) {
      box.textContent = '';
      return;
    }
    shop = state.shops[0];
    if (!shop) {
      box.textContent = '';
      toast('Could not create the shop — check step 1 and try again.', 'error');
      return;
    }
    // saveStep(1) records "step 2" as the furthest reached; put the seller's real position back.
    if (state.step > 2) {
      try {
        const restored = await api('PATCH', `/api/v1/shops/${shop.id}`, { onboardingStep: state.step });
        state.shops = [restored.shop];
      } catch {
        /* not fatal — the seller simply resumes at step 2 next time */
      }
    }
  }
  if (token.length < 20) {
    toast('Paste the full token from @BotFather (it looks like 123456789:AA…)', 'error');
    return;
  }
  box.textContent = 'Connecting…';
  try {
    const result = await api('POST', '/api/v1/bots/connect', {
      shopId: shop.id,
      token,
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
    form.botToken.value = '';
    toast('Bot connected', 'ok');
    renderBotStep();
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
  const shop = requireShop();
  if (!shop) return;
  try {
    const result = await api('POST', `/api/v1/shops/${shop.id}/launch`);
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
    const shop = requireShop();
    if (!shop) return;
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
  if (!shop) {
    toast('Create your shop first (setup wizard, step 1).', 'error');
    return;
  }
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
