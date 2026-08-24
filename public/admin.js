/* Doudouventaire — l'admin : la même étagère, mais on peut y poser, modifier et
   retirer des doudous. Tout passe par le serveur, derrière le mot de passe. */

import {
  api, canonicalSpecies, createShelf, el, escapeHtml, knownSpecies,
  NEW_SPECIES, PHOTO_MAX_SIDE, safePhoto, speciesEmoji, toast, todayIso,
} from "./shared.js";

const LEGACY_KEY = "doudouventaire.v1";

let draftId = null;
let draftPhoto = null;

const shelf = createShelf({ editable: true, onEdit: openSheet, onDelete: removePlushie });

/* ---------- Connexion ---------- */

async function showApp() {
  el("loginGate").hidden = true;
  el("adminApp").hidden = false;
  el("mastheadActions").hidden = false;
  await refresh();
  offerLegacyImport();
}

function showLogin() {
  el("loginGate").hidden = false;
  el("adminApp").hidden = true;
  el("mastheadActions").hidden = true;
  el("user").focus();
}

async function submitLogin(event) {
  event.preventDefault();
  const error = el("loginError");
  error.hidden = true;
  try {
    await api("POST", "/api/session", {
      user: el("user").value,
      password: el("password").value,
    });
    el("password").value = "";
    await showApp();
  } catch (failure) {
    error.textContent = failure.message;
    error.hidden = false;
    el("password").select();
  }
}

async function logout() {
  try {
    await api("DELETE", "/api/session");
  } finally {
    showLogin();
  }
}

/* Une session expirée en cours de route ramène à la connexion plutôt que de
   laisser un bouton qui ne répond plus. */
function handleFailure(failure, fallback) {
  if (failure.status === 401) {
    showLogin();
    toast("La session a expiré. Reconnecte-toi.");
    return;
  }
  toast(failure.message || fallback);
}

/* ---------- Étagère ---------- */

async function refresh() {
  const { plushies } = await api("GET", "/api/plushies");
  shelf.setPlushies(plushies);
}

async function removePlushie(plush) {
  if (!confirm(`Retirer ${plush.name} de l'étagère ?`)) return;
  try {
    await api("DELETE", `/api/plushies/${encodeURIComponent(plush.id)}`);
    await refresh();
    toast(`${plush.name} a quitté l'étagère.`);
  } catch (failure) {
    handleFailure(failure, "Ce doudou n'a pas pu être retiré.");
  }
}

/* ---------- Formulaire ---------- */

function openSheet(plush) {
  draftId = plush ? plush.id : null;
  draftPhoto = plush ? safePhoto(plush.photo) : null;

  el("sheetTitle").textContent = plush ? `Modifier ${plush.name}` : "Nouveau doudou";
  el("saveButton").textContent = plush ? "Enregistrer" : "Ajouter le doudou";
  el("name").value = plush ? plush.name : "";
  renderSpeciesOptions(plush ? plush.species : "");
  el("newSpecies").value = "";
  toggleNewSpecies(false);
  el("birthday").value = plush ? plush.birthday : "";
  el("birthday").max = todayIso();
  el("sheetError").hidden = true;
  el("photo").value = "";
  renderPhotoPreview();

  el("sheet").showModal();
  el("name").focus();
}

function renderSpeciesOptions(selected) {
  const options = ['<option value="" disabled>Choisir une espèce</option>'];
  const known = knownSpecies(shelf.plushies);
  for (const label of known) {
    options.push(`<option value="${escapeHtml(label)}">${speciesEmoji(label)} ${escapeHtml(label)}</option>`);
  }
  options.push(`<option value="${NEW_SPECIES}">+ Nouvelle espèce…</option>`);
  el("species").innerHTML = options.join("");
  el("species").value = known.includes(selected) ? selected : "";
}

function toggleNewSpecies(show) {
  el("newSpeciesField").hidden = !show;
  el("newSpecies").required = show;
  if (show) el("newSpecies").focus();
}

/* L'espèce en cours de saisie, qu'elle vienne de la liste ou du champ libre. */
function currentSpecies() {
  const choice = el("species").value;
  return choice === NEW_SPECIES ? el("newSpecies").value.trim() : choice;
}

function renderPhotoPreview() {
  el("photoPreview").innerHTML = draftPhoto
    ? `<img src="${draftPhoto}" alt="">`
    : `<span>${currentSpecies() ? speciesEmoji(currentSpecies()) : "📷"}</span>`;
  el("photoClear").hidden = !draftPhoto;
  el("photoButton").textContent = draftPhoto ? "Changer la photo" : "Choisir une photo";
}

function showSheetError(message) {
  const error = el("sheetError");
  error.textContent = message;
  error.hidden = false;
}

