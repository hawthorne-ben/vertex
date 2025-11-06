"""
Tests for VTX decoder
"""

import pytest
import struct
import json
from vtx_parser import (
    VTXDecoder,
    decode_vtx,
    read_vtx_header,
    read_vtx_metadata,
    VTX_CONSTANTS,
    RecordFormatFlags,
)


def create_minimal_vtx_file(
    record_count: int = 10,
    sample_rate: float = 100.0,
    start_timestamp: int = 1700000000000,
    has_mag: bool = False,
    has_quat: bool = False,
    metadata: dict = None,
) -> bytes:
    """
    Create a minimal valid VTX file for testing

    Args:
        record_count: Number of data records
        sample_rate: Sample rate in Hz
        start_timestamp: Start timestamp in milliseconds
        has_mag: Include magnetometer data
        has_quat: Include quaternion data
        metadata: Metadata dictionary

    Returns:
        Raw bytes of VTX file
    """
    # Calculate record format flags
    record_format = 0
    if has_mag:
        record_format |= RecordFormatFlags.HAS_MAG
    if has_quat:
        record_format |= RecordFormatFlags.HAS_QUAT

    # Calculate record size
    record_size = 4 + 24  # timestamp + accel + gyro
    if has_mag:
        record_size += 12
    if has_quat:
        record_size += 16

    # Prepare metadata
    metadata_json = json.dumps(metadata or {}).encode("utf-8")
    metadata_length = len(metadata_json)

    # Calculate data offset
    data_offset = VTX_CONSTANTS.HEADER_SIZE + metadata_length

    # Calculate timestamps
    duration_ms = int((record_count - 1) * 1000.0 / sample_rate)
    end_timestamp = start_timestamp + duration_ms

    # Build header (64 bytes)
    header = bytearray()

    # Magic bytes "VTX\0"
    header.extend(b"VTX\0")

    # Version (major, minor)
    header.extend(struct.pack("<H", VTX_CONSTANTS.VERSION_MAJOR))
    header.extend(struct.pack("<H", VTX_CONSTANTS.VERSION_MINOR))

    # Metadata length
    header.extend(struct.pack("<I", metadata_length))

    # Data offset
    header.extend(struct.pack("<I", data_offset))

    # Record count
    header.extend(struct.pack("<Q", record_count))

    # Sample rate
    header.extend(struct.pack("<f", sample_rate))

    # Start timestamp
    header.extend(struct.pack("<q", start_timestamp))

    # End timestamp
    header.extend(struct.pack("<q", end_timestamp))

    # Record format
    header.extend(struct.pack("<B", record_format))

    # Compression
    header.extend(struct.pack("<B", VTX_CONSTANTS.COMPRESSION_NONE))

    # Reserved (18 bytes)
    header.extend(b"\0" * 18)

    assert len(header) == VTX_CONSTANTS.HEADER_SIZE

    # Build file
    file_data = bytearray(header)
    file_data.extend(metadata_json)

    # Add data records
    for i in range(record_count):
        # Timestamp offset (milliseconds from start)
        timestamp_offset = int(i * 1000.0 / sample_rate)
        file_data.extend(struct.pack("<I", timestamp_offset))

        # Accelerometer (m/s²)
        file_data.extend(struct.pack("<f", float(i) * 0.1))  # accel_x
        file_data.extend(struct.pack("<f", float(i) * 0.2))  # accel_y
        file_data.extend(struct.pack("<f", 9.8 + float(i) * 0.05))  # accel_z

        # Gyroscope (rad/s)
        file_data.extend(struct.pack("<f", float(i) * 0.01))  # gyro_x
        file_data.extend(struct.pack("<f", float(i) * 0.02))  # gyro_y
        file_data.extend(struct.pack("<f", float(i) * 0.03))  # gyro_z

        # Magnetometer (optional)
        if has_mag:
            file_data.extend(struct.pack("<f", 30.0 + float(i) * 0.1))  # mag_x
            file_data.extend(struct.pack("<f", 20.0 + float(i) * 0.2))  # mag_y
            file_data.extend(struct.pack("<f", 40.0 + float(i) * 0.15))  # mag_z

        # Quaternion (optional)
        if has_quat:
            file_data.extend(struct.pack("<f", 1.0))  # quat_w
            file_data.extend(struct.pack("<f", 0.0))  # quat_x
            file_data.extend(struct.pack("<f", 0.0))  # quat_y
            file_data.extend(struct.pack("<f", 0.0))  # quat_z

    return bytes(file_data)


