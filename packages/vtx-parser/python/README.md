# VTX Parser - Python

Python decoder for VTX binary IMU data format. Part of the Vertex cycling data analysis platform.

## Installation

```bash
pip install vtx-parser
```

For development with pandas support:
```bash
pip install vtx-parser[pandas]
```

## Quick Start

```python
from vtx_parser import decode_vtx

# Read VTX file
with open('recording.vtx', 'rb') as f:
    data = f.read()

# Decode the file
vtx_file = decode_vtx(data)

# Access header information
print(f"Sample rate: {vtx_file.header.sample_rate} Hz")
print(f"Record count: {vtx_file.header.record_count}")
print(f"Duration: {vtx_file.header.end_timestamp - vtx_file.header.start_timestamp} ms")

# Access IMU data
for record in vtx_file.records:
    print(f"Time: {record.timestamp}, Accel: ({record.accel_x}, {record.accel_y}, {record.accel_z})")
```

## API Reference

### Main Functions

#### `decode_vtx(data, skip_metadata=False, header_only=False, max_records=None)`

Decode a complete VTX file.

**Parameters:**
- `data` (bytes): Raw bytes from VTX file
- `skip_metadata` (bool): Skip parsing metadata section
- `header_only` (bool): Only parse header, skip records
- `max_records` (int, optional): Maximum number of records to read

**Returns:** `VTXFile` object with header, metadata, and records

**Example:**
```python
# Read only first 1000 records
vtx_file = decode_vtx(data, max_records=1000)

# Read header only (fast)
vtx_file = decode_vtx(data, header_only=True)
```

#### `read_vtx_header(data)`

Read just the file header (fast, minimal parsing).

**Parameters:**
- `data` (bytes): Raw bytes from VTX file

**Returns:** `VTXHeader` object

#### `read_vtx_metadata(data)`

Read header and metadata without parsing records.

**Parameters:**
- `data` (bytes): Raw bytes from VTX file

**Returns:** Tuple of `(VTXHeader, VTXMetadata)`

### Classes

#### `VTXDecoder`

Main decoder class for VTX files.

**Methods:**
- `decode(skip_metadata=False, header_only=False, max_records=None)` - Decode the file
- `read_header()` - Read file header
- `read_metadata()` - Read metadata section
- `read_records(start_index, count)` - Read a range of records
- `read_record(index)` - Read a single record
- `get_header()` - Get header (cached)
- `get_metadata()` - Get metadata (cached)
- `get_record_count()` - Get total record count
- `get_duration()` - Get file duration in milliseconds
- `get_sample_rate()` - Get sample rate in Hz

**Example:**
```python
from vtx_parser import VTXDecoder

with open('recording.vtx', 'rb') as f:
    data = f.read()

decoder = VTXDecoder(data)

# Read header first
header = decoder.read_header()
print(f"File has {header.record_count} records")

# Read records in chunks
chunk_size = 1000
for i in range(0, header.record_count, chunk_size):
    records = decoder.read_records(i, chunk_size)
    # Process records...
```

#### `VTXFile`

Container for complete VTX file contents.

**Attributes:**
- `header` (VTXHeader): File header
- `metadata` (dict): Metadata dictionary
- `records` (list[IMURecord]): List of IMU data records

#### `VTXHeader`

File header information.

**Attributes:**
- `magic` (str): Magic bytes ("VTX\0")
- `version_major` (int): Major version
- `version_minor` (int): Minor version
- `metadata_length` (int): Metadata section length in bytes
- `data_offset` (int): Offset to data section
- `record_count` (int): Total number of records
- `sample_rate` (float): Sample rate in Hz
- `start_timestamp` (int): Start time (Unix milliseconds)
- `end_timestamp` (int): End time (Unix milliseconds)
- `record_format` (int): Record format bitmask
- `compression` (int): Compression type

#### `IMURecord`

Single IMU data sample.

