// @ts-check
'use strict';
/**
 * Accessibility tree of an app on the user's computer (backlog L164): the bot reads the controls of an app (buttons,
 * fields, boxes…) with a reference for each one it can act on, then acts BY REFERENCE (press, fill, tick, choose)
 * instead of clicking at a pixel. Actions go through the system's accessibility API, so they can run in the
 * background: the pointer does not move and the app does not have to be in front. Open dialogs and sheets are reported.
 *
 * Portions adapted from vercel-labs/agent-desktop (https://github.com/vercel-labs/agent-desktop, commit
 * e8934a5e95e1d212c74ead95cd3e4701c04eca31), Copyright Vercel, Inc., Apache-2.0: the canonical role vocabulary and
 * the list of interactive roles (crates/core/src/tree/roles.rs), the macOS AXRole / AXSubrole → role tables
 * (crates/macos/src/tree/roles.rs) and the Windows UI Automation ControlType → role table with its pattern refinements
 * (crates/windows/src/tree/roles.rs), and the rule that a reference belongs to its snapshot ("@<snapshot>:e<n>", a bare
 * "@e8" is refused, a changed control is a stale reference: take a new snapshot). Modified for Sklubot: rewritten in
 * JavaScript; the tree is read by osascript (JXA, System Events) on macOS and PowerShell (System.Windows.Automation) on
 * Windows instead of the Rust adapters; no CLI, no telemetry; values of secure (password) fields are never read or
 * sent; every action goes through the Relais safety rules (guard.js) in relay-core.js before anything runs.
 *
 * Documented APIs used:
 *  - macOS: System Events "UI element" class (role, subrole, name, value, description, enabled, focused, actions,
 *    UI elements; `perform action "AXPress"`), Mac Automation Scripting Guide / System Events dictionary; needs the
 *    Accessibility permission (the same one robotjs already needs).
 *  - Windows: System.Windows.Automation (UIAutomationClient): TreeWalker.ControlViewWalker, AutomationElement.Current
 *    (ControlType, Name, IsPassword, IsEnabled, HasKeyboardFocus), InvokePattern.Invoke, ValuePattern.SetValue,
 *    TogglePattern.Toggle, SelectionItemPattern.Select, ExpandCollapsePattern.Expand, WindowPattern.Current.IsModal
 *    (https://learn.microsoft.com/dotnet/api/system.windows.automation).
 * Linux is not offered here (the bot's own Linux computer has its browser tools; AT-SPI is left for later).
 *
 * The parsing (role tables, snapshot, references, dialogs) is pure and unit-tested in test/unit/accessibility.test.js;
 * the two platform scripts can only run on a real Mac / Windows PC.
 */
const { execFile } = require('node:child_process');

// ── Vocabulary (agent-desktop crates/core/src/tree/roles.rs) ─────────────────────────────────────────────────────
/** Interactive roles that receive a reference. Read-only (statictext, image) and container roles stay out. */
const INTERACTIVE_ROLES = Object.freeze(['button', 'cell', 'checkbox', 'colorwell', 'combobox', 'dockitem', 'incrementor', 'link', 'listbox', 'menubutton', 'menuitem', 'option', 'radiobutton', 'slider', 'switch', 'tab', 'textfield', 'treeitem']);
const INTERACTIVE = new Set(INTERACTIVE_ROLES);
/** Surfaces that interrupt the app: reported as "open dialogs". */
const DIALOG_ROLES = new Set(['dialog', 'alertdialog', 'alert', 'sheet', 'popover']);
const TOGGLE_ROLES = new Set(['checkbox', 'switch', 'radiobutton']);

