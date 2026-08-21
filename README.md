# TLM Games — bibliothèque de jeux avec comptes &amp; synchronisation

Boutique + bibliothèque façon Steam/Roblox : on crée un compte, on ajoute des
jeux à sa bibliothèque, et elle se **synchronise automatiquement** sur tous
les appareils où l'on se connecte. Sans compte, ça fonctionne quand même en
mode "invité" (stockage local au navigateur uniquement).

## Structure

```
tlmgames/
  server/              → le backend (comptes, mots de passe, bibliothèque)
    server.js
    db.js
    package.json
    .env.example
    data/db.json        → créé automatiquement au premier lancement
  public/              → le site servi par le backend
    index.html          → boutique + bibliothèque + écrans de connexion
    studio.html          → TLM Games Studio (créer / importer / soumettre des jeux)
    admin.html            → panel admin/modération (staff uniquement)
    support.html           → support (contact staff, vérification, appel de ban)
    cgu.html                → conditions d'utilisation
    tlm-engine.js             → mini bibliothèque 2D utilisée par les jeux créés dans le Studio
    games/
      royaumes-colonies/  → le jeu officiel fourni
      community/           → jeux publiés par les utilisateurs (créé automatiquement)
```

Contrairement à la version précédente (statique), ce projet a besoin d'un
**serveur Node.js** qui tourne en continu, car les comptes et mots de passe
ne peuvent pas être gérés côté navigateur uniquement.

## Lancer en local (pour tester)

