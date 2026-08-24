/* Doudouventaire — le modèle et l'étagère, partagés par la page publique et
   l'admin. La page publique montre, l'admin montre et modifie. */

export const PHOTO_MAX_SIDE = 720;
export const NEW_SPECIES = "__new";
export const SEED_SPECIES = ["Dinosaure", "Vache", "Pingouin"];

/* Un doudou sans photo prend le visage de son espèce. */
const SPECIES_EMOJI = {
  dinosaure: "🦖", dino: "🦖", dragon: "🐲", tyrannosaure: "🦖",
  ours: "🧸", nounours: "🧸", ourson: "🧸", panda: "🐼", koala: "🐨",
  lapin: "🐰", chat: "🐱", chaton: "🐱", chien: "🐶", chiot: "🐶",
  pingouin: "🐧", manchot: "🐧", vache: "🐮", cochon: "🐷", mouton: "🐑",
  agneau: "🐑", elephant: "🐘", licorne: "🦄", cheval: "🐴", poney: "🐴",
  renard: "🦊", loup: "🐺", singe: "🐵", souris: "🐭", hamster: "🐹",
  grenouille: "🐸", tortue: "🐢", escargot: "🐌", abeille: "🐝",
  papillon: "🦋", poulpe: "🐙", pieuvre: "🐙", baleine: "🐳",
  dauphin: "🐬", requin: "🦈", poisson: "🐠", crabe: "🦀",
  canard: "🦆", poule: "🐔", poussin: "🐤", oiseau: "🐦", hibou: "🦉",
  chouette: "🦉", pigeon: "🐦", flamant: "🦩", paon: "🦚",
  girafe: "🦒", lion: "🦁", tigre: "🐯", zebre: "🦓", rhinoceros: "🦏",
  hippopotame: "🦛", chameau: "🐫", kangourou: "🦘", paresseux: "🦥",
  loutre: "🦦", herisson: "🦔", ecureuil: "🐿️", raton: "🦝",
  castor: "🦫", alpaga: "🦙", lama: "🦙", chevre: "🐐", ane: "🫏",
  robot: "🤖", extraterrestre: "👽", fantome: "👻", etoile: "⭐",
  nuage: "☁️", soleil: "🌞", lune: "🌙", coeur: "❤️", fleur: "🌸",
};

export const el = (id) => document.getElementById(id);

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

/* Une photo vient de <canvas> ; tout autre contenu (fichier importé bricolé)
   est écarté avant d'atterrir dans un attribut src. */
export function safePhoto(photo) {
  return typeof photo === "string" && /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(photo)
    ? photo
    : null;
}

export function isPlushie(entry) {
  return entry && typeof entry.name === "string" && typeof entry.species === "string"
    && typeof entry.birthday === "string" && /^\d{4}-\d{2}-\d{2}$/.test(entry.birthday);
}

/* ---------- Dates et anniversaires ---------- */

export function today() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export function todayIso() {
  const ref = today();
  return `${ref.getFullYear()}-${String(ref.getMonth() + 1).padStart(2, "0")}-${String(ref.getDate()).padStart(2, "0")}`;
}

function parseBirthday(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d };
}

export function ageOn(iso, ref) {
  const b = parseBirthday(iso);
  let age = ref.getFullYear() - b.y;
  const month = ref.getMonth() + 1;
  if (month < b.m || (month === b.m && ref.getDate() < b.d)) age--;
  return Math.max(age, 0);
}

export function daysUntilBirthday(iso, ref) {
  const b = parseBirthday(iso);
  let next = new Date(ref.getFullYear(), b.m - 1, b.d);
  if (next < ref) next = new Date(ref.getFullYear() + 1, b.m - 1, b.d);
  return Math.round((next - ref) / 86400000);
}

/* L'âge fêté au prochain anniversaire. */
function ageAtNextBirthday(iso, ref) {
  return ageOn(iso, ref) + (daysUntilBirthday(iso, ref) === 0 ? 0 : 1);
}

function ageLabel(age) {
  if (age <= 0) return "moins d'un an";
  return age === 1 ? "1 an" : `${age} ans`;
}

function shortDate(iso) {
  const b = parseBirthday(iso);
  return `${String(b.d).padStart(2, "0")}·${String(b.m).padStart(2, "0")}·${b.y}`;
}

function longDate(iso) {
  const b = parseBirthday(iso);
  return new Date(b.y, b.m - 1, b.d).toLocaleDateString("fr-FR", { day: "numeric", month: "long" });
}

/* ---------- Espèces ---------- */

function normalizeSpecies(species) {
  return species.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/* Clé de regroupement : « Lapin » et « Lapins » sont la même espèce. */
export function speciesKey(species) {
  return normalizeSpecies(species).replace(/s$/, "");
}

export function speciesEmoji(species) {
  const exact = normalizeSpecies(species);
  return SPECIES_EMOJI[exact] || SPECIES_EMOJI[speciesKey(species)] || "\u{1F9F6}";
}

/* ---------- Toast ---------- */

let toastTimer;
export function toast(message) {
  const node = el("toast");
  node.textContent = message;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, 4000);
}

