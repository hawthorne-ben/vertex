/*
 * Power Manager Implementation
 * Handles battery monitoring, power button, and LED status
 */

#include "power_manager.h"
#include "neopixel_manager.h"
#include "esp_sleep.h"
#include "driver/gpio.h"

// External reference to neopixel manager for shutdown visual
extern NeoPixelManager neopixelManager;

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
    Serial.println("  Vertex IMU Manager - WOKE FROM SLEEP");
    Serial.println("========================================");
    Serial.println("[POWER] Stabilizing I2C after deep sleep...");
    delay(500);
  } else {
    Serial.println("\n========================================");
    Serial.println("  Vertex IMU Manager - v" FIRMWARE_VERSION);
    Serial.println("========================================");
  }

  // Initialize LED
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, HIGH);

  // Initialize timing
  lastBatteryRead = millis();
  lastLEDToggle = millis();
  lastButtonCheck = millis();

  // Check battery on boot - critical safety check
  float bootVoltage = getBatteryVoltage();
  Serial.print("[POWER] Boot battery check: ");
  Serial.print(bootVoltage, 2);
  Serial.println("V");

  if (isBatteryCritical(bootVoltage)) {
    Serial.println("[POWER] ⚠️  CRITICAL: Battery below cutoff voltage!");
    Serial.print("[POWER] Cutoff threshold: ");
    Serial.print(BATTERY_CUTOFF_VOLTAGE, 1);
    Serial.println("V");
    shutdown("Battery protection - critically low voltage");
  }
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

    // Check battery safety on every reading
    if (isBatteryCritical(battery_voltage)) {
      Serial.println("\n[POWER] ⚠️  CRITICAL: Battery voltage critically low!");
      Serial.print("[POWER] Voltage: ");
      Serial.print(battery_voltage, 2);
      Serial.print("V (cutoff: ");
      Serial.print(BATTERY_CUTOFF_VOLTAGE, 1);
      Serial.println("V)");
      shutdown("Battery protection - critically low voltage");
    }
  }
}

bool PowerManager::isBatteryCritical(float voltage) {
  // Return true if voltage is below safe cutoff threshold
  // 3.2V is conservative - protects battery with margin above damage threshold
  return voltage < BATTERY_CUTOFF_VOLTAGE;
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

void PowerManager::shutdown(const char* reason) {
  Serial.print("\n[POWER] Shutting down: ");
  Serial.println(reason);
  Serial.println("[POWER] Entering deep sleep mode");
  Serial.println("[POWER] Press RESET button to wake\n");

  // Turn off all NeoPixels for sleep mode
  neopixelManager.showShutdown();

  // Turn off LED
  digitalWrite(LED_PIN, LOW);

  // Flush serial to ensure message is sent
  Serial.flush();

  // Display shutdown visual for 500ms before deep sleep
  delay(500);

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