Il faut [Node.js](https://nodejs.org) 18 ou plus installé sur ta machine.

```bash
cd server
npm install
cp .env.example .env
```

Ouvre `.env` et remplace `JWT_SECRET` par une vraie valeur aléatoire, par
exemple générée avec :

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Puis lance le serveur :

```bash
npm start
```

Ouvre ensuite `http://localhost:3000` dans le navigateur. Le site (boutique,
bibliothèque, jeu) et l'API des comptes sont servis par le même serveur.

## Déployer en ligne (accessible depuis n'importe où)

Ce backend est un service Node.js classique, il ne fonctionne **pas** sur un
hébergement purement statique (GitHub Pages, Netlify statique, etc.) — il lui
faut un hébergement capable d'exécuter du Node.js en continu. Options simples
et gratuites/pas chères pour démarrer :

- **Render.com** : "New Web Service" → connecter le dossier `server/` →
  build command `npm install`, start command `npm start` → ajouter la
  variable d'environnement `JWT_SECRET` dans les réglages.
- **Railway.app** : même principe, déploiement en un clic depuis un repo Git.
- **Un VPS perso** (OVH, Hetzner...) : installer Node.js, copier le dossier
  `tlmgames/`, lancer avec `npm start` (idéalement derrière `pm2` pour qu'il
  redémarre automatiquement) et un reverse-proxy Nginx pour le nom de
  domaine + HTTPS.

Dans tous les cas : ne jamais committer le fichier `.env` (il contient le
secret qui signe les connexions), et définir `JWT_SECRET` comme variable
d'environnement sur la plateforme choisie.

## Comment marche la synchronisation

- À l'inscription/connexion, le serveur crée un **jeton de connexion (JWT)**
  valable 30 jours, stocké dans le navigateur.
- La bibliothèque n'est plus stockée uniquement en local : elle est
  enregistrée côté serveur, liée à l'identifiant du compte. En se
  connectant sur un autre appareil, on retrouve exactement les mêmes jeux
  installés.
- Si des jeux avaient été ajoutés **avant** de créer un compte (mode
  invité), ils sont automatiquement fusionnés dans le compte dès la première
  connexion — rien n'est perdu.
- Les mots de passe ne sont jamais stockés en clair : ils sont hashés avec
  `bcrypt` avant d'être enregistrés.

## Ajouter un jeu "officiel" à la main

1. Copier le dossier du jeu (avec son `index.html`) dans
   `public/games/<identifiant-du-jeu>/`.
2. Dans `public/index.html`, ajouter une entrée dans le tableau
   `OFFICIAL_CATALOG` en haut du `<script>` :

```js
{
  id: "mon-nouveau-jeu",
  title: "Titre du jeu",
  genre: "Genre",
  desc: "Description courte.",
  path: "games/mon-nouveau-jeu/index.html",
  locked: false,
  community: false
}
```

## TLM Games Studio — créer et publier des jeux depuis le site

Accessible via le bouton **Studio** en haut du site (`studio.html`), réservé
aux personnes connectées. Deux façons d'ajouter un jeu à la boutique :

**1. Importer un jeu déjà codé**
On dépose un fichier `.zip` contenant un `index.html` (comme le jeu
"Royaumes & Colonies" fourni au départ). Le serveur le dézippe, le range dans
`public/games/community/<id>/`, et le publie automatiquement dans la
Boutique — inutile de toucher au code du site.

**2. Créer un jeu 2D directement dans le navigateur**
Un éditeur de code (avec aperçu en direct) permet d'écrire un jeu en
JavaScript, sans avoir à gérer soi-même le `<canvas>`, la boucle d'animation
ou le clavier. Tout ça est fourni par une petite bibliothèque maison,
**TLM Engine** (`public/tlm-engine.js`), avec des fonctions simples :

```js
const ctx = TLM.init(480, 320, "#111");   // crée l'écran de jeu
TLM.isDown("ArrowLeft")                    // touche appuyée ?
TLM.rect(x, y, w, h, "#e8c96a")            // dessiner un rectangle
TLM.circle(x, y, r, "#fff")                // dessiner un cercle
TLM.overlap(rectA, rectB)                  // détecter une collision
TLM.loop((dt) => { /* logique du jeu */ }) // boucle de jeu (60 fps)
```

À la création d'un projet, un modèle "Casse-briques" complet et fonctionnel
est proposé : le meilleur point de départ pour apprendre en modifiant du
code qui marche déjà, plutôt que de partir d'une page blanche.

Une fois le jeu prêt, le bouton **Publier dans la boutique** l'ajoute
immédiatement au catalogue, visible par tous les visiteurs, avec la mention
"Communauté" et le nom de son créateur.

### ⚠️ Sécurité — contenu généré par les utilisateurs

Le Studio permet à n'importe quel compte de publier du code exécutable, vu
par les autres visiteurs. Des protections de base sont en place :

- Les jeux communautaires/importés tournent dans une `<iframe>` en mode
  **sandbox strict** (sans `allow-same-origin`) : leur code ne peut pas lire
  les cookies, le `localStorage` ni le jeton de connexion du site principal.
  Seul le jeu officiel garde un accès complet (nécessaire pour ses
  sauvegardes).
- L'import de `.zip` est protégé contre les attaques de type *zip slip*
  (fichiers qui tenteraient d'écrire en dehors de leur dossier), limité à
  15 Mo, et n'accepte que des fichiers `.zip`.
- Le code lui-même n'est **pas relu ni modéré** avant publication.

Pour un site ouvert au public à plus grande échelle, il faudrait ajouter au
minimum : une file de modération (validation manuelle avant publication),
un signalement de contenu par les utilisateurs, et idéalement héberger les
jeux communautaires sur un **sous-domaine séparé** (ex. `play.tondomaine.com`)
pour une isolation complète au niveau du navigateur — l'iframe sandboxée
protège déjà l'essentiel, mais un sous-domaine dédié est la solution la plus
robuste si le site grandit. Dis-le-moi si tu veux que je mette ça en place.

## Modération, Support et panel Admin

### Comment un compte devient admin (premier lancement)

Dans `.env`, définis `ADMIN_EMAIL=ton@email.com`. Le compte qui s'inscrit
(ou se connecte) avec cette adresse devient automatiquement **administrateur
et vérifié**. C'est la seule étape manuelle nécessaire — ensuite, tout se
gère depuis le panel `/admin.html`.

### Cycle de vie d'un jeu publié

```
draft (brouillon) → pending (en attente) → approved (visible en boutique)
                                          → rejected (refusé, motif visible par le créateur)
```

- Un jeu n'apparaît **jamais** dans la Boutique tant qu'un membre de
  l'équipe (rôle `admin` ou `moderator`) ne l'a pas approuvé depuis
  `/admin.html`, où il peut le tester en jouant avant de décider.
- **Republier une modification** d'un jeu déjà approuvé le repasse
  automatiquement en attente (retiré de la boutique le temps de la
  revalidation) — pour éviter qu'un jeu validé une fois puisse être modifié
  sans contrôle.
- Le créateur peut aussi retirer volontairement un jeu approuvé
  (bouton "Retirer de la boutique" dans le Studio).
- Les joueurs peuvent **signaler** un jeu communautaire directement depuis
  sa fiche (Boutique ou Bibliothèque) ; les signalements atterrissent dans
  l'onglet "Signalements" du panel admin, avec une action rapide pour
  dépublier le jeu concerné.

### Comptes vérifiés

Un compte doit être **vérifié** par l'équipe avant de pouvoir créer ou
importer un jeu dans TLM Games Studio (le Studio affiche un écran dédié
avec un bouton "Demander la vérification" pour les comptes non vérifiés,
qui crée automatiquement un ticket de support).

### Panel Admin / Modération (`/admin.html`)

Réservé aux comptes avec le rôle `admin` ou `moderator`. Quatre onglets :

- **Jeux à valider** — file d'attente de modération, avec un lien pour
  tester chaque jeu avant d'approuver ou refuser (motif de refus envoyé au
  créateur, visible dans son Studio).
- **Signalements** — jeux signalés par les joueurs, avec actions
  "Dépublier" ou "Classer sans suite".
- **Support** — toutes les demandes des utilisateurs (voir ci-dessous),
  avec réponse directe, et actions rapides "Vérifier ce compte" /
  "Débannir ce compte" selon la catégorie de la demande.
- **Utilisateurs** — liste des comptes : vérifier/dévérifier, bannir/
  débannir (avec motif), et — pour les administrateurs uniquement —
  changer le rôle d'un utilisateur (`user` / `moderator` / `admin`). Un
  modérateur ne peut pas se promouvoir lui-même ni promouvoir quelqu'un
  d'autre, seul un administrateur le peut.

### Support (`/support.html`)

Accessible à tout compte connecté, indépendant du Studio. Permet de
contacter l'équipe pour : demander une vérification de compte, contester un
bannissement, signaler un bug, signaler un contenu, ou toute autre demande.
Chaque demande devient un fil de discussion (ticket) où l'utilisateur et
l'équipe peuvent échanger.

### Conditions d'utilisation (`/cgu.html`)

La création de compte exige de cocher une case d'acceptation des CGU (date
d'acceptation enregistrée sur le compte). Le texte fourni est un **modèle
générique**, pas un document rédigé par un juriste — à adapter et faire
relire avant toute mise en ligne réellement publique.

## Limites actuelles (et pistes d'amélioration)

- Base de données : un simple fichier JSON (`data/db.json`) — largement
  suffisant pour démarrer, mais à remplacer par une vraie base
  (PostgreSQL, MySQL...) si le nombre de comptes devient important.
- Pas encore de réinitialisation de mot de passe par e-mail (il faudrait un
  service d'envoi d'e-mails type Resend/SendGrid) — utile aussi pour
  notifier par e-mail les décisions de modération plutôt que seulement en
  interne sur le site.
- Pas de vérification d'e-mail à l'inscription.
- Pas de limitation du nombre de tentatives de connexion (anti brute-force).
- Les jeux communautaires en attente de modération sont accessibles par une
  URL directe (non listée, mais pas strictement privée) — suffisant pour un
  usage raisonnable, mais à renforcer (contrôle d'accès sur les fichiers)
  si la confidentialité du contenu avant validation devient sensible.

Ces points sont raisonnables à ajouter plus tard si le site grandit — le
dis-moi si tu veux que je les mette en place.
