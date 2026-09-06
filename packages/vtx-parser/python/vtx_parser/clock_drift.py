"""
Clock drift analysis for VTX v1.2 sync records.

Sync records are observations of the device time base, never corrections
applied to it. This module turns them into a drift rate, a correction
function, and a quality metric that tells a caller whether the fit is
trustworthy enough to use.

Mirrors packages/vtx-parser/src/clock-drift.ts. See
packages/vtx-format/spec/v1.2-clock-sync.md for the record layout.
"""

from dataclasses import dataclass, field
from statistics import median
from typing import Callable, List, Optional, Tuple

from .types import ClockSyncRecord


@dataclass
class ClockSyncObservation:
    """A sync record reduced to a single (device time, clock offset) point."""
    device_ms: float   # device millis() at the midpoint of the exchange
    offset_ms: float   # phone-minus-device offset, transport delay cancelled
    rtt_ms: float      # round trip, phone processing removed
    index: int         # index of the source record


@dataclass
class RejectedObservation:
    observation: ClockSyncObservation
    reason: str


@dataclass
class ClockDriftFit:
    """Result of fitting drift to a set of sync records."""

    ppm: float
    """Drift rate in parts per million. Positive means the device clock runs
    slow relative to the phone (millis() advances less than true time)."""

    offset_at_t0_ms: float
    t0_device_ms: float
    used: List[ClockSyncObservation]
    rejected: List[RejectedObservation]
    residual_rms_ms: float
    residual_max_ms: float
    span_ms: float
    trustworthy: bool
    warnings: List[str]
    correct: Callable[[float], float]
    """Map device millis() -> estimated true unix ms. Always defined; degrades
    to a constant offset with one record and to identity with none."""

    suspected_steps: List[int] = field(default_factory=list)


def to_observation(record: ClockSyncRecord, index: int = 0) -> ClockSyncObservation:
    """
    Reduce a sync record to an offset/RTT observation using the NTP estimator.

        offset = ((t2 - t1) + (t3 - t4)) / 2
        rtt    = (t4 - t1) - (t3 - t2)

    t1/t4 are device millis(); t2/t3 are phone unix ms. The two clocks have
    different epochs, so `offset` is the epoch difference — exactly the
    quantity whose drift we want.
    """
    t1 = record.t1_device_ms
    t4 = record.t4_device_ms
    t2 = record.t2_phone_unix_ms
    t3 = record.t3_phone_unix_ms

    offset_ms = ((t2 - t1) + (t3 - t4)) / 2.0
    rtt_ms = (t4 - t1) - (t3 - t2)
    return ClockSyncObservation(
        device_ms=(t1 + t4) / 2.0,
        offset_ms=offset_ms,
        rtt_ms=rtt_ms,
        index=index,
    )


def detect_clock_steps(
    obs: List[ClockSyncObservation], step_threshold_ms: float = 250.0
) -> List[int]:
    """
    Flag observations whose offset jumps discontinuously relative to their
    neighbours — the signature of the phone's own clock stepping (an NTP
    correction mid-ride) rather than the device crystal drifting.

    Crystal drift is slow and monotonic: at 50ppm the offset moves 3ms per
    minute. A phone NTP correction moves it tens or hundreds of ms between
    adjacent samples.

    With fewer than 3 observations a step is indistinguishable from drift and
    nothing is flagged.
    """
    if len(obs) < 3:
        return []

    slopes = []
    for i in range(1, len(obs)):
        dt = obs[i].device_ms - obs[i - 1].device_ms
        if dt <= 0:
            continue
        slopes.append((obs[i].offset_ms - obs[i - 1].offset_ms) / dt)

    if not slopes:
        return []
    med_slope = median(slopes)

    steps: List[int] = []
    for i in range(1, len(obs)):
        dt = obs[i].device_ms - obs[i - 1].device_ms
        if dt <= 0:
            continue
        predicted = obs[i - 1].offset_ms + med_slope * dt
        if abs(obs[i].offset_ms - predicted) > step_threshold_ms:
            steps.append(i)
    return steps


