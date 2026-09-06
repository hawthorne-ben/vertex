/**
 * Clock drift analysis for VTX v1.2 sync records.
 *
 * Sync records are observations of the device time base, never corrections
 * applied to it. This module turns them into a drift rate, a correction
 * function, and a quality metric that tells a caller whether the fit is
 * trustworthy enough to use.
 *
 * See packages/vtx-format/spec/v1.2-clock-sync.md for the record layout.
 */

import { ClockSyncRecord } from './types';

/** A sync record reduced to a single (device time, clock offset) observation. */
export interface ClockSyncObservation {
  /** Device millis() at the midpoint of the exchange */
  deviceMs: number;
  /** Phone-minus-device clock offset in ms, transport delay cancelled */
  offsetMs: number;
  /** Round-trip time in ms, phone processing removed */
  rttMs: number;
  /** Index of the source record in the input array */
  index: number;
}

export interface ClockDriftOptions {
  /**
   * Discard observations whose RTT exceeds this many ms.
   * Default 500. A BLE exchange at a 30-50ms connection interval normally
   * completes in well under 200ms; anything far above that is a stalled
   * radio, not a measurement.
   */
  maxRttMs?: number;
  /**
   * Discard observations whose RTT exceeds this multiple of the median RTT.
   * Default 4. Catches the case where the whole link is slow and the fixed
   * threshold above is too permissive.
   */
  rttOutlierFactor?: number;
  /**
   * Residual threshold (ms) above which an observation is treated as a
   * step rather than drift. Default 250.
   */
  stepThresholdMs?: number;
}

export interface ClockDriftFit {
  /**
   * Measured drift rate in parts per million. Positive means the device
   * clock runs slow relative to the phone (device millis() advances less
   * than true elapsed time).
   */
  ppm: number;
  /** Fitted offset (ms) at deviceMs = t0 */
  offsetAtT0Ms: number;
  /** Reference device time for the fit (first retained observation) */
  t0DeviceMs: number;
  /** Observations retained after filtering */
  used: ClockSyncObservation[];
  /** Observations discarded, with the reason */
  rejected: Array<ClockSyncObservation & { reason: string }>;
  /** Root-mean-square residual (ms) of retained observations about the fit */
  residualRmsMs: number;
  /** Largest absolute residual (ms) */
  residualMaxMs: number;
  /** Span of retained observations in ms of device time */
  spanMs: number;
  /**
   * Whether the fit is trustworthy. False when there are too few points,
   * too short a span, or residuals large enough to suggest the linear
   * model does not hold (a phone clock step, most likely).
   */
  trustworthy: boolean;
  /** Human-readable reasons the fit is not trustworthy (empty if it is) */
  warnings: string[];
  /**
   * Map a device millis() value to estimated true unix ms.
   * Always defined — degrades to the best available estimate, and to the
   * identity-with-offset when only one observation exists.
   */
  correct: (deviceMs: number) => number;
  /**
   * Indices of observations that look like a discontinuity (phone clock
   * step) rather than drift. See detectClockSteps().
   */
  suspectedSteps: number[];
}

/**
 * Reduce a sync record to an offset/RTT observation using the NTP estimator.
 *
 *   offset = ((t2 - t1) + (t3 - t4)) / 2
 *   rtt    = (t4 - t1) - (t3 - t2)
 *
 * t1/t4 are device millis(); t2/t3 are phone unix ms. The two clocks have
 * different epochs, so `offset` is the epoch difference — that is exactly
 * the quantity whose drift we want.
 */
export function toObservation(
  record: ClockSyncRecord,
  index: number = 0
): ClockSyncObservation {
  const { t1DeviceMs, t2PhoneUnixMs, t3PhoneUnixMs, t4DeviceMs } = record;
  const offsetMs =
    (t2PhoneUnixMs - t1DeviceMs + (t3PhoneUnixMs - t4DeviceMs)) / 2;
  const rttMs = t4DeviceMs - t1DeviceMs - (t3PhoneUnixMs - t2PhoneUnixMs);
  return {
    deviceMs: (t1DeviceMs + t4DeviceMs) / 2,
    offsetMs,
    rttMs,
    index,
  };
}

