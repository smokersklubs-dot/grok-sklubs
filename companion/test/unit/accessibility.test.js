'use strict';
/* Accessibility tree and actions by reference (L164): capabilities/accessibility.js and relay-core.js.
   The platform scripts (osascript JXA, PowerShell UI Automation) only run on a real Mac / Windows PC: here, the parsing,
   the references and the Relais rules are tested with recorded raw trees. */
const test = require('node:test');
const assert = require('node:assert/strict');
const AX = require('../../src/main/capabilities/accessibility');
const { validateArgs, OPS } = require('../../src/main/protocol');
const { makeCore } = require('./helpers');

/** A raw tree as MAC_TREE prints it: Mail's compose window with a sheet open. */
const MAC_RAW = {
  app: 'Mail', bundle: 'com.apple.mail', pid: 501, frontmost: true, truncated: false,
  windows: [{ r: 'AXWindow', n: 'Nouveau message', c: [
    { r: 'AXButton', s: 'AXCloseButton', n: '' },
    { r: 'AXTextField', n: 'À', v: 'lea@example.com' },
    { r: 'AXTextField', s: 'AXSecureTextField', n: 'Mot de passe', v: 'hunter2-should-never-appear' },
    { r: 'AXStaticText', n: 'Objet' },
    { r: 'AXButton', n: 'Envoyer', e: true },
    { r: 'AXCheckBox', s: 'AXToggleButton', n: 'Copie' },
    { r: 'AXSheet', n: 'Enregistrer le brouillon ?', c: [{ r: 'AXButton', n: 'Enregistrer' }, { r: 'AXButton', n: 'Annuler', e: false }] },
  ] }],
};
/** As WIN_TREE prints it (ControlType programmatic names and supported patterns). */
const WIN_RAW = {
  app: 'notepad', pid: 4242, truncated: false,
  windows: [{ r: 'ControlType.Window', n: 'Sans titre - Bloc-notes', pt: ['Window'], c: [
    { r: 'ControlType.Edit', n: 'Éditeur de texte', pt: ['Value', 'Text'], v: 'Bonjour' },
    { r: 'ControlType.Button', n: 'Gras', pt: ['Toggle'] },
    { r: 'ControlType.Button', n: 'Plus', pt: ['ExpandCollapse'] },
    { r: 'ControlType.List', n: 'Polices', pt: ['Selection'], c: [{ r: 'ControlType.ListItem', n: 'Arial', pt: ['SelectionItem'] }] },
    { r: 'ControlType.Edit', n: 'Code', sec: true, pt: ['Value'] },
    { r: 'ControlType.Window', n: 'Enregistrer sous', modal: true, pt: ['Window'], c: [{ r: 'ControlType.Button', n: 'OK', pt: ['Invoke'] }] },
  ] }],
};

test('role tables adapted from agent-desktop: macOS role + subrole, Windows ControlType + patterns', () => {
  assert.equal(AX.macRole('AXButton'), 'button');
  assert.equal(AX.macRole('AXTextArea'), 'textfield');
  assert.equal(AX.macRole('AXRow', 'AXOutlineRow'), 'treeitem');
  assert.equal(AX.macRole('AXWindow', 'AXDialog'), 'dialog');
  assert.equal(AX.macRole('AXCheckBox', 'AXToggleButton'), 'checkbox', 'a button subrole does not erase a checkbox');
  assert.equal(AX.macRole('AXButton', 'AXToggleButton'), 'button');
  assert.equal(AX.macRole('AXCustomWidget'), 'unknown');
  assert.equal(AX.winRole('ControlType.Button', ['Toggle']), 'switch');
  assert.equal(AX.winRole('Button', ['ExpandCollapse']), 'menubutton');
  assert.equal(AX.winRole('ControlType.List', ['Selection']), 'listbox');
  assert.equal(AX.winRole('ControlType.List', []), 'list');
  assert.equal(AX.winRole('ControlType.Window', [], { modal: true }), 'dialog');
  assert.equal(AX.winRole('ControlType.Nope', []), 'unknown');
  assert.equal(AX.INTERACTIVE_ROLES.length, 18);
});

