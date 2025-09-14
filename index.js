// index.js - Xtream-lite (Node + Express)
// Extended: me endpoint, logout, filter accounts per reseller
import express from "express";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import process from "process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

// CONFIG (same as before)
const CONFIG = {
  XTREAM_USER: process.env.XTREAM_USER || "demo",
  XTREAM_PASS: process.env.XTREAM_PASS || "demo",
  logosFile: path.join(__dirname, "group_logos.json"),
  localAccountsFile: path.join(__dirname, "accounts.json"),
  localLicenseFile: path.join(__dirname, "license.json"),
  localAdminsFile: path.join(__dirname, "admins.json"),
  localSettingsFile: path.join(__dirname, "settings.json"),
  ADMIN_KEY: process.env.ADMIN_KEY || "cambia_esto_admin_key",
  EXPIRE_DAYS: Number(process.env.EXPIRE_DAYS || 30),
  ADMIN_USER: process.env.ADMIN_USER || "admin",
  ADMIN_PASS: process.env.ADMIN_PASS || "adminpass",
  GH_TOKEN: process.env.GITHUB_TOKEN || "",
  GH_OWNER: process.env.GITHUB_OWNER || "",
  GH_REPO: process.env.GITHUB_REPO || ""
};

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

async function ensureFile(pathFile, defaultValue){
  try{
    const cur = await readLocalJson(pathFile, null);
    if(cur !== null) return;
  }catch(e){}
  await writeLocalJson(pathFile, defaultValue);
}

async function ensureBasics(){
  await ensureFile(CONFIG.localSettingsFile, { globalAccountLimit: 1000, allowAdminSignup: false });
  await ensureFile(CONFIG.localAdminsFile, []);
  await ensureFile(CONFIG.localAccountsFile, []);
  await ensureFile(CONFIG.localLicenseFile, null);
}

function addDaysToNow(days){ const ms = days * 24 * 60 * 60 * 1000; return new Date(Date.now() + ms).toISOString(); }
async function readLicenseLocal(){ return await readLocalJson(CONFIG.localLicenseFile, null); }
async function writeLicenseLocal(obj){ return await writeLocalJson(CONFIG.localLicenseFile, obj); }
async function ensureLicense(){
  let lic = await readLicenseLocal();
  if(lic) return lic;
  const now = new Date().toISOString();
  const expiresAt = addDaysToNow(CONFIG.EXPIRE_DAYS);
  lic = { createdAt: now, expiresAt };
  await writeLicenseLocal(lic);
  return lic;
}

async function readAccounts(){
  const local = await readLocalJson(CONFIG.localAccountsFile, null);
  if(Array.isArray(local)) return { accounts: local, sha: null, source: "local" };
  await writeLocalJson(CONFIG.localAccountsFile, []);
  return { accounts: [], sha: null, source: "created_local" };
}
async function saveAccounts(accounts){
  await writeLocalJson(CONFIG.localAccountsFile, accounts);
  return { ok: true };
}

async function readAdmins(){
  const list = await readLocalJson(CONFIG.localAdminsFile, null);
  if(Array.isArray(list)) return list;
  await writeLocalJson(CONFIG.localAdminsFile, []);
  return [];
}
async function saveAdmins(list){
  await writeLocalJson(CONFIG.localAdminsFile, list);
  return { ok: true };
}

async function readSettings(){
  const s = await readLocalJson(CONFIG.localSettingsFile, null);
  if(s && typeof s === 'object') return s;
  const def = { globalAccountLimit: 1000, allowAdminSignup: false };
  await writeLocalJson(CONFIG.localSettingsFile, def);
  return def;
}
async function saveSettings(obj){
  await writeLocalJson(CONFIG.localSettingsFile, obj);
  return { ok: true };
}

function nowISO(){ return new Date().toISOString(); }

