// tuboleto-2a-monitor.js — v7: logt routes 1A en 2A, plus wat er al verkocht is voor de twee
// volgende dagen.
//
// Waarom die twee extra kolommen: de voorraad wordt elke avond rond 19:14 Peruaanse tijd
// vrijgegeven, en tot en met 15 september 2026 was dat telkens de volle 600 voor route 2-A. Op de
// 16e kwamen er nog maar 411 vrij en op de 17e 313. Er ging dus al een deel weg vóór de vrijgave:
// ze verkopen op sommige momenten al kaarten voor over een of twee dagen. Met alleen de huidige
// beschikbaarheid zie je dat pas achteraf aan een kleinere pot; met deze twee kolommen zie je het
// gebeuren op het moment zelf.
//
// De beschikbaarheid per route komt uit /comunes/disponibilidad-actual. Die is niet los te
// bevragen — hij eist een ondertekende hash met 'code' en 'timestamp' — dus die vangen we op uit
// de browser, zoals hiervoor. Het aantal verkochte kaarten per datum komt uit
// /recaudador/ticket/tickets-por-fecha/<datum>; die is wél open en kost een gewone GET.

const { chromium } = require('playwright');
const https = require('https');
const fs = require('fs');
const path = require('path');

const URL = 'https://tuboleto.cultura.pe/disponibilidad/llaqta_machupicchu';
const API = 'https://api-tuboleto.cultura.pe/recaudador/ticket/tickets-por-fecha/';
const CSV = path.join(__dirname, 'tuboleto_2a_log.csv');
const KOP = 'timestamp_utc,timestamp_peru,timestamp_nl,ruta,capaciteit,beschikbaar,'
  + 'verkocht_over_1_dag,verkocht_over_2_dagen';
const ROUTE_FILTER = /1\s*-?\s*A|2\s*-?\s*A/i;   // alleen 1A en 2A

// 'sv-SE' geeft 'JJJJ-MM-DD uu:mm:ss' — sorteerbaar en zonder verrassingen.
const tijdIn = (zone, d = new Date()) => d.toLocaleString('sv-SE', { timeZone: zone });

function peruTime(d = new Date()) {
  return tijdIn('America/Lima', d);
}

// Nederlandse tijd erbij, zodat je niet hoeft om te rekenen wanneer iets hier gebeurde. Het
// verschil is niet vast: Peru kent geen zomertijd en Nederland wel, dus het is 's zomers zeven uur
// en 's winters zes. Daarom per regel uitrekenen in plaats van er een vast aantal uren bij op te
// tellen.
function nlTime(d = new Date()) {
  return tijdIn('Europe/Amsterdam', d);
}

// De datum over `dagen` dagen, in Peruaanse tijd. Niet in onze tijdzone rekenen: tussen 19:00 en
// middernacht hier is het daar nog de dag ervoor, en dan vraag je de verkeerde dag op.
function peruDatum(dagen) {
  return peruTime(new Date(Date.now() + dagen * 86400000)).slice(0, 10);
}

// Aantal verkochte kaarten voor één datum (dagplafond is 1000 over alle routes samen).
// Faalt de aanroep, dan geven we null terug en blijft de kolom leeg: een gemiste bijvangst mag
// de meting zelf nooit onderuit halen.
function verkochtOp(datum) {
  return new Promise((klaar) => {
    // Zonder User-Agent antwoordt de API met 403 Forbidden. Node stuurt er standaard geen mee,
    // curl wel — vandaar dat het in de terminal werkt en in een script niet.
    const opties = { timeout: 15000, headers: { 'User-Agent': 'tuboleto-monitor' } };
    const req = https.get(API + datum, opties, (res) => {
      let tekst = '';
      res.on('data', (d) => { tekst += d; });
      res.on('end', () => {
        try {
          const body = JSON.parse(tekst);
          klaar(typeof body.totalticket === 'number' ? body.totalticket : null);
        } catch (_) { klaar(null); }
      });
    });
    req.on('timeout', () => { req.destroy(); klaar(null); });
    req.on('error', () => klaar(null));
  });
}

(async () => {
  if (!fs.existsSync(CSV)) fs.writeFileSync(CSV, KOP + '\n');

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

  // De twee vooruitblikken pas ophalen als de meting zelf gelukt is, en naast elkaar.
  const [over1, over2] = await Promise.all([verkochtOp(peruDatum(1)), verkochtOp(peruDatum(2))]);

  // Eén moment vasthouden voor alle regels van deze meting, zodat de drie klokken bij elkaar horen.
  const nu = new Date();
  const utc = nu.toISOString();
  const lima = peruTime(nu);
  const nl = nlTime(nu);
  let count = 0;

  for (const row of latest) {
    if (!row || !row.ruta) continue;
    if (!ROUTE_FILTER.test(row.ruta)) continue;
    fs.appendFileSync(CSV,
      utc + ',' + lima + ',' + nl + ',"' + row.ruta + '",' + row.ncupo + ',' + row.ncupoActual
      + ',' + (over1 == null ? '' : over1) + ',' + (over2 == null ? '' : over2) + '\n');
    console.log(lima + ' | ' + row.ruta + ' | ' + row.ncupoActual + ' van ' + row.ncupo);
    count++;
  }

  console.log('Al verkocht — ' + peruDatum(1) + ': ' + (over1 == null ? 'onbekend' : over1)
    + ' | ' + peruDatum(2) + ': ' + (over2 == null ? 'onbekend' : over2));

  if (count === 0) throw new Error('Routes 1A/2A niet gevonden in de data');
})();
