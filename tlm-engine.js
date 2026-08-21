// ============================================================================
// TLM ENGINE — mini bibliothèque 2D pour créer des jeux simplement.
// Fournie automatiquement à tous les jeux créés dans TLM Games Studio.
// Pas besoin de gérer soi-même le <canvas>, la boucle de jeu ou le clavier :
// tout est déjà prêt, il ne reste qu'à écrire la logique du jeu.
// ============================================================================
(function (global) {
  const TLM = {};
  let canvas, ctx, running = false, lastTime = 0;
  const keysDown = {};

  // Crée et affiche le canvas de jeu. À appeler en premier dans ton code.
  // TLM.init(largeur, hauteur, couleurDeFond)
  TLM.init = function (width, height, bg) {
    canvas = document.createElement("canvas");
    canvas.width = width || 480;
    canvas.height = height || 320;
    canvas.tabIndex = 0;

    document.body.style.margin = "0";
    document.body.style.minHeight = "100vh";
    document.body.style.display = "flex";
    document.body.style.alignItems = "center";
    document.body.style.justifyContent = "center";
    document.body.style.background = "#000";
    document.body.appendChild(canvas);

    canvas.style.background = bg || "#111";
    canvas.style.imageRendering = "pixelated";
    canvas.style.boxShadow = "0 10px 40px rgba(0,0,0,0.6)";

    ctx = canvas.getContext("2d");
    canvas.focus();
    return ctx;
  };

  TLM.canvas = () => canvas;
  TLM.ctx = () => ctx;

  // ---------------- CLAVIER ----------------
  // Utilise les codes standards : "ArrowLeft", "ArrowRight", "ArrowUp",
  // "ArrowDown", "Space", "KeyW", "KeyA", "KeyS", "KeyD", etc.
  window.addEventListener("keydown", (e) => {
    keysDown[e.code] = true;
  });
  window.addEventListener("keyup", (e) => {
    keysDown[e.code] = false;
  });
  TLM.isDown = (code) => !!keysDown[code];

  // ---------------- DESSIN ----------------
  TLM.clear = function (color) {
    ctx.fillStyle = color || "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  };

  TLM.rect = function (x, y, w, h, color) {
    ctx.fillStyle = color || "#fff";
    ctx.fillRect(x, y, w, h);
  };

  TLM.circle = function (x, y, r, color) {
    ctx.fillStyle = color || "#fff";
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  };

  TLM.text = function (str, x, y, color, size) {
    ctx.fillStyle = color || "#fff";
    ctx.font = (size || 16) + "px monospace";
    ctx.fillText(str, x, y);
  };

  // ---------------- OUTILS ----------------
  // Détecte si deux rectangles {x,y,w,h} se chevauchent.
  TLM.overlap = function (a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  };

  TLM.clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  TLM.random = (min, max) => Math.random() * (max - min) + min;
  TLM.randomInt = (min, max) => Math.floor(TLM.random(min, max + 1));

  // ---------------- BOUCLE DE JEU ----------------
  // TLM.loop(fonction) appelle ta fonction à chaque image (~60 fois/seconde)
  // avec "dt" = temps écoulé depuis l'image précédente, en secondes.
  TLM.loop = function (update) {
    running = true;
    function frame(t) {
      if (!running) return;
      const dt = lastTime ? (t - lastTime) / 1000 : 0;
      lastTime = t;
      update(dt);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  };

  TLM.stop = function () {
    running = false;
  };

  global.TLM = TLM;
})(window);
