#!/usr/bin/env node
// ---------------------------------------------------------------------------
// tests/cookie-e2e.cjs - Repro tinh nang "Luu phien cookie" -> "Chuyen sang phien nay"
// tren Chrome THAT qua CDP, khong mo phong.
//
// Chay: cd /mnt/Windows/ProJect/GenPass && node tests/cookie-e2e.cjs
//
// Kich ban:
//   S1 - Mo trang localhost (server local set 3 cookie: 1 domain cookie
//        Domain=localhost, 1 host-only, 1 HttpOnly) bang UI "+ Luu phien".
//   S2 - Doi cookie sang "tai khoan B" roi bam nut "Chuyen sang phien nay"
//        trong UI, kiem tra cookie co duoc ap dung nguoc lai tai khoan A.
//   S3 - Luu 2 tai khoan tren cung domain, chuyen qua lai giua 2 nut.
// Moi assert deu co bang chang thuc te (gia tri cookie doc tu Chrome).
// ---------------------------------------------------------------------------
"use strict";

const { spawn, execSync } = require("node:child_process");
const http = require("node:http");
const https = require("node:https");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = path.join(__dirname, "..");
const EXT_DIR = fs.realpathSync(ROOT);
const MANIFEST = JSON.parse(fs.readFileSync(path.join(EXT_DIR, "manifest.json"), "utf8"));
const PORT = Number(process.env.E2E_PORT || 9788);
const BASE = "http://127.0.0.1:" + PORT;
const CHROME_BIN = process.env.E2E_CHROME || "/usr/bin/google-chrome";
const SITE_PORT = Number(process.env.E2E_SITE_PORT || 8124);
const SITE_HOST = "localhost";
const SITE = "http://" + SITE_HOST + ":" + SITE_PORT + "/";
const HTTPS_SITE = "https://" + SITE_HOST + ":" + (Number(process.env.E2E_HTTPS_PORT) || 8443) + "/";
const OTHER_PORT = Number(process.env.E2E_OTHER_PORT || 8125);
const OTHER_SITE = "http://" + SITE_HOST + ":" + OTHER_PORT + "/";
const BOOT_TIMEOUT = 30000;

const WORK_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "genpass-cookie-e2e-"));
const USER_DIR = path.join(WORK_DIR, "profile");
// Cert tu sinh cho server HTTPS (test Secure/SameSite=None) - nam trong WORK_DIR
const CERT_KEY = path.join(WORK_DIR, "https-key.pem");
const CERT_CRT = path.join(WORK_DIR, "https-cert.pem");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function extIdFor(dir) {  const hex = crypto.createHash("sha256").update(dir).digest("hex").slice(0, 32);
  const map = { 0: "a", 1: "b", 2: "c", 3: "d", 4: "e", 5: "f", 6: "g", 7: "h", 8: "i", 9: "j", a: "k", b: "l", c: "m", d: "n", e: "o", f: "p" };
  return hex.split("").map((c) => map[c]).join("");
}
const EXT_ID = extIdFor(EXT_DIR);

class Abort extends Error {}
const RESULTS = [];
const CONSOLE_LOG = [];

function ctx() {
  const checks = [];
  return {
    checks,
    info: (label, evidence) => checks.push({ ok: true, label, evidence, info: true }),
    ok: (label, evidence) => checks.push({ ok: true, label, evidence }),
    bad: (label, evidence) => checks.push({ ok: false, label, evidence }),
    assert: (label, cond, evidence) => checks.push({ ok: !!cond, label, evidence }),
    require: (label, cond, evidence) => {
      checks.push({ ok: !!cond, label, evidence });
      if (!cond) throw new Abort("thieu dieu kien tien de: " + label);
    },
  };
}

async function scenario(id, title, fn, known) {
  const t0 = Date.now();
  const c = ctx();
  let fatal = null;
  try { await fn(c); }
  catch (e) {
    if (e instanceof Abort) fatal = e.message;
    else fatal = (e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : String(e));
  }
  const failed = c.checks.filter((x) => !x.ok);
  const ok = failed.length === 0 && !fatal;
  RESULTS.push({ id, ok: known ? true : ok });
  console.log("\n[%s] %s - %s (%dms)", known ? "KNOWN" : (ok ? "PASS" : "FAIL"), id, title, Date.now() - t0);
  for (const x of c.checks) {
    console.log("    %s %s | %s", x.info ? "info" : (x.ok ? "ok  " : "FAIL"), x.label, x.evidence);
  }
  if (fatal) console.log("    FATAL %s", fatal);
  return ok;
}

async function waitFor(label, timeout, fn) {
  const t0 = Date.now();
  for (;;) {
    let v = null;
    try { v = await fn(); } catch (e) { v = null; }
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error("TIMEOUT (" + timeout + "ms): " + label);
    await sleep(300);
  }
}

// ---------------------------------------------------------------------------
// CDP client
// ---------------------------------------------------------------------------
class CDP {
  constructor(wsUrl) { this.url = wsUrl; this.ws = null; this.id = 0; this.pending = new Map(); this.log = []; }
  async connect() {
    this.ws = new WebSocket(this.url);
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error("WS open timeout")), 20000);
      this.ws.addEventListener("open", () => { clearTimeout(t); res(); }, { once: true });
      this.ws.addEventListener("error", () => { clearTimeout(t); rej(new Error("WS error")); }, { once: true });
    });
    this.ws.addEventListener("message", (ev) => this._onMsg(ev));
    this.ws.addEventListener("close", () => {
      for (const [, p] of this.pending) p.rej(new Error("WS closed giua chung"));
      this.pending.clear();
    });
    return this;
  }
  _onMsg(ev) {
    let m = null;
    try { m = JSON.parse(typeof ev.data === "string" ? ev.data : String(ev.data)); } catch (e) { return; }
    if (m.id !== undefined && this.pending.has(m.id)) {
      const p = this.pending.get(m.id);
      this.pending.delete(m.id);
      clearTimeout(p.timer);
      if (m.error) p.rej(new Error(m.error.message + " (CDP " + m.error.code + ")"));
      else p.res(m.result);
      return;
    }
    if (m.method === "Runtime.consoleAPICalled") {
      const args = (m.params.args || []).map((a) => (a.value !== undefined ? String(a.value) : (a.description || a.type || "?")));
      CONSOLE_LOG.push({ type: m.params.type, text: args.join(" ") });
      this.log.push({ type: m.params.type, text: args.join(" ") });
    } else if (m.method === "Runtime.exceptionThrown") {
      const d = m.params.exceptionDetails || {};
      const text = String((d.exception && (d.exception.description || d.exception.value)) || d.text);
      CONSOLE_LOG.push({ type: "exception", text });
      this.log.push({ type: "exception", text });
    }
    if (this.log.length > 400) this.log.shift();
  }
  send(method, params, sessionId, timeout) {
    const id = ++this.id;
    const body = { id, method, params: params || {} };
    if (sessionId) body.sessionId = sessionId;
    const ms = timeout || 25000;
    return new Promise((res, rej) => {
      const timer = setTimeout(() => { this.pending.delete(id); rej(new Error("CDP timeout " + ms + "ms: " + method)); }, ms);
      this.pending.set(id, { res, rej, timer });
      try { this.ws.send(JSON.stringify(body)); } catch (e) { this.pending.delete(id); clearTimeout(timer); rej(e); }
    });
  }
  async ev(sessionId, expr, timeout) {
    const r = await this.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }, sessionId, (timeout || 20000) + 3000);
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error("EVAL " + String((d.exception && (d.exception.description || d.exception.value)) || d.text).split("\n")[0] + " :: " + expr.slice(0, 70));
    }
    return r.result ? r.result.value : undefined;
  }
  close() { try { if (this.ws) this.ws.close(); } catch (e) {} }
}

// ---------------------------------------------------------------------------
// Vong doi trinh duyet
// ---------------------------------------------------------------------------
const BR = { proc: null, cdp: null, dead: false, exitInfo: "", targets: [] };

function chromeArgs(dir, withFlag) {
  const a = [
    "--headless=new", "--no-sandbox", "--disable-gpu", "--no-first-run",
    "--disable-dev-shm-usage", "--user-data-dir=" + dir,
    "--remote-debugging-port=" + PORT,
    "--host-resolver-rules=MAP localhost 127.0.0.1",
    "--ignore-certificate-errors",
    "about:blank",
  ];
  if (withFlag) a.splice(a.length - 1, 0, "--load-extension=" + EXT_DIR);
  return a;
}

