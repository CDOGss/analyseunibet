// Sonde TEMPORAIRE : confirme que l'endpoint H2H renvoie bien un 'result' (score/vainqueur).
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;
const HOST = 'tennis-api-atp-wta-itf.p.rapidapi.com';
if (!RAPIDAPI_KEY) { console.error('❌ RAPIDAPI_KEY absente.'); process.exit(1); }

async function get(pathUrl) {
  const res = await fetch(`https://${HOST}${pathUrl}`, { headers: { 'X-RapidAPI-Key': RAPIDAPI_KEY, 'X-RapidAPI-Host': HOST } });
  console.log(`\n>>> GET ${pathUrl}\nHTTP ${res.status} | quota ${res.headers.get('x-ratelimit-requests-remaining') || '?'}`);
  if (!res.ok) { console.log((await res.text()).slice(0, 200)); return null; }
  return res.json();
}

(async () => {
  try {
    // H2H entre deux joueurs bien établis (Djokovic 3936? / Alcaraz ?) — on teste avec des IDs
    // vus dans l'archive. On essaie plusieurs paires connues pour maximiser une chance d'historique.
    const h = await get('/tennis/v2/atp/fixtures/h2h/26153/92059');
    const rows = Array.isArray(h) ? h : (h && h.data) || [];
    console.log('lignes H2H:', rows.length);
    console.log(JSON.stringify(rows.slice(0, 3), null, 1));
  } catch (e) { console.error('Erreur:', e.message); process.exit(1); }
})();
