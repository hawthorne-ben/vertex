/**
 * Data Parser for IMU Sensor Data
 * 
 * Parses the byte array received from ESP32 into structured sensor readings
 */

import { SensorReading } from '../types';

/**
 * Parse batched sensor data from ESP32
 * Expected format: [timestamp(4), grade(2), roll(2), Gx(2), Gy(2), Gz(2), ...]
 * All values are little-endian integers
 */
export function parseSensorBatch(data: Uint8Array, startTimestamp: number): SensorReading[] {
  const readings: SensorReading[] = [];
  
  // Each sensor reading is 14 bytes (4 + 2 + 2 + 2 + 2 + 2)
  const READING_SIZE = 14;
  
  for (let i = 0; i < data.length; i += READING_SIZE) {
    if (i + READING_SIZE > data.length) {
      console.warn('Incomplete reading at end of batch');
      break;
    }
    
    const reading = parseSensorReading(data, i, startTimestamp);
    readings.push(reading);
  }
  
  return readings;
}

/**
 * Parse a single sensor reading from a byte array
 */
function parseSensorReading(data: Uint8Array, offset: number, startTimestamp: number): SensorReading {
  // Read timestamp (4 bytes, little-endian)
  const timestamp_ms = data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24);
  
  // Read grade (2 bytes, signed little-endian)
  const grade_raw = data[offset + 4] | (data[offset + 5] << 8);
  const grade_percent = grade_raw / 100.0; // Convert from percent * 100 to percent
  
  // Read roll (2 bytes, signed little-endian)
  const roll_raw = data[offset + 6] | (data[offset + 7] << 8);
  const roll_deg = roll_raw / 100.0; // Convert from degrees * 100 to degrees
  
  // Read Gx, Gy, Gz (2 bytes each, signed little-endian, in milli-G units)
  const gx_raw = data[offset + 8] | (data[offset + 9] << 8);
  const accel_x_g = signedInt16(gx_raw) / 1000.0;
  
  const gy_raw = data[offset + 10] | (data[offset + 11] << 8);
  const accel_y_g = signedInt16(gy_raw) / 1000.0;
  
  const gz_raw = data[offset + 12] | (data[offset + 13] << 8);
  const accel_z_g = signedInt16(gz_raw) / 1000.0;
  
  return {
    timestamp_ms: startTimestamp + timestamp_ms,
    grade_percent,
    roll_deg,
    accel_x_g,
    accel_y_g,
    accel_z_g,
  };
}

/**
 * Convert unsigned 16-bit integer to signed
 */
function signedInt16(value: number): number {
  return value > 32767 ? value - 65536 : value;
}

