# Vertex

**End-to-end telemetry system for capturing physical riding dynamics — cornering Gs, braking deceleration, and road vibration — from custom ESP32 C++ firmware through a cloud analytics engine.**

![Version](https://img.shields.io/badge/firmware-v0.3.0-blue?style=flat-square)
![Format](https://img.shields.io/badge/VTX_format-v1.0-green?style=flat-square)

---

## Overview

Vertex is a full-stack telemetry platform built around a custom ESP32 IMU device. The system captures 6-DOF inertial data (accelerometer + gyroscope) at up to 104Hz, serializes it into a compact custom binary format (`.vtx`), stores it onboard or streams it via BLE, and uploads to a cloud pipeline that performs multi-pass digital signal processing and persists results to a time-series PostgreSQL schema.

The primary engineering challenge is **physical signal quality**: road vibration occupies 40–100Hz, IMU gyroscopes saturate under prolonged mechanical noise, and the magnetometer is unreliable near bike frames and vehicle infrastructure. Sensor mode selection, firmware filtering, and cloud-side DSP each address a different layer of this constraint.

The web frontend is a visualization mid-tier for DSP outputs. It does not define the system.

---

## System Architecture

### Embedded Hardware

Two hardware generations exist. Both output the same `.vtx` binary format.

**V1 — ESP32 + BNO055 (6DoF, legacy)**
The BNO055's magnetometer proved unusable in a cycling environment: ferromagnetic interference from the bike frame, passing vehicles, and road infrastructure corrupted heading data, forcing operation in 6DoF-only mode with yaw drift corrected in post-processing. V2 was built to address the 25Hz sample rate ceiling and the constraints of BLE streaming.

**V2 — ESP32-S3 Mini + LSM6DS3 (6DoF, current)**
Sensor: ST LSM6DS3 at native 104Hz ODR — `+/−8g` accelerometer, `+/−1000 dps` gyroscope, configured via direct register writes over I2C (400kHz). The FIFO is set to continuous mode with a 60-sample threshold, batched to the MCU every 100ms (~10 samples per read, decoupling SD write latency from sensor timing). Raw 16-bit register values are converted to physical units on-device using fixed sensitivity constants (`0.000244 × 9.80665 m/s²/LSB` for accel, `0.035 deg/s/LSB` for gyro), then mapped from chip axes to a standard body frame before being packed into 28-byte `IMURecord` structs and written to SD card over SPI (16MHz). No BLE data streaming — BLE is a control interface only (start/stop recording, clock sync, trigger upload). CPU runs at 80MHz during recording; scales to 240MHz for WiFi upload. Battery ADC on GPIO 4 through a 100K/100K divider tapping the TP4057 charger output before the Schottky isolation diode; 8-sample averaging with empirical calibration factor.

At 104Hz the road vibration band (40–100Hz) falls above Nyquist and aliases into the analysis band. The cloud-side DSP must account for this; the higher sample rate is worth the tradeoff because it captures genuine sub-52Hz dynamics — cornering, braking, pedaling — at substantially higher resolution than V1.

**V2 upload flow:** BLE `CMD_START_SYNC` triggers the device to connect to provisioned WiFi, query the server for files not yet uploaded (`WIFI_CHECK_EXISTING`), obtain a presigned Supabase Storage URL per file (`WIFI_PRESIGN`), PUT the `.vtx` file directly in 16KB streaming chunks (`WIFI_STREAMING`), then call the backend complete endpoint to create the DB record. WiFi credentials and user/API keys are provisioned over BLE and stored in ESP32 NVS.

---

### Data Serialization — `.vtx` Binary Protocol

The `.vtx` format is a custom binary container designed for constrained embedded environments. The design goals are: minimize per-sample memory overhead on device, eliminate serialization latency from ASCII conversion, and maximize battery life by reducing transmission time over BLE.

**File structure:**

```
┌──────────────────────────────────────┐
│       FILE HEADER  (64 bytes)        │
├──────────────────────────────────────┤
│   METADATA  (variable, JSON)         │
├──────────────────────────────────────┤
│   DATA RECORDS  (28 or 56 bytes ea)  │
│         ...                          │
├──────────────────────────────────────┤
│   FOOTER  (optional, 32 bytes)       │
└──────────────────────────────────────┘
```

**Header (64 bytes fixed):**

| Offset | Size | Type     | Field            |
|--------|------|----------|------------------|
| 0      | 4    | char[4]  | magic `"VTX\0"`  |
| 4      | 2    | uint16   | version_major    |
| 6      | 2    | uint16   | version_minor    |
| 8      | 4    | uint32   | metadata_length  |
| 12     | 4    | uint32   | data_offset      |
| 16     | 8    | uint64   | record_count     |
| 24     | 4    | float32  | sample_rate (Hz) |
| 28     | 8    | int64    | start_timestamp  |
| 36     | 8    | int64    | end_timestamp    |
| 44     | 1    | uint8    | record_format    |
| 45     | 1    | uint8    | compression      |

**Record format bitmask** (`record_format` field): bits 0–1 are always set (accel + gyro). Bit 2 = magnetometer (deprecated). Bit 3 = quaternion (optional). The bitmask determines per-record byte width, enabling the parser to seek directly to any sample index without a full file scan.

**Minimal record (28 bytes, accel + gyro only):**

| Offset | Size | Type    | Field        |
|--------|------|---------|--------------|
| 0      | 4    | uint32  | timestamp_ms (offset from start) |
| 4–15   | 12   | float32 | accel_x, accel_y, accel_z (m/s²) |
| 16–27  | 12   | float32 | gyro_x, gyro_y, gyro_z (rad/s)   |

**Size advantage vs. CSV (10-minute recording @ 10Hz, 6,000 samples):**

| Format          | Size    | Reduction |
|-----------------|---------|-----------|
| CSV             | ~780 KB | baseline  |
| VTX (full)      | ~336 KB | 57%       |
| VTX (minimal)   | ~168 KB | 78%       |

The metadata section is JSON (device ID, firmware version, mount position, calibration zero-point), keeping it human-readable for debugging while binary records carry all the hot-path data.

---

### Cloud Pipeline

`.vtx` files arrive via device WiFi upload (V2) or mobile app (V1), authenticated per-device with `X-Device-Key`. FIT files from a paired Garmin head unit are uploaded separately; `fit-vtx-sync.ts` aligns the two independent timelines so IMU-derived metrics can be correlated against GPS, power, cadence, and grade.

Inngest background jobs handle all heavy processing asynchronously: merging multi-segment `.vtx` files into a single blob per ride, running the IMU analysis pipeline, and parsing FIT binaries.

**IMU analysis pipeline — four metric streams, one pass over raw samples:**

The pipeline runs at native sample rate without pre-decimation. Decimating before the bandpass filter folds road vibration energy into the cadence band.

- **Braking pre-pass (zero-phase):** Forward-backward Butterworth on `accel_x/z` (5Hz, `filtfilt`). Pitch from filtered accel; forward-backward EMA baseline (0.2Hz). Braking = pitch deviation from baseline, correlated with `gyro_y`.
- **Pass 1 — per-sample:** BPF `gyro_x/z`, `accel_x` at 0.3–10.0Hz (stability). HPF `accel_z` at 1.0Hz (roughness). HPF `accel_y` at 1.0Hz (position).
- **Pass 2 — windowed RMS:** Stability and roughness: 3.0s window, 0.5s hop. Braking: 0.75s window, 0.2s hop.
- **Pass 3:** Interpolate to 5Hz output. Position detection: `accel_y` amplitude vs. `gyro_z` in 0.75s windows.

Stability weight: `gyro_roll × 0.5 + gyro_yaw × 0.3 + surge_accel × 0.2`, normalized 0–1. Coefficients were empirically derived by comparing weighted outputs against labeled ground-truth segments (controlled sprinting, seated climbing, technical descending) until the score correlated with perceived instability. Surface roughness: HPF `accel_z` RMS — smooth < 0.5g, rough > 1.0g.

**Schema:** Five PostgreSQL tables with RLS on all user data. `ride_analysis` stores one row per (ride, analysis_type) with a pointer to a gzipped JSON sample blob in object storage, keeping the relational schema flat regardless of sample count. `ride_summaries` holds denormalized aggregate metrics for dashboard queries.

---

## Engineering Logs

I document the physical and software challenges of building Vertex on Substack.

[**Read: Data without context is just high fidelity trivia**](https://lab.ridevertex.com/p/data-without-context-is-just-high) — Detailing the hardware limitations of GPS, the necessity of 6-DOF sensor fusion, and solving for high-frequency road vibration.

---

## Repository Structure

```
vertex/
├── firmware/
│   ├── imu_manager/          # V1 — ESP32 + BNO055, BLE streaming
│   └── imu_manager_v2/       # V2 — ESP32-S3 + LSM6DS3, SD + WiFi upload
├── packages/
│   ├── vtx-format/           # .vtx binary format specification (v1.0)
│   ├── vtx-parser/           # TypeScript encoder/decoder
│   └── vtx-constants/        # Shared format constants
├── app/                      # React Native companion app (BLE recording)
├── web/                      # Next.js web platform
│   ├── src/lib/analysis/     # IMU analysis pipeline
│   ├── src/lib/imu/          # Signal processing primitives
│   ├── src/lib/sync/         # FIT-VTX timestamp alignment
│   └── src/app/api/          # 38 API routes
├── analysis/                 # Python scripts, sample data
└── docs/                     # Format specs, compatibility matrix
```

---

## Quick Start

```bash
# Install all workspace dependencies
pnpm install

# Web platform
cd web && pnpm dev

# Firmware — see firmware/README_FIRMWARE.md for Arduino IDE setup and flash instructions

# Mobile app
cd app && pnpm start
```

---

## Technology Stack (abbreviated)

| Layer | Technology |
|---|---|
| Firmware | C++ (Arduino/ESP-IDF), BNO055 (V1) / LSM6DS3 (V2), ESP32 BLE + WiFi |
| Binary format | Custom `.vtx` (v1.0), TypeScript + Python parsers |
| Mobile | React Native, `react-native-ble-plx`, Zustand |
| API | Next.js 15 (App Router), TypeScript |
| Background jobs | Inngest (serverless, event-driven) |
| Database | PostgreSQL (Supabase), RLS enforced |
| Storage | Supabase Storage (S3-compatible) |
| Hosting | Vercel |
| Signal processing | Butterworth BPF/HPF, forward-backward filtfilt, EMA, FFT, LTTB downsampling |

---

**Live:** [ridevertex.com](https://ridevertex.com)
