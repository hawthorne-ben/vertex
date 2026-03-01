/*
 * Power Manager V2 Implementation
 * Uses ESP32-S3 built-in neopixelWrite() for WS2812 LED control.
 *
 * States (mapped from blink interval constants):
 *   IDLE (2000ms)      — slow blue breathe
 *   RECORDING (500ms)  — solid red
 *   SYNCING (100ms)    — fast green blink
 */

#include "power_manager.h"
#include "esp_sleep.h"

PowerManager::PowerManager()
  : _lastBatteryRead(0),
    _lastVoltage(0),
    _lastLEDUpdate(0),
    _animStep(0) {
}

void PowerManager::init() {
  setLED(0, 0, 20);  // Dim blue on boot
  Serial.println("[PWR] Power manager ready (NeoPixel on GPIO21)");
}

void PowerManager::setLED(uint8_t r, uint8_t g, uint8_t b) {
  // ESP32-S3-Zero WS2812 uses RGB wire order (not standard GRB)
  rgbLedWriteOrdered(LED_PIN, LED_COLOR_ORDER_RGB, r, g, b);
}

float PowerManager::getBatteryVoltage() {
  return 0.0f;  // Deferred — no ADC wired yet
}

bool PowerManager::shouldShutdown() {
  return false;
}

void PowerManager::shutdown(const char* reason) {
  Serial.printf("[PWR] Shutting down: %s\n", reason);
  setLED(0, 0, 0);
  Serial.flush();
  delay(100);

  // Wait for button release before sleeping, otherwise release triggers wake
  while (digitalRead(USER_BUTTON_PIN) == LOW) {
    delay(10);
  }
  delay(50);  // Debounce

  // Wake on BOOT button press (GPIO0, active low → wake on level 0)
  esp_sleep_enable_ext0_wakeup((gpio_num_t)USER_BUTTON_PIN, 0);
  esp_deep_sleep_start();
}

void PowerManager::updateLED(int blinkIntervalMs) {
  unsigned long now = millis();

  if (blinkIntervalMs == LED_BLINK_RECORDING) {
    // Solid red while recording
    setLED(30, 0, 0);
    return;
  }

  if (blinkIntervalMs == LED_BLINK_SYNCING) {
    // Fast green blink
    if (now - _lastLEDUpdate >= 100) {
      _lastLEDUpdate = now;
      _animStep = !_animStep;
      if (_animStep) {
        setLED(0, 30, 0);
      } else {
        setLED(0, 0, 0);
      }
    }
    return;
  }

  // IDLE: slow blue breathe (sine wave over 2s period)
  if (now - _lastLEDUpdate >= 30) {
    _lastLEDUpdate = now;
    float phase = (float)(now % 2000) / 2000.0f * 6.2832f;
    uint8_t brightness = (uint8_t)(3.0f + 25.0f * (0.5f + 0.5f * sinf(phase)));
    setLED(0, 0, brightness);
  }
}
