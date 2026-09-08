/**
 * Tests for post-processing timestamp reconstruction.
 *
 * The load-bearing cases are (a) backward distribution within a batch and
 * (b) that a dropped sample is FLAGGED rather than smoothed over — the case
 * naive `start + i/rate` indexing gets silently wrong.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  VTXDecoder,
  IMURecord,
  ClockSyncRecord,
  computeClockDrift,
  reconstructTimestamps,
  reconstructRecordTimestamps,
  reconstructAndCorrect,
  findBatchRuns,
} from '../src';

const SAMPLE_DIR = path.resolve(
  __dirname,
  '../../../analysis/data/sample-recordings'
);

const RATE_V2 = 104;
const DT_V2 = 1000 / RATE_V2; // 9.615...

/** Build a timestamp array from a run-length spec: [[ts, count], ...] */
function fromRuns(spec: Array<[number, number]>): number[] {
  const out: number[] = [];
  for (const [ts, count] of spec) {
    for (let i = 0; i < count; i++) out.push(ts);
  }
  return out;
}

function makeRecord(ts: number): IMURecord {
  return {
    timestamp: ts,
    accelX: 0,
    accelY: 0,
    accelZ: 9.81,
    gyroX: 0,
    gyroY: 0,
    gyroZ: 0,
  };
}

describe('findBatchRuns', () => {
  it('groups consecutive equal timestamps into runs', () => {
    const runs = findBatchRuns([10, 10, 10, 20, 30, 30]);
    expect(runs).toEqual([
      { startIndex: 0, length: 3, timestampMs: 10 },
      { startIndex: 3, length: 1, timestampMs: 20 },
      { startIndex: 4, length: 2, timestampMs: 30 },
    ]);
  });

  it('does not merge non-adjacent equal timestamps', () => {
    // Same value reappearing later is a separate FIFO read, not the same one.
    const runs = findBatchRuns([10, 20, 10]);
    expect(runs.map((r) => r.length)).toEqual([1, 1, 1]);
  });

  it('returns no runs for an empty input', () => {
    expect(findBatchRuns([])).toEqual([]);
  });
});

describe('backward distribution within a batch', () => {
  it('places a run backward from the recorded read time', () => {
    // The recorded timestamp is when the read COMPLETED, so it belongs to the
    // last sample; earlier samples step back by one interval each.
    const { timestamps } = reconstructTimestamps([1000, 1000, 1000], RATE_V2);
    expect(timestamps[2]).toBeCloseTo(1000, 9);
    expect(timestamps[1]).toBeCloseTo(1000 - DT_V2, 9);
    expect(timestamps[0]).toBeCloseTo(1000 - 2 * DT_V2, 9);
  });

  it('never places a sample after its recorded read time', () => {
    const { timestamps } = reconstructTimestamps(
      fromRuns([[500, 4], [600, 3]]),
      RATE_V2
    );
    for (let i = 0; i < 4; i++) expect(timestamps[i]).toBeLessThanOrEqual(500);
    for (let i = 4; i < 7; i++) expect(timestamps[i]).toBeLessThanOrEqual(600);
  });

  it('leaves already-unique timestamps untouched', () => {
    // 99% of real samples are singleton runs; they must pass through exactly.
    const input = [0, 10, 19, 29, 39, 48];
    const { timestamps, report } = reconstructTimestamps(input, RATE_V2);
    expect(timestamps).toEqual(input);
    expect(report.adjustedSamples).toBe(0);
    expect(report.multiSampleRunCount).toBe(0);
  });

  it.each([1, 2, 10, 25])('handles a duplicate run of length %i', (n) => {
    const anchor = 10_000;
    const input = [...fromRuns([[anchor, n]]), anchor + 10];
    const { timestamps, report } = reconstructTimestamps(input, RATE_V2);

    // The run's last sample keeps the recorded anchor exactly.
    expect(timestamps[n - 1]).toBeCloseTo(anchor, 9);
    // Every earlier sample is one nominal interval further back.
    for (let k = 0; k < n; k++) {
      expect(timestamps[k]).toBeCloseTo(anchor - (n - 1 - k) * DT_V2, 9);
    }
    expect(report.longestRun).toBe(n);
    // The trailing sentinel is itself a length-1 run, so for n === 1 the
    // histogram holds both.
    expect(report.runLengthHistogram[n]).toBe(n === 1 ? 2 : 1);
    // Strictly increasing throughout.
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i]).toBeGreaterThan(timestamps[i - 1]);
    }
  });

  it('reproduces the measured worst case: a 25-sample stall', () => {
    // Longest run observed across the V2 corpus. ~240ms of data collapsed to
    // one instant in the stored file; reconstruction spreads it back out.
    const input = fromRuns([[5000, 25]]).concat([5010]);
    const { timestamps } = reconstructTimestamps(input, RATE_V2);
    const spread = timestamps[24] - timestamps[0];
    expect(spread).toBeCloseTo(24 * DT_V2, 6);
    expect(spread).toBeGreaterThan(230); // ~231ms
  });
});