class TestVTXDecoder:
    """Tests for VTXDecoder class"""

    def test_decode_minimal_file(self):
        """Test decoding a minimal VTX file"""
        vtx_data = create_minimal_vtx_file(record_count=10)
        decoder = VTXDecoder(vtx_data)
        result = decoder.decode()

        assert result.header.magic == VTX_CONSTANTS.MAGIC
        assert result.header.version_major == VTX_CONSTANTS.VERSION_MAJOR
        assert result.header.record_count == 10
        assert len(result.records) == 10

    def test_read_header(self):
        """Test reading just the header"""
        vtx_data = create_minimal_vtx_file(
            record_count=100, sample_rate=50.0, start_timestamp=1234567890000
        )
        decoder = VTXDecoder(vtx_data)
        header = decoder.read_header()

        assert header.magic == VTX_CONSTANTS.MAGIC
        assert header.version_major == 1
        assert header.version_minor == 0
        assert header.record_count == 100
        assert header.sample_rate == 50.0
        assert header.start_timestamp == 1234567890000

    def test_read_metadata(self):
        """Test reading metadata"""
        metadata = {"device": "test-device", "version": "1.0", "notes": "Test file"}
        vtx_data = create_minimal_vtx_file(metadata=metadata)
        decoder = VTXDecoder(vtx_data)
        decoder.read_header()
        result_metadata = decoder.read_metadata()

        assert result_metadata == metadata

    def test_empty_metadata(self):
        """Test file with empty metadata"""
        vtx_data = create_minimal_vtx_file(metadata={})
        decoder = VTXDecoder(vtx_data)
        result = decoder.decode()

        assert result.metadata == {}

    def test_read_records(self):
        """Test reading data records"""
        vtx_data = create_minimal_vtx_file(record_count=20, sample_rate=100.0)
        decoder = VTXDecoder(vtx_data)
        decoder.read_header()
        records = decoder.read_records(0, 10)

        assert len(records) == 10
        assert records[0].accel_x == 0.0
        assert records[1].accel_x == pytest.approx(0.1, rel=1e-5)

    def test_read_single_record(self):
        """Test reading a single record"""
        vtx_data = create_minimal_vtx_file(record_count=10)
        decoder = VTXDecoder(vtx_data)
        decoder.read_header()
        record = decoder.read_record(5)

        assert record.accel_x == pytest.approx(0.5, rel=1e-5)
        assert record.accel_y == pytest.approx(1.0, rel=1e-5)
        assert record.gyro_x == pytest.approx(0.05, rel=1e-5)

    def test_magnetometer_data(self):
        """Test reading file with magnetometer data"""
        vtx_data = create_minimal_vtx_file(record_count=5, has_mag=True)
        decoder = VTXDecoder(vtx_data)
        result = decoder.decode()

        assert result.header.record_format & RecordFormatFlags.HAS_MAG
        assert result.records[0].mag_x is not None
        assert result.records[0].mag_x == pytest.approx(30.0, rel=1e-5)

    def test_quaternion_data(self):
        """Test reading file with quaternion data"""
        vtx_data = create_minimal_vtx_file(record_count=5, has_quat=True)
        decoder = VTXDecoder(vtx_data)
        result = decoder.decode()

        assert result.header.record_format & RecordFormatFlags.HAS_QUAT
        assert result.records[0].quat_w is not None
        assert result.records[0].quat_w == pytest.approx(1.0, rel=1e-5)

    def test_header_only_option(self):
        """Test header_only decode option"""
        vtx_data = create_minimal_vtx_file(record_count=100)
        decoder = VTXDecoder(vtx_data)
        result = decoder.decode(header_only=True)

        assert result.header.record_count == 100
        assert len(result.records) == 0

    def test_max_records_option(self):
        """Test max_records decode option"""
        vtx_data = create_minimal_vtx_file(record_count=100)
        decoder = VTXDecoder(vtx_data)
        result = decoder.decode(max_records=10)

        assert result.header.record_count == 100
        assert len(result.records) == 10

    def test_skip_metadata_option(self):
        """Test skip_metadata decode option"""
        metadata = {"device": "test", "version": "1.0"}
        vtx_data = create_minimal_vtx_file(metadata=metadata)
        decoder = VTXDecoder(vtx_data)
        result = decoder.decode(skip_metadata=True)

        assert result.metadata == {}

    def test_invalid_magic_bytes(self):
        """Test error handling for invalid magic bytes"""
        vtx_data = create_minimal_vtx_file()
        bad_data = b"BAD\0" + vtx_data[4:]

        decoder = VTXDecoder(bad_data)
        with pytest.raises(ValueError, match="Invalid VTX file"):
            decoder.read_header()

    def test_file_too_small(self):
        """Test error handling for truncated file"""
        vtx_data = create_minimal_vtx_file()
        truncated = vtx_data[:30]  # Less than header size

        decoder = VTXDecoder(truncated)
        with pytest.raises(ValueError, match="File too small"):
            decoder.read_header()

    def test_invalid_version(self):
        """Test error handling for unsupported version"""
        vtx_data = bytearray(create_minimal_vtx_file())
        # Change major version to 99
        vtx_data[4:6] = struct.pack("<H", 99)

        decoder = VTXDecoder(bytes(vtx_data))
        with pytest.raises(ValueError, match="Unsupported VTX version"):
            decoder.read_header()

    def test_invalid_record_index(self):
        """Test error handling for invalid record index"""
        vtx_data = create_minimal_vtx_file(record_count=10)
        decoder = VTXDecoder(vtx_data)
        decoder.read_header()

        with pytest.raises(ValueError, match="Invalid record index"):
            decoder.read_record(100)

    def test_get_duration(self):
        """Test duration calculation"""
        start_ts = 1700000000000
        vtx_data = create_minimal_vtx_file(
            record_count=100, sample_rate=100.0, start_timestamp=start_ts
        )
        decoder = VTXDecoder(vtx_data)

        duration = decoder.get_duration()
        expected_duration = int((100 - 1) * 1000.0 / 100.0)
        assert duration == expected_duration

    def test_timestamps_are_sequential(self):
        """Test that timestamps increase sequentially"""
        start_ts = 1700000000000
        vtx_data = create_minimal_vtx_file(
            record_count=10, sample_rate=100.0, start_timestamp=start_ts
        )
        decoder = VTXDecoder(vtx_data)
        result = decoder.decode()

        for i in range(len(result.records) - 1):
            assert result.records[i + 1].timestamp > result.records[i].timestamp