// adminAuth (Basic against admins.json OR master env)
async function adminAuth(req, res, next){
  try{
    const auth = req.headers['authorization'];
    if(auth && auth.startsWith('Basic ')){
      const creds = Buffer.from(auth.split(' ')[1], 'base64').toString();
      const [user, pass] = creds.split(':');
      if(user === CONFIG.ADMIN_USER && pass === CONFIG.ADMIN_PASS){
        req.isAdmin = true; req.isMaster = true; req.adminUser = user; return next();
      }
      const admins = await readAdmins();
      const adm = admins.find(a => a.username === user && a.password === pass);
      if(adm){
        req.isAdmin = true; req.isMaster = false; req.adminUser = adm.username; req.adminCredits = adm.credits || 0; return next();
      }
    }
    const key = req.query.admin_key || (req.body && req.body.admin_key);
    if(key && key === CONFIG.ADMIN_KEY){
      req.isAdmin = true; req.isMaster = true; req.adminUser = CONFIG.ADMIN_USER; return next();
    }
    res.setHeader('WWW-Authenticate', 'Basic realm=\"Admin Area\"');
    return res.status(401).send('Authentication required');
  }catch(e){
    console.error('adminAuth error', e && e.message ? e.message : e);
    return res.status(500).send('Auth error');
  }
}

// authGuard for players
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
  }catch(e){ console.warn("authGuard error", e && e.message ? e.message : e); }
  res.status(401).json({ error: "Invalid username/password" });
  return false;
}

async function totalAccountCount(){
  const read = await readAccounts();
  return (read.accounts || []).length;
}

