/* ═══════════════════════════════════════════════════════
   auth.js — Supabase Auth + Device Binding para Gymdex
   Injeta tela de login sem modificar index.html
   ═══════════════════════════════════════════════════════ */

const SUPA_URL  = 'https://eeziykwrefpzxajmykxy.supabase.co';
const SUPA_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVleml5a3dyZWZwenhham15a3h5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MzMzODksImV4cCI6MjA5NDEwOTM4OX0.qX9DsRTj6-HZxJb4UouP-NqLUce3jyhTYzfC-GXifmk';

/* ── Device ID único e permanente ── */
function getDeviceId() {
  let id = localStorage.getItem('gx_did');
  if (!id) {
    id = 'dev_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
    localStorage.setItem('gx_did', id);
  }
  return id;
}

/* ── Supabase fetch helper ── */
async function sbFetch(path, opts = {}) {
  const res = await fetch(SUPA_URL + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPA_KEY,
      'Authorization': 'Bearer ' + (AUTH.token || SUPA_KEY),
      ...(opts.headers || {})
    }
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

/* ── Estado de autenticação ── */
const AUTH = {
  token:   localStorage.getItem('gx_token')   || null,
  refresh: localStorage.getItem('gx_refresh') || null,
  user:    JSON.parse(localStorage.getItem('gx_user') || 'null'),
};

function authSave(token, refresh, user) {
  AUTH.token = token; AUTH.refresh = refresh; AUTH.user = user;
  localStorage.setItem('gx_token',   token);
  localStorage.setItem('gx_refresh', refresh);
  localStorage.setItem('gx_user',    JSON.stringify(user));
}

function authClear() {
  AUTH.token = AUTH.refresh = AUTH.user = null;
  ['gx_token','gx_refresh','gx_user'].forEach(k => localStorage.removeItem(k));
}

/* ── Refresh token automático ── */
async function refreshSession() {
  if (!AUTH.refresh) return false;
  const r = await sbFetch('/auth/v1/token?grant_type=refresh_token', {
    method: 'POST',
    body: JSON.stringify({ refresh_token: AUTH.refresh })
  });
  if (r.ok && r.data.access_token) {
    authSave(r.data.access_token, r.data.refresh_token, r.data.user);
    return true;
  }
  authClear();
  return false;
}

/* ── Verifica device binding ── */
async function checkDevice(userId) {
  const did = getDeviceId();

  // Busca o device registrado para esse usuário
  const r = await sbFetch(
    `/rest/v1/devices?user_id=eq.${userId}&select=device_id`,
    { method: 'GET' }
  );

  if (!r.ok) return { allowed: false, reason: 'Erro ao verificar dispositivo.' };

  const devices = r.data;

  // Nenhum device registrado ainda — registra este
  if (!devices || devices.length === 0) {
    const ins = await sbFetch('/rest/v1/devices', {
      method: 'POST',
      headers: { 'Prefer': 'return=minimal' },
      body: JSON.stringify({ user_id: userId, device_id: did })
    });
    return { allowed: ins.ok, reason: ins.ok ? null : 'Erro ao registrar dispositivo.' };
  }

  // Device já registrado — verifica se é o mesmo
  const registered = devices[0].device_id;
  if (registered === did) return { allowed: true };

  return {
    allowed: false,
    reason: '🔒 Esta conta já está vinculada a outro dispositivo.\n\nCompartilhar login não é permitido. Entre em contato com o suporte.'
  };
}

/* ── Login ── */
async function doLogin(email, password) {
  const r = await sbFetch('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  });

  if (!r.ok) {
    const msg = r.data?.error_description || r.data?.msg || '';
    if (msg.includes('Invalid login')) return { ok: false, error: 'Email ou senha incorretos.' };
    if (msg.includes('Email not confirmed')) return { ok: false, error: 'Confirme seu email antes de entrar.' };
    return { ok: false, error: 'Erro ao entrar. Tente novamente.' };
  }

  const { access_token, refresh_token, user } = r.data;

  // Verifica device binding
  const dev = await checkDevice(user.id);
  if (!dev.allowed) {
    // Faz logout imediato no Supabase
    await sbFetch('/auth/v1/logout', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + access_token }
    });
    return { ok: false, error: dev.reason };
  }

  authSave(access_token, refresh_token, user);
  return { ok: true };
}

