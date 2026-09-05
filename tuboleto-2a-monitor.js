// tuboleto-2a-monitor.js
// Monitort beschikbaarheid van Circuito 2A op tuboleto.cultura.pe
// Draai elke 30 min via cron:  */30 * * * * node /pad/naar/tuboleto-2a-monitor.js
//
// Setup (eenmalig):
//   npm init -y
//   npm install playwright
//   npx playwright install chromium
//
// Output: tuboleto_2a_log.csv  (timestamp_utc, timestamp_peru, datum, circuit, beschikbaar)
// Eerste run schrijft ook api_dump/*.json zodat je kunt zien welke API-responses
// binnenkomen — daarmee kun je de parser hieronder exact maken.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URL = 'https://tuboleto.cultura.pe/disponibilidad/llaqta_machupicchu';
const CSV = path.join(__dirname, 'tuboleto_2a_log.csv');
const DUMP_DIR = path.join(__dirname, 'api_dump');
const CIRCUIT_MATCH = /2\s*-?\s*A|CIRCUITO\s*2A|RUTA\s*2A/i; // pas aan na eerste run

function peruTime(d = new Date()) {
  return d.toLocaleString('sv-SE', { timeZone: 'America/Lima' });
}

(async () => {
  if (!fs.existsSync(DUMP_DIR)) fs.mkdirSync(DUMP_DIR);
  if (!fs.existsSync(CSV)) {
    fs.writeFileSync(CSV, 'timestamp_utc,timestamp_peru,datum,circuit,beschikbaar\n');
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const captured = [];

  // Vang alle JSON-responses van de site — hier zit de beschikbaarheidsdata in
  page.on('response', async (res) => {
    try {
      const ct = res.headers()['content-type'] || '';
      if (!ct.includes('json')) return;
      if (!res.url().includes('cultura.pe')) return;
      const body = await res.json();
      captured.push({ url: res.url(), body });
    } catch (_) { /* niet-parsebare response, negeren */ }
  });

  await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
  // Extra marge voor trage API's
  await page.waitForTimeout(5000);

  // Dump de API-responses (handig voor eerste run / debuggen)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.writeFileSync(
    path.join(DUMP_DIR, `dump_${stamp}.json`),
    JSON.stringify(captured, null, 2)
  );

  // --- Parser: zoek in de gevangen JSON naar objecten met een circuitnaam
  //     die op 2A matcht + een numeriek veld dat op beschikbaarheid lijkt.
  //     Dit is bewust generiek; maak hem exact zodra je de dump hebt gezien.
  const rows = [];
  const AVAIL_KEYS = ['disponible', 'disponibles', 'disponibilidad', 'cantidad',
                      'aforo', 'saldo', 'available', 'stock', 'cupos', 'cupo'];

  function walk(obj, ctx = {}) {
    if (Array.isArray(obj)) { obj.forEach((o) => walk(o, ctx)); return; }
    if (obj && typeof obj === 'object') {
      const values = Object.values(obj).filter((v) => typeof v === 'string');
      const nameHit = values.find((v) => CIRCUIT_MATCH.test(v));
      if (nameHit) {
        for (const k of Object.keys(obj)) {
          if (AVAIL_KEYS.includes(k.toLowerCase()) && typeof obj[k] === 'number') {
            rows.push({
              circuit: nameHit.trim(),
              beschikbaar: obj[k],
              datum: obj.fecha || obj.date || peruTime().slice(0, 10),
            });
          }
        }
      }
      Object.values(obj).forEach((v) => walk(v, ctx));
    }
  }
  captured.forEach((c) => walk(c.body));

  // Fallback: probeer het uit de gerenderde pagina te lezen
  if (rows.length === 0) {
    const text = await page.evaluate(() => document.body.innerText);
    const m = text.match(/(2\s*-?\s*A|CIRCUITO\s*2A)[^\d]{0,60}(\d{1,5})/i);
    if (m) {
      rows.push({ circuit: m[1], beschikbaar: parseInt(m[2], 10),
                  datum: peruTime().slice(0, 10) });
    }
  }

  const utc = new Date().toISOString();
  const lima = peruTime();
  if (rows.length === 0) {
    fs.appendFileSync(CSV, `${utc},${lima},,GEEN_MATCH,\n`);
    console.log('Geen 2A-data gevonden — check api_dump/ en scherp de parser aan.');
  } else {
    for (const r of rows) {
      fs.appendFileSync(CSV, `${utc},${lima},${r.datum},"${r.circuit}",${r.beschikbaar}\n`);
      console.log(`${lima} | ${r.circuit} | beschikbaar: ${r.beschikbaar}`);
    }
  }

  await browser.close();
})();
