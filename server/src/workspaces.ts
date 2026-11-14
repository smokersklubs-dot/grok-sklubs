import { q } from "./db.js";
import { setAudience } from "./bus.js";
import { config } from "./config.js";
import { bots, newId, now, publicBot, randomToken, rows, sha256, users, type BotRecord } from "./store.js";
import { ROLE_PERMISSIONS, WORKSPACE_ROLES, type ApprovalRule, type Bot, type BotShare, type MemberUsage, type SharedAccess, type Workspace, type WorkspaceAdmin, type WorkspaceAuditEntry, type WorkspaceInvite, type WorkspaceMember, type WorkspaceResource, type WorkspaceRole } from "./shared.js";

/**
 * Workspaces (wave 6): bots shared among several people.
 *
 * Model. A workspace has members with one role each (owner, admin, member, viewer — see ROLE_PERMISSIONS in shared.ts).
 * A bot always belongs to one account (its owner); the owner may share it to ONE workspace, to every member or to a
 * list of members (admins always see shared bots). The bot keeps working with its owner's apps, vault and budget: people
 * of the workspace talk to it and read its conversation, they never reach the owner's settings, files or secrets.
 *
 * Security rules, enforced here and on every route (routes.ts uses `botAccess` and `requireRole`, never the client):
 *  - no access without a membership row of the workspace the bot is shared to; anything else is a 404, never a 403 that
 *    would confirm the bot exists;
 *  - a member's words never authorise the bot's actions on the owner's behalf: their messages carry `origin.kind =
 *    "member"`, which grounding ignores, and the turn they start is careful (tainted) from its first step;
 *  - approvals of a shared bot go to its owner, and to the workspace's admins only when the owner chose that rule;
 *    an admin's "Always" counts as once (policies stay the owner's);
 *  - roles only move downwards: nobody grants a role at or above their own (except the owner granting admin);
 *  - invitations are single use, expire, are bound to an email address, and only their hash is stored.
 * SSO is out of scope (accounts are this server's own email + password accounts).
 */

export const INVITE_TTL_MS = 7 * 24 * 3600_000;
const MAX_WORKSPACES_PER_USER = 10;
const isRole = (r: unknown): r is WorkspaceRole => (WORKSPACE_ROLES as readonly string[]).includes(r as string);
const RANK: Record<WorkspaceRole, number> = { owner: 3, admin: 2, member: 1, viewer: 0 };
export const perms = (role: WorkspaceRole) => ROLE_PERMISSIONS[role];

export class WorkspaceError extends Error { constructor(public status: 400 | 403 | 404 | 409, message: string) { super(message); } }
const deny = (message = "That workspace does not exist."): never => { throw new WorkspaceError(404, message); };
const refuse = (message: string): never => { throw new WorkspaceError(403, message); };

interface WsRow { id: string; name: string; owner_id: string; seats: number; created_at: number }
const wsRow = (id: string) => q.get<WsRow>("SELECT * FROM workspaces WHERE id = ?", id);

export function roleOf(workspaceId: string, userId: string): WorkspaceRole | null {
  const r = q.get<{ role: string }>("SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?", workspaceId, userId);
  return r && isRole(r.role) ? r.role : null;
}

function toWorkspace(r: WsRow, role: WorkspaceRole): Workspace {
  const n = q.get<{ n: number }>("SELECT COUNT(*) AS n FROM workspace_members WHERE workspace_id = ?", r.id)!.n;
  return { id: r.id, name: r.name, ownerId: r.owner_id, seats: r.seats, role, memberCount: n, createdAt: r.created_at };
}

/** The workspace and the caller's role in it, or a 404 when they are not a member (never reveals that it exists). */
export function requireRole(workspaceId: string, userId: string, need?: (p: (typeof ROLE_PERMISSIONS)[WorkspaceRole]) => boolean): { ws: WsRow; role: WorkspaceRole } {
  const ws = wsRow(workspaceId) ?? deny();
  const role = roleOf(ws.id, userId) ?? deny();
  if (need && !need(perms(role))) refuse("Your role in this workspace does not allow that.");
  return { ws, role };
}

