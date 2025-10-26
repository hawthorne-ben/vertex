/*
 * BNO055 Dual-Mode Logger (Simple Version)
 * 
 * Two operating modes:
 * - Charging Mode: WiFi + Web UI + NTP sync (when USB connected, >4.0V)
 * - Logging Mode: WiFi + Web UI (when on battery, <4.0V)
 * 
 * Based on working v1 web server - simplified approach
 */

#include <WiFi.h>
#include <WebServer.h>
#include <Wire.h>
#include <Adafruit_Sensor.h>
#include <Adafruit_BNO055.h>
#include <utility/imumaths.h>
#include <time.h>
#include "esp_log.h"
#include "config.h"

// Create web server on port 80
WebServer server(80);

// Create BNO055 sensor instance
Adafruit_BNO055 bno = Adafruit_BNO055(55);

// Operating modes
enum OperatingMode {
  MODE_CHARGING,
  MODE_LOGGING
};
OperatingMode currentMode;

// ===== BNO055 LED Control =====
// The BNO055 has an internal LED that can be controlled programmatically
// This avoids the I2C conflicts caused by the NeoPixel on GPIO 2

// LED register address (these may need adjustment based on your specific BNO055 module)
#define BNO055_REG_PAGE_ID 0x07
#define BNO055_REG_SYS_TRIGGER 0x3F
#define BNO055_LED_CONTROL_REG 0x4B

// LED status tracking
bool ledEnabled = false;
unsigned long lastLedToggle = 0;
int ledBlinkInterval = 0;  // 0 = off, >0 = blink interval in ms

// Sampling rate control
unsigned long lastSampleTime = 0;
const unsigned long SAMPLE_INTERVAL_MS = 100;  // 10 Hz

// Current sensor data
struct SensorData {
  unsigned long timestamp;
  float roll, pitch, yaw;
  float accel_x, accel_y, accel_z;
  float gyro_x, gyro_y, gyro_z;
  float quat_w, quat_x, quat_y, quat_z;
  uint8_t cal_sys, cal_gyro, cal_accel, cal_mag;
} sensorData;

void setup() {
  Serial.begin(115200);
  delay(1000);
  
  Serial.println("\n========================================");
  Serial.println("  BNO055 Dual-Mode Logger");
  Serial.println("  SIMPLE VERSION");
  Serial.println("========================================\n");

  // Initialize sensor
  Serial.print("[SETUP] Initializing sensor...");
  Wire.begin();
  Wire.setClock(100000);  // Slower for stability
  Wire.setTimeout(1000);
  
  if (!bno.begin()) {
    Serial.println(" ERROR!");
    Serial.println("[ERROR] BNO055 not found. Check connections.");
    // Continue anyway for testing
  } else {
    bno.setExtCrystalUse(true);
    Serial.println(" OK");
  }
  
  esp_log_level_set("i2c", ESP_LOG_NONE);
  delay(500);

  // Detect operating mode
  float voltage = readBatteryVoltage();
  bool charging = (voltage >= CHARGE_THRESHOLD_VOLTAGE);
  
  Serial.print("[SETUP] Battery voltage: ");
  Serial.print(voltage, 2);
  Serial.println("V");
  Serial.print("[SETUP] Mode: ");
  
  if (charging) {
    currentMode = MODE_CHARGING;
    Serial.println("CHARGING MODE");
  } else {
    currentMode = MODE_LOGGING;
    Serial.println("LOGGING MODE");
  }

  // Connect WiFi and start web server (both modes for now)
  connectWiFi();
  
  // Configure NTP
  configTime(GMT_OFFSET_SEC, DAYLIGHT_OFFSET_SEC, NTP_SERVER);
  
  startWebServer();
  
  // Initialize BNO055 LED
  Serial.print("[SETUP] Initializing BNO055 LED...");
  setBNO055LED(true);  // Turn on LED initially
  Serial.println(" OK");
  
  Serial.println("\n========================================");
  Serial.println("Ready!");
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("http://");
    Serial.println(WiFi.localIP());
  }
  Serial.println("========================================\n");
}

