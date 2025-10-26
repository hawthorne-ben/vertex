/*
 * BNO055 Web Server
 * 
 * Creates a web server on the ESP32 that displays real-time sensor data
 * in your browser. Connects to your WiFi network and serves on any device
 * connected to the same network.
 * 
 * CONFIGURATION:
 * 1. Update ssid and password constants below with your WiFi credentials
 * 2. Upload this sketch to your Feather ESP32 V2
 * 3. Open Serial Monitor to see the assigned IP address
 * 4. Visit http://[IP_ADDRESS] in any browser on your network
 * 
 * Hardware:
 * - Adafruit Feather ESP32 V2
 * - Adafruit BNO055 IMU
 * 
 * Libraries Required:
 * - WiFi.h (included with ESP32 core)
 * - Adafruit_BNO055
 * - Adafruit_Unified_Sensor
 */

#include <WiFi.h>
#include <WebServer.h>
#include <Wire.h>
#include <Adafruit_Sensor.h>
#include <Adafruit_BNO055.h>
#include <utility/imumaths.h>
#include "esp_log.h"

// WiFi credentials - CONFIGURE THESE FOR YOUR NETWORK
const char* ssid = "The Greenhouse 2.4";
const char* password = "BeLeafInYourself";

// Create web server on port 80
WebServer server(80);

// Create BNO055 sensor instance
Adafruit_BNO055 bno = Adafruit_BNO055(55);

// Sampling rate control
unsigned long lastSampleTime = 0;
const unsigned long SAMPLE_INTERVAL_MS = 100;  // 10 Hz for web display

// Current sensor data (shared between loop and web handlers)
struct SensorData {
  unsigned long timestamp;
  float quat_w, quat_x, quat_y, quat_z;
  float roll, pitch, yaw;
  float accel_x, accel_y, accel_z;
  float gyro_x, gyro_y, gyro_z;
  uint8_t cal_sys, cal_gyro, cal_accel, cal_mag;
} sensorData;

void setup() {
  Serial.begin(115200);
  delay(1000);
  
  Serial.println("\n========================================");
  Serial.println("    BNO055 Web Server");
  Serial.println("========================================\n");

  // Configure I2C with better error handling
  Serial.print("[SETUP] Initializing sensor...");
  Wire.begin();
  Wire.setClock(400000);  // Set to 400kHz (faster, but may be less reliable)
  Wire.setTimeout(1000);  // 1 second timeout
  
  if (!bno.begin()) {
    Serial.println(" ERROR!");
    Serial.println("[ERROR] BNO055 not found. Check connections.");
    while(1) delay(10);
  }
  
  bno.setExtCrystalUse(true);
  Serial.println(" OK");
  
  // Disable ESP32 I2C debug messages that cause crashes
  esp_log_level_set("i2c", ESP_LOG_NONE);
  
  delay(500);

  // Connect to WiFi network
  Serial.print("[SETUP] Connecting to WiFi: ");
  Serial.println(ssid);
  WiFi.mode(WIFI_STA);
  
  // Try to connect, with retries
  for (int retry = 0; retry < 3; retry++) {
    if (retry > 0) {
      Serial.println("[RETRY] Attempting to reconnect...");
      delay(2000);
    }
    
    WiFi.begin(ssid, password);
    
    // Wait for connection
    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED) {
      delay(500);
      Serial.print(".");
      attempts++;
      if (attempts > 20) {  // 10 second timeout per attempt
        break;
      }
    }
    
      if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[OK] WiFi connected!");
    Serial.print("[INFO] IP Address: ");
    Serial.println(WiFi.localIP());
    Serial.print("[INFO] Signal Strength (RSSI): ");
    Serial.print(WiFi.RSSI());
    Serial.println(" dBm");
    break;  // Success!
  }
}

if (WiFi.status() != WL_CONNECTED) {
  Serial.println("\n[ERROR] Failed to connect to WiFi after 3 attempts!");
  Serial.println("[ERROR] Please check your credentials and try again.");
  Serial.println("[INFO] Continuing anyway - WiFi will retry in loop...");
}

  // Set up web server routes
  server.on("/", handleRoot);
  server.on("/data", handleData);
  server.on("/style.css", handleCSS);
  
  server.begin();
  Serial.println("[INFO] Web server started!");
  Serial.println("\n========================================");
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("Ready! Visit:");
    Serial.print("http://");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("Web server running, but WiFi not connected.");
    Serial.println("Will automatically retry WiFi connection...");
  }
  Serial.println("========================================\n");
}

