# Vertex IMU Manager V2

ESP32-S3 Mini firmware for the VTX V2 puck. Records 104Hz IMU data to SD card in VTX binary format, syncs to phone via BLE after the ride.

## Hardware

- **MCU**: Waveshare ESP32-S3-Zero (2.4GHz WiFi + BLE 5, USB-C)
- **IMU**: LSM6DS3 6-axis (I2C, addr 0x6B — SA0 floating high on JESSINIE breakout)
- **Storage**: Micro SD module (SPI)
- **Charging**: TP4057 USB-C (LiPo charge + protection)
- **Battery**: 360mAh 3.7V LiPo
- **LED**: Onboard WS2812 NeoPixel on GPIO21

See [BUILD.md](../../docs/development/BUILD.md) for wiring diagram and BOM.

### Buttons

- **BOOT** (GPIO0): User button. Short press toggles recording start/stop. Active low with internal pullup.
- **RESET**: Hard reset. Not software-controlled — directly resets the chip.

Recording can also be started/stopped via BLE commands from the phone app.

### LED States

| State | Color | Pattern |
|-------|-------|---------|
| IDLE | Blue | Slow breathe (2s sine wave) |
| RECORDING | Red | Solid |
| SYNCING | Green | Fast blink (5Hz) |

Uses `rgbLedWriteOrdered()` with `LED_COLOR_ORDER_RGB` — the ESP32-S3-Zero's WS2812 uses RGB wire order, not the typical GRB.

## Architecture

```
imu_manager_v2/
├── imu_manager_v2.ino   # Main sketch — state machine, button, clock
├── config.h             # All constants, pins, VTX format, device state enum
├── sensor_manager.*     # LSM6DS3 init, register polling, unit conversion
├── storage_manager.*    # SD card VTX binary file I/O with header patching
├── ble_manager.*        # BLE commands, status, clock sync, file transfer
├── power_manager.*      # Battery, NeoPixel LED, shutdown
└── README.md
```

### State Machine

```
         ┌──────────────────────────────────────────┐
         │                                          │
         ▼                                          │
      ┌──────┐  button / BLE  ┌───────────┐        │
      │ IDLE │───────────────►│ RECORDING │        │
      │      │◄───────────────│           │        │
      └──┬───┘  button / BLE  └───────────┘        │
         │                                          │
         │ CMD_REQUEST_FILE                         │
         ▼                                          │
      ┌──────────┐  transfer complete               │
      │ SYNCING  │──────────────────────────────────┘
      └──────────┘
```

- **IDLE**: BLE advertising, waiting for commands or button press. Blue breathe LED.
- **RECORDING**: LSM6DS3 polled every loop iteration, binary write to SD. Solid red LED.
- **SYNCING**: Chunked file transfer over BLE. Fast green blink LED.

## Quick Start

### Dependencies

```bash
arduino-cli core install esp32:esp32
```

No external libraries required. LSM6DS3 is driven via raw I2C register access. NeoPixel uses the ESP32 core's built-in `rgbLedWriteOrdered()`. SD and BLE are included with the ESP32 Arduino core.

### Compile

The **generic ESP32-S3 board definition** must be used (not the Waveshare-specific one, which has linker issues when CDC is enabled). Two critical flags:

