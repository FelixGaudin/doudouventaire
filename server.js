/* Doudouventaire — serveur : sert les pages, garde l'inventaire sur le disque,
   et protège les écritures derrière un mot de passe.

   Aucune dépendance : uniquement les modules de Node. */

const http = require("node:http");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, "data");
const DATA_FILE = path.join(DATA_DIR, "doudous.json");
const PORT = Number(process.env.PORT || 8000);

const SESSION_COOKIE = "doudou_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_BODY = 12 * 1024 * 1024;
const MAX_PHOTO_CHARS = 3 * 1024 * 1024;

/* Un mot de passe unique se devine à force d'essais : après quelques échecs,
   l'adresse attend. */
const LOGIN_MAX_FAILS = 8;
const LOGIN_LOCK_MS = 10 * 60 * 1000;

/* ---------- Configuration ---------- */

/* Le .env sert au lancement à la main ; sous Docker, env_file a déjà tout posé
   dans l'environnement, qui garde la priorité. */
function loadDotEnv(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return;
  }
  for (const line of raw.split("\n")) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match || line.trimStart().startsWith("#")) continue;
    const value = match[2].replace(/^(['"])([\s\S]*)\1$/, "$2");
    if (!(match[1] in process.env)) process.env[match[1]] = value;
  }
}

loadDotEnv(path.join(ROOT, ".env"));

const ADMIN_USER = process.env.ADMIN_USER || "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const SECURE_COOKIES = process.env.SECURE_COOKIES === "true";

let PUBLIC_REAL;
try {
  PUBLIC_REAL = fs.realpathSync(PUBLIC_DIR);
} catch {
  console.error(`Doudouventaire : le dossier ${PUBLIC_DIR} est introuvable.`);
  process.exit(1);
}

if (!ADMIN_USER || !ADMIN_PASSWORD) {
  console.error(
    "Doudouventaire : ADMIN_USER et ADMIN_PASSWORD sont obligatoires.\n" +
    "Copie .env.example vers .env et donne-leur une valeur."
  );
  process.exit(1);
}

/* ---------- Inventaire ---------- */

let inventory = [];
let writes = Promise.resolve();
let revisionCache = null;

/* Une empreinte de l'inventaire : les pages s'en servent pour savoir, à moindres
   frais, si quelque chose a changé depuis leur dernier passage. */
function revision() {
  revisionCache ??= crypto.createHash("sha1").update(JSON.stringify(inventory)).digest("hex").slice(0, 16);
  return revisionCache;
}

function isPlushie(entry) {
  return entry && typeof entry.name === "string" && typeof entry.species === "string"
    && typeof entry.birthday === "string" && /^\d{4}-\d{2}-\d{2}$/.test(entry.birthday);
}

async function loadInventory() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  try {
    const parsed = JSON.parse(await fsp.readFile(DATA_FILE, "utf8"));
    const list = Array.isArray(parsed) ? parsed : parsed.plushies;
    inventory = Array.isArray(list) ? list.filter(isPlushie) : [];
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.error(`Doudouventaire : ${DATA_FILE} est illisible, l'inventaire démarre vide.`, error.message);
    }
    inventory = [];
  }
  revisionCache = null;
  console.log(`Doudouventaire : ${inventory.length} doudou(s) chargé(s) depuis ${DATA_FILE}`);
}

/* Écriture par remplacement : le fichier final n'est jamais à moitié écrit, et
   deux requêtes rapprochées ne se marchent pas dessus. */
function persist() {
  revisionCache = null;
  const snapshot = JSON.stringify({ plushies: inventory }, null, 2);
  writes = writes.then(async () => {
    const temporary = `${DATA_FILE}.${process.pid}.tmp`;
    await fsp.writeFile(temporary, snapshot, "utf8");
    await fsp.rename(temporary, DATA_FILE);
  }).catch((error) => {
    console.error("Doudouventaire : l'inventaire n'a pas pu être enregistré.", error);
    throw error;
  });
  return writes;
}

function uid() {
  return crypto.randomBytes(8).toString("hex");
}

/* ---------- Validation ---------- */

/* Une photo vient du <canvas> du navigateur ; tout autre contenu est écarté
   avant d'atterrir dans un attribut src. */
function safePhoto(photo) {
  if (typeof photo !== "string" || photo.length > MAX_PHOTO_CHARS) return null;
  return /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(photo) ? photo : null;
}

function isRealDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/* Le navigateur vérifie déjà, mais l'API est ouverte : elle revérifie tout. */
function sanitize(body) {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const species = typeof body.species === "string" ? body.species.trim() : "";
  const birthday = typeof body.birthday === "string" ? body.birthday.trim() : "";

  if (!name || name.length > 40) return { error: "Le nom manque, ou dépasse 40 caractères." };
  if (!species || species.length > 30) return { error: "L'espèce manque, ou dépasse 30 caractères." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthday) || !isRealDate(birthday)) {
    return { error: "La date de naissance n'est pas une date valide." };
  }
  if (birthday > todayIso()) return { error: "La date de naissance est dans le futur." };

  return { value: { name, species, birthday, photo: safePhoto(body.photo) || undefined } };
}

/* ---------- Calendrier ---------- */

/* Les valeurs texte d'un .ics échappent le point-virgule, la virgule et
   l'antislash (RFC 5545). */
function icsText(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/* Une ligne d'un .ics ne dépasse pas 75 octets : au-delà, elle se replie et la
   suite commence par une espace. Le découpage compte en octets, sans jamais
   couper un caractère accentué en deux. */
function fold(line) {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;

  const parts = [];
  let start = 0;
  while (start < bytes.length) {
    let end = Math.min(start + (parts.length ? 74 : 75), bytes.length);
    while (end > start + 1 && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    parts.push(bytes.subarray(start, end).toString("utf8"));
    start = end;
  }
  return parts.join("\r\n ");
}

function icsStamp(plushie) {
  const addedAt = typeof plushie.addedAt === "string" ? plushie.addedAt : "";
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(addedAt);
  if (match) return `${match[1]}${match[2]}${match[3]}T${match[4]}${match[5]}${match[6]}Z`;
  return `${plushie.birthday.replace(/-/g, "")}T000000Z`;
}

function frenchDate(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/* Un anniversaire par doudou, qui revient chaque année. Le contenu ne dépend que
   de l'inventaire : à inventaire égal, le fichier est identique, donc les agendas
   qui repassent reçoivent un 304. */
function buildCalendar() {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Doudouventaire//Anniversaires//FR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Doudouventaire",
    "X-WR-CALDESC:Les anniversaires des doudous",
    "REFRESH-INTERVAL;VALUE=DURATION:PT12H",
    "X-PUBLISHED-TTL:PT12H",
  ];

  for (const plushie of inventory) {
    const [y, m, d] = plushie.birthday.split("-").map(Number);
    const start = plushie.birthday.replace(/-/g, "");
    /* Un évènement d'une journée se termine au lendemain. */
    const end = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10).replace(/-/g, "");

    lines.push(
      "BEGIN:VEVENT",
      `UID:${plushie.id}@doudouventaire`,
      `DTSTAMP:${icsStamp(plushie)}`,
      `DTSTART;VALUE=DATE:${start}`,
      `DTEND;VALUE=DATE:${end}`,
      "RRULE:FREQ=YEARLY",
      `SUMMARY:${icsText(`Anniversaire de ${plushie.name}`)}`,
      `DESCRIPTION:${icsText(`${plushie.species} \u00b7 depuis le ${frenchDate(plushie.birthday)}`)}`,
      "TRANSP:TRANSPARENT",
      "END:VEVENT",
    );
  }

  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

/* ---------- Sessions ---------- */

const sessions = new Map();
const loginFails = new Map();

function sameSecret(given, expected) {
  const a = crypto.createHash("sha256").update(String(given)).digest();
  const b = crypto.createHash("sha256").update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}

function openSession() {
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, Date.now() + SESSION_TTL_MS);
  return token;
}

function readCookie(header, name) {
  for (const part of (header || "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

function isAuthenticated(req) {
  const token = readCookie(req.headers.cookie, SESSION_COOKIE);
  if (!token) return false;
  const expires = sessions.get(token);
  if (!expires) return false;
  if (expires < Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function sessionCookie(token) {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    token ? `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}` : "Max-Age=0",
  ];
  if (SECURE_COOKIES) parts.push("Secure");
  return parts.join("; ");
}

function lockedOut(ip) {
  const entry = loginFails.get(ip);
  if (!entry) return false;
  if (entry.until < Date.now()) {
    loginFails.delete(ip);
    return false;
  }
  return entry.fails >= LOGIN_MAX_FAILS;
}

function noteLoginFailure(ip) {
  const entry = loginFails.get(ip) || { fails: 0, until: 0 };
  entry.fails++;
  entry.until = Date.now() + LOGIN_LOCK_MS;
  loginFails.set(ip, entry);
}

/* ---------- Réponses ---------- */

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  res.end(body);
}

function sendJson(res, status, value, headers = {}) {
  send(res, status, JSON.stringify(value), { "Content-Type": "application/json; charset=utf-8", ...headers });
}

/* Les deux adresses qui ne portent pas le nom de leur fichier. */
const PAGES = {
  "/": "index.html",
  "/index.html": "index.html",
  "/admin": "admin.html",
};

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function notFound(res) {
  send(res, 404, "Page introuvable.", { "Content-Type": "text/plain; charset=utf-8" });
}

/* Tout ce qui est servi vient de public/, et rien n'en sort : le chemin demandé
   est résolu puis vérifié comme étant bien à l'intérieur du dossier. Une
   extension qui n'est pas dans la liste n'est pas servie du tout. */
async function sendStatic(req, res, pathname) {
  const name = PAGES[pathname.replace(/\/+$/, "") || "/"] || pathname;

  let decoded;
  try {
    decoded = decodeURIComponent(name);
  } catch {
    return send(res, 400, "Adresse illisible.", { "Content-Type": "text/plain; charset=utf-8" });
  }
  if (decoded.includes("\0")) return notFound(res);

  const target = path.resolve(PUBLIC_DIR, `.${decoded.startsWith("/") ? decoded : `/${decoded}`}`);
  if (target !== PUBLIC_DIR && !target.startsWith(PUBLIC_DIR + path.sep)) return notFound(res);

  const type = TYPES[path.extname(target).toLowerCase()];
  if (!type) return notFound(res);

  /* Le chemin résolu ne suffit pas : un lien symbolique déposé dans public/
     pointerait ailleurs. On regarde donc où le fichier se trouve vraiment. */
  let real;
  try {
    real = await fsp.realpath(target);
  } catch {
    return notFound(res);
  }
  if (real !== PUBLIC_REAL && !real.startsWith(PUBLIC_REAL + path.sep)) return notFound(res);

  try {
    const body = await fsp.readFile(real);
    return send(res, 200, req.method === "HEAD" ? "" : body, { "Content-Type": type });
  } catch {
    return notFound(res);
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("trop gros"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function readJson(req) {
  try {
    return JSON.parse(await readBody(req)) ?? {};
  } catch {
    return null;
  }
}

/* ---------- Routage ---------- */

async function route(req, res, url) {
  const { pathname } = url;

  /* Le public : lire l'étagère, rien de plus. Les pages repassent régulièrement ;
     tant que la révision ne bouge pas, la réponse est un 304 sans les photos. */
  if (pathname === "/api/plushies" && req.method === "GET") {
    const etag = `"${revision()}"`;
    const headers = { "Cache-Control": "no-cache", ETag: etag };
    if (req.headers["if-none-match"] === etag) {
      return send(res, 304, "", headers);
    }
    return sendJson(res, 200, { revision: revision(), plushies: inventory }, headers);
  }

  /* Le calendrier : la même étagère, pour un agenda qui s'y abonne. */
  if (pathname === "/anniversaires.ics" && (req.method === "GET" || req.method === "HEAD")) {
    const etag = `"ics-${revision()}"`;
    const headers = {
      "Cache-Control": "no-cache",
      ETag: etag,
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="doudouventaire.ics"',
    };
    if (req.headers["if-none-match"] === etag) {
      return send(res, 304, "", { "Cache-Control": "no-cache", ETag: etag });
    }
    return send(res, 200, req.method === "HEAD" ? "" : buildCalendar(), headers);
  }

  /* La session. */
  if (pathname === "/api/session") {
    if (req.method === "GET") {
      return sendJson(res, 200, { authenticated: isAuthenticated(req) });
    }

    if (req.method === "POST") {
      const ip = req.socket.remoteAddress || "?";
      if (lockedOut(ip)) {
        return sendJson(res, 429, { error: "Trop d'essais. Réessaie dans dix minutes." });
      }
      const body = await readJson(req);
      if (!body) return sendJson(res, 400, { error: "Requête illisible." });

      const ok = sameSecret(body.user, ADMIN_USER) && sameSecret(body.password, ADMIN_PASSWORD);
      if (!ok) {
        noteLoginFailure(ip);
        return sendJson(res, 401, { error: "Identifiant ou mot de passe incorrect." });
      }
      loginFails.delete(ip);
      return sendJson(res, 200, { authenticated: true }, { "Set-Cookie": sessionCookie(openSession()) });
    }

    if (req.method === "DELETE") {
      const token = readCookie(req.headers.cookie, SESSION_COOKIE);
      if (token) sessions.delete(token);
      return sendJson(res, 200, { authenticated: false }, { "Set-Cookie": sessionCookie("") });
    }
  }

  /* Tout ce qui suit écrit : réservé à l'admin. */
  const writesInventory = pathname === "/api/plushies" || pathname.startsWith("/api/plushies/") || pathname === "/api/import";
  if (writesInventory) {
    if (!isAuthenticated(req)) {
      return sendJson(res, 401, { error: "Connexion nécessaire." });
    }

    if (pathname === "/api/plushies" && req.method === "POST") {
      const body = await readJson(req);
      if (!body) return sendJson(res, 400, { error: "Requête illisible." });
      const { value, error } = sanitize(body);
      if (error) return sendJson(res, 400, { error });

      const plushie = { id: uid(), ...value, addedAt: new Date().toISOString() };
      inventory.push(plushie);
      await persist();
      return sendJson(res, 201, { plushie });
    }

    const single = /^\/api\/plushies\/([A-Za-z0-9_-]{1,64})$/.exec(pathname);
    if (single) {
      const id = single[1];
      const index = inventory.findIndex((p) => p.id === id);
      if (index === -1) return sendJson(res, 404, { error: "Ce doudou n'est plus sur l'étagère." });

      if (req.method === "PUT") {
        const body = await readJson(req);
        if (!body) return sendJson(res, 400, { error: "Requête illisible." });
        const { value, error } = sanitize(body);
        if (error) return sendJson(res, 400, { error });

        const plushie = { ...inventory[index], ...value };
        if (!value.photo) delete plushie.photo;
        inventory[index] = plushie;
        await persist();
        return sendJson(res, 200, { plushie });
      }

      if (req.method === "DELETE") {
        const [removed] = inventory.splice(index, 1);
        await persist();
        return sendJson(res, 200, { removed: removed.id });
      }
    }

    /* Import : ajoute ce qui manque, en ignorant les doublons nom + naissance. */
    if (pathname === "/api/import" && req.method === "POST") {
      const body = await readJson(req);
      if (!body) return sendJson(res, 400, { error: "Requête illisible." });
      const incoming = Array.isArray(body) ? body : (body.plushies || []);
      if (!Array.isArray(incoming)) return sendJson(res, 400, { error: "Ce fichier ne contient aucun doudou." });

      const known = new Set(inventory.map((p) => `${p.name}|${p.birthday}`));
      const fresh = [];
      for (const entry of incoming) {
        if (!entry || typeof entry !== "object") continue;
        const { value } = sanitize(entry);
        if (!value || known.has(`${value.name}|${value.birthday}`)) continue;
        known.add(`${value.name}|${value.birthday}`);
        fresh.push({
          id: uid(),
          ...value,
          addedAt: typeof entry.addedAt === "string" ? entry.addedAt : new Date().toISOString(),
        });
      }

      inventory.push(...fresh);
      if (fresh.length) await persist();
      return sendJson(res, 200, { added: fresh.length, skipped: incoming.length - fresh.length });
    }
  }

  if (pathname.startsWith("/api/")) return sendJson(res, 405, { error: "Méthode non permise." });

  /* Les pages et leurs fichiers. */
  if (req.method === "GET" || req.method === "HEAD") return sendStatic(req, res, pathname);
  notFound(res);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  route(req, res, url).catch((error) => {
    console.error(`Doudouventaire : ${req.method} ${url.pathname} a échoué.`, error);
    if (!res.headersSent) sendJson(res, 500, { error: "Le serveur a rencontré un problème." });
    else res.end();
  });
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Doudouventaire : le port ${PORT} est déjà pris. Arrête l'autre instance, ou change PORT.`);
    process.exit(1);
  }
  throw error;
});

loadInventory().then(() => {
  server.listen(PORT, () => {
    console.log(`Doudouventaire : http://localhost:${PORT} — admin sur /admin`);
  });
});

/* Un onglet ouvert garde sa connexion en vie : sans la fermer, l'arrêt
   attendrait le délai de grâce de Docker à chaque fois. */
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    server.close();
    server.closeIdleConnections();
    writes.finally(() => process.exit(0));
  });
}
