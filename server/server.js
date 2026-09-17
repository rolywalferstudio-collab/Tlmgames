const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware pour lire le JSON envoyé par le client (index.html ou studio.html)
app.use(express.json());

// 1. Servir les fichiers statiques HTML/JS du dossier "public"
app.use(express.static(path.join(__dirname, 'public')));

// Configuration Supabase côté serveur (avec tes clés d'environnement Render)
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://TON_PROJET.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'TA_CLE_ANON_PUBLIC';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// -------------------------------------------------------------
// ROUTES D'API (Communication avec le reste du site)
// -------------------------------------------------------------

// Route pour recevoir une carte à publier et l'envoyer en modération
app.post('/api/maps/publish', async (req, res) => {
    const { name, data, userId } = req.body;

    const { data: mapCreated, error } = await supabase
        .from('maps')
        .insert([{ name, data, user_id: userId, status: 'EN_ATTENTE' }]);

    if (error) {
        return res.status(400).json({ success: false, error: error.message });
    }

    res.json({ success: true, message: 'Carte envoyée à la modération !' });
});

// Route pour récupérer les cartes validées par la modération
app.get('/api/maps', async (req, res) => {
    const { data: maps, error } = await supabase
        .from('maps')
        .select('*')
        .eq('status', 'VALIDE')
        .order('created_at', { ascending: false });

    if (error) {
        return res.status(400).json({ success: false, error: error.message });
    }

    res.json(maps);
});

// -------------------------------------------------------------
// REDIRECTION DES PAGES
// -------------------------------------------------------------

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/studio', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'studio.html'));
});

// Lancement du serveur
app.listen(PORT, () => {
    console.log(`Serveur prêt sur http://localhost:${PORT}`);
});
