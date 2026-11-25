'use strict';
// Android phones by USB (protocol 1.9, docs/RELAIS-PROTOCOLE.md §20, A-FAIRE L177), with a FAKE adb executable
// (test/unit/fixtures/fake-adb.js): never the real adb, never a real phone.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { makeCore } = require('./helpers');
const { createAdb, findAdb, parseUiDump, parseFocus, inputText } = require('../../src/main/capabilities/adb');
const { validateAndroidArgs } = require('../../src/main/capabilities/adb-args');

const FAKE = path.join(__dirname, 'fixtures', 'fake-adb.js');
// A 2×3 PNG header is enough for the size (the fake sends these bytes as the screenshot).
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]), Buffer.from('IHDR'), Buffer.from([0, 0, 4, 56, 0, 0, 9, 96, 8, 6, 0, 0, 0])]);
const UI = (o = {}) => `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0">
<node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="${o.pkg || 'com.example.notes'}" content-desc="" checkable="false" checked="false" clickable="false" focused="false" password="false" bounds="[0,0][1080,2400]">
<node index="0" text="Nouvelle note" resource-id="com.example.notes:id/new" class="android.widget.Button" package="${o.pkg || 'com.example.notes'}" content-desc="" checkable="false" checked="false" clickable="true" focused="false" password="false" bounds="[40,100][440,220]" />
<node index="1" text="${o.password ? 'secret1' : 'Courses &amp; liste'}" resource-id="com.example.notes:id/${o.password ? 'pass' : 'title'}" class="android.widget.EditText" package="${o.pkg || 'com.example.notes'}" content-desc="" checkable="false" checked="false" clickable="true" focused="true" password="${o.password ? 'true' : 'false'}" bounds="[40,300][1040,420]" />
</node></hierarchy>`;

function fakeAdb(state) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-adb-'));
  const write = (s) => fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(s));
  write({ png: PNG.toString('base64'), ui: UI(), focus: 'com.example.notes', ...state });
  process.env.FAKE_ADB_DIR = dir;
  const calls = () => (fs.existsSync(path.join(dir, 'calls.jsonl')) ? fs.readFileSync(path.join(dir, 'calls.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  const set = (patch) => write({ ...JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')), ...patch });
  return { calls, set, caps: createAdb({ adbPath: FAKE }) };
}
const PHONES = [
  { serial: 'R58M12ABC', state: 'device', model: 'Pixel_8', android: '15', sdk: 35 },
  { serial: 'ZY22XYZ', state: 'unauthorized' },
];
const input = (calls) => calls.filter((c) => c[2] === 'shell' && ['input', 'monkey'].includes(c[3]));

test('android.devices: no adb → a clear "not found", nothing asked; with adb → model and Android version only for an authorised phone', async () => {
  const missing = makeCore({ extraCaps: createAdb({ adbPath: null }) });
  const r0 = await missing.req('android.devices');
  assert.deepEqual(r0.result, { adb: { found: false }, devices: [] });
  const tap0 = await missing.req('android.tap', { serial: 'R58M12ABC', x: 1, y: 1 });
  assert.equal(tap0.error.code, 'adb_missing');

  const f = fakeAdb({ devices: PHONES });
  const h = makeCore({ answers: { guard: 'allow' }, extraCaps: f.caps });
  const r = await h.req('android.devices');
  assert.equal(r.ok, true);
  assert.deepEqual(r.result.adb, { found: true, version: '1.0.41' });
  assert.equal(r.result.devices.length, 2);
  assert.deepEqual(r.result.devices[0], { serial: 'R58M12ABC', state: 'device', usb: true, model: 'Pixel 8', android: '15', sdk: 35, inUse: null });
  assert.deepEqual(r.result.devices[1], { serial: 'ZY22XYZ', state: 'unauthorized', usb: true, inUse: null }, 'no model before the phone allowed this computer');
  assert.equal(h.prompts.length, 0, 'listing asks nothing');
  assert.equal(f.calls().filter((c) => c.includes('getprop')).length, 1, 'getprop only on the authorised phone');
});

