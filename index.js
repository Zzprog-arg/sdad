// index.js - Xtream-lite full server (serves admin panel + API + .m3u endpoints)
// ES module (use "type": "module" in package.json)
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

// CONFIG - ajustá según necesites o con variables de entorno
const CONFIG = {
  xtreamUser: process.env.XTREAM_USER || "demo",
  xtreamPass: process.env.XTREAM_PASS || "demo",
  port: process.env.PORT || 3000,
  accountsFile: path.join(__dirname, "accounts.json"),
  adminsFile: path.join(__dirname, "admins.json"),
  settingsFile: path.join(__dirname, "settings.json"),
  m3uFolder: __dirname, // buscar *.m3u en esta carpeta
  // prefer admin.html (legacy) then admin_v10.html
  adminCandidates: [ path.join(__dirname, "admin.html"), path.join(__dirname, "admin_v10.html") ]
};

// pick admin HTML file at startup
let ADMIN_FILE = null;
for(const p of CONFIG.adminCandidates){
  try{
    if(fsSync.existsSync(p)) { ADMIN_FILE = p; break; }
  }catch(e){}
}

// --- Utilities: file storage for accounts / admins / settings ---
async function safeReadJSON(filePath, defaultValue){
  try{
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  }catch(e){
    return defaultValue;
  }
}
async function safeWriteJSON(filePath, data){
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

// initialize admins file with a default superadmin if missing
async function ensureAdmins(){
  const admins = await safeReadJSON(CONFIG.adminsFile, null);
  if(!admins){
    const defaultAdmin = [{ username: process.env.ADMIN_USER || "admin", password: process.env.ADMIN_PASS || "admin", isMaster: true, credits: 100, createdAt: new Date().toISOString() }];
    await safeWriteJSON(CONFIG.adminsFile, defaultAdmin);
    return defaultAdmin;
  }
  return admins;
}

// read/write accounts
async function readAccounts(){ return await safeReadJSON(CONFIG.accountsFile, []); }
async function writeAccounts(arr){ await safeWriteJSON(CONFIG.accountsFile, arr); }

// read/write admins
async function readAdmins(){ return await safeReadJSON(CONFIG.adminsFile, []); }
async function writeAdmins(arr){ await safeWriteJSON(CONFIG.adminsFile, arr); }

// read settings
async function readSettings(){ return await safeReadJSON(CONFIG.settingsFile, { globalAccountLimit: 1000, allowAdminSignup: false }); }
async function writeSettings(s){ await safeWriteJSON(CONFIG.settingsFile, s); }

// --- M3U utilities: read all .m3u in folder ---
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
    }catch(e){
      // ignore read errors
    }
  }
  return map; // Map<name, {filename, path, content}>
}

