'use strict';
/* Main window. All decisions are made in the main process; this page only displays and forwards clicks. */
let state = null;
let pairTimer = null;

function render(s) {
  state = s;
  show($('testmode'), s.testMode);
  show($('v-setup'), s.view === 'setup');
  show($('v-pairing'), s.view === 'pairing');
  show($('v-main'), s.view === 'main');

  // setup
  const err = $('setup-error');
  err.textContent = s.setupError || '';
  show(err, !!s.setupError);
  // Pre-filled with the server of the Sklubot window (the user can still change it).
  if (s.view === 'setup' && s.suggestedServer && !$('server').value && document.activeElement !== $('server')) $('server').value = s.suggestedServer;

  // pairing
  $('pair-code').textContent = s.pairing ? s.pairing.code : '· · · ·';
  clearInterval(pairTimer);
  const updatePairStatus = () => {
    if (!s.pairing) { $('pair-status').textContent = t('pair.connecting'); return; }
    let txt = t('pair.waiting');
    if (s.pairing.expiresAt) {
      const left = Math.max(0, Math.round((Date.parse(s.pairing.expiresAt) - Date.now()) / 1000));
      txt += ' ' + t('pair.expires', { s: left });
    }
    $('pair-status').textContent = txt;
  };
  updatePairStatus();
  if (s.view === 'pairing') pairTimer = setInterval(updatePairStatus, 1000);

  // status
  $('status-text').textContent = s.statusText;
  const pill = $('pill');
  pill.className = 'pill ' + (s.status === 'online' ? 'online' : s.status === 'paused' ? 'paused' : ['unauthorized', 'outdated', 'replaced'].includes(s.status) ? 'bad' : '');
  show($('btn-pause'), ['online', 'connecting', 'waiting'].includes(s.status));
  show($('btn-resume'), s.status === 'paused' || s.status === 'idle');
  show($('btn-repair'), s.status === 'unauthorized');

  // session
  const sc = $('session-card');
  sc.classList.toggle('session', !!s.session);
  $('session-text').textContent = s.session ? t('session.active', { bot: s.session.botName }) : t('session.none');
  show($('btn-stop'), !!s.session);
  show($('locked-card'), s.locked);

  // permissions (macOS) / Wayland warning (Linux)
  const pl = $('perm-list');
  pl.replaceChildren();
  if (s.permissions) {
    for (const [key, label] of [['screen', 'perm.screen'], ['accessibility', 'perm.accessibility']]) {
      const row = document.createElement('div');
      row.className = 'row';
      const name = document.createElement('span');
      name.textContent = t(label) + ' : ' + t(s.permissions[key] ? 'perm.granted' : 'perm.missing');
      row.append(name);
      if (!s.permissions[key]) {
        const sp = document.createElement('span'); sp.className = 'spacer'; row.append(sp);
        const b = document.createElement('button'); b.textContent = t('perm.open');
        b.onclick = () => window.relais.requestPermission(key);
        row.append(b);
      }
      pl.append(row);
    }
  }
  show($('wayland'), s.wayland);
  show($('perm-card'), !!s.permissions || s.wayland);

  // bots
  const busy = !!s.session;
  show($('bots-hint'), busy);
  const list = $('bots');
  list.replaceChildren();
  // « Tous mes bots de ce compte » (1.7): one line on top, revocable at any time, granted only outside a session.
  if (s.allBots || s.bots.length) {
    const el = document.createElement('div'); el.className = 'bot';
    const name = document.createElement('div'); name.className = 'name'; name.textContent = t('bots.allBots');
    const lab = document.createElement('label'); lab.className = 'toggle';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!s.allBots;
    cb.disabled = busy && !s.allBots;
    cb.onchange = async () => { const ok = await window.relais.setAllBots(cb.checked); if (!ok) cb.checked = !cb.checked; };
    const sp = document.createElement('span'); sp.textContent = t('bots.allBotsHint');
    lab.append(cb, sp); el.append(name, lab);
    list.append(el);
  }
  if (!s.bots.length && !s.allBots) {
    const p = document.createElement('p'); p.className = 'muted small'; p.textContent = t('bots.empty'); list.append(p);
  }
  for (const b of s.bots) {
    const el = document.createElement('div'); el.className = 'bot';
    const name = document.createElement('div'); name.className = 'name'; name.textContent = b.name;
    el.append(name);
    for (const [key, label] of [['control', 'bots.control'], ['commands', 'bots.commands']]) {
      const lab = document.createElement('label'); lab.className = 'toggle';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = b[key];
      cb.disabled = busy && !b[key];
      cb.onchange = async () => { const ok = await window.relais.setBot(b.id, key, cb.checked); if (!ok) cb.checked = !cb.checked; };
      const sp = document.createElement('span'); sp.textContent = t(label);
      lab.append(cb, sp); el.append(lab);
    }
    const rm = document.createElement('button'); rm.className = 'link'; rm.textContent = t('bots.remove');
    rm.onclick = () => window.relais.removeBot(b.id);
    el.append(rm);
    list.append(el);
  }

  // shared folders (protocol 1.1)
  const fl = $('folders');
  fl.replaceChildren();
  if (!s.folders.length) { const p = document.createElement('p'); p.className = 'muted small'; p.textContent = t('folders.empty'); fl.append(p); }
  for (const f of s.folders) {
    const el = document.createElement('div'); el.className = 'bot';
    const name = document.createElement('div'); name.className = 'name'; name.textContent = f.name;
    const where = document.createElement('div'); where.className = 'small muted'; where.textContent = f.path;
    const lab = document.createElement('label'); lab.className = 'toggle';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = f.write; cb.disabled = busy && !f.write;
    cb.onchange = async () => { const ok = await window.relais.setFolderWrite(f.id, cb.checked); if (!ok) cb.checked = !cb.checked; };
    const sp = document.createElement('span'); sp.textContent = t('folders.write');
    lab.append(cb, sp);
    const rm = document.createElement('button'); rm.className = 'link'; rm.textContent = t('folders.remove');
    rm.onclick = () => window.relais.removeFolder(f.id);
    el.append(name, where, lab, rm);
    fl.append(el);
  }
  // Android phones by USB (protocol 1.9): « {phone} utilisé par {bot} », and how to install adb when it is missing.
  const pl = $('phones');
  pl.replaceChildren();
  const uses = s.phones || [];
  if (!uses.length) { const p = document.createElement('p'); p.className = 'muted small'; p.textContent = t('phones.none'); pl.append(p); }
  for (const u of uses) { const p = document.createElement('p'); p.className = 'name'; p.textContent = t('phones.inUse', { phone: u.model, bot: u.botName }); pl.append(p); }
  show($('phones-guide'), !s.adbFound);
  const fe = $('folder-error');
  fe.textContent = s.folderError || '';
  show(fe, !!s.folderError);
  $('btn-folder-add').disabled = busy;

  // settings
  $('autostart').checked = s.autostart;
  $('hotkey').textContent = s.hotkeyOk ? t('settings.hotkey', { key: s.hotkey }) : t('settings.hotkeyFailed', { key: s.hotkey });
  $('version').textContent = 'v' + s.version + ' · protocole ' + s.protocol;
}

async function main() {
  await loadI18n();
  $('server').placeholder = t('setup.placeholder');
  $('setup-form').addEventListener('submit', (e) => { e.preventDefault(); window.relais.setServer($('server').value); });
  $('pair-cancel').onclick = () => window.relais.cancelPairing();
  $('btn-pause').onclick = () => window.relais.pause();
  $('btn-resume').onclick = () => window.relais.resume();
  $('btn-repair').onclick = () => window.relais.repair();
  $('btn-stop').onclick = () => window.relais.stopSession();
  $('btn-unlock').onclick = () => window.relais.unlock();
  $('btn-log').onclick = () => window.relais.openLog();
  $('btn-folder-add').onclick = () => window.relais.addFolder();
  $('btn-forget').onclick = () => window.relais.forget();
  $('autostart').onchange = async (e) => { const ok = await window.relais.setAutostart(e.target.checked); if (!ok) e.target.checked = !e.target.checked; };
  window.relais.onState(render);
  render(await window.relais.state());
}
main();
