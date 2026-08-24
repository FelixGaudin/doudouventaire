# Doudouventaire

L'inventaire des doudous : nom, espèce, date de naissance, photo — et une mise en
avant des anniversaires.

Deux pages : **l'étagère publique**, qui se regarde, et **l'espace privé**, sous
mot de passe, où les doudous s'ajoutent.

## Démarrer

```sh
cp .env.example .env      # puis choisis l'identifiant et le mot de passe
docker compose up -d
```

- L'étagère publique : <http://localhost:8000>
- L'espace privé : <http://localhost:8000/admin>

`docker compose down` pour arrêter, `docker compose logs -f` pour regarder.

Sans Docker, c'est le même serveur, lancé à la main — Node 20 ou plus récent :

```sh
node server.js            # lit le .env du dossier
```

Aucune dépendance, aucune étape de build, aucun `npm install` : le serveur
n'utilise que les modules de Node, et les pages que le navigateur sait déjà lire.
Les fichiers sont montés tels quels dans le conteneur, donc une modification est
visible au rechargement de la page ; seul un changement de `server.js` demande un
`docker compose restart`.

## Le mot de passe

Dans `.env`, qui n'est pas versionné :

```sh
ADMIN_USER=maman
ADMIN_PASSWORD=un-mot-de-passe-a-toi
SECURE_COOKIES=false      # true seulement derrière un vrai https
```

Sans ces deux valeurs, le serveur refuse de démarrer plutôt que de laisser
l'espace privé ouvert. La session dure douze heures et tient dans un cookie
`HttpOnly` ; après huit essais manqués, l'adresse attend dix minutes.

Si le site devient accessible depuis l'extérieur, mets-le derrière un https
(reverse proxy) et passe `SECURE_COOKIES=true` : sans cela, le mot de passe et le
cookie de session voyagent en clair.

## Utilisation

Tout ce qui suit se passe dans l'espace privé. La page publique, elle, se
contente de montrer : chercher, filtrer par espèce et trier, sans rien modifier.
Elle se tient à jour toute seule — un doudou ajouté dans l'espace privé apparaît
sur l'étagère en une dizaine de secondes, sans recharger la page, même si elle est
restée ouverte sur une tablette.

- **Ajouter un doudou** — bouton en haut à droite. Nom, espèce, date de naissance
  et photo (facultative, redimensionnée à 720 px avant enregistrement).
- **Espèces** — la liste déroulante propose *Dinosaure*, *Vache* et *Pingouin* au
  départ. Pour une espèce absente, choisis **« + Nouvelle espèce… »** et donne-lui
  un nom : elle rejoint la liste et y reste tant qu'un doudou la porte. Une espèce
  déjà connue saisie autrement (`pingouin`, `PINGOUINS`) est ramenée sur
  l'orthographe existante, sans créer de doublon.
- **Anniversaires** — le bandeau du haut annonce le prochain anniversaire, avec
  l'âge. Le jour J, il passe en jaune, la carte du doudou se pare d'un ruban et
  des confettis tombent.
- **Sans photo** — la carte prend l'emoji de l'espèce (`Dinosaure` → 🦖,
  `Vache` → 🐮). Une centaine d'espèces sont reconnues, pluriels et accents
  compris, donc une espèce ajoutée à la main trouve presque toujours son emoji.
- **Chercher, filtrer, trier** — par nom ou espèce, par espèce en un clic, et par
  prochain anniversaire, nom, âge ou date d'ajout.
- **Modifier / Supprimer** — sous chaque carte.

## Les anniversaires dans un agenda

Le site publie les anniversaires en `.ics` :

```
http://localhost:8000/anniversaires.ics
```

Deux façons de s'en servir :

- **Ouvrir le lien** — l'agenda propose d'ajouter les évènements. C'est une copie,
  figée au moment du téléchargement.
- **Coller l'adresse dans un agenda** (Google Agenda : *Autres agendas* → *À partir
  de l'URL* ; Apple Calendar : *Fichier* → *Nouvel abonnement*) — l'agenda revient
  la lire tout seul, et suit les ajouts, modifications et suppressions.