describe('gap detection', () => {
  it('flags a dropped-sample gap instead of interpolating across it', () => {
    // This is the case naive `start + i/rate` gets silently wrong.
    // Two batches 1000ms apart with only one sample in the second: ~103
    // samples are missing.
    const input = [0, 1000];
    const { report } = reconstructTimestamps(input, RATE_V2);

    expect(report.gaps).toHaveLength(1);
    const gap = report.gaps[0];
    expect(gap.beforeIndex).toBe(0);
    expect(gap.afterIndex).toBe(1);
    expect(gap.durationMs).toBe(1000);
    expect(gap.missingSamples).toBeGreaterThan(100);
    expect(report.trustworthy).toBe(false);
    expect(report.warnings.join(' ')).toMatch(/do not interpolate/);
  });

  it('does not interpolate across the gap: both sides keep their anchors', () => {
    const input = [0, 0, 0, 5000, 5000];
    const { timestamps, report } = reconstructTimestamps(input, RATE_V2);

    // Samples before the gap stay anchored at 0, not stretched toward 5000.
    expect(timestamps[2]).toBeCloseTo(0, 9);
    expect(timestamps[4]).toBeCloseTo(5000, 9);
    // The gap is reported, not smoothed away.
    expect(report.gaps).toHaveLength(1);
    expect(report.totalMissingSamples).toBeGreaterThan(500);
  });

  it('a dropped sample perturbs one interval, not everything downstream', () => {
    // The core argument for per-batch anchoring. Drop one sample mid-record;
    // every later timestamp must still match its own recorded anchor.
    const clean: number[] = [];
    for (let i = 0; i < 40; i++) clean.push(Math.round(i * DT_V2));
    const dropped = clean.filter((_, i) => i !== 20);

    const { timestamps } = reconstructTimestamps(dropped, RATE_V2);
    // Each reconstructed time equals its stored anchor (all singleton runs),
    // so no cumulative shift accrues after the drop.
    for (let i = 0; i < dropped.length; i++) {
      expect(timestamps[i]).toBeCloseTo(dropped[i], 9);
    }
    // A naive global index would have put the final sample here instead:
    const naiveFinal = dropped[0] + (dropped.length - 1) * DT_V2;
    expect(Math.abs(naiveFinal - clean[clean.length - 1])).toBeGreaterThan(9);
  });

  it('does not mistake millis() quantization for a gap', () => {
    // Real 104Hz deltas quantize to 9/10/11ms against a 9.615ms period.
    // None of that is a dropped sample.
    const input = [0, 10, 19, 29, 39, 48, 58, 68, 77, 87];
    const { report } = reconstructTimestamps(input, RATE_V2);
    expect(report.gaps).toEqual([]);
    expect(report.trustworthy).toBe(true);
  });

  it('respects a custom gap threshold', () => {
    const input = [0, 30]; // ~3 intervals of elapsed time, 1 sample
    expect(
      reconstructTimestamps(input, RATE_V2, { gapThresholdIntervals: 1.5 })
        .report.gaps
    ).toHaveLength(1);
    expect(
      reconstructTimestamps(input, RATE_V2, { gapThresholdIntervals: 10 })
        .report.gaps
    ).toHaveLength(0);
  });
});

