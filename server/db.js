// Base de données ultra simple, basée sur un fichier JSON.
// Suffisant pour un launcher de jeux avec un nombre raisonnable d'utilisateurs.
// Si le projet grandit beaucoup, remplacer ce fichier par une vraie base
// (PostgreSQL, MySQL, etc.) en gardant les mêmes fonctions exportées.

const fs = require("fs");
const path = require("path");

const DB_PATH = path.join(__dirname, "data", "db.json");

function ensureDB() {
  if (!fs.existsSync(path.dirname(DB_PATH))) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  }
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(
      DB_PATH,
      JSON.stringify(
        { users: [], library: [], projects: [], catalog: [], reports: [], tickets: [] },
        null,
        2
      )
    );
  }
}

function readDB() {
  ensureDB();
  const raw = fs.readFileSync(DB_PATH, "utf-8");
  try {
    const db = JSON.parse(raw);
    // Compatibilité : si une ancienne db.json existe déjà sans ces clés, on les ajoute.
    if (!Array.isArray(db.projects)) db.projects = [];
    if (!Array.isArray(db.catalog)) db.catalog = [];
    if (!Array.isArray(db.reports)) db.reports = [];
    if (!Array.isArray(db.tickets)) db.tickets = [];
    return db;
  } catch (e) {
    // Fichier corrompu : on repart d'une base vide plutôt que de planter le serveur.
    return { users: [], library: [], projects: [], catalog: [], reports: [], tickets: [] };
  }
}

// Écritures mises en file pour éviter que deux requêtes simultanées
// n'écrivent le fichier en même temps et ne se corrompent l'une l'autre.
let writeQueue = Promise.resolve();
function writeDB(db) {
  writeQueue = writeQueue
    .catch(() => {}) // une écriture précédente ratée ne doit pas bloquer les suivantes
    .then(
      () =>
        new Promise((resolve, reject) => {
          fs.writeFile(DB_PATH, JSON.stringify(db, null, 2), (err) => {
            if (err) reject(err);
            else resolve();
          });
        })
    );
  return writeQueue;
}

module.exports = { readDB, writeDB, ensureDB };