void loop() {
  // Check WiFi connection status and reconnect if needed
  if (WiFi.status() != WL_CONNECTED) {
    static unsigned long lastReconnectAttempt = 0;
    const unsigned long RECONNECT_INTERVAL = 30000;  // Try every 30 seconds
    
    if (millis() - lastReconnectAttempt > RECONNECT_INTERVAL) {
      Serial.println("[WARN] WiFi disconnected, attempting to reconnect...");
      WiFi.disconnect();
      delay(100);
      WiFi.begin(ssid, password);
      lastReconnectAttempt = millis();
    }
  }
  
  // Handle web server requests
  server.handleClient();
  
  // Update sensor data at configured rate
  unsigned long now = millis();
  if (now - lastSampleTime >= SAMPLE_INTERVAL_MS) {
    updateSensorData();
    lastSampleTime = now;
  }
}

void updateSensorData() {
  static uint8_t errorCount = 0;
  const uint8_t MAX_ERRORS = 5;
  
  // Attempt to read sensor data - the library should handle errors
  imu::Quaternion quat = bno.getQuat();
  imu::Vector<3> euler = quat.toEuler();
  imu::Vector<3> accel = bno.getVector(Adafruit_BNO055::VECTOR_LINEARACCEL);
  imu::Vector<3> gyro = bno.getVector(Adafruit_BNO055::VECTOR_GYROSCOPE);
  
  uint8_t sys, gyro_cal, accel_cal, mag;
  bno.getCalibration(&sys, &gyro_cal, &accel_cal, &mag);
  
  // Check if data is valid (NaN indicates I2C error)
  bool isValid = !isnan(quat.w()) && !isnan(euler.x()) && !isnan(accel.x()) && !isnan(gyro.x());
  
  if (isValid) {
    // Store in global structure
    sensorData.timestamp = millis();
    sensorData.quat_w = quat.w();
    sensorData.quat_x = quat.x();
    sensorData.quat_y = quat.y();
    sensorData.quat_z = quat.z();
    sensorData.roll = euler.x() * 57.2958;  // Rad to deg
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
    errorCount = 0;  // Reset on success
  } else {
    errorCount++;
    if (errorCount == 1) {
      // Only log first error to avoid spam
      Serial.println("[WARN] I2C error detected, sensor may be disconnected");
    }
    
    if (errorCount >= MAX_ERRORS) {
      Serial.println("[ERROR] Too many I2C errors, attempting recovery...");
      
      // Attempt recovery: reinitialize I2C and sensor
      Wire.end();
      delay(100);
      Wire.begin();
      delay(100);
      
      if (bno.begin()) {
        Serial.println("[OK] Sensor recovered!");
        bno.setExtCrystalUse(true);
        errorCount = 0;
      } else {
        Serial.println("[ERROR] Sensor recovery failed!");
        // Will try again next cycle
      }
    }
  }
}

