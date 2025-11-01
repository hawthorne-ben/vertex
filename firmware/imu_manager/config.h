/*
 * Vertex IMU Configuration
 * All constants and pin assignments
 */

#ifndef CONFIG_H
#define CONFIG_H

// ===== Firmware Version =====
#define FIRMWARE_VERSION "0.2.0"
#define VTX_FORMAT_MAJOR 1
#define VTX_FORMAT_MINOR 0

// ===== BLE Configuration =====
#define BLE_DEVICE_NAME "Vertex-IMU"
#define SERVICE_UUID        "12345678-1234-5678-1234-56789abcdef0"
#define SENSOR_CHAR_UUID    "12345678-1234-5678-1234-56789abcdef1"
#define CONFIG_CHAR_UUID    "12345678-1234-5678-1234-56789abcdef2"

// ===== BLE Configuration Commands =====
#define CMD_SET_SAMPLE_RATE 0x01
#define CMD_CALIBRATE       0x02
#define CMD_POWER_MODE      0x03
#define CMD_RESET           0x04
#define CMD_LED_MODE        0x05
#define CMD_QUERY_CONFIG    0xFF

// ===== Hardware Pin Assignments =====
#define LED_PIN 13
#define USER_BUTTON_PIN 38
#define BATTERY_PIN 35

// ===== Battery Configuration =====
#define BATTERY_VOLTAGE_DIVIDER 2.0  // Feather has 2:1 voltage divider
#define BATTERY_READ_INTERVAL_MS 1000  // Read battery once per second

// ===== Timing Constants =====
#define CONNECTION_STABILIZE_MS 1000  // Wait 1s after BLE connection
#define PERF_REPORT_INTERVAL_MS 5000  // Report performance every 5 seconds

// ===== Sample Rate Constraints =====
#define MIN_SAMPLE_INTERVAL_MS 20   // 50Hz max sampling rate
#define MAX_SAMPLE_INTERVAL_MS 1000 // 1Hz min sampling rate
#define DEFAULT_SAMPLE_INTERVAL_MS 100  // 10Hz default

// ===== I2C Configuration =====
#define I2C_CLOCK_SPEED_LOW 100000   // 100kHz - low power mode
#define I2C_CLOCK_SPEED_NORMAL 400000 // 400kHz - normal/high mode
#define I2C_TIMEOUT_MS 1000

// ===== Conversion Constants =====
#define RAD_TO_DEG 57.29577951308232  // 180/PI for radians to degrees

// ===== BLE Packet Size =====
#define SENSOR_DATA_PACKET_SIZE 60  // Total bytes in BLE notification

// ===== ADC Configuration =====
#define ADC_RESOLUTION 12  // 12-bit ADC (0-4095)
#define ADC_MAX_VALUE 4095.0

// ===== Power Mode Names (for logging) =====
extern const char* POWER_MODE_NAMES[];

// ===== LED Mode Names (for logging) =====
extern const char* LED_MODE_NAMES[];

// ===== LED Blink Intervals =====
#define LED_BLINK_DISCONNECTED 1000  // Slow blink when waiting for connection
#define LED_BLINK_CONNECTED 100      // Fast blink when connected

#endif // CONFIG_H