Un doudou donne un évènement d'une journée qui revient chaque année, à la date de
naissance, intitulé « Anniversaire de Rex », avec l'espèce en description. Comme
l'identifiant de l'évènement ne change pas, un doudou renommé est mis à jour dans
l'agenda au lieu d'y apparaître deux fois.

Le lien est public, comme l'étagère : qui peut voir le site peut lire le
calendrier. Il n'y a pas de rappel (`VALARM`) dans les évènements — la plupart des
agendas ignorent ceux d'un calendrier auquel on s'abonne, et chacun règle ses
notifications comme il veut.

## Où sont enregistrés les doudous

Dans `data/doudous.json`, sur le serveur, photos comprises. C'est le seul fichier
à sauvegarder, et le seul que le conteneur peut écrire. Les doudous ne dépendent
plus du navigateur : ils sont les mêmes pour tout le monde.

**Exporter** télécharge un `.json` de tout l'inventaire — pratique avant un grand
ménage. **Importer** relit un tel fichier et ajoute ce qui manque (les doublons
nom + date de naissance sont ignorés).

### Les doudous d'avant

Dans les versions précédentes, l'inventaire vivait dans le `localStorage` du
navigateur, sous la clé `doudouventaire.v1`. S'il en reste, l'espace privé le
remarque et propose, en haut de page, de faire monter ces doudous sur l'étagère.
Ouvre `/admin` avec le navigateur qui les gardait.

## Annoncer les anniversaires

Un second service, `anniversaires`, fait un tour par jour et envoie un message sur
un webhook quand un doudou fête son anniversaire. Sans anniversaire, rien n'est
envoyé.

Sur Discord : *Paramètres du salon* → *Intégrations* → *Webhooks* → *Copier
l'URL*, puis dans `.env` :

```sh
WEBHOOK_URL=https://discord.com/api/webhooks/…
WEBHOOK_FORMAT=discord             # ou slack
NOTIFY_AT=09:00                    # l'heure du tour
TZ=Europe/Brussels                 # le fuseau dans lequel la lire
PUBLIC_URL=http://localhost:8000   # lien ajouté au message, facultatif
```

Puis `docker compose up -d`. Pour l'essayer sans attendre l'heure :

```sh
docker compose run --rm anniversaires node notify.js --now
docker compose logs -f anniversaires
```

```
Aujourd'hui, 2 doudous font la fête :
🎂 **Pêche** (Dinosaure) a 4 ans aujourd'hui !
🎂 **Zébulon** (Vache) a 5 ans aujourd'hui !
👉 http://localhost:8000
```

`TZ` compte : sans lui le conteneur vit en UTC, et `09:00` tomberait à 11:00 en
été. Le jour déjà annoncé est noté dans `data/annonces.json`, donc un redémarrage
n'envoie pas deux fois le même message — et si la machine dormait à l'heure dite,
l'annonce est rattrapée au réveil. Sans `WEBHOOK_URL`, les anniversaires sont
écrits dans le journal sans être envoyés.

## Les fichiers

```
server.js              le serveur : pages, API, session, stockage, calendrier
notify.js              le guetteur : un tour par jour, un message sur webhook
public/                tout ce que le navigateur reçoit
  index.html  app.js     l'étagère publique
  admin.html  admin.js   l'espace privé : connexion, ajout, modification
  shared.js              le modèle et les cartes, communs aux deux pages
  style.css              toute la mise en forme
tools/
  ical-vers-doudous.py   convertit un export d'agenda en fichier d'import
data/                  les doudous (et le dernier jour annoncé) — à sauvegarder
sauvegardes/           les exports de l'inventaire
docker-compose.yml     le lancement
.env                   l'identifiant et le mot de passe (non versionné)
```

`data/`, `sauvegardes/` et `.env` ne sont pas versionnés : les deux premiers
contiennent les doudous, le dernier le mot de passe.

Le serveur ne sert que le contenu de `public/`, et uniquement les extensions
qu'il connaît : `server.js`, `.env` et `data/` ne sont pas accessibles depuis le
navigateur.

L'API, si tu veux la lire directement : `GET /api/plushies` et
`GET /anniversaires.ics` sont publiques, tout le reste (`POST`, `PUT`, `DELETE`,
`/api/import`) demande la session.
