/**
 * Timestamp reconstruction for VTX IMU records.
 *
 * The firmware captures `millis()` once per FIFO read and stamps every sample
 * in that batch with it (`sensor_manager.cpp:107,121`). Two artifacts follow:
 *
 *  1. **Duplicate timestamps.** `loop()` runs without delay, so it normally
 *     out-runs the 60-sample FIFO threshold and finds a single sample waiting.
 *     Runs of shared timestamps appear only when the loop stalls — SD write,
 *     BLE push, WiFi tick — and a backlog accumulates. The run-length
 *     distribution is therefore a direct measure of loop-latency events.
 *  2. **Quantization.** `millis()` has 1 ms resolution against a 9.615 ms
 *     sample period, so deltas quantize to 9/10/11 ms.
 *
 * This module addresses (1). **It cannot address (2)** — the ~1 ms
 * quantization is a property of the source observation and is irreducible in
 * post-processing. Reconstruction places samples *within* a batch; it cannot
 * make the batch's own anchor more precise than the clock that recorded it.
 *
 * Method — anchored, per-batch, backward distribution:
 *
 *   Each run of identical timestamps is one FIFO read. The recorded time is
 *   when the read completed, so the samples in it were captured *before* that
 *   instant, at the nominal sample interval. A run of length n ending at time
 *   t is placed at t - (n-1)*dt, ..., t - dt, t.
 *
 * Every batch re-anchors on a real recorded observation. That is the whole
 * point: a dropped sample perturbs one interval instead of shifting
 * everything downstream.
 *
 * **Deliberately NOT `start + i / rate`.** Global indexing assumes zero
 * dropped samples for an entire recording. One FIFO overflow, I2C failure, or
 * SD stall silently shifts every subsequent timestamp, permanently and
 * cumulatively — worse than the problem being solved. Where elapsed time
 * between batches exceeds what the sample count accounts for, this module
 * flags a gap and does not interpolate across it.
 *
 * Composes with computeClockDrift(): reconstruction fixes intra-batch
 * placement in the device time base, drift correction maps the device time
 * base to true time. See `reconstructAndCorrect()`.
 */

import { IMURecord, VTXHeader } from './types';

function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** One run of samples sharing a single recorded timestamp — one FIFO read. */
export interface BatchRun {
  /** Index of the first sample of the run in the input array */
  startIndex: number;
  /** Number of samples sharing the timestamp */
  length: number;
  /** The stored timestamp shared by every sample in the run */
  timestampMs: number;
}

/** A stretch of time where samples are missing from the record. */
export interface TimestampGap {
  /** Index of the last sample before the gap */
  beforeIndex: number;
  /** Index of the first sample after the gap */
  afterIndex: number;
  /** Stored timestamp of the sample before the gap */
  startMs: number;
  /** Stored timestamp of the sample after the gap */
  endMs: number;
  /** Wall-clock span of the gap in ms */
  durationMs: number;
  /** How many samples the elapsed time implies are missing */
  missingSamples: number;
}

