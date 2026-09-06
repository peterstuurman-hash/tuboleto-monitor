// tuboleto-2a-monitor.js — v6: logt alleen routes 1A en 2A, elk kwartier

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URL = 'https://tuboleto.cultura.pe/disponibilidad/llaqta_machupicchu';
const CSV = path.join(__dirname, 'tuboleto_2a_log.csv');
const ROUTE_FILTER = /1\s*-?\s*A|2\s*-?\s*A/i;   // alleen 1A en 2A

function peruTime(d = new Date()) {
  return d.toLocaleString('sv-SE', { timeZone: 'America/Lima' });
}

(async () => {
  if (!fs.existsSync(CSV)) {
    fs.writeFileSync(CSV,
      'timestamp_utc,timestamp_peru,ruta,capaciteit,beschikbaar\n');
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const hits = [];

  page.on('response', async (res) => {
    try {
      if (!res.url().includes('disponibilidad-actual')) return;
      const body = await res.json();
      if (Array.isArray(body)) hits.push(body);
    } catch (_) {}
  });

  await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(8000);
  await browser.close();

  if (hits.length === 0) throw new Error('Geen disponibilidad-data opgevangen');
  const latest = hits[hits.length - 1];

  const utc = new Date().toISOString();
  const lima = peruTime();
  let count = 0;

  for (const row of latest) {
    if (!row || !row.ruta) continue;
    if (!ROUTE_FILTER.test(row.ruta)) continue;
    fs.appendFileSync(CSV,
      utc + ',' + lima + ',"' + row.ruta + '",' + row.ncupo + ',' + row.ncupoActual + '\n');
    console.log(lima + ' | ' + row.ruta + ' | ' + row.ncupoActual + ' van ' + row.ncupo);
    count++;
  }

  if (count === 0) throw new Error('Routes 1A/2A niet gevonden in de data');
})();
