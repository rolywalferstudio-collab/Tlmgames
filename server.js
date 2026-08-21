require("dotenv").config();

const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const AdmZip = require("adm-zip");
const { readDB, writeDB } = require("./db");
const TEMPLATES = require("./templates");

const GAMES_DIR = path.join(__dirname, "..", "public", "games");
const COMMUNITY_DIR = path.join(GAMES_DIR, "community");
fs.mkdirSync(COMMUNITY_DIR, { recursive: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 Mo max par jeu importé
  fileFilter: (req, file, cb) => {
    if (!file.originalname.toLowerCase().endsWith(".zip")) {
      return cb(new Error("Seuls les fichiers .zip sont acceptés."));
    }
    cb(null, true);
  },
});

const app = express();

// ---------------------------------------------------------------------
// FIX IMPORTANT : dans Express 4, si une route définie avec une fonction
// "async" lève une erreur, Express ne l'attrape PAS automatiquement — la
// requête reste sans réponse au lieu de renvoyer une erreur JSON propre.
// On corrige ça une fois pour toutes ici : toute route déclarée plus bas
// avec app.get/post/put/delete est protégée automatiquement, sans avoir
// à ajouter un try/catch dans chacune.
// ---------------------------------------------------------------------
["get", "post", "put", "delete"].forEach((method) => {
  const original = app[method].bind(app);
  app[method] = (routePath, ...handlers) => {
    const wrapped = handlers.map((h) => {
      if (typeof h !== "function") return h;
      return (req, res, next) => {
        try {
          Promise.resolve(h(req, res, next)).catch(next);
        } catch (err) {
          next(err);
        }
      };
    });
    return original(routePath, ...wrapped);
  };
});
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
const TOKEN_TTL = "30d";

if (!JWT_SECRET || JWT_SECRET === "change_moi_avec_une_vraie_cle_secrete_aleatoire") {
  console.warn(
    "\n⚠️  JWT_SECRET n'est pas défini (ou utilise encore la valeur d'exemple).\n" +
      "   Une clé temporaire aléatoire va être utilisée pour cette exécution,\n" +
      "   ce qui déconnectera tout le monde à chaque redémarrage du serveur.\n" +
      "   Définis un vrai JWT_SECRET dans un fichier .env avant la mise en production.\n"
  );
}
const EFFECTIVE_SECRET = JWT_SECRET && JWT_SECRET !== "change_moi_avec_une_vraie_cle_secrete_aleatoire"
  ? JWT_SECRET
  : crypto.randomBytes(48).toString("hex");

// Email défini dans .env : le compte correspondant devient automatiquement
// administrateur (vérifié + rôle admin) à l'inscription ou à la connexion.
// Sert à créer le tout premier compte admin sans passer par une interface.
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "").toLowerCase().trim();

const AGE_RATINGS = ["tout_public", "10+", "13+", "16+", "18+"];

app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------
const USERNAME_RE = /^[a-zA-Z0-9_\-]{3,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    createdAt: user.createdAt,
    role: user.role || "user",
    verified: !!user.verified,
    banned: !!user.banned,
    banReason: user.banReason || null,
  };
}

// Si l'e-mail correspond à ADMIN_EMAIL (défini dans .env), on promeut
// automatiquement ce compte administrateur + vérifié.
function promoteIfAdminEmail(user) {
  if (ADMIN_EMAIL && user.email.toLowerCase() === ADMIN_EMAIL) {
    user.role = "admin";
    user.verified = true;
  }
  return user;
}

function staffRequired(req, res, next) {
  if (!["admin", "moderator"].includes(req.user.role)) {
    return res.status(403).json({ error: "Réservé à l'équipe de modération." });
  }
  next();
}
function adminRequired(req, res, next) {
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Réservé aux administrateurs." });
  }
  next();
}

function signToken(user) {
  return jwt.sign({ sub: user.id }, EFFECTIVE_SECRET, { expiresIn: TOKEN_TTL });
}

