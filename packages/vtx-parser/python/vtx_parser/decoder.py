"""
VTX Binary Format Decoder
Reads IMU data from .vtx binary files
"""

import struct
import json
from typing import List, Optional
from .types import (
    VTXHeader,
    VTXMetadata,
    IMURecord,
    VTXFile,
    VTX_CONSTANTS,
    RecordFormatFlags,
)


class VTXDecoder:
    """Decoder for VTX binary format files"""

    def __init__(self, data: bytes):
        """
        Initialize decoder with binary data

        Args:
            data: Raw bytes from VTX file
        """
        self.data = data
        self.header: Optional[VTXHeader] = None
        self.metadata: Optional[VTXMetadata] = None
        self.record_size: int = 0

    def decode(
        self,
        skip_metadata: bool = False,
        header_only: bool = False,
        max_records: Optional[int] = None,
    ) -> VTXFile:
        """
        Decode the entire VTX file

        Args:
            skip_metadata: Skip parsing metadata section
            header_only: Only parse header, skip records
            max_records: Maximum number of records to read

        Returns:
            Complete VTX file contents
        """
        # Parse header
        self.header = self.read_header()

        # Parse metadata (unless skipped)
        if not skip_metadata:
            self.metadata = self.read_metadata()
        else:
            self.metadata = {}

        # Return early if header only
        if header_only:
            return VTXFile(header=self.header, metadata=self.metadata, records=[])

        # Parse data records
        record_count = self.header.record_count
        if max_records is not None:
            record_count = min(max_records, record_count)

        records = self.read_records(0, record_count)

        return VTXFile(header=self.header, metadata=self.metadata, records=records)

    def read_header(self) -> VTXHeader:
        """
        Read file header (50 bytes for v1.0, 64 bytes for v1.1+)

        Returns:
            Parsed header

        Raises:
            ValueError: If file is invalid or corrupted
        """
        # Minimum header size for v1.0 is 50 bytes
        MIN_HEADER_SIZE = 50
        if len(self.data) < MIN_HEADER_SIZE:
            raise ValueError(
                f"File too small: expected at least {MIN_HEADER_SIZE} bytes, "
                f"got {len(self.data)}"
            )

        offset = 0

        # Magic bytes "VTX\0" (4 bytes)
        magic = self.data[0:4].decode("utf-8", errors="replace")
        if magic != VTX_CONSTANTS.MAGIC:
            raise ValueError(
                f'Invalid VTX file: expected magic "{VTX_CONSTANTS.MAGIC}", got "{magic}"'
            )
        offset += 4

        # Version (2 + 2 = 4 bytes)
        version_major = struct.unpack("<H", self.data[offset : offset + 2])[0]
        offset += 2
        version_minor = struct.unpack("<H", self.data[offset : offset + 2])[0]
        offset += 2

        # Validate version
        if version_major != VTX_CONSTANTS.VERSION_MAJOR:
            raise ValueError(
                f"Unsupported VTX version: {version_major}.{version_minor} "
                f"(expected {VTX_CONSTANTS.VERSION_MAJOR}.x)"
            )

        # Metadata length (4 bytes)
        metadata_length = struct.unpack("<I", self.data[offset : offset + 4])[0]
        offset += 4

        # Data offset (4 bytes)
        data_offset = struct.unpack("<I", self.data[offset : offset + 4])[0]
        offset += 4

        # Record count (8 bytes)
        record_count = struct.unpack("<Q", self.data[offset : offset + 8])[0]
        offset += 8

        # Sample rate (4 bytes float32)
        sample_rate = struct.unpack("<f", self.data[offset : offset + 4])[0]
        offset += 4

        # Start timestamp (8 bytes)
        start_timestamp = struct.unpack("<q", self.data[offset : offset + 8])[0]
        offset += 8

        # End timestamp (8 bytes)
        end_timestamp = struct.unpack("<q", self.data[offset : offset + 8])[0]
        offset += 8

        # Record format (1 byte)
        record_format = struct.unpack("<B", self.data[offset : offset + 1])[0]
        offset += 1

        # Compression (1 byte)
        compression = struct.unpack("<B", self.data[offset : offset + 1])[0]
        offset += 1

        # Validate compression
        if compression != VTX_CONSTANTS.COMPRESSION_NONE:
            raise ValueError(
                f"Unsupported compression type: {compression} "
                "(only uncompressed files supported)"
            )

        # Calculate record size based on format flags
        self.record_size = self._calculate_record_size(record_format)

        # GPS record count (8 bytes, v1.1+)
        gps_record_count = None
        gps_data_offset = None

        if version_minor >= 1:
            # v1.1+ has GPS fields
            gps_count = struct.unpack("<Q", self.data[offset : offset + 8])[0]
            offset += 8

            gps_offset = struct.unpack("<I", self.data[offset : offset + 4])[0]
            offset += 4

            # Only set if non-zero
            if gps_count > 0:
                gps_record_count = gps_count
                gps_data_offset = gps_offset

            # Skip remaining reserved fields (6 bytes)
            # offset += 6  # Not needed as we're done with header
        else:
            # v1.0 has no GPS fields
            # Skip all reserved fields (18 bytes)
            # offset += 18  # Not needed as we're done with header
            pass

        header = VTXHeader(
            magic=magic,
            version_major=version_major,
            version_minor=version_minor,
            metadata_length=metadata_length,
            data_offset=data_offset,
            record_count=record_count,
            sample_rate=sample_rate,
            start_timestamp=start_timestamp,
            end_timestamp=end_timestamp,
            record_format=record_format,
            compression=compression,
            gps_record_count=gps_record_count,
            gps_data_offset=gps_data_offset,
        )

        self.header = header
        return header

    def _calculate_record_size(self, record_format: int) -> int:
        """Calculate record size from format bitmask"""
        size = 4  # timestamp_ms (uint32)
        size += 24  # accel (3 * float32) + gyro (3 * float32)

        if record_format & RecordFormatFlags.HAS_MAG:
            size += 12  # mag (3 * float32)

        if record_format & RecordFormatFlags.HAS_QUAT:
            size += 16  # quat (4 * float32)

        if record_format & RecordFormatFlags.HAS_EULER:
            size += 12  # euler (3 * float32: roll, pitch, yaw)

        return size

    def read_metadata(self) -> VTXMetadata:
        """
        Read metadata JSON section

        Returns:
            Parsed metadata dictionary

        Raises:
            ValueError: If metadata is invalid
        """
        if self.header is None:
            raise ValueError("Must read header before metadata")

        if self.header.metadata_length == 0:
            return {}

        metadata_start = VTX_CONSTANTS.HEADER_SIZE
        metadata_end = metadata_start + self.header.metadata_length

        if len(self.data) < metadata_end:
            raise ValueError("File truncated: metadata section incomplete")

        metadata_bytes = self.data[metadata_start:metadata_end]
        metadata_json = metadata_bytes.decode("utf-8")

        try:
            metadata = json.loads(metadata_json)
            self.metadata = metadata
            return metadata
        except json.JSONDecodeError as e:
            raise ValueError(f"Invalid metadata JSON: {e}")

    def read_records(self, start_index: int, count: int) -> List[IMURecord]:
        """
        Read a range of data records

        Args:
            start_index: Starting record index
            count: Number of records to read

        Returns:
            List of IMU records

        Raises:
            ValueError: If indices are invalid
        """
        if self.header is None:
            raise ValueError("Must read header before records")

        total_records = self.header.record_count
        if start_index < 0 or start_index >= total_records:
            raise ValueError(
                f"Invalid start index: {start_index} (file has {total_records} records)"
            )

        actual_count = min(count, total_records - start_index)
        records: List[IMURecord] = []

        for i in range(actual_count):
            record = self.read_record(start_index + i)
            records.append(record)

        return records

    def read_record(self, index: int) -> IMURecord:
        """
        Read a single data record by index

        Args:
            index: Record index

        Returns:
            IMU record

        Raises:
            ValueError: If index is invalid or file is truncated
        """
        if self.header is None:
            raise ValueError("Must read header before records")

        total_records = self.header.record_count
        if index < 0 or index >= total_records:
            raise ValueError(
                f"Invalid record index: {index} (file has {total_records} records)"
            )

        # Calculate byte offset for this record
        offset = self.header.data_offset + index * self.record_size

        if len(self.data) < offset + self.record_size:
            raise ValueError(f"File truncated: record {index} incomplete")

        # Read timestamp offset (uint32 milliseconds from start)
        timestamp_offset = struct.unpack("<I", self.data[offset : offset + 4])[0]
        offset += 4

        # Calculate absolute timestamp
        timestamp = self.header.start_timestamp + timestamp_offset

        # Read accelerometer (3 * float32)
        accel_x = struct.unpack("<f", self.data[offset : offset + 4])[0]
        offset += 4
        accel_y = struct.unpack("<f", self.data[offset : offset + 4])[0]
        offset += 4
        accel_z = struct.unpack("<f", self.data[offset : offset + 4])[0]
        offset += 4

        # Read gyroscope (3 * float32)
        gyro_x = struct.unpack("<f", self.data[offset : offset + 4])[0]
        offset += 4
        gyro_y = struct.unpack("<f", self.data[offset : offset + 4])[0]
        offset += 4
        gyro_z = struct.unpack("<f", self.data[offset : offset + 4])[0]
        offset += 4

        record = IMURecord(
            timestamp=timestamp,
            accel_x=accel_x,
            accel_y=accel_y,
            accel_z=accel_z,
            gyro_x=gyro_x,
            gyro_y=gyro_y,
            gyro_z=gyro_z,
        )

        # Read magnetometer (3 * float32) - optional
        if self.header.record_format & RecordFormatFlags.HAS_MAG:
            record.mag_x = struct.unpack("<f", self.data[offset : offset + 4])[0]
            offset += 4
            record.mag_y = struct.unpack("<f", self.data[offset : offset + 4])[0]
            offset += 4
            record.mag_z = struct.unpack("<f", self.data[offset : offset + 4])[0]
            offset += 4

        # Read quaternion (4 * float32) - optional
        if self.header.record_format & RecordFormatFlags.HAS_QUAT:
            record.quat_w = struct.unpack("<f", self.data[offset : offset + 4])[0]
            offset += 4
            record.quat_x = struct.unpack("<f", self.data[offset : offset + 4])[0]
            offset += 4
            record.quat_y = struct.unpack("<f", self.data[offset : offset + 4])[0]
            offset += 4
            record.quat_z = struct.unpack("<f", self.data[offset : offset + 4])[0]
            offset += 4

        # Read Euler angles (3 * float32) - optional
        if self.header.record_format & RecordFormatFlags.HAS_EULER:
            record.roll = struct.unpack("<f", self.data[offset : offset + 4])[0]
            offset += 4
            record.pitch = struct.unpack("<f", self.data[offset : offset + 4])[0]
            offset += 4
            record.yaw = struct.unpack("<f", self.data[offset : offset + 4])[0]
            offset += 4

        return record

    def get_header(self) -> VTXHeader:
        """Get header without reading entire file"""
        if self.header is None:
            self.header = self.read_header()
        return self.header

    def get_metadata(self) -> VTXMetadata:
        """Get metadata without reading records"""
        if self.header is None:
            self.read_header()
        if self.metadata is None:
            self.metadata = self.read_metadata()
        return self.metadata

    def get_record_count(self) -> int:
        """Get total record count"""
        if self.header is None:
            self.read_header()
        return self.header.record_count

    def get_duration(self) -> int:
        """Get file duration in milliseconds"""
        if self.header is None:
            self.read_header()
        return self.header.end_timestamp - self.header.start_timestamp

    def get_sample_rate(self) -> float:
        """Get sample rate in Hz"""
        if self.header is None:
            self.read_header()
        return self.header.sample_rate


# Convenience functions


def decode_vtx(
    data: bytes,
    skip_metadata: bool = False,
    header_only: bool = False,
    max_records: Optional[int] = None,
) -> VTXFile:
    """
    Convenience function to decode a VTX file from bytes

    Args:
        data: Raw bytes from VTX file
        skip_metadata: Skip parsing metadata section
        header_only: Only parse header, skip records
        max_records: Maximum number of records to read

    Returns:
        Complete VTX file contents
    """
    decoder = VTXDecoder(data)
    return decoder.decode(
        skip_metadata=skip_metadata, header_only=header_only, max_records=max_records
    )


def read_vtx_header(data: bytes) -> VTXHeader:
    """
    Convenience function to read just the header

    Args:
        data: Raw bytes from VTX file

    Returns:
        Parsed header
    """
    decoder = VTXDecoder(data)
    return decoder.read_header()


def read_vtx_metadata(data: bytes) -> tuple[VTXHeader, VTXMetadata]:
    """
    Convenience function to read header and metadata

    Args:
        data: Raw bytes from VTX file

    Returns:
        Tuple of (header, metadata)
    """
    decoder = VTXDecoder(data)
    header = decoder.read_header()
    metadata = decoder.read_metadata()
    return header, metadata
