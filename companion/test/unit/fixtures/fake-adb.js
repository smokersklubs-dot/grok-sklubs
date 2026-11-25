#!/usr/bin/env node
'use strict';
// A fake `adb` for the tests (never the real one): answers from $FAKE_ADB_DIR/state.json and writes every call
// (its argument list) to $FAKE_ADB_DIR/calls.jsonl.
const fs = require('node:fs');
const path = require('node:path');
const dir = process.env.FAKE_ADB_DIR;
const args = process.argv.slice(2);
fs.appendFileSync(path.join(dir, 'calls.jsonl'), JSON.stringify(args) + '\n');
const st = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
const out = (s) => process.stdout.write(s);
if (args[0] === 'version') { out('Android Debug Bridge version 1.0.41\nVersion 35.0.2-12147458\n'); process.exit(0); }
if (args[0] === 'devices') {
  out('List of devices attached\n');
  for (const d of st.devices) out(`${d.serial}\t${d.state}${d.state === 'device' ? ` usb:1-1 product:${d.product || 'x'} model:${d.model} device:${d.device || 'x'} transport_id:1` : ' usb:1-1 transport_id:2'}\n`);
  out('\n');
  process.exit(0);
}
if (args[0] !== '-s') { process.stderr.write('error: unknown command\n'); process.exit(1); }
const serial = args[1];
const dev = st.devices.find((d) => d.serial === serial);
if (!dev) { process.stderr.write(`adb: device '${serial}' not found\n`); process.exit(1); }
if (dev.state !== 'device') { process.stderr.write('adb: device unauthorized.\n'); process.exit(1); }
const cmd = args.slice(2);
const line = cmd.slice(1).join(' ');
if (cmd[0] === 'exec-out' && cmd[1] === 'screencap') { process.stdout.write(Buffer.from(st.png, 'base64')); process.exit(0); }
if (cmd[0] === 'exec-out' && cmd[1] === 'cat') { out(st.ui); process.exit(0); }
if (cmd[0] === 'shell') {
  if (line.startsWith('getprop')) { out(`${dev.android}\n${dev.sdk}\n${dev.model.replace(/_/g, ' ')}\n`); process.exit(0); }
  if (line.startsWith('dumpsys window')) { out(st.focus ? `  mCurrentFocus=Window{a1b2c3 u0 ${st.focus}/${st.focus}.MainActivity}\n` : '  mCurrentFocus=null\n'); process.exit(0); }
  if (line.startsWith('uiautomator dump')) { out('UI hierchary dumped to: /sdcard/sklubot-ui.xml\n'); process.exit(0); }
  if (line.startsWith('monkey')) { out(st.noApp ? '** No activities found to run, monkey aborted.\n' : 'Events injected: 1\n'); process.exit(0); }
  if (/^(input|rm) /.test(line)) process.exit(0);
}
process.stderr.write(`fake adb: not handled: ${args.join(' ')}\n`);
process.exit(1);
