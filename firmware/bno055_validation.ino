/*
 * BNO055 Sensor Validation Sketch
 * 
 * This sketch validates the BNO055 IMU sensor connection and displays
 * sensor data to the Serial Monitor for verification.
 * 
 * Expected Output:
 * - Sensor found confirmation
 * - Calibration status for all sensors
 * - Continuous stream of quaternion, Euler angles, acceleration, gyro, and magnetometer data
 */

#include <Wire.h>
#include <Adafruit_Sensor.h>
#include <Adafruit_BNO055.h>
#include <utility/imumaths.h>

// Create BNO055 instance with I2C address 0x28
Adafruit_BNO055 bno = Adafruit_BNO055(55);

// Delay between readings in milliseconds (50Hz = 20ms)
const unsigned long SAMPLE_DELAY_MS = 20;

void setup(void) {
  Serial.begin(115200);
  delay(1000);  // Give serial time to initialize
  
  // Clear any garbage
  Serial.println("\n\n\n");
  Serial.println("========================================");
  Serial.println("=== BNO055 Validation Test ===");
  Serial.println("========================================");
  Serial.println("");

  // Initialize I2C bus
  Serial.println("[SETUP] Initializing I2C bus...");
  Wire.begin();
  Serial.println("[SETUP] I2C bus initialized.");
  delay(100);

  // Initialize BNO055 sensor
  Serial.println("[SETUP] Initializing BNO055 sensor...");
  if (!bno.begin()) {
    Serial.println("[ERROR] BNO055 sensor not detected!");
    Serial.println("[ERROR] Please check your connections:");
    Serial.println("[ERROR]   - Black wire -> GND");
    Serial.println("[ERROR]   - Red wire   -> 3V");
    Serial.println("[ERROR]   - Blue wire  -> SCL");
    Serial.println("[ERROR]   - Yellow wire -> SDA");
    Serial.println("[ERROR] Make sure the sensor is powered and I2C bus is working.");
    while (1) delay(10);
  }

  Serial.println("✓ BNO055 sensor found!\n");

  // Use internal crystal oscillator for better accuracy
  bno.setExtCrystalUse(true);

  // Give sensor time to stabilize
  delay(1000);

  Serial.println("Sensor configured and ready.\n");
  Serial.println("Starting data collection...\n");
  Serial.println("----------------------------------------");
}

void loop(void) {
  static unsigned long sampleCount = 0;
  static unsigned long lastSampleTime = 0;
  
  sampleCount++;
  unsigned long currentTime = millis();
  
  // Warn if we're running too slow
  if (lastSampleTime > 0 && (currentTime - lastSampleTime > 100)) {
    Serial.print("[WARN] Loop took too long: ");
    Serial.print(currentTime - lastSampleTime);
    Serial.println(" ms");
  }
  lastSampleTime = currentTime;

  // Check calibration status
  uint8_t system, gyro, accel, mag;
  system = gyro = accel = mag = 0;
  bno.getCalibration(&system, &gyro, &accel, &mag);

  // Read quaternion (most accurate orientation representation)
  imu::Quaternion quat = bno.getQuat();
  
  // Convert quaternion to Euler angles (roll, pitch, yaw)
  imu::Vector<3> euler = quat.toEuler();

  // Read linear acceleration (gravity removed)
  imu::Vector<3> accel_linear = bno.getVector(Adafruit_BNO055::VECTOR_LINEARACCEL);
  
  // Read gyroscope data (rotation rates)
  imu::Vector<3> gyro_rate = bno.getVector(Adafruit_BNO055::VECTOR_GYROSCOPE);
  
  // Read magnetometer data
  imu::Vector<3> mag_field = bno.getVector(Adafruit_BNO055::VECTOR_MAGNETOMETER);

  // Print sample number and timestamp
  Serial.print("\n[Sample #");
  Serial.print(sampleCount);
  Serial.print("] Time: ");
  Serial.print(currentTime);
  Serial.println(" ms");

  // Print calibration status
  Serial.print("Calibration - Sys:");
  Serial.print(system, DEC);
  Serial.print(" Gyro:");
  Serial.print(gyro, DEC);
  Serial.print(" Accel:");
  Serial.print(accel, DEC);
  Serial.print(" Mag:");
  Serial.println(mag, DEC);

  // Print quaternion
  Serial.print("Quaternion - W:");
  Serial.print(quat.w(), 4);
  Serial.print(" X:");
  Serial.print(quat.x(), 4);
  Serial.print(" Y:");
  Serial.print(quat.y(), 4);
  Serial.print(" Z:");
  Serial.println(quat.z(), 4);

  // Print Euler angles (roll, pitch, yaw) in degrees
  Serial.print("Euler (deg) - Roll:");
  Serial.print(euler.x() * 57.2958, 2);  // Convert radians to degrees
  Serial.print(" Pitch:");
  Serial.print(euler.y() * 57.2958, 2);
  Serial.print(" Yaw:");
  Serial.println(euler.z() * 57.2958, 2);

  // Print linear acceleration (m/s^2)
  Serial.print("Linear Accel (m/s²) - X:");
  Serial.print(accel_linear.x(), 2);
  Serial.print(" Y:");
  Serial.print(accel_linear.y(), 2);
  Serial.print(" Z:");
  Serial.println(accel_linear.z(), 2);

  // Print gyroscope (rad/s)
  Serial.print("Gyro (rad/s) - X:");
  Serial.print(gyro_rate.x(), 3);
  Serial.print(" Y:");
  Serial.print(gyro_rate.y(), 3);
  Serial.print(" Z:");
  Serial.println(gyro_rate.z(), 3);

  // Print magnetometer (microteslas)
  Serial.print("Magnetometer (µT) - X:");
  Serial.print(mag_field.x(), 2);
  Serial.print(" Y:");
  Serial.print(mag_field.y(), 2);
  Serial.print(" Z:");
  Serial.println(mag_field.z(), 2);

  Serial.println("----------------------------------------");

  // Delay to achieve ~50Hz sampling rate
  delay(SAMPLE_DELAY_MS);
  
  // Crash detection: if we get here, we didn't crash
  if (sampleCount % 100 == 0) {
    Serial.println("[OK] 100 samples completed, still running...");
  }
}

// Instructions displayed after upload:
// 1. Open Serial Monitor at 115200 baud
// 2. Move the sensor to verify data changes
// 3. Check calibration values - they should increase as you move the sensor
// 4. If all values are zero, check wiring connections
// 5. If sensor not detected, check power (red wire to 3V)
