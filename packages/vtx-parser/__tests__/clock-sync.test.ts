/**
 * Tests for the VTX v1.2 clock sync stream and drift fit.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  VTXEncoder,
  VTXDecoder,
  IMURecord,
  ClockSyncRecord,
  computeClockDrift,
  detectClockSteps,
  toObservation,
} from '../src';

const SAMPLE_DIR = path.resolve(
  __dirname,
  '../../../analysis/data/sample-recordings'
);

function imuRecords(count: number, startTs = 1_700_000_000_000): IMURecord[] {
  const out: IMURecord[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      timestamp: startTs + i * 10,
      accelX: 0.1 + i * 0.01,
      accelY: 0.2,
      accelZ: 9.81,
      gyroX: 0.01,
      gyroY: 0.02,
      gyroZ: 0.03,
    });
  }
  return out;
}

/**
 * Build sync records for a device clock drifting at a known rate.
 *
 * The device runs slow by `ppm`, so device millis() advances less than true
 * elapsed time. rttMs is split evenly across the two legs.
 */
function syntheticSync(
  count: number,
  ppm: number,
  opts: {
    intervalMs?: number;
    rttMs?: number;
    deviceStartMs?: number;
    phoneEpochMs?: number;
    phoneStepAt?: number;
    phoneStepMs?: number;
  } = {}
): ClockSyncRecord[] {
  const intervalMs = opts.intervalMs ?? 60_000;
  const rttMs = opts.rttMs ?? 40;
  const d0 = opts.deviceStartMs ?? 100_000;
  const p0 = opts.phoneEpochMs ?? 1_700_000_000_000;
  const eps = ppm / 1e6;

  const out: ClockSyncRecord[] = [];
  for (let i = 0; i < count; i++) {
    // True elapsed time since the first exchange
    const trueElapsed = i * intervalMs;
    const t1 = Math.round(d0 + trueElapsed * (1 - eps));
    // Phone receives half an RTT later, replies immediately (t3 === t2),
    // device sees the reply after the return leg.
    let phoneNow = p0 + trueElapsed + rttMs / 2;
    if (opts.phoneStepAt !== undefined && i >= opts.phoneStepAt) {
      phoneNow += opts.phoneStepMs ?? 0;
    }
    const t2 = Math.round(phoneNow);
    const t3 = t2;
    const t4 = Math.round(t1 + rttMs * (1 - eps));
    out.push({
      t1DeviceMs: t1,
      t4DeviceMs: t4,
      t2PhoneUnixMs: t2,
      t3PhoneUnixMs: t3,
    });
  }
  return out;
}

describe('VTX v1.2 sync record round-trip', () => {
  test('encode → decode returns identical sync records', () => {
    const sync = syntheticSync(12, 30);
    const encoder = new VTXEncoder({ sampleRate: 104, includeSync: true });
    encoder.addRecords(imuRecords(50));
    encoder.addSyncRecords(sync);

    const decoded = new VTXDecoder(encoder.encode()).decode();

    expect(decoded.syncRecords).toBeDefined();
    expect(decoded.syncRecords).toHaveLength(sync.length);
    expect(decoded.syncRecords).toEqual(sync);
  });

  test('header carries sync offset and count, version is 1.2', () => {
    const encoder = new VTXEncoder({ sampleRate: 104, includeSync: true });
    encoder.addRecords(imuRecords(10));
    encoder.addSyncRecords(syntheticSync(3, 20));

    const header = new VTXDecoder(encoder.encode()).readHeader();

    expect(header.versionMajor).toBe(1);
    expect(header.versionMinor).toBe(2);
    expect(header.syncRecordCount).toBe(3);
    expect(header.syncDataOffset).toBeGreaterThan(0);
  });

  test('sync section is placed after the IMU records', () => {
    const encoder = new VTXEncoder({ sampleRate: 104, includeSync: true });
    encoder.addRecords(imuRecords(40));
    encoder.addSyncRecords(syntheticSync(5, 20));

    const buffer = encoder.encode();
    const header = new VTXDecoder(buffer).readHeader();

    const imuEnd = header.dataOffset + 40 * 28;
    expect(header.syncDataOffset).toBe(imuEnd);
    // 5 records * 24 bytes, and nothing beyond
    expect(buffer.byteLength).toBe(imuEnd + 5 * 24);
  });

  test('IMU records are unchanged by the presence of a sync section', () => {
    const imu = imuRecords(30);

    const plain = new VTXEncoder({ sampleRate: 104 });
    plain.addRecords(imu);
    const withoutSync = new VTXDecoder(plain.encode()).decode();

    const withSyncEnc = new VTXEncoder({ sampleRate: 104, includeSync: true });
    withSyncEnc.addRecords(imu);
    withSyncEnc.addSyncRecords(syntheticSync(4, 25));
    const withSync = new VTXDecoder(withSyncEnc.encode()).decode();

    expect(withSync.records).toEqual(withoutSync.records);
  });

  test('a file with no sync records reports none', () => {
    const encoder = new VTXEncoder({ sampleRate: 104, includeSync: true });
    encoder.addRecords(imuRecords(10));

    const decoded = new VTXDecoder(encoder.encode()).decode();
    expect(decoded.syncRecords).toBeUndefined();
    expect(new VTXDecoder(encoder.encode()).getSyncRecordCount()).toBe(0);
  });

  test('addSyncRecord throws when the stream is not enabled', () => {
    const encoder = new VTXEncoder({ sampleRate: 104 });
    encoder.addRecords(imuRecords(5));
    expect(() => encoder.addSyncRecord(syntheticSync(1, 0)[0])).toThrow(
      /not enabled/
    );
  });
});

