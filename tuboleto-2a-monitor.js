// tuboleto-2a-monitor.js — v4: browserversie, leest ncupoActual voor Ruta 2-A

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URL = 'https://tuboleto.cultura.pe/disponibilidad/llaqta_machupicchu';
const CSV = path.join(__dirname, 'tuboleto_2a_log.csv');

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

  const row = latest.find((r) => /2-?A/i.test(r.ruta || ''));
  if (!row) throw new Error('Ruta 2-A niet gevonden in de data');

  const utc = new Date().toISOString();
  const lima = peruTime();
  fs.appendFileSync(CSV,
    utc + ',' + lima + ',"' + row.ruta + '",' + row.ncupo + ',' + row.ncupoActual + '\n');
  console.log(lima + ' | ' + row.ruta + ' | ' + row.ncupoActual + ' van ' + row.ncupo + ' beschikbaar');
})();