function spawnChrome(dir, withFlag) {
  const p = spawn(CHROME_BIN, chromeArgs(dir, withFlag), { stdio: ["ignore", "ignore", "ignore"], detached: true });
  p.on("error", (e) => { BR.dead = true; BR.exitInfo = "spawn error: " + e.message; try { p.kill("SIGKILL"); } catch (x) {} });
  p.on("exit", (code, signal) => {
    if (code !== 0 && code !== null) { BR.dead = true; BR.exitInfo = "exit code " + code + " signal " + signal; }
  });
  return p;
}

async function waitDevtools(timeout) {
  return waitFor("devtools port " + PORT, timeout || BOOT_TIMEOUT, async () => {
    try { const r = await fetch("http://127.0.0.1:" + PORT + "/json/version", { cache: "no-store" }); await r.json(); return true; } catch (e) { return false; }
  });
}

function killBrowser(sig) {
  if (!BR.proc) return;
  try { process.kill(-BR.proc.pid, sig || "SIGKILL"); } catch (e) {
    try { BR.proc.kill(sig || "SIGKILL"); } catch (x) {}
  }
}

async function stopBrowser() {
  if (BR.cdp) { BR.cdp.close(); BR.cdp = null; }
  killBrowser("SIGKILL");
  if (BR.proc) { await Promise.race([new Promise((r) => BR.proc.once("exit", r)), sleep(4000)]); BR.proc = null; }
  await sleep(800);
}

async function injectExtensionIntoProfile(dir) {
  const prefPath = path.join(dir, "Default", "Preferences");
  if (!fs.existsSync(prefPath)) throw new Error("khong thay Default/Preferences sau lan boot dau");
  const prefs = JSON.parse(fs.readFileSync(prefPath, "utf8"));
  prefs.extensions = prefs.extensions || {};
  prefs.extensions.settings = prefs.extensions.settings || {};
  prefs.extensions.settings[EXT_ID] = {
    path: EXT_DIR,
    location: 4,
    state: 1,
    manifest: MANIFEST,
    was_installed_by_default: false,
    from_webstore: false,
    install_time: "17000000000000000",
  };
  fs.writeFileSync(prefPath, JSON.stringify(prefs));
}

// Dev mode khi Chrome >= 133 tat extension unpacked
const CLICK_DEV_MODE_FIX = `(() => {
  const found = [];
  const walk = (n) => {
    if (!n) return;
    if (n.shadowRoot) {
      const t = n.shadowRoot.querySelector("#dev-mode") || n.shadowRoot.querySelector("cr-toggle");
      if (t) found.push(t);
      walk(n.shadowRoot);
    }
    for (const k of Array.from(n.children || [])) walk(k);
  };
  walk(document);
  if (!found.length) return "NO_TOGGLE";
  const t = found[0];
  const before = t.checked;
  t.click();
  return "before=" + before + " after=" + t.checked;
})()`;

async function enableDeveloperMode(cdp) {
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  await cdp.send("Runtime.enable", {}, sessionId);
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Page.navigate", { url: "chrome://extensions" }, sessionId);
  const res = await waitFor("click developer mode", 15000, () =>
    cdp.ev(sessionId, CLICK_DEV_MODE_FIX, 10000).then((v) => (v && v.indexOf("after=") >= 0 && v.indexOf("after=true") >= 0 ? v : null)).catch(() => null));
  await sleep(2000);
  try { await cdp.send("Target.closeTarget", { targetId }); } catch (e) {}
  return res;
}

const BOOT_EXPR = "document.readyState === 'complete' && !!document.getElementById('vault-lock') && typeof GPVault !== 'undefined'";

async function boot() {
  fs.rmSync(USER_DIR, { recursive: true, force: true });
  fs.mkdirSync(USER_DIR, { recursive: true });

  const stray = await fetch("http://127.0.0.1:" + PORT + "/json/version", { cache: "no-store" }).then((r) => r.json()).catch(() => null);
  if (stray) {
    console.log("[WARN] port %d dang bi giu -> thu Browser.close", PORT);
    try {
      const ws = new WebSocket(stray.webSocketDebuggerUrl);
      await new Promise((r, j) => { const t = setTimeout(() => j(new Error("to")), 5000); ws.addEventListener("open", r, { once: true }); ws.addEventListener("error", j, { once: true }); });
      ws.send(JSON.stringify({ id: 1, method: "Browser.close" }));
      await sleep(1500);
      ws.close();
    } catch (e) { console.log("[WARN] khong dong duoc trinh duyet le: " + e.message); }
  }

  BR.proc = spawnChrome(USER_DIR, true);
  let loaded = false;
  if (await waitDevtools().catch(() => null) && !BR.dead) {
    try {
      BR.cdp = await new CDP((await (await fetch("http://127.0.0.1:" + PORT + "/json/version", { cache: "no-store" })).json()).webSocketDebuggerUrl).connect();
      const rec = await createTabTarget("chrome-extension://" + EXT_ID + "/popup.html", "boot");
      const fine = await BR.cdp.ev(rec.sessionId, "location.href.indexOf('chrome-extension://') === 0 && typeof GPVault !== 'undefined'", 8000).catch(() => false);
      loaded = !!fine;
      await closeTarget(rec);
    } catch (e) {
      console.log("[INFO] --load-extension khong thanh cong: " + e.message);
      loaded = false;
      if (BR.cdp) { BR.cdp.close(); BR.cdp = null; }
    }
  } else {
    console.log("[INFO] Chrome khong len voi --load-extension (dead=" + BR.dead + " " + BR.exitInfo + ")");
  }
  if (!loaded) {
    await stopBrowser();
    console.log("[INFO] bootstrap profile + developer mode");
    BR.proc = spawnChrome(USER_DIR, false);
    await waitDevtools().catch(() => null);
    await sleep(2000);
    if (BR.cdp) { BR.cdp.close(); BR.cdp = null; }
    BR.proc.kill("SIGTERM");
    await Promise.race([new Promise((r) => BR.proc.once("exit", r)), sleep(6000)]);
    BR.proc = null;
    await injectExtensionIntoProfile(USER_DIR);
    BR.proc = spawnChrome(USER_DIR, false);
    if (!await waitDevtools().catch(() => null)) throw new Error("Chrome khong khoi dong duoc sau bootstrap");
    BR.cdp = await new CDP((await (await fetch("http://127.0.0.1:" + PORT + "/json/version", { cache: "no-store" })).json()).webSocketDebuggerUrl).connect();
    const mode = await enableDeveloperMode(BR.cdp);
    console.log("[INFO] developer mode: %s", mode);
    const probe = await createTabTarget("chrome-extension://" + EXT_ID + "/popup.html", "bootstrap-check");
    await waitFor("popup bootstrap boot", 20000, () => BR.cdp.ev(probe.sessionId, "document.readyState === 'complete' && typeof GPVault === 'object'", 8000).catch(() => false));
    const fine = await BR.cdp.ev(probe.sessionId, "location.href.indexOf('chrome-extension://') === 0 && typeof GPVault === 'object'", 10000).catch(() => false);
    if (!fine) {
      const dbg = await BR.cdp.ev(probe.sessionId, "JSON.stringify({href: location.href, title: document.title, body: (document.body ? document.body.innerText.slice(0,200) : '')})", 8000).catch(() => "?");
      console.log("[DEBUG] trang probe: %s", dbg);
    }
    if (!fine) { await closeTarget(probe); throw new Error("extension van khong nap duoc sau bootstrap (NOT VERIFIED)"); }
    await closeTarget(probe);
  }
  if (BR.dead) throw new Error("trinh duyet chet som: " + BR.exitInfo);
  const ver = await (await fetch("http://127.0.0.1:" + PORT + "/json/version", { cache: "no-store" })).json();
  console.log("\n[INFO] Chrome %j, extension id %s", ver.Browser, EXT_ID);
}

async function createTabTarget(url, tag) {
  const { targetId } = await BR.cdp.send("Target.createTarget", { url });
  const { sessionId } = await BR.cdp.send("Target.attachToTarget", { targetId, flatten: true });
  await BR.cdp.send("Runtime.enable", {}, sessionId);
  const rec = { tag, targetId, sessionId, url };
  BR.targets.push(rec);
  return rec;
}

