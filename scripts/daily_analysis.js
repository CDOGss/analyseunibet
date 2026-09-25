import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import Parser from 'rss-parser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BANKROLL_FILE = path.join(__dirname, '../public/data/bankroll.json');
const BETS_FILE = path.join(__dirname, '../public/data/bets.json');
// Trace du dernier passage (y compris les jours SANS pari) : évite que les 3 crons
// quotidiens refassent chacun les appels API quand aucun pari n'a été placé.
const LAST_RUN_FILE = path.join(__dirname, '../public/data/last_run.json');
const DAILY_BET_MD = path.join(__dirname, '../DAILY_BET.md');

// Clés API
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ODDS_API_KEY = process.env.ODDS_API_KEY;
// Clé RapidAPI pour "Tennis API - ATP WTA ITF" : fournit les résultats des matchs
// de tennis (The-Odds-API ne les propose pas). Sans cette clé, le tennis est exclu
// du pool de paris car les jambes tennis seraient invérifiables.
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;
const TENNIS_API_HOST = 'tennis-api-atp-wta-itf.p.rapidapi.com';

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

// Ligues de football par ORDRE DE PRIORITÉ. On les interroge dans cet ordre et on
// s'arrête dès qu'on a assez de matchs (voir fetchRealOdds), ce qui garde le quota
// The-Odds-API (500/mois) sous contrôle : le week-end, les grands championnats
// remplissent en 1-2 appels ; en semaine on descend vers les championnats estivaux
// (MLS, Brésil, Amériques, Scandinavie, Asie) qui jouent aussi en milieu de semaine.
//
// UNIQUEMENT DES CHAMPIONNATS (pas de coupes à élimination directe). Raison : le
// marché 1X2 se règle sur le TEMPS RÉGLEMENTAIRE (90 min), mais l'endpoint /scores/
// de The-Odds-API renvoie le score FINAL, prolongation comprise. Sur un match à
// élimination directe, un 0-0 à 90' devenu 1-0 en prolongation serait donc réglé à
// tort comme une victoire (cas réel : Espagne-Argentine, but à la 106e). En
// championnat, aucune prolongation n'est possible : score final = score à 90 min.
const FOOTBALL_LEAGUES_PRIORITY = [
  // Grands championnats européens (surtout le week-end)
  'soccer_epl',
  'soccer_spain_la_liga',
  'soccer_italy_serie_a',
  'soccer_germany_bundesliga',
  'soccer_france_ligue_one',
  'soccer_netherlands_eredivisie',
  // Championnats actifs en été / Amériques / Asie (remplissent la semaine)
  'soccer_usa_mls',
  'soccer_brazil_campeonato',
  'soccer_mexico_ligamx',
  'soccer_argentina_primera_division',
  'soccer_norway_eliteserien',
  'soccer_sweden_allsvenskan',
  'soccer_korea_kleague1',
  'soccer_brazil_serie_b',
  'soccer_efl_champ',
  'soccer_finland_veikkausliiga',
];

// Fenêtre : matchs commençant dans les 72 prochaines heures (tolérance passée pour
// ceux qui viennent de démarrer). Avec 4 jours auparavant, le MÊME match du samedi
// ressortait dans les pools de mardi à vendredi et l'IA le re-choisissait chaque
// jour : une seule défaite anéantissait 4 tickets. Désormais un match déjà engagé
// est exclu du pool en code (voir fetchRealOdds), donc la fenêtre ne sert plus qu'à
// garantir des résultats rapides et des jours jouables.
const MATCH_HORIZON_MS = 72 * 3600 * 1000;
const VALUE_TARGET = 4;   // on arrête d'interroger les ligues dès 4 value bets trouvés
const MAX_LEAGUE_FETCHES = 12; // plafond d'appels/jour pour protéger le quota

