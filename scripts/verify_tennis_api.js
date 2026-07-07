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

  const finished = rows.filter(r => r.result && r.player1 && r.player2 && r.player1.name && r.player2.name);
  console.log('Nb matchs terminés (avec result + player1/2.name):', finished.length);
  finished.slice(0, 8).forEach(r => {
    console.log(`  ${r.player1.name} bat ${r.player2.name} (${r.result}) [${r.date || '?'}]`);
  });

  // Test concret : le pick "Iga Swiatek" doit ressortir PERDANT face à Eala (07-04).
  const eala = finished.find(r =>
    normalizeName(r.winner || r.player1.name).includes('eala') ||
    normalizeName(r.player2.name).includes('eala') ||
    normalizeName(r.player1.name).includes('swiatek') ||
    normalizeName(r.player2.name).includes('swiatek'));
  if (eala) console.log('  >>> Trouvé Eala/Swiatek :', eala.player1.name, 'bat', eala.player2.name);
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