void loop() {
  // Handle web server
  server.handleClient();
  
  // Update sensor data
  unsigned long now = millis();
  if (now - lastSampleTime >= SAMPLE_INTERVAL_MS) {
    updateSensorData();
    lastSampleTime = now;
  }
  
  // Check mode transition (simple check every 5 seconds)
  static unsigned long lastModeCheck = 0;
  if (now - lastModeCheck > 5000) {
    checkModeTransition();
    lastModeCheck = now;
  }
  
  // Update BNO055 LED (check every 100ms for smooth blinking)
  static unsigned long lastLEDCheck = 0;
  if (now - lastLEDCheck > 100) {
    updateBNO055LED();
    lastLEDCheck = now;
  }
  
  // Update LED status indicator (check every 2 seconds)
  static unsigned long lastStatusLEDCheck = 0;
  if (now - lastStatusLEDCheck > 2000) {
    updateBNO055LEDStatus();
    lastStatusLEDCheck = now;
  }
  
  // Check battery level and handle low battery
  static unsigned long lastBatteryCheck = 0;
  if (now - lastBatteryCheck > 5000) {
    checkBatteryLevel();
    lastBatteryCheck = now;
  }
}

void connectWiFi() {
  Serial.print("[WiFi] Connecting to: ");
  Serial.println(WIFI_SSID);
  
  // Set WiFi mode and configure
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.setTxPower(WIFI_POWER_19dBm); // Max power
  
  // First, scan for networks to debug
  Serial.println("[WiFi] Scanning for networks...");
  int n = WiFi.scanNetworks();
  if (n == 0) {
    Serial.println("[DEBUG] No networks found");
  } else {
    Serial.printf("[DEBUG] Found %d networks:\n", n);
    bool found = false;
    for (int i = 0; i < n; i++) {
      Serial.printf("  - %s (RSSI: %d, Ch: %d)\n", WiFi.SSID(i).c_str(), WiFi.RSSI(i), WiFi.channel(i));
      if (WiFi.SSID(i) == WIFI_SSID) {
        found = true;
        Serial.printf("[DEBUG] Target network found! RSSI: %d, Channel: %d\n", WiFi.RSSI(i), WiFi.channel(i));
      }
    }
    if (!found) {
      Serial.println("[ERROR] Target network not found in scan!");
    }
  }
  
  // Attempt connection with detailed logging
  Serial.println("[WiFi] Attempting connection...");
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  
  unsigned long startTime = millis();
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    Serial.print(".");
    
    // Print status codes periodically
    if (attempts % 10 == 9) {
      wl_status_t status = WiFi.status();
      Serial.printf("\n[DEBUG] Status: %d", status);
      switch(status) {
        case WL_IDLE_STATUS: Serial.println(" (IDLE)"); break;
        case WL_NO_SSID_AVAIL: Serial.println(" (NO SSID)"); break;
        case WL_CONNECT_FAILED: Serial.println(" (CONNECT FAILED)"); break;
        case WL_CONNECTION_LOST: Serial.println(" (CONNECTION LOST)"); break;
        case WL_DISCONNECTED: Serial.println(" (DISCONNECTED)"); break;
        default: Serial.println(); break;
      }
    }
    attempts++;
  }
  Serial.println();
  
  unsigned long connectTime = millis() - startTime;
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("[OK] WiFi connected! IP: ");
    Serial.print(WiFi.localIP());
    Serial.print(" (RSSI: ");
    Serial.print(WiFi.RSSI());
    Serial.print(" dBm, Time: ");
    Serial.print(connectTime);
    Serial.println(" ms)");
  } else {
    Serial.print("[ERROR] WiFi failed! Status: ");
    wl_status_t status = WiFi.status();
    Serial.print(status);
    Serial.print(" (");
    switch(status) {
      case WL_IDLE_STATUS: Serial.print("IDLE"); break;
      case WL_NO_SSID_AVAIL: Serial.print("NO_SSID_AVAIL"); break;
      case WL_CONNECT_FAILED: Serial.print("CONNECT_FAILED"); break;
      case WL_CONNECTION_LOST: Serial.print("CONNECTION_LOST"); break;
      case WL_DISCONNECTED: Serial.print("DISCONNECTED"); break;
      default: Serial.print("UNKNOWN"); break;
    }
    Serial.println(")");
    Serial.println("[DEBUG] Check: SSID, password, signal strength, router settings");
  }
}