describe('backward compatibility with real recordings', () => {
  const files = fs.existsSync(SAMPLE_DIR)
    ? fs.readdirSync(SAMPLE_DIR).filter((f) => f.endsWith('.vtx'))
    : [];

  test('sample-recordings directory is present and populated', () => {
    // Guards against the suite silently passing with zero real files.
    expect(files.length).toBeGreaterThan(0);
  });

  test.each(files)('%s still parses and exposes no sync stream', (name) => {
    const buf = fs.readFileSync(path.join(SAMPLE_DIR, name));
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

    const decoder = new VTXDecoder(ab as ArrayBuffer);
    const header = decoder.readHeader();

    expect(header.magic).toBe('VTX\0');
    expect(header.versionMajor).toBe(1);
    // Every existing file predates v1.2
    expect(header.versionMinor).toBeLessThan(2);
    expect(header.syncRecordCount).toBeUndefined();
    expect(header.syncDataOffset).toBeUndefined();
    expect(decoder.getSyncRecordCount()).toBe(0);

    // The IMU stream must still be readable — spot-check the first record
    // rather than decoding tens of MB for every file.
    if (Number(header.recordCount) > 0) {
      const first = decoder.readRecord(0);
      expect(Number.isFinite(first.accelX)).toBe(true);
      expect(Number.isFinite(first.gyroZ)).toBe(true);
    }
  });
});

describe('forward compatibility', () => {
  test('a v1.2 file is fully readable by paths that ignore sync data', () => {
    const imu = imuRecords(100);
    const encoder = new VTXEncoder({ sampleRate: 104, includeSync: true });
    encoder.addRecords(imu);
    encoder.addSyncRecords(syntheticSync(8, 30));
    const buffer = encoder.encode();

    // Simulate a reader that only knows about the IMU array: it uses
    // dataOffset + recordCount and never looks at bytes 58-63.
    const decoder = new VTXDecoder(buffer);
    const header = decoder.readHeader();
    const records = decoder.readRecords(0, Number(header.recordCount));

    expect(records).toHaveLength(imu.length);
    expect(records[0].accelX).toBeCloseTo(imu[0].accelX, 5);
    expect(records[99].accelX).toBeCloseTo(imu[99].accelX, 5);
  });

  test('recoveryMode does not miscount the sync section as IMU records', () => {
    const encoder = new VTXEncoder({ sampleRate: 104, includeSync: true });
    encoder.addRecords(imuRecords(200));
    encoder.addSyncRecords(syntheticSync(20, 30));

    const decoded = new VTXDecoder(encoder.encode()).decode({
      recoveryMode: true,
    });

    // 20 sync records * 24B = 480B, which would otherwise read as ~17 extra
    // 28-byte IMU records.
    expect(decoded.records).toHaveLength(200);
  });
});