def compute_clock_drift(
    records: List[ClockSyncRecord],
    max_rtt_ms: float = 500.0,
    rtt_outlier_factor: float = 4.0,
    step_threshold_ms: float = 250.0,
) -> ClockDriftFit:
    """
    Fit clock drift from sync records.

    Method: ordinary least squares of offset against device time, after
    rejecting high-RTT observations.

    Why linear. Crystal frequency error is dominated by a fixed manufacturing
    offset plus a temperature coefficient. Over a ride the manufacturing term
    is constant, so offset accumulates linearly in time and a straight line is
    the correct model. The residual tells you when that assumption fails.

    Where it breaks:
      - Thermal transients. A tuning-fork crystal's frequency follows a
        parabola in temperature (about -0.035 ppm/degC^2 around a ~25C
        turnover). A device carried from indoors into cold air sweeps that
        curve and the drift rate is genuinely not constant. This appears as
        structured residuals, which is why residual_rms_ms is reported.
      - A phone clock step. NTP correcting the phone mid-ride moves the offset
        discontinuously; one OLS line absorbs it as slope error across the
        whole recording. detect_clock_steps() flags it — refit per segment.
      - Short spans. Over 60s, BLE latency noise of tens of ms dominates a
        drift of microseconds.

    Degenerate inputs never raise:
      - zero records -> ppm 0, correct() is identity, untrustworthy
      - one record   -> constant offset, no rate, untrustworthy
    """
    all_obs = [to_observation(r, i) for i, r in enumerate(records)]
    all_obs.sort(key=lambda o: o.device_ms)

    rejected: List[RejectedObservation] = []
    warnings: List[str] = []

    def finite(x: float) -> bool:
        return x == x and x not in (float("inf"), float("-inf"))

    candidates: List[ClockSyncObservation] = []
    for o in all_obs:
        if not (finite(o.offset_ms) and finite(o.rtt_ms)):
            rejected.append(RejectedObservation(o, "non-finite timestamps"))
            continue
        # Negative RTT is physically impossible: the phone claimed a longer
        # processing time than the whole device-observed round trip.
        if o.rtt_ms < 0:
            rejected.append(RejectedObservation(o, "negative RTT"))
            continue
        if o.rtt_ms > max_rtt_ms:
            rejected.append(
                RejectedObservation(o, f"RTT {o.rtt_ms:.0f}ms > {max_rtt_ms:.0f}ms")
            )
            continue
        candidates.append(o)

    # Relative RTT filter, once a median means something.
    if len(candidates) >= 4:
        med_rtt = median([o.rtt_ms for o in candidates])
        # Only meaningful if the median is non-trivial; with a sub-ms median
        # every real sample would trip a 4x rule.
        if med_rtt >= 5:
            limit = med_rtt * rtt_outlier_factor
            kept = []
            for o in candidates:
                if o.rtt_ms > limit:
                    rejected.append(
                        RejectedObservation(
                            o,
                            f"RTT {o.rtt_ms:.0f}ms > {rtt_outlier_factor}x "
                            f"median ({med_rtt:.0f}ms)",
                        )
                    )
                else:
                    kept.append(o)
            candidates = kept

    suspected_steps = detect_clock_steps(candidates, step_threshold_ms)

    # --- degenerate cases ---
    if not candidates:
        warnings.append(
            "no sync records: device clock cannot be characterized"
            if not all_obs
            else "all sync records rejected as unusable"
        )
        return ClockDriftFit(
            ppm=0.0,
            offset_at_t0_ms=0.0,
            t0_device_ms=0.0,
            used=[],
            rejected=rejected,
            residual_rms_ms=0.0,
            residual_max_ms=0.0,
            span_ms=0.0,
            trustworthy=False,
            warnings=warnings,
            correct=lambda device_ms: device_ms,
            suspected_steps=[],
        )

    if len(candidates) == 1:
        only = candidates[0]
        warnings.append("single sync record: offset known, drift rate unknowable")
        return ClockDriftFit(
            ppm=0.0,
            offset_at_t0_ms=only.offset_ms,
            t0_device_ms=only.device_ms,
            used=candidates,
            rejected=rejected,
            residual_rms_ms=0.0,
            residual_max_ms=0.0,
            span_ms=0.0,
            trustworthy=False,
            warnings=warnings,
            # Best available: a constant offset, exactly what the pre-v1.2
            # single CMD_SYNC_CLOCK gave us.
            correct=lambda device_ms, _o=only.offset_ms: device_ms + _o,
            suspected_steps=[],
        )

    # --- ordinary least squares ---
    t0 = candidates[0].device_ms
    n = len(candidates)
    mx = sum(o.device_ms - t0 for o in candidates) / n
    my = sum(o.offset_ms for o in candidates) / n

    sxy = sum((o.device_ms - t0 - mx) * (o.offset_ms - my) for o in candidates)
    sxx = sum((o.device_ms - t0 - mx) ** 2 for o in candidates)

    span_ms = candidates[-1].device_ms - candidates[0].device_ms

    # slope is ms of offset per ms of device time — dimensionless, so ppm is a
    # direct 1e6 scaling.
    slope = (sxy / sxx) if sxx > 0 else 0.0
    intercept = my - slope * mx

    if sxx == 0:
        warnings.append(
            "all sync records share one device timestamp: no time base to fit"
        )

    sum_sq = 0.0
    max_abs = 0.0
    for o in candidates:
        predicted = intercept + slope * (o.device_ms - t0)
        resid = o.offset_ms - predicted
        sum_sq += resid * resid
        max_abs = max(max_abs, abs(resid))
    residual_rms_ms = (sum_sq / n) ** 0.5

    # --- trust assessment ---
    if n < 3:
        warnings.append(
            f"only {n} usable sync records: drift rate is poorly constrained"
        )
    if span_ms < 10 * 60 * 1000:
        warnings.append(
            f"sync span {span_ms / 60000:.1f} min is short: BLE latency noise "
            "dominates the drift signal"
        )
    if residual_rms_ms > 50:
        warnings.append(
            f"residual RMS {residual_rms_ms:.1f}ms is large: linear drift may "
            "not hold (thermal transient or clock step)"
        )
    if suspected_steps:
        warnings.append(
            f"{len(suspected_steps)} suspected clock step(s) at observation "
            f"index {', '.join(str(i) for i in suspected_steps)}: a single "
            "line will absorb the step as slope error"
        )

    ppm = slope * 1e6
    if abs(ppm) > 200:
        warnings.append(
            f"fitted drift {ppm:.1f}ppm exceeds plausible crystal tolerance: "
            "suspect a clock step or bad samples"
        )

    return ClockDriftFit(
        ppm=ppm,
        offset_at_t0_ms=intercept,
        t0_device_ms=t0,
        used=candidates,
        rejected=rejected,
        residual_rms_ms=residual_rms_ms,
        residual_max_ms=max_abs,
        span_ms=span_ms,
        trustworthy=not warnings,
        warnings=warnings,
        correct=(
            lambda device_ms, _i=intercept, _s=slope, _t=t0: device_ms
            + _i
            + _s * (device_ms - _t)
        ),
        suspected_steps=suspected_steps,
    )