// ── macOS (agent-desktop crates/macos/src/tree/roles.rs) ─────────────────────────────────────────────────────────
/** @type {Record<string, string>} */
const AX_ROLE = {
  AXApplication: 'application', AXButton: 'button', AXMenuButton: 'menubutton', AXTextField: 'textfield', AXTextArea: 'textfield', AXSearchField: 'textfield', AXSecureTextField: 'textfield',
  AXCheckBox: 'checkbox', AXSwitch: 'switch', AXToggle: 'switch', AXLink: 'link', AXMenuItem: 'menuitem', AXMenuBarItem: 'menuitem', AXRadioButton: 'radiobutton', AXTab: 'tab', AXTabGroup: 'tablist',
  AXSlider: 'slider', AXValueIndicator: 'handle', AXComboBox: 'combobox', AXPopUpButton: 'combobox', AXOutlineRow: 'treeitem', AXRow: 'row', AXCell: 'cell', AXColumn: 'column', AXWindow: 'window',
  AXSheet: 'sheet', AXDialog: 'dialog', AXGroup: 'group', AXGenericElement: 'group', AXSplitGroup: 'group', AXRadioGroup: 'radiogroup', AXToolbar: 'toolbar', AXStaticText: 'statictext', AXImage: 'image',
  AXTable: 'table', AXList: 'list', AXOutline: 'outline', AXScrollArea: 'scrollarea', AXScrollBar: 'scrollbar', AXSplitter: 'splitter', AXSeparator: 'separator', AXMenu: 'menu', AXMenuBar: 'menu',
  AXIncrementor: 'incrementor', AXStepper: 'incrementor', AXDisclosureTriangle: 'disclosure', AXProgressIndicator: 'progressbar', AXBusyIndicator: 'progressbar', AXColorWell: 'colorwell', AXWebArea: 'webarea',
  AXBrowser: 'browser', AXGrid: 'grid', AXHandle: 'handle', AXPopover: 'popover', AXDockItem: 'dockitem', AXRuler: 'ruler', AXRulerMarker: 'rulermarker', AXTimeField: 'timefield', AXDateField: 'datefield',
  AXHelpTag: 'helptag', AXMatte: 'matte', AXDrawer: 'drawer', AXLayoutArea: 'layoutitem', AXLayoutItem: 'layoutitem', AXLevelIndicator: 'levelindicator', AXRelevanceIndicator: 'relevanceindicator',
  AXDocument: 'document', AXPage: 'page', AXHeading: 'heading', AXParagraph: 'paragraph', AXStatus: 'status', AXToolTip: 'tooltip',
};
/** @type {Record<string, string>} */
const AX_SUBROLE = {
  AXApplicationAlert: 'alert', AXApplicationAlertDialog: 'alertdialog', AXApplicationDialog: 'dialog', AXApplicationLog: 'log', AXApplicationMarquee: 'marquee', AXApplicationStatus: 'status',
  AXApplicationTimer: 'timer', AXDocumentArticle: 'article', AXDocumentMath: 'math', AXDocumentNote: 'note', AXDocumentRegion: 'region', AXLandmarkBanner: 'banner', AXLandmarkComplementary: 'complementary',
  AXLandmarkContentInfo: 'contentinfo', AXLandmarkForm: 'form', AXLandmarkMain: 'main', AXLandmarkNavigation: 'navigation', AXLandmarkSearch: 'search', AXDefinition: 'definition', AXTerm: 'term',
  AXTabPanel: 'tabpanel', AXUserInterfaceTooltip: 'tooltip', AXOutlineRow: 'treeitem', AXTableRow: 'row', AXSecureTextField: 'textfield', AXSearchField: 'textfield', AXDialog: 'dialog', AXSystemDialog: 'dialog',
  AXCloseButton: 'button', AXMinimizeButton: 'button', AXZoomButton: 'button', AXToolbarButton: 'button', AXFullScreenButton: 'button', AXSortButton: 'button', AXToggle: 'switch', AXSwitch: 'switch',
  AXContentList: 'list', AXDefinitionList: 'list', AXDescriptionList: 'list', AXSeparatorDockItem: 'separator',
};
/** @type {Record<string, string>} */
const AX_SUBROLE_NAME = { AXCloseButton: 'Close', AXMinimizeButton: 'Minimize', AXZoomButton: 'Zoom', AXFullScreenButton: 'Full Screen' };

/** @param {string} role @param {string|null|undefined} subrole */
function macRole(role, subrole) {
  const base = AX_ROLE[role] || 'unknown';
  if (subrole === 'AXToggleButton') return TOGGLE_ROLES.has(base) ? base : 'button';
  return (subrole && AX_SUBROLE[subrole]) || base;
}