async function closeTarget(rec) {
  try { await BR.cdp.send("Target.closeTarget", { targetId: rec.targetId }); } catch (e) {}
  const i = BR.targets.indexOf(rec);
  if (i >= 0) BR.targets.splice(i, 1);
}

const q = (rec, expr) => BR.cdp.ev(rec.sessionId, expr);
const click = (rec, sel) => BR.cdp.ev(rec.sessionId, "(() => { var e = document.querySelector(" + JSON.stringify(sel) + "); if (!e) return false; e.click(); return true; })()");

// Doc/gia row cookie qua trang extension (co quyen chrome.cookies)
const cookieGetAll = (rec, url) => q(rec, "new Promise((r) => chrome.cookies.getAll({ url: " + JSON.stringify(url) + " }, (v) => r(v || [])))");
const cookieSet = (rec, spec) => q(rec, "new Promise((r) => { chrome.cookies.set(" + JSON.stringify(spec) + ", (c) => r(c ? c.name + '=' + c.value : 'FAIL_SET')); })");
const cookieRemove = (rec, url, name) => q(rec, "new Promise((r) => { chrome.cookies.remove({ url: " + JSON.stringify(url) + ", name: " + JSON.stringify(name) + " }, (v) => r(v)); })");
const storageLocal = (rec, keys) => q(rec, "new Promise((r) => chrome.storage.local.get(" + JSON.stringify(keys) + ", (v) => r(v || {})))");

// ---------------------------------------------------------------------------
// Server trang gia: set cookie nhu trang that (1 domain cookie + 1 host-only + 1 session)
// ---------------------------------------------------------------------------
function startSiteServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      // Chi set cookie o lan dau (request khong mang Cookie header).
      // Neu khong, moi lan reload sau khi apply phien se bi server ghi de.
      const headers = req.headers.cookie ? [] : [
        "sess_user=userA; Domain=localhost; Path=/; HttpOnly",
        "sub_state=v1; Domain=localhost; Path=/",
        "host_only=abc123; Path=/",
      ];
      const out = { "Content-Type": "text/html; charset=utf-8" };
      if (headers.length) out["Set-Cookie"] = headers;
      res.writeHead(200, out);
      res.end("<!doctype html><html><head><title>MySite</title></head><body>site ok</body></html>");
    });
    server.listen(SITE_PORT, "127.0.0.1", () => resolve(server));
  });
}

// Server HTTPS voi cookie kieu Facebook that: Secure + SameSite=None + HttpOnly
function startHttpsSiteServer() {
  return new Promise((resolve) => {
    if (!fs.existsSync(CERT_KEY) || !fs.existsSync(CERT_CRT)) {
      execSync("openssl req -x509 -newkey rsa:2048 -keyout " + JSON.stringify(CERT_KEY) + " -out " + JSON.stringify(CERT_CRT) + " -days 2 -nodes -subj /CN=localhost", { stdio: "ignore" });
    }
    const port = Number(new URL(HTTPS_SITE).port);
    const server = https.createServer({
      key: fs.readFileSync(CERT_KEY),
      cert: fs.readFileSync(CERT_CRT),
    }, (req, res) => {
      const headers = req.headers.cookie ? [] : [
        "sess_user=userA; Domain=localhost; Path=/; HttpOnly; Secure; SameSite=None",
        "sub_state=v1; Domain=localhost; Path=/; Secure; SameSite=None",
        "host_only=abc123; Path=/; Secure; SameSite=Lax",
      ];
      const out = { "Content-Type": "text/html; charset=utf-8" };
      if (headers.length) out["Set-Cookie"] = headers;
      res.writeHead(200, out);
      res.end("<!doctype html><html><head><title>SecureSite</title></head><body>https ok</body></html>");
    });
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

// Server cua mot site KHAC (khong co cookie dang nhap) - de test chuyen phien
// khi user dang dung site khac.
function startOtherServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<!doctype html><html><head><title>OtherSite</title></head><body>other</body></html>");
    });
    server.listen(OTHER_PORT, "127.0.0.1", () => resolve(server));
  });
}