export interface TimestampQualityReport {
  /** Samples examined */
  sampleCount: number;
  /** Number of FIFO-read batches identified (runs of equal timestamps) */
  runCount: number;
  /** Count of runs of length > 1 — i.e. observed loop-stall events */
  multiSampleRunCount: number;
  /** Longest run of samples sharing one timestamp */
  longestRun: number;
  /** Histogram of run length -> number of runs of that length */
  runLengthHistogram: Record<number, number>;
  /** Samples that shared a timestamp with at least one neighbour */
  duplicateTimestampSamples: number;
  /** Samples whose timestamp this pass actually moved */
  adjustedSamples: number;
  /** Detected gaps where samples appear to have been dropped */
  gaps: TimestampGap[];
  /** Total samples implied missing across all gaps */
  totalMissingSamples: number;
  /** Nominal sample interval used, in ms (from the header sample rate) */
  nominalIntervalMs: number;
  /** Sample rate used, in Hz */
  sampleRateHz: number;
  /**
   * Median interval actually observed between consecutive batches, in ms.
   * NaN when there are too few batches to measure one.
   */
  observedIntervalMs: number;
  /**
   * Rate implied by the observed interval, in Hz. Compare against
   * sampleRateHz: a material disagreement means the header does not describe
   * the data, and gap detection cannot be meaningful.
   */
  observedRateHz: number;
  /** Whether the header's rate is contradicted by the observed cadence */
  rateMismatch: boolean;
  /** Largest absolute shift applied to any timestamp, in ms */
  maxAdjustmentMs: number;
  /** Whether stored timestamps were already non-monotonic on input */
  nonMonotonicInput: boolean;
  /** Indices where stored timestamps went backwards */
  nonMonotonicIndices: number[];
  /**
   * Whether the reconstruction is trustworthy for this file. False when the
   * input is degenerate or violates the assumptions the method rests on.
   * Same spirit as ClockDriftFit.trustworthy.
   */
  trustworthy: boolean;
  /** Human-readable reasons the result is not trustworthy (empty if it is) */
  warnings: string[];
}

export interface TimestampReconstructionResult {
  /** Reconstructed timestamps, one per input record, in input order */
  timestamps: number[];
  /** The stored timestamps, unchanged — the raw record stays available */
  originalTimestamps: number[];
  /** Quality and diagnostics */
  report: TimestampQualityReport;
}

export interface TimestampReconstructionOptions {
  /**
   * Sample rate in Hz. Normally read from the file header — pass this only to
   * override. V1 files run at 10-50 Hz and V2 at 104 Hz; the rate is always
   * taken from the header rather than assumed, so a 20 Hz file is never
   * treated as 104 Hz.
   */
  sampleRateHz?: number;
  /**
   * A gap is declared when elapsed time between consecutive batches exceeds
   * what the samples account for by more than this many nominal intervals.
   * Default 1.5 — below that the discrepancy is millis() quantization
   * (deltas land on 9/10/11 ms against a 9.615 ms period), not a real drop.
   */
  gapThresholdIntervals?: number;
  /**
   * Clamp reconstructed times so a backward-distributed run cannot start at
   * or before the previous sample's reconstructed time. Default true.
   * Guarantees monotonicity, which every downstream windowing consumer needs.
   */
  enforceMonotonic?: boolean;
  /**
   * Fractional disagreement between the header rate and the observed cadence
   * above which the header is treated as not describing the data. Default
   * 0.15 (15%). Some early V1 files declare a rate the samples do not follow;
   * gap detection against a wrong nominal interval is meaningless, so it is
   * suppressed and the result marked untrustworthy instead.
   */
  rateMismatchTolerance?: number;
}

const DEFAULT_GAP_THRESHOLD_INTERVALS = 1.5;

/** Minimum batches before the observed-cadence check can override the header. */
const MIN_RATE_CHECK_BATCHES = 20;

/**
 * Group consecutive samples that share a stored timestamp. Each run is one
 * FIFO read.
 */
export function findBatchRuns(timestamps: number[]): BatchRun[] {
  const runs: BatchRun[] = [];
  if (timestamps.length === 0) return runs;

  let startIndex = 0;
  for (let i = 1; i <= timestamps.length; i++) {
    if (i === timestamps.length || timestamps[i] !== timestamps[startIndex]) {
      runs.push({
        startIndex,
        length: i - startIndex,
        timestampMs: timestamps[startIndex],
      });
      startIndex = i;
    }
  }
  return runs;
}

/**
 * Reconstruct per-sample timestamps from stored batch timestamps.
 *
 * Non-destructive: returns new arrays and never mutates the input. Degenerate
 * inputs never throw — they are reported through `trustworthy` / `warnings`.
 */
