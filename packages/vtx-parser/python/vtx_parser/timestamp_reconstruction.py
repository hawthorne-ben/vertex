"""
Timestamp reconstruction for VTX IMU records.

The firmware captures ``millis()`` once per FIFO read and stamps every sample
in that batch with it (``sensor_manager.cpp:107,121``). Two artifacts follow:

1. **Duplicate timestamps.** ``loop()`` runs without delay, so it normally
   out-runs the 60-sample FIFO threshold and finds a single sample waiting.
   Runs of shared timestamps appear only when the loop stalls — SD write, BLE
   push, WiFi tick — and a backlog accumulates. The run-length distribution is
   therefore a direct measure of loop-latency events.
2. **Quantization.** ``millis()`` has 1 ms resolution against a 9.615 ms
   sample period, so deltas quantize to 9/10/11 ms.

This module addresses (1). **It cannot address (2)** — the ~1 ms quantization
is a property of the source observation and is irreducible in post-processing.
Reconstruction places samples *within* a batch; it cannot make the batch's own
anchor more precise than the clock that recorded it.

Method — anchored, per-batch, backward distribution:

    Each run of identical timestamps is one FIFO read. The recorded time is
    when the read completed, so the samples in it were captured *before* that
    instant, at the nominal sample interval. A run of length n ending at time
    t is placed at t - (n-1)*dt, ..., t - dt, t.

Every batch re-anchors on a real recorded observation. That is the whole
point: a dropped sample perturbs one interval instead of shifting everything
downstream.

**Deliberately NOT ``start + i / rate``.** Global indexing assumes zero
dropped samples for an entire recording. One FIFO overflow, I2C failure, or SD
stall silently shifts every subsequent timestamp, permanently and cumulatively
— worse than the problem being solved. Where elapsed time between batches
exceeds what the sample count accounts for, this module flags a gap and does
not interpolate across it.

Composes with :func:`compute_clock_drift`: reconstruction fixes intra-batch
placement in the device time base, drift correction maps the device time base
to true time. See :func:`reconstruct_and_correct`.

Mirrors packages/vtx-parser/src/timestamp-reconstruction.ts.
"""

from dataclasses import dataclass, field, replace
from statistics import median
from typing import Callable, Dict, List, Optional, Sequence

from .types import IMURecord, VTXHeader

DEFAULT_GAP_THRESHOLD_INTERVALS = 1.5

MIN_RATE_CHECK_BATCHES = 20
"""Minimum batches before the observed-cadence check can override the header."""


@dataclass
class BatchRun:
    """One run of samples sharing a single recorded timestamp — one FIFO read."""

    start_index: int
    length: int
    timestamp_ms: float


@dataclass
class TimestampGap:
    """A stretch of time where samples are missing from the record."""

    before_index: int   # last sample before the gap
    after_index: int    # first sample after the gap
    start_ms: float     # stored timestamp before the gap
    end_ms: float       # stored timestamp after the gap
    duration_ms: float  # wall-clock span of the gap
    missing_samples: int  # samples the elapsed time implies are missing


@dataclass
class TimestampQualityReport:
    """Quality and diagnostics for a reconstruction pass."""

    sample_count: int
    run_count: int
    multi_sample_run_count: int
    """Runs of length > 1 — i.e. observed loop-stall events."""
    longest_run: int
    run_length_histogram: Dict[int, int]
    duplicate_timestamp_samples: int
    adjusted_samples: int
    gaps: List[TimestampGap]
    total_missing_samples: int
    nominal_interval_ms: float
    sample_rate_hz: float
    observed_interval_ms: float
    """Median interval actually observed between consecutive batches, in ms.
    NaN when there are too few batches to measure one."""
    observed_rate_hz: float
    """Rate implied by the observed interval. A material disagreement with
    sample_rate_hz means the header does not describe the data."""
    rate_mismatch: bool
    max_adjustment_ms: float
    non_monotonic_input: bool
    non_monotonic_indices: List[int]
    trustworthy: bool
    """False when the input is degenerate or violates the method's
    assumptions. Same spirit as ClockDriftFit.trustworthy."""
    warnings: List[str] = field(default_factory=list)


@dataclass
class TimestampReconstructionResult:
    timestamps: List[float]
    """Reconstructed timestamps, one per input record, in input order."""
    original_timestamps: List[float]
    """The stored timestamps, unchanged — the raw record stays available."""
    report: TimestampQualityReport


