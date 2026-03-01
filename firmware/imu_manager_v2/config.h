/*
 * Vertex IMU V2 Configuration
 * All constants and pin assignments for ESP32-S3 Mini + LSM6DS3
 */

#ifndef CONFIG_H
#define CONFIG_H

// ===== Firmware Version =====
#define FIRMWARE_VERSION "2.0.0"

// ===== VTX Format (must match packages/vtx-parser) =====
#define VTX_FORMAT_MAJOR 1
#define VTX_FORMAT_MINOR 1
#define VTX_MAGIC "VTX"                // 3 bytes + null terminator
#define VTX_HEADER_SIZE 64
#define VTX_RECORD_FORMAT 0x03         // HAS_ACCEL (0x01) | HAS_GYRO (0x02)
#define VTX_COMPRESSION_NONE 0
#define VTX_IMU_RECORD_SIZE 28         // 4 (timestamp) + 12 (accel float32x3) + 12 (gyro float32x3)

// ===== BLE Configuration =====
#define BLE_DEVICE_NAME "Vertex-V2"
#define SERVICE_UUID        "12345678-1234-5678-1234-56789abcdef0"
#define SENSOR_CHAR_UUID    "12345678-1234-5678-1234-56789abcdef1"  // Status notifications
#define CONFIG_CHAR_UUID    "12345678-1234-5678-1234-56789abcdef2"  // Commands
#define FILE_LIST_CHAR_UUID "12345678-1234-5678-1234-56789abcdef3"  // File listing
#define FILE_DATA_CHAR_UUID "12345678-1234-5678-1234-56789abcdef4"  // File transfer

// ===== BLE Commands =====
#define CMD_GET_STATUS      0x01  // Query device status (recording, battery, free space)
#define CMD_START_RECORDING 0x02  // Start a new recording session
#define CMD_STOP_RECORDING  0x03  // Stop current recording
#define CMD_LIST_FILES      0x04  // List recorded files on SD
#define CMD_REQUEST_FILE    0x05  // Begin file transfer
#define CMD_DELETE_FILE     0x06  // Delete a file from SD
#define CMD_SET_CONFIG      0x07  // Update device settings
#define CMD_SYNC_CLOCK      0x09  // Sync wall clock from phone (8 bytes: unix ms int64)
#define CMD_RESET           0x0A  // Soft reset
#define CMD_QUERY_CONFIG    0xFF  // Query current configuration

// ===== Hardware Pin Assignments (ESP32-S3 Mini) =====
// Buttons
// BOOT button = GPIO0 (active low, has internal pullup) — used as user button after boot
// RESET button = hard reset (not a GPIO, directly resets the chip)
#define USER_BUTTON_PIN 0

// I2C (LSM6DS3)
#define I2C_SDA_PIN 2
#define I2C_SCL_PIN 1
#define IMU_INT1_PIN 3

// SPI (SD Card)
#define SD_SCK_PIN  10
#define SD_MOSI_PIN 11
#define SD_MISO_PIN 12
#define SD_CS_PIN   13

// Status LED (WS2812 NeoPixel on ESP32-S3-Zero)
#define LED_PIN 21  // Onboard WS2812 RGB LED

// ===== Battery Configuration =====
// TP4057 outputs raw battery voltage (3.7-4.2V) on BAT+.
// To read voltage: tap BAT+ through a voltage divider to an ADC-capable GPIO.
// A simple 100K/100K divider halves the voltage into ESP32 ADC range (0-3.3V).
// This requires two resistors soldered inline — no extra module needed.
// For MVP: defer battery sense, rely on TP4057 protection circuit.
#define BATTERY_ADC_PIN -1             // Set to GPIO number when divider is wired
#define BATTERY_VOLTAGE_DIVIDER 2.0    // Divider ratio (100K/100K = 2:1)
#define BATTERY_CUTOFF_VOLTAGE 3.2     // Graceful shutdown threshold
#define BATTERY_READ_INTERVAL_MS 5000

// ===== IMU Configuration (LSM6DS3) =====
#define IMU_I2C_ADDR 0x6B          // LSM6DS3 with SDO/SA0 high (or floating)
#define IMU_ODR_HZ 104             // Output Data Rate (native 104Hz setting)
#define IMU_ACCEL_RANGE 8          // +/- 8g (sufficient for cycling dynamics)
#define IMU_GYRO_RANGE 1000        // +/- 1000 dps
#define IMU_FIFO_THRESHOLD 60      // Samples in FIFO before read (~10 reads per batch)

// LSM6DS3 scale factors (raw register value → physical units)
// Accel: at +/-8g range, sensitivity = 0.244 mg/LSB → multiply by 0.000244 * 9.80665 for m/s²
#define ACCEL_SCALE (0.000244f * 9.80665f)  // raw → m/s²
// Gyro: at +/-1000dps range, sensitivity = 35 mdps/LSB → multiply by 0.035 * PI/180 for rad/s
#define GYRO_SCALE (0.035f * 3.14159265f / 180.0f)  // raw → rad/s

// ===== SD Card Configuration =====
#define SD_SPI_SPEED 16000000      // 16 MHz SPI clock
#define LOG_DIR "/vtx"             // Directory for log files
#define MAX_FILE_SIZE_MB 64        // Rotate files at 64MB

// ===== Button Configuration =====
#define BUTTON_DEBOUNCE_MS 50
#define BUTTON_LONG_PRESS_MS 2000  // Long press = shutdown (future)

// ===== Timing =====
#define FIFO_POLL_INTERVAL_MS 100  // Read FIFO every 100ms (~10 samples per batch)
#define IDLE_TIMEOUT_MS 300000     // 5 min idle before auto-stop recording
#define LED_BLINK_IDLE 2000        // Slow blink when idle
#define LED_BLINK_RECORDING 500    // Medium blink when recording
#define LED_BLINK_SYNCING 100      // Fast blink when transferring

// ===== I2C Configuration =====
#define I2C_CLOCK_SPEED 400000     // 400kHz fast mode

// ===== Device State =====
enum DeviceState : int {
  STATE_IDLE,       // Waiting — BLE advertising, not recording
  STATE_RECORDING,  // Active recording — FIFO reads + SD writes
  STATE_SYNCING,    // File transfer in progress over BLE
};

#endif // CONFIG_H