// ── Windows (agent-desktop crates/windows/src/tree/roles.rs) ─────────────────────────────────────────────────────
/** ControlType programmatic names ("ControlType.Button" or "Button") → role; refined by the patterns the element offers. */
/** @type {Record<string, string | ((p: Set<string>, n: any) => string)>} */
const UIA_ROLE = {
  Button: (p) => (p.has('Toggle') ? 'switch' : p.has('ExpandCollapse') ? 'menubutton' : 'button'),
  Calendar: 'group', CheckBox: 'checkbox', ComboBox: 'combobox', Edit: 'textfield', Hyperlink: 'link', Image: 'image', ListItem: 'option',
  List: (p) => (p.has('Selection') ? 'listbox' : 'list'),
  Menu: 'menu', MenuBar: 'menu', MenuItem: 'menuitem', ProgressBar: 'progressbar', RadioButton: 'radiobutton', ScrollBar: 'scrollbar', Slider: 'slider', Spinner: 'incrementor', StatusBar: 'status',
  Tab: 'tablist', TabItem: 'tab', Text: 'statictext', ToolBar: 'toolbar', ToolTip: 'tooltip', Tree: 'outline', TreeItem: 'treeitem',
  Custom: (p) => (p.has('GridItem') || p.has('TableItem') ? 'cell' : 'unknown'),
  Group: 'group', Thumb: 'handle', DataGrid: 'grid',
  DataItem: (p) => (p.has('GridItem') || p.has('TableItem') ? 'cell' : 'row'),
  Document: (p, n) => (p.has('Value') && n && n.ro === false ? 'textfield' : 'document'),
  SplitButton: 'menubutton',
  Window: (_p, n) => (n && n.modal === true ? 'dialog' : 'window'),
  Pane: (p, n) => (p.has('Window') || (n && n.dialog === true) ? 'dialog' : 'group'),
  Header: 'group', HeaderItem: 'column', Table: 'table', TitleBar: 'group', Separator: 'separator', SemanticZoom: 'group', AppBar: 'toolbar',
};
/** @param {string} controlType @param {string[]} patterns @param {any} [node] */
function winRole(controlType, patterns = [], node) {
  const key = String(controlType || '').replace(/^ControlType\./, '');
  const m = Object.prototype.hasOwnProperty.call(UIA_ROLE, key) ? UIA_ROLE[key] : undefined;
  if (!m) return 'unknown';
  return typeof m === 'function' ? m(new Set(patterns), node) : m;
}

// ── Snapshot ─────────────────────────────────────────────────────────────────────────────────────────────────────
const MAX_NODES = 600;
const MAX_ELEMENTS = 300;
const MAX_DEPTH = 30;
const clean = (/** @type {unknown} */ s, n = 200) => String(s ?? '').replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩​-‏]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

/**
 * @typedef {{ r?: string, s?: string, n?: string, t?: string, v?: string, d?: string, e?: boolean, f?: boolean, sec?: boolean, pt?: string[], modal?: boolean, dialog?: boolean, ro?: boolean, c?: RawNode[] }} RawNode
 * @typedef {{ app?: string, bundle?: string, pid?: number, frontmost?: boolean, windows?: RawNode[], truncated?: boolean }} RawTree
 * @typedef {{ ref: string, role: string, name: string, value?: string, secure?: boolean, enabled: boolean, focused?: boolean, depth: number, path: string, inDialog?: string }} Element
 * @typedef {{ snapshotId: string, app: string, bundle: string, pid: number|null, platform: string, complete: boolean, elements: Element[], dialogs: { role: string, name: string, path: string }[], windows: string[] }} Snapshot
 */

/**
 * Turns a raw tree read by the platform script into a snapshot: canonical roles, a reference for each interactive
 * element ("@<snapshot>:e<n>"), open dialogs, and never the value of a secure field.
 * @param {RawTree} raw @param {{ platform: string, snapshotId: string, interactiveOnly?: boolean }} o @returns {Snapshot}
 */
