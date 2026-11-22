/** « Règles de sécurité » of a linked computer (server relayguardroutes.ts), for the dev gallery. Development only. */
export function relayGuardFixture(empty: boolean, patch: { keepApps?: string[]; keepFolders?: string[]; projectFolders?: string[]; allowTerminal?: boolean; commandTimeout?: number } = {}) {
  return {
    guard: {
      keepApps: patch.keepApps ?? (empty ? [] : ["Banque Populaire", "Signal"]),
      keepFolders: patch.keepFolders ?? (empty ? [] : ["/Users/lea/Impots", "Medical"]),
      projectFolders: patch.projectFolders ?? (empty ? [] : ["~/projets/site"]),
      allowTerminal: patch.allowTerminal ?? true,
      commandTimeout: patch.commandTimeout ?? 120,
      updatedAt: empty ? null : Date.now() - 3_600_000,
    },
    limit: 50,
    timeout: { min: 5, max: 3600 },
    builtin: {
      floor: ["delete", "git", "admin", "install", "disk", "perms", "remote_script", "network", "startup", "outside"],
      apps: [
        { group: "terminal", names: ["Terminal", "iTerm2", "Windows Terminal", "PowerShell", "GNOME Terminal", "Konsole"] },
        { group: "scripts", names: ["Script Editor", "Automator", "Registry Editor"] },
        { group: "settings", names: ["System Settings", "Control Panel", "Task Manager", "Activity Monitor"] },
        { group: "passwords", names: ["1Password", "Bitwarden", "KeePassXC", "Keychain Access", "Ledger Live"] },
        { group: "self", names: ["Sklubot"] },
      ],
      shortcuts: [
        { combo: "alt+f4", why: "close", platforms: ["win32", "linux"], ownApp: true },
        { combo: "command+q", why: "close", platforms: ["darwin"], ownApp: true },
        { combo: "control+alt+delete", why: "system", platforms: null, ownApp: false },
        { combo: "command+l", why: "lock", platforms: ["win32", "linux"], ownApp: false },
        { combo: "command+r", why: "launcher", platforms: ["win32"], ownApp: false },
        { combo: "command+space", why: "launcher", platforms: null, ownApp: false },
        { combo: "command+tab", why: "switch", platforms: null, ownApp: false },
        { combo: "shift+delete", why: "delete", platforms: ["win32", "linux"], ownApp: false },
      ],
    },
  };
}
