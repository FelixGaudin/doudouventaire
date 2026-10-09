/* Doudouventaire — l'annonce des anniversaires.

   Une fois par jour, à l'heure dite, ce service demande l'étagère au serveur et,
   si un doudou fête son anniversaire, l'annonce sur un webhook (Discord, Slack).

   Aucune dépendance : uniquement les modules de Node. */

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

const ROOT = __dirname;

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

const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, "data");
const STATE_FILE = path.join(DATA_DIR, "annonces.json");
const APP_URL = (process.env.APP_URL || "http://localhost:8000").replace(/\/+$/, "");
const WEBHOOK_URL = process.env.WEBHOOK_URL || "";
const WEBHOOK_FORMAT = (process.env.WEBHOOK_FORMAT || "discord").toLowerCase();

/* --now annonce tout de suite et s'arrête : de quoi essayer son webhook. */
const RUN_NOW = process.argv.includes("--now");

function parseTime(value) {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec((value || "").trim());
  if (!match) {
    console.error(`Anniversaires : NOTIFY_AT="${value}" n'est pas une heure au format HH:MM.`);
    process.exit(1);
  }
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

const NOTIFY_AT = parseTime(process.env.NOTIFY_AT || "09:00");

const log = (message) => console.log(`Anniversaires : ${message}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isoDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/* ---------- Les doudous du jour ---------- */

/* Le serveur peut démarrer un instant après ce service : on réessaie. */
async function fetchPlushies(attempts = 6) {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(`${APP_URL}/api/plushies`);
      if (!response.ok) throw new Error(`le serveur répond ${response.status}`);
      const { plushies } = await response.json();
      if (!Array.isArray(plushies)) throw new Error("réponse inattendue");
      return plushies;
    } catch (error) {
      if (attempt >= attempts) throw error;
      const wait = Math.min(attempt * 5000, 30000);
      log(`l'étagère est injoignable (${error.message}), nouvel essai dans ${wait / 1000} s`);
      await sleep(wait);
    }
  }
}

function birthdaysOn(plushies, date) {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return plushies
    .filter((plushie) => {
      const [, m, d] = String(plushie.birthday || "").split("-").map(Number);
      return m === month && d === day;
    })
    .map((plushie) => {
      const year = Number(String(plushie.birthday).slice(0, 4));
      return { ...plushie, age: Math.max(date.getFullYear() - year, 0) };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));
}

function ageLabel(age) {
  if (age <= 0) return "moins d'un an";
  return age === 1 ? "1 an" : `${age} ans`;
}

/* ---------- Le message ---------- */

/* Discord met en gras entre doubles astérisques, Slack entre simples. */
const BOLD = WEBHOOK_FORMAT === "slack" ? "*" : "**";

function buildText(birthdays) {
  const lines = birthdays.map(({ name, species, age }) => (
    age === 0
      ? `🎉 ${BOLD}${name}${BOLD} (${species}) fête son arrivée aujourd'hui !`
      : `🎂 ${BOLD}${name}${BOLD} (${species}) a ${ageLabel(age)} aujourd'hui !`
  ));

  const header = birthdays.length > 1
    ? `Aujourd'hui, ${birthdays.length} doudous font la fête :`
    : null;

  return [header, ...lines].filter(Boolean).join("\n");
}

/* ---------- Les photos ---------- */

/* L'étagère garde les photos en data-URI ; un webhook veut des octets. */
function decodePhoto(photo) {
  const match = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/=]+)$/.exec(
    typeof photo === "string" ? photo : "",
  );
  if (!match) return null;
  return {
    bytes: Buffer.from(match[2], "base64"),
    type: `image/${match[1]}`,
    extension: match[1] === "jpeg" ? "jpg" : match[1],
  };
}

/* Discord n'accepte pas plus de dix encarts, ni un message trop lourd : le jour
   d'une grande fête, les photos partent en plusieurs messages. */
const MAX_PHOTOS_PER_MESSAGE = 10;
const MAX_BYTES_PER_MESSAGE = 7 * 1024 * 1024;

function photoBatches(birthdays) {
  const batches = [];
  let batch = [];
  let bytes = 0;

  for (const plushie of birthdays) {
    const photo = decodePhoto(plushie.photo);
    if (!photo) continue;
    const full = batch.length === MAX_PHOTOS_PER_MESSAGE
      || bytes + photo.bytes.length > MAX_BYTES_PER_MESSAGE;
    if (batch.length && full) {
      batches.push(batch);
      batch = [];
      bytes = 0;
    }
    batch.push({ name: plushie.name, photo });
    bytes += photo.bytes.length;
  }

  if (batch.length) batches.push(batch);
  return batches;
}

/* Une photo ne s'affiche que si elle voyage avec le message : chaque doudou
   photographié reçoit son encart, qui pointe vers sa pièce jointe. */