// --- Politique de mise : VALUE BETTING (depuis le 25/09/2026) ---
// Bilan juil.→sept. (238 jambes) : -3.8 % par jambe = la marge du bookmaker, aucun
// avantage. Pire : le code prenait `bookmakers[0]`, qui était en fait PINNACLE, et
// non Unibet — les cotes simulées étaient plus généreuses que celles réellement
// jouables sur Unibet (≈ 5 % de moins).
// Nouvelle règle : on joue les cotes UNIBET, et seulement quand elles dépassent la
// « juste cote » estimée à partir de Pinnacle (bookmaker de référence du marché,
// marge retirée). C'est la seule approche documentée qui donne un avantage durable.
// Conséquence assumée : beaucoup de jours sans pari.
const BOOKMAKER_JEU = 'unibet_fr';
const BOOKMAKER_REFERENCE = 'pinnacle';
const MIN_EV = 0.02;        // avantage minimal exigé (+2 %) pour absorber l'erreur d'estimation
const MAX_SELECTIONS = 2;   // 1 simple ou un combiné de 2 value bets
const MIN_LEG_ODDS = 1.15;  // en dessous, gain trop faible
const MAX_LEG_ODDS = 2.50;  // au-delà, variance trop forte pour une caisse de 100 €

function outcomesMap(match, bookmakerKey) {
  const bk = match.bookmakers.find(b => b.key === bookmakerKey);
  const market = bk && bk.markets.find(m => m.key === 'h2h');
  if (!market) return null;
  const map = {};
  market.outcomes.forEach(outcome => {
    if (outcome.name === match.home_team) map["1"] = outcome.price;
    else if (outcome.name === match.away_team) map["2"] = outcome.price;
    else map["N"] = outcome.price;
  });
  return map;
}

function formatOddsMatch(match) {
  const odds = outcomesMap(match, BOOKMAKER_JEU);
  const ref = outcomesMap(match, BOOKMAKER_REFERENCE);
  if (!odds || !ref || Object.keys(ref).length !== Object.keys(odds).length) return null;

  // Probabilités « justes » : cotes Pinnacle, marge retirée (normalisation).
  const inv = Object.fromEntries(Object.entries(ref).map(([k, o]) => [k, 1 / o]));
  const somme = Object.values(inv).reduce((a, b) => a + b, 0);
  const proba = {}, ev = {};
  for (const k of Object.keys(odds)) {
    proba[k] = parseFloat((inv[k] / somme).toFixed(4));
    ev[k] = parseFloat((odds[k] * inv[k] / somme - 1).toFixed(4));
  }

  return {
    match: `${match.home_team} vs ${match.away_team}`,
    sport: match.sport_key,
    odds,          // cotes Unibet (celles qu'on joue)
    proba,         // probabilité estimée (Pinnacle sans marge)
    ev,            // avantage espéré par euro misé
    commence_time: match.commence_time,
    id: match.id
  };
}

// Issues jouables d'un match : cote dans la plage ET avantage ≥ MIN_EV.
function valueLegs(m) {
  return Object.keys(m.odds)
    .filter(k => m.odds[k] >= MIN_LEG_ODDS && m.odds[k] <= MAX_LEG_ODDS && m.ev[k] >= MIN_EV)
    .map(k => ({ choix: k, cote: m.odds[k], proba: m.proba[k], ev: m.ev[k] }));
}

/**
 * 2. Récupération des Vraies Cotes via The-Odds-API
 *
 * On interroge directement les ligues de football majeures ET le tennis en cours
 * (au lieu de l'endpoint générique /upcoming/, qui ne remonte que les événements les
 * plus proches TOUTES disciplines confondues et masque le foot dès qu'un tournoi de
 * tennis se joue en même temps).
 */
/**
 * @param {Set<string>} excludedMatches noms de matchs déjà engagés dans un pari
 *   encore ouvert : on ne les re-propose JAMAIS. Sinon le même match revient dans
 *   plusieurs tickets et une seule défaite en anéantit plusieurs d'un coup
 *   (observé : 200 € de mises sur 405 exposées à un même événement).
 */
