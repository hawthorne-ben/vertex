"""
Tests for post-processing timestamp reconstruction.

The load-bearing cases are (a) backward distribution within a batch and (b)
that a dropped sample is FLAGGED rather than smoothed over — the case naive
``start + i/rate`` indexing gets silently wrong.
"""

import glob
import os

import pytest

from vtx_parser import (
    VTXDecoder,
    compute_clock_drift,
    find_batch_runs,
    reconstruct_and_correct,
    reconstruct_record_timestamps,
    reconstruct_timestamps,
)
from vtx_parser.types import ClockSyncRecord, IMURecord, VTXHeader

SAMPLE_DIR = os.path.join(
    os.path.dirname(__file__), "..", "..", "..", "..",
    "analysis", "data", "sample-recordings",
)

RATE_V2 = 104.0
DT_V2 = 1000.0 / RATE_V2  # 9.615...


def from_runs(spec):
    """Build a timestamp list from a run-length spec: [(ts, count), ...]"""
    out = []
    for ts, count in spec:
        out.extend([ts] * count)
    return out


def make_record(ts):
    return IMURecord(
        timestamp=ts, accel_x=0.0, accel_y=0.0, accel_z=9.81,
        gyro_x=0.0, gyro_y=0.0, gyro_z=0.0,
    )


def header(rate):
    return VTXHeader(
        magic="VTX\0", version_major=1, version_minor=1, metadata_length=0,
        data_offset=64, record_count=0, sample_rate=rate, start_timestamp=0,
        end_timestamp=0, record_format=3, compression=0,
    )


class TestFindBatchRuns:
    def test_groups_consecutive_equal_timestamps(self):
        runs = find_batch_runs([10, 10, 10, 20, 30, 30])
        assert [(r.start_index, r.length, r.timestamp_ms) for r in runs] == [
            (0, 3, 10), (3, 1, 20), (4, 2, 30),
        ]

    def test_does_not_merge_non_adjacent_equal_timestamps(self):
        # Same value reappearing later is a separate FIFO read.
        assert [r.length for r in find_batch_runs([10, 20, 10])] == [1, 1, 1]

    def test_empty_input(self):
        assert find_batch_runs([]) == []


class TestBackwardDistribution:
    def test_places_run_backward_from_read_time(self):
        # The recorded timestamp is when the read COMPLETED, so it belongs to
        # the last sample; earlier samples step back one interval each.
        r = reconstruct_timestamps([1000, 1000, 1000], RATE_V2)
        assert r.timestamps[2] == pytest.approx(1000)
        assert r.timestamps[1] == pytest.approx(1000 - DT_V2)
        assert r.timestamps[0] == pytest.approx(1000 - 2 * DT_V2)

    def test_never_places_a_sample_after_its_read_time(self):
        r = reconstruct_timestamps(from_runs([(500, 4), (600, 3)]), RATE_V2)
        assert all(t <= 500 for t in r.timestamps[:4])
        assert all(t <= 600 for t in r.timestamps[4:])

    def test_unique_timestamps_pass_through_untouched(self):
        # ~99% of real samples are singleton runs.
        ts = [0, 10, 19, 29, 39, 48]
        r = reconstruct_timestamps(ts, RATE_V2)
        assert r.timestamps == [float(t) for t in ts]
        assert r.report.adjusted_samples == 0
        assert r.report.multi_sample_run_count == 0

    @pytest.mark.parametrize("n", [1, 2, 10, 25])
    def test_duplicate_run_lengths(self, n):
        anchor = 10_000
        ts = from_runs([(anchor, n)]) + [anchor + 10]
        r = reconstruct_timestamps(ts, RATE_V2)

        # The run's last sample keeps the recorded anchor exactly.
        assert r.timestamps[n - 1] == pytest.approx(anchor)
        for k in range(n):
            assert r.timestamps[k] == pytest.approx(anchor - (n - 1 - k) * DT_V2)
        assert r.report.longest_run == n
        # For n == 1 the trailing sentinel is also a length-1 run.
        assert r.report.run_length_histogram[n] == (2 if n == 1 else 1)
        assert all(
            r.timestamps[i] > r.timestamps[i - 1]
            for i in range(1, len(r.timestamps))
        )

    def test_measured_worst_case_25_sample_stall(self):
        # Longest run observed across the V2 corpus: ~240ms collapsed to one
        # instant in the stored file.
        r = reconstruct_timestamps(from_runs([(5000, 25)]) + [5010], RATE_V2)
        spread = r.timestamps[24] - r.timestamps[0]
        assert spread == pytest.approx(24 * DT_V2)
        assert spread > 230


