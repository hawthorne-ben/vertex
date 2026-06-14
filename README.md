# Vertex

**End-to-end telemetry system for capturing physical riding dynamics — cornering Gs, braking deceleration, and road vibration — from custom ESP32 C++ firmware through a cloud analytics engine.**

![Version](https://img.shields.io/badge/firmware-v0.3.0-blue?style=flat-square)
![Format](https://img.shields.io/badge/VTX_format-v1.0-green?style=flat-square)

---

## Overview

Vertex is a full-stack telemetry platform built around a custom ESP32 IMU device. The system captures 6-DOF inertial data (accelerometer + gyroscope) at up to 50Hz, serializes it into a compact custom binary format (`.vtx`), transmits it via BLE to a mobile companion app, and streams it to a cloud pipeline that performs multi-pass digital signal processing and persists results to a time-series PostgreSQL schema.

The primary engineering challenge is **physical signal quality**: road vibration occupies 40–100Hz, BNO055 gyroscopes saturate under prolonged mechanical noise, and the magnetometer is unreliable near bike frames and vehicle infrastructure. Every layer of the stack — hardware isolation, sensor mode selection, firmware filtering, and cloud-side DSP — exists to solve these constraints.

The web frontend is a visualization mid-tier for DSP outputs. It does not define the system.

---

## System Architecture

### Embedded Hardware — ESP32 + BNO055

**Sensor:** Adafruit BNO055 9-DOF IMU, connected via I2C.

**Operating mode:** `OPERATION_MODE_IMUPLUS` (6DoF — accelerometer + gyroscope only). The magnetometer is explicitly disabled. Bike frames, passing vehicles, and road infrastructure produce enough ferromagnetic interference to corrupt magnetometer readings. Yaw drift from omitting magnetometer correction is acceptable at cycling timescales and is corrected in post-processing using GPS velocity heading from paired FIT files.

**Sampling:** Default 25Hz (40ms interval, `DEFAULT_SAMPLE_INTERVAL_MS`). Configurable 20–1000ms via BLE command. The 25Hz default is not arbitrary — it sits below the Nyquist frequency for the 40–100Hz mechanical road noise band, avoiding aliasing of vibration energy into the cadence band (1.5–3.5Hz) and the stability analysis band (0.3–10Hz).

**I2C clock:** Switched dynamically between 100kHz (low-power mode) and 400kHz (normal/high-performance mode) based on the active power profile commanded over BLE.

**Physical vibration isolation:** The sensor must be mechanically decoupled from the bike frame. Road vibration in the 40–100Hz range is energetic enough to saturate gyroscope registers and produce railing artifacts in orientation output. Sorbothane elastomer mounting is used for vibration damping. Without physical isolation, software-only filtering cannot recover clean signal from a clipped sensor output.

**Brake detection (on-device):** A forward-backward Butterworth filter on `accel_x` (linear, gravity-compensated) is applied on-device for real-time brake light actuation. Threshold: 3.0 m/s² (~0.3g) with 250ms debounce — approximately 6–7 samples at 25Hz. This is a simplified version of the full braking pipeline run cloud-side.

**Battery management:** ADC on GPIO 35 through a 2:1 voltage divider, read at 1Hz. Auto-shutdown at 3.2V. I2C clock is throttled in low-power mode to reduce draw.

**BLE data packet (47 bytes per notification):**

```
Offset  Size  Type     Field
0       4     uint32   timestamp_ms
4-15    12    float32  roll, pitch, yaw (Euler, degrees)
16-27   12    float32  accel_x, accel_y, accel_z (m/s²)
28-39   12    float32  gyro_x, gyro_y, gyro_z (rad/s)
40-42   3     uint8    cal_sys, cal_gyro, cal_accel (BNO055 calibration status, 0–3)
43-46   4     float32  battery_voltage
```

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

**Ingestion:** The mobile app POSTs `.vtx` files to `/api/upload/device` authenticated with a per-device `X-Device-Key` header and user ID. For rides where a Garmin head unit was also running, a FIT file is uploaded separately and parsed for GPS coordinates, power, cadence, and heart rate.

**Timestamp alignment:** VTX and FIT timelines are independent. `lib/sync/fit-vtx-sync.ts` performs cross-stream temporal alignment, enabling the analysis pipeline to correlate IMU-derived metrics (e.g., pedaling stability) with FIT-derived metrics (e.g., power, grade) at a common timestamp axis.

**Event-driven background processing (Inngest):**
- `merge-vtx-recordings` — concatenates multiple `.vtx` segments from a ride into a single binary blob for unified analysis
- `analyze-ride-imu` — runs the full multi-pass IMU analysis pipeline
- `parse-fit` — extracts structured data from FIT binary, stores to DB

**IMU analysis pipeline — four metric streams from one pass:**

The pipeline operates on raw VTX samples at their native rate (up to 104Hz where available). It does not pre-decimate before filtering, because decimation before the bandpass filter aliases road vibration energy into the cadence band.

*Pass 1 — per-sample filtering:*
- Bandpass filter gyro_x, gyro_z, accel_x at 0.3–10.0Hz (stability)
- High-pass filter accel_z at 1.0Hz (surface roughness)
- High-pass filter accel_y at 1.0Hz (riding position)

*Braking pre-pass (zero-phase, whole-array):*
- Forward-backward Butterworth on accel_x and accel_z (5Hz cutoff, zero phase lag via `filtfilt`)
- Pitch computed from filtered accel: `pitch = atan2(accel_x, accel_z)`
- Forward-backward EMA on pitch for lag-free grade baseline (0.2Hz cutoff)
- Braking deceleration = pitch deviation from baseline, correlated with gyro_y

*Pass 2 — windowed RMS:*
- Stability: 3.0s window, 0.5s hop → 2Hz intermediate output
- Braking: 0.75s window, 0.2s hop
- Roughness: 3.0s window, 0.5s hop

*Pass 3:*
- Interpolate all metrics to 5Hz output
- Standing/seated position detection: `accel_y` amplitude (lateral) vs. `gyro_z` (yaw rate) in 0.75s windows

**Stability metric weights:**
```
stability = gyro_roll_rms × 0.5 + gyro_yaw_rms × 0.3 + surge_accel_rms × 0.2
```
Normalized 0–1. Stable threshold: 0.15. Unstable threshold: 0.35.

**Surface roughness:** HPF `accel_z` RMS over 3s windows. Smooth: < 0.5g RMS. Rough: > 1.0g RMS.

**PostgreSQL time-series schema:** Five core tables with Row Level Security on all user data.

- `recordings` — file metadata, `data_ranges BIGINT[][]` for gap tracking, `gap_info JSONB` with discontinuity statistics
- `rides` — ride groupings with merged `.vtx` path
- `ride_recordings` — junction table
- `ride_analysis` — one row per (ride, analysis_type), stores algorithm version, parameters, and a path to gzipped JSON sample blobs in Supabase Storage
- `ride_summaries` — denormalized flat metrics for dashboard queries (avoids aggregation on large sample tables)

Analysis sample blobs are stored as gzipped JSON in object storage rather than as individual DB rows. This keeps the relational schema from growing to hundreds of millions of rows and allows arbitrary output sample rates without schema changes.

---

## Engineering Logs

I document the physical and software challenges of building Vertex on Substack.

[**Read: Data Without Context is Just High Numbers**](https://lab.ridevertex.com/p/data-without-context-is-just-high) — Detailing the hardware limitations of GPS, the necessity of 6-DOF sensor fusion, and solving for high-frequency road vibration.

---

## Repository Structure

```
vertex/
├── firmware/imu_manager/     # ESP32 C++ — BNO055, BLE, power management
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
| Firmware | C++ (Arduino/ESP-IDF), Adafruit BNO055, ESP32 BLE |
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
