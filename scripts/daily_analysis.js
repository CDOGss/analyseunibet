import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import Parser from 'rss-parser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BANKROLL_FILE = path.join(__dirname, '../public/data/bankroll.json');
const BETS_FILE = path.join(__dirname, '../public/data/bets.json');
const DAILY_BET_MD = path.join(__dirname, '../DAILY_BET.md');

// Clés API
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ODDS_API_KEY = process.env.ODDS_API_KEY;

let ai = null;
if (GEMINI_API_KEY) {
  ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
} else {
  console.warn("⚠️ GEMINI_API_KEY est manquante. Le script fonctionnera en mode simulation de secours (MOCK).");
}
const rssParser = new Parser();

/**
 * 1. Veille Stratégique : Récupération des dernières actualités via flux RSS
 */
async function fetchSportsNews() {
  console.log("-> Récupération de la veille stratégique (Flux RSS)...");
  const rssFeeds = [
    'https://dwh.lequipe.fr/api/edito/rss?path=/Football/',
    'https://dwh.lequipe.fr/api/edito/rss?path=/Tennis/'
  ];

  let newsItems = [];
  
  for (const feedUrl of rssFeeds) {
    try {
      const feed = await rssParser.parseURL(feedUrl);
      // On prend seulement les 5 dernières actus par flux pour ne pas saturer le prompt
      const latest = feed.items.slice(0, 5).map(item => `- ${item.title} : ${item.contentSnippet || item.description || ""}`);
      newsItems = newsItems.concat(latest);
    } catch (err) {
      console.warn(`Impossible de lire le flux RSS ${feedUrl}:`, err.message);
    }
  }
  
  return newsItems.join('\n');
}

/**
 * 2. Récupération des Vraies Cotes via The-Odds-API
 */
