#include "sd_logger.h"
#include "config.h"
#include "sensor_manager.h"
// TODO: Uncomment when SD card module is available
// #include <SD.h>
// #include <SPI.h>
#include <time.h>

// Global log file
// TODO: Uncomment when SD card module is available
// File logFile;

// Serial logging buffer for CSV data
static bool logBufferInitialized = false;
static unsigned long logFileStartTime = 0;
static unsigned long logFileNumber = 0;

bool initSD() {
  Serial.println("\n========================================");
  Serial.println("⚠️  SD CARD MODULE NOT YET AVAILABLE");
  Serial.println("========================================");
  Serial.println("[INFO] Using Serial logging as fallback");
  Serial.println("[INFO] Data will be logged to Serial Monitor in CSV format");
  Serial.println("[INFO] To use log data:");
  Serial.println("  1. Copy Serial Monitor output");
  Serial.println("  2. Save as .csv file");
  Serial.println("========================================\n");
  
  logBufferInitialized = true;
  logFileStartTime = millis();
  logFileNumber = 1;
  
  return true;
}

bool createLogFile() {
  // TODO: SD card module not available - using Serial logging
  
  if (!logBufferInitialized) {
    return false;
  }
  
  // Print CSV header to Serial Monitor
  Serial.println("\n=== LOG FILE START ===");
  Serial.println("timestamp,qw,qx,qy,qz,roll,pitch,yaw,accel_x,accel_y,accel_z,gyro_x,gyro_y,gyro_z,mag_x,mag_y,mag_z");
  
  logFileStartTime = millis();
  Serial.print("[LOG] File #");
  Serial.print(logFileNumber++);
  Serial.print(" started at ");
  Serial.println(logFileStartTime);
  
  return true;
}

void logSensorData() {
  // TODO: SD card module not available - output to Serial in CSV format
  
  if (!logBufferInitialized) return;
  
  // Output CSV line to Serial Monitor (for easy copy/paste)
  Serial.print(sensorData.timestamp);
  Serial.print(",");
  Serial.print(sensorData.qw, 5);
  Serial.print(",");
  Serial.print(sensorData.qx, 5);
  Serial.print(",");
  Serial.print(sensorData.qy, 5);
  Serial.print(",");
  Serial.print(sensorData.qz, 5);
  Serial.print(",");
  Serial.print(sensorData.roll, 3);
  Serial.print(",");
  Serial.print(sensorData.pitch, 3);
  Serial.print(",");
  Serial.print(sensorData.yaw, 3);
  Serial.print(",");
  Serial.print(sensorData.accel_x, 4);
  Serial.print(",");
  Serial.print(sensorData.accel_y, 4);
  Serial.print(",");
  Serial.print(sensorData.accel_z, 4);
  Serial.print(",");
  Serial.print(sensorData.gyro_x, 3);
  Serial.print(",");
  Serial.print(sensorData.gyro_y, 3);
  Serial.print(",");
  Serial.print(sensorData.gyro_z, 3);
  Serial.print(",");
  Serial.print(sensorData.mag_x, 2);
  Serial.print(",");
  Serial.print(sensorData.mag_y, 2);
  Serial.print(",");
  Serial.println(sensorData.mag_z, 2);
}

bool rotateLogFile() {
  // TODO: SD card module not available
  
  Serial.println("\n=== LOG FILE END ===");
  Serial.print("[LOG] File #");
  Serial.print(logFileNumber - 1);
  Serial.print(" duration: ");
  Serial.print((millis() - logFileStartTime) / 1000);
  Serial.println(" seconds");
  Serial.println("=== ROTATING TO NEW FILE ===\n");
  
  // Create new file
  return createLogFile();
}

void flushLogBuffer() {
  // TODO: SD card module not available - Serial is auto-flushed
  // No action needed for Serial output
}

void closeLogFile() {
  // TODO: SD card module not available
  
  Serial.println("\n=== LOG FILE END ===");
  Serial.print("[LOG] Logging stopped. Total duration: ");
  Serial.print((millis() - logFileStartTime) / 1000);
  Serial.println(" seconds");
  Serial.println("=== END OF LOG ===\n");
}
