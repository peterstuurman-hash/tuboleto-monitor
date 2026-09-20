// tuboleto-2a-monitor.js — v8: per DATUM loggen, niet alleen "wat er nu op het scherm staat".
//
// Wat er mis was met v6/v7. De site toont niet één dag maar bladert vanzelf langs de dagen die in
// de verkoop zijn, en hij begint bij MORGEN. Wij schreven telkens het laatst opgevangen antwoord
// weg zonder te weten bij welke dag het hoorde — dus soms morgen, soms overmorgen, zonder dat je
// het aan de regel kon zien. De "voorraad springt van 0 naar 600"-momenten die daaruit leken te
// volgen waren geen vrijgave maar het omklappen van de pagina naar de volgende dag.
//
// v7 probeerde dat te repareren met tickets-por-fecha. Die telt iets anders: op 20-09 gaf hij 201
// voor de 21e terwijl er op het scherm 1000 kaarten uitgegeven stonden en alle routes uitverkocht
// waren. Die twee kolommen zijn eruit.
//
// Hoe het nu werkt. Het verzoek dat de site doet bevat de datum:
//   POST /comunes/disponibilidad-actual  {"lugar":"…","fecha":"2026-09-22","punto":5,"code":…}
// Dat 'code' is een ondertekende hash, dus zelf aanroepen kan niet. Maar de pagina roteert uit
// zichzelf langs alle dagen die te koop zijn. We kijken dus een minuut mee en vangen elk antwoord
// op mét de datum uit het bijbehorende verzoek. Elke dag die de site aanbiedt levert een eigen
// regel per route — komt er een derde dag bij, dan staat die er vanzelf in.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URL = 'https://tuboleto.cultura.pe/disponibilidad/llaqta_machupicchu';
const CSV = path.join(__dirname, 'tuboleto_log.csv');
const KOP = 'timestamp_utc,timestamp_peru,timestamp_nl,datum_ticket,dagen_vooruit,ruta,'
  + 'aforo,verkocht,beschikbaar,turnos_entregados,turnos_disponibles';
const ROUTE_FILTER = /1\s*-?\s*A|2\s*-?\s*A/i;   // alleen 1A en 2A; haal dit weg voor alle zes
// Lang genoeg meekijken om de hele rotatie te zien. Twee dagen duurt ongeveer twintig seconden;
// een minuut geeft ruimte als er een derde dag bij komt of de pagina traag laadt.
const KIJKDUUR = 60000;

// 'sv-SE' geeft 'JJJJ-MM-DD uu:mm:ss' — sorteerbaar en zonder verrassingen.
const tijdIn = (zone, d = new Date()) => d.toLocaleString('sv-SE', { timeZone: zone });
const peruTime = (d = new Date()) => tijdIn('America/Lima', d);
// Peru kent geen zomertijd en wij wel, dus het verschil is 's zomers zeven uur en 's winters zes.
// Daarom per meting omrekenen in plaats van een vast aantal uren optellen.
const nlTime = (d = new Date()) => tijdIn('Europe/Amsterdam', d);

// Hoeveel dagen ligt deze ticketdatum vooruit, gerekend vanaf vandaag in Peru? Niet in onze
// tijdzone rekenen: tussen 19:00 en middernacht hier is het daar nog de dag ervoor.
function dagenVooruit(fecha, nu) {
  const vandaag = peruTime(nu).slice(0, 10);
  return Math.round((Date.parse(fecha + 'T12:00:00Z') - Date.parse(vandaag + 'T12:00:00Z')) / 86400000);
}

(async () => {
  if (!fs.existsSync(CSV)) fs.writeFileSync(CSV, KOP + '\n');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const perDatum = new Map();   // 'JJJJ-MM-DD' -> [route, ...]
  const turnos = new Map();     // 'DD/MM/JJJJ' -> { entregados, disponibles }

  page.on('response', async (res) => {
    if (!res.url().includes('disponibilidad-actual')) return;
    let body = null, verzoek = null;
    try { body = await res.json(); } catch (_) { return; }
    try { verzoek = JSON.parse(res.request().postData() || '{}'); } catch (_) { return; }
    // Laatste antwoord per datum wint: verderop in de rotatie is het verser.
    if (Array.isArray(body) && verzoek.fecha) perDatum.set(verzoek.fecha, body);
  });

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // De wachtrijnummers voor de balie staan alleen op het scherm, niet in de API. Ze horen bij de
  // datum die op dat moment getoond wordt, dus lezen we beide in één keer uit.
  const eind = Date.now() + KIJKDUUR;
  while (Date.now() < eind) {
    const s = await page.evaluate(() => {
      const t = document.body.innerText.replace(/\n+/g, ' ');
      const d = /Disponibilidad para el d[ií]a\s*([\d/]+)/.exec(t);
      const q = /Disponibles:\s*(\d+)\s*Entregados:\s*(\d+)/.exec(t);
      return { datum: d ? d[1] : null, disponibles: q ? +q[1] : null, entregados: q ? +q[2] : null };
    }).catch(() => ({}));
    if (s && s.datum && s.entregados != null) turnos.set(s.datum, s);
    await page.waitForTimeout(1500);
  }
  await browser.close();

  if (perDatum.size === 0) throw new Error('Geen disponibilidad-data opgevangen');

  const nu = new Date();
  const utc = nu.toISOString(), lima = peruTime(nu), nl = nlTime(nu);
  let regels = 0;

  for (const fecha of [...perDatum.keys()].sort()) {
    const dm = fecha.slice(8) + '/' + fecha.slice(5, 7) + '/' + fecha.slice(0, 4);   // API -> scherm
    const q = turnos.get(dm) || {};
    const vooruit = dagenVooruit(fecha, nu);
    for (const r of perDatum.get(fecha)) {
      if (!r || !r.ruta || !ROUTE_FILTER.test(r.ruta)) continue;
      const verkocht = r.ncupo - r.ncupoActual;
      fs.appendFileSync(CSV, [utc, lima, nl, fecha, vooruit, '"' + r.ruta + '"',
        r.ncupo, verkocht, r.ncupoActual,
        q.entregados == null ? '' : q.entregados,
        q.disponibles == null ? '' : q.disponibles].join(',') + '\n');
      console.log(fecha + ' (+' + vooruit + ') | ' + r.ruta + ' | ' + verkocht + ' verkocht, '
        + r.ncupoActual + ' vrij van ' + r.ncupo);
      regels++;
    }
  }

  if (regels === 0) throw new Error('Routes 1A/2A niet gevonden in de data');
  console.log('Weggeschreven: ' + regels + ' regels over ' + perDatum.size + ' datum(s).');
})();
