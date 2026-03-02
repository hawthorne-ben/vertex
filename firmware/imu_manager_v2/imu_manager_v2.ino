/*
 * Vertex IMU Manager V2 - Main Firmware
 *
 * ESP32-S3 Mini + LSM6DS3 + SD card logging
 * Records 100Hz IMU data locally, syncs via BLE post-ride.
 *
 * Architecture:
 * - config.h:         All constants, pin assignments, VTX format
 * - sensor_manager:   LSM6DS3 initialization, FIFO batch reads
 * - storage_manager:  SD card VTX binary file I/O
 * - ble_manager:      BLE commands, status notifications, file transfer
 * - power_manager:    Battery monitoring, LED status, shutdown
 *
 * Controls:
 * - BOOT button (GPIO0): Short press toggles recording start/stop
 * - RESET button: Hard reset (not software-controlled)
 * - BLE commands: Start/stop recording, file sync, clock sync
 */

#include <Arduino.h>
#include "config.h"
#include "sensor_manager.h"
#include "storage_manager.h"
#include "ble_manager.h"
#include "power_manager.h"
#include "wifi_manager.h"

// Manager instances
SensorManager sensor;
StorageManager storage;
BLEManager ble;
PowerManager power;
WiFiUploadManager wifiManager;

DeviceState state = STATE_IDLE;

// ===== Wall clock =====
// Synced from phone via CMD_SYNC_CLOCK. Stored as offset from millis().
// wallClockMs() returns unix ms, or 0 if not yet synced.
// Default offset: 2026-02-28 21:30:00 PST (2026-03-01 05:30:00 UTC)
// Used until phone syncs real time via BLE. Gives files reasonable timestamps.
static int64_t _clockOffsetMs = 1772349000000LL;
static bool _clockSynced = false;

int64_t wallClockMs() {
  return (int64_t)millis() + _clockOffsetMs;
}

void syncClock(int64_t unixMs) {
  _clockOffsetMs = unixMs - (int64_t)millis();
  _clockSynced = true;
  Serial.printf("[CLK] Synced — wall clock: %lld\n", wallClockMs());
}

bool isClockSynced() {
  return _clockSynced;
}

// ===== Button handling =====
static unsigned long _buttonDownTime = 0;
static bool _buttonWasPressed = false;

// Returns: 0 = no press, 1 = short press, 2 = long press
static bool _longPressHandled = false;

int checkButtonPress() {
  bool pressed = (digitalRead(USER_BUTTON_PIN) == LOW);

  if (pressed && !_buttonWasPressed) {
    _buttonDownTime = millis();
    _buttonWasPressed = true;
    _longPressHandled = false;
  }

  // Fire long press immediately while still held
  if (pressed && _buttonWasPressed && !_longPressHandled) {
    if (millis() - _buttonDownTime >= BUTTON_LONG_PRESS_MS) {
      _longPressHandled = true;
      return 2;
    }
  }

  if (!pressed && _buttonWasPressed) {
    _buttonWasPressed = false;
    if (_longPressHandled) return 0;  // Already handled as long press
    unsigned long held = millis() - _buttonDownTime;
    if (held >= BUTTON_DEBOUNCE_MS) {
      return 1;  // Short press — toggle recording
    }
  }

  return 0;
}

// ===== Recording control =====

void startRecording() {
  if (state != STATE_IDLE) return;

  if (!_clockSynced) {
    Serial.println("[REC] Clock not synced — using default epoch");
  }

  sensor.resetTimestamp();
  if (storage.openNewFile(wallClockMs())) {
    state = STATE_RECORDING;
    Serial.println("[REC] Started");
  } else {
    Serial.println("[REC] Failed to open file");
  }
}

void stopRecording() {
  if (state != STATE_RECORDING) return;

  storage.closeFile(wallClockMs());
  state = STATE_IDLE;
  Serial.println("[REC] Stopped");
}

// ===== Setup & Loop =====

void setup() {
  Serial.begin(115200);
  delay(500);

  Serial.println("\n========================================");
  Serial.printf("  Vertex IMU V2 - v%s\n", FIRMWARE_VERSION);
  Serial.println("========================================\n");

  // Button input (BOOT button has internal pullup)
  pinMode(USER_BUTTON_PIN, INPUT_PULLUP);

  power.init();
  bool sensorOk = sensor.init();
  bool sdOk = storage.init();
  ble.init();
  wifiManager.init();

  if (!sensorOk) {
    Serial.println("[WARN] IMU init failed — check LSM6DS3 wiring");
  }
  if (!sdOk) {
    Serial.println("[WARN] SD init failed — check card/wiring");
  }

  Serial.println("[READY] Idle — press BOOT button or send BLE command to record\n");
}

void loop() {
  // Check battery / shutdown
  if (power.shouldShutdown()) {
    if (state == STATE_RECORDING) {
      stopRecording();
    }
    power.shutdown();
    return;
  }

  // Button: short press = toggle recording, long press = shutdown
  int btn = checkButtonPress();
  if (btn == 2) {
    Serial.println("[PWR] Long press — shutting down");
    if (state == STATE_RECORDING) {
      stopRecording();
    }
    power.shutdown("Long press");
    return;
  }
  if (btn == 1) {
    if (state == STATE_IDLE) {
      startRecording();
    } else if (state == STATE_RECORDING) {
      stopRecording();
    }
  }

  // Process BLE commands
  ble.processCommands(state, sensor, storage, wifiManager);

  // Poll IMU regardless of state (for debug logging in IDLE)
  int samplesRead = sensor.readFIFO();

  switch (state) {
    case STATE_IDLE: {
      power.updateLED(LED_BLINK_IDLE);

      // Debug: print IMU values at ~2Hz
      static unsigned long lastPrint = 0;
      if (samplesRead > 0 && millis() - lastPrint >= 500) {
        lastPrint = millis();
        const IMURecord& s = sensor.getSampleBuffer()[0];
        Serial.printf("[IMU] ax=%+7.2f ay=%+7.2f az=%+7.2f  gx=%+7.1f gy=%+7.1f gz=%+7.1f\n",
                      s.accel_x, s.accel_y, s.accel_z,
                      s.gyro_x, s.gyro_y, s.gyro_z);
      }
      break;
    }

    case STATE_RECORDING: {
      power.updateLED(LED_BLINK_RECORDING);

      if (samplesRead > 0) {
        storage.writeSamples(sensor.getSampleBuffer(), samplesRead);
      }
      break;
    }

    case STATE_SYNCING:
      power.updateLED(LED_BLINK_SYNCING);
      // File transfer is driven by BLE characteristic reads
      break;

    case STATE_UPLOADING: {
      power.updateLED(LED_BLINK_SYNCING);
      bool stillSyncing = wifiManager.tick(storage);
      if (!stillSyncing) {
        state = STATE_IDLE;
        Serial.println("[MAIN] WiFi sync finished");
      }
      break;
    }
  }
}
