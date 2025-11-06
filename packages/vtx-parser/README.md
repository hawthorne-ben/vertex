# @vertex/vtx-parser

TypeScript and Python encoder/decoder for the VTX binary format. Provides efficient parsing and generation of `.vtx` files for IMU sensor data.

## Installation

### TypeScript / JavaScript
```bash
npm install @vertex/vtx-parser
```

### Python
```bash
pip install vtx-parser
```

Or from the npm package:
```bash
cd python && pip install -e .
```

## Usage

### TypeScript

#### Encoding (Creating VTX Files)

```typescript
import { VTXEncoder, IMURecord } from '@vertex/vtx-parser';

// Create encoder with options
const encoder = new VTXEncoder({
  sampleRate: 100, // 100 Hz
  includeMag: true, // Include magnetometer data
  includeQuat: true, // Include quaternion data
  metadata: {
    device: {
      id: 'ABC123',
      name: 'Vertex IMU #1',
      firmwareVersion: '1.0.0',
    },
    session: {
      createdAt: new Date().toISOString(),
      bike: 'Bike 1',
      position: 'Seatpost',
    },
  },
});

// Add IMU records
const record: IMURecord = {
  timestamp: Date.now(),
  accelX: 0.12,
  accelY: -0.45,
  accelZ: 9.81,
  gyroX: 0.01,
  gyroY: 0.02,
  gyroZ: -0.01,
  magX: 45.2,
  magY: 12.3,
  magZ: -8.9,
  quatW: 0.707,
  quatX: 0.0,
  quatY: 0.0,
  quatZ: 0.707,
};

encoder.addRecord(record);

// Or add multiple records at once
encoder.addRecords([record1, record2, record3]);

// Encode to binary buffer
const buffer: ArrayBuffer = encoder.encode();

// Save to file (Node.js)
import fs from 'fs';
fs.writeFileSync('recording.vtx', Buffer.from(buffer));

// Save to file (React Native)
import RNFS from 'react-native-fs';
const base64 = Buffer.from(buffer).toString('base64');
await RNFS.writeFile(filePath, base64, 'base64');
```

#### Decoding (Reading VTX Files)

```typescript
import { VTXDecoder, decodeVTX } from '@vertex/vtx-parser';

// Read file into ArrayBuffer
const buffer = await readFileAsArrayBuffer('recording.vtx');

// Option 1: Decode entire file
const vtxFile = decodeVTX(buffer);
console.log('Header:', vtxFile.header);
console.log('Metadata:', vtxFile.metadata);
console.log('Records:', vtxFile.records);

// Option 2: Use decoder class for more control
const decoder = new VTXDecoder(buffer);

// Read just the header
const header = decoder.readHeader();
console.log(`File contains ${header.recordCount} records at ${header.sampleRate} Hz`);

// Read metadata
const metadata = decoder.readMetadata();
console.log('Device:', metadata.device?.name);

// Read specific records (efficient random access)
const records = decoder.readRecords(0, 100); // Read first 100 records

// Read a single record
const record = decoder.readRecord(500); // Read record at index 500

// Get file info
const duration = decoder.getDuration(); // milliseconds
const sampleRate = decoder.getSampleRate(); // Hz
const recordCount = decoder.getRecordCount();
```

#### Partial Decoding (For Large Files)

```typescript
import { decodeVTX } from '@vertex/vtx-parser';

// Read only header (fast preview)
const { header } = decodeVTX(buffer, { headerOnly: true });
console.log(`Duration: ${Number(header.endTimestamp - header.startTimestamp)} ms`);

// Read header + metadata, skip records
const { header, metadata } = decodeVTX(buffer, { skipMetadata: false, maxRecords: 0 });

// Read first N records only
const { records } = decodeVTX(buffer, { maxRecords: 1000 });
```

### Python

#### Decoding VTX Files

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
duration_sec = (vtx_file.header.end_timestamp - vtx_file.header.start_timestamp) / 1000.0
print(f"Duration: {duration_sec:.2f} seconds")

# Access IMU data
for record in vtx_file.records:
    print(f"Time: {record.timestamp}, Accel: ({record.accel_x}, {record.accel_y}, {record.accel_z})")
```

#### Efficient Reading for Large Files

```python
from vtx_parser import VTXDecoder

with open('recording.vtx', 'rb') as f:
    data = f.read()

decoder = VTXDecoder(data)