function discordForm(text, batch) {
  const form = new FormData();
  const embeds = batch.map(({ name, photo }, index) => {
    const filename = `doudou-${index}.${photo.extension}`;
    form.append(`files[${index}]`, new Blob([photo.bytes], { type: photo.type }), filename);
    /* Le beurre de la palette, celui que le site réserve aux anniversaires. */
    return { title: name, color: 0xf7c948, image: { url: `attachment://${filename}` } };
  });

  form.append("payload_json", JSON.stringify({ content: text, embeds }));
  return form;
}

/* ---------- Le webhook ---------- */

async function post(payload, attempts = 3) {
  /* Un formulaire porte les photos ; le reste part en JSON. */
  const form = payload instanceof FormData;

  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(WEBHOOK_URL, {
        method: "POST",
        headers: form ? undefined : { "Content-Type": "application/json" },
        body: form ? payload : JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new Error(`${response.status} ${(await response.text()).slice(0, 200)}`);
      }
      return;
    } catch (error) {
      if (attempt >= attempts) throw error;
      log(`l'envoi a échoué (${error.message}), nouvel essai dans ${attempt * 5} s`);
      await sleep(attempt * 5000);
    }
  }
}

/* Slack n'accepte que du texte sur un webhook entrant : là-bas, les photos —
   qui ne vivent que dans l'étagère — ne peuvent pas suivre. */
async function send(birthdays) {
  const text = buildText(birthdays);
  if (WEBHOOK_FORMAT === "slack") return post({ text });

  const batches = photoBatches(birthdays);
  if (!batches.length) return post({ content: text });

  for (const [index, batch] of batches.entries()) {
    await post(discordForm(index === 0 ? text : "", batch));
  }
}

/* ---------- Mémoire des jours déjà annoncés ---------- */

async function lastAnnounced() {
  try {
    const parsed = JSON.parse(await fsp.readFile(STATE_FILE, "utf8"));
    return typeof parsed.lastAnnounced === "string" ? parsed.lastAnnounced : "";
  } catch {
    return "";
  }
}

async function rememberAnnounced(day) {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  const temporary = `${STATE_FILE}.${process.pid}.tmp`;
  await fsp.writeFile(temporary, JSON.stringify({ lastAnnounced: day }, null, 2), "utf8");
  await fsp.rename(temporary, STATE_FILE);
}

/* ---------- Le tour du jour ---------- */

async function announce(now) {
  const day = isoDate(now);
  const plushies = await fetchPlushies();
  const birthdays = birthdaysOn(plushies, now);

  if (!birthdays.length) {
    log(`${day} : aucun anniversaire parmi ${plushies.length} doudou(s).`);
    await rememberAnnounced(day);
    return 0;
  }

  const names = birthdays.map((p) => p.name).join(", ");
  if (!WEBHOOK_URL) {
    log(`${day} : ${names} — mais aucun WEBHOOK_URL n'est réglé, rien n'est envoyé.`);
    return 0;
  }

  await send(birthdays);
  log(`${day} : annoncé — ${names}`);
  await rememberAnnounced(day);
  return birthdays.length;
}

/* Une annonce ratée ne doit pas arrêter le service : elle sera retentée. */
async function tryAnnounce(now) {
  try {
    await announce(now);
  } catch (error) {
    console.error(`Anniversaires : le tour du ${isoDate(now)} a échoué — ${error.message}`);
  }
}

function nextRun(from) {
  const target = new Date(from);
  target.setHours(NOTIFY_AT.hour, NOTIFY_AT.minute, 0, 0);
  if (target <= from) target.setDate(target.getDate() + 1);
  return target;
}

async function main() {
  const at = `${String(NOTIFY_AT.hour).padStart(2, "0")}:${String(NOTIFY_AT.minute).padStart(2, "0")}`;

  if (RUN_NOW) {
    log(`envoi immédiat (--now), étagère lue sur ${APP_URL}`);
    await announce(new Date());
    return;
  }

  log(`en veille — un tour par jour à ${at}, étagère lue sur ${APP_URL}`);
  if (!WEBHOOK_URL) log("aucun WEBHOOK_URL dans .env : les anniversaires seront écrits ici, sans être envoyés.");

  /* Rattrapage : si la machine dormait à l'heure dite, l'anniversaire du jour
     est quand même annoncé au démarrage. */
  const now = new Date();
  const scheduled = new Date(now);
  scheduled.setHours(NOTIFY_AT.hour, NOTIFY_AT.minute, 0, 0);
  if (now >= scheduled && (await lastAnnounced()) !== isoDate(now)) {
    log("l'heure du jour est passée sans annonce : rattrapage.");
    await tryAnnounce(now);
  }

  for (;;) {
    const when = nextRun(new Date());
    log(`prochain tour le ${isoDate(when)} à ${at}.`);
    await sleep(when - Date.now());
    await tryAnnounce(new Date());
  }
}

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => process.exit(0));
}

main().catch((error) => {
  console.error(`Anniversaires : ${error.message}`);
  process.exit(1);
});
