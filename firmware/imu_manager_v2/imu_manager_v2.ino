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
// Default offset: 2026-02-28 23:10:00 PST (2026-03-01 07:10:00 UTC)
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
// State machine lives in vtx_format.h (vtxButtonUpdate) so the host tests can
// drive it deterministically. Only the pin read and the clock stay here.
static ButtonState _button = {0, false, false};

ButtonEvent checkButtonPress() {
  bool pressed = (digitalRead(USER_BUTTON_PIN) == LOW);
  return vtxButtonUpdate(&_button, pressed, millis());
}

// ===== Periodic clock sync (VTX v1.2) =====
// Every CLOCK_SYNC_INTERVAL_MS while recording, ask the phone for its wall
// clock and store the four-timestamp exchange as a sync record in the .vtx
// file. This is a MEASUREMENT, not a correction: _clockOffsetMs is never
// touched here, and IMU sample timestamps keep running off millis() alone.
// Resolving device-vs-phone disagreement happens offline in the parser
// (computeClockDrift). See packages/vtx-format/spec/v1.2-clock-sync.md.
static unsigned long _lastSyncRequestMs = 0;
static uint16_t _syncMissCount = 0;

// Non-blocking: issues at most one BLE notify and one buffer append per call.
// No busy-wait, no delay() — the FIFO service path in loop() is never stalled.
static void serviceClockSync() {
  // 1. Collect a completed exchange, if one landed since the last iteration.
  uint32_t t1, t4;
  int64_t t2, t3;
  if (ble.pollTimeResponse(t1, t4, t2, t3)) {
    ClockSyncRecord rec;
    rec.t1_device_ms = t1;
    rec.t4_device_ms = t4;
    rec.t2_phone_unix_ms = t2;
    rec.t3_phone_unix_ms = t3;
    if (!storage.addSyncRecord(rec)) {
      Serial.println("[CLK] Sync buffer full — no further samples this recording");
    } else {
      int32_t rtt = (int32_t)(t4 - t1) - (int32_t)(t3 - t2);
      Serial.printf("[CLK] Sync #%u — rtt=%ldms\n",
                    (unsigned)storage.getSyncRecordCount(), (long)rtt);
    }
  }

  // 2. Expire a request the phone never answered. Not an error: BLE is
  //    disconnected for most of a typical ride.
  if (ble.expireStaleTimeRequest()) {
    _syncMissCount++;
    Serial.printf("[CLK] Sync request timed out (%u missed)\n", (unsigned)_syncMissCount);
  }

  // 3. Issue the next request on cadence.
  if (millis() - _lastSyncRequestMs >= CLOCK_SYNC_INTERVAL_MS) {
    // Advance the schedule even when the request cannot be sent, so a long
    // disconnection does not queue up a burst of requests on reconnect.
    _lastSyncRequestMs = millis();
    if (!ble.requestPhoneTime()) {
      _syncMissCount++;
    }
  }
}

// ===== Recording control =====
static unsigned long _recordingStartMs = 0;

uint32_t getRecordingElapsedSecs() {
  if (state != STATE_RECORDING) return 0;
  return (uint32_t)((millis() - _recordingStartMs) / 1000);
}