export function reconstructTimestamps(
  timestamps: number[],
  sampleRateHz: number,
  options: TimestampReconstructionOptions = {}
): TimestampReconstructionResult {
  const gapThresholdIntervals =
    options.gapThresholdIntervals ?? DEFAULT_GAP_THRESHOLD_INTERVALS;
  const enforceMonotonic = options.enforceMonotonic ?? true;
  const rateMismatchTolerance = options.rateMismatchTolerance ?? 0.15;

  const warnings: string[] = [];
  const original = [...timestamps];

  const rateValid = Number.isFinite(sampleRateHz) && sampleRateHz > 0;
  if (!rateValid) {
    warnings.push(
      `sample rate ${sampleRateHz} is not a positive number: cannot place samples within a batch`
    );
  }
  const dt = rateValid ? 1000 / sampleRateHz : 0;

  // --- degenerate inputs: report, never throw ---
  if (timestamps.length === 0) {
    warnings.push('no samples: nothing to reconstruct');
    return {
      timestamps: [],
      originalTimestamps: original,
      report: emptyReport(0, sampleRateHz, dt, warnings),
    };
  }

  if (!rateValid) {
    // Without a valid interval the only honest answer is the stored times.
    return {
      timestamps: original,
      originalTimestamps: original,
      report: {
        ...emptyReport(timestamps.length, sampleRateHz, dt, warnings),
        runCount: findBatchRuns(timestamps).length,
      },
    };
  }

  if (timestamps.length === 1) {
    warnings.push('single sample: no batch structure to reconstruct');
    return {
      timestamps: [...original],
      originalTimestamps: original,
      report: {
        ...emptyReport(1, sampleRateHz, dt, warnings),
        runCount: 1,
        longestRun: 1,
        runLengthHistogram: { 1: 1 },
      },
    };
  }

  // Non-monotonic stored input is a corrupt or merged file. Report it rather
  // than silently producing plausible-looking output.
  const nonMonotonicIndices: number[] = [];
  for (let i = 1; i < timestamps.length; i++) {
    if (timestamps[i] < timestamps[i - 1]) nonMonotonicIndices.push(i);
  }
  if (nonMonotonicIndices.length > 0) {
    warnings.push(
      `${nonMonotonicIndices.length} stored timestamp(s) go backwards ` +
        `(first at index ${nonMonotonicIndices[0]}): file may be corrupt or ` +
        `improperly merged; reconstruction is unreliable here`
    );
  }

  const runs = findBatchRuns(timestamps);

  // --- backward distribution within each run ---
  //
  // The recorded timestamp is when the FIFO read completed, so it belongs to
  // the LAST sample of the run. Earlier samples step back by dt.
  const out = new Array<number>(timestamps.length);
  for (const run of runs) {
    const last = run.startIndex + run.length - 1;
    for (let k = 0; k < run.length; k++) {
      const i = run.startIndex + k;
      out[i] = run.timestampMs - (last - i) * dt;
    }
  }

  // --- monotonicity ---
  //
  // A long stall can push a run's backward-distributed start before the
  // previous sample. Clamping keeps the series usable by windowing consumers
  // without inventing a different anchor; the run still ends on its recorded
  // observation.
  let clampedRuns = 0;
  if (enforceMonotonic) {
    for (let i = 1; i < out.length; i++) {
      if (out[i] <= out[i - 1]) {
        // Nudge forward by a small fraction of dt: enough to stay strictly
        // ordered, small enough not to misrepresent the sample instant.
        out[i] = out[i - 1] + dt * 1e-3;
        clampedRuns++;
      }
    }
  }

  // --- gap detection between consecutive batches ---
  //
  // Compare elapsed wall time against what the intervening samples account
  // for. An excess beyond the quantization noise floor means samples were
  // dropped. Flag it; never interpolate across it.
  //
  // First: does the header's rate actually describe this data? Some early V1
  // files declare a rate the samples do not follow (a 20Hz header over 25Hz
  // data, for instance). Detecting "gaps" against a wrong nominal interval
  // would flag every ordinary interval, so measure the real cadence and
  // suppress gap detection when the two disagree materially.
  const interBatchDeltas: number[] = [];
  for (let r = 1; r < runs.length; r++) {
    const d = runs[r].timestampMs - runs[r - 1].timestampMs;
    if (d > 0) interBatchDeltas.push(d);
  }
  const observedIntervalMs =
    interBatchDeltas.length > 0 ? median(interBatchDeltas) : NaN;
  const observedRateHz = Number.isFinite(observedIntervalMs)
    ? 1000 / observedIntervalMs
    : NaN;
  // Below MIN_RATE_CHECK_BATCHES a single real gap dominates the median, so a
  // wrong header and a genuinely gappy file are indistinguishable. Prefer
  // reporting gaps in that case.
  const rateMismatch =
    interBatchDeltas.length >= MIN_RATE_CHECK_BATCHES &&
    Number.isFinite(observedIntervalMs) &&
    Math.abs(observedIntervalMs - dt) / dt > rateMismatchTolerance;

  if (rateMismatch) {
    warnings.push(
      `header declares ${sampleRateHz}Hz (${dt.toFixed(2)}ms) but the data ` +
        `cadence is ~${observedRateHz.toFixed(1)}Hz ` +
        `(${observedIntervalMs.toFixed(2)}ms): the header does not describe ` +
        `this file, so intra-batch placement uses the wrong interval and gap ` +
        `detection is suppressed`
    );
  }

  const gaps: TimestampGap[] = [];
  for (let r = 1; !rateMismatch && r < runs.length; r++) {
    const prev = runs[r - 1];
    const cur = runs[r];
    const elapsed = cur.timestampMs - prev.timestampMs;
    if (elapsed <= 0) continue; // non-monotonic; already reported

    // Samples recorded in `cur` account for cur.length intervals of the
    // elapsed time between the two anchors.
    const accounted = cur.length * dt;
    const excess = elapsed - accounted;
    if (excess > gapThresholdIntervals * dt) {
      const missing = Math.round(excess / dt);
      if (missing > 0) {
        const beforeIndex = prev.startIndex + prev.length - 1;
        gaps.push({
          beforeIndex,
          afterIndex: cur.startIndex,
          startMs: prev.timestampMs,
          endMs: cur.timestampMs,
          durationMs: elapsed,
          missingSamples: missing,
        });
      }
    }
  }

  // --- statistics ---
  const runLengthHistogram: Record<number, number> = {};
  let longestRun = 0;
  let multiSampleRunCount = 0;
  let duplicateTimestampSamples = 0;
  for (const run of runs) {
    runLengthHistogram[run.length] = (runLengthHistogram[run.length] ?? 0) + 1;
    if (run.length > longestRun) longestRun = run.length;
    if (run.length > 1) {
      multiSampleRunCount++;
      duplicateTimestampSamples += run.length;
    }
  }

  let adjustedSamples = 0;
  let maxAdjustmentMs = 0;
  for (let i = 0; i < out.length; i++) {
    const delta = Math.abs(out[i] - original[i]);
    if (delta > 0) adjustedSamples++;
    if (delta > maxAdjustmentMs) maxAdjustmentMs = delta;
  }

  const totalMissingSamples = gaps.reduce((s, g) => s + g.missingSamples, 0);

  // --- trust assessment ---
  if (gaps.length > 0) {
    warnings.push(
      `${gaps.length} gap(s) detected totalling ~${totalMissingSamples} missing ` +
        `sample(s): timestamps are correct on each side but the record is ` +
        `incomplete across them — do not interpolate`
    );
  }
  if (clampedRuns > 0) {
    warnings.push(
      `${clampedRuns} sample(s) required monotonicity clamping: a batch ` +
        `extended back past the previous sample, implying a stall longer than ` +
        `the gap between reads`
    );
  }
  const allIdentical = runs.length === 1 && timestamps.length > 1;
  if (allIdentical) {
    warnings.push(
      `all ${timestamps.length} samples share one timestamp: there is a single ` +
        `anchor, so reconstructed times are a nominal-rate extrapolation ` +
        `backward from it rather than a per-batch fit`
    );
  }

  return {
    timestamps: out,
    originalTimestamps: original,
    report: {
      sampleCount: timestamps.length,
      runCount: runs.length,
      multiSampleRunCount,
      longestRun,
      runLengthHistogram,
      duplicateTimestampSamples,
      adjustedSamples,
      gaps,
      totalMissingSamples,
      nominalIntervalMs: dt,
      sampleRateHz,
      observedIntervalMs,
      observedRateHz,
      rateMismatch,
      maxAdjustmentMs,
      nonMonotonicInput: nonMonotonicIndices.length > 0,
      nonMonotonicIndices,
      trustworthy: warnings.length === 0,
      warnings,
    },
  };
}

