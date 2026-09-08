"""
VTX Binary Format Parser for Python
Reads IMU data from .vtx binary files
"""

from .decoder import VTXDecoder, decode_vtx, read_vtx_header, read_vtx_metadata
from .clock_drift import (
    ClockDriftFit,
    ClockSyncObservation,
    compute_clock_drift,
    detect_clock_steps,
    to_observation,
)
from .timestamp_reconstruction import (
    BatchRun,
    TimestampGap,
    TimestampQualityReport,
    TimestampReconstructionResult,
    find_batch_runs,
    reconstruct_and_correct,
    reconstruct_record_timestamps,
    reconstruct_timestamps,
)
from .types import (
    VTXHeader,
    VTXMetadata,
    IMURecord,
    ClockSyncRecord,
    VTXFile,
    RecordFormatFlags,
    VTX_CONSTANTS,
)

__version__ = "0.5.0"

__all__ = [
    "VTXDecoder",
    "decode_vtx",
    "read_vtx_header",
    "read_vtx_metadata",
    "VTXHeader",
    "VTXMetadata",
    "IMURecord",
    "ClockSyncRecord",
    "VTXFile",
    "ClockDriftFit",
    "ClockSyncObservation",
    "compute_clock_drift",
    "detect_clock_steps",
    "to_observation",
    "BatchRun",
    "TimestampGap",
    "TimestampQualityReport",
    "TimestampReconstructionResult",
    "find_batch_runs",
    "reconstruct_timestamps",
    "reconstruct_record_timestamps",
    "reconstruct_and_correct",
    "RecordFormatFlags",
    "VTX_CONSTANTS",
]