function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Flag observations whose offset jumps discontinuously relative to their
 * neighbours — the signature of the phone's own clock stepping (an NTP
 * correction mid-ride), as opposed to the device crystal drifting.
 *
 * Crystal drift is slow and monotonic: at 50ppm the offset moves 3ms per
 * minute. A phone NTP correction moves it by tens or hundreds of ms between
 * two adjacent samples. This looks at the first difference of the offset
 * series and flags points where it exceeds `stepThresholdMs` above what the
 * surrounding cadence would predict.
 *
 * Returns indices into the observation array. With fewer than 3 observations
 * a step is indistinguishable from drift and nothing is flagged.
 */
export function detectClockSteps(
  obs: ClockSyncObservation[],
  stepThresholdMs: number = 250
): number[] {
  if (obs.length < 3) return [];

  const steps: number[] = [];
  // Per-ms drift implied by each adjacent pair
  const slopes: number[] = [];
  for (let i = 1; i < obs.length; i++) {
    const dt = obs[i].deviceMs - obs[i - 1].deviceMs;
    if (dt <= 0) continue;
    slopes.push((obs[i].offsetMs - obs[i - 1].offsetMs) / dt);
  }
  const medSlope = median(slopes);

  for (let i = 1; i < obs.length; i++) {
    const dt = obs[i].deviceMs - obs[i - 1].deviceMs;
    if (dt <= 0) continue;
    const predicted = obs[i - 1].offsetMs + medSlope * dt;
    if (Math.abs(obs[i].offsetMs - predicted) > stepThresholdMs) {
      steps.push(i);
    }
  }
  return steps;
}

/**
 * Fit clock drift from sync records.
 *
 * Method: ordinary least squares of offset against device time, after
 * rejecting high-RTT observations.
 *
 * Why linear. Crystal frequency error is dominated by a fixed manufacturing
 * offset plus a temperature coefficient. Over a ride the manufacturing term
 * is constant, so the offset accumulates linearly in time and a straight
 * line is the correct model. The residual tells you when that assumption
 * fails.
 *
 * Where it breaks:
 *  - **Thermal transients.** A tuning-fork crystal's frequency follows a
 *    parabola in temperature (roughly -0.035 ppm/degC^2 about a ~25C turnover).
 *    A device that starts indoors and is ridden into cold air sweeps that
 *    curve, and drift rate is genuinely not constant. This shows up as
 *    structured — not random — residuals, which is why residualRmsMs is
 *    reported rather than just an R-squared.
 *  - **A phone clock step.** NTP correcting the phone mid-ride moves the
 *    offset discontinuously. A single OLS line absorbs it as a slope error
 *    across the whole recording. detectClockSteps() flags this; the caller
 *    should refit per-segment rather than trusting one line.
 *  - **Short spans.** Over 60s of observations, BLE latency noise of tens of
 *    ms dominates a drift of microseconds. The fit is reported but marked
 *    untrustworthy.
 *
 * Degenerate inputs never throw:
 *  - zero records -> ppm 0, correct() is identity on the device base, untrustworthy
 *  - one record   -> constant offset, no rate, untrustworthy
 */
