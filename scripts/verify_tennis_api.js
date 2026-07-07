// Sonde TEMPORAIRE : localise l'endpoint qui renvoie les RÉSULTATS (scores/vainqueur).
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;
const HOST = 'tennis-api-atp-wta-itf.p.rapidapi.com';
if (!RAPIDAPI_KEY) { console.error('❌ RAPIDAPI_KEY absente.'); process.exit(1); }

async function get(pathUrl) {
  const url = `https://${HOST}${pathUrl}`;
  const res = await fetch(url, { headers: { 'X-RapidAPI-Key': RAPIDAPI_KEY, 'X-RapidAPI-Host': HOST } });
  console.log(`\n>>> GET ${pathUrl}\nHTTP ${res.status} | quota ${res.headers.get('x-ratelimit-requests-remaining') || '?'}`);
  if (!res.ok) { console.log((await res.text()).slice(0, 200)); return null; }
  const data = await res.json();
  return data;
}

(async () => {
  try {
    // 1) Tournoi ATP 21838 (match roundId 4 vu = tableau principal Wimbledon probable)
    const t = await get('/tennis/v2/atp/fixtures/tournament/21838');
    const trows = Array.isArray(t) ? t : (t && t.data) || [];
    console.log('lignes tournoi:', trows.length);
    console.log(JSON.stringify(trows.slice(0, 2), null, 1));

    // 2) Recherche joueur "Djokovic" -> pour récupérer un playerId, puis son historique
    const s = await get('/tennis/v2/atp/player/search/Djokovic');
    console.log('recherche joueur:', JSON.stringify(s).slice(0, 400));
  } catch (e) { console.error('Erreur:', e.message); process.exit(1); }
})();