# Read header first (fast)
header = decoder.read_header()
print(f"File has {header.record_count} records")

# Read records in chunks
chunk_size = 1000
for i in range(0, header.record_count, chunk_size):
    records = decoder.read_records(i, chunk_size)
    # Process records...
```

#### Integration with Pandas

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
print(f"Sample rate: {sample_rate:.2f} Hz")
```

For complete Python documentation, see [`python/README.md`](./python/README.md).

## API Reference

### TypeScript API

### VTXEncoder

#### Constructor

```typescript
new VTXEncoder(options: VTXEncoderOptions)
```

Options:
- `sampleRate: number` - Recording frequency in Hz
- `includeMag?: boolean` - Include magnetometer data (default: false)
- `includeQuat?: boolean` - Include quaternion data (default: false)
- `metadata?: VTXMetadata` - File metadata (device info, session info, etc.)

#### Methods

- `addRecord(record: IMURecord): void` - Add a single record
- `addRecords(records: IMURecord[]): void` - Add multiple records
- `encode(): ArrayBuffer` - Encode all data to binary buffer
- `getRecordCount(): number` - Get current record count
- `clear(): void` - Clear all buffered records

### VTXDecoder

#### Constructor

```typescript
new VTXDecoder(buffer: ArrayBuffer)
```

#### Methods

- `decode(options?: VTXDecoderOptions): VTXFile` - Decode entire file
- `readHeader(): VTXHeader` - Read file header only
- `readMetadata(): VTXMetadata` - Read metadata section
- `readRecords(startIndex: number, count: number): IMURecord[]` - Read range of records
- `readRecord(index: number): IMURecord` - Read single record
- `getHeader(): VTXHeader` - Get cached header
- `getMetadata(): VTXMetadata` - Get cached metadata
- `getRecordCount(): number` - Get total record count
- `getDuration(): number` - Get file duration in milliseconds
- `getSampleRate(): number` - Get sample rate in Hz

### Utility Functions

```typescript
// Decode entire file
decodeVTX(buffer: ArrayBuffer, options?: VTXDecoderOptions): VTXFile

// Read just header
readVTXHeader(buffer: ArrayBuffer): VTXHeader

// Read header and metadata
readVTXMetadata(buffer: ArrayBuffer): { header: VTXHeader; metadata: VTXMetadata }
```

## Type Definitions

### IMURecord

```typescript
interface IMURecord {
  timestamp: number;     // Absolute timestamp (ms)
  accelX: number;        // Acceleration X (m/s²)
  accelY: number;        // Acceleration Y (m/s²)
  accelZ: number;        // Acceleration Z (m/s²)
  gyroX: number;         // Gyroscope X (rad/s)
  gyroY: number;         // Gyroscope Y (rad/s)
  gyroZ: number;         // Gyroscope Z (rad/s)
  magX?: number;         // Magnetometer X (µT) - optional
  magY?: number;         // Magnetometer Y (µT) - optional
  magZ?: number;         // Magnetometer Z (µT) - optional
  quatW?: number;        // Quaternion W - optional
  quatX?: number;        // Quaternion X - optional
  quatY?: number;        // Quaternion Y - optional
  quatZ?: number;        // Quaternion Z - optional
}
```

### VTXMetadata

```typescript
interface VTXMetadata {
  device?: {
    id: string;
    name: string;
    firmwareVersion?: string;
    hardwareRevision?: string;
  };
  session?: {
    createdAt: string;
    createdBy?: string;
    bike?: string;
    position?: 'Body' | 'Seatpost' | 'Other';
    notes?: string;
    tags?: string[];
  };
  calibration?: {
    zeroPoint?: { /* ... */ };
    applied: boolean;
  };
  custom?: Record<string, any>;
}
```

## File Format

See [@vertex/vtx-format](../vtx-format) for the complete binary format specification.

## Performance

VTX format provides significant advantages over CSV:

| Format | File Size | Parse Time | Random Access |
|--------|-----------|------------|---------------|
| CSV    | ~780 KB   | ~50 ms     | No (scan entire file) |
| VTX    | ~336 KB   | ~5 ms      | Yes (O(1) by index) |

**10-minute recording at 100Hz (6,000 samples)**

## License

MIT

## Related Packages

- [@vertex/vtx-format](../vtx-format) - Format specification
- [@vertex/vtx-constants](../vtx-constants) - Shared constants