class TestGapDetection:
    def test_flags_dropped_samples_instead_of_interpolating(self):
        # The case naive `start + i/rate` gets silently wrong.
        r = reconstruct_timestamps([0, 1000], RATE_V2)
        assert len(r.report.gaps) == 1
        gap = r.report.gaps[0]
        assert gap.before_index == 0
        assert gap.after_index == 1
        assert gap.duration_ms == 1000
        assert gap.missing_samples > 100
        assert r.report.trustworthy is False
        assert "do not interpolate" in " ".join(r.report.warnings)

    def test_both_sides_of_a_gap_keep_their_anchors(self):
        r = reconstruct_timestamps([0, 0, 0, 5000, 5000], RATE_V2)
        # Not stretched toward each other.
        assert r.timestamps[2] == pytest.approx(0)
        assert r.timestamps[4] == pytest.approx(5000)
        assert len(r.report.gaps) == 1
        assert r.report.total_missing_samples > 500

    def test_dropped_sample_perturbs_one_interval_only(self):
        # The core argument for per-batch anchoring.
        clean = [round(i * DT_V2) for i in range(40)]
        dropped = [t for i, t in enumerate(clean) if i != 20]

        r = reconstruct_timestamps(dropped, RATE_V2)
        # All singleton runs: each reconstructed time equals its own anchor,
        # so no cumulative shift accrues after the drop.
        for i, t in enumerate(dropped):
            assert r.timestamps[i] == pytest.approx(t)

        naive_final = dropped[0] + (len(dropped) - 1) * DT_V2
        assert abs(naive_final - clean[-1]) > 9

    def test_quantization_is_not_mistaken_for_a_gap(self):
        # Real 104Hz deltas quantize to 9/10/11ms against a 9.615ms period.
        r = reconstruct_timestamps([0, 10, 19, 29, 39, 48, 58, 68, 77, 87], RATE_V2)
        assert r.report.gaps == []
        assert r.report.trustworthy is True

    def test_custom_gap_threshold(self):
        ts = [0, 30]
        assert len(reconstruct_timestamps(
            ts, RATE_V2, gap_threshold_intervals=1.5).report.gaps) == 1
        assert len(reconstruct_timestamps(
            ts, RATE_V2, gap_threshold_intervals=10).report.gaps) == 0


class TestDegenerateInputs:
    def test_zero_samples(self):
        r = reconstruct_timestamps([], RATE_V2)
        assert r.timestamps == []
        assert r.report.sample_count == 0
        assert r.report.trustworthy is False
        assert "no samples" in " ".join(r.report.warnings)

    def test_single_sample(self):
        r = reconstruct_timestamps([1234], RATE_V2)
        assert r.timestamps == [1234]
        assert r.report.trustworthy is False
        assert "single sample" in " ".join(r.report.warnings)

    def test_all_timestamps_identical(self):
        r = reconstruct_timestamps(from_runs([(777, 8)]), RATE_V2)
        assert r.report.run_count == 1
        assert r.report.longest_run == 8
        assert r.report.trustworthy is False
        assert "single anchor" in " ".join(r.report.warnings)
        assert all(
            r.timestamps[i] > r.timestamps[i - 1]
            for i in range(1, len(r.timestamps))
        )

    def test_non_monotonic_input_is_reported_not_raised(self):
        r = reconstruct_timestamps([0, 50, 20, 90], RATE_V2)
        assert r.report.non_monotonic_input is True
        assert 2 in r.report.non_monotonic_indices
        assert r.report.trustworthy is False
        assert "go backwards" in " ".join(r.report.warnings)

    def test_non_monotonic_input_still_yields_monotonic_output(self):
        r = reconstruct_timestamps([0, 50, 20, 90], RATE_V2)
        assert all(
            r.timestamps[i] > r.timestamps[i - 1]
            for i in range(1, len(r.timestamps))
        )

    @pytest.mark.parametrize("bad", [0, -104.0, float("nan")])
    def test_invalid_sample_rate_is_reported(self, bad):
        r = reconstruct_timestamps([0, 0, 10], bad)
        assert r.timestamps == [0, 0, 10]  # stored times, unchanged
        assert r.report.trustworthy is False
        assert "sample rate" in " ".join(r.report.warnings)


