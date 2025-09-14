// index.js - Xtream-lite (Node + Express)
// Multi-M3U per-account admin, local persistence + optional GitHub sync
// Compatible con IPTV Smarters: player_api.php?action=get_user_info
// Node >=18
import express from "express";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import process from "process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

// ---------------- CONFIG (desde env) ----------------
const CONFIG = {
  XTREAM_USER: process.env.XTREAM_USER || "demo",
  XTREAM_PASS: process.env.XTREAM_PASS || "demo",
  logosFile: path.join(__dirname, "group_logos.json"),
  localAccountsFile: path.join(__dirname, "accounts.json"),
  localLicenseFile: path.join(__dirname, "license.json"),
  ADMIN_KEY: process.env.ADMIN_KEY || "cambia_esto_admin_key",
  EXPIRE_DAYS: Number(process.env.EXPIRE_DAYS || 30),
  // GitHub optional
  GH_TOKEN: process.env.GITHUB_TOKEN || "",
  GH_OWNER: process.env.GITHUB_OWNER || "",
  GH_REPO: process.env.GITHUB_REPO || ""
};

// ---------------- utilities: files & m3u ----------------
async function listM3UFiles(){
  try{
    const files = await fs.readdir(__dirname);
    return files.filter(f => f.toLowerCase().endsWith('.m3u'));
  }catch(e){
    return [];
  }
}
async function readM3UFile(filename){
  const full = path.join(__dirname, filename);
  const text = await fs.readFile(full, "utf8");
  return text.replace(/\r/g,"");
}

// ---------------- GitHub helpers (optional) ----------------
const GH_API_BASE = "https://api.github.com";
function ghHeaders(){
  return {
    "Authorization": `Bearer ${CONFIG.GH_TOKEN}`,
    "User-Agent": "xtream-lite-admin",
    "Accept": "application/vnd.github.v3+json",
    "Content-Type": "application/json"
  };
}
async function githubGetFile(pathInRepo){
  if(!CONFIG.GH_TOKEN || !CONFIG.GH_OWNER || !CONFIG.GH_REPO) return null;
  const url = `${GH_API_BASE}/repos/${CONFIG.GH_OWNER}/${CONFIG.GH_REPO}/contents/${encodeURIComponent(pathInRepo)}`;
  const resp = await fetch(url, { headers: ghHeaders() });
  if(resp.status === 404) return null;
  if(!resp.ok) throw new Error(`GitHub GET failed: ${resp.status} ${await resp.text()}`);
  const json = await resp.json();
  const buff = Buffer.from(json.content || "", json.encoding || "base64");
  return { sha: json.sha, contentText: buff.toString("utf8") };
}
async function githubPutFile(pathInRepo, contentText, message, sha = null){
  if(!CONFIG.GH_TOKEN || !CONFIG.GH_OWNER || !CONFIG.GH_REPO) throw new Error("Missing GH config");
  const url = `${GH_API_BASE}/repos/${CONFIG.GH_OWNER}/${CONFIG.GH_REPO}/contents/${encodeURIComponent(pathInRepo)}`;
  const body = {
    message: message || `Update ${pathInRepo} by xtream-lite-admin`,
    content: Buffer.from(contentText, "utf8").toString("base64"),
    committer: { name: "xtream-lite", email: "noreply@example.com" }
  };
  if(sha) body.sha = sha;
  const resp = await fetch(url, { method: "PUT", headers: ghHeaders(), body: JSON.stringify(body) });
  if(!resp.ok){
    const t = await resp.text();
    throw new Error(`GitHub PUT failed: ${resp.status} ${t}`);
  }
  return await resp.json();
}

// ---------------- local JSON helpers ----------------
async function readLocalJson(filePath, fallback = null){
  try{
    const text = await fs.readFile(filePath, "utf8");
    return JSON.parse(text);
  }catch(e){
    return fallback;
  }
}
async function writeLocalJson(filePath, obj){
  await fs.writeFile(filePath, JSON.stringify(obj, null, 2), "utf8");
}

