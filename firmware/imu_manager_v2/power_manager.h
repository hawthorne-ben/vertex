/*
 * Power Manager V2 - Battery monitoring, NeoPixel status LED, shutdown
 */

#ifndef POWER_MANAGER_H
#define POWER_MANAGER_H

#include <Arduino.h>
#include "config.h"

class PowerManager {
public:
  PowerManager();

  void init();

  float getBatteryVoltage();
  bool shouldShutdown();
  void shutdown(const char* reason = "Shutdown requested");

  // LED state: pass blink interval from config (LED_BLINK_IDLE, etc.)
  void updateLED(int blinkIntervalMs);
  // Fault indication: red, so a failed IMU or SD is visible before a ride
  // rather than discovered as an empty file afterwards.
  void updateFaultLED(int blinkIntervalMs);

private:
  unsigned long _lastBatteryRead;
  float _lastVoltage;
  bool _lowBatteryLogged = false;  // latch, so the warning is logged on the
                                   // crossing rather than every 5 s read
  unsigned long _lastLEDUpdate;
  uint8_t _animStep;

  float readBatteryVoltage();
  void setLED(uint8_t r, uint8_t g, uint8_t b);
};

#endif // POWER_MANAGER_H