function buildSnapshot(raw, o) {
  /** @type {Element[]} */
  const elements = [];
  /** @type {Snapshot['dialogs']} */
  const dialogs = [];
  /** @type {string[]} */
  const windows = [];
  let seen = 0, complete = !raw.truncated, n = 0;
  const roleOf = (/** @type {RawNode} */ x) => (o.platform === 'win32' ? winRole(String(x.r || ''), x.pt || [], x) : macRole(String(x.r || ''), x.s));
  /** @param {RawNode} x @param {string} path @param {number} depth @param {string|undefined} dialog */
  const walk = (x, path, depth, dialog) => {
    if (seen >= MAX_NODES || elements.length >= MAX_ELEMENTS) { complete = false; return; }
    seen++;
    const role = roleOf(x);
    const secure = x.sec === true || x.s === 'AXSecureTextField';
    const name = clean(x.n || x.t || (x.s && AX_SUBROLE_NAME[x.s]) || x.d || '', 120);
    let here = dialog;
    if (DIALOG_ROLES.has(role)) { dialogs.push({ role, name, path }); here = name || role; }
    if (depth === 0) windows.push(name);
    if (INTERACTIVE.has(role) || (!o.interactiveOnly && name && role !== 'unknown' && role !== 'group')) {
      /** @type {Element} */
      const el = { ref: INTERACTIVE.has(role) ? `@${o.snapshotId}:e${++n}` : '', role, name, enabled: x.e !== false, depth, path };
      if (secure) el.secure = true;
      else if (x.v !== undefined && x.v !== null && String(x.v) !== '' && role !== 'statictext') el.value = clean(x.v, 200);
      if (x.f === true) el.focused = true;
      if (here) el.inDialog = here;
      if (el.ref || !o.interactiveOnly) elements.push(el);
    }
    if (depth >= MAX_DEPTH) { if ((x.c || []).length) complete = false; return; }
    (x.c || []).forEach((ch, i) => walk(ch, `${path}.${i}`, depth + 1, here));
  };
  (raw.windows || []).forEach((w, i) => walk(w, String(i), 0, undefined));
  return { snapshotId: o.snapshotId, app: clean(raw.app, 100), bundle: clean(raw.bundle, 200), pid: Number.isInteger(raw.pid) ? /** @type {number} */ (raw.pid) : null, platform: o.platform, complete, elements, dialogs, windows };
}

/** Actions by reference, and which roles they fit. */
const ACTIONS = Object.freeze(['press', 'set_value', 'focus', 'toggle', 'select', 'expand']);
/** @param {string} action @param {string} role */
function actionFits(action, role) {
  if (action === 'set_value') return role === 'textfield' || role === 'combobox' || role === 'slider' || role === 'incrementor';
  if (action === 'toggle') return TOGGLE_ROLES.has(role);
  if (action === 'select') return ['option', 'tab', 'treeitem', 'cell', 'radiobutton', 'menuitem'].includes(role);
  if (action === 'expand') return ['combobox', 'menubutton', 'treeitem', 'disclosure'].includes(role);
  return true;
}

class AxError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) { super(message); this.code = code; }
}

const REF_RE = /^@([a-z0-9]{4,16}):e(\d{1,4})$/;
/**
 * The element a reference names, in one of the snapshots kept. A bare "@e8", an unknown snapshot or an unknown element
 * is refused (stale_ref): the bot takes a new snapshot.
 * @param {Map<string, Snapshot>} kept @param {string} ref @returns {{ snap: Snapshot, el: Element }}
 */
function resolveRef(kept, ref) {
  const m = REF_RE.exec(String(ref || '').trim());
  if (!m) throw new AxError('invalid_args', 'a reference looks like @s1a2b3:e8 (from my_ui_tree); a bare @e8 is not accepted');
  const snap = kept.get(m[1]);
  if (!snap) throw new AxError('stale_ref', 'this reference belongs to an old snapshot: read the app again');
  const el = snap.elements.find((e) => e.ref === ref.trim());
  if (!el) throw new AxError('stale_ref', 'no such element in that snapshot: read the app again');
  return { snap, el };
}

/** Keeps the last few snapshots (references stay valid until the app is read again a few times). */
class SnapshotStore {
  constructor(max = 3) { this.max = max; /** @type {Map<string, Snapshot>} */ this.map = new Map(); this.seq = 0; }
  nextId() { return `s${(Date.now() % 1e6).toString(36)}${(++this.seq).toString(36)}`.slice(0, 16); }
  /** @param {Snapshot} s */
  add(s) { this.map.set(s.snapshotId, s); while (this.map.size > this.max) this.map.delete(/** @type {string} */ (this.map.keys().next().value)); }
  clear() { this.map.clear(); }
}