// ---------------- license helpers ----------------
function addDaysToNow(days){ const ms = days * 24 * 60 * 60 * 1000; return new Date(Date.now() + ms).toISOString(); }
async function readLicenseLocal(){ return await readLocalJson(CONFIG.localLicenseFile, null); }
async function writeLicenseLocal(obj){ return await writeLocalJson(CONFIG.localLicenseFile, obj); }
async function ensureLicense(){
  let lic = await readLicenseLocal();
  if(lic) return lic;
  try{
    const gh = await githubGetFile("license.json");
    if(gh && gh.contentText){
      lic = JSON.parse(gh.contentText);
      await writeLicenseLocal(lic);
      return lic;
    }
  }catch(e){}
  const now = new Date().toISOString();
  let expiresAt = null;
  if(process.env.EXPIRES_AT){
    const d = new Date(process.env.EXPIRES_AT);
    if(!isNaN(d.getTime())) expiresAt = d.toISOString();
  }
  if(!expiresAt) expiresAt = addDaysToNow(CONFIG.EXPIRE_DAYS);
  lic = { createdAt: now, expiresAt };
  await writeLicenseLocal(lic);
  try{
    if(CONFIG.GH_TOKEN && CONFIG.GH_OWNER && CONFIG.GH_REPO){
      const existing = await githubGetFile("license.json");
      const sha = existing ? existing.sha : null;
      await githubPutFile("license.json", JSON.stringify(lic, null, 2), "Create license.json (xtream-lite)", sha);
    }
  }catch(e){ console.warn("Could not push license.json to GH:", e && e.message ? e.message : e); }
  return lic;
}

// ---------------- ACCOUNTS: local-first persistence ----------------
// readAccounts: prioritiza local; si no existe intenta GH; si no, crea vacío local
async function readAccounts(){
  try{
    const local = await readLocalJson(CONFIG.localAccountsFile, null);
    if(Array.isArray(local)) return { accounts: local, sha: null, source: "local" };
  }catch(e){}
  try{
    const gh = await githubGetFile("accounts.json");
    if(gh && gh.contentText){
      const arr = JSON.parse(gh.contentText || "[]");
      await writeLocalJson(CONFIG.localAccountsFile, arr);
      return { accounts: arr, sha: gh.sha, source: "github" };
    }
  }catch(e){
    console.warn("readAccounts: GH read failed", e && e.message ? e.message : e);
  }
  const empty = [];
  await writeLocalJson(CONFIG.localAccountsFile, empty);
  return { accounts: empty, sha: null, source: "created_local" };
}

// saveAccounts: escribe local siempre y opcionalmente push a GH
async function saveAccounts(accounts, sha=null){
  try{
    await writeLocalJson(CONFIG.localAccountsFile, accounts);
  }catch(e){
    console.error("saveAccounts: failed writing local", e && e.message ? e.message : e);
    throw e;
  }
  if(CONFIG.GH_TOKEN && CONFIG.GH_OWNER && CONFIG.GH_REPO){
    try{
      await githubPutFile("accounts.json", JSON.stringify(accounts, null, 2), `Update accounts.json (xtream-lite-admin)`, sha || undefined);
      return { ok: true, source: "github" };
    }catch(e){
      console.warn("saveAccounts: GH push failed, but local saved.", e && e.message ? e.message : e);
      return { ok: true, source: "local" };
    }
  }
  return { ok: true, source: "local" };
}

// ensureLocalAccounts: al arranque, garantizar accounts.json local
async function ensureLocalAccounts(){
  try{
    const local = await readLocalJson(CONFIG.localAccountsFile, null);
    if(Array.isArray(local)){
      console.log("Local accounts.json exists. Using local.");
      return;
    }
  }catch(e){}
  try{
    const gh = await githubGetFile("accounts.json");
    if(gh && gh.contentText){
      const arr = JSON.parse(gh.contentText || "[]");
      await writeLocalJson(CONFIG.localAccountsFile, arr);
      console.log("Pulled accounts.json from GitHub to local storage.");
      return;
    }
  }catch(e){ console.warn("ensureLocalAccounts: GH fetch failed:", e && e.message ? e.message : e); }
  await writeLocalJson(CONFIG.localAccountsFile, []);
  console.log("Created empty local accounts.json");
}

// ---------------- auth for player endpoints ----------------
async function authGuard(req, res){
  const lic = await ensureLicense();
  if(lic && lic.expiresAt){
    const now = new Date();
    const expires = new Date(lic.expiresAt);
    if(now > expires){
      res.status(403).json({ error: "License expired", expiresAt: lic.expiresAt });
      return false;
    }
    res.setHeader("X-License-Expires", lic.expiresAt);
  }

  const username = req.query.username || "";
  const password = req.query.password || "";

  // server global creds allowed
  if(username === CONFIG.XTREAM_USER && password === CONFIG.XTREAM_PASS) return true;

  try{
    const read = await readAccounts();
    const accounts = read.accounts || [];
    const acc = accounts.find(a => a.username === username && a.password === password);
    if(acc){
      if(acc.expiresAt){
        const now = new Date();
        const expires = new Date(acc.expiresAt);
        if(now > expires){
          res.status(403).json({ error: "Account expired", expiresAt: acc.expiresAt });
          return false;
        }
      }
      return true;
    }
  }catch(e){
    console.warn("authGuard: readAccounts failed", e && e.message ? e.message : e);
  }

  res.status(401).json({ error: "Invalid username/password" });
  return false;
}

