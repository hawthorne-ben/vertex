/*
 * Vertex IMU Manager - Main Firmware
 *
 * Modular architecture for BLE-based IMU sensor streaming
 * Version: 0.3.0
 *
 * Architecture:
 * - config.h: All constants and configuration
 * - ble_manager: BLE communication and configuration
 * - sensor_manager: BNO055 sensor operations
 * - power_manager: Battery, button, LED management
 * - neopixel_manager: NeoPixel tail light control
 * - performance: Performance metrics and monitoring
 */

#include <Arduino.h>
#include "config.h"
#include "ble_manager.h"
#include "sensor_manager.h"
#include "power_manager.h"
#include "neopixel_manager.h"
#include "performance.h"

// Global constant definitions (declared extern in config.h)
const char* POWER_MODE_NAMES[] = {"LOW", "NORMAL", "HIGH"};
const char* LED_MODE_NAMES[] = {"OFF", "STATUS", "ALWAYS-ON"};

// Manager instances
BLEManager bleManager;
SensorManager sensorManager;
PowerManager powerManager;
NeoPixelManager neopixelManager;
PerformanceTracker performance;

void setup() {
  Serial.begin(115200);
  delay(1000);

  // Initialize power management (ADC, button, LED, boot messages)
  powerManager.init();

  // Initialize sensor
  bool sensorOk = sensorManager.init();
  if (!sensorOk) {
    Serial.println("⚠️  WARNING: Sensor init failed - continuing for NeoPixel testing");
    Serial.println("⚠️  Connect BNO sensor for full functionality\n");
  }

  // Initialize BLE
  bleManager.init();

  // Initialize NeoPixel tail light (gracefully continues if init fails)
  neopixelManager.init();

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

  // Sync sample interval from BLE manager to sensor manager
  sensorManager.setSampleIntervalMs(bleManager.getSampleIntervalMs());

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

  // Update NeoPixel state-based visual feedback
  // streaming = true if connected AND past stabilization period
  bool streaming = bleManager.isConnected() &&
                   (millis() - bleManager.getConnectionTime() >= CONNECTION_STABILIZE_MS);
  bool braking = sensorManager.isBraking();
  neopixelManager.update(bleManager.isConnected(), streaming, braking, bleManager.getLedMode());

  performance.recordLoopEnd();

  // Report performance metrics
  performance.report(sensorManager.getSampleIntervalMs());
}