def find_batch_runs(timestamps: Sequence[float]) -> List[BatchRun]:
    """
    Group consecutive samples that share a stored timestamp. Each run is one
    FIFO read.
    """
    runs: List[BatchRun] = []
    if not timestamps:
        return runs

    start_index = 0
    n = len(timestamps)
    for i in range(1, n + 1):
        if i == n or timestamps[i] != timestamps[start_index]:
            runs.append(
                BatchRun(
                    start_index=start_index,
                    length=i - start_index,
                    timestamp_ms=timestamps[start_index],
                )
            )
            start_index = i
    return runs


def _empty_report(
    sample_count: int, sample_rate_hz: float, dt: float, warnings: List[str]
) -> TimestampQualityReport:
    return TimestampQualityReport(
        sample_count=sample_count,
        run_count=0,
        multi_sample_run_count=0,
        longest_run=1 if sample_count > 0 else 0,
        run_length_histogram={},
        duplicate_timestamp_samples=0,
        adjusted_samples=0,
        gaps=[],
        total_missing_samples=0,
        nominal_interval_ms=dt,
        sample_rate_hz=sample_rate_hz,
        observed_interval_ms=float("nan"),
        observed_rate_hz=float("nan"),
        rate_mismatch=False,
        max_adjustment_ms=0.0,
        non_monotonic_input=False,
        non_monotonic_indices=[],
        trustworthy=False,
        warnings=warnings,
    )


