/*
 * Sensor Manager - Handles BNO055 IMU sensor operations
 * Manages sensor initialization, data reading, and calibration
 */

#ifndef SENSOR_MANAGER_H
#define SENSOR_MANAGER_H

#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_Sensor.h>
#include <Adafruit_BNO055.h>
#include <utility/imumaths.h>
#include "config.h"

// Sensor data structure
struct SensorData {
  unsigned long timestamp;
  float roll, pitch, yaw;
  float accel_x, accel_y, accel_z;
  float gyro_x, gyro_y, gyro_z;
  float mag_x, mag_y, mag_z;
  uint8_t cal_sys, cal_gyro, cal_accel, cal_mag;
  float battery_voltage;
};

class SensorManager {
public:
  SensorManager();

  // Initialize sensor and I2C
  bool init();

  // Update sensor data (returns true if new data available)
  bool update();

  // Get current sensor data
  const SensorData& getData() const;

  // Get mutable sensor data (for battery voltage updates)
  SensorData& getMutableData();

  // Check if sensor is calibrated
  bool isCalibrated() const;

  // Set sample interval
  void setSampleIntervalMs(unsigned long intervalMs);

  // Get sample interval
  unsigned long getSampleIntervalMs() const;

  // Performance metrics
  unsigned long getLastReadTime() const;

  // Get reference to BNO055 (for calibration commands)
  Adafruit_BNO055& getBNO055();

private:
  Adafruit_BNO055 bno;
  SensorData sensorData;
  unsigned long lastSampleTime;
  unsigned long sampleIntervalMs;
  unsigned long lastReadTime;

  // Helper function to normalize angles to [-180, 180] range
  static float normalizeAngle(float angle);
};

#endif // SENSOR_MANAGER_H