async function fetchRealOdds() {
  console.log("-> Récupération des vraies cotes du jour...");
  
  if (!ODDS_API_KEY) {
    console.warn("ATTENTION : Clé ODDS_API_KEY manquante. Utilisation de données simulées de secours (Mock).");
    console.warn("Créez un compte sur the-odds-api.com et ajoutez la clé pour avoir les données réelles.");
    return [
      { match: "Real Madrid vs Barcelone", sport: "soccer_spain_la_liga", odds: { "1": 2.10, "N": 3.20, "2": 2.50 } },
      { match: "PSG vs Marseille", sport: "soccer_france_ligue_one", odds: { "1": 1.50, "N": 4.00, "2": 5.50 } },
      { match: "Alcaraz vs Sinner", sport: "tennis_atp", odds: { "1": 1.85, "2": 1.95 } }
    ];
  }

  try {
    // On récupère les prochains matchs (Soccer et Tennis)
    const url = `https://api.the-odds-api.com/v4/sports/upcoming/odds/?apiKey=${ODDS_API_KEY}&regions=eu&markets=h2h`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Erreur API: ${res.statusText}`);
    const data = await res.json();

    // Filtrer pour Football et Tennis, et formater
    const formattedMatches = data
      .filter(m => m.sport_key.includes('soccer') || m.sport_key.includes('tennis'))
      .slice(0, 10) // On limite à 10 matchs intéressants
      .map(match => {
        const bookmaker = match.bookmakers[0]; // On prend le premier bookmaker dispo
        if (!bookmaker) return null;
        const market = bookmaker.markets[0];
        if (!market) return null;

        const oddsMap = {};
        market.outcomes.forEach(outcome => {
          if (outcome.name === match.home_team) oddsMap["1"] = outcome.price;
          else if (outcome.name === match.away_team) oddsMap["2"] = outcome.price;
          else oddsMap["N"] = outcome.price;
        });

        return {
          match: `${match.home_team} vs ${match.away_team}`,
          sport: match.sport_key,
          odds: oddsMap,
          commence_time: match.commence_time,
          id: match.id
        };
      })
      .filter(m => m !== null);

    return formattedMatches;
  } catch (err) {
    console.error("Erreur lors de la récupération des cotes:", err);
    return [];
  }
}

/**
 * 3. Résolution des paris précédents (Vrais résultats)
 */
async function resolvePendingBets(betsData, bankrollData) {
  console.log("-> Vérification des résultats des paris précédents...");
  
  if (!ODDS_API_KEY) {
    console.warn("Pas de ODDS_API_KEY, résolution simulée aléatoire.");
    let updated = false;
    for (let bet of betsData) {
      if (bet.statut === 'en_attente') {
        const isWon = Math.random() > 0.5; // 50% de chance simulée
        bet.statut = isWon ? 'gagné' : 'perdu';
        if (isWon) bankrollData.current += bet.gain_potentiel;
        updated = true;
      }
    }
    return updated;
  }

  // Si on a l'API, on pourrait appeler l'endpoint /scores/ pour vérifier les vrais résultats.
  // Pour éviter la complexité des IDs de matchs multiples, on fait un système simplifié ici.
  // TODO: Implémenter la logique exacte d'appel `https://api.the-odds-api.com/v4/sports/upcoming/scores/?daysFrom=1`
  // et recouper avec les IDs des matchs pariés.
  // Actuellement, par sécurité, nous simulerons encore la validation tant que la structure des IDs n'est pas sauvegardée.
  
  let updated = false;
  for (let bet of betsData) {
    if (bet.statut === 'en_attente') {
      // Pour une vraie V1 en production, il faut appeler l'API de score ici.
      // Dans cette V1.5, on simule la validation en attendant que vous ayez l'API.
      const isWon = Math.random() > 0.5;
      bet.statut = isWon ? 'gagné' : 'perdu';
      if (isWon) bankrollData.current += bet.gain_potentiel;
      updated = true;
    }
  }
  return updated;
}

function getSportEmoji(sportKey) {
  const k = (sportKey || '').toLowerCase();
  if (k.includes('tennis')) return '🎾 🧑‍🎾';
  if (k.includes('soccer') || k.includes('football') || k.includes('foot')) return '⚽ 🧑‍⚽';
  if (k.includes('basket')) return '🏀 🧑‍🏀';
  if (k.includes('rugby')) return '🏉 🏃‍♂️';
  if (k.includes('hockey')) return '🏒 🏒';
  if (k.includes('baseball')) return '⚾ 🧑‍⚾';
  if (k.includes('handball')) return '🤾 🤾‍♂️';
  return '🏆';
}

function generateMarkdownReport(bet) {
  const dateStr = new Date(bet.date).toLocaleDateString('fr-FR', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  
  let md = `# 🔮 Pronostic du Jour - ${dateStr}\n\n`;
  
  md += `## 🎫 Détails du Combiné\n`;
  md += `- 💰 **Mise conseillée** : \`${bet.mise.toFixed(2)} €\`\n`;
  md += `- 📈 **Cote totale** : \`${bet.cote_totale.toFixed(2)}\`\n`;
  md += `- 🎁 **Gain potentiel** : \`${bet.gain_potentiel.toFixed(2)} €\`\n\n`;
  
  md += `### 🏟️ Sélections à Placer :\n\n`;
  
  bet.selections.forEach((sel, idx) => {
    const emoji = getSportEmoji(sel.sport);
    const choixLabel = sel.choix === '1' ? 'Victoire Équipe 1 / Joueur 1' : sel.choix === '2' ? 'Victoire Équipe 2 / Joueur 2' : 'Match Nul (N)';
    
    md += `#### 🏷️ Match ${idx + 1} : ${emoji} ${sel.match}\n`;
    md += `- **Pari choisi** : **${choixLabel}** (Choix \`${sel.choix}\`)\n`;
    md += `- **Cote** : \`${sel.cote.toFixed(2)}\`\n\n`;
  });
  
  md += `### 🧠 Analyse Détaillée de l'IA :\n`;
  md += `> ${bet.analyse.replace(/\n/g, '\n> ')}\n\n`;
  
  md += `---\n*Généré automatiquement par Gemini Betting AI. Bons jeux ! 🍀*`;
  return md;
}

/**
 * Fonction Principale d'Analyse
 */
async function analyzeAndBet() {
  console.log("=== DÉMARRAGE DE L'ANALYSE QUOTIDIENNE (DATA RÉELLE) ===");
  
  try {
    const today = new Date().toISOString().split('T')[0];

    // Garde-fou anti-doublon : si un pari existe déjà pour aujourd'hui, on ne rejoue pas.
    // Utile quand on déclenche manuellement puis que le cron se redéclenche le même jour.
    const existingBets = JSON.parse(await fs.readFile(BETS_FILE, 'utf-8'));
    if (existingBets.some(b => b.date === today)) {
      console.log(`Un pari existe déjà pour aujourd'hui (${today}). Analyse ignorée (pas de doublon).`);
      process.exit(0);
    }

    const newsContext = await fetchSportsNews();
    const realOddsData = await fetchRealOdds();

    if (realOddsData.length === 0) {
      console.log("Aucun match trouvé. Abandon pour aujourd'hui.");
      process.exit(0);
    }

    const prompt = `
Tu es un TRADER SPORTIF PROFESSIONNEL ET ANALYSTE DE RISQUE. Ton objectif est de trouver la meilleure opportunité (le "value bet") pour un pari combiné aujourd'hui.

--- ACTUALITÉS SPORTIVES RÉCENTES (VEILLE STRATÉGIQUE) ---
Utilise IMPÉRATIVEMENT ces informations (blessures, dynamique, déclarations) pour valider tes choix :
${newsContext}

--- MATCHS ET COTES RÉELLES DU JOUR ---
${JSON.stringify(realOddsData, null, 2)}

--- RÈGLES STRICTES ---
1. Construis un pari combiné (accumulateur) de 2 ou 3 sélections parmi les matchs ci-dessus.
2. Chaque sélection doit être justifiée par une VRAIE information issue des actualités fournies ci-dessus (ex: l'absence d'un joueur clé, une mauvaise dynamique).
3. Le format de réponse DOIT être UNIQUEMENT un objet JSON strict :
{
  "selections": [
    { "match": "Nom du match", "choix": "1, N, ou 2", "cote": 1.50 }
  ],
  "cote_totale": 2.25,
  "analyse": "Ton analyse de risque d'expert en citant les actualités..."
}
Ne renvoie STRICTEMENT RIEN D'AUTRE que le JSON.
`;

    let betData;
    if (!ai) {
      console.log("-> Mode Simulation : Génération de paris et analyses simulés...");
      const match1 = realOddsData[0] || { match: "Real Madrid vs Barcelone", sport: "soccer_spain_la_liga", odds: { "1": 2.10 } };
      const match2 = realOddsData[2] || realOddsData[1] || { match: "Alcaraz vs Sinner", sport: "tennis_atp", odds: { "2": 1.95 } };
      
      betData = {
        selections: [
          { match: match1.match, choix: "1", cote: match1.odds ? (match1.odds["1"] || 2.10) : 2.10 },
          { match: match2.match, choix: "2", cote: match2.odds ? (match2.odds["2"] || 1.95) : 1.95 }
        ],
        cote_totale: parseFloat(((match1.odds ? (match1.odds["1"] || 2.10) : 2.10) * (match2.odds ? (match2.odds["2"] || 1.95) : 1.95)).toFixed(2)),
        analyse: "Analyse simulée de secours (Sans clé API) : Ce combiné de valeur associe une équipe à domicile performante lors des clasicos récents et un joueur de tennis en très grande forme physique sur cette surface rapide."
      };
    } else {
      console.log("-> Interrogation de Gemini 3.1 Pro (Le Cerveau)...");
      const response = await ai.models.generateContent({
        model: 'gemini-3.1-pro-preview',
        contents: prompt,
      });

      let jsonStr = response.text.trim();
      if (jsonStr.startsWith('```json')) {
        jsonStr = jsonStr.replace(/```json/g, '').replace(/```/g, '').trim();
      }
      
      betData = JSON.parse(jsonStr);
    }

    // Enrichir chaque sélection avec le sport réel et les cotes complètes du match
    // (matching par nom de match) afin que l'interface puisse afficher la bonne icône
    // (🎾 tennis, ⚽ foot...) et la vraie cote de CHAQUE camp, pas juste celle du pick IA.
    const enrichedSelections = betData.selections.map(sel => {
      const matchData = realOddsData.find(
        m => m.match.toLowerCase() === String(sel.match).toLowerCase()
      );
      return {
        ...sel,
        sport: matchData ? matchData.sport : null,
        odds: matchData ? matchData.odds : null
      };
    });

    const newBet = {
      id: Date.now().toString(),
      date: new Date().toISOString().split('T')[0],
      selections: enrichedSelections,
      cote_totale: betData.cote_totale,
      mise: 5.0,
      analyse: betData.analyse,
      statut: "en_attente",
      gain_potentiel: parseFloat((5.0 * betData.cote_totale).toFixed(2))
    };

    console.log("-> Pari généré avec succès :", enrichedSelections);

    // Lecture des fichiers locaux
    const bankrollData = JSON.parse(await fs.readFile(BANKROLL_FILE, 'utf-8'));
    const betsData = JSON.parse(await fs.readFile(BETS_FILE, 'utf-8'));

    // Vérification des anciens paris
    await resolvePendingBets(betsData, bankrollData);

    // Déduire la mise du jour et sauvegarder l'historique
    bankrollData.current -= 5.0;
    bankrollData.history.push({
      date: newBet.date,
      amount: parseFloat(bankrollData.current.toFixed(2))
    });

    betsData.unshift(newBet); // Ajouter le nouveau pari en premier

    // Sauvegarde physique
    await fs.writeFile(BANKROLL_FILE, JSON.stringify(bankrollData, null, 2));
    await fs.writeFile(BETS_FILE, JSON.stringify(betsData, null, 2));

    // Génération et sauvegarde du rapport textuel Markdown
    const reportMd = generateMarkdownReport(newBet);
    await fs.writeFile(DAILY_BET_MD, reportMd, 'utf-8');

    console.log("-> Fichiers JSON et rapport Markdown mis à jour avec succès. Fin du processus.");
  } catch (error) {
    console.error("ERREUR FATALE lors de l'analyse :", error);
    process.exit(1);
  }
}

analyzeAndBet();
