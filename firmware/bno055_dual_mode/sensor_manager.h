#ifndef SENSOR_MANAGER_H
#define SENSOR_MANAGER_H

#include <Arduino.h>

// Function prototypes
bool initSensor();
void readSensorData();
void getCalibrationStatus(uint8_t* sys, uint8_t* gyro, uint8_t* accel, uint8_t* mag);

// Sensor data structure
struct SensorData {
  // Orientation (quaternion)
  float qw, qx, qy, qz;
  
  // Euler angles
  float roll, pitch, yaw;
  
  // Linear acceleration (gravity removed)
  float accel_x, accel_y, accel_z;
  
  // Gyroscope
  float gyro_x, gyro_y, gyro_z;
  
  // Magnetometer
  float mag_x, mag_y, mag_z;
  
  // Timestamp (milliseconds since NTP sync or power-on)
  unsigned long timestamp;
};

extern SensorData sensorData;

#endif // SENSOR_MANAGER_H
