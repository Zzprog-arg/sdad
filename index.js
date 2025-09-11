// index.js - Xtream-lite (Node + Express)
// Coloca en la misma carpeta: canales.m3u (tu lista) y opcionalmente group_logos.json
import express from "express";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());


  // --- CONFIG: usuario/clave y expiración ---
const CONFIG = {
  username: process.env.XTREAM_USER || "demo",
  password: process.env.XTREAM_PASS || "demo",
  m3uFile: path.join(__dirname, "canales.m3u"),
  logosFile: path.join(__dirname, "group_logos.json"),
  expirationDate: new Date("2025-09-20T23:59:59") // AAAA-MM-DDTHH:MM:SS
};


// --- util: parse M3U simple (EXINF -> tvg-logo, group-title, title, url) ---
function parseAttrs(attrString){
  const attrs = {};
  const re = /([a-zA-Z0-9\-]+)\s*=\s*"([^"]*)"/g;
  let m;
  while((m = re.exec(attrString)) !== null){
    attrs[m[1]] = m[2];
  }
  return attrs;
}

async function readM3U(){
  const text = await fs.readFile(CONFIG.m3uFile, { encoding: "utf8" });
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
      // siguiente línea no-comment es la URL
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
}

// --- util: read group_logos.json si existe ---
async function readGroupLogos(){
  try{
    const text = await fs.readFile(CONFIG.logosFile, { encoding: "utf8" });
    const arr = JSON.parse(text);
    // normalize map by lowercased group name
    const map = new Map();
    for(const it of arr || []){
      if(!it.group) continue;
      map.set((it.group||"").toString().trim().toLowerCase(), it);
    }
    return map;
  }catch(e){
    return new Map();
  }
}

// --- auth middleware ---
function checkAuth(req, res){
  const username = req.query.username || "";
  const password = req.query.password || "";
  if(username === CONFIG.username && password === CONFIG.password) return true;
  res.status(401).json({ error: "Invalid username/password" });
  return false;
}

// --- Endpoint para servir la M3U (get.php) ---
app.get("/get.php", async (req, res) => {
  if(!checkAuth(req,res)) return;
  // Opciones: type=m3u, m3u_plus
  try{
    const content = await fs.readFile(CONFIG.m3uFile, "utf8");
    res.setHeader("Content-Type", "application/x-mpegurl; charset=utf-8");
    res.send(content);
  }catch(e){
    res.status(500).send("Error leyendo M3U: " + (e && e.message));
  }
});

// --- player_api.php minimal: get_live_categories & get_live_streams ---
app.get("/player_api.php", async (req, res) => {
  if(!checkAuth(req,res)) return;
  const action = req.query.action || "";
  const groupId = req.query.category_id || null;
  try{
    const channels = await readM3U();
    // map groups to ids
    const groups = Array.from(new Set(channels.map(c=>c.group || "Sin grupo")));
    const groupsMeta = groups.map((g,i)=>({ category_id: i+1, category_name: g }));
    const groupIndex = new Map(groupsMeta.map(g => [g.category_name, g.category_id]));

    if(action === "get_live_categories"){
      // return array
      res.json(groupsMeta);
      return;
    }

    if(action === "get_live_streams"){
      // build streams array
      let filtered = channels;
      if(groupId){
        // allow numeric id or name
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
          // stream_type, stream_url, etc. Some apps expect these fields:
          stream_type: "live",
          // NOTE: many apps use "stream_id" to build internal urls; we also include "direct_source"
          // keep the real URL available in "direct_source" so apps can use it if needed.
          direct_source: c.url,
          // some apps check "num" (position)
          num: idx + 1
        };
      });

      res.json(streams);
      return;
    }

    // fallback: not supported action
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

app.get("/", (req,res) => res.send("Xtream-lite server. Use /player_api.php and /get.php with username/password"));

// --- start server ---
// --- start server ---
const PORT = 3000;
app.listen(PORT, () => {
  console.log("Xtream-lite listening on port " + PORT);
});



