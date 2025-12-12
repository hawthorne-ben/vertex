/**
 * VTX Binary Format Type Definitions
 * Based on VTX Format Specification v1.0
 */

/**
 * VTX file header (64 bytes fixed size)
 */
export interface VTXHeader {
  /** File signature "VTX\0" */
  magic: string;
  /** Format major version */
  versionMajor: number;
  /** Format minor version */
  versionMinor: number;
  /** Size of metadata section in bytes */
  metadataLength: number;
  /** Byte offset where data records start */
  dataOffset: number;
  /** Total number of data records */
  recordCount: bigint;
  /** Recording frequency in Hz */
  sampleRate: number;
  /** Unix timestamp (ms) of first sample */
  startTimestamp: bigint;
  /** Unix timestamp (ms) of last sample */
  endTimestamp: bigint;
  /** Bitmask for enabled fields */
  recordFormat: number;
  /** Compression type (0=none, 1=zstd) */
  compression: number;
  /** Total number of GPS records (v1.1+) */
  gpsRecordCount?: bigint;
  /** Byte offset where GPS records start (v1.1+) */
  gpsDataOffset?: number;
}

/**
 * Record format bitmask flags
 */
export enum RecordFormatFlags {
  /** Has acceleration data (always 1 in v1.0) */
  HAS_ACCEL = 1 << 0,
  /** Has gyroscope data (always 1 in v1.0) */
  HAS_GYRO = 1 << 1,
  /** Has magnetometer data */
  HAS_MAG = 1 << 2,
  /** Has quaternion data */
  HAS_QUAT = 1 << 3,
  /** Has Euler angle data (roll, pitch, yaw) */
  HAS_EULER = 1 << 4,
}

/**
 * Device information metadata
 */
export interface VTXDeviceInfo {
  /** Unique device identifier */
  id: string;
  /** Human-readable device name */
  name: string;
  /** Firmware version (semver) */
  firmwareVersion?: string;
  /** Hardware revision identifier */
  hardwareRevision?: string;
}

/**
 * Recording session metadata
 */
export interface VTXSessionInfo {
  /** ISO 8601 timestamp of session creation */
  createdAt: string;
  /** User email or identifier */
  createdBy?: string;
  /** Bike identifier */
  bike?: string;
  /** Sensor mounting position */
  position?: 'Body' | 'Seatpost' | 'Other';
  /** User notes about the session */
  notes?: string;
  /** Session tags for categorization */
  tags?: string[];
}

/**
 * Zero-point calibration values
 */
export interface VTXZeroPoint {
  roll?: number;
  pitch?: number;
  yaw?: number;
  accel_x?: number;
  accel_y?: number;
  accel_z?: number;
  gyro_x?: number;
  gyro_y?: number;
  gyro_z?: number;
  mag_x?: number;
  mag_y?: number;
  mag_z?: number;
}

/**
 * Calibration information metadata
 */
export interface VTXCalibrationInfo {
  /** Zero point calibration values */
  zeroPoint?: VTXZeroPoint;
  /** Whether calibration was applied to data */
  applied: boolean;
}

/**
 * Complete metadata section (variable length JSON)
 */
export interface VTXMetadata {
  /** Device information */
  device?: VTXDeviceInfo;
  /** Recording session information */
  session?: VTXSessionInfo;
  /** Calibration information */
  calibration?: VTXCalibrationInfo;
  /** User-defined custom fields */
  custom?: Record<string, any>;
}

/**
 * Single IMU data record
 */
export interface IMURecord {
  /** Absolute timestamp in milliseconds */
  timestamp: number;
  /** Acceleration X (m/s²) */
  accelX: number;
  /** Acceleration Y (m/s²) */
  accelY: number;
  /** Acceleration Z (m/s²) */
  accelZ: number;
  /** Gyroscope X (rad/s) */
  gyroX: number;
  /** Gyroscope Y (rad/s) */
  gyroY: number;
  /** Gyroscope Z (rad/s) */
  gyroZ: number;
  /** Magnetometer X (µT) - optional */
  magX?: number;
  /** Magnetometer Y (µT) - optional */
  magY?: number;
  /** Magnetometer Z (µT) - optional */
  magZ?: number;
  /** Quaternion W - optional */
  quatW?: number;
  /** Quaternion X - optional */
  quatX?: number;
  /** Quaternion Y - optional */
  quatY?: number;
  /** Quaternion Z - optional */
  quatZ?: number;
  /** Euler angle: Roll (degrees) - optional */
  roll?: number;
  /** Euler angle: Pitch (degrees) - optional */
  pitch?: number;
  /** Euler angle: Yaw (degrees) - optional */
  yaw?: number;
}

/**
 * Single GPS data record (v1.1+)
 * Fixed size: 44 bytes
 */
export interface GPSRecord {
  /** Absolute timestamp in milliseconds */
  timestamp: number;
  /** Latitude in decimal degrees (WGS84) */
  latitude: number;
  /** Longitude in decimal degrees (WGS84) */
  longitude: number;
  /** Altitude in meters (or null if unavailable) */
  altitude: number | null;
  /** Speed in meters per second (or null if unavailable) */
  speed: number | null;
  /** Bearing in degrees 0-360 (or null if unavailable) */
  bearing: number | null;
  /** Horizontal accuracy in meters (or null if unavailable) */
  accuracy: number | null;
}

/**
 * Complete VTX file data structure
 */
export interface VTXFile {
  /** File header */
  header: VTXHeader;
  /** Metadata section */
  metadata: VTXMetadata;
  /** Array of IMU data records */
  records: IMURecord[];
  /** Array of GPS data records (v1.1+) */
  gpsRecords?: GPSRecord[];
}

/**
 * VTX encoder options
 */
export interface VTXEncoderOptions {
  /** Sample rate in Hz */
  sampleRate: number;
  /** Include magnetometer data */
  includeMag?: boolean;
  /** Include quaternion data */
  includeQuat?: boolean;
  /** Include Euler angle data (roll, pitch, yaw) */
  includeEuler?: boolean;
  /** Include GPS data stream (v1.1+) */
  includeGPS?: boolean;
  /** Metadata to include in file */
  metadata?: VTXMetadata;
}

/**
 * VTX decoder options
 */
export interface VTXDecoderOptions {
  /** Only read header without parsing full file */
  headerOnly?: boolean;
  /** Skip metadata parsing */
  skipMetadata?: boolean;
  /** Maximum number of records to read (for preview) */
  maxRecords?: number;
  /** Recovery mode: scan file for actual records, ignore header recordCount */
  recoveryMode?: boolean;
}

/**
 * Constants from VTX specification
 */
export const VTX_CONSTANTS = {
  /** Magic bytes "VTX\0" */
  MAGIC: 'VTX\0',
  /** Current format version major */
  VERSION_MAJOR: 1,
  /** Current format version minor */
  VERSION_MINOR: 1,
  /** Fixed header size in bytes */
  HEADER_SIZE: 64,
  /** Footer size in bytes (optional) */
  FOOTER_SIZE: 32,
  /** Minimal record size (accel + gyro only) */
  RECORD_SIZE_MINIMAL: 28,
  /** Full record size (accel + gyro + mag + quat) */
  RECORD_SIZE_FULL: 56,
  /** GPS record size (v1.1+) */
  GPS_RECORD_SIZE: 44,
  /** Default compression (none) */
  COMPRESSION_NONE: 0,
  /** Zstd compression */
  COMPRESSION_ZSTD: 1,
} as const;
