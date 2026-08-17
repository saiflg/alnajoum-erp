#!/usr/bin/env node
// Regenerates apps/web/public/data/airports.json from OpenFlights' open
// airport database. See scripts/build-airports.md for what this is, why
// it exists, and the data source's license.
//
// Usage (from the repo root):
//   curl -sSL -o /tmp/airports.dat https://raw.githubusercontent.com/jpatokal/openflights/master/data/airports.dat
//   node scripts/build-airports.js /tmp/airports.dat
'use strict';

const fs = require('fs');
const path = require('path');

const sourcePath = process.argv[2];
if (!sourcePath) {
  console.error('Usage: node scripts/build-airports.js <path-to-airports.dat>');
  console.error(
    'Download it first: curl -sSL -o /tmp/airports.dat https://raw.githubusercontent.com/jpatokal/openflights/master/data/airports.dat',
  );
  process.exit(1);
}

const raw = fs.readFileSync(sourcePath, 'utf8');

// Minimal CSV line parser correct for this file's shape: comma-separated,
// double-quoted string fields, embedded commas only ever appear inside quotes.
function parseLine(line) {
  const fields = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields;
}

const lines = raw.split('\n').filter((l) => l.trim().length > 0);
const seen = new Set();
const airports = [];

for (const line of lines) {
  // columns: id,name,city,country,iata,icao,lat,lon,alt,tz,dst,tzdb,type,source
  const f = parseLine(line);
  const name = f[1];
  const city = f[2];
  const country = f[3];
  const iata = f[4];

  if (!iata || iata === '\\N' || !/^[A-Z]{3}$/.test(iata)) continue;
  if (!city || city === '\\N') continue;
  if (seen.has(iata)) continue;
  seen.add(iata);

  airports.push({ code: iata, city, country, name });
}

airports.sort((a, b) => a.code.localeCompare(b.code));

const outPath = path.join(__dirname, '..', 'apps', 'web', 'public', 'data', 'airports.json');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(airports));

console.log(`Parsed ${lines.length} rows -> ${airports.length} airports with a valid IATA code`);
console.log(`Written to ${outPath}`);
console.log(`File size: ${(fs.statSync(outPath).size / 1024).toFixed(1)} KB`);
