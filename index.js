// index.js - Xtream-lite extended (Node + Express)
// Requiere Node >= 14+, usa ES modules
import express from "express";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

// --- CONFIG ---
const CONFIG = {
  username: process.env.XTREAM_USER || "demo",
  password: process.env.XTREAM_PASS || "demo",
  accountsFile: path.join(__dirname, "accounts.json"), // persistencia local de cuentas (array)
  // leer todos los .m3u en la carpeta del proyecto
  m3uFolder: __dirname
};

// --- helpers: accounts ---
async function readAccounts(){
  try{
    const t = await fs.readFile(CONFIG.accountsFile, "utf8");
    const arr = JSON.parse(t);
    if(!Array.isArray(arr)) return [];
    return arr;
  }catch(e){
    // si no existe, devolvemos array vacío
    return [];
  }
}

async function findAccount(username, password){
  const arr = await readAccounts();
  return arr.find(a => a.username === username && a.password === password) || null;
}

// --- helpers: read all M3U files in folder ---
async function readAvailableM3Us(){
  const files = await fs.readdir(CONFIG.m3uFolder);
  const m3uFiles = files.filter(f => f.toLowerCase().endsWith(".m3u"));
  const map = new Map();
  for(const f of m3uFiles){
    try{
      const full = path.join(CONFIG.m3uFolder, f);
      const txt = await fs.readFile(full, "utf8");
      // key = filename sin extension (ej: canales, peliculas)
      const key = path.basename(f, path.extname(f));
      map.set(key, { filename: f, path: full, content: txt });
    }catch(e){
      // ignore read errors
    }
  }
  return map; // Map<name, { filename, path, content }>
}

// --- util: build a single combined M3U string for a user ---
async function buildM3UForAccount(account){
  // obtiene todas las listas disponibles
  const map = await readAvailableM3Us();
  // decide qué listas usar: si account.lists vacio -> todas
  let listsToUse = [];
  if(Array.isArray(account.lists) && account.lists.length > 0){
    // buscar coincidencias por nombre (case-insensitive)
    const lower = account.lists.map(s => s.toString().trim().toLowerCase());
    for(const [name, info] of map){
      if(lower.includes(name.toLowerCase()) || lower.includes(info.filename.toLowerCase())){
        listsToUse.push(info);
      }
    }
    // si no encontró ninguna coincidencia, por seguridad asignar todas
    if(listsToUse.length === 0 && map.size > 0){
      listsToUse = Array.from(map.values());
    }
  }else{
    listsToUse = Array.from(map.values());
  }

  // combine: keep a single header #EXTM3U and append content of each chosen file removing duplicate header lines
  let out = "#EXTM3U\n";
  for(const info of listsToUse){
    if(!info || !info.content) continue;
    // remove leading #EXTM3U lines (y possible BOM)
    let txt = info.content.replace(/^\uFEFF/, "");
    txt = txt.split("\n").filter(line => line.trim() !== "#EXTM3U").join("\n").trim();
    if(txt) out += "\n" + txt + "\n";
  }
  return out;
}

// --- auth middleware for admin endpoints (simple query-based auth used historically) ---
function checkAuth(req, res){
  const username = req.query.username || "";
  const password = req.query.password || "";
  if(username === CONFIG.username && password === CONFIG.password) return true;
  res.status(401).json({ error: "Invalid username/password" });
  return false;
}

// --- existing get.php: devuelve el archivo m3u original (sin filtrar por usuario) ---
app.get("/get.php", async (req, res) => {
  if(!checkAuth(req,res)) return;
  // devuelve el primer .m3u encontrado completo (útil para clientes que quieren la lista completa)
  try{
    const map = await readAvailableM3Us();
    if(map.size === 0) return res.status(404).send("No M3U files found");
    // tomar el primero
    const first = map.values().next().value;
    const content = first.content;
    res.setHeader("Content-Type", "application/x-mpegurl; charset=utf-8");
    res.send(content);
  }catch(e){
    res.status(500).send("Error leyendo M3U: " + (e && e.message));
  }
});

