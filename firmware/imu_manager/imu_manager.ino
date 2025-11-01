/*
 * Vertex IMU Manager - Main Firmware
 *
 * Modular architecture for BLE-based IMU sensor streaming
 * Version: 0.2.0
 *
 * Architecture:
 * - config.h: All constants and configuration
 * - ble_manager: BLE communication and configuration
 * - sensor_manager: BNO055 sensor operations
 * - power_manager: Battery, button, LED management
 * - performance: Performance metrics and monitoring
 */

#include <Arduino.h>
#include "config.h"
#include "ble_manager.h"
#include "sensor_manager.h"
#include "power_manager.h"
#include "performance.h"

// Global constant definitions (declared extern in config.h)
const char* POWER_MODE_NAMES[] = {"LOW", "NORMAL", "HIGH"};
const char* LED_MODE_NAMES[] = {"OFF", "STATUS", "ALWAYS-ON"};

// Manager instances
BLEManager bleManager;
SensorManager sensorManager;
PowerManager powerManager;
PerformanceTracker performance;

void setup() {
  Serial.begin(115200);
  delay(1000);

  // Initialize power management (ADC, button, LED, boot messages)
  powerManager.init();

  // Initialize sensor
  if (!sensorManager.init()) {
    // Sensor failed - blink LED rapidly and halt
    while (1) {
      digitalWrite(LED_PIN, !digitalRead(LED_PIN));
      delay(100);
    }
  }

  // Initialize BLE
  bleManager.init();

  // Read initial battery voltage for performance tracking
  float initialBatteryVoltage = powerManager.getBatteryVoltage();

  // Initialize performance tracking with initial battery voltage
  performance.init(initialBatteryVoltage);

  Serial.println("\n========================================");
  Serial.println("Ready!");
  Serial.println("========================================\n");

  digitalWrite(LED_PIN, LOW);
}

void loop() {
  performance.recordLoopStart();

  // Check for power button press
  if (powerManager.shouldShutdown()) {
    powerManager.shutdown();
    return;  // Never reached (deep sleep)
  }

  // Update sensor data
  if (sensorManager.update()) {
    performance.recordSample();

    // Update battery voltage in sensor data
    powerManager.updateBatteryReading(sensorManager.getMutableData().battery_voltage);

    // Update performance tracker with current battery voltage
    performance.updateBatteryVoltage(sensorManager.getData().battery_voltage);

    // Send data if connected and stabilized
    if (bleManager.isConnected() &&
        (millis() - bleManager.getConnectionTime() >= CONNECTION_STABILIZE_MS)) {
      bleManager.sendSensorData(sensorManager.getData());

      // Update performance metrics
      performance.updateMetrics(
        sensorManager.getLastReadTime(),
        bleManager.getLastNotifyTime()
      );
    }
  }

  // Update LED status
  powerManager.updateLED(
    bleManager.isConnected(),
    bleManager.getLedMode()
  );

  performance.recordLoopEnd();

  // Report performance metrics
  performance.report(sensorManager.getSampleIntervalMs());
}