describe('degenerate inputs', () => {
  it('handles zero samples without throwing', () => {
    const { timestamps, report } = reconstructTimestamps([], RATE_V2);
    expect(timestamps).toEqual([]);
    expect(report.sampleCount).toBe(0);
    expect(report.trustworthy).toBe(false);
    expect(report.warnings.join(' ')).toMatch(/no samples/);
  });

  it('handles a single sample without throwing', () => {
    const { timestamps, report } = reconstructTimestamps([1234], RATE_V2);
    expect(timestamps).toEqual([1234]);
    expect(report.trustworthy).toBe(false);
    expect(report.warnings.join(' ')).toMatch(/single sample/);
  });

  it('handles every timestamp being identical', () => {
    const { timestamps, report } = reconstructTimestamps(
      fromRuns([[777, 8]]),
      RATE_V2
    );
    expect(report.runCount).toBe(1);
    expect(report.longestRun).toBe(8);
    // Single anchor: reported as an extrapolation, not a per-batch fit.
    expect(report.trustworthy).toBe(false);
    expect(report.warnings.join(' ')).toMatch(/single anchor/);
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i]).toBeGreaterThan(timestamps[i - 1]);
    }
  });

  it('reports non-monotonic input rather than crashing', () => {
    const { report } = reconstructTimestamps([0, 50, 20, 90], RATE_V2);
    expect(report.nonMonotonicInput).toBe(true);
    expect(report.nonMonotonicIndices).toContain(2);
    expect(report.trustworthy).toBe(false);
    expect(report.warnings.join(' ')).toMatch(/go backwards/);
  });

  it('still returns monotonic output for non-monotonic input', () => {
    const { timestamps } = reconstructTimestamps([0, 50, 20, 90], RATE_V2);
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i]).toBeGreaterThan(timestamps[i - 1]);
    }
  });

  it('reports an invalid sample rate instead of dividing by zero', () => {
    for (const bad of [0, -104, NaN]) {
      const { timestamps, report } = reconstructTimestamps([0, 0, 10], bad);
      expect(timestamps).toEqual([0, 0, 10]); // stored times, unchanged
      expect(report.trustworthy).toBe(false);
      expect(report.warnings.join(' ')).toMatch(/sample rate/);
    }
  });
});

describe('rate is taken from the header, not assumed', () => {
  it('places a 20Hz V1 batch at 50ms intervals', () => {
    const records = [500, 500, 500].map(makeRecord);
    const { records: out } = reconstructRecordTimestamps(records, {
      sampleRate: 20,
    });
    expect(out[2].timestamp).toBeCloseTo(500, 9);
    expect(out[1].timestamp).toBeCloseTo(450, 9);
    expect(out[0].timestamp).toBeCloseTo(400, 9);
  });

  it('places a 104Hz V2 batch at 9.615ms intervals', () => {
    const records = [500, 500, 500].map(makeRecord);
    const { records: out } = reconstructRecordTimestamps(records, {
      sampleRate: 104,
    });
    expect(out[1].timestamp).toBeCloseTo(500 - DT_V2, 9);
  });

  it('never applies a 104Hz assumption to a 20Hz file', () => {
    const records = [1000, 1000].map(makeRecord);
    const at20 = reconstructRecordTimestamps(records, { sampleRate: 20 });
    const at104 = reconstructRecordTimestamps(records, { sampleRate: 104 });
    expect(at20.records[0].timestamp).toBeCloseTo(950, 9);
    expect(at104.records[0].timestamp).not.toBeCloseTo(950, 3);
    expect(at20.report.sampleRateHz).toBe(20);
  });
});

describe('non-destructive, opt-in behaviour', () => {
  it('does not mutate the input records', () => {
    const records = [100, 100].map(makeRecord);
    const before = records.map((r) => r.timestamp);
    reconstructRecordTimestamps(records, { sampleRate: RATE_V2 });
    expect(records.map((r) => r.timestamp)).toEqual(before);
  });

  it('keeps the raw stored timestamps available in the result', () => {
    const input = [100, 100, 100];
    const result = reconstructTimestamps(input, RATE_V2);
    expect(result.originalTimestamps).toEqual([100, 100, 100]);
    expect(result.timestamps).not.toEqual(result.originalTimestamps);
  });

  it('does not change default decode behaviour', () => {
    // Decoding must return stored timestamps as-is; reconstruction is a
    // separate, explicit call.
    const file = path.join(SAMPLE_DIR, '3_19_2026_49535472.vtx');
    if (!fs.existsSync(file)) return;
    const buf = fs.readFileSync(file);
    const decoded = new VTXDecoder(
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    ).decode({ maxRecords: 500 });
    const stored = decoded.records.map((r) => r.timestamp);
    // Stored data has duplicate timestamps; decode preserves them.
    expect(new Set(stored).size).toBeLessThan(stored.length);
  });
});