async function fetchRealOdds(excludedMatches = new Set()) {
  console.log("-> Récupération des vraies cotes du jour (Football)...");

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

    // Football uniquement (tennis désactivé : résultats invérifiables, voir
    // [[reintegration-tennis]]). On parcourt les ligues actives PAR PRIORITÉ et on
    // s'arrête dès qu'on a assez de matchs proches — ça garantit des matchs même en
    // semaine (l'été européen est creux) tout en limitant les appels API.
    const activeOrdered = FOOTBALL_LEAGUES_PRIORITY.filter(k => activeKeys.has(k));
    if (activeOrdered.length === 0) {
      console.warn("Aucune ligue de football active. Pas de pari aujourd'hui.");
      return [];
    }

    const now = Date.now();
    const inWindow = (m) => {
      const t = new Date(m.commence_time).getTime();
      return t > now - 3 * 3600 * 1000 && t < now + MATCH_HORIZON_MS;
    };

    let pool = [];
    let fetches = 0;
    const leaguesUsed = [];
    for (const sportKey of activeOrdered) {
      if (pool.filter(m => valueLegs(m).length > 0).length >= VALUE_TARGET
          || fetches >= MAX_LEAGUE_FETCHES) break;
      fetches++;
      try {
        // `bookmakers=` : 2 bookmakers = 1 seul crédit de quota (comme une région).
        const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?apiKey=${ODDS_API_KEY}&bookmakers=${BOOKMAKER_JEU},${BOOKMAKER_REFERENCE}&markets=h2h`;
        const res = await fetch(url);
        if (!res.ok) {
          console.warn(`Cotes indisponibles pour ${sportKey} : ${res.statusText}`);
          continue;
        }
        const data = await res.json();
        const matches = data.map(formatOddsMatch).filter(m =>
          m && inWindow(m) && !excludedMatches.has(m.match.toLowerCase())
        );
        if (matches.length > 0) leaguesUsed.push(`${sportKey.replace('soccer_', '')}:${matches.length}`);
        pool = pool.concat(matches);
      } catch (err) {
        console.warn(`Erreur lors de la récupération des cotes pour ${sportKey} :`, err.message);
      }
    }

    // On ne garde que les matchs offrant au moins un value bet (Unibet > juste cote).
    const bettable = pool
      .map(m => ({ ...m, value: valueLegs(m) }))
      .filter(m => m.value.length > 0);

    // Meilleur avantage d'abord.
    const bestEv = (m) => Math.max(...m.value.map(v => v.ev));
    bettable.sort((a, b) => bestEv(b) - bestEv(a));
    const selected = bettable.slice(0, 20);
    console.log(`-> ${selected.length} matchs avec value bet (Unibet ≥ juste cote Pinnacle +${MIN_EV * 100} %, cote ${MIN_LEG_ODDS}-${MAX_LEG_ODDS}, ${excludedMatches.size} déjà engagés exclus) sur ${pool.length} cotés par les deux bookmakers, ${fetches} ligues interrogées [${leaguesUsed.join(', ')}].`);
    return selected;
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

  // Tickets déjà réglés (perdus sur une jambe précoce) dont d'autres jambes n'ont
  // jamais reçu de résultat : on continue de renseigner ces jambes pour l'affichage
  // pendant quelques jours. Aucun impact sur le statut du ticket ni la bankroll.
  const displayOnlyBets = betsData.filter(b =>
    b.statut !== 'en_attente' &&
    (Date.now() - new Date(b.date).getTime()) / 86400000 <= 5 &&
    b.selections.some(s => !s.resultat || s.resultat === 'en_attente')
  );

  if (pendingBets.length === 0 && displayOnlyBets.length === 0) return false;

  if (!ODDS_API_KEY) {
    console.warn("Pas de ODDS_API_KEY : impossible de vérifier les vrais résultats. Les paris restent en attente.");
    return false;
  }

  // On récupère les scores réels via l'endpoint /scores/ de The-Odds-API,
  // sport par sport (l'endpoint scores est spécifique à chaque sport_key).
  const sportsNeeded = new Set();
  [...pendingBets, ...displayOnlyBets].forEach(bet => bet.selections.forEach(sel => { if (sel.sport) sportsNeeded.add(sel.sport); }));

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

  // --- Résultats TENNIS via RapidAPI (Tennis API - ATP WTA ITF) ---
  // The-Odds-API ne fournit pas les scores tennis ; on interroge donc l'archive
  // RapidAPI, où chaque match terminé liste player1 = vainqueur, player2 = perdant.
  const normalizeName = (s) => String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();

  const sameName = (a, b) => {
    const na = normalizeName(a), nb = normalizeName(b);
    if (!na || !nb) return false;
    if (na === nb) return true;
    // Repli : même nom de famille + même initiale de prénom (formats "J. Sinner" etc.)
    const pa = na.split(' '), pb = nb.split(' ');
    return pa[pa.length - 1] === pb[pb.length - 1] && pa[0][0] === pb[0][0];
  };

  const fetchTennisResultsRange = async (tourType, startDate, endDate) => {
    try {
      const url = `https://${TENNIS_API_HOST}/tennis/v2/${tourType}/fixtures/${startDate}/${endDate}`;
      const res = await fetch(url, {
        headers: { 'X-RapidAPI-Key': RAPIDAPI_KEY, 'X-RapidAPI-Host': TENNIS_API_HOST }
      });
      if (!res.ok) {
        console.warn(`Résultats tennis indisponibles (${tourType}) : HTTP ${res.status}`);
        return [];
      }
      const data = await res.json();
      const rows = Array.isArray(data) ? data : (Array.isArray(data.data) ? data.data : []);
      return rows
        .filter(r => r.result && r.player1 && r.player2 && r.player1.name && r.player2.name)
        .map(r => ({ winner: r.player1.name, loser: r.player2.name }));
    } catch (err) {
      console.warn(`Erreur résultats tennis (${tourType}) :`, err.message);
      return [];
    }
  };

  const tennisTours = new Set();
  pendingBets.forEach(bet => bet.selections.forEach(sel => {
    const k = sel.sport || '';
    if (k.startsWith('tennis_atp')) tennisTours.add('atp');
    else if (k.startsWith('tennis_wta')) tennisTours.add('wta');
  }));

  let tennisResults = [];
  if (tennisTours.size > 0 && RAPIDAPI_KEY) {
    const oldest = pendingBets.reduce((min, b) => (b.date < min ? b.date : min), pendingBets[0].date);
    const today = new Date().toISOString().split('T')[0];
    for (const tour of tennisTours) {
      tennisResults = tennisResults.concat(await fetchTennisResultsRange(tour, oldest, today));
    }
    console.log(`-> ${tennisResults.length} résultats tennis récupérés via RapidAPI.`);
  } else if (tennisTours.size > 0) {
    console.warn("Jambes tennis en attente mais RAPIDAPI_KEY absente : résolution tennis impossible (void après délai).");
  }

  // Retourne true/false si le match est dans l archive, null sinon (pas encore joué/publié).
  const resolveTennisLeg = (sel) => {
    const [p1, p2] = String(sel.match).split(/\s+vs\s+/i);
    const row = tennisResults.find(r =>
      (sameName(r.winner, p1) && sameName(r.loser, p2)) ||
      (sameName(r.winner, p2) && sameName(r.loser, p1))
    );
    if (!row) return null;
    const picked = sel.choix === '1' ? p1 : sel.choix === '2' ? p2 : null;
    if (!picked) return null;
    return sameName(row.winner, picked);
  };

  // Au-delà de ce délai, une jambe sans résultat vérifiable est neutralisée ("void",
  // cote 1.0) comme le font les bookmakers pour un match annulé : le pari peut alors
  // se régler sur les jambes vérifiées au lieu de rester bloqué en attente pour toujours.
  const VOID_AFTER_DAYS = 5;

  // Score final "home-away" (football) pour l'affichage, si disponible.
  const footballScore = (scoreMatch) => {
    if (!scoreMatch || !Array.isArray(scoreMatch.scores)) return null;
    const h = scoreMatch.scores.find(s => s.name === scoreMatch.home_team);
    const a = scoreMatch.scores.find(s => s.name === scoreMatch.away_team);
    if (!h || !a) return null;
    return `${h.score}-${a.score}`;
  };

  let updated = false;

  // Mise à jour d'affichage des jambes restées sans résultat sur des tickets déjà réglés.
  for (const bet of displayOnlyBets) {
    for (const sel of bet.selections) {
      if (sel.resultat && sel.resultat !== 'en_attente') continue;
      if ((sel.sport || '').startsWith('tennis_')) continue;
      const scoreMatch = findScoreMatch(sel);
      if (!scoreMatch) continue;
      const won = isSelectionWon(sel, scoreMatch);
      if (won === null) continue;
      sel.resultat = won ? 'gagné' : 'perdu';
      const sc = footballScore(scoreMatch);
      if (sc) sel.score = sc;
      updated = true;
    }
  }

  for (const bet of pendingBets) {
    const betAgeDays = (Date.now() - new Date(bet.date).getTime()) / 86400000;
    let anyLost = false;
    let anyUnknown = false;
    let effectiveCote = 1;

    // On évalue CHAQUE sélection (sans court-circuit) pour stocker son résultat
    // individuel (sel.resultat + sel.score) et pouvoir l'afficher sur la page.
    for (const sel of bet.selections) {
      // Une jambe déjà tranchée (gagnée/perdue) n'est jamais réévaluée : cela préserve
      // les corrections manuelles, notamment les matchs à élimination directe décidés
      // en prolongation, où le score renvoyé par l'API n'est PAS le score à 90 minutes
      // (le marché 1X2 se règle sur le temps réglementaire).
      if (sel.resultat === 'gagné' || sel.resultat === 'perdu') {
        if (sel.resultat === 'gagné') effectiveCote *= sel.cote;
        else anyLost = true;
        continue;
      }

      const isTennisLeg = (sel.sport || '').startsWith('tennis_');
      let won;
      if (isTennisLeg) {
        won = resolveTennisLeg(sel);
      } else {
        const scoreMatch = findScoreMatch(sel);
        won = scoreMatch ? isSelectionWon(sel, scoreMatch) : null;
        const sc = footballScore(scoreMatch);
        if (sc) sel.score = sc;
      }

      if (won === true) {
        sel.resultat = 'gagné';
        effectiveCote *= sel.cote;
      } else if (won === false) {
        sel.resultat = 'perdu';
        anyLost = true;
      } else if (betAgeDays > VOID_AFTER_DAYS) {
        // Résultat toujours introuvable après le délai : jambe neutralisée (void, cote 1.0).
        sel.resultat = 'annulé';
        console.log(`Pari ${bet.id} : jambe "${sel.match}" invérifiable depuis ${Math.floor(betAgeDays)} jours, neutralisée (cote 1.0).`);
      } else {
        sel.resultat = 'en_attente';
        anyUnknown = true;
      }
    }

    if (anyLost) {
      bet.statut = 'perdu';
      updated = true;
      console.log(`Pari ${bet.id} résolu avec les vrais scores : perdu.`);
      continue;
    }

    if (anyUnknown) {
      console.log(`Pari ${bet.id} : résultat(s) pas encore disponible(s), laissé en attente.`);
      continue;
    }

    // Toutes les jambes sont gagnées ou neutralisées : gain recalculé sur les jambes vérifiées.
    bet.statut = 'gagné';
    bet.gain_potentiel = parseFloat((bet.mise * effectiveCote).toFixed(2));
    bankrollData.current = parseFloat((bankrollData.current + bet.gain_potentiel).toFixed(2));
    updated = true;
    console.log(`Pari ${bet.id} résolu avec les vrais scores : gagné (+${bet.gain_potentiel}€).`);
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
    let lastRun = null;
    try { lastRun = JSON.parse(await fs.readFile(LAST_RUN_FILE, 'utf-8')); } catch { /* 1er passage */ }
    if (lastRun && lastRun.date === today) {
      console.log(`Passage déjà effectué aujourd'hui (${lastRun.statut}). Rien à faire.`);
      process.exit(0);
    }
    const finSansPari = async (raison) => {
      console.log(raison);
      await fs.writeFile(LAST_RUN_FILE, JSON.stringify({ date: today, statut: 'aucun_pari', raison }, null, 2));
      process.exit(0);
    };

    // Résolution des paris en attente AVANT tout : elle doit avoir lieu même les
    // jours sans nouveau pari (fréquents avec le value betting).
    const bankrollData = JSON.parse(await fs.readFile(BANKROLL_FILE, 'utf-8'));
    const betsData = existingBets;
    await resolvePendingBets(betsData, bankrollData);
    await fs.writeFile(BANKROLL_FILE, JSON.stringify(bankrollData, null, 2));
    await fs.writeFile(BETS_FILE, JSON.stringify(betsData, null, 2));

    // Matchs déjà engagés dans un ticket encore ouvert : interdits de re-sélection.
    // Un match n'est "ouvert" que tant qu'il n'est pas joué, donc cet ensemble est
    // exactement la liste des événements sur lesquels on a déjà de l'argent en jeu.
    const openMatches = new Set();
    betsData
      .filter(b => b.statut === 'en_attente')
      .forEach(b => b.selections.forEach(s => openMatches.add(String(s.match).toLowerCase())));

    const newsContext = await fetchSportsNews();
    const realOddsData = await fetchRealOdds(openMatches);

    // Aucun value bet : on ne parie pas. C'est le cas normal, pas une panne.
    if (realOddsData.length === 0) {
      await finSansPari("Aucun value bet aujourd'hui (Unibet ne paie nulle part plus que la juste cote) : aucun pari placé.");
    }

    const nbSelections = Math.min(MAX_SELECTIONS, realOddsData.length);
    // Le prompt n'a besoin que de l'essentiel (moins de tokens, moins d'erreurs).
    const promptData = realOddsData.map(({ match, commence_time, value }) => ({ match, commence_time, value }));

    const prompt = `
Tu es un TRADER SPORTIF PROFESSIONNEL ET ANALYSTE DE RISQUE. Ton objectif est de faire du PROFIT SUR LA DURÉE. Les matchs ci-dessous sont des VALUE BETS déjà détectés par calcul : Unibet y paie plus que la juste cote estimée depuis Pinnacle (champ "value" : issue, cote Unibet, probabilité estimée, avantage "ev"). Ton rôle est d'ÉCARTER les pièges, pas de chercher d'autres paris.

--- ACTUALITÉS SPORTIVES RÉCENTES (VEILLE STRATÉGIQUE) ---
Utilise IMPÉRATIVEMENT ces informations (blessures, dynamique, déclarations) pour valider tes choix :
${newsContext}

--- MATCHS ET COTES RÉELLES DU JOUR ---
${JSON.stringify(promptData, null, 2)}

--- RÈGLES STRICTES ---
1. Choisis au plus ${nbSelections} sélection(s), sur des matchs DIFFÉRENTS, UNIQUEMENT parmi les issues listées dans le champ "value" (même "choix", même match). Aucune autre issue n'est autorisée.
2. Préfère les avantages ("ev") les plus élevés, SAUF si les actualités ci-dessus révèlent une information que la cote n'intègre peut-être pas encore et qui joue CONTRE l'issue (blessure d'un cadre, rotation annoncée, crise interne) : écarte alors cette issue.
3. Si toutes les issues te semblent piégées, renvoie "selections": [] — ne pas parier est une décision valable.
4. Le marché est réglé sur le TEMPS RÉGLEMENTAIRE (90 minutes). Seuls des matchs de championnat sont proposés, donc le score final est celui des 90 minutes.
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
      console.log("-> Interrogation de Gemini 3.8 Flash (Le Cerveau)...");
      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
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
    // et la vraie cote de CHAQUE camp, pas juste celle du pick IA.
    const enrichedSelections = betData.selections.map(sel => {
      const matchData = realOddsData.find(
        m => m.match.toLowerCase() === String(sel.match).toLowerCase()
      );
      // La cote de référence est celle du marché, pas celle recopiée par l'IA.
      const realOdd = matchData && matchData.odds ? matchData.odds[String(sel.choix).toUpperCase()] : undefined;
      return {
        ...sel,
        cote: typeof realOdd === 'number' ? realOdd : sel.cote,
        sport: matchData ? matchData.sport : null,
        odds: matchData ? matchData.odds : null,
        ev: matchData && matchData.ev ? matchData.ev[String(sel.choix).toUpperCase()] : undefined,
        proba: matchData && matchData.proba ? matchData.proba[String(sel.choix).toUpperCase()] : undefined
      };
    });

    if (enrichedSelections.length === 0) {
      await finSansPari("L'IA a écarté tous les value bets du jour (actualités défavorables) : aucun pari placé.");
    }

    // Filet de sécurité : l'IA peut ignorer les règles. On valide en code et, en cas
    // d'écart, on ne parie pas aujourd'hui (aucune mise perdue) plutôt que de placer
    // un ticket hors politique. Chaque point correspond à une perte avérée du passé.
    const seen = new Set();
    const violations = [];
    for (const sel of enrichedSelections) {
      const key = String(sel.match).toLowerCase();
      if (!sel.sport) violations.push(`match inconnu du pool : "${sel.match}"`);
      if (seen.has(key)) violations.push(`match sélectionné deux fois : "${sel.match}"`);
      seen.add(key);
      if (openMatches.has(key)) violations.push(`match déjà engagé dans un ticket ouvert : "${sel.match}"`);
      if (typeof sel.cote !== 'number' || sel.cote < MIN_LEG_ODDS || sel.cote > MAX_LEG_ODDS) {
        violations.push(`cote hors plage ${MIN_LEG_ODDS}-${MAX_LEG_ODDS} : "${sel.match}" @ ${sel.cote}`);
      }
      if (typeof sel.ev !== 'number' || sel.ev < MIN_EV) {
        violations.push(`pas un value bet (avantage ${sel.ev}) : "${sel.match}" choix ${sel.choix}`);
      }
    }
    if (enrichedSelections.length > nbSelections) {
      violations.push(`nombre de sélections ${enrichedSelections.length} > ${nbSelections}`);
    }
    if (violations.length > 0) {
      console.warn("Ticket de l'IA rejeté par la politique de mise :");
      violations.forEach(v => console.warn("  - " + v));
      await finSansPari("Ticket de l'IA hors politique de mise : aucun pari placé.");
    }

    // La cote totale est recalculée à partir des cotes réelles du marché.
    const coteTotale = parseFloat(enrichedSelections.reduce((p, s) => p * s.cote, 1).toFixed(2));

    const newBet = {
      id: Date.now().toString(),
      date: new Date().toISOString().split('T')[0],
      selections: enrichedSelections,
      cote_totale: coteTotale,
      mise: 5.0,
      analyse: betData.analyse,
      statut: "en_attente",
      gain_potentiel: parseFloat((5.0 * coteTotale).toFixed(2))
    };

    console.log("-> Pari généré avec succès :", enrichedSelections);

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
    await fs.writeFile(LAST_RUN_FILE, JSON.stringify({ date: today, statut: 'pari_place', id: newBet.id }, null, 2));

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