// ADMIN ROUTES
app.get('/admin', adminAuth, (req,res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// admin/me endpoint
app.get('/admin/me', adminAuth, async (req,res) => {
  try{
    const admins = await readAdmins();
    const me = { username: req.adminUser || CONFIG.ADMIN_USER, isMaster: !!req.isMaster, credits: null };
    if(!req.isMaster){
      const a = admins.find(x => x.username === me.username);
      if(a) me.credits = a.credits || 0;
    }else{
      me.credits = null;
    }
    res.json({ me });
  }catch(e){ res.status(500).json({ error: e.message || String(e) }); }
});

app.get('/admin/available_lists', adminAuth, async (req,res) => {
  try{
    const files = await fs.readdir(__dirname);
    const list = files.filter(f => f.toLowerCase().endsWith('.m3u'));
    res.json({ lists: list });
  }catch(e){
    res.json({ lists: [] });
  }
});

// list accounts - if not master, filter by createdBy
app.get('/admin/list_accounts', adminAuth, async (req,res) => {
  try{
    const read = await readAccounts();
    let accounts = read.accounts || [];
    if(!req.isMaster){
      accounts = accounts.filter(a => a.createdBy === req.adminUser);
    }
    res.json({ source: read.source, accounts });
  }catch(e){
    res.status(500).json({ error: e.message || String(e) });
  }
});

// list admins (master or self)
app.get('/admin/list_admins', adminAuth, async (req,res) => {
  try{
    const admins = await readAdmins();
    if(req.isMaster) return res.json({ admins });
    // reseller can only see own record
    const me = admins.find(a => a.username === req.adminUser);
    return res.json({ admins: me ? [me] : [] });
  }catch(e){
    res.status(500).json({ error: e.message || String(e) });
  }
});

app.post('/admin/add_admin', adminAuth, async (req,res) => {
  try{
    if(!req.isMaster) return res.status(403).json({ error: "Only master can create admins" });
    const { username, password, credits } = req.body || {};
    if(!username || !password) return res.status(400).json({ error: "Provide username and password" });
    const admins = await readAdmins();
    if(admins.find(a => a.username === username)) return res.status(400).json({ error: "Admin exists" });
    const adm = { username, password, createdAt: nowISO(), credits: Number(credits||0) };
    admins.push(adm);
    await saveAdmins(admins);
    res.json({ ok: true, admin: adm });
  }catch(e){
    res.status(500).json({ error: e.message || String(e) });
  }
});

app.post('/admin/set_admin_credits', adminAuth, async (req,res) => {
  try{
    if(!req.isMaster) return res.status(403).json({ error: "Only master can set credits" });
    const { username, credits } = req.body || {};
    if(!username) return res.status(400).json({ error: "Provide username" });
    const admins = await readAdmins();
    const adm = admins.find(a => a.username === username);
    if(!adm) return res.status(404).json({ error: "Admin not found" });
    adm.credits = Number(credits || 0);
    await saveAdmins(admins);
    res.json({ ok: true, admin: adm });
  }catch(e){
    res.status(500).json({ error: e.message || String(e) });
  }
});

app.post('/admin/delete_admin', adminAuth, async (req,res) => {
  try{
    if(!req.isMaster) return res.status(403).json({ error: "Only master can delete admins" });
    const { username } = req.body || {};
    if(!username) return res.status(400).json({ error: "Provide username" });
    let admins = await readAdmins();
    const i = admins.findIndex(a => a.username === username);
    if(i === -1) return res.status(404).json({ error: "Admin not found" });
    admins.splice(i,1);
    await saveAdmins(admins);
    res.json({ ok: true, username });
  }catch(e){
    res.status(500).json({ error: e.message || String(e) });
  }
});

app.get('/admin/settings', adminAuth, async (req,res) => {
  try{
    const s = await readSettings();
    res.json({ settings: s });
  }catch(e){
    res.status(500).json({ error: e.message || String(e) });
  }
});

app.post('/admin/settings', adminAuth, async (req,res) => {
  try{
    if(!req.isMaster) return res.status(403).json({ error: "Only master can change settings" });
    const payload = req.body || {};
    const s = await readSettings();
    if(typeof payload.globalAccountLimit !== 'undefined') s.globalAccountLimit = Number(payload.globalAccountLimit);
    if(typeof payload.allowAdminSignup !== 'undefined') s.allowAdminSignup = !!payload.allowAdminSignup;
    await saveSettings(s);
    res.json({ ok: true, settings: s });
  }catch(e){
    res.status(500).json({ error: e.message || String(e) });
  }
});

app.post('/admin/add_account', adminAuth, async (req, res) => {
  try{
    const { username, password, days, lists } = req.body || {};
    if(!username || !password) return res.status(400).json({ error: "Provide username and password" });

    const settings = await readSettings();
    const admins = await readAdmins();

    const count = await totalAccountCount();
    if(typeof settings.globalAccountLimit === 'number' && count >= settings.globalAccountLimit){
      return res.status(403).json({ error: "Global account limit reached" });
    }

    const creator = req.adminUser || CONFIG.ADMIN_USER;
    let isMaster = !!req.isMaster;
    if(!isMaster){
      const creatorAdmin = admins.find(a => a.username === creator);
      if(!creatorAdmin) return res.status(403).json({ error: "Creator admin record not found" });
      if((creatorAdmin.credits || 0) <= 0) return res.status(403).json({ error: "Creator has no credits left" });
    }

    const read = await readAccounts();
    const accounts = read.accounts || [];
    if(accounts.find(a=>a.username === username)) return res.status(400).json({ error: "Account already exists" });

    const files = await fs.readdir(__dirname);
    const available = files.filter(f => f.toLowerCase().endsWith('.m3u'));
    const finalLists = Array.isArray(lists) ? lists.filter(l => available.includes(l)) : [];

    const expiresAt = new Date(Date.now() + ((Number(days || 30)) * 24*60*60*1000)).toISOString();
    const newAccount = { username, password, createdAt: nowISO(), expiresAt, lists: finalLists, createdBy: creator };
    accounts.push(newAccount);

    await saveAccounts(accounts);

    if(!isMaster){
      const admins2 = await readAdmins();
      const creatorAdmin = admins2.find(a => a.username === creator);
      if(creatorAdmin){
        creatorAdmin.credits = Math.max(0, (creatorAdmin.credits||0) - 1);
        await saveAdmins(admins2);
      }
    }

    res.json({ ok: true, account: newAccount });
  }catch(e){
    console.error("add_account error", e && e.message ? e.message : e);
    res.status(500).json({ error: e.message || String(e) });
  }
});

app.post('/admin/set_account_expiry', adminAuth, async (req, res) => {
  try{
    const { username, days, expiresAt, lists } = req.body || {};
    if(!username) return res.status(400).json({ error: "Provide username" });
    const read = await readAccounts();
    const accounts = read.accounts || [];
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
      const files = await fs.readdir(__dirname);
      const available = files.filter(f => f.toLowerCase().endsWith('.m3u'));
      acc.lists = lists.filter(l => available.includes(l));
    }
    await saveAccounts(accounts);
    res.json({ ok: true, account: acc });
  }catch(e){
    console.error(e); res.status(500).json({ error: e.message || String(e) });
  }
});

app.post('/admin/delete_account', adminAuth, async (req, res) => {
  try{
    const { username } = req.body || {};
    if(!username) return res.status(400).json({ error: "Provide username" });
    const read = await readAccounts();
    const accounts = read.accounts || [];
    const idx = accounts.findIndex(a => a.username === username);
    if(idx === -1) return res.status(404).json({ error: "Account not found" });
    const removed = accounts.splice(idx,1)[0];
    await saveAccounts(accounts);
    res.json({ ok: true, username: removed.username });
  }catch(e){
    console.error("delete_account error:", e && e.message ? e.message : e);
    res.status(500).json({ error: e && e.message });
  }
});

// license status endpoint (for admin panel)
app.get('/license_status', adminAuth, async (req,res) => {
  try{
    const lic = await ensureLicense();
    res.json(lic);
  }catch(e){
    res.status(500).json({ error: e.message || String(e) });
  }
});

// logout route -> force browser to forget Basic Auth (sends 401)
app.get('/admin/logout', (req,res) => {
  res.setHeader('WWW-Authenticate', 'Basic realm=\"Admin Area\"');
  res.status(401).send('Logged out');
});

// get.php -> combined M3U per-account (unchanged)
// (note: reuse existing authGuard)
app.get("/get.php", async (req, res) => {
  if(!(await authGuard(req,res))) return;
  const username = req.query.username || "";
  try{
    let listsToSend = [];
    if(username === CONFIG.XTREAM_USER){
      const files = await fs.readdir(__dirname);
      listsToSend = files.filter(f => f.toLowerCase().endsWith('.m3u'));
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
        const raw = await fs.readFile(path.join(__dirname, lf), "utf8");
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

// player_api.php (get_user_info)
app.get("/player_api.php", async (req, res) => {
  const action = req.query.action || "";
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
      const nowS = Math.floor(Date.now()/1000);
      const expS = acc && acc.expiresAt ? Math.floor(new Date(acc.expiresAt).getTime()/1000) : null;
      const userInfo = {
        username: acc.username,
        password: acc.password,
        message: "Welcome",
        auth: 1,
        status: (expS && nowS > expS) ? "Expired" : "Active",
        exp_date: expS ? String(expS) : "",
        exp_date_ms: acc.expiresAt ? String(new Date(acc.expiresAt).getTime()) : "",
        exp_date_iso: acc.expiresAt ? new Date(acc.expiresAt).toISOString() : "",
        is_trial: acc.is_trial ? String(acc.is_trial) : "0",
        active_cons: "0",
        created_at: String(nowS),
        max_connections: acc.max_connections ? String(acc.max_connections) : "1",
        allowed_output_formats: ["m3u8","ts","rtmp"]
      };
      const serverInfo = { url: req.protocol + '://' + req.get('host'), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '' };
      res.json({ user_info: userInfo, server_info: serverInfo });
      return;
    }catch(err){
      console.error("get_user_info error:", err && err.message ? err.message : err);
      res.status(500).json({ error: "internal" });
      return;
    }
  }

  res.status(400).json({ error: "Unsupported action" });
});

// api.php compatibility
app.get("/api.php", async (req, res) => {
  const action = req.query.action || "";
  const sub = req.query.sub || "";
  if(action === "user" && sub === "info"){
    req.query.action = "get_user_info";
    return app._router.handle(req, res);
  }
  res.status(400).json({ error: "Unsupported api.php action" });
});

// CORS preflight
app.options("/*", (req,res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.sendStatus(200);
});

// root
app.get("/", (req,res) => res.redirect("/admin"));

// START
(async () => {
  await ensureBasics();
  await ensureLicense();
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, ()=> console.log("Xtream-lite listening on port", PORT));
})();