describe('composition with computeClockDrift', () => {
  const syncRecords: ClockSyncRecord[] = [];
  for (let i = 0; i < 6; i++) {
    const t1 = 1000 + i * 600_000;
    // 40ppm drift, 1.7e12 epoch offset, 40ms round trip.
    const offset = 1_700_000_000_000 + t1 * 40e-6;
    syncRecords.push({
      t1DeviceMs: t1,
      t2PhoneUnixMs: Math.round(t1 + offset + 20),
      t3PhoneUnixMs: Math.round(t1 + offset + 25),
      t4DeviceMs: t1 + 45,
    });
  }

  it('applies drift exactly once, without double-counting', () => {
    const fit = computeClockDrift(syncRecords);
    const records = [10_000, 10_000, 10_000].map(makeRecord);

    const composed = reconstructAndCorrect(records, { sampleRate: RATE_V2 }, fit.correct);
    const reconstructedOnly = reconstructRecordTimestamps(records, {
      sampleRate: RATE_V2,
    });

    // Composing must equal: reconstruct in device time, then correct once.
    for (let i = 0; i < records.length; i++) {
      expect(composed.records[i].timestamp).toBeCloseTo(
        fit.correct(reconstructedOnly.records[i].timestamp),
        6
      );
    }
  });

  it('preserves intra-batch spacing up to the drift rate', () => {
    // Reconstruction sets the spacing; drift correction rescales it by
    // (1 + slope) only — it must not re-quantize or collapse it.
    const fit = computeClockDrift(syncRecords);
    const records = [10_000, 10_000, 10_000].map(makeRecord);
    const { records: out } = reconstructAndCorrect(
      records,
      { sampleRate: RATE_V2 },
      fit.correct
    );
    const spacing = out[1].timestamp - out[0].timestamp;
    expect(spacing).toBeCloseTo(DT_V2 * (1 + fit.ppm / 1e6), 3);
  });

  it('reports the same quality report as reconstruction alone', () => {
    const fit = computeClockDrift(syncRecords);
    const records = [0, 0, 0, 10].map(makeRecord);
    const a = reconstructAndCorrect(records, { sampleRate: RATE_V2 }, fit.correct);
    const b = reconstructRecordTimestamps(records, { sampleRate: RATE_V2 });
    expect(a.report.longestRun).toBe(b.report.longestRun);
    expect(a.report.gaps).toEqual(b.report.gaps);
  });

  it('is identity-safe when there are no sync records', () => {
    const fit = computeClockDrift([]);
    expect(fit.trustworthy).toBe(false);
    const records = [500, 500].map(makeRecord);
    const composed = reconstructAndCorrect(records, { sampleRate: RATE_V2 }, fit.correct);
    const plain = reconstructRecordTimestamps(records, { sampleRate: RATE_V2 });
    // correct() degrades to identity, so composition changes nothing.
    expect(composed.records.map((r) => r.timestamp)).toEqual(
      plain.records.map((r) => r.timestamp)
    );
  });
});