export function computeClockDrift(
  records: ClockSyncRecord[],
  options: ClockDriftOptions = {}
): ClockDriftFit {
  const maxRttMs = options.maxRttMs ?? 500;
  const rttOutlierFactor = options.rttOutlierFactor ?? 4;
  const stepThresholdMs = options.stepThresholdMs ?? 250;

  const all = records.map((r, i) => toObservation(r, i));
  all.sort((a, b) => a.deviceMs - b.deviceMs);

  const rejected: Array<ClockSyncObservation & { reason: string }> = [];
  const warnings: string[] = [];

  // Negative RTT is physically impossible: the phone reported a longer
  // processing time than the whole device-observed round trip. Clock
  // granularity or a misbehaving responder.
  let candidates = all.filter((o) => {
    if (!Number.isFinite(o.offsetMs) || !Number.isFinite(o.rttMs)) {
      rejected.push({ ...o, reason: 'non-finite timestamps' });
      return false;
    }
    if (o.rttMs < 0) {
      rejected.push({ ...o, reason: 'negative RTT' });
      return false;
    }
    if (o.rttMs > maxRttMs) {
      rejected.push({ ...o, reason: `RTT ${o.rttMs.toFixed(0)}ms > ${maxRttMs}ms` });
      return false;
    }
    return true;
  });

  // Relative RTT filter, once there are enough points for a median to mean
  // anything.
  if (candidates.length >= 4) {
    const medRtt = median(candidates.map((o) => o.rttMs));
    const limit = medRtt * rttOutlierFactor;
    // Only meaningful if the median is non-trivial; with a sub-ms median
    // every real sample would trip a 4x rule.
    if (medRtt >= 5) {
      candidates = candidates.filter((o) => {
        if (o.rttMs > limit) {
          rejected.push({
            ...o,
            reason: `RTT ${o.rttMs.toFixed(0)}ms > ${rttOutlierFactor}x median (${medRtt.toFixed(0)}ms)`,
          });
          return false;
        }
        return true;
      });
    }
  }

  const suspectedSteps = detectClockSteps(candidates, stepThresholdMs);

  // --- degenerate cases ---
  if (candidates.length === 0) {
    warnings.push(
      all.length === 0
        ? 'no sync records: device clock cannot be characterized'
        : 'all sync records rejected as unusable'
    );
    return {
      ppm: 0,
      offsetAtT0Ms: 0,
      t0DeviceMs: 0,
      used: [],
      rejected,
      residualRmsMs: 0,
      residualMaxMs: 0,
      spanMs: 0,
      trustworthy: false,
      warnings,
      // No information: pass device time through unchanged.
      correct: (deviceMs: number) => deviceMs,
      suspectedSteps: [],
    };
  }

  if (candidates.length === 1) {
    const only = candidates[0];
    warnings.push('single sync record: offset known, drift rate unknowable');
    return {
      ppm: 0,
      offsetAtT0Ms: only.offsetMs,
      t0DeviceMs: only.deviceMs,
      used: candidates,
      rejected,
      residualRmsMs: 0,
      residualMaxMs: 0,
      spanMs: 0,
      trustworthy: false,
      warnings,
      // Best available: a constant offset, exactly what the pre-v1.2
      // single CMD_SYNC_CLOCK gave us.
      correct: (deviceMs: number) => deviceMs + only.offsetMs,
      suspectedSteps: [],
    };
  }

  // --- ordinary least squares ---
  const t0 = candidates[0].deviceMs;
  const n = candidates.length;
  let sx = 0;
  let sy = 0;
  for (const o of candidates) {
    sx += o.deviceMs - t0;
    sy += o.offsetMs;
  }
  const mx = sx / n;
  const my = sy / n;

  let sxy = 0;
  let sxx = 0;
  for (const o of candidates) {
    const dx = o.deviceMs - t0 - mx;
    sxy += dx * (o.offsetMs - my);
    sxx += dx * dx;
  }

  const spanMs = candidates[n - 1].deviceMs - candidates[0].deviceMs;

  // slope is ms of offset per ms of device time — dimensionless, so ppm is
  // a direct 1e6 scaling.
  const slope = sxx > 0 ? sxy / sxx : 0;
  const intercept = my - slope * mx;

  if (sxx === 0) {
    warnings.push('all sync records share one device timestamp: no time base to fit');
  }

  let sumSq = 0;
  let maxAbs = 0;
  for (const o of candidates) {
    const predicted = intercept + slope * (o.deviceMs - t0);
    const resid = o.offsetMs - predicted;
    sumSq += resid * resid;
    maxAbs = Math.max(maxAbs, Math.abs(resid));
  }
  const residualRmsMs = Math.sqrt(sumSq / n);

  // --- trust assessment ---
  if (n < 3) {
    warnings.push(`only ${n} usable sync records: drift rate is poorly constrained`);
  }
  if (spanMs < 10 * 60 * 1000) {
    warnings.push(
      `sync span ${(spanMs / 60000).toFixed(1)} min is short: BLE latency noise dominates the drift signal`
    );
  }
  if (residualRmsMs > 50) {
    warnings.push(
      `residual RMS ${residualRmsMs.toFixed(1)}ms is large: linear drift may not hold (thermal transient or clock step)`
    );
  }
  if (suspectedSteps.length > 0) {
    warnings.push(
      `${suspectedSteps.length} suspected clock step(s) at observation index ${suspectedSteps.join(', ')}: a single line will absorb the step as slope error`
    );
  }

  const ppm = slope * 1e6;
  if (Math.abs(ppm) > 200) {
    warnings.push(
      `fitted drift ${ppm.toFixed(1)}ppm exceeds plausible crystal tolerance: suspect a clock step or bad samples`
    );
  }

  return {
    ppm,
    offsetAtT0Ms: intercept,
    t0DeviceMs: t0,
    used: candidates,
    rejected,
    residualRmsMs,
    residualMaxMs: maxAbs,
    spanMs,
    trustworthy: warnings.length === 0,
    warnings,
    correct: (deviceMs: number) =>
      deviceMs + intercept + slope * (deviceMs - t0),
    suspectedSteps,
  };
}