/* ── Logout ── */
async function doLogout() {
  if (AUTH.token) {
    await sbFetch('/auth/v1/logout', { method: 'POST' }).catch(() => {});
  }
  authClear();
  showLoginScreen();
}

/* ══════════════════════════════════════
   UI — Tela de Login
══════════════════════════════════════ */
const LOGIN_CSS = `
#login-screen{
  position:fixed;inset:0;background:var(--bg0);z-index:9999;
  display:none;flex-direction:column;align-items:center;
  justify-content:center;padding:32px 24px;
  font-family:'DM Sans',sans-serif;
}
#login-screen.open{display:flex;}
.ls-logo{width:72px;height:72px;border-radius:20px;margin-bottom:28px;object-fit:contain}
.ls-title{font:800 26px/1.2 'Syne',sans-serif;color:var(--t1);margin-bottom:6px;text-align:center}
.ls-sub{font-size:14px;color:var(--t3);margin-bottom:36px;text-align:center}
.ls-field{width:100%;max-width:340px;background:var(--bg2);border:.5px solid var(--bd);
  border-radius:12px;padding:14px 16px;color:var(--t1);font-size:16px;
  outline:none;-webkit-appearance:none;font-family:'DM Sans',sans-serif;
  margin-bottom:12px;display:block}
.ls-field:focus{border-color:var(--acc)}
.ls-field::placeholder{color:var(--t3)}
.ls-btn{width:100%;max-width:340px;padding:15px;background:var(--acc);color:#fff;
  border:none;border-radius:12px;font:600 16px 'DM Sans',sans-serif;
  cursor:pointer;margin-top:4px;transition:opacity .15s}
.ls-btn:active{opacity:.8}
.ls-btn:disabled{opacity:.5;cursor:not-allowed}
.ls-err{width:100%;max-width:340px;background:rgba(239,68,68,.12);border:.5px solid rgba(239,68,68,.3);
  border-radius:10px;padding:12px 14px;font-size:13px;color:#f87171;
  margin-top:12px;line-height:1.5;text-align:center;display:none;white-space:pre-line}
.ls-err.show{display:block}
.ls-spinner{width:20px;height:20px;border:2.5px solid rgba(255,255,255,.3);
  border-top-color:#fff;border-radius:50%;animation:spin .7s linear infinite;
  display:inline-block;vertical-align:middle;margin-right:8px}
@keyframes spin{to{transform:rotate(360deg)}}
`;

function injectLoginCSS() {
  const s = document.createElement('style');
  s.textContent = LOGIN_CSS;
  document.head.appendChild(s);
}

function buildLoginScreen() {
  const div = document.createElement('div');
  div.id = 'login-screen';
  div.innerHTML = `
    <img class="ls-logo" src="icon-192.png" alt="Gymdex">
    <div class="ls-title">Gymdex</div>
    <div class="ls-sub">Entre para continuar</div>
    <input class="ls-field" id="ls-email"    type="email"    placeholder="Email"    autocomplete="email"            inputmode="email">
    <input class="ls-field" id="ls-password" type="password" placeholder="Senha"   autocomplete="current-password">
    <button class="ls-btn" id="ls-submit" onclick="handleLogin()">Entrar</button>
    <div class="ls-err" id="ls-err"></div>
  `;
  document.body.appendChild(div);

  // Enter key submits
  div.querySelectorAll('.ls-field').forEach(f => {
    f.addEventListener('keydown', e => { if (e.key === 'Enter') handleLogin(); });
  });
}

function showLoginScreen() {
  // Esconde tudo do app
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.querySelector('.nav')?.style.setProperty('display','none');
  document.querySelector('.hdr')?.style.setProperty('display','none');
  document.getElementById('login-screen').classList.add('open');
  setTimeout(() => document.getElementById('ls-email')?.focus(), 300);
}

