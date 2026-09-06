"""
Type definitions for VTX binary format
"""

from typing import TypedDict, Optional, List, Dict, Any
from dataclasses import dataclass


class VTX_CONSTANTS:
    """Constants for VTX file format"""
    MAGIC = "VTX\0"
    VERSION_MAJOR = 1
    VERSION_MINOR = 2
    HEADER_SIZE = 64
    COMPRESSION_NONE = 0
    GPS_RECORD_SIZE = 44   # v1.1+
    SYNC_RECORD_SIZE = 24  # v1.2+


class RecordFormatFlags:
    """Bitmask flags for record format"""
    HAS_ACCEL = 1 << 0  # 0x01 - Has acceleration data (always 1 in v1.0)
    HAS_GYRO = 1 << 1   # 0x02 - Has gyroscope data (always 1 in v1.0)
    HAS_MAG = 1 << 2    # 0x04 - Has magnetometer data
    HAS_QUAT = 1 << 3   # 0x08 - Has quaternion data
    HAS_EULER = 1 << 4  # 0x10 - Has Euler angle data (roll, pitch, yaw)


@dataclass
class VTXHeader:
    """VTX file header"""
    magic: str
    version_major: int
    version_minor: int
    metadata_length: int
    data_offset: int
    record_count: int
    sample_rate: float
    start_timestamp: int
    end_timestamp: int
    record_format: int
    compression: int
    gps_record_count: Optional[int] = None  # v1.1+ only
    gps_data_offset: Optional[int] = None   # v1.1+ only
    sync_record_count: Optional[int] = None  # v1.2+ only
    sync_data_offset: Optional[int] = None   # v1.2+ only


@dataclass
class IMURecord:
    """Single IMU data record"""
    timestamp: int  # Unix timestamp in milliseconds
    accel_x: float
    accel_y: float
    accel_z: float
    gyro_x: float
    gyro_y: float
    gyro_z: float
    mag_x: Optional[float] = None
    mag_y: Optional[float] = None
    mag_z: Optional[float] = None
    quat_w: Optional[float] = None
    quat_x: Optional[float] = None
    quat_y: Optional[float] = None
    quat_z: Optional[float] = None
    roll: Optional[float] = None  # Euler angle: roll (degrees)
    pitch: Optional[float] = None  # Euler angle: pitch (degrees)
    yaw: Optional[float] = None  # Euler angle: yaw (degrees)


@dataclass
class ClockSyncRecord:
    """
    Single clock sync record (v1.2+), 24 bytes.

    An NTP-style four-timestamp exchange between device and phone, recorded
    as an observation of the device time base. Never applied as a correction
    on-device — see packages/vtx-format/spec/v1.2-clock-sync.md.
    """
    t1_device_ms: int   # device millis() when request was sent
    t4_device_ms: int   # device millis() when response was received
    t2_phone_unix_ms: int  # phone Date.now() at receipt of request
    t3_phone_unix_ms: int  # phone Date.now() at send of response


VTXMetadata = Dict[str, Any]


@dataclass
class VTXFile:
    """Complete VTX file contents"""
    header: VTXHeader
    metadata: VTXMetadata
    records: List[IMURecord]
    sync_records: Optional[List[ClockSyncRecord]] = None  # v1.2+
