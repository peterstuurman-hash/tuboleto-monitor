// tuboleto-2a-monitor.js — v3: leest direct de open API, geen browser nodig

const fs = require('fs');
const path = require('path');

const API = 'https://api-tuboleto.cultura.pe/comunes/disponibilidad-actual';
const CSV = path.join(__dirname, 'tuboleto_2a_log.csv');

function peruTime(d = new Date()) {
  return d.toLocaleString('sv-SE', { timeZone: 'America/Lima' });
}

(async () => {
  if (!fs.existsSync(CSV)) {
    fs.writeFileSync(CSV,
      'timestamp_utc,timestamp_peru,ruta,capaciteit,beschikbaar\n');
  }

  const res = await fetch(API, {
    headers: {
      'Accept': 'application/json',
      'Referer': 'https://tuboleto.cultura.pe/',
      'Origin': 'https://tuboleto.cultura.pe',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
    }
  });
  if (!res.ok) throw new Error('API gaf status ' + res.status);
  const data = await res.json();

  const row = data.find((r) => /2-?A/i.test(r.ruta || ''));
  if (!row) throw new Error('Ruta 2-A niet gevonden in API-antwoord');

  const utc = new Date().toISOString();
  const lima = peruTime();
  fs.appendFileSync(CSV,
    utc + ',' + lima + ',"' + row.ruta + '",' + row.ncupo + ',' + row.ncupoActual + '\n');
  console.log(lima + ' | ' + row.ruta + ' | ' + row.ncupoActual + ' van ' + row.ncupo + ' beschikbaar');
})();
