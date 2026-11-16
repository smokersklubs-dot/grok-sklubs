import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { checkCreate, checkExecCreate, checkNetworkCreate, checkVolumeCreate, createDockerProxy, narrowList, policyFromEnv, route } from "../src/dockerproxy.js";

// H3: Sklubot's own Docker proxy. The create bodies below are the ones the docker CLI 29.9 really sends for the
// commands of linux.ts (recorded against a real daemon through a logging proxy), so the filter is tested on real input.

const policy = policyFromEnv({ DESKTOP_IMAGE: "sklubot-desktop", PROXY_NETWORKS: "sklubot_bots", PROXY_DATA_VOLUME: "sklubot_data" });
const desktopBody = () => JSON.parse(`{"Hostname":"computer","Domainname":"","User":"","AttachStdin":false,"AttachStdout":false,"AttachStderr":false,"Tty":false,"OpenStdin":false,"StdinOnce":false,"Env":["SCREEN_RES=1280x800x24","KEYBOARD=us"],"Cmd":null,"Image":"sklubot-desktop","Volumes":{},"WorkingDir":"","Entrypoint":null,"Labels":{"sklubot":"desktop","sklubot.team":"0","sklubot.spec":"socket:sklubot_bots;rt:default"},"HostConfig":{"Binds":["sklubot-home-bot_1:/root"],"ContainerIDFile":"","LogConfig":{"Type":"","Config":{}},"NetworkMode":"sklubot_bots","PortBindings":{},"RestartPolicy":{"Name":"no","MaximumRetryCount":0},"AutoRemove":false,"VolumeDriver":"","VolumesFrom":null,"ConsoleSize":[0,0],"CapAdd":["CAP_CHOWN","CAP_DAC_OVERRIDE","CAP_FOWNER","CAP_SETUID","CAP_SETGID","CAP_KILL","CAP_AUDIT_WRITE"],"CapDrop":["ALL"],"CgroupnsMode":"","Dns":null,"DnsOptions":[],"DnsSearch":[],"ExtraHosts":null,"GroupAdd":null,"IpcMode":"","Cgroup":"","Links":null,"OomScoreAdj":0,"PidMode":"","Privileged":false,"PublishAllPorts":false,"ReadonlyRootfs":false,"SecurityOpt":["no-new-privileges"],"UTSMode":"","UsernsMode":"","ShmSize":1073741824,"Isolation":"","CpuShares":0,"Memory":2147483648,"NanoCpus":2000000000,"CgroupParent":"","BlkioWeight":0,"BlkioWeightDevice":[],"BlkioDeviceReadBps":[],"BlkioDeviceWriteBps":[],"BlkioDeviceReadIOps":[],"BlkioDeviceWriteIOps":[],"CpuPeriod":0,"CpuQuota":0,"CpuRealtimePeriod":0,"CpuRealtimeRuntime":0,"CpusetCpus":"","CpusetMems":"","Devices":[],"DeviceCgroupRules":null,"DeviceRequests":null,"MemoryReservation":0,"MemorySwap":2147483648,"MemorySwappiness":-1,"OomKillDisable":false,"PidsLimit":2048,"Ulimits":null,"CpuCount":0,"CpuPercent":0,"IOMaximumIOps":0,"IOMaximumBandwidth":0,"Mounts":[{"Type":"volume","Source":"sklubot_data","Target":"/root/files","VolumeOptions":{"Subpath":"workspaces/bot_1"}},{"Type":"volume","Source":"sklubot_data","Target":"/run/sklubot","ReadOnly":true,"VolumeOptions":{"Subpath":"botlink/bot_1"}}],"MaskedPaths":null,"ReadonlyPaths":null,"Init":true},"NetworkingConfig":{"EndpointsConfig":{}}}`);
const diskCheckBody = () => JSON.parse(`{"Hostname":"","Domainname":"","User":"","AttachStdin":false,"AttachStdout":true,"AttachStderr":true,"Tty":false,"OpenStdin":false,"StdinOnce":false,"Env":null,"Cmd":["-c","echo ok","sh"],"Image":"sklubot-desktop","Volumes":{},"WorkingDir":"","Entrypoint":["sh"],"Labels":{"sklubot":"disk-check"},"HostConfig":{"Binds":["sklubot-home-bot_1:/root"],"ContainerIDFile":"","LogConfig":{"Type":"","Config":{}},"NetworkMode":"none","PortBindings":{},"RestartPolicy":{"Name":"no","MaximumRetryCount":0},"AutoRemove":true,"VolumeDriver":"","VolumesFrom":null,"ConsoleSize":[0,0],"CapAdd":null,"CapDrop":["ALL"],"CgroupnsMode":"","Dns":null,"DnsOptions":[],"DnsSearch":[],"ExtraHosts":null,"GroupAdd":null,"IpcMode":"","Cgroup":"","Links":null,"OomScoreAdj":0,"PidMode":"","Privileged":false,"PublishAllPorts":false,"ReadonlyRootfs":false,"SecurityOpt":["no-new-privileges"],"UTSMode":"","UsernsMode":"","ShmSize":0,"Isolation":"","CpuShares":0,"Memory":268435456,"NanoCpus":0,"CgroupParent":"","BlkioWeight":0,"BlkioWeightDevice":[],"BlkioDeviceReadBps":[],"BlkioDeviceWriteBps":[],"BlkioDeviceReadIOps":[],"BlkioDeviceWriteIOps":[],"CpuPeriod":0,"CpuQuota":0,"CpuRealtimePeriod":0,"CpuRealtimeRuntime":0,"CpusetCpus":"","CpusetMems":"","Devices":[],"DeviceCgroupRules":null,"DeviceRequests":null,"MemoryReservation":0,"MemorySwap":0,"MemorySwappiness":-1,"OomKillDisable":false,"PidsLimit":256,"Ulimits":null,"CpuCount":0,"CpuPercent":0,"IOMaximumIOps":0,"IOMaximumBandwidth":0,"MaskedPaths":null,"ReadonlyPaths":null},"NetworkingConfig":{"EndpointsConfig":{}}}`);
const q = (s = "name=sklubot-bot_1") => new URLSearchParams(s);