// --- build M3U for account ---
async function buildM3UForAccount(account){
  const map = await readAvailableM3Us();
  let listsToUse = [];
  if(Array.isArray(account.lists) && account.lists.length > 0){
    const lower = account.lists.map(s=>s.toString().trim().toLowerCase());
    for(const [name, info] of map){
      if(lower.includes(name.toLowerCase()) || lower.includes(info.filename.toLowerCase())) listsToUse.push(info);
    }
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

// --- helper: find account by username/password ---
async function findAccount(username, password){
  const accounts = await readAccounts();
  return accounts.find(a => a.username === username && a.password === password) || null;
}

// --- HTTP Basic check for legacy endpoints (player_api/get.php) ---
function checkLegacyAuth(req, res){
  const username = req.query.username || "";
  const password = req.query.password || "";
  if(username === CONFIG.xtreamUser && password === CONFIG.xtreamPass) return true;
  res.status(401).json({ error: "Invalid username/password" });
  return false;
}

// --- Serve admin panel HTML at /admin ---
app.get("/admin", async (req, res) => {
  try{
    if(ADMIN_FILE){
      const html = await fs.readFile(ADMIN_FILE, "utf8");
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(html);
      return;
    }
    // helpful page when no admin HTML present
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(`
      <html><body style="font-family:system-ui,Arial;padding:30px;background:#071226;color:#e6eef8">
        <h2>Admin panel not found</h2>
        <p>Coloca <code>admin.html</code> o <code>admin_v10.html</code> en la misma carpeta que index.js para que /admin funcione.</p>
        <p>Actualmente no se encontró ningún archivo de panel.</p>
      </body></html>
    `);
  }catch(e){
    res.status(500).send("Error leyendo admin file: " + e.message);
  }
});

// Serve static files from /public if exists (optional)
const publicDir = path.join(__dirname, "public");
app.use("/public", express.static(publicDir));

// --- endpoints used by admin UI (no auth required by default) ---

// GET available lists (names)
app.get("/admin/available_lists", async (req, res) => {
  try{
    const map = await readAvailableM3Us();
    res.json({ lists: Array.from(map.keys()) });
  }catch(e){ res.status(500).json({ error: e.message }); }
});

// list accounts
app.get("/admin/list_accounts", async (req, res) => {
  try{
    const accounts = await readAccounts();
    res.json({ accounts });
  }catch(e){ res.status(500).json({ error: e.message }); }
});

// add account: expects { username, password, days?, expiresAt?, lists?, planLabel? }
app.post("/admin/add_account", async (req, res) => {
  try{
    const { username, password, days, expiresAt, lists, planLabel } = req.body;
    if(!username || !password) return res.status(400).json({ error: "username/password required" });

    const accounts = await readAccounts();
    if(accounts.find(a=>a.username===username)) return res.status(400).json({ error: "username exists" });

    const createdAt = new Date().toISOString();
    let finalExpires = null;
    if(expiresAt) finalExpires = new Date(expiresAt).toISOString();
    else if(days) finalExpires = new Date(Date.now() + Number(days)*24*60*60*1000).toISOString();

    // lists: if not provided or empty -> assign all lists
    let listsToAssign = Array.isArray(lists) ? lists : [];
    if(listsToAssign.length === 0){
      const map = await readAvailableM3Us();
      listsToAssign = Array.from(map.keys());
    }

    const newAcc = { username, password, createdAt, expiresAt: finalExpires, lists: listsToAssign, planLabel: planLabel || null };
    accounts.push(newAcc);
    await writeAccounts(accounts);
    res.json({ ok: true, account: newAcc });
  }catch(e){ res.status(500).json({ error: e.message }); }
});

// delete account
app.post("/admin/delete_account", async (req, res) => {
  try{
    const { username } = req.body;
    if(!username) return res.status(400).json({ error: "username required" });
    let accounts = await readAccounts();
    const before = accounts.length;
    accounts = accounts.filter(a=>a.username !== username);
    await writeAccounts(accounts);
    res.json({ ok: true, deleted: before - accounts.length });
  }catch(e){ res.status(500).json({ error: e.message }); }
});

// set account expiry: accepts { username, days?, hours?, expiresAt? }
app.post("/admin/set_account_expiry", async (req, res) => {
  try{
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

// --- admin user (resellers) management ---
// ensure admins.json exists
await ensureAdmins();

app.get("/admin/list_admins", async (req,res) => {
  try{ const admins = await readAdmins(); res.json({ admins }); }catch(e){ res.status(500).json({ error: e.message }); }
});

// add admin/reseller: { username, password, credits?, isMaster? }
app.post("/admin/add_admin", async (req,res) => {
  try{
    const { username, password, credits, isMaster } = req.body;
    if(!username || !password) return res.status(400).json({ error: "username/password required" });
    const admins = await readAdmins();
    if(admins.find(a=>a.username===username)) return res.status(400).json({ error: "admin exists" });
    const newAdmin = { username, password, credits: Number(credits||0), isMaster: !!isMaster, createdAt: new Date().toISOString() };
    admins.push(newAdmin);
    await writeAdmins(admins);
    res.json({ ok: true, admin: newAdmin });
  }catch(e){ res.status(500).json({ error: e.message }); }
});

// set admin credits { username, credits }
app.post("/admin/set_admin_credits", async (req,res) => {
  try{
    const { username, credits } = req.body;
    if(!username) return res.status(400).json({ error: "username required" });
    const admins = await readAdmins();
    const adm = admins.find(a=>a.username===username);
    if(!adm) return res.status(404).json({ error: "admin not found" });
    adm.credits = Number(credits||0);
    await writeAdmins(admins);
    res.json({ ok: true, admin: adm });
  }catch(e){ res.status(500).json({ error: e.message }); }
});

// GET /admin/me - returns current admin info if credentials provided as query or basic auth
app.get("/admin/me", async (req,res) => {
  try{
    const qUser = req.query.username || req.query.admin_user || null;
    const qPass = req.query.password || req.query.admin_pass || null;

    let username = qUser, password = qPass;
    // fallback: Basic Auth header
    if(!username){
      const auth = req.headers.authorization || "";
      if(auth.startsWith("Basic ")){
        const decoded = Buffer.from(auth.slice(6), "base64").toString("utf8");
        const [u,p] = decoded.split(":",2);
        username = u; password = p;
      }
    }
    if(!username){
      return res.status(401).json({ error: "not logged in" });
    }
    const admins = await readAdmins();
    const adm = admins.find(a=>a.username === username && a.password === password);
    if(!adm) return res.status(401).json({ error: "invalid credentials" });
    const info = { username: adm.username, isMaster: !!adm.isMaster, credits: adm.credits || 0, createdAt: adm.createdAt };
    res.json({ me: info });
  }catch(e){ res.status(500).json({ error: e.message }); }
});

// admin settings
app.get("/admin/settings", async (req,res) => {
  try{ const settings = await readSettings(); res.json({ settings }); }catch(e){ res.status(500).json({ error: e.message }); }
});
app.post("/admin/settings", async (req,res) => {
  try{ const s = req.body || {}; await writeSettings(s); res.json({ ok: true, settings: s }); }catch(e){ res.status(500).json({ error: e.message }); }
});

// logout - no-op (frontend handles basic-auth oddities)
app.get("/admin/logout", (req,res) => { res.status(401).json({ ok:false, msg: "logout" }); });

// --- M3U endpoints ---
// existing get.php (legacy) - requires legacy xtream username/password (query)
app.get("/get.php", async (req,res) => {
  if(!checkLegacyAuth(req,res)) return;
  try{
    const map = await readAvailableM3Us();
    if(map.size === 0) return res.status(404).send("No M3U files found");
    const first = map.values().next().value;
    res.setHeader("Content-Type", "application/x-mpegurl; charset=utf-8");
    res.send(first.content);
  }catch(e){ res.status(500).send("Error reading M3U: " + e.message); }
});

// get.php.m3u - accepts username/password query & returns user-specific m3u
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

// playlist/:username/:password.m3u - direct url
app.get("/playlist/:username/:password.m3u", async (req,res) => {
  const { username, password } = req.params;
  const account = await findAccount(username, password);
  if(!account) return res.status(401).type("text/plain").send("Invalid username/password");
  try{
    const m3u = await buildM3UForAccount(account);
    res.setHeader("Content-Type", "application/x-mpegurl; charset=utf-8");
    res.setHeader("Content-Disposition", `inline; filename="${username}.m3u"`);
    res.send(m3u);
  }catch(e){ res.status(500).send("Error building M3U: " + e.message); }
});

// --- player_api.php minimal ---
app.get("/player_api.php", async (req,res)=>{
  if(!checkLegacyAuth(req,res)) return;
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

// Simple health + CORS
app.options("/*", (req,res)=>{
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  res.sendStatus(200);
});
app.get("/", (req,res)=> res.send("Xtream-lite full server. /admin should serve admin panel."));

// Start server
app.listen(CONFIG.port, ()=> console.log("Xtream-lite full listening on port", CONFIG.port));
