// Servidor de la landing RMC Breaking Point.
// Sin dependencias externas: solo módulos estándar de Node (18 o superior).
//
// Variables de entorno:
//   PORT            Puerto HTTP (Render lo asigna automáticamente).
//   ADMIN_PASSWORD  Contraseña para activar el modo edición. Sin ella nadie puede editar.
//   DATA_DIR        Carpeta donde se guardan textos y archivos subidos (por defecto ./data).
//   MAX_UPLOAD_MB   Tamaño máximo por archivo en MB (por defecto 50).

const http = require("http");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT) || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, "data"));
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const CONTENT_FILE = path.join(DATA_DIR, "content.json");
// Files normally live in ./public. If the repository was uploaded flat (index.html next to server.js),
// serve from the root instead, but only page and media files (never server.js, package.json, etc.).
const NESTED_PUBLIC = path.join(__dirname, "public");
const FLAT = !fs.existsSync(path.join(NESTED_PUBLIC, "index.html")) && fs.existsSync(path.join(__dirname, "index.html"));
const PUBLIC_DIR = FLAT ? __dirname : NESTED_PUBLIC;
const FLAT_ALLOWED = new Set([".html", ".svg", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".ico", ".mp4", ".webm"]);
const MAX_UPLOAD = (Number(process.env.MAX_UPLOAD_MB) || 50) * 1024 * 1024;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};
const UPLOAD_EXT = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
};

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/* ---------- Content store (one JSON file) ---------- */
let content = { texts: {}, media: {} };
try {
  const raw = JSON.parse(fs.readFileSync(CONTENT_FILE, "utf8"));
  content = { texts: raw.texts || {}, media: raw.media || {} };
} catch {
  /* first run: nothing saved yet */
}

let writing = Promise.resolve();
function saveContent() {
  // Serialize writes and replace the file atomically.
  writing = writing.then(async () => {
    const tmp = CONTENT_FILE + ".tmp";
    await fsp.writeFile(tmp, JSON.stringify(content, null, 2));
    await fsp.rename(tmp, CONTENT_FILE);
  });
  return writing;
}

/* ---------- Admin sessions ---------- */
const sessions = new Map(); // token -> expiry ms
const SESSION_MS = 12 * 60 * 60 * 1000;

function getCookie(req, name) {
  const header = req.headers.cookie || "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}
function isAdmin(req) {
  const token = getCookie(req, "rmc_admin");
  if (!token) return false;
  const exp = sessions.get(token);
  if (!exp || exp < Date.now()) { sessions.delete(token); return false; }
  return true;
}
function safeEqual(a, b) {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}
const loginAttempts = new Map(); // ip -> {count, until}

/* ---------- Helpers ---------- */
function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}
function json(res, status, obj, headers = {}) {
  send(res, status, JSON.stringify(obj), { "Content-Type": TYPES[".json"], "Cache-Control": "no-store", ...headers });
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error("too_large"), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
async function readJson(req) {
  const buf = await readBody(req, 1024 * 1024);
  try { return JSON.parse(buf.toString("utf8") || "{}"); }
  catch { throw Object.assign(new Error("bad_json"), { status: 400 }); }
}
const isKey = (k) => typeof k === "string" && /^[a-z0-9_]{1,64}$/i.test(k);
const isUploadId = (id) => typeof id === "string" && /^[a-f0-9]{32}\.(png|jpg|webp|gif|mp4|webm)$/.test(id);

function cleanMedia(input) {
  // Accept only {slot: {id, kind}} and {gallery: [{id, kind}]} pointing at real upload ids.
  const out = {};
  if (!input || typeof input !== "object") return out;
  for (const [k, v] of Object.entries(input)) {
    if (!isKey(k)) continue;
    const item = (m) => (m && isUploadId(m.id) && (m.kind === "image" || m.kind === "video") ? { id: m.id, kind: m.kind } : null);
    if (Array.isArray(v)) out[k] = v.map(item).filter(Boolean).slice(0, 60);
    else { const m = item(v); if (m) out[k] = m; }
  }
  return out;
}

/* ---------- Static files (with Range support for video) ---------- */
async function serveFile(req, res, filePath, cache) {
  let stat;
  try { stat = await fsp.stat(filePath); } catch { return send(res, 404, "No encontrado", { "Content-Type": "text/plain; charset=utf-8" }); }
  if (!stat.isFile()) return send(res, 404, "No encontrado", { "Content-Type": "text/plain; charset=utf-8" });
  const type = TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
  const base = { "Content-Type": type, "Accept-Ranges": "bytes", "Cache-Control": cache, "X-Content-Type-Options": "nosniff" };
  const range = req.headers.range;
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (m) {
      let start = m[1] === "" ? stat.size - Number(m[2]) : Number(m[1]);
      let end = m[1] !== "" && m[2] !== "" ? Number(m[2]) : stat.size - 1;
      if (m[1] === "") end = stat.size - 1;
      if (start >= 0 && start <= end && end < stat.size) {
        res.writeHead(206, { ...base, "Content-Length": end - start + 1, "Content-Range": `bytes ${start}-${end}/${stat.size}` });
        if (req.method === "HEAD") return res.end();
        return fs.createReadStream(filePath, { start, end }).pipe(res);
      }
      return send(res, 416, "", { "Content-Range": `bytes */${stat.size}` });
    }
  }
  res.writeHead(200, { ...base, "Content-Length": stat.size });
  if (req.method === "HEAD") return res.end();
  fs.createReadStream(filePath).pipe(res);
}

