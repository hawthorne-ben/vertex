"""
VTX Binary Format Parser for Python
Reads IMU data from .vtx binary files
"""

from .decoder import VTXDecoder, decode_vtx, read_vtx_header, read_vtx_metadata
from .types import (
    VTXHeader,
    VTXMetadata,
    IMURecord,
    VTXFile,
    RecordFormatFlags,
    VTX_CONSTANTS,
)

__version__ = "0.3.1"

__all__ = [
    "VTXDecoder",
    "decode_vtx",
    "read_vtx_header",
    "read_vtx_metadata",
    "VTXHeader",
    "VTXMetadata",
    "IMURecord",
    "VTXFile",
    "RecordFormatFlags",
    "VTX_CONSTANTS",
]