void startRecording() {
  if (state != STATE_IDLE) return;

  // Fail fast rather than producing an empty file. A dead IMU used to let a
  // recording start, blink the LED for two hours, and yield a valid .vtx
  // containing zero records — a silent failure discovered only after the ride.
  if (!sensor.isHealthy() || !storage.isReady()) {
    Serial.printf("[REC] Refused — IMU %s, SD %s\n",
                  sensor.isHealthy() ? "ok" : "FAILED",
                  storage.isReady() ? "ok" : "FAILED");
    state = STATE_FAULT;
    return;
  }

  if (!_clockSynced) {
    Serial.println("[REC] Clock not synced — using default epoch");
  }

  // Capacity is predictable: 10.0 MB/hour. Refuse to start a session there is
  // not room to finish rather than cutting it off mid-ride.
  if (!storage.hasSpaceToStart()) {
    Serial.printf("[REC] Refused — %lu MB free, need %d MB (~%lu min of recording left)\n",
                  (unsigned long)storage.getFreeSpaceMBCached(), SD_MIN_START_MB,
                  (unsigned long)storage.getRemainingSecondsCached() / 60);
    return;
  }
  if (storage.isSpaceLow()) {
    Serial.printf("[REC] Warning — only ~%lu min of space left\n",
                  (unsigned long)storage.getRemainingSecondsCached() / 60);
  }

  sensor.resetTimestamp();
  if (storage.openNewFile(wallClockMs())) {
    _recordingStartMs = millis();
    // First periodic sync fires one full interval in. The connect-time
    // CMD_SYNC_CLOCK already established the initial offset.
    _lastSyncRequestMs = millis();
    _syncMissCount = 0;
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

// Stop any active recording, then power down. Single path so the battery
// cutoff and the long press cannot diverge — closing a file before cutting
// power is the part that must never be skipped.
static void shutdownWith(const char* reason) {
  stopRecording();          // safe unconditionally: no-ops unless recording
  power.shutdown(reason);
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

  // Critical path: without the IMU there is nothing to record, without the SD
  // card there is nowhere to put it. Either one means recording cannot succeed,
  // so enter STATE_FAULT and show red rather than logging to a serial port
  // nobody is watching.
  //
  // BLE and WiFi are deliberately NOT gated here: they are auxiliary. Losing
  // BLE costs remote control (the button still works); WiFi only matters at
  // upload time, long after the ride. Note their init() calls return void, so
  // their failures are currently invisible — see notes/firmware-deep-dive.md.
  if (!sensorOk || !sdOk) {
    if (!sensorOk) Serial.println("[FAULT] IMU init failed — check LSM6DS3 wiring");
    if (!sdOk)     Serial.println("[FAULT] SD init failed — check card/wiring");
    state = STATE_FAULT;
  }

  // NOTE: setCpuFrequencyMhz(80) after BLE init kills NimBLE advertising
  // on ESP32-S3 with core 3.3.6. Leave at 240MHz until root-caused.
  // setCpuFrequencyMhz(CPU_MHZ_NORMAL);
  if (state == STATE_FAULT) {
    Serial.println("[FAULT] Recording disabled. LED red. Fix hardware and reset,");
    Serial.println("        or long-press to shut down.\n");
  } else {
    Serial.println("[READY] Idle — press BOOT button or send BLE command to record\n");
  }
}

void loop() {
  // Check battery / shutdown
  if (power.shouldShutdown()) {
    shutdownWith("Battery cutoff");
    return;
  }

  // Button: short press = toggle recording, long press = shutdown
  switch (checkButtonPress()) {
    case BTN_LONG:
      // Works from every state, STATE_FAULT included — powering down must
      // never depend on the device being healthy.
      Serial.println("[PWR] Long press — shutting down");
      shutdownWith("Long press");
      return;

    case BTN_SHORT:
      switch (state) {
        case STATE_IDLE:      startRecording(); break;
        case STATE_RECORDING: stopRecording();  break;
        case STATE_FAULT:
          Serial.println("[FAULT] Recording unavailable — IMU or SD card failed");
          break;
        case STATE_UPLOADING:
          Serial.println("[BTN] Ignored — upload in progress");
          break;
      }
      break;

    case BTN_NONE:
      break;
  }

  // Process BLE commands
  ble.processCommands(state, sensor, storage, wifiManager, power);

  // Poll IMU regardless of state (for debug logging in IDLE)
  int samplesRead = sensor.readFIFO();

  switch (state) {
    case STATE_FAULT: {
      power.updateFaultLED(LED_BLINK_FAULT);

      // Allow recovery without a reset: an SD card seated after boot, or an
      // IMU that answers WHO_AM_I on a retry, clears the fault. The IMU is
      // re-probed at a slow cadence so a hard failure does not spam I2C.
      static unsigned long lastRetry = 0;
      if (millis() - lastRetry >= 5000) {
        lastRetry = millis();
        bool sdNow = storage.isReady() || storage.init();
        bool imuNow = sensor.isHealthy() || sensor.init();
        if (sdNow && imuNow) {
          Serial.println("[FAULT] Cleared — subsystems healthy, returning to idle");
          state = STATE_IDLE;
        }
      }
      break;
    }

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

      // Periodic clock sync sampling. Runs after the FIFO read above so a
      // sample batch is never delayed behind it.
      serviceClockSync();

      // Stop on our own terms while there is still room to close the file.
      // Waiting for a write to fail risks failing *inside* patchHeader(),
      // which would leave an inconsistent header — the one storage failure
      // that costs the whole recording rather than the tail of it.
      if (storage.isSpaceCritical()) {
        Serial.printf("[REC] SD nearly full (%lu MB) — closing file cleanly\n",
                      (unsigned long)storage.getFreeSpaceMBCached());
        stopRecording();
        break;
      }

      if (samplesRead > 0) {
        if (!storage.writeSamples(sensor.getSampleBuffer(), samplesRead)) {
          // Either the card filled faster than the 30 s poll saw, or the write
          // genuinely failed. Both end the recording; the log distinguishes
          // them so the cause is not guesswork afterwards.
          Serial.printf("[REC] SD write failed (%lu MB free) — stopping\n",
                        (unsigned long)storage.getFreeSpaceMB());
          stopRecording();
        }
      }
      break;
    }

    case STATE_UPLOADING: {
      power.updateLED(LED_BLINK_UPLOADING);
      bool stillSyncing = wifiManager.tick(storage);

      // Push status to app every 500ms during upload
      static unsigned long lastStatusPush = 0;
      if (millis() - lastStatusPush >= 500) {
        lastStatusPush = millis();
        SyncProgress sp = wifiManager.getProgress();
        int fileCount = storage.listFiles(nullptr, 0);
        uint16_t freeMb = (uint16_t)storage.getFreeSpaceMBCached();
        float ax, ay, az;
        sensor.getLatestAccel(ax, ay, az);
        ble.sendStatus(state, power.getBatteryVoltage(), fileCount, freeMb,
                       storage.isReady(), sensor.isHealthy(), ax, ay, az, &sp);
      }

      if (!stillSyncing) {
        // Send final status with result before transitioning to idle
        SyncProgress sp = wifiManager.getProgress();
        int fileCount = storage.listFiles(nullptr, 0);
        uint16_t freeMb = (uint16_t)storage.getFreeSpaceMBCached();
        float ax2, ay2, az2;
        sensor.getLatestAccel(ax2, ay2, az2);
        ble.sendStatus(STATE_IDLE, power.getBatteryVoltage(), fileCount, freeMb,
                       storage.isReady(), sensor.isHealthy(), ax2, ay2, az2, &sp);

        setCpuFrequencyMhz(CPU_MHZ_NORMAL);
        state = STATE_IDLE;
        Serial.println("[MAIN] WiFi sync finished, CPU → 80MHz");
      }
      break;
    }
  }
}
