// @ts-check
'use strict';
/**
 * shell.run: runs one command with the user's default shell (`/bin/sh` on macOS/Linux,
 * `cmd.exe` on Windows — Node's `shell: true`, https://nodejs.org/api/child_process.html#shell-requirements),
 * with a timeout and an output cap. The whole process tree is killed on timeout/cancel.
 * Called only after RelayCore checked local consent.
 */
const { spawn, execFile } = require('node:child_process');
const os = require('node:os');
const fs = require('node:fs');

/**
 * `onChunk`: each piece of output as it comes (streamed to Sklubot as `shell.output` events by RelayCore).
 * @param {{ command: string, timeoutMs: number, maxOutputBytes: number, cwd: string|null, signal?: AbortSignal, onChunk?: (stream: 'stdout'|'stderr', text: string) => void }} a
 * @returns {Promise<{ exitCode: number|null, signal: string|null, stdout: string, stderr: string, truncated: boolean, timedOut: boolean, cancelled: boolean, durationMs: number }>}
 */
function runShell(a) {
  return new Promise((resolve) => {
    const started = Date.now();
    let cwd = os.homedir();
    if (a.cwd) {
      try { if (fs.statSync(a.cwd).isDirectory()) cwd = a.cwd; } catch { /* keep home */ }
    }
    const win = process.platform === 'win32';
    const child = spawn(a.command, {
      shell: true,
      cwd,
      windowsHide: true,
      detached: !win, // own process group so the whole tree can be killed
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
    /** @type {Buffer[]} */ const out = [];
    /** @type {Buffer[]} */ const err = [];
    let size = 0;
    let truncated = false;
    let timedOut = false;
    let cancelled = false;
    let done = false;

    const kill = () => {
      if (child.exitCode !== null || child.pid === undefined) return;
      if (win) {
        // taskkill /T kills the tree, /F forces: https://learn.microsoft.com/windows-server/administration/windows-commands/taskkill
        execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => {});
      } else {
        try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* gone */ } }
      }
    };
    /** @param {Buffer[]} bucket @param {'stdout'|'stderr'} stream */
    const collect = (bucket, stream) => (/** @type {Buffer} */ chunk) => {
      if (a.onChunk) { try { a.onChunk(stream, chunk.toString('utf8')); } catch { /* the stream is best effort */ } }
      if (size >= a.maxOutputBytes) { truncated = true; return; }
      const room = a.maxOutputBytes - size;
      const part = chunk.length > room ? chunk.subarray(0, room) : chunk;
      if (part.length < chunk.length) truncated = true;
      bucket.push(part);
      size += part.length;
    };
    child.stdout.on('data', collect(out, 'stdout'));
    child.stderr.on('data', collect(err, 'stderr'));

    const timer = setTimeout(() => { timedOut = true; kill(); }, a.timeoutMs);
    const onAbort = () => { cancelled = true; kill(); };
    if (a.signal) {
      if (a.signal.aborted) onAbort();
      else a.signal.addEventListener('abort', onAbort, { once: true });
    }
    /** @param {number|null} code @param {NodeJS.Signals|null} sig */
    const finish = (code, sig) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (a.signal) a.signal.removeEventListener('abort', onAbort);
      resolve({
        exitCode: code,
        signal: sig,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
        truncated,
        timedOut,
        cancelled,
        durationMs: Date.now() - started,
      });
    };
    child.on('error', (e) => { err.push(Buffer.from(String(e.message))); finish(null, null); });
    child.on('close', finish);
  });
}

module.exports = { runShell };
