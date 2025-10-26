/*
 * BNO055 Dual-Mode Logger (No LED)
 * 
 * Two operating modes:
 * - Charging Mode: WiFi + Web UI + NTP sync (when USB connected)
 * - Logging Mode: Offline SD card logging (when on battery)
 * 
 * Hardware:
 * - Adafruit Feather ESP32 V2
 * - Adafruit BNO055 IMU
 * - MicroSD card module
 * 
 * Libraries Required:
 * - WiFi.h (ESP32 core)
 * - WebServer.h (ESP32 core)
 * - Wire.h (ESP32 core)
 * - Adafruit_BNO055
 * - Adafruit_Unified_Sensor
 * - SD.h or SdFat
 */

#include "config.h"
#include <WiFi.h>
#include <BluetoothSerial.h>
#include <esp_log.h>
#include <Arduino.h>
#include "power_manager.h"
#include "sensor_manager.h"
#include "wifi_manager.h"
#include "web_server.h"
#include "sd_logger.h"
#include "ntp_sync.h"

// Operating mode
enum OperatingMode {
  MODE_CHARGING,
  MODE_LOGGING
};
OperatingMode currentMode;

// Timing
unsigned long lastCalibrationCheck = 0;
unsigned long lastFileRotationCheck = 0;
unsigned long lastFlushCheck = 0;

void setup() {
  Serial.begin(115200);
  delay(1000);
  
  Serial.println("\n========================================");
  Serial.println("  BNO055 Dual-Mode Logger");
  Serial.println("  VERSION 2.1 - NO LED (I2C Fix)");
  Serial.println("========================================\n");
  
  // Initialize sensor
  Serial.print("[SETUP] Initializing sensor...");
  if (!initSensor()) {
    Serial.println(" ERROR!");
    Serial.println("[ERROR] BNO055 not found. Check connections.");
    while(1) delay(10);
  }
  
  // Disable I2C debug messages that cause crashes
  esp_log_level_set("i2c", ESP_LOG_NONE);
  
  delay(500);
  
  // Detect operating mode (after sensor init, to avoid ADC interference)
  Serial.print("[SETUP] Detecting operating mode...");
  if (isCharging()) {
    currentMode = MODE_CHARGING;
    Serial.println(" CHARGING MODE");
    initializeChargingMode();
  } else {
    currentMode = MODE_LOGGING;
    Serial.println(" LOGGING MODE");
    initializeLoggingMode();
  }
  
  Serial.println("\n========================================");
  Serial.println("Ready!");
  Serial.println("========================================\n");
}

void loop() {
  if (currentMode == MODE_CHARGING) {
    loopChargingMode();
  } else {
    loopLoggingMode();
  }
  
  // Check for mode transition (USB connect/disconnect)
  checkModeTransition();
}

void initializeChargingMode() {
  Serial.println("\n[CHARGING MODE] Initializing...");
  
  // Connect to WiFi
  if (connectToWiFi()) {
    Serial.println("[OK] WiFi connected");
  } else {
    Serial.println("[ERROR] WiFi failed, continuing anyway...");
  }
  
  // Sync NTP time
  if (syncNTP()) {
    Serial.println("[OK] NTP synchronized");
  } else {
    Serial.println("[WARN] NTP sync failed, using internal time");
  }
  
  // Start web server
  startWebServer();
  
  Serial.println("[OK] Charging mode ready");
}

void initializeLoggingMode() {
  Serial.println("\n[LOGGING MODE] Initializing...");
  
  // Turn off all radios to save power
  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);
  btStop();
  Serial.println("[OK] Radios disabled for power saving");
  
  // Check calibration
  uint8_t sys, gyro, accel, mag;
  getCalibrationStatus(&sys, &gyro, &accel, &mag);
  
  Serial.print("[CALIBRATION] System: ");
  Serial.print(sys);
  Serial.print(" Gyro: ");
  Serial.print(gyro);
  Serial.print(" Accel: ");
  Serial.print(accel);
  Serial.print(" Mag: ");
  Serial.println(mag);
  
  // Initialize SD card
  if (initSD()) {
    Serial.println("[OK] SD card ready");
    
    // Create log file
    if (createLogFile()) {
      Serial.println("[OK] Log file created");
    } else {
      Serial.println("[ERROR] Failed to create log file");
    }
  } else {
    Serial.println("[ERROR] SD card failed");
  }
  
  Serial.println("[OK] Logging mode ready");
}

void loopChargingMode() {
  // Handle web server requests (sensor read happens on-demand in handlers)
  handleWebRequests();
  
  // Periodically check calibration status (every 5 seconds)
  if (millis() - lastCalibrationCheck > 5000) {
    updateCalibrationLED();
    lastCalibrationCheck = millis();
  }
}

void loopLoggingMode() {
  // Read sensor at high rate (50Hz = 20ms)
  readSensorData();
  
  // Log to SD card
  logSensorData();
  
  // Check for file rotation (every 30 minutes)
  if (millis() - lastFileRotationCheck > 30 * 60 * 1000) {
    Serial.println("[INFO] Rotating log file...");
    
    if (rotateLogFile()) {
      Serial.println("[OK] File rotated");
    } else {
      Serial.println("[ERROR] File rotation failed");
    }
    
    lastFileRotationCheck = millis();
  }
  
  // Periodic flush for data integrity (every 5 seconds)
  if (millis() - lastFlushCheck > 5000) {
    flushLogBuffer();
    lastFlushCheck = millis();
  }
}

void checkModeTransition() {
  // Check if mode should change (USB plugged/unplugged)
  static bool lastChargingState = false;
  bool currentlyCharging = isCharging();
  
  if (currentlyCharging != lastChargingState) {
    // Mode transition!
    if (currentlyCharging) {
      // Switched to charging mode
      Serial.println("\n[MODE CHANGE] Switching to CHARGING mode...");
      
      // Close any open log file
      if (currentMode == MODE_LOGGING) {
        closeLogFile();
      }
      
      currentMode = MODE_CHARGING;
      initializeChargingMode();
    } else {
      // Switched to logging mode
      Serial.println("\n[MODE CHANGE] Switching to LOGGING mode...");
      
      currentMode = MODE_LOGGING;
      initializeLoggingMode();
    }
    
    lastChargingState = currentlyCharging;
  }
}

void updateCalibrationLED() {
  // Removed LED updates - no LED support
  uint8_t sys, gyro, accel, mag;
  getCalibrationStatus(&sys, &gyro, &accel, &mag);
  
  // Just log to Serial
  Serial.print("[CALIBRATION] System: ");
  Serial.print(sys);
  Serial.print(" Gyro: ");
  Serial.print(gyro);
  Serial.print(" Accel: ");
  Serial.print(accel);
  Serial.print(" Mag: ");
  Serial.println(mag);
}