class TestRateFromHeader:
    def test_20hz_v1_batch_uses_50ms_intervals(self):
        recs = [make_record(t) for t in (500, 500, 500)]
        out, _ = reconstruct_record_timestamps(recs, header(20))
        assert out[2].timestamp == pytest.approx(500)
        assert out[1].timestamp == pytest.approx(450)
        assert out[0].timestamp == pytest.approx(400)

    def test_104hz_v2_batch_uses_9_615ms_intervals(self):
        recs = [make_record(t) for t in (500, 500, 500)]
        out, _ = reconstruct_record_timestamps(recs, header(104))
        assert out[1].timestamp == pytest.approx(500 - DT_V2)

    def test_never_applies_104hz_assumption_to_a_20hz_file(self):
        recs = [make_record(1000), make_record(1000)]
        at20, rep20 = reconstruct_record_timestamps(recs, header(20))
        at104, _ = reconstruct_record_timestamps(recs, header(104))
        assert at20[0].timestamp == pytest.approx(950)
        assert at104[0].timestamp != pytest.approx(950, abs=1e-3)
        assert rep20.sample_rate_hz == 20


class TestNonDestructive:
    def test_does_not_mutate_input_records(self):
        recs = [make_record(100), make_record(100)]
        before = [r.timestamp for r in recs]
        reconstruct_record_timestamps(recs, header(RATE_V2))
        assert [r.timestamp for r in recs] == before

    def test_raw_timestamps_remain_available(self):
        r = reconstruct_timestamps([100, 100, 100], RATE_V2)
        assert r.original_timestamps == [100, 100, 100]
        assert r.timestamps != r.original_timestamps


def _sync_records():
    out = []
    for i in range(6):
        t1 = 1000 + i * 600_000
        offset = 1_700_000_000_000 + t1 * 40e-6  # 40ppm drift
        out.append(ClockSyncRecord(
            t1_device_ms=t1,
            t2_phone_unix_ms=round(t1 + offset + 20),
            t3_phone_unix_ms=round(t1 + offset + 25),
            t4_device_ms=t1 + 45,
        ))
    return out


class TestCompositionWithClockDrift:
    def test_drift_applied_exactly_once(self):
        fit = compute_clock_drift(_sync_records())
        recs = [make_record(10_000) for _ in range(3)]

        composed, _ = reconstruct_and_correct(recs, header(RATE_V2), fit.correct)
        plain, _ = reconstruct_record_timestamps(recs, header(RATE_V2))

        for c, p in zip(composed, plain):
            assert c.timestamp == pytest.approx(fit.correct(p.timestamp))

    def test_intra_batch_spacing_scales_by_drift_only(self):
        # Drift correction rescales spacing by (1 + slope); it must not
        # re-quantize or collapse it.
        fit = compute_clock_drift(_sync_records())
        recs = [make_record(10_000) for _ in range(3)]
        out, _ = reconstruct_and_correct(recs, header(RATE_V2), fit.correct)
        spacing = out[1].timestamp - out[0].timestamp
        assert spacing == pytest.approx(DT_V2 * (1 + fit.ppm / 1e6), abs=1e-3)

    def test_report_matches_reconstruction_alone(self):
        fit = compute_clock_drift(_sync_records())
        recs = [make_record(t) for t in (0, 0, 0, 10)]
        _, ra = reconstruct_and_correct(recs, header(RATE_V2), fit.correct)
        _, rb = reconstruct_record_timestamps(recs, header(RATE_V2))
        assert ra.longest_run == rb.longest_run
        assert ra.gaps == rb.gaps

    def test_identity_safe_with_no_sync_records(self):
        fit = compute_clock_drift([])
        assert fit.trustworthy is False
        recs = [make_record(500), make_record(500)]
        composed, _ = reconstruct_and_correct(recs, header(RATE_V2), fit.correct)
        plain, _ = reconstruct_record_timestamps(recs, header(RATE_V2))
        assert [r.timestamp for r in composed] == [r.timestamp for r in plain]