test("H3: the containers Sklubot really creates (a computer, a throwaway disk check) pass the filter", () => {
  assert.equal(checkCreate(desktopBody(), q(), policy), null);
  assert.equal(checkCreate(diskCheckBody(), q(""), policy), null);
  // With a size limit (M2) and gVisor allowed by the operator.
  const b = desktopBody();
  b.HostConfig.StorageOpt = { size: "20G" };
  assert.equal(checkCreate(b, q(), policy), null);
  b.HostConfig.Runtime = "runsc";
  assert.match(checkCreate(b, q(), policy)!, /runtime runsc/);
  assert.equal(checkCreate(b, q(), { ...policy, runtimes: ["runsc"] }), null);
});

test("H3: every way out of the computer's box is refused at creation", () => {
  const cases: [string, (b: any) => void, RegExp][] = [
    ["privileged", (b) => { b.HostConfig.Privileged = true; }, /Privileged/],
    ["host folder", (b) => { b.HostConfig.Binds.push("/:/host"); }, /not a computer's home volume/],
    ["docker socket", (b) => { b.HostConfig.Binds = ["/var/run/docker.sock:/var/run/docker.sock"]; }, /not a computer's home volume/],
    ["bind mount", (b) => { b.HostConfig.Mounts.push({ Type: "bind", Source: "/etc", Target: "/x" }); }, /mount type bind/],
    ["whole data volume", (b) => { b.HostConfig.Mounts.push({ Type: "volume", Source: "sklubot_data", Target: "/x" }); }, /whole volume/],
    ["data volume above", (b) => { b.HostConfig.Mounts[0].VolumeOptions.Subpath = "workspaces/../sklubot.db"; }, /not allowed/],
    ["the database", (b) => { b.HostConfig.Mounts[0].VolumeOptions.Subpath = "sklubot.db"; }, /not allowed/],
    ["volume with bind driver", (b) => { b.HostConfig.Mounts.push({ Type: "volume", Source: "sklubot-home-x", Target: "/x", VolumeOptions: { DriverConfig: { Name: "local", Options: { type: "none", o: "bind", device: "/" } } } }); }, /driver options/],
    ["another volume", (b) => { b.HostConfig.Mounts.push({ Type: "volume", Source: "coolify-db", Target: "/x" }); }, /volume coolify-db/],
    ["host network", (b) => { b.HostConfig.NetworkMode = "host"; }, /network host/],
    ["Sklubot's own network", (b) => { b.HostConfig.NetworkMode = "sklubot_net"; }, /network sklubot_net/],
    ["second network", (b) => { b.NetworkingConfig.EndpointsConfig = { sklubot_docker: {} }; }, /network sklubot_docker/],
    ["host pid", (b) => { b.HostConfig.PidMode = "host"; }, /PidMode/],
    ["host ipc", (b) => { b.HostConfig.IpcMode = "host"; }, /IpcMode/],
    ["host uts", (b) => { b.HostConfig.UTSMode = "host"; }, /UTSMode/],
    ["host userns", (b) => { b.HostConfig.UsernsMode = "host"; }, /UsernsMode/],
    ["host cgroupns", (b) => { b.HostConfig.CgroupnsMode = "host"; }, /CgroupnsMode/],
    ["device", (b) => { b.HostConfig.Devices = [{ PathOnHost: "/dev/sda", PathInContainer: "/dev/sda", CgroupPermissions: "rwm" }]; }, /Devices/],
    ["gpu", (b) => { b.HostConfig.DeviceRequests = [{ Count: -1 }]; }, /DeviceRequests/],
    ["SYS_ADMIN", (b) => { b.HostConfig.CapAdd.push("SYS_ADMIN"); }, /SYS_ADMIN/],
    ["NET_RAW", (b) => { b.HostConfig.CapAdd.push("CAP_NET_RAW"); }, /NET_RAW/],
    ["caps kept", (b) => { b.HostConfig.CapDrop = []; }, /CapDrop must contain ALL/],
    ["no no-new-privileges", (b) => { b.HostConfig.SecurityOpt = []; }, /no-new-privileges/],
    ["seccomp off", (b) => { b.HostConfig.SecurityOpt.push("seccomp=unconfined"); }, /seccomp=unconfined/],
    ["apparmor off", (b) => { b.HostConfig.SecurityOpt.push("apparmor=unconfined"); }, /apparmor/],
    ["/proc unmasked", (b) => { b.HostConfig.MaskedPaths = []; b.HostConfig.ReadonlyPaths = []; }, /MaskedPaths/],
    ["sysctl", (b) => { b.HostConfig.Sysctls = { "kernel.core_pattern": "|/x" }; }, /Sysctls/],
    ["published port", (b) => { b.HostConfig.PortBindings = { "5900/tcp": [{ HostPort: "5900" }] }; }, /PortBindings/],
    ["extra host", (b) => { b.HostConfig.ExtraHosts = ["host.docker.internal:host-gateway"]; }, /ExtraHosts/],
    ["volumes from", (b) => { b.HostConfig.VolumesFrom = ["sklubot-server"]; }, /VolumesFrom/],
    ["cgroup parent", (b) => { b.HostConfig.CgroupParent = "/"; }, /CgroupParent/],
    ["restart policy", (b) => { b.HostConfig.RestartPolicy = { Name: "always" }; }, /restart/],
    ["log driver", (b) => { b.HostConfig.LogConfig = { Type: "syslog", Config: { "syslog-address": "tcp://x" } }; }, /log driver/],
    ["storage option", (b) => { b.HostConfig.StorageOpt = { dm: "x" }; }, /storage option dm/],
    ["other image", (b) => { b.Image = "alpine"; }, /image alpine/],
    ["server image", (b) => { b.Image = "sklubot-server"; }, /image sklubot-server/],
    ["no label", (b) => { b.Labels = {}; }, /label sklubot/],
    ["healthcheck command", (b) => { b.Healthcheck = { Test: ["CMD", "x"] }; }, /Healthcheck/],
    ["negative oom score", (b) => { b.HostConfig.OomScoreAdj = -1000; }, /OomScoreAdj/],
  ];
  for (const [name, change, why] of cases) {
    const b = desktopBody();
    change(b);
    const r = checkCreate(b, q(), policy);
    assert.ok(r, `${name} should be refused`);
    assert.match(r!, why, name);
  }
  assert.match(checkCreate(desktopBody(), q("name=coolify-proxy"), policy)!, /not one of Sklubot's/);
  assert.match(checkCreate(desktopBody(), q("name=sklubot-x&platform=linux&foo=1"), policy)!, /query parameter foo/);
  assert.match(checkCreate("[]", q(), policy)!, /not a JSON object/);
  // The image may be named in full; other tags are other images.
  for (const img of ["docker.io/library/sklubot-desktop", "sklubot-desktop:latest"]) { const b = desktopBody(); b.Image = img; assert.equal(checkCreate(b, q(), policy), null, img); }
  { const b = desktopBody(); b.Image = "sklubot-desktop:evil"; assert.ok(checkCreate(b, q(), policy)); }
});

test("H3: routes — only Sklubot's surface of the Docker API, the rest denied; paths cannot be smuggled", () => {
  const kind = (m: string, u: string) => route(m, u, policy).kind;
  assert.equal(kind("HEAD", "/_ping"), "pass");
  assert.equal(kind("GET", "/v1.56/version"), "pass");
  assert.equal(kind("GET", "/v1.56/info"), "pass");
  assert.equal(kind("POST", "/v1.56/containers/create?name=sklubot-x"), "create");
  assert.equal(kind("POST", "/v1.56/containers/sklubot-x/start"), "container");
  assert.equal(kind("POST", "/v1.56/containers/sklubot-x/exec"), "container");
  assert.equal(kind("DELETE", "/v1.56/containers/sklubot-x?force=1"), "container");
  assert.equal(kind("POST", "/v1.56/exec/abc/start"), "exec");
  assert.equal(kind("GET", "/v1.56/exec/abc/json"), "exec");
  assert.equal(kind("GET", "/v1.56/images/sklubot-desktop/json"), "pass");
  assert.equal(kind("GET", "/v1.56/networks/sklubot_bots"), "pass");
  assert.equal(kind("POST", "/v1.56/networks/create"), "network-create");
  assert.equal(kind("GET", "/v1.56/volumes/sklubot-home-x"), "pass");
  assert.equal(kind("DELETE", "/v1.56/volumes/sklubot-home-x?force=1"), "pass");
  for (const [m, u] of [
    ["POST", "/v1.56/containers/sklubot-x/update"], ["POST", "/v1.56/containers/sklubot-x/commit"], ["GET", "/v1.56/containers/sklubot-x/export"],
    ["POST", "/v1.56/build"], ["POST", "/v1.56/images/create?fromImage=alpine"], ["DELETE", "/v1.56/images/sklubot-desktop"],
    ["GET", "/v1.56/images/alpine/json"], ["POST", "/v1.56/swarm/init"], ["GET", "/v1.56/secrets"], ["POST", "/v1.56/plugins/pull"],
    ["DELETE", "/v1.56/volumes/sklubot_data"], ["DELETE", "/v1.56/volumes/coolify-db"], ["DELETE", "/v1.56/networks/sklubot_bots"],
    ["POST", "/v1.56/networks/sklubot_bots/connect"], ["GET", "/v1.56/events"], ["POST", "/v1.56/system/prune"], ["POST", "/v1.56/containers/prune"],
    ["POST", "/v1.56/session"], ["POST", "/v1.56/auth"], ["DELETE", "/v1.56/containers/sklubot-x?link=1"],
    ["POST", "/v1.56/containers/sklubot-x%2F..%2F..%2Fbuild/start"], ["POST", "/v1.56/containers/../build"], ["GET", "/v1.56/containers/x/json/../../../info"],
  ]) assert.equal(kind(m, u), "deny", `${m} ${u}`);
  // docker inspect of an unknown name: "not found" for the other kinds of objects.
  const r = route("GET", "/v1.56/plugins/sklubot-x/json", policy);
  assert.equal(r.kind === "deny" && r.status, 404);
});

test("H3: lists are narrowed to Sklubot's containers; execs, networks and volumes are checked", () => {
  const n = (s: string) => JSON.parse(narrowList(new URLSearchParams(s), policy).get("filters")!);
  assert.deepEqual(n("all=1"), { label: { sklubot: true } });
  assert.deepEqual(n(`filters=${encodeURIComponent(JSON.stringify({ label: { "sklubot=desktop": true } }))}`), { label: { "sklubot=desktop": true } });
  assert.deepEqual(n(`filters=${encodeURIComponent(JSON.stringify({ label: { other: true }, status: { running: true } }))}`), { label: { other: true, sklubot: true }, status: { running: true } });
  assert.equal(checkExecCreate({ Cmd: ["true"], Privileged: false }), null);
  assert.match(checkExecCreate({ Cmd: ["true"], Privileged: true })!, /privileged/);
  const netBody = { Name: "sklubot_bots", Driver: "bridge", Options: { "com.docker.network.bridge.enable_icc": "false", "com.docker.network.bridge.name": "sklubot-bots" }, Labels: { sklubot: "bots" }, IPAM: { Driver: "default", Options: {}, Config: [] }, Internal: false, Attachable: false, Ingress: false, ConfigOnly: false, ConfigFrom: null, Scope: "" };
  assert.equal(checkNetworkCreate(netBody, policy), null);
  assert.match(checkNetworkCreate({ ...netBody, Options: { "com.docker.network.bridge.name": "x" } }, policy)!, /enable_icc=false/);
  assert.match(checkNetworkCreate({ ...netBody, Options: { ...netBody.Options, "com.docker.network.bridge.enable_icc": "true" } }, policy)!, /must not reach each other/);
  assert.match(checkNetworkCreate({ ...netBody, Name: "evil" }, policy)!, /not one of Sklubot's/);
  assert.match(checkNetworkCreate({ ...netBody, Driver: "macvlan" }, policy)!, /bridge/);
  assert.match(checkNetworkCreate({ ...netBody, Options: { ...netBody.Options, "com.docker.network.bridge.host_binding_ipv4": "0.0.0.0" } }, policy)!, /option/);
  assert.equal(checkVolumeCreate({ Name: "sklubot-home-x" }, policy), null);
  assert.match(checkVolumeCreate({ Name: "sklubot-home-x", DriverOpts: { type: "none", o: "bind", device: "/" } }, policy)!, /driver options/);
  assert.match(checkVolumeCreate({ Name: "sklubot_data" }, policy)!, /home volume/);
});

// ── The proxy itself, in front of a fake Docker daemon on a Unix socket ──────
const dir = mkdtempSync(path.join(tmpdir(), "sklubot-proxy-"));
const sock = path.join(dir, "docker.sock");
const seen: string[] = [];
const containers: Record<string, Record<string, string>> = { "sklubot-bot_1": { sklubot: "desktop" }, coolify: { "coolify.managed": "true" } };
const fake = http.createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    seen.push(`${req.method} ${req.url}`);
    const m = /^(?:\/v1\.56)?\/containers\/([^/?]+)\/json/.exec(req.url ?? "");
    if (m) {
      const labels = containers[m[1]];
      res.writeHead(labels ? 200 : 404, { "content-type": "application/json" });
      return res.end(JSON.stringify(labels ? { Config: { Labels: labels } } : { message: "No such container" }));
    }
    if (/\/containers\/[^/]+\/exec$/.test(req.url ?? "")) { res.writeHead(201, { "content-type": "application/json" }); return res.end(JSON.stringify({ Id: "exec123" })); }
    if (/\/containers\/json/.test(req.url ?? "")) { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify([{ url: req.url }])); }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, body: Buffer.concat(chunks).toString("utf8") }));
  });
});
const upgraded: net.Socket[] = [];
fake.on("upgrade", (req, socket) => {
  upgraded.push(socket as net.Socket);
  seen.push(`UPGRADE ${req.method} ${req.url}`);
  socket.write("HTTP/1.1 101 UPGRADED\r\nContent-Type: application/vnd.docker.raw-stream\r\nConnection: Upgrade\r\nUpgrade: tcp\r\n\r\n");
  socket.on("data", (d) => socket.write(Buffer.concat([Buffer.from("echo:"), d])));
});
await new Promise<void>((r) => fake.listen(sock, () => r()));
const logs: string[] = [];
const proxy = createDockerProxy({ socketPath: sock, policy, log: (l) => logs.push(l) });
await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", () => r()));
const port = (proxy.address() as net.AddressInfo).port;
after(() => { for (const s of upgraded) s.destroy(); proxy.closeAllConnections(); proxy.close(); fake.closeAllConnections(); fake.close(); });