// ---------------- adminAuth: Basic Auth o admin_key ----------------
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "adminpass";
function adminAuth(req, res, next){
  try{
    const auth = req.headers['authorization'];
    if(auth && auth.startsWith('Basic ')){
      const creds = Buffer.from(auth.split(' ')[1], 'base64').toString();
      const [user, pass] = creds.split(':');
      if(user === ADMIN_USER && pass === ADMIN_PASS){
        req.isAdmin = true; return next();
      }
    }
    const key = req.query.admin_key || (req.body && req.body.admin_key);
    if(key && key === CONFIG.ADMIN_KEY){
      req.isAdmin = true; return next();
    }
    res.setHeader('WWW-Authenticate', 'Basic realm="Admin Area"');
    return res.status(401).send('Authentication required');
  }catch(e){
    return res.status(500).send('Auth error');
  }
}

// ---------------- helper: makeUserInfo ----------------
function makeUserInfoFromAccount(acc){
  const nowS = Math.floor(Date.now()/1000);
  const expS = acc && acc.expiresAt ? Math.floor(new Date(acc.expiresAt).getTime()/1000) : null;
  const createdS = acc && acc.createdAt ? Math.floor(new Date(acc.createdAt).getTime()/1000) : nowS;
  return {
    username: acc.username || "",
    password: acc.password || "",
    message: "Welcome",
    auth: 1,
    status: (expS && nowS > expS) ? "Expired" : "Active",
    exp_date: expS ? String(expS) : "",
    exp_date_ms: acc.expiresAt ? String(new Date(acc.expiresAt).getTime()) : "",
    exp_date_iso: acc.expiresAt ? new Date(acc.expiresAt).toISOString() : "",
    is_trial: acc.is_trial ? String(acc.is_trial) : "0",
    active_cons: "0",
    created_at: String(createdS),
    max_connections: acc.max_connections ? String(acc.max_connections) : "1",
    allowed_output_formats: ["m3u8","ts","rtmp"]
  };
}