class TestConvenienceFunctions:
    """Tests for convenience functions"""

    def test_decode_vtx(self):
        """Test decode_vtx convenience function"""
        vtx_data = create_minimal_vtx_file(record_count=10)
        result = decode_vtx(vtx_data)

        assert result.header.record_count == 10
        assert len(result.records) == 10

    def test_read_vtx_header(self):
        """Test read_vtx_header convenience function"""
        vtx_data = create_minimal_vtx_file(record_count=50, sample_rate=75.0)
        header = read_vtx_header(vtx_data)

        assert header.record_count == 50
        assert header.sample_rate == 75.0

    def test_read_vtx_metadata(self):
        """Test read_vtx_metadata convenience function"""
        metadata = {"device": "test-device"}
        vtx_data = create_minimal_vtx_file(metadata=metadata)
        header, result_metadata = read_vtx_metadata(vtx_data)

        assert header.magic == VTX_CONSTANTS.MAGIC
        assert result_metadata == metadata


class TestRealWorldScenarios:
    """Tests for real-world usage scenarios"""

    def test_large_file(self):
        """Test handling of large file (10000 records)"""
        vtx_data = create_minimal_vtx_file(record_count=10000, sample_rate=100.0)
        decoder = VTXDecoder(vtx_data)
        result = decoder.decode()

        assert len(result.records) == 10000
        assert result.records[-1].timestamp > result.records[0].timestamp

    def test_partial_read(self):
        """Test reading only a portion of records"""
        vtx_data = create_minimal_vtx_file(record_count=1000, sample_rate=100.0)
        decoder = VTXDecoder(vtx_data)
        decoder.read_header()

        # Read first 100 records
        records = decoder.read_records(0, 100)
        assert len(records) == 100

        # Read next 100 records
        records = decoder.read_records(100, 100)
        assert len(records) == 100

    def test_full_format_file(self):
        """Test file with all optional fields"""
        vtx_data = create_minimal_vtx_file(
            record_count=50, has_mag=True, has_quat=True
        )
        decoder = VTXDecoder(vtx_data)
        result = decoder.decode()

        record = result.records[0]
        assert record.accel_x is not None
        assert record.gyro_x is not None
        assert record.mag_x is not None
        assert record.quat_w is not None
