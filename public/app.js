/* Doudouventaire — la page publique : l'étagère se regarde, elle ne se modifie
   pas. Les doudous viennent du serveur ; l'admin est le seul à les poser. */

import { api, createShelf, toast } from "./shared.js";

/* L'étagère reste souvent ouverte, sur une tablette ou dans une fenêtre à côté :
   elle va rechercher d'elle-même les doudous ajoutés depuis l'espace privé. */
const POLL_MS = 10000;

const shelf = createShelf();
let revision = null;

async function refresh() {
  try {
    const payload = await api("GET", "/api/plushies");
    if (payload.revision === revision) return;
    revision = payload.revision;
    shelf.setPlushies(payload.plushies);
  } catch {
    /* Une étagère déjà affichée ne se plaint pas d'un aller-retour manqué : elle
       gardera ce qu'elle montre et retentera au tour suivant. */
    if (revision === null) toast("L'inventaire n'a pas pu être chargé. Réessaie dans un instant.");
  }
}

setInterval(() => {
  if (document.visibilityState === "visible") refresh();
}, POLL_MS);

/* Et sans attendre le prochain tour en revenant sur l'onglet. */
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") refresh();
});

refresh();