test('macOS snapshot: references for interactive controls only, secure value never kept, sheet reported', () => {
  const s = AX.buildSnapshot(MAC_RAW, { platform: 'darwin', snapshotId: 'sabc1', interactiveOnly: true });
  assert.equal(s.app, 'Mail');
  assert.deepEqual(s.elements.map((e) => e.ref), ['@sabc1:e1', '@sabc1:e2', '@sabc1:e3', '@sabc1:e4', '@sabc1:e5', '@sabc1:e6', '@sabc1:e7']);
  assert.equal(s.elements[0].name, 'Close', 'window control named from its subrole');
  const pwd = s.elements.find((e) => e.name === 'Mot de passe');
  assert.equal(pwd.secure, true);
  assert.equal(pwd.value, undefined);
  assert.doesNotMatch(JSON.stringify(s), /hunter2/);
  assert.deepEqual(s.dialogs, [{ role: 'sheet', name: 'Enregistrer le brouillon ?', path: '0.6' }]);
  assert.equal(s.elements.find((e) => e.name === 'Annuler').enabled, false);
  assert.equal(s.elements.find((e) => e.name === 'Enregistrer').inDialog, 'Enregistrer le brouillon ?');
  const text = AX.renderSnapshot(s);
  assert.match(text, /^Open dialogs: sheet “Enregistrer le brouillon \?”/);
  assert.match(text, /textfield “Mot de passe” \(password field: the user types it\) \[@sabc1:e3\]/);
  assert.match(text, /button “Envoyer” \[@sabc1:e4\]/);
});

test('Windows snapshot: patterns refine roles, modal window is a dialog, password value never kept', () => {
  const s = AX.buildSnapshot(WIN_RAW, { platform: 'win32', snapshotId: 'sw1', interactiveOnly: true });
  assert.deepEqual(s.elements.map((e) => `${e.role}:${e.name}`), ['textfield:Éditeur de texte', 'switch:Gras', 'menubutton:Plus', 'listbox:Polices', 'option:Arial', 'textfield:Code', 'button:OK']);
  assert.equal(s.elements[0].value, 'Bonjour');
  assert.deepEqual(s.dialogs.map((d) => d.name), ['Enregistrer sous']);
  assert.equal(s.elements.find((e) => e.name === 'Code').secure, true);
});

test('caps: a snapshot is cut at 300 elements and says it is incomplete', () => {
  const many = { app: 'Big', pid: 1, windows: [{ r: 'AXWindow', n: 'w', c: Array.from({ length: 400 }, (_, i) => ({ r: 'AXButton', n: `b${i}` })) }] };
  const s = AX.buildSnapshot(many, { platform: 'darwin', snapshotId: 'sbig', interactiveOnly: true });
  assert.equal(s.elements.length, 300);
  assert.equal(s.complete, false);
});

test('references belong to their snapshot: bare refs refused, old snapshots stale, only 3 kept', () => {
  const store = new AX.SnapshotStore();
  const ids = [];
  for (let i = 0; i < 4; i++) { const s = AX.buildSnapshot(MAC_RAW, { platform: 'darwin', snapshotId: store.nextId(), interactiveOnly: true }); store.add(s); ids.push(s.snapshotId); }
  assert.equal(store.map.size, 3);
  assert.throws(() => AX.resolveRef(store.map, '@e4'), (e) => e.code === 'invalid_args');
  assert.throws(() => AX.resolveRef(store.map, `@${ids[0]}:e4`), (e) => e.code === 'stale_ref');
  assert.throws(() => AX.resolveRef(store.map, `@${ids[3]}:e99`), (e) => e.code === 'stale_ref');
  assert.equal(AX.resolveRef(store.map, `@${ids[3]}:e4`).el.name, 'Envoyer');
});

test('protocol 1.5: ax.tree and ax.act validated', () => {
  assert.deepEqual(OPS['ax.act'], { session: true, input: true });
  assert.deepEqual(validateArgs('ax.tree', { app: 'Mail' }), { app: 'Mail', interactiveOnly: true });
  assert.throws(() => validateArgs('ax.tree', { app: '../x;rm' }));
  assert.throws(() => validateArgs('ax.act', { ref: '@s1abc:e1', action: 'drop' }));
  assert.throws(() => validateArgs('ax.act', { ref: '@s1abc:e1', action: 'set_value' }), /text required/);
  assert.equal(validateArgs('ax.act', { ref: '@s1abc:e1', action: 'press', background: true }).background, true);
});

const MAIL_FRONT = { app: 'Mail', bundle: 'com.apple.mail', pid: 501, windowId: 'w1', title: 'Nouveau message', passwordField: false };
async function withSession(opts) {
  const k = makeCore({ answers: { session: 'once' }, platform: 'darwin', active: MAIL_FRONT, ...opts });
  assert.equal((await k.req('session.start', {})).ok, true);
  return k;
}

