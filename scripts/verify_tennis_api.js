// Sonde de diagnostic TEMPORAIRE : vérifie que la clé RapidAPI fonctionne et que le
// format de réponse de "Tennis API - ATP WTA ITF" correspond à notre parser de résolution.
// Ne touche NI aux paris NI à la bankroll. À supprimer après vérification.
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;
const HOST = 'tennis-api-atp-wta-itf.p.rapidapi.com';

if (!RAPIDAPI_KEY) {
  console.error('❌ RAPIDAPI_KEY absente de l\'environnement.');
  process.exit(1);
}

const normalizeName = (s) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();

async function probe(tour, start, end) {
  const url = `https://${HOST}/tennis/v2/${tour}/fixtures/${start}/${end}`;
  console.log(`\n=== ${tour.toUpperCase()} ${start} → ${end} ===`);
  const res = await fetch(url, {
    headers: { 'X-RapidAPI-Key': RAPIDAPI_KEY, 'X-RapidAPI-Host': HOST }
  });
  console.log('HTTP', res.status, '| quota restant:', res.headers.get('x-ratelimit-requests-remaining') || 'n/a');
  if (!res.ok) {
    console.log('Corps:', (await res.text()).slice(0, 300));
    return;
  }
  const data = await res.json();
  const rows = Array.isArray(data) ? data : (Array.isArray(data.data) ? data.data : []);
  console.log('Type réponse:', Array.isArray(data) ? 'array' : `objet (clés: ${Object.keys(data).join(',')})`);
  console.log('Nb lignes:', rows.length);

  // Dump brut des 2 premières lignes pour voir la vraie structure des champs.
  console.log('--- Structure brute (2 premières lignes) ---');
  console.log(JSON.stringify(rows.slice(0, 2), null, 1));
}

(async () => {
  try {
    await probe('wta', '2026-07-01', '2026-07-07');
    await probe('atp', '2026-07-01', '2026-07-07');
  } catch (e) {
    console.error('Erreur:', e.message);
    process.exit(1);
  }
})();
