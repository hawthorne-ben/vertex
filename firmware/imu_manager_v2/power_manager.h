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

private:
  unsigned long _lastBatteryRead;
  float _lastVoltage;
  unsigned long _lastLEDUpdate;
  uint8_t _animStep;

  float readBatteryVoltage();
  void setLED(uint8_t r, uint8_t g, uint8_t b);
};

#endif // POWER_MANAGER_H