describe('drift fit', () => {
  test('recovers a known drift rate', () => {
    for (const ppm of [5, 30, -18, 75]) {
      const fit = computeClockDrift(syntheticSync(60, ppm, { rttMs: 0 }));
      expect(fit.ppm).toBeCloseTo(ppm, 1);
      expect(fit.trustworthy).toBe(true);
    }
  });

  test('recovers drift despite symmetric BLE latency', () => {
    // A constant symmetric RTT is exactly what the four-timestamp estimator
    // cancels; it must not bias the slope.
    const fit = computeClockDrift(syntheticSync(60, 30, { rttMs: 120 }));
    expect(fit.ppm).toBeCloseTo(30, 1);
    expect(fit.residualRmsMs).toBeLessThan(2);
  });

  test('correction function maps device time to true time', () => {
    const ppm = 40;
    const sync = syntheticSync(60, ppm, { rttMs: 0 });
    const fit = computeClockDrift(sync);

    // One hour of device time past the first sample
    const deviceAtHour = sync[0].t1DeviceMs + 3_600_000;
    const corrected = fit.correct(deviceAtHour);

    // True unix time at that device instant: device advanced 3.6e6 ms while
    // true time advanced 3.6e6/(1-eps).
    const eps = ppm / 1e6;
    const expected =
      sync[0].t2PhoneUnixMs + 3_600_000 / (1 - eps);
    expect(corrected).toBeCloseTo(expected, 0);

    // Sanity: the correction is worth ~144ms at 40ppm over an hour
    expect(corrected - deviceAtHour - fit.offsetAtT0Ms).toBeCloseTo(144, 0);
  });

  test('reports residual and span', () => {
    const fit = computeClockDrift(syntheticSync(60, 30, { rttMs: 0 }));
    expect(fit.residualRmsMs).toBeLessThan(1);
    expect(fit.residualMaxMs).toBeLessThan(2);
    expect(fit.spanMs).toBeCloseTo(59 * 60_000, -3);
    expect(fit.used).toHaveLength(60);
    expect(fit.rejected).toHaveLength(0);
  });

  test('down-weights and reports large RTT outliers', () => {
    const sync = syntheticSync(60, 30, { rttMs: 40 });
    // Poison three samples with a stalled radio: the device saw a long round
    // trip that the phone did not account for.
    for (const i of [10, 25, 40]) {
      sync[i] = { ...sync[i], t4DeviceMs: sync[i].t4DeviceMs + 3000 };
    }

    const fit = computeClockDrift(sync);

    expect(fit.rejected.length).toBe(3);
    expect(fit.used).toHaveLength(57);
    expect(fit.rejected.every((r) => /RTT/.test(r.reason))).toBe(true);
    // The fit survives the outliers
    expect(fit.ppm).toBeCloseTo(30, 0);
  });

  test('an unfiltered outlier would have corrupted the fit', () => {
    // Establishes that RTT filtering is doing real work, not decoration.
    // A single stalled exchange at the end of the recording drags the slope
    // badly: the offset estimator charges half the unexplained 3s to the
    // clock difference, at a point with maximum leverage on the fit.
    const sync = syntheticSync(20, 30, { rttMs: 40 });
    sync[19] = { ...sync[19], t4DeviceMs: sync[19].t4DeviceMs + 3000 };

    // Both filter layers disabled — the absolute cap and the relative
    // median rule each catch this sample on their own.
    const unfiltered = computeClockDrift(sync, {
      maxRttMs: Number.MAX_SAFE_INTEGER,
      rttOutlierFactor: Number.MAX_SAFE_INTEGER,
    });
    const filtered = computeClockDrift(sync);

    expect(unfiltered.used).toHaveLength(20);
    expect(filtered.used).toHaveLength(19);

    // Unfiltered, the recovered rate is not merely off — it flips sign.
    expect(Math.abs(unfiltered.ppm - 30)).toBeGreaterThan(100);
    expect(filtered.ppm).toBeCloseTo(30, 0);

    // And the caller is warned rather than silently misled.
    expect(unfiltered.trustworthy).toBe(false);
  });

  test('either RTT filter alone catches a stalled exchange', () => {
    const sync = syntheticSync(20, 30, { rttMs: 40 });
    sync[19] = { ...sync[19], t4DeviceMs: sync[19].t4DeviceMs + 3000 };

    // Absolute cap only
    const absOnly = computeClockDrift(sync, {
      rttOutlierFactor: Number.MAX_SAFE_INTEGER,
    });
    expect(absOnly.rejected.map((r) => r.reason)).toEqual([
      expect.stringMatching(/> 500ms/),
    ]);

    // Relative median rule only
    const relOnly = computeClockDrift(sync, {
      maxRttMs: Number.MAX_SAFE_INTEGER,
    });
    expect(relOnly.rejected.map((r) => r.reason)).toEqual([
      expect.stringMatching(/4x median/),
    ]);

    expect(absOnly.ppm).toBeCloseTo(30, 0);
    expect(relOnly.ppm).toBeCloseTo(30, 0);
  });
});

