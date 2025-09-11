// index.js - Xtream-lite (Node + Express) with expiry + GitHub-backed admin
// Requisitos: Node 18+ (fetch nativo), Express
import express from "express";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import process from "process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

// --- CONFIG: environment-driven ---
const CONFIG = {
  username: process.env.XTREAM_USER || "demo",
  password: process.env.XTREAM_PASS || "demo",
  m3uFile: path.join(__dirname, "canales.m3u"),
  logosFile: path.join(__dirname, "group_logos.json"),
  localAccountsFile: path.join(__dirname, "accounts.json"),
  localLicenseFile: path.join(__dirname, "license.json"),
  adminKey: process.env.ADMIN_KEY || "cambia_esto_admin_key",
  expireDays: Number(process.env.EXPIRE_DAYS || 30),

  // GitHub integration (set these in Render env)
  GH_TOKEN: process.env.GITHUB_TOKEN || "",
  GH_OWNER: process.env.GITHUB_OWNER || "",
  GH_REPO: process.env.GITHUB_REPO || "",
};

// --- helper: parse M3U attributes ---
function parseAttrs(attrString){
  const attrs = {};
  const re = /([a-zA-Z0-9\-_]+)\s*=\s*"([^"]*)"/g;
  let m;
  while((m = re.exec(attrString)) !== null){
    attrs[m[1]] = m[2];
  }
  return attrs;
}

async function readM3U(){
  try{
    const text = await fs.readFile(CONFIG.m3uFile, "utf8");
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
        const attrs = parseAttrs(metaPart);
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
  }catch(e){
    return [];
  }
}

// --- GitHub file helpers (reads/updates content in the repo) ---
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
  // returns { sha, contentText } or null if 404
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
  const resp = await fetch(url, {
    method: "PUT",
    headers: ghHeaders(),
    body: JSON.stringify(body)
  });
  if(!resp.ok){
    const t = await resp.text();
    throw new Error(`GitHub PUT failed: ${resp.status} ${t}`);
  }
  return await resp.json();
}

// --- local file helpers as fallback (if GH not configured) ---
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

// --- license file helpers (prefers local file; GH license.json optional) ---
async function readLicenseFileLocal(){
  return await readLocalJson(CONFIG.localLicenseFile, null);
}

async function writeLicenseFileLocal(obj){
  return await writeLocalJson(CONFIG.localLicenseFile, obj);
}

function addDaysToNow(days){
  const ms = days * 24 * 60 * 60 * 1000;
  return new Date(Date.now() + ms).toISOString();
}

async function ensureLicense(){
  // 1) try local file
  let lic = await readLicenseFileLocal();
  if(lic) return lic;

  // 2) if not, try GH repo license.json
  try{
    const gh = await githubGetFile("license.json");
    if(gh && gh.contentText){
      lic = JSON.parse(gh.contentText);
      // save locally as well
      await writeLicenseFileLocal(lic);
      return lic;
    }
  }catch(e){
    // ignore
  }

  // 3) create new license locally (use EXPIRES_AT env if present)
  const now = new Date().toISOString();
  let expiresAt = null;
  if(process.env.EXPIRES_AT){
    const d = new Date(process.env.EXPIRES_AT);
    if(!isNaN(d.getTime())) expiresAt = d.toISOString();
  }
  if(!expiresAt) expiresAt = addDaysToNow(CONFIG.expireDays);

  lic = { createdAt: now, expiresAt };
  await writeLicenseFileLocal(lic);
  // optionally push to GH if configured
  try{
    if(CONFIG.GH_TOKEN && CONFIG.GH_OWNER && CONFIG.GH_REPO){
      const existing = await githubGetFile("license.json");
      const sha = existing ? existing.sha : null;
      await githubPutFile("license.json", JSON.stringify(lic, null, 2), "Create license.json (xtream-lite)", sha);
    }
  }catch(e){
    console.warn("Could not push license.json to GH:", e.message || e);
  }
  return lic;
}

// --- accounts helpers (store in repo accounts.json or local accounts.json) ---
async function readAccounts(){
  // try GH first
  try{
    const gh = await githubGetFile("accounts.json");
    if(gh && gh.contentText){
      return { accounts: JSON.parse(gh.contentText || "[]"), sha: gh.sha, source: "github" };
    }
  }catch(e){
    // ignore
  }
  // fallback to local
  const local = await readLocalJson(CONFIG.localAccountsFile, []);
  return { accounts: local || [], sha: null, source: "local" };
}

async function saveAccounts(accounts, sha=null){
  // try GH if configured
  if(CONFIG.GH_TOKEN && CONFIG.GH_OWNER && CONFIG.GH_REPO){
    try{
      await githubPutFile("accounts.json", JSON.stringify(accounts, null, 2), `Update accounts.json (xtream-lite-admin)`, sha || undefined);
      return { ok: true, source: "github" };
    }catch(e){
      console.warn("GH save failed, writing local:", e.message || e);
    }
  }
  // fallback local
  await writeLocalJson(CONFIG.localAccountsFile, accounts);
  return { ok: true, source: "local" };
}