// ---------------- ADMIN ROUTES ----------------
// serve admin UI file
app.get('/admin', adminAuth, (req,res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// list available m3u files
app.get('/admin/available_lists', adminAuth, async (req,res) => {
  const list = await listM3UFiles();
  res.json({ lists: list });
});

// list accounts
app.get('/admin/list_accounts', adminAuth, async (req,res) => {
  try{
    const read = await readAccounts();
    res.json({ source: read.source, accounts: read.accounts || [] });
  }catch(e){
    res.status(500).json({ error: e.message || String(e) });
  }
});

// add account
app.post('/admin/add_account', adminAuth, async (req, res) => {
  try{
    const { username, password, days, lists } = req.body || {};
    if(!username || !password) return res.status(400).json({ error: "Provide username and password" });
    const read = await readAccounts();
    const accounts = read.accounts || [];
    const sha = read.sha || null;
    const available = await listM3UFiles();
    const finalLists = Array.isArray(lists) ? lists.filter(l => available.includes(l)) : [];
    const expiresAt = new Date(Date.now() + ((Number(days || 30)) * 24*60*60*1000)).toISOString();
    const newAccount = { username, password, createdAt: new Date().toISOString(), expiresAt, lists: finalLists };
    accounts.push(newAccount);
    await saveAccounts(accounts, sha);
    res.json({ ok: true, account: newAccount });
  }catch(e){
    console.error(e); res.status(500).json({ error: e.message || String(e) });
  }
});

// set account expiry/lists
app.post('/admin/set_account_expiry', adminAuth, async (req, res) => {
  try{
    const { username, days, expiresAt, lists } = req.body || {};
    if(!username) return res.status(400).json({ error: "Provide username" });
    const read = await readAccounts();
    const accounts = read.accounts || [];
    const sha = read.sha || null;
    const acc = accounts.find(a => a.username === username);
    if(!acc) return res.status(404).json({ error: "Account not found" });
    if(typeof days !== "undefined"){
      acc.expiresAt = new Date(Date.now() + (Number(days) * 24*60*60*1000)).toISOString();
    }else if(expiresAt){
      const d = new Date(expiresAt);
      if(isNaN(d.getTime())) return res.status(400).json({ error: "Invalid expiresAt" });
      acc.expiresAt = d.toISOString();
    }
    if(Array.isArray(lists)){
      const available = await listM3UFiles();
      acc.lists = lists.filter(l => available.includes(l));
    }
    await saveAccounts(accounts, sha);
    res.json({ ok: true, account: acc });
  }catch(e){
    console.error(e); res.status(500).json({ error: e.message || String(e) });
  }
});

// delete account (admin)
app.post('/admin/delete_account', adminAuth, async (req, res) => {
  try{
    const { username } = req.body || {};
    if(!username) return res.status(400).json({ error: "Provide username" });
    const read = await readAccounts();
    const accounts = read.accounts || [];
    const sha = read.sha || null;
    const idx = accounts.findIndex(a => a.username === username);
    if(idx === -1) return res.status(404).json({ error: "Account not found" });
    accounts.splice(idx, 1);
    await saveAccounts(accounts, sha);
    res.json({ ok: true, username });
  }catch(e){
    console.error("delete_account error:", e && e.message ? e.message : e);
    res.status(500).json({ error: e && e.message });
  }
});

// license status
app.get('/license_status', adminAuth, async (req, res) => {
  const lic = await ensureLicense();
  res.json(lic);
});

// ---------------- get.php -> combined M3U per-account ----------------
app.get("/get.php", async (req, res) => {
  if(!(await authGuard(req,res))) return;
  const username = req.query.username || "";
  try{
    let listsToSend = [];
    if(username === CONFIG.XTREAM_USER){
      listsToSend = await listM3UFiles();
    }else{
      const read = await readAccounts();
      const accounts = read.accounts || [];
      const acc = accounts.find(a => a.username === username && a.password === req.query.password);
      if(acc && Array.isArray(acc.lists) && acc.lists.length) listsToSend = acc.lists;
      else listsToSend = [];
    }
    if(listsToSend.length === 0){
      return res.status(403).json({ error: "No lists assigned to this account" });
    }
    let combined = "#EXTM3U\n";
    for(const lf of listsToSend){
      try{
        const raw = await readM3UFile(lf);
        const lines = raw.split("\n").map(l => l.trim());
        for(const ln of lines){
          if(!ln) continue;
          if(ln.startsWith("#EXTM3U")) continue;
          combined += ln + "\n";
        }
      }catch(e){
        console.warn("Skipping missing m3u:", lf);
      }
    }
    res.setHeader("Content-Type", "application/x-mpegurl; charset=utf-8");
    res.send(combined);
  }catch(e){
    res.status(500).send("Error creando M3U: " + (e && e.message));
  }
});

// ---------------- player_api.php (get_user_info + streams) ----------------
app.get("/player_api.php", async (req, res) => {
  const action = req.query.action || "";
  // get_user_info
  if(action === "get_user_info" || action === "get_simple_data_array"){
    const reqUser = req.query.username || "";
    const reqPass = req.query.password || "";
    try{
      if(reqUser === CONFIG.XTREAM_USER && reqPass === CONFIG.XTREAM_PASS){
        const lic = await ensureLicense();
        const li = {
          username: CONFIG.XTREAM_USER,
          password: CONFIG.XTREAM_PASS,
          message: "Server account",
          auth: 1,
          status: "Active",
          exp_date: lic && lic.expiresAt ? String(Math.floor(new Date(lic.expiresAt).getTime()/1000)) : "",
          exp_date_ms: lic && lic.expiresAt ? String(new Date(lic.expiresAt).getTime()) : "",
          exp_date_iso: lic && lic.expiresAt ? new Date(lic.expiresAt).toISOString() : "",
          is_trial: "0",
          active_cons: "0",
          created_at: lic && lic.createdAt ? String(Math.floor(new Date(lic.createdAt).getTime()/1000)) : String(Math.floor(Date.now()/1000)),
          max_connections: "999",
          allowed_output_formats: ["m3u8","ts","rtmp"]
        };
        const serverInfo = { url: req.protocol + '://' + req.get('host'), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '' };
        res.json({ user_info: li, server_info: serverInfo });
        return;
      }
      const read = await readAccounts();
      const accounts = read.accounts || [];
      const acc = accounts.find(a => a.username === reqUser && a.password === reqPass);
      if(!acc){
        res.status(401).json({ user_info: { auth: 0, message: "Invalid username/password" }});
        return;
      }
      if(acc.expiresAt && new Date(acc.expiresAt).getTime() < Date.now()){
        res.status(403).json({ user_info: { auth: 0, message: "Account expired", exp_date: String(Math.floor(new Date(acc.expiresAt).getTime()/1000)) }});
        return;
      }
      const userInfo = makeUserInfoFromAccount(acc);
      const serverInfo = { url: req.protocol + '://' + req.get('host'), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '' };
      res.json({ user_info: userInfo, server_info: serverInfo });
      return;
    }catch(err){
      console.error("get_user_info error:", err && err.message ? err.message : err);
      res.status(500).json({ error: "internal" });
      return;
    }
  }

  // fallback: get_live_categories / get_live_streams using canales.m3u or first m3u
  try{
    if(!(await authGuard(req,res))) return;
    const available = await listM3UFiles();
    const base = available.includes("canales.m3u") ? "canales.m3u" : (available[0] || null);
    const channels = base ? (await (async () => {
      const text = await readM3UFile(base);
      const lines = text.replace(/\r/g,"").split("\n").map(l=>l.trim());
      const items = [];
      for(let i=0;i<lines.length;i++){
        const line = lines[i];
        if(!line) continue;
        if(line.startsWith("#EXTINF")){
          const after = line.substring(8).trim();
          const idx = after.indexOf(",");
          let metaPart = after, title = "";
          if(idx >= 0){ metaPart = after.substring(0, idx); title = after.substring(idx+1).trim(); }
          const attrs = {};
          const re = /([a-zA-Z0-9\-_]+)\s*=\s*"([^"]*)"/g;
          let m;
          while((m = re.exec(metaPart)) !== null){ attrs[m[1]] = m[2]; }
          let url = "";
          for(let j=i+1;j<lines.length;j++){
            if(lines[j] && !lines[j].startsWith("#")){ url = lines[j]; i = j; break; }
          }
          items.push({
            title: title || attrs["tvg-name"] || attrs["name"] || "Sin nombre",
            tvgId: attrs["tvg-id"] || "",
            logo: attrs["tvg-logo"] || attrs["tvg_logo"] || "",
            group: attrs["group-title"] || attrs["group"] || "Sin grupo",
            url: url
          });
        }
      }
      return items;
    })()) : [];

    const groups = Array.from(new Set(channels.map(c=>c.group || "Sin grupo")));
    const groupsMeta = groups.map((g,i)=>({ category_id: i+1, category_name: g }));
    const groupIndex = new Map(groupsMeta.map(g => [g.category_name, g.category_id]));

    if(req.query.action === "get_live_categories"){ res.json(groupsMeta); return; }
    if(req.query.action === "get_live_streams"){
      let filtered = channels;
      const groupId = req.query.category_id || null;
      if(groupId){
        const gid = Number(groupId);
        if(!Number.isNaN(gid)){
          const name = groupsMeta.find(g=>g.category_id===gid)?.category_name;
          filtered = channels.filter(c => c.group === name);
        }else filtered = channels.filter(c => c.group === groupId);
      }
      const streams = filtered.map((c, idx) => {
        const catId = groupIndex.get(c.group) || 0;
        return {
          stream_id: 100000 + idx + 1,
          name: c.title,
          stream_icon: c.logo || "",
          category_id: catId,
          stream_type: "live",
          direct_source: c.url,
          num: idx + 1
        };
      });
      res.json(streams); return;
    }

    res.status(400).json({ error: "Unsupported action: " + action });
  }catch(e){
    res.status(500).json({ error: e && e.message });
  }
});

// ---------------- api.php compatibility ----------------
app.get("/api.php", async (req, res) => {
  const action = req.query.action || "";
  const sub = req.query.sub || "";
  if(action === "user" && sub === "info"){
    req.query.action = "get_user_info";
    return app._router.handle(req, res);
  }
  res.status(400).json({ error: "Unsupported api.php action" });
});

// ---------------- CORS preflight ----------------
app.options("/*", (req,res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.sendStatus(200);
});

// root -> admin
app.get("/", (req,res) => res.redirect("/admin"));

// ---------------- START ----------------
(async () => {
  await ensureLicense();
  await ensureLocalAccounts();
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, ()=> console.log("Xtream-lite listening on port", PORT));
})();