void handleRoot() {
  String html = R"(
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>BNO055 IMU Logger</title>
    <link rel="stylesheet" href="/style.css">
</head>
<body>
    <div class="container">
        <header>
            <h1>🧭 BNO055 IMU Monitor</h1>
            <div class="status">
                <span class="status-dot" id="statusDot"></span>
                <span id="connectionStatus">Connected</span>
            </div>
        </header>

        <div class="grid">
            <!-- Orientation -->
            <section class="card">
                <h2>📐 Orientation</h2>
                <div class="data-grid">
                    <div class="data-item">
                        <label>Roll</label>
                        <span id="roll" class="value">0.0°</span>
                    </div>
                    <div class="data-item">
                        <label>Pitch</label>
                        <span id="pitch" class="value">0.0°</span>
                    </div>
                    <div class="data-item">
                        <label>Yaw</label>
                        <span id="yaw" class="value">0.0°</span>
                    </div>
                </div>
            </section>

            <!-- Acceleration -->
            <section class="card">
                <h2>⚡ Acceleration</h2>
                <div class="data-grid">
                    <div class="data-item">
                        <label>X</label>
                        <span id="accel_x" class="value">0.0 m/s²</span>
                    </div>
                    <div class="data-item">
                        <label>Y</label>
                        <span id="accel_y" class="value">0.0 m/s²</span>
                    </div>
                    <div class="data-item">
                        <label>Z</label>
                        <span id="accel_z" class="value">0.0 m/s²</span>
                    </div>
                </div>
            </section>

            <!-- Gyroscope -->
            <section class="card">
                <h2>🌀 Gyroscope</h2>
                <div class="data-grid">
                    <div class="data-item">
                        <label>X</label>
                        <span id="gyro_x" class="value">0.0 rad/s</span>
                    </div>
                    <div class="data-item">
                        <label>Y</label>
                        <span id="gyro_y" class="value">0.0 rad/s</span>
                    </div>
                    <div class="data-item">
                        <label>Z</label>
                        <span id="gyro_z" class="value">0.0 rad/s</span>
                    </div>
                </div>
            </section>

            <!-- Calibration -->
            <section class="card">
                <h2>✅ Calibration</h2>
                <div class="data-grid">
                    <div class="data-item">
                        <label>System</label>
                        <span id="cal_sys" class="value">0</span>
                    </div>
                    <div class="data-item">
                        <label>Gyro</label>
                        <span id="cal_gyro" class="value">0</span>
                    </div>
                    <div class="data-item">
                        <label>Accel</label>
                        <span id="cal_accel" class="value">0</span>
                    </div>
                    <div class="data-item">
                        <label>Mag</label>
                        <span id="cal_mag" class="value">0</span>
                    </div>
                </div>
            </section>

            <!-- Quaternion -->
            <section class="card">
                <h2>🔢 Quaternion</h2>
                <div class="data-grid">
                    <div class="data-item full-width">
                        <label>W</label>
                        <span id="quat_w" class="value">0.0000</span>
                    </div>
                    <div class="data-item">
                        <label>X</label>
                        <span id="quat_x" class="value">0.0000</span>
                    </div>
                    <div class="data-item">
                        <label>Y</label>
                        <span id="quat_y" class="value">0.0000</span>
                    </div>
                    <div class="data-item">
                        <label>Z</label>
                        <span id="quat_z" class="value">0.0000</span>
                    </div>
                </div>
            </section>

            <!-- Info -->
            <section class="card">
                <h2>ℹ️ Info</h2>
                <div class="info-grid">
                    <div class="info-item">
                        <label>Uptime</label>
                        <span id="uptime">0s</span>
                    </div>
                    <div class="info-item">
                        <label>Last Update</label>
                        <span id="lastUpdate">--</span>
                    </div>
                </div>
            </section>
        </div>
    </div>

    <script>
        let lastUpdateTime = 0;
        let lastDataTime = Date.now();
        const startTime = Date.now();

        function updateData() {
            fetch('/data')
                .then(response => response.json())
                .then(data => {
                    // Update orientation
                    document.getElementById('roll').textContent = data.roll.toFixed(2) + '°';
                    document.getElementById('pitch').textContent = data.pitch.toFixed(2) + '°';
                    document.getElementById('yaw').textContent = data.yaw.toFixed(2) + '°';

                    // Update acceleration
                    document.getElementById('accel_x').textContent = data.accel_x.toFixed(3) + ' m/s²';
                    document.getElementById('accel_y').textContent = data.accel_y.toFixed(3) + ' m/s²';
                    document.getElementById('accel_z').textContent = data.accel_z.toFixed(3) + ' m/s²';

                    // Update gyroscope
                    document.getElementById('gyro_x').textContent = data.gyro_x.toFixed(3) + ' rad/s';
                    document.getElementById('gyro_y').textContent = data.gyro_y.toFixed(3) + ' rad/s';
                    document.getElementById('gyro_z').textContent = data.gyro_z.toFixed(3) + ' rad/s';

                    // Update calibration
                    document.getElementById('cal_sys').textContent = data.cal_sys;
                    document.getElementById('cal_gyro').textContent = data.cal_gyro;
                    document.getElementById('cal_accel').textContent = data.cal_accel;
                    document.getElementById('cal_mag').textContent = data.cal_mag;

                    // Update quaternion
                    document.getElementById('quat_w').textContent = data.quat_w.toFixed(4);
                    document.getElementById('quat_x').textContent = data.quat_x.toFixed(4);
                    document.getElementById('quat_y').textContent = data.quat_y.toFixed(4);
                    document.getElementById('quat_z').textContent = data.quat_z.toFixed(4);

                    // Update info
                    const uptime = Math.floor((Date.now() - startTime) / 1000);
                    document.getElementById('uptime').textContent = uptime + 's';
                    document.getElementById('lastUpdate').textContent = new Date().toLocaleTimeString();
                    lastDataTime = Date.now();
                })
                .catch(error => {
                    console.error('Error fetching data:', error);
                    document.getElementById('statusDot').classList.remove('active');
                    document.getElementById('connectionStatus').textContent = 'Disconnected';
                });
        }

        // Update every 100ms
        setInterval(updateData, 100);
        
        // Initial update
        updateData();

        // Check connection status
        setInterval(() => {
            const timeSinceLastUpdate = Date.now() - lastDataTime;
            const dot = document.getElementById('statusDot');
            const status = document.getElementById('connectionStatus');
            
            if (timeSinceLastUpdate > 2000) {
                dot.classList.remove('active');
                status.textContent = 'Disconnected';
            } else {
                dot.classList.add('active');
                status.textContent = 'Connected';
            }
        }, 500);
    </script>
</body>
</html>
)";
  
  server.send(200, "text/html", html);
}

