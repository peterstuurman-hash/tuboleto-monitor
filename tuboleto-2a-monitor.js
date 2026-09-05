// tuboleto-2a-monitor.js — v2: dumpt altijd api_dump/latest.json voor kalibratie

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URL = 'https://tuboleto.cultura.pe/disponibilidad/llaqta_machupicchu';
const CSV = path.join(__dirname, 'tuboleto_2a_log.csv');
const DUMP_DIR = path.join(__dirname, 'api_dump');
const CIRCUIT_MATCH = /2\s*-?\s*A|CIRCUITO\s*2A|RUTA\s*2A/i;

function peruTime(d = new Date()) {
  return d.toLocaleString('sv-SE', { timeZone: 'America/Lima' });
}

(async () => {
  if (!fs.existsSync(CSV)) {
    fs.writeFileSync(CSV, 'timestamp_utc,timestamp_peru,datum,circuit,beschikbaar\n');
  }
  if (!fs.existsSync(DUMP_DIR)) fs.mkdirSync(DUMP_DIR);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const captured = [];

  page.on('response', async (res) => {
    try {
      const ct = res.headers()['content-type'] || '';
      if (!ct.includes('json')) return;
      if (!res.url().includes('cultura.pe')) return;
      captured.push({ url: res.url(), body: await res.json() });
    } catch (_) {}
  });

  await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(5000);

  // Dump ALTIJD de ruwe data (1 bestand, wordt telkens overschreven)
  fs.writeFileSync(path.join(DUMP_DIR, 'latest.json'),
    JSON.stringify(captured, null, 2));

  // Voorlopige parser (wordt aangescherpt zodra de dump geanalyseerd is)
  const rows = [];
  const AVAIL_KEYS = ['disponible', 'disponibles', 'disponibilidad',
                      'saldo', 'available', 'stock', 'cupos', 'cupo', 'restante'];

  function walk(obj) {
    if (Array.isArray(obj)) { obj.forEach(walk); return; }
    if (obj && typeof obj === 'object') {
      const strings = Object.values(obj).filter((v) => typeof v === 'string');
      const nameHit = strings.find((v) => CIRCUIT_MATCH.test(v));
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
      Object.values(obj).forEach(walk);
    }
  }
  captured.forEach((c) => walk(c.body));

  const utc = new Date().toISOString();
  const lima = peruTime();

  if (rows.length === 0) {
    fs.appendFileSync(CSV, utc + ',' + lima + ',,KALIBRATIE,\n');
    console.log('Nog geen betrouwbaar beschikbaarheidsveld — dump opgeslagen.');
  } else {
    for (const r of rows) {
      fs.appendFileSync(CSV, utc + ',' + lima + ',' + r.datum + ',"' + r.circuit + '",' + r.beschikbaar + '\n');
      console.log(lima + ' | ' + r.circuit + ' | beschikbaar: ' + r.beschikbaar);
    }
  }

  await browser.close();
})();
