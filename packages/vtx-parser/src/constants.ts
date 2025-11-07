/**
 * VTX Binary Format Constants
 *
 * Shared constants used across all VTX format implementations.
 * These values are embedded in binary files and define the format structure.
 */

/**
 * VTX Format Version
 * - Major version indicates breaking changes
 * - Minor version indicates backward-compatible additions
 */
export const VTX_FORMAT_VERSION = {
  MAJOR: 1,
  MINOR: 0,
} as const;

/**
 * File Header Constants
 */
export const VTX_HEADER = {
  /** Magic bytes for file identification: "VTX\0" */
  MAGIC: 'VTX\0',
  /** Fixed size of file header in bytes */
  SIZE: 64,
  /** Byte offset where magic bytes appear */
  MAGIC_OFFSET: 0,
  /** Byte offset where version appears */
  VERSION_OFFSET: 4,
} as const;

/**
 * Record Format Bitmask
 * Used in header to indicate which sensor data is present
 */
export const VTX_RECORD_FORMAT = {
  /** Bit 0: Acceleration data present (always 1 in v1.0) */
  HAS_ACCEL: 1 << 0,
  /** Bit 1: Gyroscope data present (always 1 in v1.0) */
  HAS_GYRO: 1 << 1,
  /** Bit 2: Magnetometer data present (optional) */
  HAS_MAG: 1 << 2,
  /** Bit 3: Quaternion data present (optional) */
  HAS_QUAT: 1 << 3,
  /** Bit 4: Euler angle data present (optional) */
  HAS_EULER: 1 << 4,
} as const;

/**
 * Data Record Sizes
 */
export const VTX_RECORD_SIZE = {
  /** Timestamp field size */
  TIMESTAMP: 4,
  /** Single float32 field size */
  FLOAT32: 4,
  /** Minimum record size (timestamp + accel + gyro) */
  MINIMAL: 28,
  /** Full record size (timestamp + accel + gyro + mag + quat) */
  FULL: 56,
} as const;

/**
 * Compression Types
 */
export const VTX_COMPRESSION = {
  /** No compression */
  NONE: 0,
  /** Zstandard compression (future) */
  ZSTD: 1,
} as const;

/**
 * Footer Constants
 */
export const VTX_FOOTER = {
  /** Optional footer size */
  SIZE: 32,
  /** CRC32 size */
  CRC32_SIZE: 4,
  /** SHA1 hash size */
  SHA1_SIZE: 20,
} as const;

/**
 * Helper Functions
 */

/**
 * Calculate record size based on format bitmask
 */
export function getRecordSize(recordFormat: number): number {
  let size = VTX_RECORD_SIZE.TIMESTAMP;

  // Accel (always present in v1.0)
  if (recordFormat & VTX_RECORD_FORMAT.HAS_ACCEL) {
    size += VTX_RECORD_SIZE.FLOAT32 * 3; // x, y, z
  }

  // Gyro (always present in v1.0)
  if (recordFormat & VTX_RECORD_FORMAT.HAS_GYRO) {
    size += VTX_RECORD_SIZE.FLOAT32 * 3; // x, y, z
  }

  // Mag (optional)
  if (recordFormat & VTX_RECORD_FORMAT.HAS_MAG) {
    size += VTX_RECORD_SIZE.FLOAT32 * 3; // x, y, z
  }

  // Quat (optional)
  if (recordFormat & VTX_RECORD_FORMAT.HAS_QUAT) {
    size += VTX_RECORD_SIZE.FLOAT32 * 4; // w, x, y, z
  }

  // Euler (optional)
  if (recordFormat & VTX_RECORD_FORMAT.HAS_EULER) {
    size += VTX_RECORD_SIZE.FLOAT32 * 3; // roll, pitch, yaw
  }

  return size;
}

/**
 * Get format version as string
 */
export function getVersionString(): string {
  return `${VTX_FORMAT_VERSION.MAJOR}.${VTX_FORMAT_VERSION.MINOR}`;
}

/**
 * Check if format bitmask has specific sensor
 */
export function hasSensor(recordFormat: number, sensor: number): boolean {
  return (recordFormat & sensor) !== 0;
}
