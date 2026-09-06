"""
Tests for the VTX v1.2 clock sync stream and drift fit (Python parser).
"""

import glob
import os
import struct

import pytest

from vtx_parser import (
    VTXDecoder,
    ClockSyncRecord,
    VTX_CONSTANTS,
    compute_clock_drift,
    detect_clock_steps,
    to_observation,
)

SAMPLE_DIR = os.path.abspath(
    os.path.join(
        os.path.dirname(__file__), "..", "..", "..", "..",
        "analysis", "data", "sample-recordings",
    )
)


def build_vtx(
    imu_count: int = 10,
    sync_records=None,
    version_minor: int = 2,
    start_timestamp: int = 1_700_000_000_000,
) -> bytes:
    """
    Build a VTX file with an optional trailing sync section.

    Mirrors what the firmware writes: header, JSON metadata, IMU array, then
    the sync section, with offset/count patched into bytes 58-63.
    """
    sync_records = sync_records or []
    metadata = b'{"device":{"name":"test"}}'
    record_format = 0x03  # accel + gyro
    record_size = 28
    data_offset = VTX_CONSTANTS.HEADER_SIZE + len(metadata)
    imu_size = imu_count * record_size

    sync_offset = (data_offset + imu_size) if sync_records else 0
    sync_count = len(sync_records)

    header = bytearray(VTX_CONSTANTS.HEADER_SIZE)
    header[0:4] = b"VTX\0"
    struct.pack_into("<HH", header, 4, 1, version_minor)
    struct.pack_into("<II", header, 8, len(metadata), data_offset)
    struct.pack_into("<Q", header, 16, imu_count)
    struct.pack_into("<f", header, 24, 104.0)
    struct.pack_into("<q", header, 28, start_timestamp)
    struct.pack_into("<q", header, 36, start_timestamp + imu_count * 10)
    header[44] = record_format
    header[45] = 0  # compression
    # 46: gps count (uint64), 54: gps offset (uint32) — left zero
    if version_minor >= 2:
        struct.pack_into("<I", header, 58, sync_offset)
        struct.pack_into("<H", header, 62, sync_count)

    body = bytearray()
    for i in range(imu_count):
        body += struct.pack(
            "<Iffffff", i * 10, 0.1 + i * 0.01, 0.2, 9.81, 0.01, 0.02, 0.03
        )

    for r in sync_records:
        body += struct.pack(
            "<IIqq",
            r.t1_device_ms,
            r.t4_device_ms,
            r.t2_phone_unix_ms,
            r.t3_phone_unix_ms,
        )

    return bytes(header) + metadata + bytes(body)


def synthetic_sync(
    count: int,
    ppm: float,
    interval_ms: int = 60_000,
    rtt_ms: float = 40.0,
    device_start_ms: int = 100_000,
    phone_epoch_ms: int = 1_700_000_000_000,
    phone_step_at=None,
    phone_step_ms: float = 0.0,
):
    """Sync records for a device clock running slow by `ppm`."""
    eps = ppm / 1e6
    out = []
    for i in range(count):
        true_elapsed = i * interval_ms
        t1 = round(device_start_ms + true_elapsed * (1 - eps))
        phone_now = phone_epoch_ms + true_elapsed + rtt_ms / 2
        if phone_step_at is not None and i >= phone_step_at:
            phone_now += phone_step_ms
        t2 = round(phone_now)
        t3 = t2
        t4 = round(t1 + rtt_ms * (1 - eps))
        out.append(
            ClockSyncRecord(
                t1_device_ms=t1,
                t4_device_ms=t4,
                t2_phone_unix_ms=t2,
                t3_phone_unix_ms=t3,
            )
        )
    return out