/* ---------- Confettis ---------- */

function fireConfetti() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const colors = ["#b8436b", "#f7c948", "#7c9a82", "#7fb2e5", "#fffdf8"];
  const layer = document.createElement("div");
  layer.className = "confetti";
  layer.setAttribute("aria-hidden", "true");

  for (let i = 0; i < 70; i++) {
    const piece = document.createElement("span");
    piece.style.left = `${Math.random() * 100}vw`;
    piece.style.background = colors[i % colors.length];
    piece.style.animationDuration = `${2.6 + Math.random() * 2.2}s`;
    piece.style.animationDelay = `${Math.random() * 1.2}s`;
    layer.append(piece);
  }

  document.body.append(layer);
  setTimeout(() => layer.remove(), 6500);
}

/* ---------- L'étagère ---------- */

/* La vue commune : le compte, la mise en avant, les filtres et les cartes.
   `editable` ajoute les boutons Modifier / Supprimer sous chaque carte. */
export function createShelf({ editable = false, onEdit, onDelete } = {}) {
  let plushies = [];
  const filters = { query: "", species: "all", sort: "birthday" };
  let confettiFired = false;

  function render() {
    const ref = today();
    const decorated = plushies.map((p) => ({
      ...p,
      days: daysUntilBirthday(p.birthday, ref),
      age: ageOn(p.birthday, ref),
      nextAge: ageAtNextBirthday(p.birthday, ref),
    }));

    el("tally").textContent = tallyText(decorated);
    el("welcome").hidden = decorated.length > 0;
    el("shelfSection").hidden = decorated.length === 0;

    renderSpotlight(decorated);
    renderChips(decorated);
    renderGrid(decorated);
  }

  function tallyText(list) {
    if (!list.length) return "";
    const species = new Set(list.map((p) => speciesKey(p.species))).size;
    const doudous = `${list.length} doudou${list.length > 1 ? "s" : ""}`;
    return `${doudous} · ${species} espèce${species > 1 ? "s" : ""}`;
  }

  function renderSpotlight(list) {
    const spotlight = el("spotlight");
    if (!list.length) {
      spotlight.hidden = true;
      return;
    }

    const soonest = [...list].sort((a, b) => a.days - b.days || a.name.localeCompare(b.name, "fr"));
    const star = soonest[0];
    const alsoToday = soonest.filter((p) => p.days === 0 && p !== star);
    const isToday = star.days === 0;

    spotlight.hidden = false;
    spotlight.classList.toggle("spotlight--today", isToday);

    let headline;
    if (isToday) {
      headline = star.nextAge === 0
        ? `${star.name} est arrivé aujourd'hui !`
        : `${star.name} a ${ageLabel(star.nextAge)} aujourd'hui !`;
    } else {
      const when = star.days === 1 ? "demain" : `dans ${star.days} jours`;
      headline = `${star.name} aura ${ageLabel(star.nextAge)} ${when}`;
    }

    const also = alsoToday.length
      ? `<p class="spotlight__also">Aussi en fête : ${alsoToday.map((p) => escapeHtml(p.name)).join(", ")}.</p>`
      : (isToday ? "" : `<p class="spotlight__also">Le ${longDate(star.birthday)}.</p>`);

    spotlight.innerHTML = `
      <div class="spotlight__portrait">${portrait(star)}</div>
      <div class="spotlight__text">
        <p class="spotlight__eyebrow">${isToday ? "Aujourd'hui" : "Prochain anniversaire"}</p>
        <h2 class="spotlight__headline">${escapeHtml(headline)}</h2>
        ${also}
      </div>`;

    if (isToday && !confettiFired) {
      confettiFired = true;
      fireConfetti();
    }
  }

  function portrait(plush) {
    const photo = safePhoto(plush.photo);
    return photo
      ? `<img src="${photo}" alt="${escapeHtml(plush.name)}">`
      : `<span aria-hidden="true">${speciesEmoji(plush.species)}</span>`;
  }

  function renderChips(list) {
    const counts = new Map();
    for (const plush of list) {
      const label = plush.species.trim();
      const key = speciesKey(label);
      const entry = counts.get(key) || { label, count: 0 };
      entry.count++;
      counts.set(key, entry);
    }

    const known = [...counts.keys()];
    if (filters.species !== "all" && !known.includes(filters.species)) filters.species = "all";

    const chips = [`<button class="chip" type="button" data-species="all" aria-pressed="${filters.species === "all"}">Tous<span class="chip__count">${list.length}</span></button>`];
    for (const [key, { label, count }] of [...counts].sort((a, b) => b[1].count - a[1].count || a[1].label.localeCompare(b[1].label, "fr"))) {
      chips.push(`<button class="chip" type="button" data-species="${escapeHtml(key)}" aria-pressed="${filters.species === key}">${speciesEmoji(label)} ${escapeHtml(label)}<span class="chip__count">${count}</span></button>`);
    }
    el("chips").innerHTML = counts.size > 1 ? chips.join("") : "";
  }

  function renderGrid(list) {
    const query = filters.query.trim().toLowerCase();
    const visible = list.filter((plush) => {
      const matchesSpecies = filters.species === "all" || speciesKey(plush.species) === filters.species;
      const haystack = `${plush.name} ${plush.species}`.toLowerCase();
      return matchesSpecies && (!query || haystack.includes(query));
    });

    visible.sort((a, b) => {
      switch (filters.sort) {
        case "name": return a.name.localeCompare(b.name, "fr");
        case "age": return a.birthday.localeCompare(b.birthday);
        case "added": return (b.addedAt || "").localeCompare(a.addedAt || "");
        default: return a.days - b.days || a.name.localeCompare(b.name, "fr");
      }
    });

    el("noMatch").hidden = visible.length > 0 || list.length === 0;
    el("grid").innerHTML = visible.map(cardHtml).join("");
  }

  function cardHtml(plush) {
    const isBirthday = plush.days === 0;
    const photo = safePhoto(plush.photo);
    const ribbon = isBirthday
      ? `<p class="card__ribbon">🎉 ${escapeHtml(plush.nextAge === 0 ? "Arrivé aujourd'hui" : `${ageLabel(plush.nextAge)} aujourd'hui`)}</p>`
      : "";
    const actions = editable
      ? `<div class="card__actions">
        <button class="link-btn" type="button" data-edit="${escapeHtml(plush.id)}">Modifier</button>
        <button class="link-btn" type="button" data-delete="${escapeHtml(plush.id)}">Supprimer</button>
      </div>`
      : "";

    return `
      <li class="card${isBirthday ? " card--birthday" : ""}">
        <div class="card__window">
          ${photo
            ? `<img src="${photo}" alt="${escapeHtml(plush.name)}">`
            : `<span class="card__emoji" aria-hidden="true">${speciesEmoji(plush.species)}</span>`}
          ${ribbon}
        </div>
        <h3 class="card__name">${escapeHtml(plush.name)}</h3>
        <p class="card__meta">${escapeHtml(plush.species)}<br>${shortDate(plush.birthday)} · ${ageLabel(plush.age)}</p>
        ${actions}
      </li>`;
  }

  el("search").addEventListener("input", (event) => {
    filters.query = event.target.value;
    render();
  });
  el("sort").addEventListener("change", (event) => {
    filters.sort = event.target.value;
    render();
  });
  el("chips").addEventListener("click", (event) => {
    const chip = event.target.closest("[data-species]");
    if (!chip) return;
    filters.species = chip.dataset.species;
    render();
  });

  if (editable) {
    el("grid").addEventListener("click", (event) => {
      const editButton = event.target.closest("[data-edit]");
      if (editButton) {
        onEdit(plushies.find((p) => p.id === editButton.dataset.edit));
        return;
      }
      const deleteButton = event.target.closest("[data-delete]");
      if (deleteButton) onDelete(plushies.find((p) => p.id === deleteButton.dataset.delete));
    });
  }

  return {
    render,
    get plushies() { return plushies; },
    setPlushies(list) {
      plushies = Array.isArray(list) ? list.filter(isPlushie) : [];
      render();
    },
  };
}

/* Les espèces proposées : les trois de départ, plus toutes celles qu'un doudou
   porte déjà. Ajouter une espèce, c'est ajouter un doudou qui la porte. */
export function knownSpecies(plushies) {
  const byKey = new Map();
  for (const label of [...SEED_SPECIES, ...plushies.map((p) => p.species)]) {
    const key = speciesKey(label);
    if (!byKey.has(key)) byKey.set(key, label.trim());
  }
  return [...byKey.values()].sort((a, b) => a.localeCompare(b, "fr"));
}

/* Une espèce déjà connue garde son orthographe, une nouvelle prend sa majuscule :
   « pingouin » saisi à la main ne crée pas un doublon de « Pingouin ». */
export function canonicalSpecies(input, plushies) {
  const key = speciesKey(input);
  const known = knownSpecies(plushies).find((label) => speciesKey(label) === key);
  if (known) return known;
  const trimmed = input.trim();
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

/* ---------- L'API ---------- */

export async function api(method, path, body) {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let payload = {};
  try {
    payload = await response.json();
  } catch { /* une réponse vide reste une réponse */ }
  if (!response.ok) {
    const error = new Error(payload.error || "Le serveur a refusé la demande.");
    error.status = response.status;
    throw error;
  }
  return payload;
}