function emptyReport(
  sampleCount: number,
  sampleRateHz: number,
  dt: number,
  warnings: string[]
): TimestampQualityReport {
  return {
    sampleCount,
    runCount: 0,
    multiSampleRunCount: 0,
    longestRun: sampleCount > 0 ? 1 : 0,
    runLengthHistogram: {},
    duplicateTimestampSamples: 0,
    adjustedSamples: 0,
    gaps: [],
    totalMissingSamples: 0,
    nominalIntervalMs: dt,
    sampleRateHz,
    observedIntervalMs: NaN,
    observedRateHz: NaN,
    rateMismatch: false,
    maxAdjustmentMs: 0,
    nonMonotonicInput: false,
    nonMonotonicIndices: [],
    trustworthy: false,
    warnings,
  };
}

/**
 * Reconstruct timestamps for a decoded record array, taking the sample rate
 * from the file header.
 *
 * Opt-in and non-destructive: the input records are not mutated and the
 * default decode path never calls this. Returns new records with corrected
 * timestamps alongside the quality report.
 *
 * The rate comes from `header.sampleRate`, so a 20 Hz V1 file is placed at
 * 50 ms intervals and a 104 Hz V2 file at 9.615 ms. No generation is assumed.
 */
export function reconstructRecordTimestamps(
  records: IMURecord[],
  header: Pick<VTXHeader, 'sampleRate'>,
  options: TimestampReconstructionOptions = {}
): { records: IMURecord[]; report: TimestampQualityReport } {
  const rate = options.sampleRateHz ?? header.sampleRate;
  const result = reconstructTimestamps(
    records.map((r) => r.timestamp),
    rate,
    options
  );
  return {
    records: records.map((r, i) => ({ ...r, timestamp: result.timestamps[i] })),
    report: result.report,
  };
}