class TestSyncRecordParsing:
    def test_round_trip_sync_records(self):
        sync = synthetic_sync(12, 30)
        decoded = VTXDecoder(build_vtx(50, sync)).decode()

        assert decoded.sync_records is not None
        assert len(decoded.sync_records) == len(sync)
        assert decoded.sync_records == sync

    def test_header_carries_sync_fields(self):
        sync = synthetic_sync(3, 20)
        header = VTXDecoder(build_vtx(10, sync)).read_header()

        assert header.version_minor == 2
        assert header.sync_record_count == 3
        assert header.sync_data_offset > 0

    def test_no_sync_section_reads_as_none(self):
        decoded = VTXDecoder(build_vtx(10, [])).decode()
        assert decoded.sync_records is None

    def test_imu_records_unaffected_by_sync_section(self):
        plain = VTXDecoder(build_vtx(30, [])).decode()
        with_sync = VTXDecoder(build_vtx(30, synthetic_sync(4, 25))).decode()
        assert with_sync.records == plain.records

    def test_header_only_still_exposes_sync(self):
        sync = synthetic_sync(5, 30)
        decoded = VTXDecoder(build_vtx(10, sync)).decode(header_only=True)
        assert decoded.records == []
        assert len(decoded.sync_records) == 5

    def test_v11_file_ignores_bytes_58_63(self):
        """
        A v1.1 file with stale bytes at 58-63 must not be read as having a
        sync stream: presence is gated on version_minor, not on value.
        """
        data = bytearray(build_vtx(10, [], version_minor=1))
        struct.pack_into("<I", data, 58, 999999)
        struct.pack_into("<H", data, 62, 4242)

        header = VTXDecoder(bytes(data)).read_header()
        assert header.version_minor == 1
        assert header.sync_record_count is None
        assert header.sync_data_offset is None
        assert VTXDecoder(bytes(data)).decode().sync_records is None

    def test_truncated_sync_section_raises(self):
        sync = synthetic_sync(5, 30)
        data = build_vtx(10, sync)
        with pytest.raises(ValueError, match="truncated"):
            VTXDecoder(data[:-10]).decode()


class TestBackwardCompatibility:
    files = sorted(glob.glob(os.path.join(SAMPLE_DIR, "*.vtx")))

    def test_sample_recordings_present(self):
        # Guards against this class silently passing with no real files.
        assert len(self.files) > 0, f"no .vtx files under {SAMPLE_DIR}"

    @pytest.mark.parametrize(
        "path", files, ids=[os.path.basename(f) for f in files]
    )
    def test_real_file_parses_without_sync(self, path):
        with open(path, "rb") as fh:
            data = fh.read()

        decoder = VTXDecoder(data)
        header = decoder.read_header()

        assert header.magic == "VTX\0"
        assert header.version_major == 1
        assert header.version_minor < 2  # all predate v1.2
        assert header.sync_record_count is None
        assert decoder.get_sync_record_count() == 0
        assert decoder.read_sync_records() is None

        # IMU stream still readable — spot-check rather than decode tens of MB
        if header.record_count > 0:
            first = decoder.read_record(0)
            assert first.accel_x == first.accel_x  # not NaN
            assert first.gyro_z == first.gyro_z


class TestDriftFit:
    @pytest.mark.parametrize("ppm", [5, 30, -18, 75])
    def test_recovers_known_drift(self, ppm):
        fit = compute_clock_drift(synthetic_sync(60, ppm, rtt_ms=0))
        assert fit.ppm == pytest.approx(ppm, abs=0.1)
        assert fit.trustworthy

    def test_symmetric_latency_does_not_bias_slope(self):
        fit = compute_clock_drift(synthetic_sync(60, 30, rtt_ms=120))
        assert fit.ppm == pytest.approx(30, abs=0.1)
        assert fit.residual_rms_ms < 2

    def test_correction_maps_device_to_true_time(self):
        ppm = 40
        sync = synthetic_sync(60, ppm, rtt_ms=0)
        fit = compute_clock_drift(sync)

        device_at_hour = sync[0].t1_device_ms + 3_600_000
        corrected = fit.correct(device_at_hour)

        eps = ppm / 1e6
        expected = sync[0].t2_phone_unix_ms + 3_600_000 / (1 - eps)
        assert corrected == pytest.approx(expected, abs=1.0)

    def test_matches_typescript_reference_values(self):
        """Both parsers must agree; this pins the shared arithmetic."""
        fit = compute_clock_drift(synthetic_sync(60, 30, rtt_ms=0))
        assert fit.ppm == pytest.approx(30, abs=0.1)
        assert fit.span_ms == pytest.approx(59 * 60_000, rel=1e-3)
        assert len(fit.used) == 60
        assert fit.rejected == []

    def test_rejects_rtt_outliers(self):
        sync = synthetic_sync(60, 30, rtt_ms=40)
        for i in (10, 25, 40):
            sync[i].t4_device_ms += 3000

        fit = compute_clock_drift(sync)
        assert len(fit.rejected) == 3
        assert len(fit.used) == 57
        assert all("RTT" in r.reason for r in fit.rejected)
        assert fit.ppm == pytest.approx(30, abs=1.0)

    def test_unfiltered_outlier_corrupts_fit(self):
        sync = synthetic_sync(20, 30, rtt_ms=40)
        sync[19].t4_device_ms += 3000

        huge = float("inf")
        unfiltered = compute_clock_drift(
            sync, max_rtt_ms=huge, rtt_outlier_factor=huge
        )
        filtered = compute_clock_drift(sync)

        assert len(unfiltered.used) == 20
        assert abs(unfiltered.ppm - 30) > 100
        assert filtered.ppm == pytest.approx(30, abs=1.0)


