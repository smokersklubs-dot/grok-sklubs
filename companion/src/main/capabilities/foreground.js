// @ts-check
'use strict';
/**
 * The window in front, read right before the relay types or clicks (backlog L19): which app, which window, and whether
 * a password field has the keyboard focus. Read through the system's own tools, never through a shell:
 *
 * - macOS: `osascript` with System Events (needs the Accessibility permission the relay already asks for):
 *   the frontmost application process, its front window's name and the focused element's subrole. A password field
 *   reports the subrole "AXSecureTextField" (NSAccessibilitySecureTextFieldSubrole,
 *   https://developer.apple.com/documentation/appkit/nsaccessibility/subrole/securetextfield).
 * - Windows: PowerShell with user32 GetForegroundWindow / GetWindowText / GetWindowThreadProcessId
 *   (https://learn.microsoft.com/windows/win32/api/winuser/nf-winuser-getforegroundwindow) and UI Automation
 *   AutomationElement.FocusedElement → Current.IsPassword
 *   (https://learn.microsoft.com/dotnet/api/system.windows.automation.automationelement.automationelementinformation.ispassword).
 * - Linux (X11): `xprop -root _NET_ACTIVE_WINDOW`, then `xprop -id <window> WM_CLASS _NET_WM_NAME _NET_WM_PID`
 *   (man xprop; EWMH, https://specifications.freedesktop.org/wm-spec/latest/). Whether a password field has focus is
 *   not read on Linux (null): the relay then refuses to type in a window whose title looks like a sign-in screen.
 *
 * Returns null when nothing could be read: the relay then refuses to type or click (fail closed).
 *
 * For a web browser in front (vault fill, guard.js vaultVerdict) the page address is read too, or left null:
 * - macOS: AppleScript of the browser itself — Safari `URL of front document`, Chromium browsers `URL of active tab of
 *   front window` (each browser's scripting dictionary); Firefox has none (null).
 * - Windows: UI Automation, the first Edit control of the window and its ValuePattern
 *   (https://learn.microsoft.com/dotnet/api/system.windows.automation.valuepattern) — the address bar of Chromium
 *   browsers and Firefox.
 * - Linux: not read (null): vault fill in a browser is refused there.
 */
const { execFile } = require('node:child_process');

const MAC_SCRIPT = [
  'tell application "System Events"',
  '  set p to first application process whose frontmost is true',
  '  set n to name of p',
  '  set b to ""',
  '  try',
  '    set b to bundle identifier of p',
  '  end try',
  '  set u to unix id of p',
  '  set t to ""',
  '  try',
  '    set t to name of front window of p',
  '  end try',
  '  set r to ""',
  '  try',
  '    set r to subrole of (value of attribute "AXFocusedUIElement" of p)',
  '  end try',
  '  return n & linefeed & b & linefeed & u & linefeed & t & linefeed & r',
  'end tell',
].join('\n');

const WIN_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  'Add-Type -TypeDefinition @"',
  'using System; using System.Runtime.InteropServices; using System.Text;',
  'public static class SkFg {',
  '  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();',
  '  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);',
  '  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);',
  '}',
  '"@',
  '$h = [SkFg]::GetForegroundWindow()',
  '$sb = New-Object System.Text.StringBuilder 512',
  '[void][SkFg]::GetWindowText($h, $sb, 512)',
  '[uint32]$fgPid = 0',
  '[void][SkFg]::GetWindowThreadProcessId($h, [ref]$fgPid)',
  '$name = ""',
  'try { $name = (Get-Process -Id $fgPid).ProcessName } catch {}',
  '$pw = $null',
  'try { Add-Type -AssemblyName UIAutomationClient; $pw = [System.Windows.Automation.AutomationElement]::FocusedElement.Current.IsPassword } catch {}',
  '$url = $null',
  "if ($name -match '^(chrome|msedge|brave|vivaldi|opera|firefox|chromium)$') { try { $root = [System.Windows.Automation.AutomationElement]::FromHandle($h); $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit); $e = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond); $url = $e.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value } catch {} }",
  '[pscustomobject]@{ app = $name; pid = [int]$fgPid; windowId = [string][int64]$h; title = $sb.ToString(); password = $pw; url = $url } | ConvertTo-Json -Compress',
].join('\n');

