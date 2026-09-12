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
#include "log_manager.h"
#include "esp_sleep.h"

PowerManager::PowerManager()
  : _lastBatteryRead(0),
    _lastVoltage(0),
    _lastLEDUpdate(0),
    _animStep(0) {
}

void PowerManager::init() {
  if (BATTERY_ADC_PIN >= 0) {
    analogSetAttenuation(ADC_11db);  // Full range 0-3.3V
    pinMode(BATTERY_ADC_PIN, INPUT);
    // Take initial reading
    _lastVoltage = readBatteryVoltage();
    _lastBatteryRead = millis();
    Serial.printf("[PWR] Battery: %.2fV\n", _lastVoltage);
  }
  setLED(0, 0, 20);  // Dim blue on boot
  Serial.println("[PWR] Power manager ready (NeoPixel on GPIO21)");
}

void PowerManager::setLED(uint8_t r, uint8_t g, uint8_t b) {
  // ESP32-S3-Zero WS2812 uses RGB wire order (not standard GRB)
  rgbLedWriteOrdered(LED_PIN, LED_COLOR_ORDER_RGB, r, g, b);
}

float PowerManager::readBatteryVoltage() {
  uint32_t sum = 0;
  for (int i = 0; i < BATTERY_ADC_SAMPLES; i++) {
    sum += analogReadMilliVolts(BATTERY_ADC_PIN);
  }
  float pinVolts = (float)sum / (float)BATTERY_ADC_SAMPLES / 1000.0f;
  return pinVolts * BATTERY_VOLTAGE_DIVIDER * BATTERY_SCALE_FACTOR;
}

float PowerManager::getBatteryVoltage() {
  unsigned long now = millis();
  if (now - _lastBatteryRead >= BATTERY_READ_INTERVAL_MS) {
    _lastVoltage = readBatteryVoltage();
    _lastBatteryRead = now;

    // ADDED — a MISSING signal, not a re-levelled one. The battery was read
    // every 5 s and logged nowhere, so a ride that ended early carried no
    // evidence of whether the pack sagged. Logged on crossing into the warning
    // band rather than on a timer: a periodic INFO at 5 s is 720 lines/hour of
    // near-constant values, while the edge is the event worth keeping.
    const float warnV = BATTERY_CUTOFF_VOLTAGE + 0.2f;
    if (_lastVoltage > 0.5f && _lastVoltage < warnV && !_lowBatteryLogged) {
      _lowBatteryLogged = true;
      LOG_W("PWR", "battery low: %.2fV (cutoff %.2fV)",
            _lastVoltage, (float)BATTERY_CUTOFF_VOLTAGE);
    } else if (_lastVoltage >= warnV + 0.05f && _lowBatteryLogged) {
      // Hysteresis: a charging pack crossing back clears the latch without
      // chattering a pair of lines per 5 s read at the threshold.
      _lowBatteryLogged = false;
      LOG_I("PWR", "battery recovered: %.2fV", _lastVoltage);
    }
  }
  return _lastVoltage;
}

bool PowerManager::shouldShutdown() {
  if (BATTERY_ADC_PIN < 0) return false;
  return getBatteryVoltage() > 0.5f && getBatteryVoltage() < BATTERY_CUTOFF_VOLTAGE;
}

void PowerManager::shutdown(const char* reason) {
  // INFO: shutdown is a normal end to a session. The battery-cutoff case that
  // forces one is a separate WARN, so an unexpected shutdown is still visible
  // at ERROR-free levels. shutdownWith() flushes before calling here, so this
  // reaches the card regardless of severity.
  LOG_I("PWR", "shutting down: %s", reason);
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

  if (blinkIntervalMs == LED_BLINK_UPLOADING) {
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

// Fault indication: urgent red blink. Used when the IMU or SD card failed to
// initialise, so the condition is visible before a ride rather than
// discovered afterwards as an empty file.
void PowerManager::updateFaultLED(int blinkIntervalMs) {
  unsigned long now = millis();
  if (now - _lastLEDUpdate >= (unsigned long)blinkIntervalMs) {
    _lastLEDUpdate = now;
    _animStep = !_animStep;
    setLED(_animStep ? 255 : 0, 0, 0);
  }
}