void startWebServer() {
  server.on("/", handleRoot);
  server.on("/sensor", handleSensor);
  server.begin();
  Serial.println("[OK] Web server started!");
}

void handleRoot() {
  // Get time
  struct tm timeinfo;
  bool timeValid = getLocalTime(&timeinfo);
  
  // Simple status page with calibration and NTP status
  String html = "<!DOCTYPE html><html><head><meta charset='UTF-8'><title>BNO055 Status</title>";
  html += "<meta http-equiv='refresh' content='5'>";
  html += "<style>body{font-family:Arial;margin:20px;background:#1a1a1a;color:#fff;}";
  html += "h1{color:#4CAF50;} .card{background:#2a2a2a;padding:15px;margin:10px 0;border-radius:5px;}";
  html += "table{width:100%;border-collapse:collapse;} td{padding:8px;border:1px solid #444;}";
  html += ".status-ok{color:#0f0;} .status-error{color:#f00;} .cal-badge{padding:5px 10px;border-radius:3px;display:inline-block;}";
  html += ".cal-3{background:#0f0;color:#000;} .cal-2{background:#ff0;color:#000;} .cal-1{background:#f80;color:#000;} .cal-0{background:#f00;}";
  html += "</style></head><body>";
  html += "<h1>BNO055 Dual-Mode Logger</h1>";
  
  // Status card
  html += "<div class='card'><h2>System Status</h2><table>";
  html += "<tr><td>Mode</td><td>" + String(currentMode == MODE_CHARGING ? "🔌 CHARGING" : "🔋 LOGGING") + "</td></tr>";
  html += "<tr><td>Voltage</td><td>" + String(readBatteryVoltage(), 2) + "V</td></tr>";
  html += "<tr><td>WiFi</td><td class='" + String(WiFi.status() == WL_CONNECTED ? "status-ok'>✅ Connected" : "status-error'>❌ Disconnected") + "</td></tr>";
  if (WiFi.status() == WL_CONNECTED) {
    html += "<tr><td>IP Address</td><td>" + WiFi.localIP().toString() + "</td></tr>";
  }
  html += "</table></div>";
  
  // Time card
  html += "<div class='card'><h2>🕐 Current Time</h2>";
  if (timeValid) {
    char timeStr[20];
    strftime(timeStr, sizeof(timeStr), "%Y-%m-%d %H:%M:%S", &timeinfo);
    html += "<p>" + String(timeStr) + "</p>";
  } else {
    html += "<p class='status-error'>Not synchronized</p>";
  }
  html += "</div>";
  
  // Calibration card
  html += "<div class='card'><h2>Calibration Status</h2>";
  html += "<span class='cal-badge cal-" + String(sensorData.cal_sys) + "'>System: " + String(sensorData.cal_sys) + "</span> ";
  html += "<span class='cal-badge cal-" + String(sensorData.cal_gyro) + "'>Gyro: " + String(sensorData.cal_gyro) + "</span> ";
  html += "<span class='cal-badge cal-" + String(sensorData.cal_accel) + "'>Accel: " + String(sensorData.cal_accel) + "</span> ";
  html += "<span class='cal-badge cal-" + String(sensorData.cal_mag) + "'>Mag: " + String(sensorData.cal_mag) + "</span>";
  html += "</div>";
  
  html += "<p><a href='/sensor' style='color:#4CAF50;'>View Sensor Data →</a></p>";
  html += "</body></html>";
  server.send(200, "text/html", html);
}