// --- auth middleware for player endpoints (checks license + username/password) ---
// --- auth middleware para player endpoints (checks license + username/password or accounts.json) ---
async function authGuard(req, res){
  // 1) validar licencia global
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

  // 2) obtener credenciales de la request (query params)
  const username = req.query.username || "";
  const password = req.query.password || "";

  // 3) check contra credencial global (CONFIG)
  if(username === CONFIG.username && password === CONFIG.password) return true;

  // 4) check contra accounts.json (puede estar en GH o local)
  try{
    const read = await readAccounts(); // readAccounts() ya existe en tu index.js
    const accounts = read.accounts || [];
    // buscar cuenta que coincida user+pass
    const acc = accounts.find(a => (a.username === username && a.password === password));
    if(acc){
      // si la cuenta tiene expiresAt, verificar que no haya vencido
      if(acc.expiresAt){
        const now = new Date();
        const expires = new Date(acc.expiresAt);
        if(now > expires){
          res.status(403).json({ error: "Account expired", expiresAt: acc.expiresAt });
          return false;
        }
      }
      // OK: credenciales válidas
      return true;
    }
  }catch(e){
    console.warn("authGuard: readAccounts failed", e && e.message ? e.message : e);
    // no abortamos aquí: caemos al 401 si no hay match
  }

  // 5) fallback: inválido
  res.status(401).json({ error: "Invalid username/password" });
  return false;
}


// --- adminAuth middleware: Basic Auth (ADMIN_USER/ADMIN_PASS) OR adminKey in body/query ---
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "adminpass";

function adminAuth(req, res, next){
  try{
    const auth = req.headers['authorization'];
    if(auth && auth.startsWith('Basic ')){
      const creds = Buffer.from(auth.split(' ')[1], 'base64').toString();
      const [user, pass] = creds.split(':');
      if(user === ADMIN_USER && pass === ADMIN_PASS){
        req.isAdmin = true;
        return next();
      }
    }
    const key = req.query.admin_key || (req.body && req.body.admin_key);
    if(key && key === CONFIG.adminKey){
      req.isAdmin = true;
      return next();
    }
    res.setHeader('WWW-Authenticate', 'Basic realm="Admin Area"');
    return res.status(401).send('Authentication required');
  }catch(e){
    return res.status(500).send('Auth error');
  }
}

// --- endpoints ---
// serve admin UI (protected)
app.get('/admin', adminAuth, (req,res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// license status (for debug)
app.get('/license_status', adminAuth, async (req, res) => {
  const lic = await ensureLicense();
  res.json(lic);
});

// get.php -> serve M3U content (protected by authGuard)
app.get("/get.php", async (req, res) => {
  if(!(await authGuard(req,res))) return;
  try{
    const content = await fs.readFile(CONFIG.m3uFile, "utf8");
    res.setHeader("Content-Type", "application/x-mpegurl; charset=utf-8");
    res.send(content);
  }catch(e){
    res.status(500).send("Error leyendo M3U: " + (e && e.message));
  }
});

// player_api.php (get_live_categories, get_live_streams)
app.get("/player_api.php", async (req, res) => {
  if(!(await authGuard(req,res))) return;
  const action = req.query.action || "";
  const groupId = req.query.category_id || null;
  try{
    const channels = await readM3U();
    const groups = Array.from(new Set(channels.map(c=>c.group || "Sin grupo")));
    const groupsMeta = groups.map((g,i)=>({ category_id: i+1, category_name: g }));
    const groupIndex = new Map(groupsMeta.map(g => [g.category_name, g.category_id]));

    if(action === "get_live_categories"){
      res.json(groupsMeta);
      return;
    }

    if(action === "get_live_streams"){
      let filtered = channels;
      if(groupId){
        const gid = Number(groupId);
        if(!Number.isNaN(gid)){
          const name = groupsMeta.find(g=>g.category_id===gid)?.category_name;
          filtered = channels.filter(c => c.group === name);
        }else{
          filtered = channels.filter(c => c.group === groupId);
        }
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

      res.json(streams);
      return;
    }

    res.status(400).json({ error: "Unsupported action: " + action });
  }catch(e){
    res.status(500).json({ error: e && e.message });
  }
});

// --- admin endpoints to manage accounts (read from GH or local) ---
// Add account: expects JSON { username, password, days }
app.post('/admin/add_account', adminAuth, async (req, res) => {
  try{
    const { username, password, days } = req.body || {};
    if(!username || !password) return res.status(400).json({ error: "Provide username and password" });

    const read = await readAccounts();
    const accounts = read.accounts || [];
    const sha = read.sha || null;

    // build account
    const expiresAt = new Date(Date.now() + ((Number(days || 30)) * 24*60*60*1000)).toISOString();
    const newAccount = { username, password, createdAt: new Date().toISOString(), expiresAt };
    accounts.push(newAccount);

    await saveAccounts(accounts, sha);
    res.json({ ok: true, account: newAccount });
  }catch(e){
    console.error(e);
    res.status(500).json({ error: e.message || String(e) });
  }
});

// Update account expiry: expects JSON { username, days } or { username, expiresAt }
app.post('/admin/set_account_expiry', adminAuth, async (req, res) => {
  try{
    const { username, days, expiresAt } = req.body || {};
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
    }else{
      return res.status(400).json({ error: "Provide days or expiresAt" });
    }

    await saveAccounts(accounts, sha);
    res.json({ ok: true, account: acc });
  }catch(e){
    console.error(e);
    res.status(500).json({ error: e.message || String(e) });
  }
});

// Optional: list accounts (admin)
app.get('/admin/list_accounts', adminAuth, async (req,res) => {
  try{
    const read = await readAccounts();
    res.json({ source: read.source, accounts: read.accounts || [] });
  }catch(e){
    res.status(500).json({ error: e.message || String(e) });
  }
});

// --- simple CORS preflight / health ---
app.options("/*", (req,res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.sendStatus(200);
});

app.get("/", (req,res) => res.send("Xtream-lite server. Use /player_api.php and /get.php with username/password"));

// --- start server ---
(async () => {
  await ensureLicense(); // will create license.json if missing (and push to GH if configured)
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, ()=> console.log("Xtream-lite listening on port", PORT));
})();