test('the first use by each bot of each phone is asked on the computer; a refusal sends nothing; an unauthorised phone is refused', async () => {
  const f = fakeAdb({ devices: PHONES });
  const no = makeCore({ answers: { guard: 'refuse' }, extraCaps: f.caps });
  const r0 = await no.req('android.tap', { serial: 'R58M12ABC', x: 10, y: 20 });
  assert.equal(r0.error.code, 'consent_refused');
  assert.equal(no.prompts[0].kind, 'guard:phone');
  assert.match(no.prompts[0].detail, /Pixel 8 · Android 15 \(R58M12ABC\)/);
  assert.equal(input(f.calls()).length, 0, 'nothing sent to the phone');

  const h = makeCore({ answers: { guard: 'allow' }, extraCaps: f.caps });
  assert.equal((await h.req('android.tap', { serial: 'R58M12ABC', x: 10, y: 20 })).ok, true, 'no control session of the computer needed');
  assert.equal((await h.req('android.tap', { serial: 'R58M12ABC', x: 11, y: 21 })).ok, true);
  assert.equal(h.prompts.length, 1, 'the yes covers this bot and this phone');
  assert.equal((await h.req('android.tap', { serial: 'ZY22XYZ', x: 1, y: 1 })).error.code, 'phone_unauthorized');
  assert.equal((await h.req('android.tap', { serial: 'NOPE123', x: 1, y: 1 })).error.code, 'not_found');
  const started = h.sent.filter((m) => m.type === 'event' && m.name === 'phone.started');
  assert.equal(started.length, 1);
  assert.deepEqual(started[0].bot, { id: 'bot_a', name: 'Alice' });
  assert.equal(started[0].model, 'Pixel 8');
  assert.deepEqual(h.core.android.state().map((u) => `${u.model} · ${u.botName}`), ['Pixel 8 · Alice'], '« phone in use by Alice »');
});

test('touches, keys and apps go to adb as exact argument lists (official commands), validated first', async () => {
  const f = fakeAdb({ devices: PHONES });
  const h = makeCore({ autoConfirm: true, extraCaps: f.caps });
  const S = 'R58M12ABC';
  await h.req('android.tap', { serial: S, x: 10.4, y: 20 });
  await h.req('android.tap', { serial: S, x: 5, y: 6, long: true });
  await h.req('android.swipe', { serial: S, fromX: 500, fromY: 1800, toX: 500, toY: 600, durationMs: 400 });
  await h.req('android.key', { serial: S, key: 'back' });
  await h.req('android.open', { serial: S, package: 'com.whatsapp' });
  assert.deepEqual(input(f.calls()).map((c) => c.slice(3)), [
    ['input', 'tap', '10', '20'],
    ['input', 'swipe', '5', '6', '5', '6', '600'],
    ['input', 'swipe', '500', '1800', '500', '600', '400'],
    ['input', 'keyevent', '4'],
    ['monkey', '-p', 'com.whatsapp', '-c', 'android.intent.category.LAUNCHER', '1'],
  ]);
  assert.ok(f.calls().every((c) => c[0] !== '-s' || c[1] === S));
  assert.equal((await h.req('android.open', { serial: S, package: 'com.x; rm -rf /' })).error.code, 'invalid_args');
  assert.equal((await h.req('android.tap', { serial: 'R58; reboot', x: 1, y: 1 })).error.code, 'invalid_args');
  assert.equal((await h.req('android.key', { serial: S, key: 'power' })).error.code, 'invalid_args');
  f.set({ noApp: true });
  assert.equal((await h.req('android.open', { serial: S, package: 'com.absent.app' })).error.code, 'not_found');
});

test('typing: single-quoted for the phone shell, spaces as %s, plain ASCII only; the text never reaches the log', async () => {
  assert.equal(inputText("it's a test"), "'it'\\''s%sa%stest'");
  assert.throws(() => inputText('été'), (e) => e.code === 'unsupported');
  assert.throws(() => inputText('a%sb'), (e) => e.code === 'unsupported');
  const f = fakeAdb({ devices: PHONES });
  const h = makeCore({ autoConfirm: true, extraCaps: f.caps });
  const r = await h.req('android.type', { serial: 'R58M12ABC', text: 'pain et lait' });
  assert.equal(r.ok, true);
  assert.deepEqual(input(f.calls()).at(-1).slice(3), ['input', 'text', "'pain%set%slait'"]);
  assert.equal(JSON.stringify(h.logs).includes('lait'), false, 'length only in the log');
  assert.deepEqual(h.logs.find((l) => l.op === 'android.type' && l.kind === 'request').args, { serial: 'R58M12ABC', length: 12, force: false });
  assert.equal((await h.req('android.type', { serial: 'R58M12ABC', text: 'café' })).error.code, 'unsupported');
});

