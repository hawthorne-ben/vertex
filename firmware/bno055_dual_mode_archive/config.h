/*
 * Configuration File
 * 
 * UPDATE THESE VALUES FOR YOUR NETWORK:
 */

#ifndef CONFIG_H
#define CONFIG_H

// ===== WiFi Configuration =====
#define WIFI_SSID "The Greenhouse 2.4"
#define WIFI_PASSWORD "BeLeafInYourself"

// WiFi connection settings
#define WIFI_MAX_ATTEMPTS 3
#define WIFI_CONNECT_TIMEOUT 10000 // ms

// ===== NTP Configuration =====
#define NTP_SERVER "pool.ntp.org"
#define GMT_OFFSET_SEC -28800  // PST: -8 hours
#define DAYLIGHT_OFFSET_SEC 3600 // PDT: +1 hour

// ===== Sensor Configuration =====
#define BNO055_ADDRESS 0x28 // I2C address
#define SENSOR_SAMPLE_INTERVAL 20 // ms (50Hz for logging mode)

// ===== SD Card Configuration =====
#define SD_CS_PIN 33 // Chip select pin for SD card
#define FILE_ROTATION_INTERVAL (30 * 60 * 1000) // 30 minutes
#define FLUSH_INTERVAL 5000 // 5 seconds

// ===== LED Configuration =====
#define LED_PIN 2 // Feather ESP32 V2 NeoPixel pin (GPIO 2)
#define LED_BRIGHTNESS 20 // 0-255 (20 = low power)

// ===== Power Management =====
#define CHARGE_THRESHOLD_VOLTAGE 2.0 // Volts (USB present - lower threshold for USB detection)
#define BATTERY_MONITOR_PIN A13 // Feather ESP32 V2 battery monitor

// ===== Timing Configuration =====
#define CALIBRATION_CHECK_INTERVAL 5000 // 5 seconds (charging mode)

#endif // CONFIG_H
