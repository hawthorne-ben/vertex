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
    lastReadTime(0) {

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
  // NDOF mode: 9-axis sensor fusion (accel + gyro + mag)
  // This mode enables the sensor fusion that produces filtered linear acceleration
  bno.setMode(OPERATION_MODE_NDOF);
  delay(20);  // Allow mode switch to complete

  Serial.println(" OK");
  Serial.println("[INFO] BNO055 configured: NDOF mode with sensor fusion enabled");
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

  // Read other sensor data
  // Use VECTOR_LINEARACCEL: gravity-compensated acceleration from sensor fusion
  // This provides filtered, clean acceleration data without gravity component
  imu::Vector<3> accel = bno.getVector(Adafruit_BNO055::VECTOR_LINEARACCEL);
  imu::Vector<3> gyro = bno.getVector(Adafruit_BNO055::VECTOR_GYROSCOPE);
  imu::Vector<3> mag = bno.getVector(Adafruit_BNO055::VECTOR_MAGNETOMETER);

  // Read calibration
  uint8_t sys, gyro_cal, accel_cal, mag_cal;
  bno.getCalibration(&sys, &gyro_cal, &accel_cal, &mag_cal);

  lastReadTime = micros() - start;

  // Update sensor data structure
  sensorData.timestamp = now;

  // Euler angles from quaternion (convert radians to degrees)
  // toEuler() returns radians: x=heading/yaw, y=roll, z=pitch
  sensorData.yaw = euler.x() * RAD_TO_DEG;
  sensorData.roll = euler.y() * RAD_TO_DEG;
  sensorData.pitch = euler.z() * RAD_TO_DEG;

  // Linear acceleration (m/s²)
  sensorData.accel_x = accel.x();
  sensorData.accel_y = accel.y();
  sensorData.accel_z = accel.z();

  // Angular velocity (rad/s)
  sensorData.gyro_x = gyro.x();
  sensorData.gyro_y = gyro.y();
  sensorData.gyro_z = gyro.z();

  // Magnetic field (uT)
  sensorData.mag_x = mag.x();
  sensorData.mag_y = mag.y();
  sensorData.mag_z = mag.z();

  // Calibration status
  sensorData.cal_sys = sys;
  sensorData.cal_gyro = gyro_cal;
  sensorData.cal_accel = accel_cal;
  sensorData.cal_mag = mag_cal;

  lastSampleTime = now;
  return true;
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