test('relay: tree then press by reference (foreground re-checked), value lengths only in the log', async () => {
  const acts = [];
  const k = await withSession({ extraCaps: { axRead: async () => MAC_RAW, axAct: async (a) => { acts.push(a); return { done: true }; } } });
  const t = await k.req('ax.tree', { app: 'Mail' });
  assert.equal(t.ok, true);
  assert.equal(t.result.dialogs[0].role, 'sheet');
  assert.doesNotMatch(JSON.stringify(t), /hunter2/);
  const send = t.result.elements.find((e) => e.name === 'Envoyer').ref;
  const r = await k.req('ax.act', { ref: send, action: 'press' });
  assert.equal(r.ok, true);
  assert.equal(acts.length, 1);
  assert.equal(acts[0].el.path, '0.4');
  const to = t.result.elements.find((e) => e.name === 'À').ref;
  assert.equal((await k.req('ax.act', { ref: to, action: 'set_value', text: 'secret-ish text' })).ok, true);
  assert.doesNotMatch(JSON.stringify(k.logs), /secret-ish/);
});

test('relay: password field never filled, wrong action refused, another app in front refused unless background', async () => {
  let front = MAIL_FRONT;
  const acts = [];
  const k = await withSession({ active: () => front, extraCaps: { axRead: async () => MAC_RAW, axAct: async (a) => { acts.push(a); return { done: true }; } } });
  const t = await k.req('ax.tree', {});
  const ref = (name) => t.result.elements.find((e) => e.name === name).ref;
  assert.equal((await k.req('ax.act', { ref: ref('Mot de passe'), action: 'set_value', text: 'x' })).error.code, 'password_field');
  assert.equal((await k.req('ax.act', { ref: ref('Mot de passe'), action: 'focus' })).ok, true, 'focusing it is fine: the user types');
  assert.equal((await k.req('ax.act', { ref: ref('Envoyer'), action: 'toggle' })).error.code, 'invalid_args');
  front = { app: 'Safari', bundle: 'com.apple.Safari', pid: 9, title: 'Banque' };
  assert.equal((await k.req('ax.act', { ref: ref('Envoyer'), action: 'press' })).error.code, 'window_changed');
  assert.equal((await k.req('ax.act', { ref: ref('Envoyer'), action: 'press', background: true })).ok, true, 'background: the pointer and the front app are not used');
  front = null;
  assert.equal((await k.req('ax.act', { ref: ref('Envoyer'), action: 'press' })).error.code, 'foreground_unknown');
  assert.equal(acts.length, 2);
});

test('relay: refused apps and the keep-out list cannot be read nor acted on; stale after the session ends', async () => {
  const k = await withSession({ extraCaps: { axRead: async (a) => (a.app === 'Mail' ? MAC_RAW : { app: '1Password', pid: 3, windows: [{ r: 'AXWindow', n: 'Coffre' }] }), axAct: async () => ({ done: true }) } });
  assert.equal((await k.req('ax.tree', { app: 'KeePassXC' })).error.code, 'blocked_app', 'refused before reading');
  assert.equal((await k.req('ax.tree', {})).error.code, 'blocked_app', 'the app in front is a password manager: nothing sent');
  const t = await k.req('ax.tree', { app: 'Mail' });
  await k.req('guard.set', { keepApps: ['Mail'] });
  const ref = t.result.elements.find((e) => e.name === 'Envoyer').ref;
  assert.equal((await k.req('ax.act', { ref, action: 'press', background: true })).error.code, 'keep_out');
  assert.equal((await k.req('ax.tree', { app: 'Mail' })).error.code, 'keep_out');
  await k.req('guard.set', { keepApps: [] });
  await k.req('session.end', {});
  await k.req('session.start', {});
  assert.equal((await k.req('ax.act', { ref, action: 'press', background: true })).error.code, 'stale_ref');
});

test('relay: without the capability (Linux) the operations say unsupported', async () => {
  const k = makeCore({ answers: { session: 'once' } });
  await k.req('session.start', {});
  // The helper's fake caps answer every name: emulate a missing capability by an explicit undefined.
  k.core.d.caps = { activeWindow: async () => null };
  assert.equal((await k.req('ax.tree', {})).error.code, 'unsupported');
});

test('platform scripts are present and never send a secure value', () => {
  assert.match(AX.MAC_TREE, /AXSecureTextField'\)n\.sec=true;else/);
  assert.match(AX.WIN_TREE, /IsPassword\)\{\$h\.sec=\$true\}elseif/);
  assert.match(AX.MAC_ACT, /password_field/);
  assert.match(AX.WIN_ACT, /password_field/);
});
