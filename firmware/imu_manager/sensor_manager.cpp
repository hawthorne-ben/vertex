/*
 * Sensor Manager Implementation
 * Handles BNO055 IMU sensor operations
 */

#include "sensor_manager.h"
#include "esp_log.h"

SensorManager::SensorManager()
  : bno(Adafruit_BNO055(55)),
    lastSampleTime(0),
    sampleIntervalMs(DEFAULT_SAMPLE_INTERVAL_MS),
    lastReadTime(0),
    brakeDetectedTime(0),
    brakeStartTime(0),
    brakingState(false) {

  // Initialize sensor data to zero
  memset(&sensorData, 0, sizeof(SensorData));
}

bool SensorManager::init() {
  Serial.print("[SETUP] Initializing sensor...");

  // Disable I2C logging noise
  esp_log_level_set("i2c", ESP_LOG_NONE);
  esp_log_level_set("i2c.master", ESP_LOG_NONE);
  esp_log_level_set("i2c.slave", ESP_LOG_NONE);
  esp_log_level_set("i2c_main", ESP_LOG_NONE);
  esp_log_level_set("*", ESP_LOG_WARN);

  // Initialize I2C
  Wire.begin();
  Wire.setClock(I2C_CLOCK_SPEED_NORMAL);
  Wire.setTimeout(I2C_TIMEOUT_MS);

  // Initialize BNO055
  if (!bno.begin()) {
    Serial.println(" ERROR!");
    Serial.println("[ERROR] BNO055 not found. Check connections.");
    return false;
  }

  bno.setExtCrystalUse(true);

  // Configure BNO055 operation mode
  // IMU mode: 6-axis sensor fusion (accel + gyro only, NO magnetometer)
  // Magnetometer removed due to interference from bike frame, passing vehicles, infrastructure
  // Yaw drift will be corrected using GPS velocity heading in post-processing
  // This mode still provides filtered linear acceleration and orientation (with yaw drift)
  bno.setMode(OPERATION_MODE_IMUPLUS);
  delay(20);  // Allow mode switch to complete

  Serial.println(" OK");
  Serial.println("[INFO] BNO055 configured: IMU mode (6DoF - accel+gyro, no mag)");
  delay(500);

  return true;
}

bool SensorManager::update() {
  unsigned long now = millis();

  // Check if it's time for a new sample
  if (now - lastSampleTime < sampleIntervalMs) {
    return false;
  }

  unsigned long start = micros();

  // Read quaternion data (reliable at all angles, avoids gimbal lock)
  imu::Quaternion quat = bno.getQuat();

  // Convert quaternion to euler angles
  imu::Vector<3> euler = quat.toEuler();

  // Read sensor data
  // VECTOR_ACCELEROMETER: Raw accelerometer data including gravity (for recording/fusion)
  // VECTOR_LINEARACCEL: Gravity-compensated (for on-device brake detection)
  imu::Vector<3> accel = bno.getVector(Adafruit_BNO055::VECTOR_ACCELEROMETER);
  imu::Vector<3> accel_linear = bno.getVector(Adafruit_BNO055::VECTOR_LINEARACCEL);
  imu::Vector<3> gyro = bno.getVector(Adafruit_BNO055::VECTOR_GYROSCOPE);
  // Magnetometer removed - using 6DoF IMU mode (no mag interference)

  // Read calibration (no mag calibration in IMU mode)
  uint8_t sys, gyro_cal, accel_cal, mag_cal;
  bno.getCalibration(&sys, &gyro_cal, &accel_cal, &mag_cal);

  lastReadTime = micros() - start;

  // Update sensor data structure
  sensorData.timestamp = now;

  // Euler angles from quaternion (convert radians to degrees and normalize)
  // toEuler() returns radians: x=heading/yaw, y=pitch, z=roll (corrected)
  // Note: Using quaternion->euler conversion instead of BNO055 native euler angles
  // because BNO055 has a known bug with native euler at >20° (problematic for cycling)
  // Safety: normalizeAngle() will return 0 if input is NaN/infinite
  sensorData.yaw = normalizeAngle(euler.x() * RAD_TO_DEG);
  sensorData.roll = normalizeAngle(euler.z() * RAD_TO_DEG);   // z = roll
  sensorData.pitch = normalizeAngle(euler.y() * RAD_TO_DEG);  // y = pitch

  // Raw acceleration (m/s²) - includes gravity component for fusion
  sensorData.accel_x = accel.x();
  sensorData.accel_y = accel.y();
  sensorData.accel_z = accel.z();

  // Angular velocity (rad/s)
  sensorData.gyro_x = gyro.x();
  sensorData.gyro_y = gyro.y();
  sensorData.gyro_z = gyro.z();

  // Magnetometer removed - using 6DoF mode for cleaner data

  // Calibration status (no mag calibration in IMU mode)
  sensorData.cal_sys = sys;
  sensorData.cal_gyro = gyro_cal;
  sensorData.cal_accel = accel_cal;

  // Brake detection: check if X-axis acceleration exceeds threshold
  // Use linear accel (gravity-compensated) for brake detection
  // This works consistently at any pitch angle
  float accel_magnitude_x = fabs(accel_linear.x());

  if (accel_magnitude_x > BRAKE_ACCEL_THRESHOLD) {
    // High acceleration detected
    if (brakeStartTime == 0) {
      brakeStartTime = now;  // Start timing
    } else if (now - brakeStartTime >= BRAKE_DEBOUNCE_MS) {
      // Sustained for debounce period - trigger brake light
      if (!brakingState) {
        brakingState = true;
        brakeDetectedTime = now;
        Serial.printf("[BRAKE] Detected! Accel: %.2f g\n", accel_magnitude_x / 9.81);
      }
    }
  } else {
    // Below threshold - reset debounce timer
    brakeStartTime = 0;
  }

  // Check if brake display duration expired
  if (brakingState && (now - brakeDetectedTime >= BRAKE_DISPLAY_DURATION_MS)) {
    brakingState = false;
    Serial.println("[BRAKE] Display ended");
  }

  lastSampleTime = now;
  return true;
}

float SensorManager::normalizeAngle(float angle) {
  // Safety check for NaN or infinity
  if (!isfinite(angle)) {
    return 0.0f;
  }

  // Normalize angle to [-180, 180] range using efficient modulo
  angle = fmodf(angle + 180.0f, 360.0f);
  if (angle < 0.0f) {
    angle += 360.0f;
  }
  return angle - 180.0f;
}

const SensorData& SensorManager::getData() const {
  return sensorData;
}

SensorData& SensorManager::getMutableData() {
  return sensorData;
}

bool SensorManager::isCalibrated() const {
  return sensorData.cal_sys == 3;
}

void SensorManager::setSampleIntervalMs(unsigned long intervalMs) {
  if (intervalMs >= MIN_SAMPLE_INTERVAL_MS && intervalMs <= MAX_SAMPLE_INTERVAL_MS) {
    sampleIntervalMs = intervalMs;
  }
}

unsigned long SensorManager::getSampleIntervalMs() const {
  return sampleIntervalMs;
}

unsigned long SensorManager::getLastReadTime() const {
  return lastReadTime;
}

Adafruit_BNO055& SensorManager::getBNO055() {
  return bno;
}

bool SensorManager::isBraking() const {
  return brakingState;
}