/** @param {string} out */
function parseMac(out) {
  const [app, bundle, pid, title, subrole] = String(out).replace(/\r/g, '').split('\n');
  if (!app) return null;
  return { app: app.trim(), bundle: (bundle || '').trim(), pid: Number(pid) || null, windowId: null, title: (title || '').trim(), passwordField: (subrole || '').trim() === 'AXSecureTextField' };
}

/** @param {string} out */
function parseWin(out) {
  let j;
  try { j = JSON.parse(String(out).trim()); } catch { return null; }
  if (!j || typeof j.app !== 'string' || !j.app) return null;
  return { app: j.app, bundle: '', pid: Number(j.pid) || null, windowId: j.windowId ? String(j.windowId) : null, title: String(j.title || ''), passwordField: j.password === true ? true : j.password === false ? false : null, url: typeof j.url === 'string' && j.url ? j.url.slice(0, 2048) : null };
}

/** "_NET_ACTIVE_WINDOW(WINDOW): window id # 0x3a00007" → "0x3a00007" (null for none / 0x0). @param {string} out */
function parseXpropRoot(out) {
  const m = /window id # (0x[0-9a-f]+)/i.exec(String(out));
  return m && !/^0x0+$/i.test(m[1]) ? m[1] : null;
}

/**
 * WM_CLASS(STRING) = "gnome-terminal-server", "Gnome-terminal"
 * _NET_WM_NAME(UTF8_STRING) = "lea@pc: ~"
 * _NET_WM_PID(CARDINAL) = 4242
 * @param {string} out @param {string} windowId
 */
function parseXpropWindow(out, windowId) {
  const s = String(out);
  const cls = /WM_CLASS\([^)]*\) = "([^"]*)"(?:, "([^"]*)")?/.exec(s);
  const name = /_NET_WM_NAME\([^)]*\) = "((?:[^"\\]|\\.)*)"/.exec(s);
  const pid = /_NET_WM_PID\([^)]*\) = (\d+)/.exec(s);
  if (!cls) return null;
  return { app: cls[2] || cls[1], bundle: cls[1], pid: pid ? Number(pid[1]) : null, windowId, title: name ? name[1].replace(/\\(.)/g, '$1') : '', passwordField: null };
}

/** @param {string} file @param {string[]} args @returns {Promise<string>} */
function run(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: 8000, windowsHide: true, maxBuffer: 256 * 1024 }, (err, stdout) => (err ? reject(err) : resolve(String(stdout))));
  });
}

/** @param {string} [platform] */
/** The AppleScript that reads the address of the page in front, for a browser that has one. @param {string} app */
function macUrlScript(app) {
  if (app === 'Safari') return 'tell application "Safari" to get URL of front document';
  if (['Google Chrome', 'Chromium', 'Microsoft Edge', 'Brave Browser', 'Vivaldi', 'Arc', 'Opera'].includes(app)) return `tell application "${app}" to get URL of active tab of front window`;
  return null;
}

async function readForeground(platform = process.platform) {
  try {
    if (platform === 'darwin') {
      const a = parseMac(await run('osascript', ['-e', MAC_SCRIPT]));
      const script = a && macUrlScript(a.app);
      if (a && script) { try { return { ...a, url: (await run('osascript', ['-e', script])).trim().slice(0, 2048) || null }; } catch { return { ...a, url: null }; } }
      return a;
    }
    if (platform === 'win32') return parseWin(await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WIN_SCRIPT]));
    const id = parseXpropRoot(await run('xprop', ['-root', '_NET_ACTIVE_WINDOW']));
    if (!id) return null;
    return parseXpropWindow(await run('xprop', ['-id', id, 'WM_CLASS', '_NET_WM_NAME', '_NET_WM_PID']), id);
  } catch {
    return null;
  }
}

module.exports = { readForeground, parseMac, parseWin, parseXpropRoot, parseXpropWindow, macUrlScript };
