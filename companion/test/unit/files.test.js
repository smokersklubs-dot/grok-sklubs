'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createFileCaps, shareProblem, refusedName } = require('../../src/main/capabilities/files');
const { validateArgs } = require('../../src/main/protocol');
const { makeCore } = require('./helpers');

/** A fake home folder with a shared "Documents" folder (write) and "Photos" (read only). */
function setup() {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'relais-home-')));
  const docs = path.join(home, 'Documents');
  const photos = path.join(home, 'Photos');
  fs.mkdirSync(path.join(docs, 'factures'), { recursive: true });
  fs.mkdirSync(photos);
  fs.writeFileSync(path.join(docs, 'notes.txt'), 'pain, lait');
  fs.writeFileSync(path.join(docs, 'factures', 'mars.txt'), 'Facture 42');
  fs.writeFileSync(path.join(docs, '.env'), 'TOKEN=secret');
  fs.writeFileSync(path.join(docs, 'id_rsa'), 'PRIVATE KEY');
  fs.writeFileSync(path.join(docs, 'image.bin'), Buffer.from([0x89, 0x50, 0x00, 0x01, 0x02]));
  fs.mkdirSync(path.join(docs, '.cache'));
  fs.writeFileSync(path.join(home, 'outside.txt'), 'not shared');
  fs.symlinkSync(path.join(home, 'outside.txt'), path.join(docs, 'link.txt'));
  const trashed = [];
  const folders = [{ id: 'f1', name: 'Documents', path: docs, write: true }, { id: 'f2', name: 'Photos', path: photos, write: false }];
  const caps = createFileCaps({ getFolders: () => folders, trash: async (p) => { trashed.push(p); fs.rmSync(p); }, home, platform: 'linux' });
  return { home, docs, photos, caps, trashed, folders };
}
const code = async (p) => { try { await p; return 'ok'; } catch (e) { return e.code; } };

test('which folders may be shared: inside home (not home itself), no hidden, system or backup folder', () => {
  const { home, docs } = setup();
  assert.equal(shareProblem(docs, { home, platform: 'linux' }), null);
  assert.match(shareProblem(home, { home, platform: 'linux' }), /whole home folder/);
  fs.mkdirSync(path.join(home, '.ssh'));
  assert.match(shareProblem(path.join(home, '.ssh'), { home, platform: 'linux' }), /hidden/);
  fs.mkdirSync(path.join(home, 'Library', 'Mail'), { recursive: true });
  assert.match(shareProblem(path.join(home, 'Library', 'Mail'), { home, platform: 'linux' }), /system/);
  assert.match(shareProblem('/etc', { home, platform: 'linux' }), /home folder or on an external disk/);
  assert.ok(refusedName('.env.local') && refusedName('server.PEM') && refusedName('Passwords.kdbx') && refusedName('id_ed25519') && !refusedName('notes.txt'));
});