def reconstruct_timestamps(
    timestamps: Sequence[float],
    sample_rate_hz: float,
    gap_threshold_intervals: float = DEFAULT_GAP_THRESHOLD_INTERVALS,
    enforce_monotonic: bool = True,
    rate_mismatch_tolerance: float = 0.15,
) -> TimestampReconstructionResult:
    """
    Reconstruct per-sample timestamps from stored batch timestamps.

    Non-destructive: returns new lists and never mutates the input.
    Degenerate inputs never raise — they are reported through ``trustworthy``
    and ``warnings``.

    Args:
        timestamps: stored per-sample timestamps, in file order.
        sample_rate_hz: nominal rate, normally ``header.sample_rate``. V1 files
            run at 10-50 Hz and V2 at 104 Hz; always pass the header's value so
            a 20 Hz file is never treated as 104 Hz.
        gap_threshold_intervals: a gap is declared when elapsed time between
            batches exceeds what the samples account for by more than this many
            nominal intervals. Default 1.5 — below that the discrepancy is
            millis() quantization (9/10/11 ms against a 9.615 ms period), not a
            real drop.
        enforce_monotonic: clamp so a backward-distributed run cannot start at
            or before the previous sample. Guarantees the monotonicity that
            windowing consumers need.
        rate_mismatch_tolerance: fractional disagreement between the header
            rate and the observed cadence above which the header is treated as
            not describing the data. Default 0.15. Some early V1 files declare
            a rate the samples do not follow; gap detection against a wrong
            nominal interval is meaningless, so it is suppressed and the result
            marked untrustworthy instead.
    """
    warnings: List[str] = []
    original = [float(t) for t in timestamps]

    rate_valid = (
        isinstance(sample_rate_hz, (int, float))
        and sample_rate_hz == sample_rate_hz  # not NaN
        and sample_rate_hz not in (float("inf"), float("-inf"))
        and sample_rate_hz > 0
    )
    if not rate_valid:
        warnings.append(
            f"sample rate {sample_rate_hz} is not a positive number: "
            f"cannot place samples within a batch"
        )
    dt = 1000.0 / sample_rate_hz if rate_valid else 0.0

    # --- degenerate inputs: report, never raise ---
    if len(original) == 0:
        warnings.append("no samples: nothing to reconstruct")
        return TimestampReconstructionResult(
            timestamps=[],
            original_timestamps=original,
            report=_empty_report(0, sample_rate_hz, dt, warnings),
        )

    if not rate_valid:
        # Without a valid interval the only honest answer is the stored times.
        report = _empty_report(len(original), sample_rate_hz, dt, warnings)
        report.run_count = len(find_batch_runs(original))
        return TimestampReconstructionResult(
            timestamps=list(original),
            original_timestamps=original,
            report=report,
        )

    if len(original) == 1:
        warnings.append("single sample: no batch structure to reconstruct")
        report = _empty_report(1, sample_rate_hz, dt, warnings)
        report.run_count = 1
        report.longest_run = 1
        report.run_length_histogram = {1: 1}
        return TimestampReconstructionResult(
            timestamps=list(original),
            original_timestamps=original,
            report=report,
        )

    # Non-monotonic stored input is a corrupt or merged file. Report it rather
    # than silently producing plausible-looking output.
    non_monotonic_indices = [
        i for i in range(1, len(original)) if original[i] < original[i - 1]
    ]
    if non_monotonic_indices:
        warnings.append(
            f"{len(non_monotonic_indices)} stored timestamp(s) go backwards "
            f"(first at index {non_monotonic_indices[0]}): file may be corrupt "
            f"or improperly merged; reconstruction is unreliable here"
        )

    runs = find_batch_runs(original)

    # --- backward distribution within each run ---
    #
    # The recorded timestamp is when the FIFO read completed, so it belongs to
    # the LAST sample of the run. Earlier samples step back by dt.
    out: List[float] = [0.0] * len(original)
    for run in runs:
        last = run.start_index + run.length - 1
        for i in range(run.start_index, last + 1):
            out[i] = run.timestamp_ms - (last - i) * dt

    # --- monotonicity ---
    #
    # A long stall can push a run's backward-distributed start before the
    # previous sample. Clamping keeps the series usable by windowing consumers
    # without inventing a different anchor; the run still ends on its recorded
    # observation.
    clamped = 0
    if enforce_monotonic:
        for i in range(1, len(out)):
            if out[i] <= out[i - 1]:
                # Nudge forward by a small fraction of dt: enough to stay
                # strictly ordered, small enough not to misrepresent the
                # sample instant.
                out[i] = out[i - 1] + dt * 1e-3
                clamped += 1

    # --- gap detection between consecutive batches ---
    #
    # Compare elapsed wall time against what the intervening samples account
    # for. An excess beyond the quantization noise floor means samples were
    # dropped. Flag it; never interpolate across it.
    #
    # First: does the header's rate actually describe this data? Some early V1
    # files declare a rate the samples do not follow (a 20Hz header over 25Hz
    # data, for instance). Detecting "gaps" against a wrong nominal interval
    # would flag every ordinary interval, so measure the real cadence and
    # suppress gap detection when the two disagree materially.
    inter_batch = [
        runs[r].timestamp_ms - runs[r - 1].timestamp_ms
        for r in range(1, len(runs))
        if runs[r].timestamp_ms - runs[r - 1].timestamp_ms > 0
    ]
    observed_interval_ms = median(inter_batch) if inter_batch else float("nan")
    observed_rate_hz = (
        1000.0 / observed_interval_ms
        if inter_batch and observed_interval_ms > 0
        else float("nan")
    )
    # Below MIN_RATE_CHECK_BATCHES a single real gap dominates the median, so
    # a wrong header and a genuinely gappy file are indistinguishable. Prefer
    # reporting gaps in that case.
    rate_mismatch = bool(
        len(inter_batch) >= MIN_RATE_CHECK_BATCHES
        and abs(observed_interval_ms - dt) / dt > rate_mismatch_tolerance
    )
    if rate_mismatch:
        warnings.append(
            f"header declares {sample_rate_hz}Hz ({dt:.2f}ms) but the data "
            f"cadence is ~{observed_rate_hz:.1f}Hz ({observed_interval_ms:.2f}ms): "
            f"the header does not describe this file, so intra-batch placement "
            f"uses the wrong interval and gap detection is suppressed"
        )

    gaps: List[TimestampGap] = []
    for r in range(1, len(runs) if not rate_mismatch else 1):
        prev = runs[r - 1]
        cur = runs[r]
        elapsed = cur.timestamp_ms - prev.timestamp_ms
        if elapsed <= 0:
            continue  # non-monotonic; already reported
        accounted = cur.length * dt
        excess = elapsed - accounted
        if excess > gap_threshold_intervals * dt:
            missing = int(round(excess / dt))
            if missing > 0:
                gaps.append(
                    TimestampGap(
                        before_index=prev.start_index + prev.length - 1,
                        after_index=cur.start_index,
                        start_ms=prev.timestamp_ms,
                        end_ms=cur.timestamp_ms,
                        duration_ms=elapsed,
                        missing_samples=missing,
                    )
                )

    # --- statistics ---
    run_length_histogram: Dict[int, int] = {}
    longest_run = 0
    multi_sample_run_count = 0
    duplicate_timestamp_samples = 0
    for run in runs:
        run_length_histogram[run.length] = run_length_histogram.get(run.length, 0) + 1
        longest_run = max(longest_run, run.length)
        if run.length > 1:
            multi_sample_run_count += 1
            duplicate_timestamp_samples += run.length

    adjusted_samples = 0
    max_adjustment_ms = 0.0
    for i in range(len(out)):
        delta = abs(out[i] - original[i])
        if delta > 0:
            adjusted_samples += 1
        max_adjustment_ms = max(max_adjustment_ms, delta)

    total_missing = sum(g.missing_samples for g in gaps)

    # --- trust assessment ---
    if gaps:
        warnings.append(
            f"{len(gaps)} gap(s) detected totalling ~{total_missing} missing "
            f"sample(s): timestamps are correct on each side but the record is "
            f"incomplete across them — do not interpolate"
        )
    if clamped:
        warnings.append(
            f"{clamped} sample(s) required monotonicity clamping: a batch "
            f"extended back past the previous sample, implying a stall longer "
            f"than the gap between reads"
        )
    if len(runs) == 1 and len(original) > 1:
        warnings.append(
            f"all {len(original)} samples share one timestamp: there is a "
            f"single anchor, so reconstructed times are a nominal-rate "
            f"extrapolation backward from it rather than a per-batch fit"
        )

    report = TimestampQualityReport(
        sample_count=len(original),
        run_count=len(runs),
        multi_sample_run_count=multi_sample_run_count,
        longest_run=longest_run,
        run_length_histogram=run_length_histogram,
        duplicate_timestamp_samples=duplicate_timestamp_samples,
        adjusted_samples=adjusted_samples,
        gaps=gaps,
        total_missing_samples=total_missing,
        nominal_interval_ms=dt,
        sample_rate_hz=float(sample_rate_hz),
        observed_interval_ms=observed_interval_ms,
        observed_rate_hz=observed_rate_hz,
        rate_mismatch=rate_mismatch,
        max_adjustment_ms=max_adjustment_ms,
        non_monotonic_input=bool(non_monotonic_indices),
        non_monotonic_indices=non_monotonic_indices,
        trustworthy=not warnings,
        warnings=warnings,
    )

    return TimestampReconstructionResult(
        timestamps=out, original_timestamps=original, report=report
    )