// ── Platform scripts (only on a real Mac / PC) ───────────────────────────────────────────────────────────────────
/** JXA: reads the app named (or the one in front) as a RawTree on stdout. argv[0] is a JSON of options. */
const MAC_TREE = `function run(argv){var o=JSON.parse(argv[0]);var se=Application('System Events');
var ps=o.app?se.processes.whose({name:o.app}):se.processes.whose({frontmost:true});if(!ps.length)return JSON.stringify({error:'not_found'});
var p=ps[0];var count=0,max=o.maxNodes||600,trunc=false;
function g(f){try{var v=f();return v===null||v===undefined?undefined:v}catch(e){return undefined}}
function walk(el,d){if(count>=max){trunc=true;return null}count++;var r=g(function(){return el.role()}),s=g(function(){return el.subrole()});
var n={r:r,s:s,n:g(function(){return el.name()}),t:g(function(){return el.title()}),d:g(function(){return el.description()}),e:g(function(){return el.enabled()}),f:g(function(){return el.focused()})};
if(s==='AXSecureTextField')n.sec=true;else{var v=g(function(){return el.value()});if(v!==undefined&&typeof v!=='object')n.v=String(v).slice(0,200)}
if(d<o.maxDepth){var kids=g(function(){return el.uiElements()})||[];n.c=[];for(var i=0;i<kids.length&&!trunc;i++){var k=walk(kids[i],d+1);if(k)n.c.push(k)}}return n}
var ws=g(function(){return p.windows()})||[];var out=[];for(var i=0;i<ws.length&&i<4;i++){var w=walk(ws[i],0);if(w)out.push(w)}
return JSON.stringify({app:g(function(){return p.name()}),bundle:g(function(){return p.bundleIdentifier()}),pid:g(function(){return p.unixId()}),frontmost:g(function(){return p.frontmost()}),windows:out,truncated:trunc})}`;

/** JXA: finds the element at a path, checks it is still the same (role, name), then acts. */
const MAC_ACT = `function run(argv){var o=JSON.parse(argv[0]);var se=Application('System Events');
var ps=se.processes.whose({unixId:o.pid});if(!ps.length)return JSON.stringify({error:'stale_ref'});var p=ps[0];
function g(f){try{return f()}catch(e){return undefined}}
var idx=o.path.split('.').map(Number);var el=g(function(){return p.windows()[idx[0]]});
for(var i=1;el&&i<idx.length;i++){var k=g(function(){return el.uiElements()});el=k&&k[idx[i]]}
if(!el)return JSON.stringify({error:'stale_ref'});
var r=g(function(){return el.role()}),s=g(function(){return el.subrole()}),nm=g(function(){return el.name()})||g(function(){return el.title()})||g(function(){return el.description()})||'';
if(r!==o.role||String(nm).replace(/\\s+/g,' ').trim().slice(0,120)!==o.name)return JSON.stringify({error:'stale_ref'});
if(o.action==='set_value'){if(s==='AXSecureTextField')return JSON.stringify({error:'password_field'});el.value=o.text}
else if(o.action==='focus'){el.focused=true}
else{var a=o.action==='expand'?'AXShowMenu':'AXPress';var acts=g(function(){return el.actions().map(function(x){return x.name()})})||[];
if(acts.indexOf(a)<0)a=acts.indexOf('AXPress')>=0?'AXPress':acts[0];if(!a)return JSON.stringify({error:'unsupported'});el.actions.byName(a).perform()}
return JSON.stringify({done:true})}`;