test('a password field is never typed without force (an approved card) AND a yes on the computer', async () => {
  const f = fakeAdb({ devices: PHONES, ui: UI({ password: true }) });
  const h = makeCore({ answers: { guard: (p) => Promise.resolve(p.kind === 'phone' ? 'allow' : 'refuse') }, extraCaps: f.caps });
  const r1 = await h.req('android.type', { serial: 'R58M12ABC', text: 'hunter22' });
  assert.equal(r1.error.code, 'password_field');
  const r2 = await h.req('android.type', { serial: 'R58M12ABC', text: 'hunter22', force: true });
  assert.equal(r2.error.code, 'password_field', 'refused on the computer');
  assert.equal(h.prompts.at(-1).kind, 'guard:phone_password');
  assert.match(h.prompts.at(-1).detail, /com\.example\.notes · com\.example\.notes:id\/pass · 8 characters/);
  assert.equal(input(f.calls()).length, 0, 'nothing typed');
  const ok = makeCore({ answers: { guard: 'allow' }, extraCaps: f.caps });
  assert.equal((await ok.req('android.type', { serial: 'R58M12ABC', text: 'hunter22', force: true })).ok, true);
  assert.equal(JSON.stringify(ok.logs).includes('hunter22'), false);
});

test('never in Sklubot, the installer, the settings or a kept-out app; an unreadable front app refuses', async () => {
  const f = fakeAdb({ devices: PHONES });
  const h = makeCore({ autoConfirm: true, extraCaps: f.caps });
  const S = 'R58M12ABC';
  for (const [pkg, code] of [['com.android.settings', 'blocked_app'], ['app.sklubot.android', 'blocked_app'], ['com.google.android.packageinstaller', 'blocked_app']]) {
    f.set({ focus: pkg, ui: UI({ pkg }) });
    for (const op of ['android.tap', 'android.screenshot', 'android.ui']) assert.equal((await h.req(op, { serial: S, x: 1, y: 1 })).error.code, code, `${op} ${pkg}`);
  }
  f.set({ focus: 'com.example.notes', ui: UI() });
  assert.equal((await h.req('android.open', { serial: S, package: 'com.android.settings' })).error.code, 'blocked_app');
  await h.req('guard.set', { keepApps: ['fr.creditagricole'], keepFolders: [], terminal: true }, { id: 'sklubot', name: 'Sklubot' });
  f.set({ focus: 'fr.creditagricole.androidapp', ui: UI({ pkg: 'fr.creditagricole.androidapp' }) });
  assert.equal((await h.req('android.tap', { serial: S, x: 1, y: 1 })).error.code, 'keep_out');
  assert.equal((await h.req('android.open', { serial: S, package: 'fr.creditagricole.androidapp' })).error.code, 'keep_out');
  f.set({ focus: null, ui: 'ERROR: could not get idle state.' });
  assert.equal((await h.req('android.tap', { serial: S, x: 1, y: 1 })).error.code, 'foreground_unknown');
  assert.equal(input(f.calls()).length, 0, 'not one touch was sent');
});

test('screenshot and UI tree: PNG size, password text masked, the app in front', async () => {
  const f = fakeAdb({ devices: PHONES, ui: UI({ password: true }) });
  const h = makeCore({ autoConfirm: true, extraCaps: f.caps });
  const s = await h.req('android.screenshot', { serial: 'R58M12ABC' });
  assert.equal(s.result.format, 'png');
  assert.deepEqual([s.result.width, s.result.height, s.result.screenWidth], [1080, 2400, 1080]);
  assert.equal(Buffer.from(s.result.data, 'base64').length, PNG.length);
  const u = await h.req('android.ui', { serial: 'R58M12ABC' });
  assert.equal(u.result.app.package, 'com.example.notes');
  assert.equal(JSON.stringify(u.result).includes('secret1'), false);
  assert.deepEqual(u.result.nodes.find((n) => n.password), { bounds: [40, 300, 1000, 120], text: '••••', id: 'com.example.notes:id/pass', class: 'EditText', click: true, edit: true, password: true, focused: true });
  assert.deepEqual(u.result.nodes[0], { bounds: [40, 100, 400, 120], text: 'Nouvelle note', id: 'com.example.notes:id/new', class: 'Button', click: true });
  assert.equal(parseUiDump(UI()).nodes[1].text, 'Courses & liste');
  assert.equal(parseFocus('  mCurrentFocus=Window{9f2 u0 com.whatsapp/com.whatsapp.HomeActivity}'), 'com.whatsapp');
  assert.equal(parseFocus('mCurrentFocus=null'), null);
});

