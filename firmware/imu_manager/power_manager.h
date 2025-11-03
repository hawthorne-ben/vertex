/*
 * Power Manager - Handles battery monitoring, power button, and LED status
 * Manages power-related functions and sleep modes
 */

#ifndef POWER_MANAGER_H
#define POWER_MANAGER_H

#include <Arduino.h>
#include "config.h"

class PowerManager {
public:
  PowerManager();

  // Initialize power management (ADC, button, LED)
  void init();

  // Read battery voltage
  float getBatteryVoltage();

  // Update battery voltage in sensor data (call periodically)
  void updateBatteryReading(float& battery_voltage);

  // Check if battery is critically low (returns true if below cutoff)
  bool isBatteryCritical(float voltage);

  // Check if power button is pressed (returns true if should shutdown)
  bool shouldShutdown();

  // Enter deep sleep (with reason for logging)
  void shutdown(const char* reason = "Button pressed");

  // Update LED status based on connection and mode
  void updateLED(bool connected, uint8_t ledMode);

private:
  unsigned long lastBatteryRead;
  unsigned long lastLEDToggle;
  bool ledState;
  unsigned long lastButtonCheck;
};

#endif // POWER_MANAGER_H
