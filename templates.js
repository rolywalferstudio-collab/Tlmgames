// Modèles de code proposés à la création d'un nouveau projet dans le Studio.
// TLM (le moteur fourni automatiquement) gère déjà le canvas, la boucle de
// jeu et le clavier — voir /public/tlm-engine.js pour la liste des fonctions.

const TEMPLATES = {
  vide: `// Nouveau jeu — TLM Games Studio
// TLM.init(largeur, hauteur, couleurDeFond) crée l'écran de jeu.
const ctx = TLM.init(480, 320, "#111");

let x = 240, y = 160;

TLM.loop((dt) => {
  // Déplacement avec les flèches du clavier
  if (TLM.isDown("ArrowLeft"))  x -= 200 * dt;
  if (TLM.isDown("ArrowRight")) x += 200 * dt;
  if (TLM.isDown("ArrowUp"))    y -= 200 * dt;
  if (TLM.isDown("ArrowDown"))  y += 200 * dt;

  TLM.clear("#111");
  TLM.circle(x, y, 16, "#e8c96a");
  TLM.text("Utilise les flèches !", 12, 24, "#a8a48c");
});
`,

  casse_briques: `// Casse-briques — exemple complet à modifier librement
const ctx = TLM.init(480, 320, "#0b0f0a");

// Raquette
const paddle = { x: 190, y: 300, w: 100, h: 12 };

// Balle
const ball = { x: 240, y: 200, r: 8, vx: 160, vy: -160 };

// Briques
const bricks = [];
const cols = 8, rows = 4;
for (let r = 0; r < rows; r++) {
  for (let c = 0; c < cols; c++) {
    bricks.push({ x: c * 58 + 6, y: r * 22 + 30, w: 52, h: 16, alive: true });
  }
}

let score = 0;
let gameOver = false;

TLM.loop((dt) => {
  if (!gameOver) {
    // Raquette contrôlée au clavier
    if (TLM.isDown("ArrowLeft"))  paddle.x -= 260 * dt;
    if (TLM.isDown("ArrowRight")) paddle.x += 260 * dt;
    paddle.x = TLM.clamp(paddle.x, 0, 480 - paddle.w);

    // Déplacement de la balle
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    // Rebonds sur les bords
    if (ball.x < ball.r || ball.x > 480 - ball.r) ball.vx *= -1;
    if (ball.y < ball.r) ball.vy *= -1;
    if (ball.y > 320) gameOver = true; // balle tombée

    // Rebond sur la raquette
    const ballBox = { x: ball.x - ball.r, y: ball.y - ball.r, w: ball.r * 2, h: ball.r * 2 };
    if (TLM.overlap(ballBox, paddle) && ball.vy > 0) {
      ball.vy *= -1;
    }

    // Collisions avec les briques
    bricks.forEach((b) => {
      if (b.alive && TLM.overlap(ballBox, b)) {
        b.alive = false;
        ball.vy *= -1;
        score += 10;
      }
    });
  }

  // --- Dessin ---
  TLM.clear("#0b0f0a");
  bricks.forEach((b) => { if (b.alive) TLM.rect(b.x, b.y, b.w, b.h, "#c9a227"); });
  TLM.rect(paddle.x, paddle.y, paddle.w, paddle.h, "#e8c96a");
  TLM.circle(ball.x, ball.y, ball.r, "#e9e0c6");
  TLM.text("Score : " + score, 10, 316, "#a8a48c", 13);

  if (gameOver) {
    TLM.text("Perdu — recharge la page pour rejouer", 90, 160, "#e8b8b8", 15);
  }
});
`,
};

if (typeof module !== "undefined") module.exports = TEMPLATES;