export function wsAudit(workspaceId: string, actorId: string, kind: string, text: string) {
  const name = users.byId(actorId)?.name || "?";
  q.run("INSERT INTO workspace_audit (workspace_id, at, actor_id, actor_name, kind, text) VALUES (?, ?, ?, ?, ?, ?)", workspaceId, now(), actorId, name, kind, text.slice(0, 500));
}

/** Pending invitations and members together never exceed the workspace's seats. */
function seatsUsed(workspaceId: string): number {
  const m = q.get<{ n: number }>("SELECT COUNT(*) AS n FROM workspace_members WHERE workspace_id = ?", workspaceId)!.n;
  const i = q.get<{ n: number }>("SELECT COUNT(*) AS n FROM workspace_invites WHERE workspace_id = ? AND used_at IS NULL AND expires_at > ?", workspaceId, now())!.n;
  return m + i;
}

export const workspaces = {
  listFor(userId: string): Workspace[] {
    return q.all<WsRow & { role: string }>("SELECT w.*, m.role FROM workspaces w JOIN workspace_members m ON m.workspace_id = w.id WHERE m.user_id = ? ORDER BY w.created_at", userId)
      .filter((r) => isRole(r.role)).map((r) => toWorkspace(r, r.role as WorkspaceRole));
  },
  create(userId: string, name: string): Workspace {
    const clean = name.replace(/\s+/g, " ").trim().slice(0, 60);
    if (!clean) throw new WorkspaceError(400, "Give the workspace a name.");
    const owned = q.get<{ n: number }>("SELECT COUNT(*) AS n FROM workspaces WHERE owner_id = ?", userId)!.n;
    if (owned >= MAX_WORKSPACES_PER_USER) throw new WorkspaceError(409, "You already own 10 workspaces.");
    const id = newId("ws");
    const seats = Math.max(2, Math.min(config.workspaceMaxSeats, config.workspaceSeats));
    q.tx(() => {
      q.run("INSERT INTO workspaces (id, name, owner_id, seats, created_at) VALUES (?, ?, ?, ?, ?)", id, clean, userId, seats, now());
      q.run("INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)", id, userId, now());
    });
    wsAudit(id, userId, "workspace", `Workspace created: ${clean}`);
    return toWorkspace(wsRow(id)!, "owner");
  },
  update(workspaceId: string, userId: string, patch: { name?: unknown; seats?: unknown }): Workspace {
    const { ws, role } = requireRole(workspaceId, userId);
    if (patch.name !== undefined) {
      if (!perms(role).manageMembers) refuse("Your role in this workspace does not allow that.");
      const clean = String(patch.name).replace(/\s+/g, " ").trim().slice(0, 60);
      if (!clean) throw new WorkspaceError(400, "Give the workspace a name.");
      q.run("UPDATE workspaces SET name = ? WHERE id = ?", clean, ws.id);
      wsAudit(ws.id, userId, "workspace", `Renamed: ${clean}`);
    }
    if (patch.seats !== undefined) {
      // Seats are the owner's decision: an admin cannot raise the limit.
      if (role !== "owner") refuse("Only the workspace's owner can change its seats.");
      const n = Math.floor(Number(patch.seats));
      if (!Number.isFinite(n) || n < 1 || n > config.workspaceMaxSeats) throw new WorkspaceError(400, `Seats: between 1 and ${config.workspaceMaxSeats}.`);
      if (n < seatsUsed(ws.id)) throw new WorkspaceError(409, "More people are in (or invited to) this workspace than that.");
      q.run("UPDATE workspaces SET seats = ? WHERE id = ?", n, ws.id);
      wsAudit(ws.id, userId, "workspace", `Seats set to ${n}`);
    }
    return toWorkspace(wsRow(ws.id)!, role);
  },
  remove(workspaceId: string, userId: string): string[] {
    const { ws } = requireRole(workspaceId, userId, (p) => p.deleteWorkspace);
    const members = workspaces.memberIds(ws.id);
    // Shared bots go back to being private (their owners keep them); the rest goes with the workspace.
    q.run("DELETE FROM workspaces WHERE id = ?", ws.id);
    return members;
  },
  memberIds: (workspaceId: string) => q.all<{ user_id: string }>("SELECT user_id FROM workspace_members WHERE workspace_id = ?", workspaceId).map((r) => r.user_id),
  members(workspaceId: string): WorkspaceMember[] {
    return q.all<{ user_id: string; role: string; created_at: number; name: string; email: string }>(
      "SELECT m.user_id, m.role, m.created_at, u.name, u.email FROM workspace_members m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? ORDER BY m.created_at", workspaceId)
      .map((r) => ({ userId: r.user_id, name: r.name, email: r.email, role: r.role as WorkspaceRole, joinedAt: r.created_at }));
  },
  /**
   * Changes someone's role. Owner: any role below owner for anyone but themselves. Admin: only between member and
   * viewer, for members and viewers. Nobody changes the owner's role (ownership transfer is not offered).
   */
  setRole(workspaceId: string, actorId: string, targetId: string, next: unknown) {
    const { ws, role } = requireRole(workspaceId, actorId, (p) => p.manageMembers);
    if (!isRole(next) || next === "owner") throw new WorkspaceError(400, "Choose admin, member or viewer.");
    const cur = roleOf(ws.id, targetId) ?? deny("That person is not in this workspace.");
    if (targetId === actorId) refuse("You cannot change your own role.");
    if (cur === "owner") refuse("The owner's role cannot be changed.");
    if (role !== "owner" && (RANK[cur] >= RANK[role] || RANK[next] >= RANK[role])) refuse("Only the owner can manage admins.");
    q.run("UPDATE workspace_members SET role = ? WHERE workspace_id = ? AND user_id = ?", next, ws.id, targetId);
    wsAudit(ws.id, actorId, "member", `${users.byId(targetId)?.email ?? targetId}: ${cur} → ${next}`);
  },
  /** Removes someone (the owner never; an admin only members and viewers; anyone may leave). `purge`: also their data. */
  removeMember(workspaceId: string, actorId: string, targetId: string, purge = false) {
    const { ws, role } = requireRole(workspaceId, actorId);
    const cur = roleOf(ws.id, targetId) ?? deny("That person is not in this workspace.");
    if (cur === "owner") refuse("The owner cannot leave or be removed: delete the workspace instead.");
    const self = targetId === actorId;
    if (!self) {
      if (!perms(role).manageMembers) refuse("Your role in this workspace does not allow that.");
      if (role !== "owner" && RANK[cur] >= RANK[role]) refuse("Only the owner can manage admins.");
    }
    if (purge && self) refuse("Ask an admin to delete your data.");
    const email = users.byId(targetId)?.email ?? targetId;
    q.tx(() => {
      q.run("DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?", ws.id, targetId);
      // Their name disappears from every per-bot access list of this workspace.
      for (const s of q.all<{ bot_id: string; members: string }>("SELECT bot_id, members FROM bot_shares WHERE workspace_id = ?", ws.id)) {
        const list = (JSON.parse(s.members || "[]") as string[]).filter((m) => m !== targetId);
        q.run("UPDATE bot_shares SET members = ? WHERE bot_id = ?", JSON.stringify(list), s.bot_id);
      }
      // Resources they shared stop being shared.
      q.run("DELETE FROM workspace_resources WHERE workspace_id = ? AND shared_by = ?", ws.id, targetId);
    });
    const redacted = purge ? purgeMemberMessages(ws.id, targetId) : 0;
    wsAudit(ws.id, actorId, "member", self ? `${email} left` : purge ? `${email} removed and their data deleted (${redacted} message(s))` : `${email} removed`);
  },
};