// --- nuevo: get.php.m3u para compatibilidad (acepta query username/password) ---
app.get("/get.php.m3u", async (req, res) => {
  // acepta credenciales en query
  const username = req.query.username || "";
  const password = req.query.password || "";
  const account = await findAccount(username, password);
  if(!account){
    res.status(401).type("text/plain").send("Invalid username/password");
    return;
  }
  try{
    const m3u = await buildM3UForAccount(account);
    res.setHeader("Content-Type", "application/x-mpegurl; charset=utf-8");
    // fuerza el nombre de archivo para descargar / usar en apps
    res.setHeader("Content-Disposition", `inline; filename="${username}.m3u"`);
    res.send(m3u);
  }catch(e){
    res.status(500).type("text/plain").send("Error building M3U: " + (e && e.message));
  }
});

// --- nuevo y limpio: playlist/:username/:password.m3u  ejemplo: /playlist/mateo/pass.m3u ---
app.get("/playlist/:username/:password.m3u", async (req, res) => {
  const { username, password } = req.params;
  const account = await findAccount(username, password);
  if(!account){
    res.status(401).type("text/plain").send("Invalid username/password");
    return;
  }
  try{
    const m3u = await buildM3UForAccount(account);
    res.setHeader("Content-Type", "application/x-mpegurl; charset=utf-8");
    res.setHeader("Content-Disposition", `inline; filename="${username}.m3u"`);
    res.send(m3u);
  }catch(e){
    res.status(500).type("text/plain").send("Error building M3U: " + (e && e.message));
  }
});

// --- player_api.php minimal (mantener compatibilidad con apps que usan player_api.php) ---
app.get("/player_api.php", async (req, res) => {
  if(!checkAuth(req,res)) return;
  const action = req.query.action || "";
  try{
    // leer canales desde todas las m3u disponibles (parse básico)
    const map = await readAvailableM3Us();
    // combine all channels by parsing EXTINF and url lines (simple)
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
          if(idx >= 0){ metaPart = after.substring(0, idx); title = after.substring(idx+1).trim(); }
          const re = /([a-zA-Z0-9\-]+)\s*=\s*"([^"]*)"/g;
          const attrs = {};
          let m;
          while((m = re.exec(metaPart)) !== null){ attrs[m[1]] = m[2]; }
          // siguiente no-comment = url
          let url = "";
          for(let j=i+1;j<lines.length;j++){
            if(lines[j] && !lines[j].startsWith("#")){ url = lines[j]; i = j; break; }
          }
          channels.push({
            title: title || attrs["tvg-name"] || attrs["name"] || "Sin nombre",
            tvgId: attrs["tvg-id"] || "",
            logo: attrs["tvg-logo"] || attrs["tvg_logo"] || "",
            group: attrs["group-title"] || attrs["group"] || path.basename(info.filename, path.extname(info.filename)),
            url: url
          });
        }
      }
    }

    // groups
    const groups = Array.from(new Set(channels.map(c=>c.group || "Sin grupo")));
    const groupsMeta = groups.map((g,i)=>({ category_id: i+1, category_name: g }));
    const groupIndex = new Map(groupsMeta.map(g => [g.category_name, g.category_id]));

    if(action === "get_live_categories"){
      res.json(groupsMeta);
      return;
    }
    if(action === "get_live_streams"){
      const categoryId = req.query.category_id || null;
      let filtered = channels;
      if(categoryId){
        const gid = Number(categoryId);
        if(!Number.isNaN(gid)){
          const name = groupsMeta.find(g=>g.category_id===gid)?.category_name;
          filtered = channels.filter(c => c.group === name);
        }else{
          filtered = channels.filter(c => c.group === categoryId);
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

// --- simple health + CORS for clients that expect it ---
app.options("/*", (req,res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.sendStatus(200);
});

app.get("/", (req,res) => res.send("Xtream-lite extended. Use /player_api.php and /get.php or /get.php.m3u or /playlist/:user/:pass.m3u"));

// --- start server ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=> console.log("Xtream-lite extended listening on port", PORT));
