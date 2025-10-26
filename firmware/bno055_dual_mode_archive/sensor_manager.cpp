#include "sensor_manager.h"
#include "config.h"
#include <Wire.h>
#include <Adafruit_BNO055.h>
#include <Adafruit_Sensor.h>
#include <utility/imumaths.h>

// Global sensor object
Adafruit_BNO055 bno = Adafruit_BNO055(55);

// Global sensor data
SensorData sensorData;

bool initSensor() {
  // EXACT COPY from working firmware - no changes
  Wire.begin();
  Wire.setClock(400000);
  Wire.setTimeout(1000);
  
  if (!bno.begin()) {
    Serial.println(" ERROR!");
    Serial.println("[ERROR] BNO055 not found. Check connections.");
    return false;
  }
  
  bno.setExtCrystalUse(true);
  Serial.println(" OK");
  
  delay(500);
  
  return true;
}

void readSensorData() {
  // Get quaternion
  imu::Quaternion quat = bno.getQuat();
  sensorData.qw = quat.w();
  sensorData.qx = quat.x();
  sensorData.qy = quat.y();
  sensorData.qz = quat.z();
  
  // Get Euler angles
  imu::Vector<3> euler = bno.getVector(Adafruit_BNO055::VECTOR_EULER);
  sensorData.roll = euler.x();
  sensorData.pitch = euler.y();
  sensorData.yaw = euler.z();
  
  // Get linear acceleration (gravity removed)
  imu::Vector<3> accel = bno.getVector(Adafruit_BNO055::VECTOR_LINEARACCEL);
  sensorData.accel_x = accel.x();
  sensorData.accel_y = accel.y();
  sensorData.accel_z = accel.z();
  
  // Get gyroscope
  imu::Vector<3> gyro = bno.getVector(Adafruit_BNO055::VECTOR_GYROSCOPE);
  sensorData.gyro_x = gyro.x();
  sensorData.gyro_y = gyro.y();
  sensorData.gyro_z = gyro.z();
  
  // Get magnetometer
  imu::Vector<3> mag = bno.getVector(Adafruit_BNO055::VECTOR_MAGNETOMETER);
  sensorData.mag_x = mag.x();
  sensorData.mag_y = mag.y();
  sensorData.mag_z = mag.z();
  
  // Update timestamp
  sensorData.timestamp = millis();
}

void getCalibrationStatus(uint8_t* sys, uint8_t* gyro, uint8_t* accel, uint8_t* mag) {
  bno.getCalibration(sys, gyro, accel, mag);
}