test('one bot at a time per phone: busy with the holder, taken over after 20 s idle; Stop wins and forgets every yes', async () => {
  let t = 1_000_000;
  const f = fakeAdb({ devices: PHONES });
  const h = makeCore({ answers: { guard: 'allow' }, extraCaps: f.caps, now: () => t });
  const S = 'R58M12ABC';
  assert.equal((await h.req('android.tap', { serial: S, x: 1, y: 1 })).ok, true);
  const busy = await h.req('android.tap', { serial: S, x: 1, y: 1 }, { id: 'bot_b', name: 'Bob' });
  assert.equal(busy.error.code, 'busy');
  assert.deepEqual(busy.error.holder, { id: 'bot_a', name: 'Alice' });
  assert.ok(busy.error.retryAfterMs >= 1000);
  t += 21_000;
  assert.equal((await h.req('android.tap', { serial: S, x: 2, y: 2 }, { id: 'bot_b', name: 'Bob' })).ok, true);
  const ended = h.sent.filter((m) => m.name === 'phone.ended');
  assert.equal(ended.at(-1).reason, 'handover');
  assert.deepEqual(h.core.android.state().map((u) => u.botName), ['Bob']);
  h.core.stop('hotkey');
  assert.equal(h.sent.filter((m) => m.name === 'phone.ended').at(-1).reason, 'hotkey');
  assert.equal(h.core.android.uses.size, 0);
  assert.equal(h.core.android.allowed.size, 0);
  for (const op of ['android.tap', 'android.devices', 'android.screenshot']) assert.equal((await h.req(op, { serial: S, x: 1, y: 1 })).error.code, 'locked', op);
});

test('android.release: a bot releases its phone; Sklubot (web Stop) releases it and forgets the yes', async () => {
  const f = fakeAdb({ devices: PHONES });
  const h = makeCore({ answers: { guard: 'allow' }, extraCaps: f.caps });
  await h.req('android.tap', { serial: 'R58M12ABC', x: 1, y: 1 });
  assert.equal((await h.req('android.release', { serial: 'R58M12ABC' }, { id: 'bot_b', name: 'Bob' })).result.released, 0, 'not Bob\'s');
  assert.equal((await h.req('android.release', { serial: 'R58M12ABC' }, { id: 'sklubot', name: 'Sklubot' })).result.released, 1);
  assert.equal(h.core.android.allowed.size, 0);
  await h.req('android.tap', { serial: 'R58M12ABC', x: 1, y: 1 });
  assert.equal(h.prompts.length, 2, 'asked again after Sklubot\'s Stop');
});

test('arguments and where adb is looked for (never downloaded)', () => {
  assert.throws(() => validateAndroidArgs('android.tap', { serial: 'R58', x: -1, y: 0 }));
  assert.throws(() => validateAndroidArgs('android.swipe', { serial: 'R58', fromX: 0, fromY: 0, toX: 1, toY: 1, durationMs: 10_000 }));
  assert.throws(() => validateAndroidArgs('android.type', { serial: 'R58', text: 'x'.repeat(501) }), (e) => e.code === 'too_large');
  assert.deepEqual(validateAndroidArgs('android.screenshot', { serial: 'R58' }), { serial: 'R58', maxWidth: 1080 });
  const there = new Set(['/opt/sdk/platform-tools/adb']);
  assert.equal(findAdb({ env: { PATH: '/usr/bin', ANDROID_HOME: '/opt/sdk' }, platform: 'linux', home: '/home/lea', exists: (p) => there.has(p) }), '/opt/sdk/platform-tools/adb');
  assert.equal(findAdb({ env: { PATH: '/usr/bin' }, platform: 'darwin', home: '/Users/lea', exists: (p) => p === '/Users/lea/Library/Android/sdk/platform-tools/adb' }), '/Users/lea/Library/Android/sdk/platform-tools/adb');
  assert.equal(findAdb({ env: { PATH: '' }, platform: 'linux', home: '/home/lea', exists: () => false }), null);
});
