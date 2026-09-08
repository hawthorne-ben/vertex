import pkg from 'fit-file-parser';
const FitParser = pkg.default ?? pkg;
import { readFileSync, writeFileSync } from 'fs';
const buf = new Uint8Array(readFileSync(process.argv[2]));
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
  writeFileSync('/tmp/fit_9_7.json', JSON.stringify(out));
  console.error('wrote', out.length, 'to /tmp/fit_9_7.json');
});