async function submitSheet(event) {
  event.preventDefault();
  const name = el("name").value.trim();
  const chosen = currentSpecies();
  const birthday = el("birthday").value;

  if (!name || !chosen || !birthday) {
    showSheetError("Il manque le nom, l'espèce ou la date de naissance.");
    return;
  }
  if (birthday > todayIso()) {
    showSheetError("Cette date est dans le futur. Choisis le jour où le doudou est arrivé.");
    return;
  }

  const body = { name, species: canonicalSpecies(chosen, shelf.plushies), birthday, photo: draftPhoto };
  const saveButton = el("saveButton");
  saveButton.disabled = true;
  try {
    if (draftId) await api("PUT", `/api/plushies/${encodeURIComponent(draftId)}`, body);
    else await api("POST", "/api/plushies", body);
    await refresh();
    el("sheet").close();
    toast(draftId ? `${name} est à jour.` : `${name} rejoint l'étagère.`);
  } catch (failure) {
    if (failure.status === 401) {
      el("sheet").close();
      handleFailure(failure);
      return;
    }
    showSheetError(failure.message);
  } finally {
    saveButton.disabled = false;
  }
}

/* ---------- Photo ---------- */

async function handlePhoto(file) {
  if (!file) return;
  try {
    draftPhoto = await shrinkImage(file);
    renderPhotoPreview();
  } catch {
    showSheetError("Cette image n'a pas pu être lue. Essaie un JPEG ou un PNG.");
  }
}

function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(image.width * scale);
      canvas.height = Math.round(image.height * scale);
      canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image illisible"));
    };
    image.src = url;
  });
}

/* ---------- Export / import ---------- */

function exportInventory() {
  const blob = new Blob([JSON.stringify({ plushies: shelf.plushies }, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `doudouventaire-${todayIso()}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function importPlushies(incoming, emptyMessage) {
  try {
    const { added } = await api("POST", "/api/import", { plushies: incoming });
    await refresh();
    toast(added
      ? `${added} doudou${added > 1 ? "s" : ""} ajouté${added > 1 ? "s" : ""}.`
      : emptyMessage);
    return added;
  } catch (failure) {
    handleFailure(failure, "L'import a échoué.");
    return 0;
  }
}

async function importFromFile(file) {
  let incoming;
  try {
    const parsed = JSON.parse(await file.text());
    incoming = Array.isArray(parsed) ? parsed : parsed.plushies;
  } catch {
    toast("Ce fichier n'est pas un export Doudouventaire.");
    return;
  }
  if (!Array.isArray(incoming) || !incoming.length) {
    toast("Ce fichier ne contient aucun doudou.");
    return;
  }
  await importPlushies(incoming, "Ces doudous sont déjà sur l'étagère.");
}

/* Les doudous d'avant le serveur dorment encore dans le localStorage de ce
   navigateur : on propose de les faire monter, une fois. */
function legacyPlushies() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LEGACY_KEY) || "null");
    const list = Array.isArray(parsed) ? parsed : parsed?.plushies;
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function offerLegacyImport() {
  const legacy = legacyPlushies();
  const banner = el("legacy");
  if (!legacy.length) {
    banner.hidden = true;
    return;
  }
  banner.hidden = false;
  el("legacyCount").textContent = `${legacy.length} doudou${legacy.length > 1 ? "s" : ""}`;
}

async function runLegacyImport() {
  const legacy = legacyPlushies();
  if (!legacy.length) return;
  const added = await importPlushies(legacy, "Ces doudous sont déjà sur l'étagère.");
  if (added || confirm("Ces doudous sont déjà sur le serveur. Oublier la copie de ce navigateur ?")) {
    localStorage.removeItem(LEGACY_KEY);
    el("legacy").hidden = true;
  }
}

/* Exemples : Rex fête son anniversaire aujourd'hui, pour que la mise en avant
   se montre d'elle-même. */
async function addDemo() {
  const now = new Date();
  const md = `${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  await importPlushies([
    { name: "Rex", species: "Dinosaure", birthday: `${now.getFullYear() - 7}-${md}` },
    { name: "Praline", species: "Vache", birthday: "2021-07-04" },
    { name: "Pilou", species: "Pingouin", birthday: "2023-11-28" },
  ], "Ces exemples sont déjà sur l'étagère.");
}

/* ---------- Câblage ---------- */

el("loginForm").addEventListener("submit", submitLogin);
el("logoutButton").addEventListener("click", logout);

el("addButton").addEventListener("click", () => openSheet(null));
el("welcomeAdd").addEventListener("click", () => openSheet(null));
el("cancelButton").addEventListener("click", () => el("sheet").close());
el("form").addEventListener("submit", submitSheet);

el("photoButton").addEventListener("click", () => el("photo").click());
el("photo").addEventListener("change", (event) => handlePhoto(event.target.files[0]));
el("photoClear").addEventListener("click", () => {
  draftPhoto = null;
  el("photo").value = "";
  renderPhotoPreview();
});
el("species").addEventListener("change", () => {
  toggleNewSpecies(el("species").value === NEW_SPECIES);
  if (!draftPhoto) renderPhotoPreview();
});
el("newSpecies").addEventListener("input", () => { if (!draftPhoto) renderPhotoPreview(); });

el("exportButton").addEventListener("click", exportInventory);
el("importButton").addEventListener("click", () => el("importFile").click());
el("importFile").addEventListener("change", (event) => {
  if (event.target.files[0]) importFromFile(event.target.files[0]);
  event.target.value = "";
});
el("legacyImport").addEventListener("click", runLegacyImport);
el("demoButton").addEventListener("click", addDemo);

/* Un cookie encore valide évite de redemander le mot de passe. */
api("GET", "/api/session")
  .then(({ authenticated }) => (authenticated ? showApp() : showLogin()))
  .catch(showLogin);
