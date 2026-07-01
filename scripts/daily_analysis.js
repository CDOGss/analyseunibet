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

// Ligues de football majeures suivies (bonne couverture médiatique = bonnes actualités
// pour justifier les picks). On ne les interroge que si elles sont "active" (en saison),
// ce qui évite de gâcher du quota API pendant les trêves estivales.
const MAJOR_FOOTBALL_LEAGUES = [
  'soccer_epl',
  'soccer_spain_la_liga',
  'soccer_france_ligue_one',
  'soccer_germany_bundesliga',
  'soccer_italy_serie_a',
  'soccer_uefa_champs_league',
  'soccer_usa_mls',
  'soccer_brazil_campeonato',
  'soccer_fifa_world_cup',
];

function formatOddsMatch(match) {
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
}

/**
 * 2. Récupération des Vraies Cotes via The-Odds-API
 *
 * On interroge directement les ligues de football majeures ET le tennis en cours
 * (au lieu de l'endpoint générique /upcoming/, qui ne remonte que les événements les
 * plus proches TOUTES disciplines confondues et masque le foot dès qu'un tournoi de
 * tennis se joue en même temps).
 */
async function fetchRealOdds() {
  console.log("-> Récupération des vraies cotes du jour (Football + Tennis)...");

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
    // Liste des sports actuellement "en saison" (appel gratuit, ne consomme pas de quota).
    const sportsListRes = await fetch(`https://api.the-odds-api.com/v4/sports/?apiKey=${ODDS_API_KEY}`);
    if (!sportsListRes.ok) throw new Error(`Erreur API (liste sports): ${sportsListRes.statusText}`);
    const activeSports = await sportsListRes.json();
    const activeKeys = new Set(activeSports.filter(s => s.active).map(s => s.key));

    // Tennis : on prend tout ce qui est actif dynamiquement (le tournoi en cours change au fil de l'année).
    const tennisKeys = [...activeKeys].filter(k => k.startsWith('tennis_'));
    // Football : uniquement les grandes ligues suivies, et seulement si en saison.
    const footballKeys = MAJOR_FOOTBALL_LEAGUES.filter(k => activeKeys.has(k));

    const targetSports = [...footballKeys, ...tennisKeys];
    if (targetSports.length === 0) {
      console.warn("Aucun sport actif trouvé (foot hors-saison et pas de tournoi de tennis en cours).");
      return [];
    }

    const results = await Promise.all(targetSports.map(async (sportKey) => {
      try {
        const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?apiKey=${ODDS_API_KEY}&regions=eu&markets=h2h`;
        const res = await fetch(url);
        if (!res.ok) {
          console.warn(`Cotes indisponibles pour ${sportKey} : ${res.statusText}`);
          return [];
        }
        const data = await res.json();
        return data.map(formatOddsMatch).filter(m => m !== null);
      } catch (err) {
        console.warn(`Erreur lors de la récupération des cotes pour ${sportKey} :`, err.message);
        return [];
      }
    }));

    const allMatches = results.flat();
    console.log(`-> ${allMatches.length} matchs récupérés (Football: ${footballKeys.length} ligues, Tennis: ${tennisKeys.length} tournois actifs).`);

    // On garde les matchs les plus proches dans le temps, MAIS séparément par sport
    // (football vs tennis), pour garantir que les deux soient représentés dans le lot
    // envoyé à l'IA. Un simple tri global par horaire ferait disparaître le foot dès
    // qu'un tournoi de tennis propose beaucoup de matchs plus tôt dans la journée.
    const byTime = (a, b) => new Date(a.commence_time) - new Date(b.commence_time);
    const footballMatches = allMatches.filter(m => m.sport.startsWith('soccer_')).sort(byTime).slice(0, 15);
    const tennisMatches = allMatches.filter(m => m.sport.startsWith('tennis_')).sort(byTime).slice(0, 15);

    return [...footballMatches, ...tennisMatches];
  } catch (err) {
    console.error("Erreur lors de la récupération des cotes:", err);
    return [];
  }
}

/**
 * 3. Résolution des paris précédents (Vrais résultats)
 */
async function resolvePendingBets(betsData, bankrollData) {
  console.log("-> Vérification des résultats réels des paris précédents...");

  const pendingBets = betsData.filter(b => b.statut === 'en_attente');
  if (pendingBets.length === 0) return false;

  if (!ODDS_API_KEY) {
    console.warn("Pas de ODDS_API_KEY : impossible de vérifier les vrais résultats. Les paris restent en attente.");
    return false;
  }

  // On récupère les scores réels via l'endpoint /scores/ de The-Odds-API,
  // sport par sport (l'endpoint scores est spécifique à chaque sport_key).
  const sportsNeeded = new Set();
  pendingBets.forEach(bet => bet.selections.forEach(sel => { if (sel.sport) sportsNeeded.add(sel.sport); }));

  const scoresBySport = {};
  for (const sportKey of sportsNeeded) {
    try {
      const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/scores/?apiKey=${ODDS_API_KEY}&daysFrom=3`;
      const res = await fetch(url);
      if (!res.ok) {
        console.warn(`Scores indisponibles pour ${sportKey} : ${res.statusText}`);
        continue;
      }
      scoresBySport[sportKey] = await res.json();
    } catch (err) {
      console.warn(`Erreur lors de la récupération des scores pour ${sportKey} :`, err.message);
    }
  }

  const findScoreMatch = (sel) => {
    const list = scoresBySport[sel.sport];
    if (!list) return null;
    const [team1, team2] = String(sel.match).split(/\s+vs\s+/i);
    return list.find(m =>
      m.completed &&
      ((m.home_team === team1 && m.away_team === team2) || (m.home_team === team2 && m.away_team === team1))
    ) || null;
  };

  // Retourne true (gagné), false (perdu) ou null (résultat pas encore exploitable)
  const isSelectionWon = (sel, scoreMatch) => {
    if (!Array.isArray(scoreMatch.scores)) return null;
    const homeEntry = scoreMatch.scores.find(s => s.name === scoreMatch.home_team);
    const awayEntry = scoreMatch.scores.find(s => s.name === scoreMatch.away_team);
    if (!homeEntry || !awayEntry) return null;

    const homeScore = parseFloat(homeEntry.score);
    const awayScore = parseFloat(awayEntry.score);
    if (Number.isNaN(homeScore) || Number.isNaN(awayScore)) return null;

    if (sel.choix === 'N') return homeScore === awayScore;
    if (homeScore === awayScore) return false; // match nul alors qu'on avait misé sur un vainqueur

    const winnerName = homeScore > awayScore ? scoreMatch.home_team : scoreMatch.away_team;
    const [team1, team2] = String(sel.match).split(/\s+vs\s+/i);
    const pickedTeam = sel.choix === '1' ? team1 : sel.choix === '2' ? team2 : null;
    return !!pickedTeam && pickedTeam.trim().toLowerCase() === winnerName.trim().toLowerCase();
  };

  let updated = false;
  for (const bet of pendingBets) {
    let allResolved = true;
    let betWon = true;

    for (const sel of bet.selections) {
      const scoreMatch = findScoreMatch(sel);
      if (!scoreMatch) { allResolved = false; break; }

      const won = isSelectionWon(sel, scoreMatch);
      if (won === null) { allResolved = false; break; }
      if (!won) betWon = false;
    }

    if (!allResolved) {
      console.log(`Pari ${bet.id} : résultat(s) pas encore disponible(s), laissé en attente.`);
      continue;
    }

    bet.statut = betWon ? 'gagné' : 'perdu';
    if (betWon) bankrollData.current += bet.gain_potentiel;
    updated = true;
    console.log(`Pari ${bet.id} résolu avec les vrais scores : ${bet.statut}`);
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
1. Construis un pari combiné (accumulateur) de 4 sélections parmi les matchs ci-dessus, en piochant dans le football ET le tennis dès que les deux offrent de bonnes opportunités (ne te limite pas à un seul sport si l'autre a de la valeur). Choisis pour chaque sélection un favori réellement crédible (évite les gros outsiders juste pour "remplir" le combiné à 4) : l'objectif est de maximiser le gain sur la durée avec un risque par sélection maîtrisé, pas de maximiser la cote brute d'un seul coup.
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