function hideLoginScreen() {
  document.getElementById('login-screen').classList.remove('open');
  document.querySelector('.nav')?.style.removeProperty('display');
  document.querySelector('.hdr')?.style.removeProperty('display');
}

async function handleLogin() {
  const email    = document.getElementById('ls-email').value.trim();
  const password = document.getElementById('ls-password').value;
  const btn      = document.getElementById('ls-submit');
  const err      = document.getElementById('ls-err');

  if (!email || !password) {
    showErr('Preencha email e senha.'); return;
  }

  // Loading state
  btn.disabled = true;
  btn.innerHTML = '<span class="ls-spinner"></span>Entrando...';
  err.classList.remove('show');

  const res = await doLogin(email, password);

  btn.disabled = false;
  btn.innerHTML = 'Entrar';

  if (!res.ok) { showErr(res.error); return; }

  // Sucesso
  hideLoginScreen();
  initApp();
}

function showErr(msg) {
  const el = document.getElementById('ls-err');
  el.textContent = msg;
  el.classList.add('show');
}

/* ══════════════════════════════════════
   MENU — botão de perfil/logout na settings
══════════════════════════════════════ */
function injectUserMenu() {
  // Substitui o ícone ⚙️ do header para abrir menu com logout
  // Adiciona card de usuário logado nas settings
  const origOpenSettings = window.openSettings;
  window.openSettings = function() {
    origOpenSettings?.call(this);
    // Atualiza com dados do usuário logado
    const email = AUTH.user?.email || '';
    const nome  = window.G?.profile?.nome || email.split('@')[0] || 'Usuário';
    const el    = document.getElementById('settings-name');
    if (el) el.textContent = nome;
    const uel = document.getElementById('settings-username');
    if (uel) uel.textContent = email;
    injectLogoutBtn();
  };
}

function injectLogoutBtn() {
  if (document.getElementById('logout-btn')) return;
  const sheet = document.querySelector('#modal-settings .sheet');
  if (!sheet) return;

  const btn = document.createElement('div');
  btn.style.cssText = 'margin:0 16px 20px;';
  btn.innerHTML = `
    <button id="logout-btn" onclick="doLogout()" style="
      width:100%;padding:14px;background:rgba(239,68,68,.1);
      color:#f87171;border:.5px solid rgba(239,68,68,.25);
      border-radius:12px;font:600 15px 'DM Sans',sans-serif;cursor:pointer;
    ">Sair da conta</button>
  `;
  sheet.appendChild(btn);
}

/* ══════════════════════════════════════
   INIT APP após login bem-sucedido
══════════════════════════════════════ */
function initApp() {
  if (window.applyTheme)    window.applyTheme();
  if (window.renderTreinos) window.renderTreinos();
  if (window.gotoTab)       window.gotoTab('treinos');
}

/* ══════════════════════════════════════
   SETUP DA TABELA devices no Supabase
   (instruções no console para o dev)
══════════════════════════════════════ */
function printSetupInstructions() {
  console.log(`
%c[Gymdex Auth] Setup necessário no Supabase:
Execute este SQL no Supabase → SQL Editor:

CREATE TABLE IF NOT EXISTS devices (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_id  TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Permite apenas o próprio usuário ver/inserir seu device
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_own_device" ON devices
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
`, 'color:#3d6bff;font-weight:bold;font-size:13px');
}

/* ══════════════════════════════════════
   BOOT
══════════════════════════════════════ */
(async function boot() {
  injectLoginCSS();
  buildLoginScreen();
  printSetupInstructions();

  // Tenta usar sessão existente
  if (AUTH.token && AUTH.user) {
    // Tenta refresh para garantir token válido
    const valid = await refreshSession();
    if (valid) {
      // Verifica device mesmo com sessão existente
      const dev = await checkDevice(AUTH.user.id);
      if (dev.allowed) {
        injectUserMenu();
        return; // app já inicializado pelo index.html
      } else {
        authClear();
        showLoginScreen();
        setTimeout(() => showErr(dev.reason), 500);
        return;
      }
    }
  }

  // Sem sessão válida — mostra login
  showLoginScreen();
  injectUserMenu();
})();