/** Messages a member wrote in this workspace's shared bots: text replaced, so nothing of theirs stays readable. */
function purgeMemberMessages(workspaceId: string, userId: string): number {
  let n = 0;
  for (const s of q.all<{ bot_id: string }>("SELECT bot_id FROM bot_shares WHERE workspace_id = ?", workspaceId)) {
    const bot = bots.byId(s.bot_id);
    if (!bot) continue;
    for (const r of q.all<{ generation: number; seq: number; body: string }>("SELECT generation, seq, body FROM rows WHERE bot_id = ? AND kind = 'message'", bot.id)) {
      const body = JSON.parse(r.body);
      if (body?.origin?.kind !== "member" || body.origin.id !== userId) continue;
      rows.rewrite(bot, r.generation, r.seq, { ...body, text: "[deleted]", attachments: undefined, origin: { kind: "member", id: "", name: "—" } });
      n++;
    }
  }
  return n;
}

// ── Invitations ─────────────────────────────────────────────────────────────
export const invites = {
  list(workspaceId: string): WorkspaceInvite[] {
    return q.all<any>("SELECT * FROM workspace_invites WHERE workspace_id = ? AND used_at IS NULL AND expires_at > ? ORDER BY created_at DESC", workspaceId, now())
      .map((r) => ({ id: r.id, email: r.email, role: r.role, expiresAt: r.expires_at, createdAt: r.created_at, usedAt: r.used_at }));
  },
  create(workspaceId: string, actorId: string, email: unknown, role: unknown): WorkspaceInvite {
    const { ws, role: mine } = requireRole(workspaceId, actorId, (p) => p.manageMembers);
    const addr = String(email ?? "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr) || addr.length > 200) throw new WorkspaceError(400, "Enter a valid email address.");
    if (!isRole(role) || role === "owner") throw new WorkspaceError(400, "Choose admin, member or viewer.");
    if (role === "admin" && mine !== "owner") refuse("Only the owner can manage admins.");
    const existing = users.byEmail(addr);
    if (existing && roleOf(ws.id, existing.id)) throw new WorkspaceError(409, "This person is already in the workspace.");
    if (seatsUsed(ws.id) >= ws.seats) throw new WorkspaceError(409, "Every seat of this workspace is taken (members and pending invitations).");
    // One live invitation per address: a new one replaces the old link.
    q.run("DELETE FROM workspace_invites WHERE workspace_id = ? AND email = ? AND used_at IS NULL", ws.id, addr);
    const token = randomToken(32);
    const id = newId("inv");
    const t = now();
    q.run("INSERT INTO workspace_invites (id, workspace_id, email, role, token_hash, created_by, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", id, ws.id, addr, role, sha256(token), actorId, t + INVITE_TTL_MS, t);
    wsAudit(ws.id, actorId, "invite", `Invited ${addr} as ${role}`);
    return { id, email: addr, role, expiresAt: t + INVITE_TTL_MS, createdAt: t, usedAt: null, link: `${config.publicUrl}/?invite=${token}` };
  },
  revoke(workspaceId: string, actorId: string, inviteId: string) {
    const { ws } = requireRole(workspaceId, actorId, (p) => p.manageMembers);
    const r = q.run("DELETE FROM workspace_invites WHERE id = ? AND workspace_id = ? AND used_at IS NULL", inviteId, ws.id);
    if (!r.changes) deny("That invitation does not exist.");
    wsAudit(ws.id, actorId, "invite", "Invitation withdrawn");
  },
  /** What a link is for (shown before signing up / accepting), or null when it is unknown, used or expired. */
  peek(token: string): { workspaceName: string; email: string; role: WorkspaceRole } | null {
    const r = token ? q.get<any>("SELECT i.*, w.name AS ws_name FROM workspace_invites i JOIN workspaces w ON w.id = i.workspace_id WHERE i.token_hash = ?", sha256(token)) : undefined;
    if (!r || r.used_at || r.expires_at < now()) return null;
    return { workspaceName: r.ws_name, email: r.email, role: r.role };
  },
  /**
   * Accepts an invitation: single use (the row is marked used in the same statement that checks it), not expired, and
   * only for the address it was sent to — a forwarded link does not let someone else in.
   */
  accept(token: string, userId: string): Workspace {
    const user = users.byId(userId) ?? deny();
    const r = token ? q.get<any>("SELECT * FROM workspace_invites WHERE token_hash = ?", sha256(token)) : undefined;
    if (!r || r.used_at || r.expires_at < now()) throw new WorkspaceError(404, "This invitation has expired or was already used. Ask for a new one.");
    if (r.email.toLowerCase() !== user.email.toLowerCase()) refuse("This invitation was sent to another email address. Sign in with that address to accept it.");
    const claimed = q.run("UPDATE workspace_invites SET used_at = ? WHERE id = ? AND used_at IS NULL", now(), r.id);
    if (!claimed.changes) throw new WorkspaceError(404, "This invitation has expired or was already used. Ask for a new one.");
    if (!roleOf(r.workspace_id, userId)) q.run("INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)", r.workspace_id, userId, r.role, now());
    wsAudit(r.workspace_id, userId, "member", `${user.email} joined as ${r.role}`);
    return toWorkspace(wsRow(r.workspace_id)!, roleOf(r.workspace_id, userId)!);
  },
};

// ── Shared bots ─────────────────────────────────────────────────────────────
interface ShareRow { bot_id: string; workspace_id: string; access: string; members: string; approvals: string }
const shareRow = (botId: string) => q.get<ShareRow>("SELECT * FROM bot_shares WHERE bot_id = ?", botId);
function toShare(r: ShareRow): BotShare {
  return { workspaceId: r.workspace_id, workspaceName: wsRow(r.workspace_id)?.name ?? "?", access: r.access === "list" ? "list" : "all", memberIds: JSON.parse(r.members || "[]"), approvals: r.approvals === "owner_or_admins" ? "owner_or_admins" : "owner" };
}

export const shares = {
  of: (botId: string): BotShare | null => { const r = shareRow(botId); return r ? toShare(r) : null; },
  /** The owner shares one of their agent bots to a workspace they belong to (admins and owners only: sharing is a team decision). */
  set(bot: BotRecord, actorId: string, f: { workspaceId?: unknown; access?: unknown; memberIds?: unknown; approvals?: unknown }): BotShare {
    if (bot.userId !== actorId) deny("That bot does not exist.");
    if (bot.kind !== "agent" || bot.hidden) throw new WorkspaceError(400, "Only one of your own bots can be shared.");
    const { ws } = requireRole(String(f.workspaceId ?? ""), actorId, (p) => p.botSettings || p.talk);
    const members = new Set(workspaces.memberIds(ws.id));
    const list = Array.isArray(f.memberIds) ? [...new Set(f.memberIds.filter((m): m is string => typeof m === "string" && members.has(m) && m !== actorId))].slice(0, 500) : [];
    const access = f.access === "list" ? "list" : "all";
    const approvals: ApprovalRule = f.approvals === "owner_or_admins" ? "owner_or_admins" : "owner";
    q.run(`INSERT INTO bot_shares (bot_id, workspace_id, access, members, approvals, created_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(bot_id) DO UPDATE SET workspace_id = excluded.workspace_id, access = excluded.access, members = excluded.members, approvals = excluded.approvals`,
      bot.id, ws.id, access, JSON.stringify(list), approvals, now());
    wsAudit(ws.id, actorId, "share", `${bot.name} shared (${access === "all" ? "everyone" : `${list.length} member(s)`}, approvals: ${approvals})`);
    return shares.of(bot.id)!;
  },
  clear(bot: BotRecord, actorId: string) {
    const r = shareRow(bot.id);
    if (!r) return;
    q.run("DELETE FROM bot_shares WHERE bot_id = ?", bot.id);
    wsAudit(r.workspace_id, actorId, "share", `${bot.name} is private again`);
  },
};

export interface BotAccess { bot: BotRecord; owner: boolean; role: WorkspaceRole | null; share: BotShare | null; canView: boolean; canTalk: boolean; canManage: boolean; canApprove: boolean }

/**
 * What `userId` may do with `botId`. The owner: everything (personal mode, unchanged). Someone else: only through the
 * workspace the bot is shared to, by their role there and the bot's access list. Null when they may do nothing — the
 * caller answers 404.
 */
export function botAccess(userId: string, botId: string): BotAccess | null {
  const bot = bots.byId(botId);
  if (!bot) return null;
  if (bot.userId === userId) return { bot, owner: true, role: null, share: shares.of(bot.id), canView: true, canTalk: true, canManage: true, canApprove: true };
  // Hidden helpers, group chats and anything not shared are never reachable by someone else.
  if (bot.hidden || bot.kind !== "agent") return null;
  const r = shareRow(bot.id);
  if (!r) return null;
  const role = roleOf(r.workspace_id, userId);
  if (!role) return null;
  const share = toShare(r);
  const p = perms(role);
  // Members and viewers only see the bots on their list (when the owner chose a list); admins see every shared bot.
  if (!p.allBots && share.access === "list" && !share.memberIds.includes(userId)) return null;
  return {
    bot, owner: false, role, share, canView: p.view, canTalk: p.talk,
    canManage: p.botSettings, canApprove: p.approve && share.approvals === "owner_or_admins",
  };
}

export function sharedAccessOf(a: BotAccess): SharedAccess {
  return { workspaceId: a.share!.workspaceId, workspaceName: a.share!.workspaceName, ownerName: users.byId(a.bot.userId)?.name || "?", role: a.role!, canTalk: a.canTalk, canManage: a.canManage, canApprove: a.canApprove };
}

/**
 * A shared bot as someone of the workspace sees it: the public fields, minus what belongs to the owner alone (its
 * Telegram link, backup models, spend settings, sidebar filing) and with what they may do.
 */
export function sharedBotView(a: BotAccess): Bot {
  const b = publicBot(a.bot);
  return { ...b, primary: false, telegram: null, fallbackModels: null, spendCheckpointUsd: null, pinned: false, sectionId: null, listHidden: false, nudges: { ...b.nudges, enabled: false }, sharing: null, access: sharedAccessOf(a) };
}

/** Every bot someone else shares with this user (through any of their workspaces). */
export function sharedBotsFor(userId: string): BotAccess[] {
  const ids = q.all<{ bot_id: string }>("SELECT s.bot_id FROM bot_shares s JOIN workspace_members m ON m.workspace_id = s.workspace_id WHERE m.user_id = ?", userId).map((r) => r.bot_id);
  return ids.map((id) => botAccess(userId, id)).filter((a): a is BotAccess => !!a && !a.owner);
}

/** The people (other than the owner) who may see this bot's conversation right now: who its live events go to. */
export function audienceOf(botId: string): string[] {
  const r = shareRow(botId);
  if (!r) return [];
  const owner = q.get<{ user_id: string }>("SELECT user_id FROM bots WHERE id = ?", botId)?.user_id;
  return workspaces.memberIds(r.workspace_id).filter((u) => u !== owner && !!botAccess(u, botId));
}

/** Who answers an approval of this bot: its owner, plus the workspace's owner and admins when the rule says so. */
export function approversOf(botId: string): string[] {
  const bot = bots.byId(botId);
  if (!bot) return [];
  const share = shares.of(botId);
  const extra = share?.approvals === "owner_or_admins"
    ? q.all<{ user_id: string }>("SELECT user_id FROM workspace_members WHERE workspace_id = ? AND role IN ('owner', 'admin')", share.workspaceId).map((r) => r.user_id)
    : [];
  return [...new Set([bot.userId, ...extra])];
}

// ── Shared resources (names only) ───────────────────────────────────────────
export const resources = {
  list(workspaceId: string): WorkspaceResource[] {
    return q.all<any>("SELECT r.*, u.name AS by_name FROM workspace_resources r JOIN users u ON u.id = r.shared_by WHERE r.workspace_id = ? ORDER BY r.created_at", workspaceId).map((r) => {
      const name = r.kind === "vault" ? q.get<{ name: string }>("SELECT name FROM vault WHERE id = ?", r.resource_id)?.name : q.get<{ name: string }>("SELECT name FROM connectors WHERE id = ?", r.resource_id)?.name;
      return { kind: r.kind, id: r.resource_id, name: name ?? "?", sharedBy: r.shared_by, sharedByName: r.by_name, createdAt: r.created_at };
    });
  },
  /** A member shares one of their own vault items or connectors (they must own it, and their role must allow resources). */
  share(workspaceId: string, actorId: string, kind: unknown, id: unknown) {
    const { ws } = requireRole(workspaceId, actorId, (p) => p.resources);
    if (kind !== "vault" && kind !== "connector") throw new WorkspaceError(400, "Unknown kind of resource.");
    const table = kind === "vault" ? "vault" : "connectors";
    const own = q.get(`SELECT id FROM ${table} WHERE id = ? AND user_id = ?`, String(id ?? ""), actorId);
    if (!own) deny("That item does not exist.");
    q.run("INSERT OR IGNORE INTO workspace_resources (workspace_id, kind, resource_id, shared_by, created_at) VALUES (?, ?, ?, ?, ?)", ws.id, kind, String(id), actorId, now());
    wsAudit(ws.id, actorId, "resource", `Shared a ${kind === "vault" ? "vault item" : "connector"}`);
  },
  unshare(workspaceId: string, actorId: string, kind: unknown, id: unknown) {
    const { ws, role } = requireRole(workspaceId, actorId);
    const r = q.get<{ shared_by: string }>("SELECT shared_by FROM workspace_resources WHERE workspace_id = ? AND kind = ? AND resource_id = ?", ws.id, String(kind), String(id));
    if (!r) deny("That item does not exist.");
    if (r!.shared_by !== actorId && !perms(role).resources) refuse("Your role in this workspace does not allow that.");
    q.run("DELETE FROM workspace_resources WHERE workspace_id = ? AND kind = ? AND resource_id = ?", ws.id, String(kind), String(id));
    wsAudit(ws.id, actorId, "resource", "Stopped sharing an item");
  },
};

// ── Admin console ───────────────────────────────────────────────────────────
function memberUsage(workspaceId: string, since: number): MemberUsage[] {
  const botIds = q.all<{ bot_id: string }>("SELECT bot_id FROM bot_shares WHERE workspace_id = ?", workspaceId).map((r) => r.bot_id);
  return workspaces.members(workspaceId).map((m) => {
    let messages = 0;
    let last: number | null = null;
    for (const id of botIds) {
      const owner = q.get<{ user_id: string }>("SELECT user_id FROM bots WHERE id = ?", id)?.user_id;
      // The owner's own messages carry no origin; a member's carry their id.
      const r = owner === m.userId
        ? q.get<{ n: number; last: number | null }>("SELECT COUNT(*) AS n, MAX(created_at) AS last FROM rows WHERE bot_id = ? AND kind = 'message' AND created_at >= ? AND json_extract(body, '$.role') = 'user' AND json_extract(body, '$.origin') IS NULL", id, since)!
        : q.get<{ n: number; last: number | null }>("SELECT COUNT(*) AS n, MAX(created_at) AS last FROM rows WHERE bot_id = ? AND kind = 'message' AND created_at >= ? AND json_extract(body, '$.origin.kind') = 'member' AND json_extract(body, '$.origin.id') = ?", id, since, m.userId)!;
      messages += r.n;
      if (r.last && (!last || r.last > last)) last = r.last;
    }
    const marks = botIds.map(() => "?").join(",");
    const cost = botIds.length ? q.get<{ c: number | null }>(`SELECT SUM(cost_usd) AS c FROM usage WHERE bot_id IN (${marks}) AND at >= ? AND actor_id = ?`, ...botIds, since, m.userId)!.c ?? 0 : 0;
    const approvals = q.get<{ n: number }>("SELECT COUNT(*) AS n FROM workspace_audit WHERE workspace_id = ? AND actor_id = ? AND kind = 'approval' AND at >= ?", workspaceId, m.userId, since)!.n;
    return { userId: m.userId, name: m.name, role: m.role, messages, costUsd: Math.round(cost * 10000) / 10000, approvals, lastActiveAt: last };
  });
}

export function adminView(workspaceId: string, userId: string): WorkspaceAdmin {
  const { ws, role } = requireRole(workspaceId, userId, (p) => p.usage);
  const since = now() - 30 * 24 * 3600_000;
  const shared = q.all<ShareRow>("SELECT * FROM bot_shares WHERE workspace_id = ?", ws.id).map((r) => {
    const bot = bots.byId(r.bot_id);
    return bot ? { id: bot.id, name: bot.name, ownerName: users.byId(bot.userId)?.name ?? "?", share: toShare(r) } : null;
  }).filter((x): x is NonNullable<typeof x> => !!x);
  const audit = q.all<any>("SELECT * FROM workspace_audit WHERE workspace_id = ? ORDER BY id DESC LIMIT 200", ws.id)
    .map((r): WorkspaceAuditEntry => ({ id: r.id, at: r.at, actorId: r.actor_id, actorName: r.actor_name, kind: r.kind, text: r.text }));
  return { workspace: toWorkspace(ws, role), members: workspaces.members(ws.id), invites: invites.list(ws.id), usage: memberUsage(ws.id, since), bots: shared, resources: resources.list(ws.id), audit };
}

/** Everything the workspace holds, for its owner or an admin: members, shares, the log, and the members' messages in shared bots. */
export function exportWorkspace(workspaceId: string, userId: string) {
  const { ws } = requireRole(workspaceId, userId, (p) => p.export);
  const view = adminView(ws.id, userId);
  const messages = view.bots.flatMap((b) => q.all<{ generation: number; seq: number; body: string; created_at: number }>("SELECT generation, seq, body, created_at FROM rows WHERE bot_id = ? AND kind = 'message' AND json_extract(body, '$.origin.kind') = 'member'", b.id)
    .map((r) => { const body = JSON.parse(r.body); return { botId: b.id, botName: b.name, at: r.created_at, memberId: body.origin.id, memberName: body.origin.name, text: body.text }; }));
  wsAudit(ws.id, userId, "export", "Workspace data exported");
  return { exportedAt: now(), workspace: view.workspace, members: view.members, invites: view.invites, bots: view.bots, resources: view.resources, usage: view.usage, audit: q.all<any>("SELECT * FROM workspace_audit WHERE workspace_id = ? ORDER BY id", ws.id), messages };
}

/** Bot settings someone of the workspace with `botSettings` may change on a bot they do not own (never model, autonomy, tools or budget). */
export const SHARED_SETTINGS = ["name", "label", "description", "instructions", "color", "shape", "character", "voice"] as const;

// Live events of a shared bot reach the people of its workspace, each seeing it as their role allows.
setAudience(audienceOf, (userId, event) => {
  if (event.type !== "bot") return event;
  const a = botAccess(userId, event.bot.id);
  return a && !a.owner ? { type: "bot", bot: sharedBotView(a) } : null;
});