test('list and read: only inside shared folders; hidden, secret, binary, links out and ".." refused', async () => {
  const { caps } = setup();
  const roots = (await caps.fsRoots()).roots;
  assert.deepEqual(roots.map((r) => [r.name, r.write]), [['Documents', true], ['Photos', false]]);
  assert.match(roots[0].path, /^~\//);
  const list = await caps.fsList({ root: 'Documents', path: '' });
  assert.deepEqual(list.entries.map((e) => e.name), ['factures', 'image.bin', 'notes.txt'], 'no hidden, secret or linked file listed');
  assert.equal((await caps.fsRead({ root: 'documents', path: 'notes.txt', maxBytes: 1000 })).text, 'pain, lait');
  assert.equal((await caps.fsRead({ root: 'f1', path: 'factures/mars.txt', maxBytes: 4 })).truncated, true);
  assert.equal(await code(caps.fsRead({ root: 'Documents', path: '.env', maxBytes: 100 })), 'forbidden');
  assert.equal(await code(caps.fsRead({ root: 'Documents', path: 'id_rsa', maxBytes: 100 })), 'forbidden');
  assert.equal(await code(caps.fsRead({ root: 'Documents', path: '../outside.txt', maxBytes: 100 })), 'forbidden');
  assert.equal(await code(caps.fsRead({ root: 'Documents', path: 'link.txt', maxBytes: 100 })), 'forbidden', 'a link cannot lead out of the folder');
  assert.equal(await code(caps.fsRead({ root: 'Documents', path: 'image.bin', maxBytes: 100 })), 'binary');
  assert.equal(await code(caps.fsRead({ root: 'Documents', path: 'nope.txt', maxBytes: 100 })), 'not_found');
  assert.equal(await code(caps.fsList({ root: 'Bureau', path: '' })), 'forbidden', 'not a shared folder');
});

test('write: read-only folders refused; never overwrites unless replace, and then the old version goes to the trash; no programs', async () => {
  const { caps, docs, trashed } = setup();
  assert.equal((await caps.fsWrite({ root: 'Documents', path: 'compte-rendu/semaine.txt', text: 'v1', mode: 'create' })).previous, null);
  assert.equal(fs.readFileSync(path.join(docs, 'compte-rendu', 'semaine.txt'), 'utf8'), 'v1');
  assert.equal(await code(caps.fsWrite({ root: 'Documents', path: 'compte-rendu/semaine.txt', text: 'v2', mode: 'create' })), 'exists');
  assert.equal((await caps.fsWrite({ root: 'Documents', path: 'compte-rendu/semaine.txt', text: 'v2', mode: 'replace' })).previous, 'trashed');
  assert.equal(trashed.length, 1);
  assert.equal(fs.readFileSync(path.join(docs, 'compte-rendu', 'semaine.txt'), 'utf8'), 'v2');
  assert.equal(await code(caps.fsWrite({ root: 'Photos', path: 'a.txt', text: 'x', mode: 'create' })), 'read_only');
  for (const name of ['run.sh', 'setup.exe', 'raccourci.lnk', 'app.desktop', 'script.ps1']) assert.equal(await code(caps.fsWrite({ root: 'Documents', path: name, text: 'x', mode: 'create' })), 'forbidden', name);
  assert.equal(await code(caps.fsWrite({ root: 'Documents', path: '.bashrc', text: 'x', mode: 'create' })), 'forbidden');
  assert.equal(await code(caps.fsWrite({ root: 'Documents', path: '../evil.txt', text: 'x', mode: 'create' })), 'forbidden');
  assert.ok(!fs.readdirSync(docs).some((n) => n.includes('.sklubot-')), 'no temporary file left');
});

test('trash: to the OS trash only, never deleted for good; not the shared folder itself; not in read-only folders', async () => {
  const { caps, docs, trashed } = setup();
  assert.deepEqual(await caps.fsTrash({ root: 'Documents', path: 'notes.txt' }), { trashed: true });
  assert.equal(trashed[0], path.join(docs, 'notes.txt'));
  assert.equal(await code(caps.fsTrash({ root: 'Documents', path: '' })), 'forbidden');
  assert.equal(await code(caps.fsTrash({ root: 'Photos', path: 'x.jpg' })), 'read_only');
});

test('protocol 1.1: fs.* arguments are validated; the core runs them without a control session but never when locked', async () => {
  assert.deepEqual(validateArgs('fs.read', { root: 'Documents', path: 'a.txt' }), { root: 'Documents', path: 'a.txt', maxBytes: 65536 });
  assert.throws(() => validateArgs('fs.write', { root: 'D', path: 'a', text: 'x', mode: 'delete' }), /mode/);
  assert.throws(() => validateArgs('fs.write', { root: 'D', path: 'a', text: 'x'.repeat(210 * 1024) }), (e) => e.code === 'too_large');
  assert.throws(() => validateArgs('fs.read', { root: 'D', path: 'a', maxBytes: 10_000_000 }), /range/);
  const h = makeCore();
  const r = await h.req('fs.list', { root: 'Documents', path: '' });
  assert.equal(r.ok, true, 'no session needed: no mouse or keyboard');
  assert.equal(h.calls.at(-1).name, 'fsList');
  assert.equal(h.prompts.length, 0);
  await h.req('fs.write', { root: 'Documents', path: 'a.txt', text: 'secret text', mode: 'create' });
  assert.ok(!JSON.stringify(h.logs).includes('secret text'), 'the local log keeps where and how much, never the content');
  h.core.stop('user');
  assert.equal((await h.req('fs.read', { root: 'Documents', path: 'a.txt' })).error.code, 'locked');
});
