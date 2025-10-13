// index.js - Xtream-lite full server (updated: require admin auth for account operations, lists per-reseller)
import express from "express";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import fsSync from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CONFIG
const CONFIG = {
  xtreamUser: process.env.XTREAM_USER || "demo",
  xtreamPass: process.env.XTREAM_PASS || "demo",
  port: process.env.PORT || 3000,
  accountsFile: path.join(__dirname, "accounts.json"),
  adminsFile: path.join(__dirname, "admins.json"),
  settingsFile: path.join(__dirname, "settings.json"),
  m3uFolder: __dirname,
  adminCandidates: [ path.join(__dirname, "admin.html"), path.join(__dirname, "admin_v14.html"), path.join(__dirname, "admin_v13.html"), path.join(__dirname, "admin_v12.html") ]
};

let ADMIN_FILE = null;
for(const p of CONFIG.adminCandidates){
  try{ if(fsSync.existsSync(p)){ ADMIN_FILE = p; break; } }catch(e){}
}

// utils
async function safeReadJSON(filePath, defaultValue){
  try{ const raw = await fs.readFile(filePath, "utf8"); return JSON.parse(raw); }catch(e){ return defaultValue; }
}
async function safeWriteJSON(filePath, data){ await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8"); }

async function ensureAdmins(){
  const admins = await safeReadJSON(CONFIG.adminsFile, null);
  if(!admins){
    const defaultAdmin = [{ username: process.env.ADMIN_USER || "admin", password: process.env.ADMIN_PASS || "admin", isMaster: true, credits: 100, createdAt: new Date().toISOString() }];
    await safeWriteJSON(CONFIG.adminsFile, defaultAdmin);
    return defaultAdmin;
  }
  return admins;
}

async function readAccounts(){ return await safeReadJSON(CONFIG.accountsFile, []); }
async function writeAccounts(arr){ await safeWriteJSON(CONFIG.accountsFile, arr); }

async function readAdmins(){ return await safeReadJSON(CONFIG.adminsFile, []); }
async function writeAdmins(arr){ await safeWriteJSON(CONFIG.adminsFile, arr); }

async function readSettings(){ return await safeReadJSON(CONFIG.settingsFile, { globalAccountLimit: 1000, allowAdminSignup: false }); }
async function writeSettings(s){ await safeWriteJSON(CONFIG.settingsFile, s); }

async function readAvailableM3Us(){
  const files = await fs.readdir(CONFIG.m3uFolder);
  const m3uFiles = files.filter(f => f.toLowerCase().endsWith(".m3u"));
  const map = new Map();
  for(const f of m3uFiles){
    try{
      const full = path.join(CONFIG.m3uFolder, f);
      const txt = await fs.readFile(full, "utf8");
      const key = path.basename(f, path.extname(f));
      map.set(key, { filename: f, path: full, content: txt });
    }catch(e){}
  }
  return map;
}

async function buildM3UForAccount(account){
  const map = await readAvailableM3Us();
  let listsToUse = [];
  if(Array.isArray(account.lists) && account.lists.length > 0){
    const lower = account.lists.map(s=>s.toString().trim().toLowerCase());
    for(const [name, info] of map){
      if(lower.includes(name.toLowerCase()) || lower.includes(info.filename.toLowerCase())) listsToUse.push(info);
    }
    // If none matched, fallback to all
    if(listsToUse.length === 0 && map.size > 0) listsToUse = Array.from(map.values());
  }else{
    listsToUse = Array.from(map.values());
  }

  let out = "#EXTM3U\n";
  for(const info of listsToUse){
    if(!info || !info.content) continue;
    let txt = info.content.replace(/^\uFEFF/, "");
    txt = txt.split("\n").filter(line => line.trim() !== "#EXTM3U").join("\n").trim();
    if(txt) out += "\n" + txt + "\n";
  }
  return out;
}

async function findAccount(username, password){
  const accounts = await readAccounts();
  return accounts.find(a => a.username === username && a.password === password) || null;
}

// Legacy auth check (matches XTREAM credentials only)
function isLegacyCredentials(username, password){
  return username === CONFIG.xtreamUser && password === CONFIG.xtreamPass;
}

// Authenticate admin from request (query or Basic auth)
async function authenticateAdminFromReq(req){
  let username = req.query.username || req.query.admin_user || null;
  let password = req.query.password || req.query.admin_pass || null;
  if(!username){
    const auth = req.headers.authorization || "";
    if(auth.startsWith("Basic ")){
      const decoded = Buffer.from(auth.slice(6), "base64").toString("utf8");
      const [u,p] = decoded.split(":",2);
      username = u; password = p;
    }
  }
  if(!username) return null;
  const admins = await readAdmins();
  const adm = admins.find(a=>a.username === username && a.password === password);
  return adm || null;
}

// ensure admins exist
await ensureAdmins();

// Serve admin HTML at /admin
app.get("/admin", async (req, res) => {
  try{
    if(ADMIN_FILE){
      const html = await fs.readFile(ADMIN_FILE, "utf8");
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(html);
      return;
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(`<html><body style="font-family:system-ui,Arial;padding:30px;background:#071226;color:#e6eef8"><h2>Admin panel not found</h2><p>Coloca admin.html o admin_v14.html en la misma carpeta que index.js</p></body></html>`);
  }catch(e){ res.status(500).send("Error leyendo admin file: " + e.message); }
});

app.use("/public", express.static(path.join(__dirname, "public")));

// Public endpoints
app.get("/admin/available_lists", async (req,res)=>{
  try{ const map = await readAvailableM3Us(); res.json({ lists: Array.from(map.keys()) }); }catch(e){ res.status(500).json({ error: e.message }); }
});
app.get("/admin/list_accounts", async (req,res)=>{ try{ const accounts = await readAccounts(); res.json({ accounts }); }catch(e){ res.status(500).json({ error: e.message }); } });

// Protected admin actions: require admin auth (master or reseller allowed)
app.post("/admin/add_account", async (req,res)=>{
  try{
    const requester = await authenticateAdminFromReq(req);
    if(!requester) return res.status(401).json({ error: "Unauthorized (admin required)" });

    const { username, password, days, expiresAt, lists, planLabel } = req.body;
    if(!username || !password) return res.status(400).json({ error: "username/password required" });
    const accounts = await readAccounts();
    if(accounts.find(a=>a.username===username)) return res.status(400).json({ error: "username exists" });
    const createdAt = new Date().toISOString();
    let finalExpires = null;
    if(expiresAt) finalExpires = new Date(expiresAt).toISOString();
    else if(days) finalExpires = new Date(Date.now() + Number(days)*24*60*60*1000).toISOString();
    let listsToAssign = Array.isArray(lists) ? lists : [];
    if(listsToAssign.length === 0){
      const map = await readAvailableM3Us();
      listsToAssign = Array.from(map.keys());
    }
    const newAcc = { username, password, createdAt, expiresAt: finalExpires, lists: listsToAssign, planLabel: planLabel || null, createdBy: requester.username };
    accounts.push(newAcc);
    await writeAccounts(accounts);
    res.json({ ok: true, account: newAcc });
  }catch(e){ res.status(500).json({ error: e.message }); }
});

app.post("/admin/delete_account", async (req,res)=>{
  try{
    const requester = await authenticateAdminFromReq(req);
    if(!requester) return res.status(401).json({ error: "Unauthorized (admin required)" });
    const { username } = req.body; if(!username) return res.status(400).json({ error: "username required" });
    let accounts = await readAccounts(); const before = accounts.length; accounts = accounts.filter(a=>a.username !== username); await writeAccounts(accounts); res.json({ ok: true, deleted: before - accounts.length });
  }catch(e){ res.status(500).json({ error: e.message }); }
});

app.post("/admin/set_account_expiry", async (req,res)=>{
  try{
    const requester = await authenticateAdminFromReq(req);
    if(!requester) return res.status(401).json({ error: "Unauthorized (admin required)" });
    const { username, days, hours, expiresAt } = req.body;
    if(!username) return res.status(400).json({ error: "username required" });
    const accounts = await readAccounts();
    const acc = accounts.find(a=>a.username===username);
    if(!acc) return res.status(404).json({ error: "account not found" });
    let current = acc.expiresAt ? new Date(acc.expiresAt) : new Date();
    if(expiresAt){ acc.expiresAt = new Date(expiresAt).toISOString(); }
    else if(days){ current = new Date(current.getTime() + Number(days)*24*60*60*1000); acc.expiresAt = current.toISOString(); }
    else if(hours){ current = new Date(current.getTime() + Number(hours)*60*60*1000); acc.expiresAt = current.toISOString(); }
    else return res.status(400).json({ error: "days or hours or expiresAt required" });
    await writeAccounts(accounts);
    res.json({ ok: true, account: acc });
  }catch(e){ res.status(500).json({ error: e.message }); }
});

// Admin management endpoints (master required for certain actions)
app.get("/admin/list_admins", async (req,res)=>{
  try{
    const requester = await authenticateAdminFromReq(req);
    if(!requester) return res.status(401).json({ error: "Unauthorized (admin required)" });
    const admins = await readAdmins(); res.json({ admins });
  }catch(e){ res.status(500).json({ error: e.message }); }
});
app.post("/admin/add_admin", async (req,res)=>{
  try{
    const requester = await authenticateAdminFromReq(req);
    if(!requester || !requester.isMaster) return res.status(401).json({ error: "Unauthorized (master admin required)" });
    const { username, password, credits, isMaster } = req.body; if(!username || !password) return res.status(400).json({ error: "username/password required" });
    const admins = await readAdmins(); if(admins.find(a=>a.username===username)) return res.status(400).json({ error: "admin exists" });
    const newAdmin = { username, password, credits: Number(credits||0), isMaster: !!isMaster, createdAt: new Date().toISOString() }; admins.push(newAdmin); await writeAdmins(admins); res.json({ ok: true, admin: newAdmin });
  }catch(e){ res.status(500).json({ error: e.message }); }
});
app.post("/admin/set_admin_credits", async (req,res)=>{
  try{
    const requester = await authenticateAdminFromReq(req);
    if(!requester || !requester.isMaster) return res.status(401).json({ error: "Unauthorized (master required)" });
    const { username, credits } = req.body; if(!username) return res.status(400).json({ error: "username required" });
    const admins = await readAdmins(); const adm = admins.find(a=>a.username===username); if(!adm) return res.status(404).json({ error: "admin not found" }); adm.credits = Number(credits||0); await writeAdmins(admins); res.json({ ok: true, admin: adm });
  }catch(e){ res.status(500).json({ error: e.message }); }
});

app.get("/admin/me", async (req,res)=>{
  try{
    const adm = await authenticateAdminFromReq(req);
    if(!adm) return res.status(401).json({ error: "not logged in or invalid credentials" });
    const info = { username: adm.username, isMaster: !!adm.isMaster, credits: adm.credits || 0, createdAt: adm.createdAt };
    res.json({ me: info });
  }catch(e){ res.status(500).json({ error: e.message }); }
});

// Modified GET /get.php and variants
app.get("/get.php", async (req, res) => {
  try{
    const username = req.query.username || "";
    const password = req.query.password || "";

    if(!username || !password){
      res.status(401).json({ error: "Invalid username/password" });
      return;
    }

    if(isLegacyCredentials(username, password)){
      const map = await readAvailableM3Us();
      if(map.size === 0) return res.status(404).send("No M3U files found");
      const first = map.values().next().value;
      res.setHeader("Content-Type", "application/x-mpegurl; charset=utf-8");
      res.send(first.content);
      return;
    }

    const account = await findAccount(username, password);
    if(account){
      const m3u = await buildM3UForAccount(account);
      res.setHeader("Content-Type", "application/x-mpegurl; charset=utf-8");
      res.send(m3u);
      return;
    }

    res.status(401).json({ error: "Invalid username/password" });
  }catch(e){
    res.status(500).json({ error: e.message });
  }
});

app.get("/get.php.m3u", async (req,res) => {
  const username = req.query.username || "";
  const password = req.query.password || "";
  const account = await findAccount(username, password);
  if(!account) return res.status(401).type("text/plain").send("Invalid username/password");
  try{
    const m3u = await buildM3UForAccount(account);
    res.setHeader("Content-Type", "application/x-mpegurl; charset=utf-8");
    res.setHeader("Content-Disposition", `inline; filename="${username}.m3u"`);
    res.send(m3u);
  }catch(e){ res.status(500).send("Error building M3U: " + e.message); }
});

app.get("/playlist/:username/:password.m3u", async (req,res) => {
  const { username, password } = req.params;
  const account = await findAccount(username, password);
  if(!account) return res.status(401).type("text/plain").send("Invalid username/password");
  try{
    const m3u = await buildM3UForAccount(account);
    res.setHeader("Content-Type", "application/x-mpegurl; charset=utf-8");
    res.setHeader("Content-Disposition", `inline; filename="${username}.m3u"`);
    res.send(m3u);
  }catch(e){ res.status(500).type("text/plain").send("Error building M3U: " + e.message); }
});

app.get("/player_api.php", async (req,res)=>{
  const username = req.query.username || "";
  const password = req.query.password || "";
  if(!isLegacyCredentials(username, password)){
    res.status(401).json({ error: "Invalid username/password" });
    return;
  }
  const action = req.query.action || "";
  try{
    const map = await readAvailableM3Us();
    const channels = [];
    for(const info of map.values()){
      const lines = info.content.replace(/\r/g,"").split("\n").map(l=>l.trim());
      for(let i=0;i<lines.length;i++){
        const line = lines[i];
        if(!line) continue;
        if(line.startsWith("#EXTINF")){
          const after = line.substring(8).trim();
          const idx = after.indexOf(",");
          let metaPart = after, title = "";
          if(idx>=0){ metaPart = after.substring(0, idx); title = after.substring(idx+1).trim(); }
          const re = /([a-zA-Z0-9\-]+)\s*=\s*"([^"]*)"/g;
          const attrs = {}; let m;
          while((m = re.exec(metaPart)) !== null){ attrs[m[1]] = m[2]; }
          let url = "";
          for(let j=i+1;j<lines.length;j++){ if(lines[j] && !lines[j].startsWith("#")){ url = lines[j]; i = j; break; } }
          channels.push({
            title: title || attrs["tvg-name"] || attrs["name"] || "Sin nombre",
            tvgId: attrs["tvg-id"] || "",
            logo: attrs["tvg-logo"] || attrs["tvg_logo"] || "",
            group: attrs["group-title"] || attrs["group"] || path.basename(info.filename, path.extname(info.filename)),
            url
          });
        }
      }
    }
    const groups = Array.from(new Set(channels.map(c=>c.group || "Sin grupo")));
    const groupsMeta = groups.map((g,i)=>({ category_id: i+1, category_name: g }));
    const groupIndex = new Map(groupsMeta.map(g => [g.category_name, g.category_id]));
    if(action === "get_live_categories"){ res.json(groupsMeta); return; }
    if(action === "get_live_streams"){
      const categoryId = req.query.category_id || null;
      let filtered = channels;
      if(categoryId){
        const gid = Number(categoryId);
        if(!Number.isNaN(gid)){
          const name = groupsMeta.find(g=>g.category_id===gid)?.category_name;
          filtered = channels.filter(c => c.group === name);
        }else filtered = channels.filter(c => c.group === categoryId);
      }
      const streams = filtered.map((c, idx) => ({ stream_id: 100000 + idx + 1, name: c.title, stream_icon: c.logo || "", category_id: groupIndex.get(c.group) || 0, stream_type: "live", direct_source: c.url, num: idx+1 }));
      res.json(streams); return;
    }
    res.status(400).json({ error: "Unsupported action: " + action });
  }catch(e){ res.status(500).json({ error: e.message }); }
});

app.options("/*", (req,res)=>{
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  res.sendStatus(200);
});
app.get("/", (req,res)=> res.send("Xtream-lite full server. /admin serves admin panel."));

app.listen(CONFIG.port, ()=> console.log("Xtream-lite listening on port", CONFIG.port));