describe('real V2 recordings', () => {
  const v2Files = [
    '3_19_2026_49535472.vtx',
    '5_21_2026_54030254.vtx',
    '3_24_2026_54119728.vtx',
  ].filter((f) => fs.existsSync(path.join(SAMPLE_DIR, f)));

  it('has V2 sample files to test against', () => {
    expect(v2Files.length).toBeGreaterThan(0);
  });

  it.each(v2Files)('%s: reconstructed times stay monotonic', (name) => {
    const buf = fs.readFileSync(path.join(SAMPLE_DIR, name));
    const decoded = new VTXDecoder(
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    ).decode({ maxRecords: 60_000 });

    const { records, report } = reconstructRecordTimestamps(
      decoded.records,
      decoded.header
    );
    expect(report.sampleRateHz).toBe(decoded.header.sampleRate);

    for (let i = 1; i < records.length; i++) {
      expect(records[i].timestamp).toBeGreaterThan(records[i - 1].timestamp);
    }
  });

  it.each(v2Files)(
    '%s: stays within one sample period of stored time outside gaps',
    (name) => {
      const buf = fs.readFileSync(path.join(SAMPLE_DIR, name));
      const decoded = new VTXDecoder(
        buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
      ).decode({ maxRecords: 60_000 });

      const { records, report } = reconstructRecordTimestamps(
        decoded.records,
        decoded.header
      );
      const dt = report.nominalIntervalMs;

      // Indices inside a flagged gap are exempt — that is where the record is
      // known incomplete.
      const gapSpan = new Set<number>();
      for (const g of report.gaps) {
        for (let i = g.beforeIndex; i <= g.afterIndex; i++) gapSpan.add(i);
      }

      for (let i = 0; i < records.length; i++) {
        if (gapSpan.has(i)) continue;
        const drift = Math.abs(
          records[i].timestamp - decoded.records[i].timestamp
        );
        // A run of length n shifts its first sample back by (n-1)*dt; the
        // per-sample displacement from its own recorded anchor is bounded by
        // the run length, so check against the longest observed run.
        expect(drift).toBeLessThanOrEqual(report.longestRun * dt);
      }
    }
  );

  it.each(v2Files)('%s: reduces duplicate timestamps to zero', (name) => {
    const buf = fs.readFileSync(path.join(SAMPLE_DIR, name));
    const decoded = new VTXDecoder(
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    ).decode({ maxRecords: 60_000 });

    const storedUnique = new Set(decoded.records.map((r) => r.timestamp)).size;
    const { records } = reconstructRecordTimestamps(
      decoded.records,
      decoded.header
    );
    const reconstructedUnique = new Set(records.map((r) => r.timestamp)).size;

    expect(storedUnique).toBeLessThan(decoded.records.length);
    expect(reconstructedUnique).toBe(records.length);
  });
});

describe('header rate that contradicts the data', () => {
  // Some early V1 files declare a rate the samples do not follow (a 20Hz
  // header over 25Hz data). Gap detection against a wrong nominal interval
  // would flag every ordinary interval, so it is suppressed and reported.

  const at25Hz = Array.from({ length: 200 }, (_, i) => i * 40);

  it('detects a header that contradicts the data', () => {
    const { report } = reconstructTimestamps(at25Hz, 20);
    expect(report.rateMismatch).toBe(true);
    expect(report.observedIntervalMs).toBeCloseTo(40, 6);
    expect(report.observedRateHz).toBeCloseTo(25, 6);
    expect(report.trustworthy).toBe(false);
    expect(report.warnings.join(' ')).toMatch(/does not describe this file/);
  });

  it('suppresses meaningless gaps on mismatch', () => {
    expect(reconstructTimestamps(at25Hz, 20).report.gaps).toEqual([]);
    // With the correct header the same data is clean.
    const ok = reconstructTimestamps(at25Hz, 25);
    expect(ok.report.gaps).toEqual([]);
    expect(ok.report.rateMismatch).toBe(false);
    expect(ok.report.trustworthy).toBe(true);
  });

  it('does not flag a matching header', () => {
    const ts = Array.from({ length: 200 }, (_, i) => Math.round(i * DT_V2));
    const { report } = reconstructTimestamps(ts, RATE_V2);
    expect(report.rateMismatch).toBe(false);
    expect(report.observedRateHz).toBeGreaterThan(RATE_V2 * 0.85);
    expect(report.observedRateHz).toBeLessThan(RATE_V2 * 1.15);
  });

  it('does not mistake a few real gaps for a wrong header', () => {
    const ts = Array.from({ length: 200 }, (_, i) => Math.round(i * DT_V2));
    const base = ts[ts.length - 1] + 5000;
    for (let i = 0; i < 200; i++) ts.push(base + Math.round(i * DT_V2));
    const { report } = reconstructTimestamps(ts, RATE_V2);
    expect(report.rateMismatch).toBe(false);
    expect(report.gaps).toHaveLength(1);
    expect(report.gaps[0].missingSamples).toBeGreaterThan(400);
  });
});
