/* ═══════════════════════════════════════════════════════
   gymdex-db.js  v2
   - IndexedDB (state + session stores)
   - Sessão de treino persistente (retoma se app fechar)
   - Notificações via Service Worker
   ═══════════════════════════════════════════════════════ */

const DB_NAME    = 'gymdex';
const DB_VERSION = 2;          // bump para criar o store "session"
const STORE_STATE   = 'state';
const STORE_SESSION = 'session';

/* ── Abre o banco ── */
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_STATE))
        db.createObjectStore(STORE_STATE,   { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE_SESSION))
        db.createObjectStore(STORE_SESSION, { keyPath: 'id' });
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

/* ── Helpers genéricos ── */
async function idbPut(store, obj) {
  try {
    const db = await openDB();
    return new Promise((res, rej) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(obj);
      tx.oncomplete = () => { db.close(); res(); };
      tx.onerror    = e => rej(e.target.error);
    });
  } catch(e) { console.warn('[IDB] put error', e); }
}

async function idbGet(store, key) {
  try {
    const db = await openDB();
    return new Promise((res, rej) => {
      const tx  = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).get(key);
      req.onsuccess = e => { db.close(); res(e.target.result || null); };
      req.onerror   = e => rej(e.target.error);
    });
  } catch(e) { return null; }
}

async function idbDelete(store, key) {
  try {
    const db = await openDB();
    return new Promise((res, rej) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).delete(key);
      tx.oncomplete = () => { db.close(); res(); };
      tx.onerror    = e => rej(e.target.error);
    });
  } catch(e) {}
}

/* ── STATE: salvar/carregar dados do app ── */
async function idbSave(data) {
  await idbPut(STORE_STATE, { id: 'gymdex', ...data });
  // fallback localStorage
  try { localStorage.setItem('gymdex_fb', JSON.stringify(data)); } catch(_) {}
}

async function idbLoad() {
  const d = await idbGet(STORE_STATE, 'gymdex');
  if (d) return d;
  // fallback localStorage
  try {
    const raw = localStorage.getItem('gymdex_fb');
    return raw ? JSON.parse(raw) : null;
  } catch(_) { return null; }
}

/* ── SESSION: salvar/carregar/limpar treino em andamento ── */
async function idbSaveSession(data) {
  await idbPut(STORE_SESSION, { id: 'active', ...data, ts: Date.now() });
}

async function idbLoadSession() {
  const s = await idbGet(STORE_SESSION, 'active');
  if (!s) return null;
  // Sessão expira após 4 horas (segurança)
  if (Date.now() - s.ts > 4 * 60 * 60 * 1000) {
    await idbDelete(STORE_SESSION, 'active');
    return null;
  }
  return s;
}

async function idbClearSession() {
  await idbDelete(STORE_SESSION, 'active');
}

/* ── Migração de localStorage antigo ── */
async function migrate() {
  const keys = ['gymdex', 'gymdex_v2', 'gx2'];
  for (const k of keys) {
    try {
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      const d = JSON.parse(raw);
      if (d && (d.treinos || d.progressos)) {
        await idbSave(d);
        localStorage.removeItem(k);
        console.log(`[Gymdex] Migrado "${k}" → IndexedDB`);
        return;
      }
    } catch(_) {}
  }
}

/* ════════════════════════════════════════
   PATCHES — aplicados após window.load
   ════════════════════════════════════════ */
