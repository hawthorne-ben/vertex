#include "power_manager.h"
#include "config.h"
#include <esp_adc_cal.h>

bool isCharging() {
  // Read battery voltage
  float voltage = getBatteryVoltage();
  
  // Debug output
  Serial.print("[POWER] Battery voltage: ");
  Serial.print(voltage);
  Serial.print("V (threshold: ");
  Serial.print(CHARGE_THRESHOLD_VOLTAGE);
  Serial.print("V)");
  
  // If voltage is at or above charge threshold, we're charging
  bool charging = voltage >= CHARGE_THRESHOLD_VOLTAGE;
  
  if (charging) {
    Serial.println(" → CHARGING");
  } else {
    Serial.println(" → BATTERY");
  }
  
  return charging;
}

float getBatteryVoltage() {
  // Initialize ADC before first use (ESP32 requirement)
  static bool adcInitialized = false;
  if (!adcInitialized) {
    analogReadResolution(12);  // Set ADC to 12-bit resolution (0-4095)
    adcInitialized = true;
  }
  
  // Read analog pin
  int raw = analogRead(BATTERY_MONITOR_PIN);
  
  Serial.print("[POWER] Raw ADC: ");
  Serial.println(raw);
  
  // Feather ESP32 V2: 3.3V reference with 2:1 voltage divider
  // So actual voltage = (raw / 4095) * 3.3 * 2
  float voltage = (raw / 4095.0) * 3.3 * 2;
  
  return voltage;
}