function authRequired(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Non connecté." });

  try {
    const payload = jwt.verify(token, EFFECTIVE_SECRET);
    const db = readDB();
    const user = db.users.find((u) => u.id === payload.sub);
    if (!user) return res.status(401).json({ error: "Session invalide." });
    if (user.banned) {
      return res.status(403).json({ error: "Ce compte est suspendu." + (user.banReason ? " Raison : " + user.banReason : "") });
    }
    req.user = user;
    req.db = db;
    next();
  } catch (e) {
    return res.status(401).json({ error: "Session expirée, reconnecte-toi." });
  }
}

function slugify(str) {
  return String(str)
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40) || "jeu";
}

// Construit la page HTML finale d'un jeu créé avec l'éditeur de code du Studio.
function buildCodeGameHTML(title) {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title.replace(/</g, "&lt;")}</title>
<script src="/tlm-engine.js"><\/script>
</head>
<body>
<script src="game.js"><\/script>
</body>
</html>`;
}

// Écrit un projet "code" (éditeur intégré) sur le disque, dans le dossier
// des jeux communautaires, pour qu'il devienne jouable via une URL statique.
function writeCodeProjectToDisk(project) {
  const dir = path.join(COMMUNITY_DIR, project.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "index.html"), buildCodeGameHTML(project.title));
  fs.writeFileSync(path.join(dir, "game.js"), project.code || "");
  return "games/community/" + project.id + "/index.html";
}

// Extrait un .zip uploadé vers un dossier de destination, en cherchant le
// index.html (potentiellement dans un sous-dossier) et en se protégeant des
// chemins malveillants ("zip slip": ../../etc").
function extractZipToFolder(buffer, destDir) {
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries().filter((e) => !e.isDirectory);

  const htmlEntries = entries.filter((e) => /(^|\/)index\.html$/i.test(e.entryName));
  if (htmlEntries.length === 0) {
    throw new Error("Le zip doit contenir un fichier index.html.");
  }
  // On prend le index.html le moins profond (à la racine du jeu).
  htmlEntries.sort((a, b) => a.entryName.split("/").length - b.entryName.split("/").length);
  const rootEntry = htmlEntries[0];
  const baseDir = rootEntry.entryName.includes("/")
    ? rootEntry.entryName.slice(0, rootEntry.entryName.lastIndexOf("/") + 1)
    : "";

  fs.mkdirSync(destDir, { recursive: true });
  const destReal = fs.realpathSync(destDir);

  entries.forEach((entry) => {
    if (!entry.entryName.startsWith(baseDir)) return; // hors du dossier du jeu
    const relative = entry.entryName.slice(baseDir.length);
    if (!relative || relative.includes("..")) return; // sécurité

    const targetPath = path.join(destDir, relative);
    const targetResolved = path.resolve(targetPath);
    if (!targetResolved.startsWith(destReal)) return; // sécurité anti "zip slip"

    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, entry.getData());
  });
}

// ---------------------------------------------------------------------
// AUTH — création de compte / connexion / profil
// ---------------------------------------------------------------------

app.post("/api/auth/register", async (req, res) => {
  const { username, email, password, tosAccepted } = req.body || {};

  if (!username || !USERNAME_RE.test(username)) {
    return res.status(400).json({ error: "Pseudo invalide (3 à 20 caractères, lettres/chiffres/_/-)." });
  }
  if (!email || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: "Adresse e-mail invalide." });
  }
  if (!password || password.length < 6) {
    return res.status(400).json({ error: "Le mot de passe doit contenir au moins 6 caractères." });
  }
  if (tosAccepted !== true) {
    return res.status(400).json({ error: "Tu dois accepter les Conditions d'utilisation pour créer un compte." });
  }

  const db = readDB();
  const emailTaken = db.users.some((u) => u.email.toLowerCase() === email.toLowerCase());
  const usernameTaken = db.users.some((u) => u.username.toLowerCase() === username.toLowerCase());
  if (emailTaken) return res.status(409).json({ error: "Cet e-mail est déjà utilisé." });
  if (usernameTaken) return res.status(409).json({ error: "Ce pseudo est déjà pris." });

  const passwordHash = await bcrypt.hash(password, 10);
  let user = {
    id: crypto.randomUUID(),
    username,
    email,
    passwordHash,
    role: "user",
    verified: false,
    banned: false,
    banReason: null,
    tosAcceptedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };
  user = promoteIfAdminEmail(user);
  db.users.push(user);
  await writeDB(db);

  const token = signToken(user);
  res.status(201).json({ token, user: publicUser(user) });
});

app.post("/api/auth/login", async (req, res) => {
  const { identifier, password } = req.body || {}; // identifier = e-mail OU pseudo
  if (!identifier || !password) {
    return res.status(400).json({ error: "Identifiant et mot de passe requis." });
  }

  const db = readDB();
  const user = db.users.find(
    (u) => u.email.toLowerCase() === String(identifier).toLowerCase() ||
           u.username.toLowerCase() === String(identifier).toLowerCase()
  );
  if (!user) return res.status(401).json({ error: "Identifiants incorrects." });

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: "Identifiants incorrects." });

  if (user.banned) {
    return res.status(403).json({ error: "Ce compte est suspendu." + (user.banReason ? " Raison : " + user.banReason : "") + " Tu peux faire une demande via le Support." });
  }

  const before = JSON.stringify(user);
  promoteIfAdminEmail(user);
  if (JSON.stringify(user) !== before) {
    await writeDB(db);
  }

  const token = signToken(user);
  res.json({ token, user: publicUser(user) });
});

app.get("/api/auth/me", authRequired, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

// ---------------------------------------------------------------------
// BIBLIOTHÈQUE — synchronisée par compte, accessible depuis n'importe quel appareil
// ---------------------------------------------------------------------

app.get("/api/library", authRequired, (req, res) => {
  const entries = req.db.library.filter((l) => l.userId === req.user.id);
  res.json({ games: entries.map((e) => e.gameId) });
});

app.post("/api/library", authRequired, async (req, res) => {
  const { gameId } = req.body || {};
  if (!gameId || typeof gameId !== "string") {
    return res.status(400).json({ error: "gameId requis." });
  }
  const db = readDB();
  const already = db.library.some((l) => l.userId === req.user.id && l.gameId === gameId);
  if (!already) {
    db.library.push({ userId: req.user.id, gameId, addedAt: new Date().toISOString() });
    await writeDB(db);
  }
  const entries = db.library.filter((l) => l.userId === req.user.id);
  res.status(201).json({ games: entries.map((e) => e.gameId) });
});

// Fusionne en une fois une liste de jeux "invité" (localStorage) dans le compte,
// utilisé juste après connexion/inscription pour ne rien perdre.
app.post("/api/library/merge", authRequired, async (req, res) => {
  const { gameIds } = req.body || {};
  if (!Array.isArray(gameIds)) return res.status(400).json({ error: "gameIds doit être un tableau." });

  const db = readDB();
  let changed = false;
  gameIds.forEach((gameId) => {
    if (typeof gameId !== "string") return;
    const already = db.library.some((l) => l.userId === req.user.id && l.gameId === gameId);
    if (!already) {
      db.library.push({ userId: req.user.id, gameId, addedAt: new Date().toISOString() });
      changed = true;
    }
  });
  if (changed) await writeDB(db);

  const entries = db.library.filter((l) => l.userId === req.user.id);
  res.json({ games: entries.map((e) => e.gameId) });
});

app.delete("/api/library/:gameId", authRequired, async (req, res) => {
  const db = readDB();
  db.library = db.library.filter(
    (l) => !(l.userId === req.user.id && l.gameId === req.params.gameId)
  );
  await writeDB(db);
  const entries = db.library.filter((l) => l.userId === req.user.id);
  res.json({ games: entries.map((e) => e.gameId) });
});

// ---------------------------------------------------------------------
// CATALOGUE PUBLIC — uniquement les jeux communautaires APPROUVÉS par la modération
// ---------------------------------------------------------------------

app.get("/api/catalog", (req, res) => {
  const db = readDB();
  res.json({ games: db.catalog });
});

app.post("/api/reports", authRequired, async (req, res) => {
  const { catalogId, reason } = req.body || {};
  if (!catalogId || !reason || !String(reason).trim()) {
    return res.status(400).json({ error: "Motif du signalement requis." });
  }
  const db = readDB();
  const entry = db.catalog.find((c) => c.id === catalogId);
  if (!entry) return res.status(404).json({ error: "Jeu introuvable." });

  db.reports.push({
    id: crypto.randomUUID(),
    catalogId,
    projectId: entry.projectId,
    gameTitle: entry.title,
    reporterId: req.user.id,
    reporterUsername: req.user.username,
    reason: String(reason).slice(0, 500),
    status: "open",
    createdAt: new Date().toISOString(),
  });
  await writeDB(db);
  res.status(201).json({ ok: true });
});

// ---------------------------------------------------------------------
// STUDIO — mes projets (créer / éditer / soumettre à la modération)
// ---------------------------------------------------------------------

function projectSummary(p) {
  return {
    id: p.id,
    title: p.title,
    type: p.type,
    genre: p.genre,
    desc: p.desc,
    ageRating: p.ageRating || null,
    status: p.status, // draft | pending | approved | rejected
    rejectionReason: p.rejectionReason || null,
    updatedAt: p.updatedAt,
    submittedAt: p.submittedAt || null,
  };
}

function requireVerified(req, res, next) {
  if (!req.user.verified) {
    return res.status(403).json({
      error: "Ton compte doit être vérifié par la plateforme avant de créer ou publier des jeux. Fais une demande depuis le Support.",
    });
  }
  next();
}

app.get("/api/studio/templates", authRequired, (req, res) => {
  res.json({ templates: Object.keys(TEMPLATES) });
});

app.get("/api/studio/projects", authRequired, (req, res) => {
  const mine = req.db.projects.filter((p) => p.ownerId === req.user.id);
  res.json({ projects: mine.map(projectSummary) });
});

app.post("/api/studio/projects", authRequired, requireVerified, async (req, res) => {
  const { title, template } = req.body || {};
  if (!title || !String(title).trim()) {
    return res.status(400).json({ error: "Le titre du jeu est requis." });
  }
  const code = TEMPLATES[template] || TEMPLATES.vide;

  const db = readDB();
  const project = {
    id: crypto.randomUUID(),
    ownerId: req.user.id,
    type: "code",
    title: String(title).trim().slice(0, 60),
    genre: "2D",
    desc: "",
    ageRating: null,
    certified: false,
    moderatorNote: "",
    code,
    status: "draft",
    rejectionReason: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    submittedAt: null,
    reviewedAt: null,
    reviewedBy: null,
  };
  db.projects.push(project);
  await writeDB(db);
  res.status(201).json({ project: Object.assign(projectSummary(project), { code: project.code }) });
});

app.get("/api/studio/projects/:id", authRequired, (req, res) => {
  const project = req.db.projects.find((p) => p.id === req.params.id && p.ownerId === req.user.id);
  if (!project) return res.status(404).json({ error: "Projet introuvable." });
  res.json({ project: Object.assign(projectSummary(project), { code: project.code || "", moderatorNote: project.moderatorNote || "" }) });
});

app.put("/api/studio/projects/:id", authRequired, async (req, res) => {
  const db = readDB();
  const project = db.projects.find((p) => p.id === req.params.id && p.ownerId === req.user.id);
  if (!project) return res.status(404).json({ error: "Projet introuvable." });
  if (project.type !== "code") return res.status(400).json({ error: "Ce projet n'est pas éditable ici (importé en zip)." });

  const { title, code, genre, desc } = req.body || {};
  if (title !== undefined) project.title = String(title).trim().slice(0, 60) || project.title;
  if (code !== undefined) project.code = String(code).slice(0, 300000); // ~300 Ko de code max
  if (genre !== undefined) project.genre = String(genre).slice(0, 40);
  if (desc !== undefined) project.desc = String(desc).slice(0, 200);
  project.updatedAt = new Date().toISOString();

  // Toute modification d'un jeu déjà approuvé le repasse automatiquement en
  // attente de revalidation, et le retire de la boutique publique en attendant.
  if (project.status === "approved") {
    project.status = "pending";
    project.submittedAt = new Date().toISOString();
    db.catalog = db.catalog.filter((c) => c.projectId !== project.id);
  }

  await writeDB(db);
  res.json({ project: Object.assign(projectSummary(project), { code: project.code }) });
});

app.delete("/api/studio/projects/:id", authRequired, async (req, res) => {
  const db = readDB();
  const project = db.projects.find((p) => p.id === req.params.id && p.ownerId === req.user.id);
  if (!project) return res.status(404).json({ error: "Projet introuvable." });

  db.projects = db.projects.filter((p) => p.id !== project.id);
  db.catalog = db.catalog.filter((c) => c.projectId !== project.id);
  await writeDB(db);

  const dir = path.join(COMMUNITY_DIR, project.id);
  fs.rm(dir, { recursive: true, force: true }, () => {});

  res.json({ ok: true });
});

app.post("/api/studio/projects/:id/withdraw", authRequired, async (req, res) => {
  const db = readDB();
  const project = db.projects.find((p) => p.id === req.params.id && p.ownerId === req.user.id);
  if (!project) return res.status(404).json({ error: "Projet introuvable." });

  project.status = "draft";
  project.updatedAt = new Date().toISOString();
  db.catalog = db.catalog.filter((c) => c.projectId !== project.id);
  await writeDB(db);

  res.json({ project: projectSummary(project) });
});

// Envoie le jeu à la modération — ne le rend PAS public tout de suite.
app.post("/api/studio/projects/:id/submit", authRequired, requireVerified, async (req, res) => {
  const db = readDB();
  const project = db.projects.find((p) => p.id === req.params.id && p.ownerId === req.user.id);
  if (!project) return res.status(404).json({ error: "Projet introuvable." });

  const { genre, desc, ageRating, certified, moderatorNote } = req.body || {};
  if (!AGE_RATINGS.includes(ageRating)) {
    return res.status(400).json({ error: "Merci de choisir une tranche d'âge valide." });
  }
  if (certified !== true) {
    return res.status(400).json({ error: "Tu dois certifier que ce contenu t'appartient et respecte les règles du site." });
  }

  if (genre !== undefined) project.genre = String(genre).slice(0, 40);
  if (desc !== undefined) project.desc = String(desc).slice(0, 200);
  project.ageRating = ageRating;
  project.certified = true;
  project.moderatorNote = String(moderatorNote || "").slice(0, 400);

  if (project.type === "code") {
    writeCodeProjectToDisk(project); // écrit les fichiers pour que la modération puisse tester
  }

  project.status = "pending";
  project.rejectionReason = null;
  project.submittedAt = new Date().toISOString();
  project.updatedAt = new Date().toISOString();

  await writeDB(db);
  res.json({ project: projectSummary(project) });
});

// Import d'un jeu déjà codé (zip contenant un index.html) — passe aussi par la modération.
app.post("/api/studio/upload", authRequired, requireVerified, upload.single("zipfile"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Aucun fichier reçu." });
    const title = (req.body.title || "").trim().slice(0, 60);
    if (!title) return res.status(400).json({ error: "Le titre du jeu est requis." });
    const ageRating = req.body.ageRating;
    if (!AGE_RATINGS.includes(ageRating)) {
      return res.status(400).json({ error: "Merci de choisir une tranche d'âge valide." });
    }
    if (req.body.certified !== "true") {
      return res.status(400).json({ error: "Tu dois certifier que ce contenu t'appartient et respecte les règles du site." });
    }

    const db = readDB();
    const projectId = crypto.randomUUID();
    const dir = path.join(COMMUNITY_DIR, projectId);

    extractZipToFolder(req.file.buffer, dir);

    const project = {
      id: projectId,
      ownerId: req.user.id,
      type: "upload",
      title,
      genre: (req.body.genre || "Importé").slice(0, 40),
      desc: (req.body.desc || "Jeu importé dans TLM Games Studio.").slice(0, 200),
      ageRating,
      certified: true,
      moderatorNote: String(req.body.moderatorNote || "").slice(0, 400),
      path: "games/community/" + projectId + "/index.html",
      status: "pending",
      rejectionReason: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      submittedAt: new Date().toISOString(),
      reviewedAt: null,
      reviewedBy: null,
    };
    db.projects.push(project);
    await writeDB(db);

    res.status(201).json({ project: projectSummary(project) });
  } catch (err) {
    res.status(400).json({ error: err.message || "Échec de l'import du zip." });
  }
});

// ---------------------------------------------------------------------
// SUPPORT — contacter l'équipe, demander une vérification de compte,
// contester un bannissement, etc.
// ---------------------------------------------------------------------

const TICKET_CATEGORIES = ["verification", "ban_appeal", "bug", "content_report", "other"];

function ticketSummary(t) {
  return {
    id: t.id,
    category: t.category,
    subject: t.subject,
    status: t.status,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    username: t.username,
    replies: t.replies,
  };
}

app.get("/api/support/tickets", authRequired, (req, res) => {
  const mine = req.db.tickets.filter((t) => t.userId === req.user.id);
  res.json({ tickets: mine.map(ticketSummary).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) });
});

app.post("/api/support/tickets", authRequired, async (req, res) => {
  const { category, subject, message } = req.body || {};
  if (!TICKET_CATEGORIES.includes(category)) return res.status(400).json({ error: "Catégorie invalide." });
  if (!subject || !String(subject).trim()) return res.status(400).json({ error: "Objet requis." });
  if (!message || !String(message).trim()) return res.status(400).json({ error: "Message requis." });

  const db = readDB();
  const ticket = {
    id: crypto.randomUUID(),
    userId: req.user.id,
    username: req.user.username,
    email: req.user.email,
    category,
    subject: String(subject).slice(0, 120),
    status: "open",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    replies: [
      { authorId: req.user.id, authorRole: "user", authorName: req.user.username, message: String(message).slice(0, 2000), createdAt: new Date().toISOString() },
    ],
  };
  db.tickets.push(ticket);
  await writeDB(db);
  res.status(201).json({ ticket: ticketSummary(ticket) });
});

app.post("/api/support/tickets/:id/reply", authRequired, async (req, res) => {
  const db = readDB();
  const ticket = db.tickets.find((t) => t.id === req.params.id && t.userId === req.user.id);
  if (!ticket) return res.status(404).json({ error: "Ticket introuvable." });
  const { message } = req.body || {};
  if (!message || !String(message).trim()) return res.status(400).json({ error: "Message requis." });

  ticket.replies.push({ authorId: req.user.id, authorRole: "user", authorName: req.user.username, message: String(message).slice(0, 2000), createdAt: new Date().toISOString() });
  ticket.status = ticket.status === "closed" ? "open" : ticket.status;
  ticket.updatedAt = new Date().toISOString();
  await writeDB(db);
  res.json({ ticket: ticketSummary(ticket) });
});

// ---------------------------------------------------------------------
// ADMIN / MODÉRATION — réservé au staff (role admin ou moderator)
// ---------------------------------------------------------------------

app.get("/api/admin/projects/pending", authRequired, staffRequired, (req, res) => {
  const db = readDB();
  const pending = db.projects
    .filter((p) => p.status === "pending")
    .map((p) => {
      const owner = db.users.find((u) => u.id === p.ownerId);
      return Object.assign(projectSummary(p), {
        path: p.type === "upload" ? p.path : "games/community/" + p.id + "/index.html",
        ownerUsername: owner ? owner.username : "?",
        certified: p.certified,
        moderatorNote: p.moderatorNote || "",
      });
    });
  res.json({ projects: pending });
});

app.post("/api/admin/projects/:id/approve", authRequired, staffRequired, async (req, res) => {
  const db = readDB();
  const project = db.projects.find((p) => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: "Projet introuvable." });
  const owner = db.users.find((u) => u.id === project.ownerId);

  const gamePath = project.type === "code" ? "games/community/" + project.id + "/index.html" : project.path;

  project.status = "approved";
  project.rejectionReason = null;
  project.reviewedAt = new Date().toISOString();
  project.reviewedBy = req.user.username;

  let entry = db.catalog.find((c) => c.projectId === project.id);
  if (!entry) {
    entry = {
      id: "community-" + project.id,
      projectId: project.id,
      ownerId: project.ownerId,
      ownerUsername: owner ? owner.username : "?",
      community: true,
      createdAt: new Date().toISOString(),
    };
    db.catalog.push(entry);
  }
  entry.title = project.title;
  entry.genre = project.genre || "2D";
  entry.desc = project.desc || "Jeu créé avec TLM Games Studio.";
  entry.ageRating = project.ageRating;
  entry.path = gamePath;

  await writeDB(db);
  res.json({ ok: true });
});

app.post("/api/admin/projects/:id/reject", authRequired, staffRequired, async (req, res) => {
  const db = readDB();
  const project = db.projects.find((p) => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: "Projet introuvable." });
  const { reason } = req.body || {};

  project.status = "rejected";
  project.rejectionReason = String(reason || "Non conforme aux règles du site.").slice(0, 400);
  project.reviewedAt = new Date().toISOString();
  project.reviewedBy = req.user.username;
  db.catalog = db.catalog.filter((c) => c.projectId !== project.id);

  await writeDB(db);
  res.json({ ok: true });
});

app.get("/api/admin/reports", authRequired, staffRequired, (req, res) => {
  const db = readDB();
  res.json({ reports: db.reports.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)) });
});

app.post("/api/admin/reports/:id/resolve", authRequired, staffRequired, async (req, res) => {
  const db = readDB();
  const report = db.reports.find((r) => r.id === req.params.id);
  if (!report) return res.status(404).json({ error: "Signalement introuvable." });
  const { action } = req.body || {}; // 'dismiss' | 'unpublish'

  if (action === "unpublish" && report.projectId) {
    const project = db.projects.find((p) => p.id === report.projectId);
    if (project) {
      project.status = "rejected";
      project.rejectionReason = "Dépublié suite à un signalement.";
      project.reviewedAt = new Date().toISOString();
      project.reviewedBy = req.user.username;
      db.catalog = db.catalog.filter((c) => c.projectId !== project.id);
    }
  }
  report.status = "resolved";
  report.resolvedBy = req.user.username;
  report.resolvedAt = new Date().toISOString();

  await writeDB(db);
  res.json({ ok: true });
});

app.get("/api/admin/tickets", authRequired, staffRequired, (req, res) => {
  const db = readDB();
  res.json({ tickets: db.tickets.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(ticketSummary) });
});

app.post("/api/admin/tickets/:id/reply", authRequired, staffRequired, async (req, res) => {
  const db = readDB();
  const ticket = db.tickets.find((t) => t.id === req.params.id);
  if (!ticket) return res.status(404).json({ error: "Ticket introuvable." });
  const { message } = req.body || {};
  if (!message || !String(message).trim()) return res.status(400).json({ error: "Message requis." });

  ticket.replies.push({ authorId: req.user.id, authorRole: req.user.role, authorName: req.user.username, message: String(message).slice(0, 2000), createdAt: new Date().toISOString() });
  ticket.status = "in_progress";
  ticket.updatedAt = new Date().toISOString();
  await writeDB(db);
  res.json({ ticket: ticketSummary(ticket) });
});

app.post("/api/admin/tickets/:id/close", authRequired, staffRequired, async (req, res) => {
  const db = readDB();
  const ticket = db.tickets.find((t) => t.id === req.params.id);
  if (!ticket) return res.status(404).json({ error: "Ticket introuvable." });
  ticket.status = "closed";
  ticket.updatedAt = new Date().toISOString();
  await writeDB(db);
  res.json({ ticket: ticketSummary(ticket) });
});

app.get("/api/admin/users", authRequired, staffRequired, (req, res) => {
  const db = readDB();
  res.json({ users: db.users.map(publicUser) });
});

app.post("/api/admin/users/:id/verify", authRequired, staffRequired, async (req, res) => {
  const db = readDB();
  const user = db.users.find((u) => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: "Utilisateur introuvable." });
  user.verified = true;
  await writeDB(db);
  res.json({ user: publicUser(user) });
});

app.post("/api/admin/users/:id/unverify", authRequired, staffRequired, async (req, res) => {
  const db = readDB();
  const user = db.users.find((u) => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: "Utilisateur introuvable." });
  user.verified = false;
  await writeDB(db);
  res.json({ user: publicUser(user) });
});

app.post("/api/admin/users/:id/ban", authRequired, staffRequired, async (req, res) => {
  const db = readDB();
  const user = db.users.find((u) => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: "Utilisateur introuvable." });
  if (user.role === "admin") return res.status(400).json({ error: "Impossible de bannir un administrateur." });
  user.banned = true;
  user.banReason = String((req.body && req.body.reason) || "").slice(0, 300) || "Non précisée";
  await writeDB(db);
  res.json({ user: publicUser(user) });
});

app.post("/api/admin/users/:id/unban", authRequired, staffRequired, async (req, res) => {
  const db = readDB();
  const user = db.users.find((u) => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: "Utilisateur introuvable." });
  user.banned = false;
  user.banReason = null;
  await writeDB(db);
  res.json({ user: publicUser(user) });
});

// Seul un admin (pas un simple modérateur) peut changer les rôles — évite
// qu'un modérateur ne se promeuve lui-même ou ne promeuve un tiers.
app.post("/api/admin/users/:id/role", authRequired, adminRequired, async (req, res) => {
  const db = readDB();
  const user = db.users.find((u) => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: "Utilisateur introuvable." });
  const { role } = req.body || {};
  if (!["user", "moderator", "admin"].includes(role)) return res.status(400).json({ error: "Rôle invalide." });
  user.role = role;
  if (role !== "user") user.verified = true;
  await writeDB(db);
  res.json({ user: publicUser(user) });
});

// ---------------------------------------------------------------------
// Gestionnaire d'erreurs global : renvoie du JSON propre (erreurs Multer,
// JSON mal formé envoyé par le client, etc.) plutôt qu'une page HTML brute.
// ---------------------------------------------------------------------
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  // Toujours affiché dans le terminal du serveur : c'est ici qu'on voit la
  // VRAIE cause d'un bug, même si le message envoyé au navigateur est plus court.
  console.error(`❌ Erreur sur ${req.method} ${req.originalUrl} :`, err);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({ error: err.message || "Erreur interne du serveur." });
});

// ---------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`TLM Games — serveur lancé sur http://localhost:${PORT}`);
});
