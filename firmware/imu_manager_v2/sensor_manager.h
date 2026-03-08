/*
 * Sensor Manager V2 - LSM6DS3 IMU interface
 * Handles initialization, ODR/FIFO configuration, and batch reads.
 *
 * Outputs physical units (m/s², rad/s) as float32 to match the VTX binary
 * format expected by packages/vtx-parser.
 */

#ifndef SENSOR_MANAGER_H
#define SENSOR_MANAGER_H

#include <Arduino.h>
#include <Wire.h>
#include "config.h"

// VTX IMU record — matches vtx-parser MINIMAL format (28 bytes)
// timestamp (uint32) + accel xyz (float32x3) + gyro xyz (float32x3)
struct __attribute__((packed)) IMURecord {
  uint32_t timestamp_ms;  // ms offset from recording startTimestamp
  float accel_x;          // m/s²
  float accel_y;          // m/s²
  float accel_z;          // m/s²
  float gyro_x;           // rad/s
  float gyro_y;           // rad/s
  float gyro_z;           // rad/s
};
static_assert(sizeof(IMURecord) == VTX_IMU_RECORD_SIZE, "IMURecord must be 28 bytes");

class SensorManager {
public:
  SensorManager();

  // Initialize LSM6DS3: I2C, ODR, range, FIFO mode
  bool init();

  // Read all available samples from FIFO, convert to physical units.
  // Returns count written to buffer.
  int readFIFO();

  // Access sample buffer (valid after readFIFO)
  const IMURecord* getSampleBuffer() const;

  // Set recording start timestamp (call when recording begins)
  void resetTimestamp();

  // Latest accel sample (for status reports)
  void getLatestAccel(float &ax, float &ay, float &az) const;

  // Whether the sensor initialized successfully
  bool isHealthy() const { return _initialized; }

private:
  // FIFO read buffer (enough for ~1 second at 104Hz)
  static const int MAX_FIFO_SAMPLES = 128;
  IMURecord _buffer[MAX_FIFO_SAMPLES];

  unsigned long _recordingStartMs;
  bool _initialized = false;

  // LSM6DS3 register helpers
  bool writeRegister(uint8_t reg, uint8_t value);
  uint8_t readRegister(uint8_t reg);
  bool readRegisters(uint8_t reg, uint8_t* buffer, uint8_t length);
};

#endif // SENSOR_MANAGER_H