def reconstruct_record_timestamps(
    records: Sequence[IMURecord],
    header: VTXHeader,
    sample_rate_hz: Optional[float] = None,
    gap_threshold_intervals: float = DEFAULT_GAP_THRESHOLD_INTERVALS,
    enforce_monotonic: bool = True,
    rate_mismatch_tolerance: float = 0.15,
):
    """
    Reconstruct timestamps for decoded records, taking the sample rate from the
    file header.

    Opt-in and non-destructive: the input records are not mutated and the
    default decode path never calls this. Returns ``(new_records, report)``.

    The rate comes from ``header.sample_rate``, so a 20 Hz V1 file is placed at
    50 ms intervals and a 104 Hz V2 file at 9.615 ms. No generation is assumed.
    """
    rate = sample_rate_hz if sample_rate_hz is not None else header.sample_rate
    result = reconstruct_timestamps(
        [r.timestamp for r in records],
        rate,
        gap_threshold_intervals=gap_threshold_intervals,
        enforce_monotonic=enforce_monotonic,
        rate_mismatch_tolerance=rate_mismatch_tolerance,
    )
    new_records = [
        replace(r, timestamp=t) for r, t in zip(records, result.timestamps)
    ]
    return new_records, result.report


def reconstruct_and_correct(
    records: Sequence[IMURecord],
    header: VTXHeader,
    correct: Callable[[float], float],
    sample_rate_hz: Optional[float] = None,
    gap_threshold_intervals: float = DEFAULT_GAP_THRESHOLD_INTERVALS,
    enforce_monotonic: bool = True,
    rate_mismatch_tolerance: float = 0.15,
):
    """
    Compose reconstruction with clock-drift correction, in the correct order.

    The two corrections are orthogonal and must not be double-counted:

    - **Reconstruction** works entirely inside the device time base. It fixes
      *where within a batch* each sample sits. It does not change the batch
      anchors, so it does not change the device-time-to-true-time mapping.
    - **Drift correction** maps device time to true unix time, absorbing the
      crystal's nominal-vs-actual rate error.

    So: reconstruct first (in device time), then map each reconstructed value
    through ``correct`` exactly once. Applying drift first and reconstructing
    afterwards would place samples at the *nominal* interval in corrected time,
    re-introducing the very rate error the drift fit removed.

    Args:
        correct: a drift correction function, typically
            ``compute_clock_drift(...).correct``.
    """
    new_records, report = reconstruct_record_timestamps(
        records,
        header,
        sample_rate_hz=sample_rate_hz,
        gap_threshold_intervals=gap_threshold_intervals,
        enforce_monotonic=enforce_monotonic,
        rate_mismatch_tolerance=rate_mismatch_tolerance,
    )
    corrected = [replace(r, timestamp=correct(r.timestamp)) for r in new_records]
    return corrected, report
