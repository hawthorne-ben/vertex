// Dump a Garmin .fit to JSON for the analysis scripts.
//
//   node fitdump.mjs <input.fit> <output.json>
//
// Output path is an argument rather than hardcoded to /tmp: descent_compare.py
// consumes this, and a chart in the presentation has to stay reproducible after
// a reboot clears the temp directory.
import pkg from 'fit-file-parser';
const FitParser = pkg.default ?? pkg;
import { readFileSync, writeFileSync } from 'fs';

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) {
  console.error('usage: node fitdump.mjs <input.fit> <output.json>');
  process.exit(2);
}
const buf = new Uint8Array(readFileSync(inPath));
const parser = new FitParser({ force: true, speedUnit: 'm/s', lengthUnit: 'm',
  temperatureUnit: 'celsius', pressureUnit: 'bar', elapsedRecordField: true, mode: 'cascade' });
parser.parse(buf, (err, data) => {
  if (err) { console.error('ERR', err); process.exit(1); }
  const recs = (data.activity?.sessions?.flatMap(s => s.laps?.flatMap(l => l.records ?? []) ?? []) ?? data.records ?? []);
  console.error('records:', recs.length);
  if (recs.length) console.error('fields:', Object.keys(recs[0]).join(', '));
  const out = recs.filter(r => r.timestamp).map(r => ({
    t: new Date(r.timestamp).getTime(),
    d: r.distance ?? null, s: r.speed ?? null,
    lat: r.position_lat ?? null, lon: r.position_long ?? null,
    alt: r.altitude ?? r.enhanced_altitude ?? null,
  }));
  writeFileSync(outPath, JSON.stringify(out));
  console.error('wrote', out.length, 'to', outPath);
});
