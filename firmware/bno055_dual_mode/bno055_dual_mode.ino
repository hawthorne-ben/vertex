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
}

void connectWiFi() {
  Serial.print("[WiFi] Connecting to: ");
  Serial.println(WIFI_SSID);
  
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    Serial.print(".");
    attempts++;
  }
  Serial.println();
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("[OK] WiFi connected! IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("[ERROR] WiFi failed!");
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