void handleSensor() {
  struct tm timeinfo;
  bool timeValid = getLocalTime(&timeinfo);
  
  String json = "{";
  json += "\"mode\":\"" + String(currentMode == MODE_CHARGING ? "charging" : "logging") + "\",";
  json += "\"voltage\":" + String(readBatteryVoltage(), 2) + ",";
  json += "\"time_valid\":" + String(timeValid ? "true" : "false") + ",";
  if (timeValid) {
    char timeStr[20];
    strftime(timeStr, sizeof(timeStr), "%Y-%m-%d %H:%M:%S", &timeinfo);
    json += "\"time\":\"" + String(timeStr) + "\",";
  }
  json += "\"roll\":" + String(sensorData.roll) + ",";
  json += "\"pitch\":" + String(sensorData.pitch) + ",";
  json += "\"yaw\":" + String(sensorData.yaw) + ",";
  json += "\"cal_sys\":" + String(sensorData.cal_sys) + ",";
  json += "\"cal_gyro\":" + String(sensorData.cal_gyro) + ",";
  json += "\"cal_accel\":" + String(sensorData.cal_accel) + ",";
  json += "\"cal_mag\":" + String(sensorData.cal_mag);
  json += "}";
  server.send(200, "application/json", json);
}

void updateSensorData() {
  imu::Quaternion quat = bno.getQuat();
  imu::Vector<3> euler = quat.toEuler();
  imu::Vector<3> accel = bno.getVector(Adafruit_BNO055::VECTOR_LINEARACCEL);
  imu::Vector<3> gyro = bno.getVector(Adafruit_BNO055::VECTOR_GYROSCOPE);
  
  uint8_t sys, gyro_cal, accel_cal, mag;
  bno.getCalibration(&sys, &gyro_cal, &accel_cal, &mag);
  
  sensorData.timestamp = millis();
  sensorData.quat_w = quat.w();
  sensorData.quat_x = quat.x();
  sensorData.quat_y = quat.y();
  sensorData.quat_z = quat.z();
  sensorData.roll = euler.x() * 57.2958;
  sensorData.pitch = euler.y() * 57.2958;
  sensorData.yaw = euler.z() * 57.2958;
  sensorData.accel_x = accel.x();
  sensorData.accel_y = accel.y();
  sensorData.accel_z = accel.z();
  sensorData.gyro_x = gyro.x();
  sensorData.gyro_y = gyro.y();
  sensorData.gyro_z = gyro.z();
  sensorData.cal_sys = sys;
  sensorData.cal_gyro = gyro_cal;
  sensorData.cal_accel = accel_cal;
  sensorData.cal_mag = mag;
}

void checkModeTransition() {
  float voltage = readBatteryVoltage();
  bool charging = (voltage >= CHARGE_THRESHOLD_VOLTAGE);
  
  if ((charging && currentMode != MODE_CHARGING) || (!charging && currentMode != MODE_LOGGING)) {
    Serial.println("[MODE CHANGE] Switching modes...");
    currentMode = charging ? MODE_CHARGING : MODE_LOGGING;
  }
}

float readBatteryVoltage() {
  analogReadResolution(12);
  int raw = analogRead(BATTERY_MONITOR_PIN);
  return (raw / 4095.0) * 3.3 * 2;
}

// ===== BNO055 LED Control Functions =====

void setBNO055LED(bool enable) {
  // Control the BNO055 internal LED via I2C
  // Note: LED register address may vary by manufacturer
  // This implementation writes directly to I2C register
  
  Wire.beginTransmission(0x28);  // BNO055 I2C address
  Wire.write(BNO055_LED_CONTROL_REG);
  Wire.write(enable ? 0x01 : 0x00);
  uint8_t error = Wire.endTransmission();
  
  if (error == 0) {
    ledEnabled = enable;
    ledBlinkInterval = 0; // Disable blinking
    Serial.printf("[LED] BNO055 LED %s\n", enable ? "ON" : "OFF");
  } else {
    Serial.printf("[LED] Failed to control LED (error: %d)\n", error);
  }
}