def _v2_files():
    names = [
        "3_19_2026_49535472.vtx",
        "5_21_2026_54030254.vtx",
        "3_24_2026_54119728.vtx",
    ]
    return [n for n in names if os.path.exists(os.path.join(SAMPLE_DIR, n))]


@pytest.mark.skipif(not _v2_files(), reason="no V2 sample recordings available")
class TestRealRecordings:
    @pytest.mark.parametrize("name", _v2_files())
    def test_reconstructed_times_stay_monotonic(self, name):
        with open(os.path.join(SAMPLE_DIR, name), "rb") as fh:
            decoded = VTXDecoder(fh.read()).decode(max_records=60_000)
        recs, report = reconstruct_record_timestamps(decoded.records, decoded.header)
        assert report.sample_rate_hz == decoded.header.sample_rate
        for i in range(1, len(recs)):
            assert recs[i].timestamp > recs[i - 1].timestamp

    @pytest.mark.parametrize("name", _v2_files())
    def test_within_one_run_length_of_stored_time_outside_gaps(self, name):
        with open(os.path.join(SAMPLE_DIR, name), "rb") as fh:
            decoded = VTXDecoder(fh.read()).decode(max_records=60_000)
        recs, report = reconstruct_record_timestamps(decoded.records, decoded.header)

        gap_span = set()
        for g in report.gaps:
            gap_span.update(range(g.before_index, g.after_index + 1))

        limit = report.longest_run * report.nominal_interval_ms
        for i, (new, old) in enumerate(zip(recs, decoded.records)):
            if i in gap_span:
                continue
            assert abs(new.timestamp - old.timestamp) <= limit

    @pytest.mark.parametrize("name", _v2_files())
    def test_duplicate_timestamps_reduced_to_zero(self, name):
        with open(os.path.join(SAMPLE_DIR, name), "rb") as fh:
            decoded = VTXDecoder(fh.read()).decode(max_records=60_000)
        stored_unique = len({r.timestamp for r in decoded.records})
        recs, _ = reconstruct_record_timestamps(decoded.records, decoded.header)
        assert stored_unique < len(decoded.records)
        assert len({r.timestamp for r in recs}) == len(recs)


class TestHeaderRateMismatch:
    """
    Some early V1 files declare a rate the samples do not follow (a 20Hz
    header over 25Hz data). Gap detection against a wrong nominal interval
    would flag every ordinary interval, so it is suppressed and reported.
    """

    def test_detects_a_header_that_contradicts_the_data(self):
        # Header says 20Hz (50ms); data actually arrives every 40ms (25Hz).
        ts = [i * 40 for i in range(200)]
        r = reconstruct_timestamps(ts, 20.0)
        assert r.report.rate_mismatch is True
        assert r.report.observed_interval_ms == pytest.approx(40)
        assert r.report.observed_rate_hz == pytest.approx(25)
        assert r.report.trustworthy is False
        assert "does not describe this file" in " ".join(r.report.warnings)

    def test_suppresses_meaningless_gaps_on_mismatch(self):
        # Without the check every one of these intervals reads as a gap.
        ts = [i * 40 for i in range(200)]
        assert reconstruct_timestamps(ts, 20.0).report.gaps == []
        # With a correct header the same data is clean.
        ok = reconstruct_timestamps(ts, 25.0)
        assert ok.report.gaps == []
        assert ok.report.rate_mismatch is False
        assert ok.report.trustworthy is True

    def test_matching_header_is_not_flagged(self):
        ts = [round(i * DT_V2) for i in range(200)]
        r = reconstruct_timestamps(ts, RATE_V2)
        assert r.report.rate_mismatch is False
        assert r.report.observed_rate_hz == pytest.approx(RATE_V2, rel=0.15)

    def test_a_few_real_gaps_are_not_mistaken_for_a_wrong_header(self):
        # A mostly-clean file with a couple of genuine dropouts must still
        # report gaps rather than blaming the header.
        ts = [round(i * DT_V2) for i in range(200)]
        ts += [ts[-1] + 5000 + round(i * DT_V2) for i in range(200)]
        r = reconstruct_timestamps(ts, RATE_V2)
        assert r.report.rate_mismatch is False
        assert len(r.report.gaps) == 1
        assert r.report.gaps[0].missing_samples > 400