/* ---------- Routes ---------- */
async function handle(req, res) {
  const url = new URL(req.url, "http://localhost");
  const p = decodeURIComponent(url.pathname);

  // API
  if (p === "/api/content" && req.method === "GET") {
    return json(res, 200, content);
  }
  if (p === "/api/session" && req.method === "GET") {
    return json(res, 200, { admin: isAdmin(req), configured: !!ADMIN_PASSWORD, maxUploadMb: MAX_UPLOAD / 1048576 });
  }
  if (p === "/api/login" && req.method === "POST") {
    const ip = req.headers["x-forwarded-for"]?.split(",")[0].trim() || req.socket.remoteAddress;
    const rec = loginAttempts.get(ip) || { count: 0, until: 0 };
    if (rec.until > Date.now()) return json(res, 429, { error: "rate_limited" });
    if (!ADMIN_PASSWORD) return json(res, 503, { error: "not_configured" });
    const body = await readJson(req);
    if (!safeEqual(body.password || "", ADMIN_PASSWORD)) {
      rec.count += 1;
      if (rec.count >= 5) { rec.until = Date.now() + 5 * 60 * 1000; rec.count = 0; }
      loginAttempts.set(ip, rec);
      return json(res, 401, { error: "wrong_password" });
    }
    loginAttempts.delete(ip);
    const token = crypto.randomBytes(32).toString("hex");
    sessions.set(token, Date.now() + SESSION_MS);
    const secure = (req.headers["x-forwarded-proto"] || "").includes("https") ? "; Secure" : "";
    return json(res, 200, { admin: true }, {
      "Set-Cookie": `rmc_admin=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${secure}`,
    });
  }
  if (p === "/api/logout" && req.method === "POST") {
    const token = getCookie(req, "rmc_admin");
    if (token) sessions.delete(token);
    return json(res, 200, { admin: false }, { "Set-Cookie": "rmc_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0" });
  }

  if (p.startsWith("/api/")) {
    if (!isAdmin(req)) return json(res, 401, { error: "not_admin" });

    if (p === "/api/texts" && req.method === "PUT") {
      const body = await readJson(req);
      if (!isKey(body.key) || typeof body.value !== "string" || body.value.length > 5000) {
        return json(res, 400, { error: "invalid" });
      }
      content.texts[body.key] = body.value;
      await saveContent();
      return json(res, 200, { ok: true });
    }
    if (p === "/api/media" && req.method === "PUT") {
      const body = await readJson(req);
      content.media = cleanMedia(body.media);
      await saveContent();
      return json(res, 200, { media: content.media });
    }
    if (p === "/api/upload" && req.method === "POST") {
      const type = (req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
      const ext = UPLOAD_EXT[type];
      if (!ext) return json(res, 415, { error: "unsupported_type" });
      const declared = Number(req.headers["content-length"] || 0);
      if (declared > MAX_UPLOAD) return json(res, 413, { error: "too_large" });
      const id = crypto.randomBytes(16).toString("hex") + ext;
      const dest = path.join(UPLOAD_DIR, id);
      let size = 0;
      try {
        await new Promise((resolve, reject) => {
          const out = fs.createWriteStream(dest);
          req.on("data", (c) => {
            size += c.length;
            if (size > MAX_UPLOAD) { req.unpipe(out); out.destroy(); req.destroy(); reject(Object.assign(new Error("too_large"), { status: 413 })); }
          });
          req.pipe(out);
          out.on("finish", resolve);
          out.on("error", reject);
          req.on("error", reject);
        });
      } catch (err) {
        await fsp.rm(dest, { force: true });
        if (err.status === 413) return json(res, 413, { error: "too_large" });
        throw err;
      }
      if (!size) { await fsp.rm(dest, { force: true }); return json(res, 400, { error: "empty" }); }
      return json(res, 200, { id, kind: type.startsWith("video/") ? "video" : "image" });
    }
    if (p.startsWith("/api/upload/") && req.method === "DELETE") {
      const id = p.slice("/api/upload/".length);
      if (!isUploadId(id)) return json(res, 400, { error: "invalid" });
      await fsp.rm(path.join(UPLOAD_DIR, id), { force: true });
      return json(res, 200, { deleted: true });
    }
    return json(res, 404, { error: "not_found" });
  }

  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "");

  // Uploaded media
  if (p.startsWith("/uploads/")) {
    const id = p.slice("/uploads/".length);
    if (!isUploadId(id)) return send(res, 404, "No encontrado");
    return serveFile(req, res, path.join(UPLOAD_DIR, id), "public, max-age=31536000, immutable");
  }

  // Public files
  const rel = p === "/" ? "/index.html" : p;
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) return send(res, 404, "No encontrado");
  if (FLAT) {
    const inside = path.relative(PUBLIC_DIR, filePath);
    const top = inside.split(path.sep)[0];
    if (!FLAT_ALLOWED.has(path.extname(filePath).toLowerCase()) || top === "data" || top === "node_modules" || top.startsWith(".")) {
      return send(res, 404, "No encontrado");
    }
  }
  return serveFile(req, res, filePath, rel === "/index.html" ? "no-cache" : "public, max-age=3600");
}

http
  .createServer((req, res) => {
    handle(req, res).catch((err) => {
      if (!res.headersSent) json(res, err.status || 500, { error: err.status ? err.message : "server_error" });
      if (!err.status) console.error(err);
    });
  })
  .listen(PORT, () => {
    console.log(`RMC Breaking Point escuchando en http://localhost:${PORT}`);
    if (!ADMIN_PASSWORD) console.warn("Aviso: ADMIN_PASSWORD no está definida; el modo edición está desactivado.");
    console.log(`Datos en: ${DATA_DIR}`);
  });