void setBNO055LEDBlink(int intervalMs) {
  // Set LED to blinking mode with specified interval
  // This will be handled in loop()
  ledBlinkInterval = intervalMs;
  
  // Start with LED on
  if (intervalMs > 0) {
    setBNO055LED(true);
    lastLedToggle = millis();
  } else {
    setBNO055LED(false);
  }
}

void updateBNO055LED() {
  if (ledBlinkInterval > 0) {
    unsigned long now = millis();
    unsigned long timeInCycle = (now - lastLedToggle) % (ledBlinkInterval * 2);
    
    if (timeInCycle < ledBlinkInterval) {
      // LED should be ON
      if (!ledEnabled) {
        setBNO055LED(true);
      }
    } else {
      // LED should be OFF
      if (ledEnabled) {
        setBNO055LED(false);
      }
    }
  }
}

void updateBNO055LEDStatus() {
  // Update LED based on system status
  if (!bno.begin()) {
    // Sensor error - fast red blink
    setBNO055LEDBlink(200);
    return;
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    uint8_t sys, gyro, accel, mag;
    bno.getCalibration(&sys, &gyro, &accel, &mag);
    
    if (sys == 3) {
      // Fully calibrated - solid green
      setBNO055LEDBlink(0);
      setBNO055LED(true);
    } else if (sys >= 1) {
      // Calibrating - slow yellow blink
      setBNO055LEDBlink(1000);
    } else {
      // Not calibrated - fast yellow blink
      setBNO055LEDBlink(500);
    }
  } else {
    // Not connected - slow red blink
    setBNO055LEDBlink(1000);
  }
}

// ===== Public LED Control API =====
// You can call these functions from your code to control the LED programmatically

void ledOn() {
  // Turn LED on permanently
  setBNO055LED(true);
}

void ledOff() {
  // Turn LED off permanently
  setBNO055LED(false);
}

void ledBlink(int intervalMs) {
  // Make LED blink at specified interval (in milliseconds)
  // Example: ledBlink(500) blinks once per second
  setBNO055LEDBlink(intervalMs);
}

void ledFastBlink() {
  // Fast blink (200ms interval)
  setBNO055LEDBlink(200);
}

void ledSlowBlink() {
  // Slow blink (1 second interval)
  setBNO055LEDBlink(1000);
}

// ===== Battery Monitoring =====

void checkBatteryLevel() {
  float voltage = readBatteryVoltage();
  
  // Only check battery level when NOT charging
  if (voltage < CHARGE_THRESHOLD_VOLTAGE) {
    if (voltage <= CRITICAL_BATTERY_VOLTAGE) {
      // Critical - shutdown to protect battery
      Serial.println("\n[CRITICAL] Battery voltage too low! Shutting down...");
      Serial.printf("[CRITICAL] Voltage: %.2fV (below %.2fV cutoff)\n", voltage, CRITICAL_BATTERY_VOLTAGE);
      
      // Blink LED rapidly to indicate critical state
      setBNO055LEDBlink(100);
      
      // Add shutdown logic here if you have it
      // ESP.deepSleep(0);  // Sleep forever until powered
      
      delay(10000);  // Wait before shutdown
    } else if (voltage <= LOW_BATTERY_VOLTAGE) {
      // Low battery warning
      Serial.printf("[WARNING] Low battery: %.2fV (below %.2fV)\n", voltage, LOW_BATTERY_VOLTAGE);
      
      // Fast blink to indicate low battery
      if (ledBlinkInterval != 300) {
        setBNO055LEDBlink(300);
        Serial.println("[WARNING] LED blinking fast - battery low!");
      }
    }
  }
}