async function send(method: string, url: string, body?: unknown) {
  const res = await fetch(`http://127.0.0.1:${port}${url}`, { method, headers: body ? { "content-type": "application/json" } : {}, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, text: await res.text() };
}

test("H3: the proxy forwards what is allowed and answers 403/404 for the rest, before Docker ever sees it", async () => {
  seen.length = 0;
  assert.equal((await send("POST", "/v1.56/containers/create?name=sklubot-bot_1", desktopBody())).status, 200);
  const evil = desktopBody(); evil.HostConfig.Privileged = true;
  const refused = await send("POST", "/v1.56/containers/create?name=sklubot-bot_1", evil);
  assert.equal(refused.status, 403);
  assert.match(refused.text, /Privileged/);
  assert.equal(seen.filter((s) => s.includes("containers/create")).length, 1, "the refused body never reached Docker");
  // Container operations: only on containers with Sklubot's label; an unknown one is 404 like Docker's own answer.
  assert.equal((await send("POST", "/v1.56/containers/sklubot-bot_1/stop?t=3")).status, 200);
  assert.equal((await send("POST", "/v1.56/containers/coolify/stop")).status, 404);
  assert.equal((await send("DELETE", "/v1.56/containers/coolify?force=1")).status, 404);
  assert.equal((await send("POST", "/v1.56/containers/nothere/start")).status, 404);
  assert.ok(!seen.some((s) => /coolify\/(stop|start)|DELETE \/v1\.56\/containers\/coolify/.test(s)));
  // Lists are narrowed.
  const list = JSON.parse((await send("GET", "/v1.56/containers/json?all=1")).text);
  assert.match(decodeURIComponent(list[0].url), /"label":\{"sklubot":true\}/);
  // A start never carries settings.
  await send("POST", "/v1.56/containers/sklubot-bot_1/start", { HostConfig: { Privileged: true } });
  // Execs: only the ones created through the proxy; a privileged one never.
  assert.equal((await send("POST", "/v1.56/exec/unknown/start", { Detach: true })).status, 404);
  assert.equal((await send("POST", "/v1.56/containers/sklubot-bot_1/exec", { Cmd: ["id"], Privileged: true })).status, 403);
  assert.equal((await send("POST", "/v1.56/containers/coolify/exec", { Cmd: ["id"] })).status, 404);
  assert.equal((await send("POST", "/v1.56/containers/sklubot-bot_1/exec", { Cmd: ["id"] })).status, 201);
  assert.equal((await send("POST", "/v1.56/exec/exec123/start", { Detach: true })).status, 200);
  assert.equal((await send("GET", "/v1.56/exec/exec123/json")).status, 200);
  // Everything else.
  assert.equal((await send("POST", "/v1.56/build")).status, 403);
  assert.equal((await send("GET", "/v1.56/secrets")).status, 403);
  assert.ok(logs.some((l) => /refused POST \/v1\.56\/containers\/create: HostConfig\.Privileged/.test(l)));
});

test("H3: hijacked exec streams pass through both ways; unknown execs and foreign attaches are refused", async () => {
  const exchange = (url: string) => new Promise<string>((resolve) => {
    const s = net.connect(port, "127.0.0.1", () => {
      s.write(`POST ${url} HTTP/1.1\r\nHost: docker\r\nContent-Type: application/json\r\nConnection: Upgrade\r\nUpgrade: tcp\r\nContent-Length: 30\r\n\r\n{"Detach":false,"Tty":false} `);
      setTimeout(() => s.write("hello"), 100);
    });
    let got = "";
    s.on("data", (d) => { got += d.toString(); });
    setTimeout(() => { s.destroy(); resolve(got); }, 400);
  });
  const ok = await exchange("/v1.56/exec/exec123/start");
  assert.match(ok, /101 UPGRADED/);
  assert.match(ok, /echo:hello/);
  assert.match(await exchange("/v1.56/exec/never-made/start"), /404/);
  assert.match(await exchange("/v1.56/containers/coolify/attach?stream=1&stdout=1"), /404/);
  assert.match(await exchange("/v1.56/containers/sklubot-bot_1/attach?stream=1&stdout=1"), /101 UPGRADED/);
});