describe('drift fit — degenerate cases', () => {
  test('zero sync records: identity correction, not trustworthy', () => {
    const fit = computeClockDrift([]);
    expect(fit.ppm).toBe(0);
    expect(fit.used).toHaveLength(0);
    expect(fit.trustworthy).toBe(false);
    expect(fit.warnings[0]).toMatch(/no sync records/);
    expect(fit.correct(123456)).toBe(123456);
  });

  test('one sync record: constant offset, no rate', () => {
    const sync = syntheticSync(1, 30, { rttMs: 40 });
    const fit = computeClockDrift(sync);

    expect(fit.ppm).toBe(0);
    expect(fit.trustworthy).toBe(false);
    expect(fit.warnings[0]).toMatch(/single sync record/);

    const obs = toObservation(sync[0]);
    expect(fit.correct(sync[0].t1DeviceMs)).toBeCloseTo(
      sync[0].t1DeviceMs + obs.offsetMs,
      6
    );
  });

  test('two sync records: fits, but flagged as poorly constrained', () => {
    const fit = computeClockDrift(syntheticSync(2, 30, { rttMs: 0 }));
    expect(fit.used).toHaveLength(2);
    expect(fit.trustworthy).toBe(false);
    expect(fit.warnings.some((w) => /poorly constrained/.test(w))).toBe(true);
  });

  test('all records rejected leaves a usable, untrustworthy result', () => {
    const sync = syntheticSync(10, 30, { rttMs: 5000 });
    const fit = computeClockDrift(sync);

    expect(fit.used).toHaveLength(0);
    expect(fit.rejected).toHaveLength(10);
    expect(fit.trustworthy).toBe(false);
    expect(fit.warnings[0]).toMatch(/rejected as unusable/);
    expect(fit.correct(999)).toBe(999);
  });

  test('negative RTT is rejected as physically impossible', () => {
    const sync = syntheticSync(6, 30, { rttMs: 20 });
    // Phone claims to have spent longer than the entire round trip
    sync[2] = {
      ...sync[2],
      t3PhoneUnixMs: sync[2].t2PhoneUnixMs + 5000,
    };

    const fit = computeClockDrift(sync);
    expect(fit.rejected.some((r) => r.reason === 'negative RTT')).toBe(true);
  });

  test('identical device timestamps produce no slope rather than a divide error', () => {
    const one = syntheticSync(1, 0)[0];
    const fit = computeClockDrift([one, { ...one }, { ...one }]);

    expect(Number.isFinite(fit.ppm)).toBe(true);
    expect(fit.ppm).toBe(0);
    expect(fit.trustworthy).toBe(false);
    expect(fit.warnings.some((w) => /one device timestamp/.test(w))).toBe(true);
  });

  test('a short sync span is flagged even when the fit is clean', () => {
    const fit = computeClockDrift(
      syntheticSync(5, 30, { intervalMs: 60_000, rttMs: 0 })
    );
    // 4 minutes of span
    expect(fit.trustworthy).toBe(false);
    expect(fit.warnings.some((w) => /short/.test(w))).toBe(true);
  });
});

describe('phone clock steps', () => {
  test('a mid-recording NTP step is detected', () => {
    const sync = syntheticSync(40, 30, {
      rttMs: 20,
      phoneStepAt: 20,
      phoneStepMs: 1200,
    });

    const steps = detectClockSteps(sync.map((r, i) => toObservation(r, i)));
    expect(steps).toContain(20);

    const fit = computeClockDrift(sync);
    expect(fit.suspectedSteps.length).toBeGreaterThan(0);
    expect(fit.trustworthy).toBe(false);
    expect(fit.warnings.some((w) => /clock step/.test(w))).toBe(true);
  });

  test('smooth drift produces no false step detections', () => {
    const obs = syntheticSync(60, 45, { rttMs: 30 }).map((r, i) =>
      toObservation(r, i)
    );
    expect(detectClockSteps(obs)).toHaveLength(0);
  });

  test('a step corrupts the single-line fit, which is why it is flagged', () => {
    const clean = computeClockDrift(syntheticSync(40, 30, { rttMs: 0 }));
    const stepped = computeClockDrift(
      syntheticSync(40, 30, { rttMs: 0, phoneStepAt: 20, phoneStepMs: 1200 })
    );

    expect(clean.ppm).toBeCloseTo(30, 1);
    // The line absorbs the step as slope error — the reported ppm is wrong,
    // and the caller is told not to trust it.
    expect(Math.abs(stepped.ppm - 30)).toBeGreaterThan(50);
    expect(stepped.trustworthy).toBe(false);
  });
});