- `CDCOnBoot=cdc` — enables Serial output over USB (without this, no serial output at all)
- `USBMode=hwcdc` — uses hardware USB-Serial/JTAG (the ESP32-S3-Zero's native USB)

```bash
arduino-cli compile \
  --fqbn esp32:esp32:esp32s3:CDCOnBoot=cdc,USBMode=hwcdc \
  .
```

### Flash

The device appears as `/dev/cu.usbmodem1101` (may vary). Close any serial monitors before flashing — the port will be busy otherwise.

```bash
arduino-cli upload \
  --fqbn esp32:esp32:esp32s3:CDCOnBoot=cdc,USBMode=hwcdc \
  --port /dev/cu.usbmodem1101 \
  .
```

### Serial Monitor

Baud rate is 115200. Use Arduino IDE serial monitor or:

```bash
arduino-cli monitor --port /dev/cu.usbmodem1101 --config baudrate=115200
```

### Expected Boot Output

```
========================================
  Vertex IMU V2 - v2.0.0
========================================

[PWR] Power manager ready (NeoPixel on GPIO21)
[IMU] Initializing LSM6DS3...
[IMU] LSM6DS3 detected
[IMU] CTRL1_XL=0x4C CTRL2_G=0x48 CTRL3_C=0x44
[IMU] Configured: 104Hz, +/-8g, +/-1000dps
[SD] Initializing...
[SD] Ready — 7664MB total, 7664MB free
[BLE] Initializing...
[BLE] Advertising as 'Vertex-V2'
[READY] Idle — press BOOT button or send BLE command to record
```

If IMU shows `WHO_AM_I mismatch: got 0xFF` on first boot, it's a cold-start I2C issue (marginal solder joint). The firmware retries 3 times automatically. Reflowing the SDA/SCL joints fixes it permanently.

## Known Issues

- **I2C cold-start flakiness**: The LSM6DS3 occasionally fails WHO_AM_I on first power-up. Firmware retries 3x with 50ms delays. Usually succeeds on attempt 2. Caused by marginal solder joints on SDA (GPIO2) / SCL (GPIO1).
- **Waveshare board def + CDC**: The `waveshare_esp32_s3_zero` board definition produces linker errors (`cannot find -lm, -lstdc++, -lgcc`) when `CDCOnBoot=cdc` is set. Use the generic `esp32s3` board def instead — works fine.

## VTX File Format

Files are written in the VTX binary format defined by `packages/vtx-parser`. Files recorded on-device are byte-compatible with the existing analysis pipeline — no conversion needed.

### File Layout

```
[64-byte header] [JSON metadata] [IMU records...]
```

### Header (64 bytes, little-endian)

| Offset | Size | Type | Field | Value |
|--------|------|------|-------|-------|
| 0 | 4 | string | Magic | "VTX\0" |
| 4 | 2 | uint16 | Version Major | 1 |
| 6 | 2 | uint16 | Version Minor | 1 |
| 8 | 4 | uint32 | Metadata Length | (JSON byte length) |
| 12 | 4 | uint32 | Data Offset | 64 + metadata length |
| 16 | 8 | uint64 | Record Count | (patched on close) |
| 24 | 4 | float32 | Sample Rate | 104.0 |
| 28 | 8 | int64 | Start Timestamp | Unix ms |
| 36 | 8 | int64 | End Timestamp | (patched on close) |
| 44 | 1 | uint8 | Record Format | 0x03 (HAS_ACCEL \| HAS_GYRO) |
| 45 | 1 | uint8 | Compression | 0 (none) |
| 46 | 8 | uint64 | GPS Record Count | 0 |
| 54 | 4 | uint32 | GPS Data Offset | 0 |
| 58 | 6 | — | Reserved | zeros |

### Metadata (JSON)

```json
{
  "device": {
    "name": "Vertex-V2",
    "firmwareVersion": "2.0.0",
    "hardwareRevision": "v2"
  },
  "session": {
    "position": "Seatpost"
  }
}
```

### IMU Records (28 bytes each, little-endian)

| Offset | Size | Type | Field | Units |
|--------|------|------|-------|-------|
| 0 | 4 | uint32 | timestamp_ms | ms offset from startTimestamp |
| 4 | 4 | float32 | accel_x | m/s² |
| 8 | 4 | float32 | accel_y | m/s² |
| 12 | 4 | float32 | accel_z | m/s² |
| 16 | 4 | float32 | gyro_x | rad/s |
| 20 | 4 | float32 | gyro_y | rad/s |
| 24 | 4 | float32 | gyro_z | rad/s |

### Data Volume

At 104Hz × 28 bytes = 2.9 KB/s = ~10.4 MB/hour. An 8GB card holds ~750+ hours.

## Clock Sync

The device has no RTC. A default epoch offset (~2026-03-01) is compiled in so files always have reasonable timestamps. The phone overrides this with the real time via `CMD_SYNC_CLOCK` after BLE connection.

**How it works:**
1. Phone connects via BLE
2. Phone sends `CMD_SYNC_CLOCK` with its current unix timestamp (int64 ms)
3. Device computes `_clockOffsetMs = phoneTime - millis()`
4. `wallClockMs() = millis() + _clockOffsetMs` gives unix ms at any point
5. This offset persists until power cycle (stored in RAM, not NVS)

**Drift:** ~10-50 ppm (1-5 seconds over a 5-hour ride). Inter-sample timing is driven by the LSM6DS3's internal clock. Wall clock drift only affects absolute start/end timestamps.

## BLE Protocol

Same service UUID as V1 for app discovery compatibility.

| Characteristic | UUID suffix | Properties | Purpose |
|---|---|---|---|
| Status | ...def1 | READ, NOTIFY | Device state, battery, file count |
| Config | ...def2 | WRITE | Commands |
| File List | ...def3 | READ, NOTIFY | File listing response |
| File Data | ...def4 | NOTIFY | Chunked file transfer |

### Commands (write to Config characteristic)

| Byte 0 | Command | Payload | Response |
|---|---|---|---|
| 0x01 | GET_STATUS | — | Status notify |
| 0x02 | START_RECORDING | — | Status notify (state=RECORDING) |
| 0x03 | STOP_RECORDING | — | Status notify (state=IDLE) |
| 0x04 | LIST_FILES | — | File List notify |
| 0x05 | REQUEST_FILE | filename (string) | File Data notify stream |
| 0x06 | DELETE_FILE | filename (string) | Status notify |
| 0x07 | SET_CONFIG | key + value | — |
| 0x09 | SYNC_CLOCK | int64 unix ms (8 bytes, LE) | — |
| 0x0A | RESET | — | Device restarts |

### Status Packet (8 bytes)

| Offset | Size | Type | Field |
|--------|------|------|-------|
| 0 | 1 | uint8 | state (0=IDLE, 1=RECORDING, 2=SYNCING) |
| 1 | 2 | uint16 | battery_mv |
| 3 | 2 | uint16 | file_count |
| 5 | 2 | uint16 | free_mb |
| 7 | 1 | uint8 | clock_synced (0/1) |

### File Transfer Protocol

1. Phone writes `CMD_REQUEST_FILE` + filename to Config characteristic
2. Device sends header packet: `[0xFF marker] [file_size: 4 bytes]`
3. Device sends data chunks: `[0x00 marker] [seq: 2 bytes] [data: up to 509 bytes]`
4. Device sends EOF: `[0x01 marker] [total_chunks: 2 bytes]`
5. Phone reconstructs file from sequential chunks

No ACK needed — BLE GATT notifications are reliable (link-layer retransmit). If connection drops mid-transfer, phone re-requests the file.

## Implementation Status

### Working

- [x] LSM6DS3 direct register polling at 104Hz (WHO_AM_I with 3x retry)
- [x] Raw int16 → float32 conversion (m/s², rad/s) with verified scale factors
- [x] SD card VTX binary writing (header + metadata + records + header patching on close)
- [x] BOOT button start/stop recording
- [x] NeoPixel LED states (blue breathe / red solid / green blink)
- [x] BLE advertising, connect/disconnect, command dispatch
- [x] Clock sync (CMD_SYNC_CLOCK) with default epoch fallback
- [x] BLE status notifications (GET_STATUS packed 8-byte format)
- [x] BLE file listing (CMD_LIST_FILES with serialized response)
- [x] BLE chunked file transfer (CMD_REQUEST_FILE → 512-byte chunks → EOF)
- [x] BLE file deletion (CMD_DELETE_FILE)
- [x] BLE device reset (CMD_RESET)
- [x] VTX files validated end-to-end: device → SD card → web app upload → chart display

### TODO

- [ ] **FIFO batch reads**: Currently polling one sample per loop iteration. Should configure LSM6DS3 FIFO (watermark threshold, continuous mode) and burst-read batches of ~10 samples. This reduces I2C overhead and prevents sample drops if the loop stalls.
- [ ] **Battery ADC**: Requires soldering a 100K/100K voltage divider from BAT+ to an ADC GPIO. Set `BATTERY_ADC_PIN` in config.h, implement `getBatteryVoltage()` in power_manager.
- [ ] **App-side BLE client**: Update companion app to discover V2, send commands, receive file transfers, upload to cloud.
- [ ] **File transfer validation**: Test full BLE transfer of a real recording and verify byte-for-byte match with SD card file.
- [ ] **OTA firmware updates**: ESP32 OTA partition scheme, triggered via BLE command.
- [ ] **Idle timeout**: Auto-stop recording after `IDLE_TIMEOUT_MS` (5 min) of no new data (safety net for forgotten recordings).
- [ ] **NVS config storage**: Persist user settings (sample rate, accel range) across reboots.
- [ ] **Graceful shutdown**: Long-press BOOT button for shutdown, battery low warning via LED color change.