void handleData() {
  // Return JSON data
  String json = "{";
  json += "\"timestamp\":" + String(sensorData.timestamp) + ",";
  json += "\"roll\":" + String(sensorData.roll) + ",";
  json += "\"pitch\":" + String(sensorData.pitch) + ",";
  json += "\"yaw\":" + String(sensorData.yaw) + ",";
  json += "\"accel_x\":" + String(sensorData.accel_x) + ",";
  json += "\"accel_y\":" + String(sensorData.accel_y) + ",";
  json += "\"accel_z\":" + String(sensorData.accel_z) + ",";
  json += "\"gyro_x\":" + String(sensorData.gyro_x) + ",";
  json += "\"gyro_y\":" + String(sensorData.gyro_y) + ",";
  json += "\"gyro_z\":" + String(sensorData.gyro_z) + ",";
  json += "\"quat_w\":" + String(sensorData.quat_w) + ",";
  json += "\"quat_x\":" + String(sensorData.quat_x) + ",";
  json += "\"quat_y\":" + String(sensorData.quat_y) + ",";
  json += "\"quat_z\":" + String(sensorData.quat_z) + ",";
  json += "\"cal_sys\":" + String(sensorData.cal_sys) + ",";
  json += "\"cal_gyro\":" + String(sensorData.cal_gyro) + ",";
  json += "\"cal_accel\":" + String(sensorData.cal_accel) + ",";
  json += "\"cal_mag\":" + String(sensorData.cal_mag);
  json += "}";
  
  server.send(200, "application/json", json);
}

void handleCSS() {
  String css = R"(
* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    min-height: 100vh;
    padding: 20px;
}

.container {
    max-width: 1400px;
    margin: 0 auto;
}

header {
    background: rgba(255, 255, 255, 0.95);
    border-radius: 20px;
    padding: 30px;
    margin-bottom: 30px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
    display: flex;
    justify-content: space-between;
    align-items: center;
}

h1 {
    color: #2d3748;
    font-size: 2rem;
}

.status {
    display: flex;
    align-items: center;
    gap: 10px;
    font-weight: 500;
    color: #4a5568;
}

.status-dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: #cbd5e0;
    transition: background 0.3s;
}

.status-dot.active {
    background: #48bb78;
    box-shadow: 0 0 10px rgba(72, 187, 120, 0.5);
}

.grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 20px;
}

.card {
    background: rgba(255, 255, 255, 0.95);
    border-radius: 20px;
    padding: 25px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
}

.card h2 {
    color: #2d3748;
    font-size: 1.3rem;
    margin-bottom: 20px;
    border-bottom: 2px solid #e2e8f0;
    padding-bottom: 10px;
}

.data-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
    gap: 15px;
}

.data-item {
    display: flex;
    flex-direction: column;
    gap: 5px;
}

.data-item.full-width {
    grid-column: 1 / -1;
}

.data-item label {
    color: #718096;
    font-size: 0.85rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

.data-item .value {
    color: #2d3748;
    font-size: 1.1rem;
    font-weight: 600;
    font-family: 'Monaco', 'Courier New', monospace;
}

.info-grid {
    display: flex;
    flex-direction: column;
    gap: 15px;
}

.info-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 0;
    border-bottom: 1px solid #e2e8f0;
}

.info-item:last-child {
    border-bottom: none;
}

.info-item label {
    color: #718096;
    font-size: 0.9rem;
}

.info-item span {
    color: #2d3748;
    font-weight: 600;
}

@media (max-width: 768px) {
    header {
        flex-direction: column;
        gap: 15px;
        text-align: center;
    }
    
    h1 {
        font-size: 1.5rem;
    }
    
    .grid {
        grid-template-columns: 1fr;
    }
}
)";
  
  server.send(200, "text/css", css);
}