/**
 * Compose reconstruction with clock-drift correction, in the correct order.
 *
 * The two corrections are orthogonal and must not be double-counted:
 *
 *  - **Reconstruction** works entirely inside the device time base. It fixes
 *    *where within a batch* each sample sits. It does not change the batch
 *    anchors, so it does not change the mapping from device time to true time.
 *  - **Drift correction** maps device time to true unix time, absorbing the
 *    crystal's nominal-vs-actual rate error.
 *
 * So: reconstruct first (in device time), then map each reconstructed value
 * through `correct()` exactly once. Applying drift first and reconstructing
 * afterwards would place samples at the *nominal* interval in corrected time,
 * re-introducing the very rate error the drift fit removed.
 *
 * @param correct A drift correction function, typically `computeClockDrift(...).correct`
 */
export function reconstructAndCorrect(
  records: IMURecord[],
  header: Pick<VTXHeader, 'sampleRate'>,
  correct: (deviceMs: number) => number,
  options: TimestampReconstructionOptions = {}
): { records: IMURecord[]; report: TimestampQualityReport } {
  const { records: reconstructed, report } = reconstructRecordTimestamps(
    records,
    header,
    options
  );
  return {
    records: reconstructed.map((r) => ({ ...r, timestamp: correct(r.timestamp) })),
    report,
  };
}