window.addEventListener('load', async () => {

  await migrate();

  /* ── Patch save() ── */
  window.save = function() {
    if (!window.G) return;
    idbSave({
      treinos:    window.G.treinos,
      progressos: window.G.progressos,
      settings:   window.G.settings,
      profile:    window.G.profile
    });
  };

  /* ── Patch load() ── */
  window.load = async function() {
    const d = await idbLoad();
    if (!d || !window.G) return;
    if (d.treinos)    window.G.treinos    = d.treinos;
    if (d.progressos) window.G.progressos = d.progressos;
    if (d.settings)   Object.assign(window.G.settings, d.settings);
    if (d.profile)    Object.assign(window.G.profile,  d.profile);
  };

  /* ── Carrega dados e redesenha ── */
  await window.load();
  if (window.applyTheme)    window.applyTheme();
  if (window.renderTreinos) window.renderTreinos();

  /* ════════════════════════════════════════
     SESSÃO DE TREINO — retomar se app fechou
     ════════════════════════════════════════ */
  const session = await idbLoadSession();
  if (session && window.G && window.G.treinos[session.trIdx]) {
    const t = window.G.treinos[session.trIdx];
    showResumePrompt(t.titulo, session);
  }

  function showResumePrompt(titulo, session) {
    // Cria o modal de retomada
    const overlay = document.createElement('div');
    overlay.id = 'resume-overlay';
    overlay.style.cssText = `
      position:fixed;inset:0;background:rgba(0,0,0,.85);
      z-index:9999;display:flex;align-items:center;justify-content:center;
      padding:24px;font-family:'DM Sans',sans-serif;
    `;
    overlay.innerHTML = `
      <div style="background:var(--bg2,#1c1c1c);border-radius:20px;padding:28px 24px;
                  max-width:340px;width:100%;text-align:center;border:.5px solid var(--bd,#2e2e2e)">
        <div style="font-size:40px;margin-bottom:14px">⚡</div>
        <div style="font-family:'Syne',sans-serif;font-size:19px;font-weight:700;margin-bottom:8px;color:var(--t1,#fff)">
          Treino em andamento
        </div>
        <div style="font-size:14px;color:var(--t2,#aaa);margin-bottom:6px">${titulo}</div>
        <div style="font-size:12px;color:var(--t3,#555);margin-bottom:24px">
          Você saiu no meio do treino. Quer continuar de onde parou?
        </div>
        <button id="resume-yes" style="width:100%;padding:13px;background:var(--acc,#3d6bff);
          color:#fff;border:none;border-radius:10px;font:600 15px 'DM Sans',sans-serif;
          cursor:pointer;margin-bottom:10px">
          ⚡ Continuar treino
        </button>
        <button id="resume-no" style="width:100%;padding:13px;background:var(--bg3,#252525);
          color:var(--t1,#fff);border:.5px solid var(--bd,#2e2e2e);border-radius:10px;
          font:600 15px 'DM Sans',sans-serif;cursor:pointer">
          Descartar e começar do zero
        </button>
      </div>
    `;
    document.body.appendChild(overlay);

    document.getElementById('resume-yes').onclick = async () => {
      overlay.remove();
      // Restaura o estado do treino exatamente onde parou
      window.EX.trIdx = session.trIdx;
      window.EX.cur   = session.cur;
      window.EX.steps = session.steps;
      // Monta a tela de execução
      const t = window.G.treinos[session.trIdx];
      document.getElementById('exec-title').textContent = t.titulo;
      document.getElementById('exec-done').style.display = 'none';
      document.getElementById('exec-back').onclick = window.confirmCloseExec;
      document.getElementById('exec-screen').classList.add('open');
      window.renderExec();
    };

    document.getElementById('resume-no').onclick = async () => {
      overlay.remove();
      await idbClearSession();
    };
  }

  /* ── Wraps do renderExec para salvar sessão a cada avanço ── */
  const _origRenderExec = window.renderExec;
  if (_origRenderExec) {
    window.renderExec = function() {
      _origRenderExec.call(this);
      // Salva estado atual se treino ativo
      if (window.EX && window.EX.trIdx >= 0 && window.EX.steps.length > 0) {
        idbSaveSession({
          trIdx: window.EX.trIdx,
          cur:   window.EX.cur,
          steps: window.EX.steps
        });
      }
    };
  }

  /* ── Limpa sessão ao concluir ou sair ── */
  const _origClearExec = window.closeExecFully;
  if (_origClearExec) {
    window.closeExecFully = function() {
      idbClearSession();
      _origClearExec.call(this);
    };
  }

  const _origCongrats = window.showCongrats;
  if (_origCongrats) {
    window.showCongrats = function() {
      idbClearSession();
      window.notifyWorkoutDone();
      _origCongrats.call(this);
    };
  }

  /* ════════════════════════════
     NOTIFICAÇÕES
     ════════════════════════════ */
  let _swReg = null;

  async function ensureNotif() {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied')  return false;
    return (await Notification.requestPermission()) === 'granted';
  }

  async function getSW() {
    if (_swReg) return _swReg;
    if (!('serviceWorker' in navigator)) return null;
    _swReg = await navigator.serviceWorker.ready;
    return _swReg;
  }

  window.notifyTimerDone = async function(nextName) {
    if (!await ensureNotif()) return;
    const reg = await getSW();
    const msg = { type: 'TIMER_DONE', next: nextName || null };
    if (reg?.active) reg.active.postMessage(msg);
    else new Notification('⏱ Descanso acabou!', {
      body: nextName ? `Próximo: ${nextName}` : 'Hora de continuar! 💪',
      icon: './icon-192.png'
    });
  };

  window.notifyWorkoutDone = async function() {
    if (!await ensureNotif()) return;
    const reg = await getSW();
    const msg = { type: 'WORKOUT_DONE' };
    if (reg?.active) reg.active.postMessage(msg);
    else new Notification('🏆 Treino concluído!', {
      body: 'Parabéns! Cada série te deixa mais forte.',
      icon: './icon-192.png'
    });
  };

  /* Wrap timerDone para disparar notificação */
  const _origTimerDone = window.timerDone;
  if (_origTimerDone) {
    window.timerDone = function() {
      const next = window.EX?.steps?.[window.EX.cur + 1];
      window.notifyTimerDone(next?.nome || null);
      _origTimerDone.call(this);
    };
  }

  /* Pede permissão de notificação na primeira interação */
  document.addEventListener('click', async function askOnce() {
    await ensureNotif();
    document.removeEventListener('click', askOnce);
  }, { once: true });

});