/** PowerShell: reads the app (process name) or the window in front as a RawTree. $o is the options object. */
const WIN_COMMON = `Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes;$A=[System.Windows.Automation.AutomationElement];
$W=[System.Windows.Automation.TreeWalker]::ControlViewWalker;
function Pats($e){$l=@();foreach($p in $e.GetSupportedPatterns()){$l+=($p.ProgrammaticName -replace 'PatternIdentifiers.Pattern','' -replace 'Pattern','')};$l}
function Kids($e){$l=@();$c=$W.GetFirstChild($e);while($c -ne $null){$l+=$c;$c=$W.GetNextSibling($c)};$l}
function Top($o){if($o.app){$pr=Get-Process -Name $o.app -ErrorAction SilentlyContinue|Where-Object{$_.MainWindowHandle -ne 0}|Select-Object -First 1;if(!$pr){return $null};return $A::FromHandle($pr.MainWindowHandle)}
Add-Type -Namespace Sk -Name U -MemberDefinition '[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();';return $A::FromHandle([Sk.U]::GetForegroundWindow())}`;
const WIN_TREE = `${WIN_COMMON}
$o=[Console]::In.ReadToEnd()|ConvertFrom-Json;$script:n=0;$script:t=$false;
function Walk($e,$d){if($script:n -ge $o.maxNodes){$script:t=$true;return $null};$script:n++;$c=$e.Current;$pt=@(Pats $e);
$h=[ordered]@{r=$c.ControlType.ProgrammaticName;n=$c.Name;e=$c.IsEnabled;f=$c.HasKeyboardFocus;pt=$pt};
if($c.IsPassword){$h.sec=$true}elseif($pt -contains 'Value'){try{$vp=$e.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern);$h.v=[string]$vp.Current.Value;$h.ro=$vp.Current.IsReadOnly}catch{}}
if($pt -contains 'Window'){try{$h.modal=$e.GetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern).Current.IsModal}catch{}}
if($d -lt $o.maxDepth){$h.c=@();foreach($k in (Kids $e)){if($script:t){break};$x=Walk $k ($d+1);if($x){$h.c+=$x}}};$h}
$top=Top $o;if(!$top){'{"error":"not_found"}';exit};$pr=Get-Process -Id $top.Current.ProcessId;
$w=Walk $top 0;[ordered]@{app=$pr.ProcessName;pid=$pr.Id;windows=@($w);truncated=$script:t}|ConvertTo-Json -Depth 64 -Compress`;
const WIN_ACT = `${WIN_COMMON}
$o=[Console]::In.ReadToEnd()|ConvertFrom-Json;$pr=Get-Process -Id $o.pid -ErrorAction SilentlyContinue;if(!$pr){'{"error":"stale_ref"}';exit}
$e=$A::FromHandle($pr.MainWindowHandle);$idx=$o.path.Split('.');for($i=1;$e -and $i -lt $idx.Length;$i++){$k=@(Kids $e);$e=$k[[int]$idx[$i]]}
if(!$e -or $e.Current.ControlType.ProgrammaticName -ne $o.role -or (($e.Current.Name -replace '\\s+',' ').Trim()) -ne $o.name){'{"error":"stale_ref"}';exit}
$P=[System.Windows.Automation.InvokePattern];try{switch($o.action){
'set_value'{if($e.Current.IsPassword){'{"error":"password_field"}';exit};$e.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).SetValue($o.text)}
'focus'{$e.SetFocus()}
'toggle'{$e.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern).Toggle()}
'select'{$e.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Select()}
'expand'{$e.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern).Expand()}
default{$e.GetCurrentPattern($P::Pattern).Invoke()}}}catch{'{"error":"unsupported"}';exit};'{"done":true}'`;

