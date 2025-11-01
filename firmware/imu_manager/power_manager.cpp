/*
 * Power Manager Implementation
 * Handles battery monitoring, power button, and LED status
 */

#include "power_manager.h"
#include "esp_sleep.h"
#include "driver/gpio.h"

PowerManager::PowerManager()
  : lastBatteryRead(0),
    lastLEDToggle(0),
    ledState(false),
    lastButtonCheck(0) {
}

void PowerManager::init() {
  // Configure ADC for battery voltage reading
  analogSetAttenuation(ADC_11db);  // 0-3.3V range
  analogReadResolution(ADC_RESOLUTION);

  // Configure user button (GPIO38)
  pinMode(USER_BUTTON_PIN, INPUT);
  delay(10);

  // Check if waking from deep sleep
  esp_sleep_wakeup_cause_t wakeup_reason = esp_sleep_get_wakeup_cause();

  if (wakeup_reason != ESP_SLEEP_WAKEUP_UNDEFINED) {
    Serial.println("\n========================================");
    Serial.println("  Vertex Sensor Notify - WOKE FROM SLEEP");
    Serial.println("========================================");
    Serial.println("[POWER] Stabilizing I2C after deep sleep...");
    delay(500);
  } else {
    Serial.println("\n========================================");
    Serial.println("  Vertex Sensor Notify - v" FIRMWARE_VERSION);
    Serial.println("========================================");
  }

  // Initialize LED
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, HIGH);

  // Initialize timing
  lastBatteryRead = millis();
  lastLEDToggle = millis();
  lastButtonCheck = millis();
}

float PowerManager::getBatteryVoltage() {
  float batteryMillivolts = analogReadMilliVolts(BATTERY_PIN);
  return (batteryMillivolts * BATTERY_VOLTAGE_DIVIDER) / 1000.0;
}

void PowerManager::updateBatteryReading(float& battery_voltage) {
  unsigned long now = millis();

  if (now - lastBatteryRead >= BATTERY_READ_INTERVAL_MS) {
    battery_voltage = getBatteryVoltage();
    lastBatteryRead = now;
  }
}

bool PowerManager::shouldShutdown() {
  unsigned long now = millis();

  // Check button every 10ms
  if (now - lastButtonCheck > 10) {
    bool buttonPressed = (digitalRead(USER_BUTTON_PIN) == LOW);
    lastButtonCheck = now;
    return buttonPressed;
  }

  return false;
}

void PowerManager::shutdown() {
  Serial.println("\n[POWER] Button pressed - entering deep sleep");
  Serial.println("[POWER] Press RESET button to wake\n");
  digitalWrite(LED_PIN, LOW);

  // Enter deep sleep with NO wake source
  esp_deep_sleep_start();
}

void PowerManager::updateLED(bool connected, uint8_t ledMode) {
  unsigned long now = millis();

  if (ledMode == 0) {
    // LED off
    digitalWrite(LED_PIN, LOW);
  } else if (ledMode == 2) {
    // LED always on
    digitalWrite(LED_PIN, HIGH);
  } else {
    // Status mode - blink based on connection
    int blinkInterval = connected ? LED_BLINK_CONNECTED : LED_BLINK_DISCONNECTED;

    if (now - lastLEDToggle > blinkInterval) {
      ledState = !ledState;
      digitalWrite(LED_PIN, ledState);
      lastLEDToggle = now;
    }
  }
}