**Attributes:**
- `timestamp` (int): Unix timestamp in milliseconds
- `accel_x` (float): Accelerometer X (m/s²)
- `accel_y` (float): Accelerometer Y (m/s²)
- `accel_z` (float): Accelerometer Z (m/s²)
- `gyro_x` (float): Gyroscope X (rad/s)
- `gyro_y` (float): Gyroscope Y (rad/s)
- `gyro_z` (float): Gyroscope Z (rad/s)
- `mag_x` (float, optional): Magnetometer X (µT)
- `mag_y` (float, optional): Magnetometer Y (µT)
- `mag_z` (float, optional): Magnetometer Z (µT)
- `quat_w` (float, optional): Quaternion W
- `quat_x` (float, optional): Quaternion X
- `quat_y` (float, optional): Quaternion Y
- `quat_z` (float, optional): Quaternion Z

## Integration with Pandas

Convert VTX data to pandas DataFrame for analysis:

```python
import pandas as pd
from vtx_parser import decode_vtx

with open('recording.vtx', 'rb') as f:
    vtx_file = decode_vtx(f.read())

# Convert to DataFrame
data = []
for record in vtx_file.records:
    data.append({
        'timestamp': record.timestamp,
        'time_sec': (record.timestamp - vtx_file.records[0].timestamp) / 1000.0,
        'accel_x': record.accel_x,
        'accel_y': record.accel_y,
        'accel_z': record.accel_z,
        'gyro_x': record.gyro_x,
        'gyro_y': record.gyro_y,
        'gyro_z': record.gyro_z,
    })

df = pd.DataFrame(data)

# Compute sample rate
time_diffs = df['time_sec'].diff().dropna()
sample_rate = 1.0 / time_diffs.mean()
print(f"Computed sample rate: {sample_rate:.2f} Hz")

# Basic statistics
print(df.describe())
```

## Performance Tips

1. **Use `header_only=True` for metadata inspection:**
   ```python
   vtx_file = decode_vtx(data, header_only=True)
   print(f"File has {vtx_file.header.record_count} records")
   ```

2. **Read records in chunks for large files:**
   ```python
   decoder = VTXDecoder(data)
   header = decoder.read_header()

   for i in range(0, header.record_count, 1000):
       records = decoder.read_records(i, 1000)
       # Process chunk...
   ```

3. **Use `max_records` to limit memory usage:**
   ```python
   # Only load first 10,000 records
   vtx_file = decode_vtx(data, max_records=10000)
   ```

## Error Handling

```python
from vtx_parser import decode_vtx

try:
    with open('recording.vtx', 'rb') as f:
        vtx_file = decode_vtx(f.read())
except ValueError as e:
    print(f"Invalid VTX file: {e}")
except FileNotFoundError:
    print("File not found")
```

Common errors:
- `ValueError`: Invalid file format, corrupted data, or unsupported version
- `FileNotFoundError`: File doesn't exist

## Development

### Running Tests

```bash
# Install dev dependencies
pip install -e ".[dev]"

# Run tests
pytest

# Run tests with coverage
pytest --cov=vtx_parser --cov-report=html
```

### Building from Source

```bash
# Clone the repository
git clone https://github.com/your-org/vertex.git
cd vertex/packages/vtx-parser/python

# Install in development mode
pip install -e ".[dev,pandas]"

# Run tests
pytest
```

## Format Specification

VTX is a binary format for storing IMU (Inertial Measurement Unit) data efficiently:

- **Header**: 64 bytes - File metadata and configuration
- **Metadata**: Variable length JSON - Device info and recording metadata
- **Data**: Fixed-size records - IMU samples (accel, gyro, optional mag/quat)

### Record Format

Each record contains:
- Timestamp offset (4 bytes, uint32)
- Accelerometer XYZ (12 bytes, 3× float32)
- Gyroscope XYZ (12 bytes, 3× float32)
- Optional: Magnetometer XYZ (12 bytes, 3× float32)
- Optional: Quaternion WXYZ (16 bytes, 4× float32)

All data is stored in little-endian format.

## License

MIT License - see LICENSE file for details

## Related Projects

- **TypeScript Parser**: [@vertex-pkg/vtx-parser](https://www.npmjs.com/package/@vertex-pkg/vtx-parser)
- **VTX Format Specification**: [vtx-format](../vtx-format/)
- **Vertex Platform**: [github.com/your-org/vertex](https://github.com/your-org/vertex)
