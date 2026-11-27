import http, { type IncomingMessage, type ServerResponse } from "node:http";
import net from "node:net";
import type { Duplex } from "node:stream";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Sklubot's Docker proxy (review finding H3): the only process that holds the Docker socket. Sklubot's server reaches
 * Docker through it (DOCKER_HOST=tcp://docker-proxy:2375) and may only do what the bots' computers need. Unlike a proxy
 * that filters paths (tecnativa/docker-socket-proxy), it reads the bodies too: a container is only created from the
 * desktop image, unprivileged, with the computer's reduced capabilities, on the bots' network, with no host folder, no
 * host namespace and no device; every other call only reaches containers that carry Sklubot's label.
 *
 * It runs as a mode of the server image (node server/dist/dockerproxy.js), alone in its container: no data volume, no
 * secret, no capability, read-only, on an internal network that only the server joins. It imports nothing from the app.
 *
 * The requests it lets through are the ones the docker CLI (29.x, API 1.56) sends for the commands in linux.ts and its
 * callers, recorded against a real daemon (see server/test/dockerproxy.test.ts) — Docker Engine API reference:
 * https://docs.docker.com/reference/api/engine/version/v1.47/ (containers/create, exec, networks/create, volumes).
 */

export interface ProxyPolicy {
  /** Images a container may be created from (DESKTOP_IMAGE), compared without "docker.io/library/" and ":latest". */
  images: string[];
  /** Networks a computer may join ("none" is always allowed). */
  networks: string[];
  /** Capabilities a computer may keep (linux.ts COMPUTER_CAPS). CapDrop must contain ALL. */
  caps: string[];
  /** Sklubot's data volume: only its sub-folders matching dataSubpaths may be mounted (library, team folder, bot link). */
  dataVolume: string;
  dataSubpaths: RegExp;
  /** Named volumes a container may mount whole (the computers' home folders), and the ones that may be created or removed. */
  homeVolumes: RegExp;
  /** Container runtimes allowed besides the default one (e.g. gVisor's "runsc", DESKTOP_RUNTIME). */
  runtimes: string[];
  /** The label every container of Sklubot carries (its value says which kind). */
  label: string;
  /** Names a new container may be given. */
  names: RegExp;
  /**
   * L48: the seccomp profiles a computer may be created with, compacted JSON — exactly what the docker CLI sends for
   * `--security-opt seccomp=<file>` (it reads the file and sends "seccomp=" + the compacted JSON). Only Sklubot's own
   * profile (docker/desktop/seccomp-chromium.json, browsersandbox.ts); "unconfined" and any other profile stay refused.
   */
  seccompProfiles: string[];
}

/** Each readable profile among these files, compacted (a missing or broken file is left out: that option stays refused). */
export function loadSeccompProfiles(paths: string[]): string[] {
  const out: string[] = [];
  for (const p of paths) { try { out.push(JSON.stringify(JSON.parse(readFileSync(p, "utf8")))); } catch { /* left out */ } }
  return out;
}
const SHIPPED_SECCOMP = fileURLToPath(new URL("../../docker/desktop/seccomp-chromium.json", import.meta.url));

const list = (v: string | undefined, fallback: string[]) => {
  const out = (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return out.length ? out : fallback;
};

export function policyFromEnv(env: NodeJS.ProcessEnv = process.env): ProxyPolicy {
  return {
    images: list(env.PROXY_IMAGES ?? env.DESKTOP_IMAGE, ["sklubot-desktop"]),
    networks: list(env.PROXY_NETWORKS ?? env.BOTS_NETWORK, ["sklubot_bots"]),
    caps: list(env.PROXY_CAPS, ["CHOWN", "DAC_OVERRIDE", "FOWNER", "SETUID", "SETGID", "KILL", "AUDIT_WRITE"]),
    dataVolume: env.PROXY_DATA_VOLUME ?? env.DATA_VOLUME ?? "sklubot_data",
    dataSubpaths: /^(workspaces|team|botlink)\/[A-Za-z0-9_-]{1,128}$/,
    homeVolumes: /^sklubot-home-[A-Za-z0-9_-]{1,128}$/,
    runtimes: list(env.PROXY_RUNTIMES ?? env.DESKTOP_RUNTIME, []),
    label: "sklubot",
    names: /^sklubot-[A-Za-z0-9_-]{1,128}$/,
    seccompProfiles: loadSeccompProfiles(list(env.PROXY_SECCOMP_PROFILES, [SHIPPED_SECCOMP])),
  };
}

// ── Pure checks (unit-tested) ────────────────────────────────────────────────
const normImage = (ref: string) => ref.trim().replace(/^(docker\.io\/)?(library\/)?/, "").replace(/:latest$/, "");
const normCap = (c: string) => String(c).toUpperCase().replace(/^CAP_/, "");
/** A field the CLI always sends that means "nothing": null, false, 0, "", [], {} and the like. */
function empty(v: unknown): boolean {
  if (v === null || v === undefined || v === false || v === 0 || v === "") return true;
  if (Array.isArray(v)) return v.every((x) => x === 0) || v.length === 0;
  if (typeof v === "object") return Object.values(v as object).every(empty);
  return false;
}

/** HostConfig fields a computer may set; each has its own check below. Any other field must be empty. */
const HOST_FIELDS = new Set([
  "Binds", "Mounts", "NetworkMode", "CapAdd", "CapDrop", "SecurityOpt", "Memory", "MemorySwap", "MemoryReservation", "MemorySwappiness",
  "NanoCpus", "CpuShares", "CpuPeriod", "CpuQuota", "PidsLimit", "ShmSize", "Init", "AutoRemove", "RestartPolicy", "LogConfig",
  "StorageOpt", "Runtime", "ConsoleSize", "OomScoreAdj",
]);
/** Config (top-level) fields that are fine whatever their value. Anything else must be empty. */
const CONFIG_FIELDS = new Set([
  "Hostname", "Domainname", "User", "AttachStdin", "AttachStdout", "AttachStderr", "Tty", "OpenStdin", "StdinOnce", "Env", "Cmd",
  "Image", "Volumes", "WorkingDir", "Entrypoint", "Labels", "HostConfig", "NetworkingConfig", "StopSignal", "StopTimeout",
]);
const NO_NEW_PRIVS = new Set(["no-new-privileges", "no-new-privileges:true", "no-new-privileges=true"]);

/** Why a container may not be created with this body and query (null: it may). */
export function checkCreate(body: any, query: URLSearchParams, p: ProxyPolicy): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "the body is not a JSON object";
  const name = query.get("name");
  if (name !== null && !p.names.test(name.replace(/^\//, ""))) return `container name ${name} is not one of Sklubot's`;
  for (const k of query.keys()) if (k !== "name" && k !== "platform") return `query parameter ${k} is not allowed`;
  for (const [k, v] of Object.entries(body)) if (!CONFIG_FIELDS.has(k) && !empty(v)) return `field ${k} is not allowed`;
  if (typeof body.Image !== "string" || !p.images.map(normImage).includes(normImage(body.Image))) return `image ${body.Image} is not the desktop image`;
  const labels = body.Labels ?? {};
  if (typeof labels !== "object" || typeof labels[p.label] !== "string" || !labels[p.label]) return `the container must carry the label ${p.label}`;
  const h = body.HostConfig ?? {};
  if (typeof h !== "object" || Array.isArray(h)) return "HostConfig is not an object";
  for (const [k, v] of Object.entries(h)) if (!HOST_FIELDS.has(k) && !empty(v)) return `HostConfig.${k} is not allowed`;
  // An empty list here is not "nothing": it unmasks /proc and /sys (--security-opt systempaths=unconfined).
  if ((h.MaskedPaths ?? null) !== null || (h.ReadonlyPaths ?? null) !== null) return "MaskedPaths and ReadonlyPaths cannot be changed";
  // Privileges
  const drop = (h.CapDrop ?? []).map(normCap);
  if (!drop.includes("ALL")) return "CapDrop must contain ALL";
  const allowedCaps = new Set(p.caps.map(normCap));
  for (const c of h.CapAdd ?? []) if (!allowedCaps.has(normCap(c))) return `capability ${c} is not allowed`;
  const sec: string[] = Array.isArray(h.SecurityOpt) ? h.SecurityOpt : [];
  if (!sec.some((s) => NO_NEW_PRIVS.has(String(s)))) return "SecurityOpt must include no-new-privileges";
  for (const s of sec) {
    if (NO_NEW_PRIVS.has(String(s))) continue;
    // L48: Sklubot's own seccomp profile, compared as JSON (never "unconfined", never another profile).
    const m = /^seccomp[=:]([\s\S]*)$/.exec(String(s));
    if (m && m[1].trim().startsWith("{")) {
      let compact = "";
      try { compact = JSON.stringify(JSON.parse(m[1])); } catch { /* not JSON */ }
      if (compact && p.seccompProfiles.includes(compact)) continue;
      return "security option seccomp=<profile> is not Sklubot's browser profile";
    }
    return `security option ${String(s).slice(0, 80)} is not allowed`;
  }
  if (h.Runtime && !p.runtimes.includes(String(h.Runtime))) return `runtime ${h.Runtime} is not allowed`;
  if (h.OomScoreAdj && Number(h.OomScoreAdj) < 0) return "a negative OomScoreAdj is not allowed";
  if (h.RestartPolicy && !["", "no"].includes(String(h.RestartPolicy.Name ?? ""))) return "restart policies are not allowed";
  if (h.LogConfig?.Type) return "a log driver is not allowed";
  for (const k of Object.keys(h.StorageOpt ?? {})) if (k !== "size") return `storage option ${k} is not allowed`;
  if (h.MemorySwappiness !== undefined && h.MemorySwappiness !== null && h.MemorySwappiness !== -1 && !(h.MemorySwappiness >= 0 && h.MemorySwappiness <= 100)) return "bad MemorySwappiness";
  // Network
  const mode = String(h.NetworkMode ?? "");
  if (mode !== "none" && !p.networks.includes(mode)) return `network ${mode || "default"} is not allowed`;
  const endpoints = body.NetworkingConfig?.EndpointsConfig ?? {};
  for (const [n, cfg] of Object.entries(endpoints)) {
    if (n !== mode) return `network ${n} is not allowed`;
    if (!empty(cfg)) return "endpoint settings are not allowed";
  }
  // Storage: named home volumes, sub-folders of the data volume, nothing of the host.
  for (const b of h.Binds ?? []) {
    const [src, dst, opts, ...rest] = String(b).split(":");
    if (rest.length || !dst || !dst.startsWith("/")) return `bind ${b} is malformed`;
    if (!p.homeVolumes.test(src)) return `bind ${b} is not a computer's home volume`;
    if (opts && !opts.split(",").every((o) => ["ro", "rw", "nocopy"].includes(o))) return `bind option ${opts} is not allowed`;
  }
  for (const m of h.Mounts ?? []) {
    if (!m || m.Type !== "volume") return `mount type ${m?.Type} is not allowed`;
    if (!empty(m.BindOptions) || !empty(m.TmpfsOptions) || !empty(m.ImageOptions)) return "mount options are not allowed";
    const vo = m.VolumeOptions ?? {};
    if (!empty(vo.DriverConfig) || !empty(vo.Labels)) return "volume driver options are not allowed";
    if (m.Source === p.dataVolume) {
      if (typeof vo.Subpath !== "string" || !p.dataSubpaths.test(vo.Subpath)) return `sub-folder ${vo.Subpath ?? "(whole volume)"} of the data volume is not allowed`;
    } else if (p.homeVolumes.test(String(m.Source ?? ""))) {
      if (!empty(vo.Subpath)) return "a sub-folder of a home volume is not allowed";
    } else return `volume ${m.Source} is not allowed`;
    if (typeof m.Target !== "string" || !m.Target.startsWith("/")) return "a mount needs an absolute target";
  }
  return null;
}

/** Why an exec may not be created with this body (null: it may). */
export function checkExecCreate(body: any): string | null {
  if (!body || typeof body !== "object") return "the body is not a JSON object";
  if (body.Privileged) return "privileged exec is not allowed";
  return null;
}

/** Why a network may not be created (null: it may): only the bots' network, a plain bridge, containers cut off from each other. */
export function checkNetworkCreate(body: any, p: ProxyPolicy): string | null {
  if (!body || typeof body !== "object") return "the body is not a JSON object";
  if (!p.networks.includes(String(body.Name))) return `network ${body.Name} is not one of Sklubot's`;
  if (body.Driver && body.Driver !== "bridge") return "only a bridge network is allowed";
  if (body.Ingress || body.ConfigOnly || !empty(body.ConfigFrom) || (body.Scope && body.Scope !== "local")) return "this kind of network is not allowed";
  const opts: Record<string, string> = body.Options ?? {};
  for (const [k, v] of Object.entries(opts)) {
    if (k === "com.docker.network.bridge.enable_icc") { if (String(v) !== "false") return "containers on the bots' network must not reach each other"; }
    else if (k === "com.docker.network.bridge.name") { if (!/^[a-z0-9-]{1,15}$/.test(String(v))) return "bad bridge name"; }
    else return `network option ${k} is not allowed`;
  }
  if (opts["com.docker.network.bridge.enable_icc"] !== "false") return "the bots' network must have com.docker.network.bridge.enable_icc=false";
  return null;
}

export function checkVolumeCreate(body: any, p: ProxyPolicy): string | null {
  if (!body || typeof body !== "object") return "the body is not a JSON object";
  if (!p.homeVolumes.test(String(body.Name ?? ""))) return `volume ${body.Name} is not a computer's home volume`;
  if (body.Driver && body.Driver !== "local") return "only the local driver is allowed";
  if (!empty(body.DriverOpts)) return "driver options are not allowed";
  return null;
}

/** containers/json: the list is always narrowed to Sklubot's containers (the CLI's own filters are kept). */
export function narrowList(query: URLSearchParams, p: ProxyPolicy): URLSearchParams {
  const out = new URLSearchParams(query);
  let filters: Record<string, any> = {};
  try { filters = JSON.parse(query.get("filters") ?? "{}") ?? {}; } catch { filters = {}; }
  if (typeof filters !== "object" || Array.isArray(filters)) filters = {};
  const label = filters.label;
  const labels: string[] = Array.isArray(label) ? label : label && typeof label === "object" ? Object.keys(label).filter((k) => label[k]) : [];
  if (!labels.some((l) => l === p.label || l.startsWith(`${p.label}=`))) labels.push(p.label);
  filters.label = Object.fromEntries(labels.map((l) => [l, true]));
  out.set("filters", JSON.stringify(filters));
  return out;
}

export type Route =
  | { kind: "deny"; status: number; reason: string }
  | { kind: "pass" }
  | { kind: "create" }
  | { kind: "list"; query: URLSearchParams }
  | { kind: "container"; id: string; exec?: boolean; upgrade?: boolean }
  | { kind: "exec"; id: string }
  | { kind: "network-create" }
  | { kind: "volume-create" };

const deny = (reason: string, status = 403): Route => ({ kind: "deny", status, reason });
const CONTAINER_OPS: Record<string, string[]> = {
  POST: ["start", "stop", "restart", "kill", "wait", "attach", "resize", "exec"],
  GET: ["json", "logs", "archive"],
  HEAD: ["archive"],
  PUT: ["archive"],
};

/** Decides what kind of request this is, from its method and address only (bodies are checked afterwards). */
export function route(method: string, rawUrl: string, p: ProxyPolicy): Route {
  // Encoded slashes, backslashes or dots could make the daemon read another path than the one checked here.
  if (/%2f|%5c|%2e|\\|\/\.\.?(\/|$)/i.test(rawUrl.split("?")[0])) return deny("malformed path", 400);
  const u = new URL(rawUrl, "http://proxy");
  const parts = u.pathname.replace(/^\/v\d+\.\d+(?=\/)/, "").split("/").filter(Boolean).map(decodeURIComponent);
  const [a, b, c, d] = parts;
  const m = method.toUpperCase();
  if (a === "_ping" && parts.length === 1 && (m === "GET" || m === "HEAD")) return { kind: "pass" };
  if ((a === "version" || a === "info") && parts.length === 1 && m === "GET") return { kind: "pass" };
  if (a === "containers") {
    if (b === "create" && parts.length === 2 && m === "POST") return { kind: "create" };
    if (b === "json" && parts.length === 2 && m === "GET") return { kind: "list", query: narrowList(u.searchParams, p) };
    if (b && parts.length === 2 && m === "DELETE") {
      for (const k of u.searchParams.keys()) if (!["force", "v"].includes(k)) return deny(`query parameter ${k} is not allowed`);
      return { kind: "container", id: b };
    }
    if (b && c && parts.length === 3 && CONTAINER_OPS[m]?.includes(c)) return { kind: "container", id: b, exec: c === "exec", upgrade: c === "attach" };
    return deny(`${m} ${u.pathname} is not allowed`);
  }
  if (a === "exec" && b && parts.length === 3 && ((m === "POST" && (c === "start" || c === "resize")) || (m === "GET" && c === "json"))) return { kind: "exec", id: b };
  if (a === "images" && b && c === "json" && parts.length >= 3 && m === "GET") {
    const name = parts.slice(1, -1).join("/");
    return p.images.map(normImage).includes(normImage(name)) ? { kind: "pass" } : deny("no such image", 404);
  }
  if (a === "networks") {
    if (b === "create" && parts.length === 2 && m === "POST") return { kind: "network-create" };
    if (b && parts.length === 2 && m === "GET") return p.networks.includes(b) ? { kind: "pass" } : deny("no such network", 404);
    return deny(`${m} ${u.pathname} is not allowed`);
  }
  if (a === "volumes") {
    if (b === "create" && parts.length === 2 && m === "POST") return { kind: "volume-create" };
    if (b && parts.length === 2 && m === "GET") return /^sklubot[-_]/.test(b) ? { kind: "pass" } : deny("no such volume", 404);
    if (b && parts.length === 2 && m === "DELETE") return p.homeVolumes.test(b) ? { kind: "pass" } : deny("only a computer's home volume can be removed");
    return deny(`${m} ${u.pathname} is not allowed`);
  }
  // The CLI's generic `docker inspect` of an unknown name also asks for images, networks, volumes and plugins: "not found".
  if (m === "GET" && (a === "plugins" || a === "images" || a === "networks")) return deny("not found", 404);
  void d;
  return deny(`${m} ${u.pathname} is not allowed`);
}

// ── The server ───────────────────────────────────────────────────────────────
const MAX_BODY = 1_000_000;

export interface ProxyOptions { socketPath: string; policy: ProxyPolicy; log?: (line: string) => void }

export function createDockerProxy(o: ProxyOptions) {
  const log = o.log ?? ((line: string) => console.log(line));
  /** Exec instances created through this proxy (exec id → when it was last seen), so /exec/<id> only reaches those. */
  const execs = new Map<string, number>();
  const EXEC_TTL = 24 * 3_600_000;
  const rememberExec = (id: string) => {
    execs.delete(id);
    execs.set(id, Date.now());
    while (execs.size > 50_000) execs.delete(execs.keys().next().value!);
  };
  const execKnown = (id: string) => { const at = execs.get(id); return at !== undefined && Date.now() - at < EXEC_TTL; };

  const upstream = (method: string, path: string, headers: http.OutgoingHttpHeaders, body?: Buffer) =>
    new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
      const r = http.request({ socketPath: o.socketPath, method, path, headers }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode ?? 502, headers: res.headers, body: Buffer.concat(chunks) }));
        res.on("error", reject);
      });
      r.on("error", reject);
      r.end(body);
    });

  /** Whether the container exists and is Sklubot's (by name or id). */
  async function ours(id: string): Promise<"yes" | "absent" | "foreign"> {
    const r = await upstream("GET", `/containers/${encodeURIComponent(id)}/json`, { host: "docker" });
    if (r.status === 404) return "absent";
    if (r.status !== 200) return "foreign";
    try { const j = JSON.parse(r.body.toString("utf8")); return j?.Config?.Labels?.[o.policy.label] ? "yes" : "foreign"; } catch { return "foreign"; }
  }

  const send = (res: ServerResponse, status: number, message: string) => {
    if (res.headersSent) { res.destroy(); return; }
    const body = JSON.stringify({ message });
    res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
    res.end(body);
  };

  const readBody = (req: IncomingMessage) => new Promise<Buffer | null>((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => { size += c.length; if (size > MAX_BODY) { resolve(null); req.destroy(); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", () => resolve(null));
  });

  /** Sends the request on to Docker and streams the answer back (headers at once: `wait` answers only when it is over). */
  function forward(req: IncomingMessage, res: ServerResponse, path: string, body: Buffer | null, onJson?: (j: any) => void) {
    const headers = { ...req.headers };
    if (body) headers["content-length"] = String(body.length);
    const up = http.request({ socketPath: o.socketPath, method: req.method, path, headers }, (r) => {
      if (onJson && (r.statusCode ?? 0) < 300) {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => {
          const buf = Buffer.concat(chunks);
          try { onJson(JSON.parse(buf.toString("utf8"))); } catch { /* not JSON */ }
          res.writeHead(r.statusCode ?? 502, r.headers);
          res.end(buf);
        });
        return;
      }
      res.writeHead(r.statusCode ?? 502, r.headers);
      res.flushHeaders();
      r.pipe(res);
    });
    up.on("error", (err) => send(res, 502, `docker: ${err.message}`));
    // The client went away before the answer was over (a stopped command): the call to Docker is dropped too.
    res.on("close", () => { if (!res.writableFinished) up.destroy(); });
    if (body) up.end(body); else req.pipe(up);
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const method = req.method ?? "GET";
    const url = req.url ?? "/";
    const r = route(method, url, o.policy);
    const refuse = (status: number, reason: string) => { log(`[docker-proxy] refused ${method} ${url.split("?")[0]}: ${reason}`); send(res, status, `Refused by Sklubot's Docker proxy: ${reason}`); };
    try {
      switch (r.kind) {
        case "deny": return refuse(r.status, r.reason);
        case "pass": return forward(req, res, url, null);
        case "list": return forward(req, res, `${url.split("?")[0]}?${r.query.toString()}`, null);
        case "create": {
          const body = await readBody(req);
          if (!body) return refuse(413, "body too large");
          let j: any;
          try { j = JSON.parse(body.toString("utf8")); } catch { return refuse(400, "the body is not JSON"); }
          const why = checkCreate(j, new URL(url, "http://proxy").searchParams, o.policy);
          if (why) return refuse(403, why);
          return forward(req, res, url, body);
        }
        case "network-create": case "volume-create": {
          const body = await readBody(req);
          if (!body) return refuse(413, "body too large");
          let j: any;
          try { j = JSON.parse(body.toString("utf8")); } catch { return refuse(400, "the body is not JSON"); }
          const why = r.kind === "network-create" ? checkNetworkCreate(j, o.policy) : checkVolumeCreate(j, o.policy);
          if (why) return refuse(403, why);
          return forward(req, res, url, body);
        }
        case "container": {
          if (r.upgrade) return refuse(400, "attach needs an upgraded connection");
          const who = await ours(r.id);
          if (who === "absent") return send(res, 404, `No such container: ${r.id}`);
          if (who === "foreign") return refuse(404, "not one of Sklubot's containers");
          if (r.exec) {
            const body = await readBody(req);
            if (!body) return refuse(413, "body too large");
            let j: any;
            try { j = JSON.parse(body.toString("utf8")); } catch { return refuse(400, "the body is not JSON"); }
            const why = checkExecCreate(j);
            if (why) return refuse(403, why);
            return forward(req, res, url, body, (out) => { if (typeof out?.Id === "string") rememberExec(out.Id); });
          }
          // A start never carries settings of its own (old API versions took a HostConfig there).
          if (method === "POST" && /\/start(\?|$)/.test(url)) { req.resume(); return forward(req, res, url, Buffer.alloc(0)); }
          return forward(req, res, url, null);
        }
        case "exec": {
          if (!execKnown(r.id)) return refuse(404, "unknown exec instance");
          rememberExec(r.id);
          return forward(req, res, url, null);
        }
      }
    } catch (err) { send(res, 502, `docker proxy: ${(err as Error).message}`); }
  }

  /** Hijacked connections (exec start and attach with "Upgrade: tcp"): checked like the others, then piped both ways. */
  async function upgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
    const method = req.method ?? "GET";
    const url = req.url ?? "/";
    const close = (status: number, reason: string) => {
      log(`[docker-proxy] refused ${method} ${url.split("?")[0]}: ${reason}`);
      const body = JSON.stringify({ message: `Refused by Sklubot's Docker proxy: ${reason}` });
      try { socket.end(`HTTP/1.1 ${status} Refused\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`); } catch { socket.destroy(); }
    };
    try {
      const r = route(method, url, o.policy);
      if (r.kind === "exec") {
        if (!/\/start$/.test(new URL(url, "http://proxy").pathname)) return close(400, "only exec start can be upgraded");
        if (!execKnown(r.id)) return close(404, "unknown exec instance");
        rememberExec(r.id);
      } else if (r.kind === "container" && r.upgrade) {
        const who = await ours(r.id);
        if (who !== "yes") return close(404, "not one of Sklubot's containers");
      } else return close(r.kind === "deny" ? r.status : 403, r.kind === "deny" ? r.reason : "this request cannot be upgraded");
      const up = net.connect(o.socketPath, () => {
        let head0 = `${method} ${url} HTTP/1.1\r\n`;
        for (let i = 0; i < req.rawHeaders.length; i += 2) head0 += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`;
        up.write(head0 + "\r\n");
        if (head.length) up.write(head);
        socket.pipe(up);
        up.pipe(socket);
      });
      // Either side gone: the other one is closed too (a stopped command, a finished exec).
      up.on("error", () => socket.destroy());
      socket.on("error", () => up.destroy());
      up.on("close", () => socket.destroy());
      socket.on("close", () => up.destroy());
    } catch (err) { close(502, (err as Error).message); }
  }

  const server = http.createServer((req, res) => { void handle(req, res); });
  server.on("upgrade", (req, socket, head) => { void upgrade(req, socket, head); });
  // Long exec streams (a whole subscription turn) and waits must not be cut by the server's own timeouts.
  server.requestTimeout = 0;
  server.headersTimeout = 60_000;
  server.keepAliveTimeout = 65_000;
  return server;
}

// Started as a program: `node server/dist/dockerproxy.js` (docker-compose: the docker-proxy service).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const policy = policyFromEnv();
  const socketPath = process.env.DOCKER_SOCKET ?? "/var/run/docker.sock";
  const port = Number(process.env.PROXY_PORT ?? 2375);
  createDockerProxy({ socketPath, policy }).listen(port, process.env.PROXY_HOST ?? "0.0.0.0", () => {
    console.log(`Sklubot's Docker proxy listens on ${port}: images ${policy.images.join(", ")}; networks ${policy.networks.join(", ")}, none; data volume ${policy.dataVolume}.`);
  });
  const stop = () => process.exit(0);
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}