/** @param {string} file @param {string[]} args @param {string} [input] @returns {Promise<string>} */
function runScript(file, args, input) {
  return new Promise((resolve, reject) => {
    const child = execFile(file, args, { timeout: 20_000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => (err ? reject(err) : resolve(String(stdout))));
    if (input !== undefined && child.stdin) { child.stdin.end(input); }
  });
}

/** Parses what a platform script printed. @param {string} out */
function parseOutput(out) {
  let v;
  try { v = JSON.parse(String(out).trim() || '{}'); } catch { throw new AxError('internal', 'unreadable answer from the accessibility script'); }
  if (v && typeof v.error === 'string') throw new AxError(v.error === 'not_found' ? 'not_found' : v.error, `accessibility: ${v.error}`);
  return v;
}

/**
 * The capabilities (macOS and Windows only). `run` is replaceable in tests.
 * @param {{ platform?: string, run?: typeof runScript, trusted?: () => boolean }} [o]
 */
function createAccessibilityCaps(o = {}) {
  const platform = o.platform || process.platform;
  const run = o.run || runScript;
  const store = new SnapshotStore();
  const supported = platform === 'darwin' || platform === 'win32';
  const check = () => {
    if (!supported) throw new AxError('unsupported', 'the accessibility tree is offered on macOS and Windows only');
    if (platform === 'darwin' && o.trusted && !o.trusted()) throw new AxError('permission_missing', 'macOS permission missing: Accessibility. The user must allow it in System Settings › Privacy & Security.');
  };
  /** @param {{ app?: string|null, interactiveOnly?: boolean }} a */
  async function readRaw(a) {
    const opts = { app: a.app || null, maxNodes: MAX_NODES, maxDepth: MAX_DEPTH };
    const out = platform === 'darwin' ? await run('osascript', ['-l', 'JavaScript', '-e', MAC_TREE, JSON.stringify(opts)]) : await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WIN_TREE], JSON.stringify(opts));
    return /** @type {RawTree} */ (parseOutput(out));
  }
  return {
    store,
    /** Reads the app (no snapshot kept yet: relay-core checks the app first with `peek`). */
    readRaw: async (/** @type {any} */ a) => { check(); return readRaw(a); },
    /** @param {RawTree} raw @param {boolean} interactiveOnly */
    keep(raw, interactiveOnly) { const s = buildSnapshot(raw, { platform, snapshotId: store.nextId(), interactiveOnly }); rememberNative(s, raw); store.add(s); return s; },
    /** @param {{ snap: Snapshot, el: Element, action: string, text?: string }} a */
    async act(a) {
      check();
      const nat = nativeRoleOf(a.snap, a.el);
      const opts = { pid: a.snap.pid, path: a.el.path, role: nat.r, name: nat.name, action: a.action, text: a.text ?? '' };
      // The text goes on standard input on Windows (never in the process arguments); osascript only takes arguments.
      const out = platform === 'darwin' ? await run('osascript', ['-l', 'JavaScript', '-e', MAC_ACT, JSON.stringify(opts)]) : await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WIN_ACT], JSON.stringify(opts));
      return parseOutput(out);
    },
  };
}

/** The native role the act script compares with (kept from the raw tree at snapshot time). */
const nativeRoles = new WeakMap();
/** @param {Snapshot} snap @param {Element} el */
function nativeRoleOf(snap, el) { const m = nativeRoles.get(snap); return (m && m.get(el.path)) || { r: '', name: '' }; }
/** Remembers, for each element of a snapshot, the native role read (AXButton, ControlType.Button…). @param {Snapshot} snap @param {RawTree} raw */
function rememberNative(snap, raw) {
  const m = new Map();
  const walk = (/** @type {RawNode} */ x, /** @type {string} */ p) => { m.set(p, { r: String(x.r || ''), name: String(x.n || x.t || x.d || '').replace(/\s+/g, ' ').trim().slice(0, 120) }); (x.c || []).forEach((c, i) => walk(c, `${p}.${i}`)); };
  (raw.windows || []).forEach((w, i) => walk(w, String(i)));
  nativeRoles.set(snap, m);
}

/** The snapshot as lines for the model (role, name, value, reference), dialogs first. @param {Snapshot} s */
function renderSnapshot(s) {
  const lines = [];
  if (s.dialogs.length) lines.push(`Open dialogs: ${s.dialogs.map((d) => `${d.role} “${d.name || '—'}”`).join(', ')}`);
  for (const e of s.elements) {
    const bits = [`${'  '.repeat(Math.min(e.depth, 8))}- ${e.role}`, e.name ? `“${e.name}”` : ''];
    if (e.secure) bits.push('(password field: the user types it)');
    else if (e.value !== undefined) bits.push(`= “${e.value}”`);
    if (!e.enabled) bits.push('(disabled)');
    if (e.focused) bits.push('(focus)');
    if (e.ref) bits.push(`[${e.ref}]`);
    lines.push(bits.filter(Boolean).join(' '));
  }
  if (!s.complete) lines.push('… (more controls not shown: the app is large)');
  return lines.join('\n');
}

module.exports = {
  INTERACTIVE_ROLES, DIALOG_ROLES, ACTIONS, macRole, winRole, buildSnapshot, resolveRef, actionFits, renderSnapshot, SnapshotStore, AxError,
  createAccessibilityCaps, rememberNative, parseOutput, MAC_TREE, MAC_ACT, WIN_TREE, WIN_ACT, MAX_NODES,
};