class TestDegenerateCases:
    def test_zero_records(self):
        fit = compute_clock_drift([])
        assert fit.ppm == 0
        assert fit.used == []
        assert not fit.trustworthy
        assert "no sync records" in fit.warnings[0]
        assert fit.correct(123456) == 123456

    def test_single_record(self):
        sync = synthetic_sync(1, 30, rtt_ms=40)
        fit = compute_clock_drift(sync)

        assert fit.ppm == 0
        assert not fit.trustworthy
        assert "single sync record" in fit.warnings[0]

        obs = to_observation(sync[0])
        assert fit.correct(sync[0].t1_device_ms) == pytest.approx(
            sync[0].t1_device_ms + obs.offset_ms
        )

    def test_two_records_flagged_poorly_constrained(self):
        fit = compute_clock_drift(synthetic_sync(2, 30, rtt_ms=0))
        assert len(fit.used) == 2
        assert not fit.trustworthy
        assert any("poorly constrained" in w for w in fit.warnings)

    def test_all_records_rejected(self):
        fit = compute_clock_drift(synthetic_sync(10, 30, rtt_ms=5000))
        assert fit.used == []
        assert len(fit.rejected) == 10
        assert not fit.trustworthy
        assert "rejected as unusable" in fit.warnings[0]
        assert fit.correct(999) == 999

    def test_negative_rtt_rejected(self):
        sync = synthetic_sync(6, 30, rtt_ms=20)
        sync[2].t3_phone_unix_ms = sync[2].t2_phone_unix_ms + 5000

        fit = compute_clock_drift(sync)
        assert any(r.reason == "negative RTT" for r in fit.rejected)

    def test_identical_timestamps_no_divide_error(self):
        one = synthetic_sync(1, 0)[0]
        dup = [one, ClockSyncRecord(**vars(one)), ClockSyncRecord(**vars(one))]
        fit = compute_clock_drift(dup)

        assert fit.ppm == 0
        assert not fit.trustworthy
        assert any("one device timestamp" in w for w in fit.warnings)

    def test_short_span_flagged(self):
        fit = compute_clock_drift(synthetic_sync(5, 30, rtt_ms=0))
        assert not fit.trustworthy
        assert any("short" in w for w in fit.warnings)


class TestClockSteps:
    def test_detects_phone_clock_step(self):
        sync = synthetic_sync(40, 30, rtt_ms=20, phone_step_at=20, phone_step_ms=1200)

        steps = detect_clock_steps(
            [to_observation(r, i) for i, r in enumerate(sync)]
        )
        assert 20 in steps

        fit = compute_clock_drift(sync)
        assert fit.suspected_steps
        assert not fit.trustworthy
        assert any("clock step" in w for w in fit.warnings)

    def test_smooth_drift_has_no_false_positives(self):
        obs = [
            to_observation(r, i)
            for i, r in enumerate(synthetic_sync(60, 45, rtt_ms=30))
        ]
        assert detect_clock_steps(obs) == []

    def test_step_corrupts_single_line_fit(self):
        clean = compute_clock_drift(synthetic_sync(40, 30, rtt_ms=0))
        stepped = compute_clock_drift(
            synthetic_sync(40, 30, rtt_ms=0, phone_step_at=20, phone_step_ms=1200)
        )

        assert clean.ppm == pytest.approx(30, abs=0.1)
        assert abs(stepped.ppm - 30) > 50
        assert not stepped.trustworthy