// ---------------------------------------------------------------------------
// Kich ban
// ---------------------------------------------------------------------------
async function main() {
  const server = await startSiteServer();
  console.log("[INFO] site server: %s", SITE);

  await boot();

  // A: tab trang that, B: popup.html mo nhu tab (chinh la cach dung' khi bam icon)
  const tabA = await createTabTarget(SITE, "site");
  await waitFor("tab A load xong", 15000, () => q(tabA, "document.readyState === 'complete' && document.title === 'MySite'").catch(() => false)).catch(async (e) => {
    const dbg = await q(tabA, "JSON.stringify({href: location.href, ready: document.readyState, title: document.title, body: (document.body ? document.body.innerText.slice(0,300) : '')})", 8000).catch(() => "eval fail");
    console.log("[DEBUG] tab A state: %s", dbg);
    throw e;
  });
  // Popup tab: cung cua so voi tab A -> currentWindow cua popup tro dung tab A
  const tabB = await createTabTarget("chrome-extension://" + EXT_ID + "/popup.html?tab=cookies", "popup");
  await waitFor("popup boot", 20000, () => q(tabB, BOOT_EXPR).catch(() => false));
  // Kich hoat lai tab A: khi popup THAT mo, active tab luon la trang web
  try { await BR.cdp.send("Target.activateTarget", { targetId: tabA.targetId }); } catch (e) { console.log("[WARN] activateTarget: " + e.message); }
  await sleep(500);

  // Choi thu: popup thay tab nao la active?
  const seenActive = await q(tabB, "new Promise((r) => chrome.tabs.query({ active: true, currentWindow: true }, (t) => r(t && t[0] ? t[0].url : null)))");
  console.log("[INFO] popup thay active tab = %s", seenActive);

  // ---------------------------------------------------------------- S1 ------
  await scenario("S1", 'UI "+ Luu phien" luu cookie cua trang localhost', async (c) => {
    c.assert("popup thay active tab la trang web (khong phai popup)", typeof seenActive === "string" && seenActive.indexOf(SITE_HOST) >= 0, "active=" + seenActive);

    const toggled = await click(tabB, "#btn-toggle-add-cookie-profile");
    c.assert('bam duoc "+ Luu phien"', toggled === true, "toggle=" + toggled);
    const cardHidden = await q(tabB, "(() => { var e = document.getElementById('card-save-cookie-profile'); return e ? e.hidden : null; })()");
    c.assert("card luu phien hien ra", cardHidden === false, "hidden=" + cardHidden);

    await q(tabB, "(() => { var e = document.getElementById('input-cookie-profile-name'); e.value = 'Tai khoan A'; return e.value; })()");
    const confirmed = await click(tabB, "#btn-confirm-save-cookie-profile");
    c.assert("bam duoc nut xac nhan luu", confirmed === true, "confirm=" + confirmed);

    const stored = await waitFor("genCookieProfiles xuat hien trong storage.local", 8000, async () => {
      const s = await storageLocal(tabB, ["genCookieProfiles"]);
      if (Array.isArray(s.genCookieProfiles) && s.genCookieProfiles.length > 0) return s.genCookieProfiles;
      return null;
    }).catch(() => null);

    if (!stored) {
      c.bad("profile duoc ghi vao storage", "genCookieProfiles rong hoac khong co");

      const s2 = await storageLocal(tabB, null);
      c.info("storage.local keys", Object.keys(s2).sort().join(","));
      const warns = CONSOLE_LOG.filter((x) => /Cookie|cookie/i.test(x.text)).slice(-5);
      c.info("console gan nhat", warns.map((x) => x.type + ":" + x.text).join(" || ").slice(0, 300));
      return;
    }

    c.ok("profile duoc ghi vao storage", "so profile=" + stored.length);
    const p0 = stored[0];
    c.info("profile[0]", JSON.stringify({ profileName: p0.profileName, domain: p0.domain, url: p0.url, cookieCount: p0.cookieCount, names: (p0.cookies || []).map((x) => x.name) }));
    const names = (p0.cookies || []).map((x) => x.name);
    c.assert("luu du ca 3 cookie (domain + host-only + session)", names.length === 3 && names.indexOf("sess_user") >= 0 && names.indexOf("host_only") >= 0, "names=" + JSON.stringify(names));
    c.assert("domain luu dung localhost", p0.domain === SITE_HOST, "domain=" + p0.domain);
  });

  // Dong popup, mo lai qua duong THAT hon: bam icon khong the mo phong duoc,
  // nhung popup tab chinh la luong save/use dung. Giu nguyen tab B.

  // ---------------------------------------------------------------- S2 ------
  await scenario("S2", 'Bam "Chuyen sang phien nay" -> cookie duoc ap dung nguoc lai', async (c) => {
    const before = await cookieGetAll(tabB, SITE);
    const beforeMap = {};
    for (const x of before) beforeMap[x.name] = x.value;
    c.info("cookie truoc khi chuyen", JSON.stringify(beforeMap));
    c.assert("hien dang la trang thai tai khoan A (sau khi luu)", beforeMap.sess_user === "userA", "sess_user=" + beforeMap.sess_user);

    // Doi sang "tai khoan B"
    await cookieSet(tabB, { url: SITE, name: "sess_user", value: "userB", domain: "localhost", path: "/", secure: false });
    await cookieSet(tabB, { url: SITE, name: "host_only", value: "zzz", path: "/" });
    await cookieRemove(tabB, SITE, "sub_state");
    const midArr = await cookieGetAll(tabB, SITE);
    const mid = {};
    for (const x of midArr) mid[x.name] = x.value;
    c.info("cookie luc dang o phien B", JSON.stringify(mid));
    c.assert("da chuyen tab sang du lieu B", mid.sess_user === "userB" && mid.host_only === "zzz" && mid.sub_state === undefined, JSON.stringify(mid));

    CONSOLE_LOG.length = 0;
    const clicked = await waitFor("nut Chuyen sang phien nay xuat hien trong list", 8000, () =>
      q(tabB, "document.querySelectorAll('.cookie-btn-switch').length").then((n) => (n > 0 ? n : null)).catch(() => null));
    c.assert("co nut switch trong danh sach", clicked && clicked > 0, "so nut=" + clicked);

    const clickedOk = await q(tabB, "document.querySelectorAll('.cookie-btn-switch')[0].click(); true");
    c.assert("da bam nut chuyen phien[0]", clickedOk === true, "click=" + clickedOk);

    // Cho cookie duoc set lai
    await sleep(2500);

    const afterArr = await cookieGetAll(tabB, SITE);
    const after = {};
    for (const x of afterArr) after[x.name] = x.value;
    c.info("cookie SAU khi bam chuyen phien", JSON.stringify(after));

    const errs = CONSOLE_LOG.filter((x) => x.type === "error" || /Cookie set error/i.test(x.text));
    c.info("console loi/warn trong qua trinh apply", errs.map((x) => x.text).join(" || ").slice(0, 400) || "(khong co)");

    c.assert("sess_user quay ve userA", after.sess_user === "userA", "thuc te=" + after.sess_user);
    c.assert("host_only quay ve abc123", after.host_only === "abc123", "thuc te=" + after.host_only);
    c.assert("sub_state quay ve v1", after.sub_state === "v1", "thuc te=" + after.sub_state);
  });

  // ---------------------------------------------------------------- S3 ------
  await scenario("S3", "Luu them tai khoan thu 2 roi chuyen qua lai giua 2 phien", async (c) => {
    // Trang dang o trang thai A (S2 vua apply). Doi sang B roi luu "Tai khoan B" qua UI
    await cookieSet(tabB, { url: SITE, name: "sess_user", value: "userB", domain: "localhost", path: "/", secure: false });
    await q(tabB, "(() => { document.getElementById('btn-toggle-add-cookie-profile').click(); document.getElementById('input-cookie-profile-name').value = 'Tai khoan B'; document.getElementById('btn-confirm-save-cookie-profile').click(); return true; })()");

    const stored = await waitFor("luu xong Tai khoan B", 8000, async () => {
      const s = await storageLocal(tabB, ["genCookieProfiles"]);
      const arr = Array.isArray(s.genCookieProfiles) ? s.genCookieProfiles : [];
      return arr.find((p) => p.profileName === "Tai khoan B") || null;
    }).catch(() => null);
    if (!stored) { c.bad("luu duoc Tai khoan B qua UI", "storage khong co 'Tai khoan B'"); return; }
    c.ok("luu duoc Tai khoan B qua UI", "cookies=" + (stored.cookies || []).map((x) => x.name + "=" + x.value).join(","));

    const cnt = await q(tabB, "document.querySelectorAll('.cookie-btn-switch').length");
    c.assert("list co 2 nut chuyen phien", cnt === 2, "so nut=" + cnt);

    // Bam nut thu 2 (Tai khoan A duoc unshift len dau -> thu tu DOM co the A,B hoac B,A)
    const order = await q(tabB, "JSON.stringify(Array.from(document.querySelectorAll('.cookie-profile-name')).map((e) => e.textContent))");
    c.info("thu tu profile trong DOM", order);
    const orderArr = JSON.parse(order || "[]");
    const idxA = orderArr.findIndex((t) => t.indexOf("A") >= 0);
    const idxB = orderArr.findIndex((t) => t.indexOf("B") >= 0);

    // Bam chuyen sang phien B
    await q(tabB, "document.querySelectorAll('.cookie-btn-switch')[" + idxB + "].click(); true");
    await sleep(2000);
    const afterB = {};
    for (const x of await cookieGetAll(tabB, SITE)) afterB[x.name] = x.value;
    c.info("sau bam phien B", JSON.stringify(afterB));
    c.assert("chuyen sang phien B -> sess_user=userB", afterB.sess_user === "userB", "thuc te=" + afterB.sess_user);

    // Bam chuyen sang phien A
    await q(tabB, "document.querySelectorAll('.cookie-btn-switch')[" + idxA + "].click(); true");
    await sleep(2000);
    const afterA = {};
    for (const x of await cookieGetAll(tabB, SITE)) afterA[x.name] = x.value;
    c.info("sau bam phien A", JSON.stringify(afterA));
    c.assert("chuyen ve phien A -> sess_user=userA", afterA.sess_user === "userA", "thuc te=" + afterA.sess_user);
  });

  // ---------------------------------------------------------------- S4 ------
  await scenario("S4", 'Chuyen phien khi dang o site KHAC -> mo tab dich + ap dung cookie', async (c) => {
    const httpsServer = await startHttpsSiteServer();
    const otherServer = await startOtherServer();

    // Tab D: trang https kieu Facebook (Secure + SameSite=None)
    const tabD = await createTabTarget(HTTPS_SITE, "secure-site");
    await waitFor("tab D load xong", 15000, () => q(tabD, "document.readyState === 'complete' && document.title === 'SecureSite'").catch(() => false));
    try { await BR.cdp.send("Target.activateTarget", { targetId: tabD.targetId }); } catch (e) {}

    // Luu phien qua UI tren site https
    await q(tabB, "(() => { document.getElementById('btn-toggle-add-cookie-profile').click(); document.getElementById('input-cookie-profile-name').value = 'Facebook-style'; document.getElementById('btn-confirm-save-cookie-profile').click(); return true; })()");
    const stored = await waitFor("luu phien https", 8000, async () => {
      const s = await storageLocal(tabB, ["genCookieProfiles"]);
      const arr = Array.isArray(s.genCookieProfiles) ? s.genCookieProfiles : [];
      return arr.find((p) => p.profileName === "Facebook-style") || null;
    }).catch(() => null);
    c.assert("luu duoc phien https qua UI", !!stored, stored ? "cookies=" + (stored.cookies || []).map((x) => x.name).join(",") : "khong thay trong storage");
    if (stored) {
      const names = (stored.cookies || []).map((x) => x.name);
      c.assert("luu du 3 cookie cua trang https", names.length === 3, "names=" + JSON.stringify(names));
    }

    // Tab E: site khac, khong co cookie dang nhap -> lam active
    const tabE = await createTabTarget(OTHER_SITE, "other-site");
    await waitFor("tab E load xong", 15000, () => q(tabE, "document.readyState === 'complete' && document.title === 'OtherSite'").catch(() => false));
    try { await BR.cdp.send("Target.activateTarget", { targetId: tabE.targetId }); } catch (e) {}
    await sleep(300);

    const activeNow = await q(tabB, "new Promise((r) => chrome.tabs.query({ active: true, currentWindow: true }, (t) => r(t && t[0] ? t[0].url : null)))");
    c.info("popup thay active tab luc bam chuyen", String(activeNow));

    CONSOLE_LOG.length = 0;
    // Bam nut cua phien Facebook-style
    const idx = await q(tabB, "JSON.stringify(Array.from(document.querySelectorAll('.cookie-profile-name')).map((e) => e.textContent))").then((v) => {
      const arr = JSON.parse(v || "[]");
      return arr.findIndex((t) => t.indexOf("Facebook-style") >= 0);
    });
    c.assert("tim thay nut cua phien Facebook-style", idx >= 0, "idx=" + idx);

    await q(tabB, "document.querySelectorAll('.cookie-btn-switch')[" + idx + "].click(); true");

    // Cho tab dich duoc mo va cookie duoc set
    await sleep(3000);

    // Tab dich (https site) phai duoc mo lai (hoac da co san) va co cookie phien
    const httpsJar = {};
    for (const x of await cookieGetAll(tabB, HTTPS_SITE)) httpsJar[x.name] = x.value;
    c.info("cookie jar sau khi chuyen tu site khac", JSON.stringify(httpsJar));
    c.assert("sess_user=userA ap dung tren site https", httpsJar.sess_user === "userA", "thuc te=" + httpsJar.sess_user);

    const errs = CONSOLE_LOG.filter((x) => /Cookie set error/i.test(x.text));
    c.info("console loi tu chrome.cookies.set", errs.map((x) => x.text).join(" || ").slice(0, 300) || "(khong co)");

    const targets = await (await fetch("http://127.0.0.1:" + PORT + "/json/list", { cache: "no-store" })).json();
    const openSecure = targets.filter((t) => t.type === "page" && (t.url || "").indexOf(new URL(HTTPS_SITE).host) >= 0);
    c.info("tab dich con mo", openSecure.map((t) => t.url).join(","));
    c.assert("co tab site dich duoc mo/giu nguyen", openSecure.length >= 1, "so tab=" + openSecure.length);

    await closeTarget(tabD);
    await closeTarget(tabE);
    httpsServer.close();
    otherServer.close();
  });

  // ---------------------------------------------------------------- S5 ------
  await scenario("S5", "Doi phien qua lai tren site https (Secure + SameSite=None)", async (c) => {
    const httpsServer = await startHttpsSiteServer();
    const tabD = await createTabTarget(HTTPS_SITE, "secure-site2");
    await waitFor("tab D2 load xong", 15000, () => q(tabD, "document.readyState === 'complete' && document.title === 'SecureSite'").catch(() => false));
    try { await BR.cdp.send("Target.activateTarget", { targetId: tabD.targetId }); } catch (e) {}

    const jar0 = {};
    for (const x of await cookieGetAll(tabB, HTTPS_SITE)) jar0[x.name] = x.value;
    c.info("cookie ban dau tren https", JSON.stringify(jar0));

    // Luu phien B: doi cookie sang userB roi luu qua UI
    await cookieSet(tabB, { url: HTTPS_SITE, name: "sess_user", value: "userB", domain: "localhost", path: "/", secure: true, httpOnly: true, sameSite: "no_restriction" });
    await q(tabB, "(() => { document.getElementById('btn-toggle-add-cookie-profile').click(); document.getElementById('input-cookie-profile-name').value = 'Secure B'; document.getElementById('btn-confirm-save-cookie-profile').click(); return true; })()");
    const storedB = await waitFor("luu phien Secure B", 8000, async () => {
      const s = await storageLocal(tabB, ["genCookieProfiles"]);
      const arr = Array.isArray(s.genCookieProfiles) ? s.genCookieProfiles : [];
      return arr.find((p) => p.profileName === "Secure B") || null;
    }).catch(() => null);
    c.assert("luu duoc phien Secure B", !!storedB && (storedB.cookies || []).some((x) => x.value === "userB"), storedB ? "ok" : "fail");

    const order = await q(tabB, "JSON.stringify(Array.from(document.querySelectorAll('.cookie-profile-name')).map((e) => e.textContent))");
    const arr = JSON.parse(order || "[]");
    c.info("thu tu profile hien tai", order);
    const idxFA = arr.findIndex((t) => t.indexOf("Facebook-style") >= 0); // phien A (userA)
    const idxB = arr.findIndex((t) => t.indexOf("Secure B") >= 0);

    // Bam chuyen sang phien B
    CONSOLE_LOG.length = 0;
    await q(tabB, "document.querySelectorAll('.cookie-btn-switch')[" + idxB + "].click(); true");
    await sleep(2500);
    const jarB = {};
    for (const x of await cookieGetAll(tabB, HTTPS_SITE)) jarB[x.name] = x.value;
    c.info("sau bam phien Secure B", JSON.stringify(jarB));
    const errsB = CONSOLE_LOG.filter((x) => /Cookie set error/i.test(x.text));
    c.info("console loi apply B", errsB.map((x) => x.text).join(" || ").slice(0, 300) || "(khong co)");
    c.assert("chuyen sang B: sess_user=userB", jarB.sess_user === "userB", "thuc te=" + jarB.sess_user);

    // Bam chuyen ve phien A (Facebook-style, userA)
    CONSOLE_LOG.length = 0;
    await q(tabB, "document.querySelectorAll('.cookie-btn-switch')[" + idxFA + "].click(); true");
    await sleep(2500);
    const jarA = {};
    for (const x of await cookieGetAll(tabB, HTTPS_SITE)) jarA[x.name] = x.value;
    c.info("sau bam phien A", JSON.stringify(jarA));
    const errsA = CONSOLE_LOG.filter((x) => /Cookie set error/i.test(x.text));
    c.info("console loi apply A", errsA.map((x) => x.text).join(" || ").slice(0, 300) || "(khong co)");
    c.assert("chuyen ve A: sess_user=userA", jarA.sess_user === "userA", "thuc te=" + jarA.sess_user);

    await closeTarget(tabD);
    httpsServer.close();
  });

  // ---------------------------------------------------------------- S6 ------
  await scenario("S6", "Cookie HET HAN trong phien da luu -> bam chuyen co that su dung duoc?", async (c) => {
    // Gia lap phien luu tu vai ngay truoc: moi cookie trong profile mang
    // expirationDate da qua (Chrome da don chung khoi jar nhung profile van giu).
    const stored = await storageLocal(tabB, ["genCookieProfiles"]);
    const profiles = Array.isArray(stored.genCookieProfiles) ? JSON.parse(JSON.stringify(stored.genCookieProfiles)) : [];
    const target = profiles.find((p) => p.profileName === "Tai khoan A");
    c.assert("tim thay phien 'Tai khoan A' de gia lap het han", !!target, "profiles=" + profiles.map((p) => p.profileName).join(","));
    if (!target) return;

    const past = Math.floor(Date.now() / 1000) - 7 * 24 * 3600; // 7 ngay truoc
    for (const ck of target.cookies) ck.expirationDate = past;
    await q(tabB, "new Promise((r) => chrome.storage.local.set({ genCookieProfiles: " + JSON.stringify(profiles) + " }, () => r(true)))");
    await sleep(500);

    // Cho popup nap lai trang thai moi (reload tab popup giu nguyen quyen)
    await BR.cdp.send("Page.reload", {}, tabB.sessionId).catch(() => {});
    await waitFor("popup reload xong", 15000, () => q(tabB, "document.readyState === 'complete' && !!document.querySelector('.cookie-btn-switch')", 8000).catch(() => false));

    // Doi trang sang trang thai khac roi bam chuyen phien da het han
    await cookieSet(tabB, { url: SITE, name: "sess_user", value: "userZ", path: "/" });
    const jarBefore = {};
    for (const x of await cookieGetAll(tabB, SITE)) jarBefore[x.name] = x.value;
    c.info("cookie truoc khi bam phien het han", JSON.stringify(jarBefore));

    // Bam dung nut cua phien "Tai khoan A" (phien vua cho het han), khong phai nut[0]
    const names = JSON.parse(await q(tabB, "JSON.stringify(Array.from(document.querySelectorAll('.cookie-profile-name')).map((e) => e.textContent))") || "[]");
    const idxExpired = names.findIndex((t) => t.indexOf("Tai khoan A") >= 0);
    c.assert("tim thay nut cua phien 'Tai khoan A' trong DOM", idxExpired >= 0, "names=" + JSON.stringify(names));

    CONSOLE_LOG.length = 0;
    await q(tabB, "document.querySelectorAll('.cookie-btn-switch')[" + idxExpired + "].click(); true");
    await sleep(2500);

    const jarAfter = {};
    for (const x of await cookieGetAll(tabB, SITE)) jarAfter[x.name] = x.value;
    c.info("cookie SAU khi bam phien het han", JSON.stringify(jarAfter));

    // Toast thuc te cua UI (neu con trong DOM)
    const toast = await q(tabB, "(() => { var e = document.querySelector('.toast, #toast, [class*=toast]'); return e ? e.textContent : ''; })()").catch(() => "");
    c.info("toast gan nhat", String(toast).slice(0, 120));

    // Diem da chot: cookie trong phien het han nen Chrome KHONG giu lai chung,
    // nhung toast van bao cong (successCount dem ca lan set bi that bai am tham)
    if (jarAfter.sess_user === "userA") {
      c.ok("cookie het han van duoc ap dung (Chrome tu mo rong lai)" , "sess_user=" + jarAfter.sess_user);
    } else {
      c.bad("cookie het han KHONG duoc ap dung", "jar van la " + JSON.stringify(jarAfter) + " - toast bao thanh cong nhung cookie bien mat");
    }
  });

  // ---------------------------------------------------------------- S7 ------
  await scenario("S7", "Nhap JSON cookie khi dang o site KHAC -> domain lay tu cookie (da sua)", async (c) => {
    const otherServer = await startOtherServer();
    // Tab o site khac (127.0.0.1 - host khac voi localhost) lam active
    const tabF = await createTabTarget("http://127.0.0.1:" + OTHER_PORT + "/", "other-127");
    await waitFor("tab F load xong", 15000, () => q(tabF, "document.readyState === 'complete' && document.title === 'OtherSite'").catch(() => false));
    try { await BR.cdp.send("Target.activateTarget", { targetId: tabF.targetId }); } catch (e) {}
    await sleep(300);

    // Lay JSON cookie cua phien "Tai khoan B" tu storage (bang chung tuong duong xuat JSON)
    const s0 = await storageLocal(tabB, ["genCookieProfiles"]);
    const arr0 = Array.isArray(s0.genCookieProfiles) ? s0.genCookieProfiles : [];
    const profileB = arr0.find((p) => p.profileName === "Tai khoan B");
    const cookiesList = (profileB && profileB.cookies) || null;
    c.assert("co JSON cookie de nhap (phien 'Tai khoan B')", !!cookiesList, "co " + (cookiesList ? cookiesList.length : 0) + " cookie");
    if (!cookiesList) { await closeTarget(tabF); otherServer.close(); return; }

    // Nhap qua UI khi dang o site khac (127.0.0.1:8125)
    await q(tabB, "(() => { document.getElementById('btn-toggle-import-cookies').click(); return true; })()");
    await sleep(200);
    await q(tabB, "(() => { document.getElementById('textarea-import-cookies-json').value = " + JSON.stringify(JSON.stringify(cookiesList)) + "; return true; })()");
    await sleep(200);
    CONSOLE_LOG.length = 0;
    await q(tabB, "document.getElementById('btn-confirm-import-cookies').click(); true");
    await sleep(1500);

    const s2 = await storageLocal(tabB, ["genCookieProfiles"]);
    const arr2 = Array.isArray(s2.genCookieProfiles) ? s2.genCookieProfiles : [];
    const imported = arr2.find((p) => p.profileName && p.profileName.indexOf("Nhập JSON") >= 0);
    c.assert("tao duoc profile tu JSON", !!imported, "profiles=" + arr2.map((p) => p.profileName).join(","));
    if (!imported) { await closeTarget(tabF); otherServer.close(); return; }
    c.info("profile nhap", JSON.stringify({ domain: imported.domain, url: imported.url }));
    c.assert("domain lay tu cookie (localhost), KHONG lay theo tab dang mo (127.0.0.1)",
      imported.domain === "localhost", "domain=" + imported.domain);
    c.assert("url tro ve dung host cua cookie",
      (imported.url || "").indexOf("localhost") >= 0, "url=" + imported.url);

    // Bam "Chuyen sang phien nay" tren profile vua nhap
    const names2 = JSON.parse(await q(tabB, "JSON.stringify(Array.from(document.querySelectorAll('.cookie-profile-name')).map((e) => e.textContent))") || "[]");
    const idxImp = names2.findIndex((t) => t.indexOf("Nhập JSON") >= 0);
    c.assert("thay nut chuyen phien cua profile nhap", idxImp >= 0, "names=" + JSON.stringify(names2));

    CONSOLE_LOG.length = 0;
    await q(tabB, "document.querySelectorAll('.cookie-btn-switch')[" + idxImp + "].click(); true");
    await sleep(2500);

    // Jar cua trang THAT (localhost:8124) phai nhan cookie cua phien userB
    const realJar = {};
    for (const x of await cookieGetAll(tabB, SITE)) realJar[x.name] = x.value;
    c.info("cookie cua trang localhost:8124 SAU khi bam chuyen phien nhap", JSON.stringify(realJar));
    const errs = CONSOLE_LOG.filter((x) => /Cookie set error/i.test(x.text));
    c.info("console loi tu chrome.cookies.set", errs.map((x) => x.text).join(" || ").slice(0, 400) || "(khong co)");
    c.assert("phien nhap ap dung dung len trang that (sess_user=userB)", realJar.sess_user === "userB", "thuc te=" + realJar.sess_user);

    // Tab 127.0.0.1 (site nhap) KHONG duoc nhan cookie cua phien localhost
    const wrongJar = {};
    for (const x of await cookieGetAll(tabB, "http://127.0.0.1:" + OTHER_PORT + "/")) wrongJar[x.name] = x.value;
    c.info("cookie cua trang 127.0.0.1:8125 SAU khi bam chuyen", JSON.stringify(wrongJar));
    c.assert("site nguoi khong bi nhen cookie", wrongJar.sess_user === undefined, "sess_user=" + wrongJar.sess_user);

    await closeTarget(tabF);
    otherServer.close();
  });

  // Server mo phong SPA kieu Clerk: cookie phien client doc duoc (khong HttpOnly),
// trang cache danh tinh vao localStorage. Cookie doi khong du, trang van hien
// tai khoan cu cho den khi localStorage bi xoa.
function startSpaServer() {
  return new Promise((resolve) => {
    const port = Number(process.env.E2E_SPA_PORT || 8126);
    const server = http.createServer((req, res) => {
      // Chi set neu request KHONG mang cookie spa_sess (khong dung chung headers.cookie
      // vi cac scenario truoc da de lai cookie khac tren host localhost)
      const hasSpa = /(^|;\s*)spa_sess=/.test(req.headers.cookie || "");
      const headers = hasSpa ? [] : [
        "spa_sess=userA; Path=/",
      ];
      const out = { "Content-Type": "text/html; charset=utf-8" };
      if (headers.length) out["Set-Cookie"] = headers;
      res.writeHead(200, out);
      res.end(`<!doctype html><html><head><title>SpaSite</title></head><body>
<script>
  // Mo phong Clerk/Firebase client cache: lan dau doc tu cookie, sau do chi tin localStorage
  var acc = null;
  try { acc = localStorage.getItem('acc'); } catch (e) {}
  if (!acc) {
    var m = (document.cookie || '').match(/spa_sess=([^;]+)/);
    acc = m ? m[1] : '(chua dang nhap)';
    try { localStorage.setItem('acc', acc); } catch (e) {}
  }
  document.write('<h1 id=who>Xin chao: ' + acc + '</h1>');
</script>
</body></html>`);
    });
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

  // ---------------------------------------------------------------- S8 ------
  await scenario("S8", "SPA cache danh tinh trong localStorage: chuyen phien co dung khong?", async (c) => {
    const spaServer = await startSpaServer();
    const SPA = "http://localhost:8126/";
    const tabG = await createTabTarget(SPA, "spa-site");
    await waitFor("tab G load xong", 15000, () => q(tabG, "document.readyState === 'complete' && (document.getElementById('who') || {}).textContent" ).catch(() => false));
    try { await BR.cdp.send("Target.activateTarget", { targetId: tabG.targetId }); } catch (e) {}
    await sleep(300);

    // Lan dau: trang hien "userA" (tu cookie roi cache vao localStorage)
    const who1 = await q(tabG, "(document.getElementById('who') || {}).textContent");
    c.info("trang hien thi ban dau", String(who1));

    // Luu phien "SPA A" qua UI
    await q(tabB, "(() => { document.getElementById('btn-toggle-add-cookie-profile').click(); document.getElementById('input-cookie-profile-name').value = 'SPA A'; document.getElementById('btn-confirm-save-cookie-profile').click(); return true; })()");
    const savedA = await waitFor("luu phien SPA A", 8000, async () => {
      const s = await storageLocal(tabB, ["genCookieProfiles"]);
      const arr = Array.isArray(s.genCookieProfiles) ? s.genCookieProfiles : [];
      return arr.find((p) => p.profileName === "SPA A") || null;
    }).catch(() => null);
    c.assert("luu duoc phien SPA A", !!savedA, savedA ? "cookies=" + (savedA.cookies || []).map((x) => x.name).join(",") : "khong thay");

    // Dang nhap tai khoan B tren trang: doi cookie + ghi localStorage (nhu SPA that)
    await cookieSet(tabB, { url: SPA, name: "spa_sess", value: "userB", path: "/" });
    await q(tabG, "localStorage.setItem('acc', 'userB'); true");
    await BR.cdp.send("Page.reload", {}, tabG.sessionId).catch(() => {});
    await waitFor("tab G reload", 10000, () => q(tabG, "document.readyState === 'complete' && (document.getElementById('who') || {}).textContent.indexOf('userB') >= 0").catch(() => false));
    const who2 = await q(tabG, "(document.getElementById('who') || {}).textContent");
    c.info("sau khi dang nhap userB", String(who2));

    // Bam chuyen ve phien SPA A (userA)
    const namesG = JSON.parse(await q(tabB, "JSON.stringify(Array.from(document.querySelectorAll('.cookie-profile-name')).map((e) => e.textContent))") || "[]");
    const idxA = namesG.findIndex((t) => t.indexOf("SPA A") >= 0);
    c.assert("tim thay nut phien SPA A", idxA >= 0, "names=" + JSON.stringify(namesG));

    CONSOLE_LOG.length = 0;
    await q(tabB, "document.querySelectorAll('.cookie-btn-switch')[" + idxA + "].click(); true");
    await sleep(3000);

    // DEBUG: popup thay tab nao, toast gi, console gi
    const dbgActive = await q(tabB, "new Promise((r) => chrome.tabs.query({ active: true, currentWindow: true }, (t) => r(t && t[0] ? t[0].url : null)))");
    const dbgToast = await q(tabB, "(() => { var e = document.querySelector('.toast, #toast, [class*=toast]'); return e ? e.textContent : ''; })()").catch(() => "");
    const dbgCons = CONSOLE_LOG.slice(-6).map((x) => x.type + ":" + x.text).join(" || ").slice(0, 400);
    const dbgScripting = await q(tabB, "typeof chrome.scripting");
    const dbgTargets = await (await fetch("http://127.0.0.1:" + PORT + "/json/list", { cache: "no-store" })).json();
    const dbgTabs = dbgTargets.filter((t) => t.type === "page" && String(t.url || "").indexOf("localhost") >= 0).map((t) => t.url);
    c.info("DEBUG chrome.scripting", String(dbgScripting));
    c.info("DEBUG active tab luc bam", String(dbgActive));
    c.info("DEBUG toast", String(dbgToast).slice(0, 120));
    c.info("DEBUG console popup", dbgCons || "(trong)");
    c.info("DEBUG cac tab localhost dang mo", dbgTabs.join(" | "));

    const jarSpa = {};
    for (const x of await cookieGetAll(tabB, SPA)) jarSpa[x.name] = x.value;
    const who3 = await q(tabG, "(document.getElementById('who') || {}).textContent");
    const lsAcc = await q(tabG, "localStorage.getItem('acc')");
    c.info("cookie cua trang SPA sau chuyen", JSON.stringify(jarSpa));
    c.info("localStorage.acc sau chuyen", String(lsAcc));
    c.info("trang hien thi sau chuyen", String(who3));

    c.assert("cookie DA duoc ap dung nguoc lai", jarSpa.spa_sess === "userA", "thuc te=" + jarSpa.spa_sess);
    if (String(who3).indexOf("userA") >= 0) {
      c.ok("trang hien tai khoan A sau chuyen phien", "who=" + who3);
    } else {
      c.bad("trang VAN hien tai khoan cu du cookie da doi",
        "cookie sess_user=userA nhung trang van hien '" + String(who3) + "' (localStorage.acc=" + String(lsAcc) + ") - reload khong cu hieu vi SPA cache danh tinh client");
    }

    await closeTarget(tabG);
    spaServer.close();
  });

  // ---------------------------------------------------------------- S9 ------
  await scenario("S9", "SPA cache danh tinh trong IndexedDB: chuyen phien co dung khong?", async (c) => {
    // Clerk/clerk-js phien ban moi giu client cache trong IndexedDB
    // (khong chi localStorage). browsingData wipe phai xoa ca IndexedDB.
    const idbServer = await startIdbSpaServer();
    const IDB = "http://localhost:8127/";
    const tabH = await createTabTarget(IDB, "idb-site");
    await waitFor("tab H load xong", 15000, () => q(tabH, "document.readyState === 'complete' && (document.getElementById('who') || {}).textContent", 20000).catch(() => false));
    try { await BR.cdp.send("Target.activateTarget", { targetId: tabH.targetId }); } catch (e) {}
    await sleep(300);

    const who1 = await q(tabH, "(document.getElementById('who') || {}).textContent");
    c.info("trang hien thi ban dau", String(who1));
    const dbg1 = await q(tabH, "typeof window.__idbReady");
    c.info("IndexedDB san sang", String(dbg1));

    // Luu phien "IDB A" qua UI
    await q(tabB, "(() => { document.getElementById('btn-toggle-add-cookie-profile').click(); document.getElementById('input-cookie-profile-name').value = 'IDB A'; document.getElementById('btn-confirm-save-cookie-profile').click(); return true; })()");
    const savedA = await waitFor("luu phien IDB A", 8000, async () => {
      const s = await storageLocal(tabB, ["genCookieProfiles"]);
      const arr = Array.isArray(s.genCookieProfiles) ? s.genCookieProfiles : [];
      return arr.find((p) => p.profileName === "IDB A") || null;
    }).catch(() => null);
    c.assert("luu duoc phien IDB A", !!savedA, savedA ? "cookies=" + (savedA.cookies || []).map((x) => x.name).join(",") : "khong thay");

    // "Dang nhap" userB: doi cookie + ghi IndexedDB (nhu SPA that)
    await cookieSet(tabB, { url: IDB, name: "idb_sess", value: "userB", path: "/" });
    await q(tabH, "new Promise((r) => { var q2 = indexedDB.open('clerkish', 1); q2.onupgradeneeded = function (e) { e.target.result.createObjectStore('kv'); }; q2.onsuccess = function (e) { var tx = e.target.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put('userB', 'acc'); tx.oncomplete = function () { r(true); }; }; q2.onerror = function () { r(false); }; })", 20000);
    await BR.cdp.send("Page.reload", {}, tabH.sessionId).catch(() => {});
    await waitFor("tab H reload", 12000, () => q(tabH, "document.readyState === 'complete' && (document.getElementById('who') || {}).textContent.indexOf('userB') >= 0").catch(() => false));
    const who2 = await q(tabH, "(document.getElementById('who') || {}).textContent");
    c.info("sau khi dang nhap userB", String(who2));

    // Bam chuyen ve phien IDB A
    const namesH = JSON.parse(await q(tabB, "JSON.stringify(Array.from(document.querySelectorAll('.cookie-profile-name')).map((e) => e.textContent))") || "[]");
    const idxA = namesH.findIndex((t) => t.indexOf("IDB A") >= 0);
    c.assert("tim thay nut phien IDB A", idxA >= 0, "names=" + JSON.stringify(namesH));

    CONSOLE_LOG.length = 0;
    await q(tabB, "document.querySelectorAll('.cookie-btn-switch')[" + idxA + "].click(); true");
    await sleep(3500);

    const jarIdb = {};
    for (const x of await cookieGetAll(tabB, IDB)) jarIdb[x.name] = x.value;
    const who3 = await q(tabH, "(document.getElementById('who') || {}).textContent");
    const dbg3 = await q(tabH, "new Promise((r) => { var q2 = indexedDB.open('clerkish', 1); q2.onsuccess = function (e) { e.target.result.close(); r('DB_CON'); }; q2.onerror = function () { r('DB_GONE'); }; q2.onupgradeneeded = function () { r('DB_REBUILT'); }; })", 20000).catch(() => "?");
    c.info("cookie cua trang IDB sau chuyen", JSON.stringify(jarIdb));
    c.info("trang hien thi sau chuyen", String(who3));
    c.info("IndexedDB sau wipe", String(dbg3));

    c.assert("cookie DA duoc ap dung nguoc lai", jarIdb.idb_sess === "userA", "thuc te=" + jarIdb.idb_sess);
    if (String(who3).indexOf("userA") >= 0) {
      c.ok("trang hien tai khoan A sau chuyen phien (IndexedDB da bi xoa)", "who=" + who3);
    } else {
      c.bad("trang VAN hien tai khoan cu",
        "cookie idb_sess=userA nhung trang van hien '" + String(who3) + "', IndexedDB: " + String(dbg3));
    }

    await closeTarget(tabH);
    idbServer.close();
  });

  // ---------------------------------------------------------------- S10 -----
  await scenario("S10", "Cookie host-only cua host KHAC phai roi vao dung host", async (c) => {
    // Gia lap phien nhap gom cookie localhost (domain) + host-only tren 127.0.0.1
    // (nhu app.cline.bot host-only khi luon tu cac subdomain). Code cu set ca hai
    // vao host cua trang dang mo -> cookie host-only roi sang site sai.
    const otherServer = await startOtherServer();
    // Dat san 1 host-only cookie tren 127.0.0.1:8125
    await cookieSet(tabB, { url: "http://127.0.0.1:" + OTHER_PORT + "/", name: "sub_host_only", value: "v9", path: "/" });
    const jar127 = {};
    for (const x of await cookieGetAll(tabB, "http://127.0.0.1:" + OTHER_PORT + "/")) jar127[x.name] = x.value;
    c.assert("da dat host-only cookie tren 127.0.0.1", jar127.sub_host_only === "v9", JSON.stringify(jar127));

    // Tao profile hon hop qua storage (mo phong profile luu/nhap ca cay domain)
    const s0 = await storageLocal(tabB, ["genCookieProfiles"]);
    const arr0 = Array.isArray(s0.genCookieProfiles) ? s0.genCookieProfiles : [];
    const mixedProfile = {
      id: "mixed-" + Date.now().toString(),
      profileName: "Hon hop",
      domain: "localhost",
      url: SITE,
      cookieCount: 3,
      createdAt: "test",
      cookies: [
        { name: "mix_domain", value: "A", domain: "localhost", path: "/" },
        { name: "sub_host_only", value: "v9", domain: "127.0.0.1", hostOnly: true, path: "/" },
        { name: "mix_host", value: "H", domain: "localhost", hostOnly: true, path: "/" },
      ],
    };
    const newArr = [mixedProfile, ...arr0];
    await q(tabB, "new Promise((r) => chrome.storage.local.set({ genCookieProfiles: " + JSON.stringify(newArr) + " }, () => r(true)))");
    await sleep(400);
    await BR.cdp.send("Page.reload", {}, tabB.sessionId).catch(() => {});
    await waitFor("popup reload", 15000, () => q(tabB, "document.readyState === 'complete' && document.querySelectorAll('.cookie-btn-switch').length > 0", 8000).catch(() => false));

    // Doi gia tri 127.0.0.1 host-only sang v10 de biet fix co set lai khong
    await cookieSet(tabB, { url: "http://127.0.0.1:" + OTHER_PORT + "/", name: "sub_host_only", value: "v10", path: "/" });
    const jar127before = {};
    for (const x of await cookieGetAll(tabB, "http://127.0.0.1:" + OTHER_PORT + "/")) jar127before[x.name] = x.value;
    c.info("127.0.0.1 truoc chuyen", JSON.stringify(jar127before));

    // Bam chuyen phien "Hon hop" khi dang o trang localhost:8126 (spa)
    const spa2 = await createTabTarget("http://localhost:8126/", "spa-for-s10");
    await waitFor("spa2 load", 10000, () => q(spa2, "document.readyState === 'complete'").catch(() => false));
    try { await BR.cdp.send("Target.activateTarget", { targetId: spa2.targetId }); } catch (e) {}
    await sleep(300);

    const namesM = JSON.parse(await q(tabB, "JSON.stringify(Array.from(document.querySelectorAll('.cookie-profile-name')).map((e) => e.textContent))") || "[]");
    const idxM = namesM.findIndex((t) => t.indexOf("Hon hop") >= 0);
    c.assert("tim thay nut phien Hon hop", idxM >= 0, "names=" + JSON.stringify(namesM));
    await q(tabB, "document.querySelectorAll('.cookie-btn-switch')[" + idxM + "].click(); true");
    await sleep(3000);

    const jar127after = {};
    for (const x of await cookieGetAll(tabB, "http://127.0.0.1:" + OTHER_PORT + "/")) jar127after[x.name] = x.value;
    c.info("127.0.0.1 SAU chuyen", JSON.stringify(jar127after));
    c.assert("cookie host-only cua 127.0.0.1 duoc set DUNG host (v9), khong roi sang localhost",
      jar127after.sub_host_only === "v9", "thuc te=" + jar127after.sub_host_only);

    await closeTarget(spa2);
    otherServer.close();
  });

  // Server mo phong SPA phien ban moi (Clerk): danh tinh user luu trong
// IndexedDB, khong phai localStorage. Phai xoa sach IndexedDB khi chuyen phien.
function startIdbSpaServer() {
  return new Promise((resolve) => {
    const port = Number(process.env.E2E_IDB_PORT || 8127);
    const server = http.createServer((req, res) => {
      const hasSpa = /(^|;\s*)idb_sess=/.test(req.headers.cookie || "");
      const headers = hasSpa ? [] : ["idb_sess=userA; Path=/"];
      const out = { "Content-Type": "text/html; charset=utf-8" };
      if (headers.length) out["Set-Cookie"] = headers;
      res.writeHead(200, out);
      res.end(`<!doctype html><html><head><title>IdbSite</title></head><body>
<h1 id="who">dang tai...</h1>
<script>
function readAcc(cb) {
  var q2 = indexedDB.open('clerkish', 1);
  q2.onupgradeneeded = function (e) { e.target.result.createObjectStore('kv'); };
  q2.onsuccess = function (e) {
    var tx = e.target.result.transaction('kv', 'readonly');
    var get = tx.objectStore('kv').get('acc');
    get.onsuccess = function () {
      if (get.result) { cb(get.result); return; }
      var m = (document.cookie || '').match(/idb_sess=([^;]+)/);
      cb(m ? m[1] : '(chua dang nhap)');
    };
    get.onerror = function () { cb('(loi db)'); };
  };
  q2.onerror = function () { cb('(loi db)'); };
}
window.__idbReady = true;
readAcc(function (acc) {
  document.getElementById('who').textContent = 'Xin chao: ' + acc;
});
</script>
</body></html>`);
    });
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

const failed = RESULTS.filter((r) => !r.ok);
  console.log("\n=========================================");
  console.log("TONG KET: %d/%d scenario PASS", RESULTS.length - failed.length, RESULTS.length);
  for (const f of failed) console.log("  FAIL: " + f.id);
  console.log("=========================================");

  await stopBrowser();
  server.close();

  const cookieErrs = CONSOLE_LOG.filter((x) => /Cookie set error/i.test(x.text));
  if (cookieErrs.length) {
    console.log("\n[DEBUG] cac loi chrome.cookies.set thuc te trong phien chay:");
    for (const e of cookieErrs) console.log("   " + e.text.slice(0, 300));
  }

  process.exit(failed.length ? 1 : 0);
}

main().catch(async (e) => {
  console.error("\n[FATAL]", e && e.stack ? e.stack : e);
  await stopBrowser();
  process.exit(2);
});
