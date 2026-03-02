# VTX V2 Build Guide

## Overview

The VTX V2 is a compact cycling IMU data logger designed as a puck that stacks between a seatpost mount and a Garmin Varia radar (or any Garmin quarter-turn accessory). It records 100Hz accelerometer/gyroscope data to an SD card during rides, then syncs to phone/cloud via BLE/WiFi post-ride.

### V1 vs V2

| | V1 (Prototype) | V2 |
|---|---|---|
| **MCU** | Adafruit Feather ESP32 V2 | ESP32-S3 Mini |
| **IMU** | BNO055 (9-DOF, orientation fusion) | LSM6DS3 (6-DOF accel + gyro) |
| **Sample Rate** | 25Hz | 100Hz |
| **Data Transfer** | Real-time BLE streaming | SD card logging, post-ride sync |
| **Power** | Feather onboard charging | TP4057 external charge IC |
| **Tail Light** | NeoPixel Jewel 7 + 5V boost | None (stacks under existing light) |
| **Form Factor** | Box with Garmin male mount | Puck with male + female Garmin quarter-turn |

### Why the Changes

- **BNO055 → LSM6DS3**: The BNO055's onboard orientation fusion (euler angles, quaternions) is unused — all analysis runs server-side on raw accel/gyro. The LSM6DS3 is cheaper, lower power (~0.9mA vs ~12mA), has a native 104Hz ODR, and an 8KB FIFO buffer for batch reads.
- **BLE streaming → SD logging**: 100Hz BLE streaming is unreliable on a bike. Local SD recording is lossless and eliminates phone dependency during rides.
- **Feather → S3 Mini**: No NeoPixels means no 5V boost needed, so the Feather's onboard LiPo charger and large form factor aren't justified. The S3 Mini is ~60% smaller.
- **TP4057 for charging**: The S3 Mini has no onboard LiPo charging. The TP4057 provides USB-C charging with overcharge/overdischarge/overcurrent protection.

## Bill of Materials

| Component | Part | Interface | Purpose |
|---|---|---|---|
| MCU | Waveshare ESP32-S3 Mini | — | Processing, BLE/WiFi, SPI, I2C |
| IMU | JESSINIE LSM6DS3 breakout | I2C (0x6A) | 6-axis accel + gyro at 104Hz |
| Storage | Micro SD TF card module (SPI) | SPI | Local data logging |
| SD Card | KEXIN 8GB microSDHC | — | ~100+ hours of recording at 100Hz |
| Charge IC | TP4057 USB-C module (with protection) | — | LiPo charging + battery protection |
| Schottky Diode | 1N5817 (or similar, e.g. SS14) | Inline on TP4057 OUT+ | Prevents USB 5V backfeed into battery when charging |
| Resistor ×2 | 100KΩ (1/4W) | Voltage divider | Battery voltage sensing via ADC |
| Battery | 360mAh 4.2V LiPo | JST connector | ~3-4 hour runtime (estimate) |

### IMU Selection Notes

Two IMUs were evaluated:

- **LSM6DS3** (selected): Native 104Hz ODR, 8KB FIFO, ~0.9mA, SPI+I2C, 3.3V native
- **MPU-6050** (backup): 100Hz via divider, 1KB FIFO (overflows at 100Hz), ~3.9mA, I2C only

The LSM6DS3 wins on power, FIFO depth, and native ODR support.

## Wiring

### Power Path

```
USB-C → TP4057 (charge + protect) → LiPo 360mAh
                                   ↓
                              BAT+ (3.7-4.2V)
                                   ↓
                           Schottky diode (1N5817)
                          (cathode toward ESP32)
                                   ↓
                         ESP32-S3 Mini "5V" pin
                         (onboard 3.3V regulator)
                                   ↓
                              3V3 rail → LSM6DS3 VCC, SD module VCC
```

The TP4057 outputs battery voltage (3.7-4.2V). A **Schottky diode** (1N5817 or SS14) is placed inline on the OUT+ line between the TP4057 and ESP32 to prevent USB 5V from backfeeding into the battery through the ESP32's 5V pin when the TP4057 USB-C is plugged in for charging. The diode's forward voltage drop (~0.3V) is negligible — the ESP32-S3 Mini's onboard regulator accepts 3.4-3.9V on the `5V` pin and provides 3.3V to itself and peripherals via the `3V3` pin.

### Battery Voltage Sensing

A **100K/100K resistor voltage divider** taps BAT+ (before the Schottky diode) to read battery voltage via an ADC GPIO on the ESP32-S3.

```
BAT+ ──┬── 100KΩ ──┬── 100KΩ ── GND
       │           │
       │       ADC GPIO (GPIO4)
       │
       └── Schottky → ESP32 5V pin
```

The divider halves the battery voltage (3.7-4.2V → 1.85-2.1V), keeping it within the ESP32's 0-3.3V ADC range. The firmware reads this pin and multiplies by 2 to get the true battery voltage. See `BATTERY_ADC_PIN` and `BATTERY_VOLTAGE_DIVIDER` in `config.h`.

### Pin Assignments

| ESP32-S3 Mini Pin | Connection | Bus |
|---|---|---|
| 5V | TP4057 BAT+ | Power |
| GND | Common ground | Power |
| 3V3 | LSM6DS3 VCC, SD VCC | Power |
| GPIO1 | LSM6DS3 SCL | I2C |
| GPIO2 | LSM6DS3 SDA | I2C |
| GPIO3 | LSM6DS3 INT1 (optional) | IRQ |
| GPIO10 | SD SCK | SPI |
| GPIO11 | SD MOSI | SPI |
| GPIO12 | SD MISO | SPI |
| GPIO13 | SD CS | SPI |
| GPIO4 | Battery voltage divider (100K/100K from BAT+) | ADC |

### Wiring Diagram

```
                    ┌─────────────┐
  USB-C ───────────►│   TP4057    │
                    │  Charge IC  │
                    │             │
                    │ BAT+   OUT+ ├──────┬──────────────────────────────┐
                    │ BAT-   OUT- │      │                              │
                    └──┬──────────┘      │                              │
                       │                 │                              │
                    ┌──┴──┐              │                              │
                    │LiPo │         ┌────┴────┐                        │
                    │360mA│         │ 1N5817  │ Schottky diode         │
                    └─────┘         │ ◄──|──► │ (prevents USB 5V       │
                                    └────┬────┘  backfeed)             │
                                         │                              │
                              ┌──────────┴──────────┐                   │
                              │   ESP32-S3 Mini     │                   │
                              │                     │                   │
                              │  5V           GND   │───── GND ────────┤
                              │  3V3                │──┬────────────────┘
                              │                     │  │
                              │  GPIO1 (SCL) ───────│──┤
                              │  GPIO2 (SDA) ───────│──┤ I2C
                              │  GPIO3 (INT1) ──────│──┤
                              │                     │  │
                              │  GPIO4 (ADC) ───────│──┤ Battery sense
                              │                     │  │
                              │  GPIO10 (SCK) ──────│──┤
                              │  GPIO11 (MOSI) ─────│──┤ SPI
                              │  GPIO12 (MISO) ─────│──┤
                              │  GPIO13 (CS) ───────│──┘
                              └─────────────────────┘
                                    │  │  │             │  │
           ┌────────────────────────┘  │  │             │  │
           │         ┌─────────────────┘  │             │  │
           │         │                    │             │  │
    ┌──────┴───────┐ │  ┌─────────────┐   │  ┌─────────┴───────┐
    │  LSM6DS3     │ │  │ Voltage     │   │  │  SD Module      │
    │              │ │  │ Divider     │   │  │                 │
    │  VCC ── 3V3  │ │  │             │   │  │  VCC ── 3V3     │
    │  GND ── GND  │ │  │ BAT+──100K──┤   │  │  GND ── GND     │
    │  SCL ── GP1  │ │  │        ├──GP4   │  │  SCK ── GP10    │
    │  SDA ── GP2  │ │  │    100K──GND│   │  │  MOSI ── GP11   │
    │  INT1 ── GP3 │ │  └─────────────┘   │  │  MISO ── GP12   │
    └──────────────┘ │                    │  │  CS ── GP13     │
                     └────────────────────┘  └─────────────────┘
```

### USB Port Strategy

The build has two USB-C ports (TP4057 charging, ESP32-S3 programming). **Do not wire them together.**

- **Expose only the TP4057 USB-C** — this is the user-facing charge port
- **ESP32-S3 USB** — internal only, used for initial firmware flash during assembly
- **Firmware updates** — OTA via WiFi/BLE (required for sealed puck enclosure)
- Optionally expose debug pads internally for emergency reflash

## Form Factor

### Design: Stacked Puck

- **Profile**: Cylindrical, matching Garmin Varia diameter (~40mm)
- **Height**: Target <25mm (IMU section only)
- **Mount**: Male quarter-turn on bottom, female quarter-turn on top
- **Stack order**: Seatpost adapter → VTX puck → Varia radar/tail light
- **Weight**: Target <40g (no NeoPixels or boost converter)

Similar to a Ravemen headlight mount that stacks under a head unit — the VTX puck is invisible in the stack.

### Garmin Quarter-Turn Interface

**Male (bottom)**: Two opposing lugs, rotates 90° to lock into seatpost adapter.
**Female (top)**: Two opposing slots, accepts Varia or any Garmin accessory.

The pass-through design maintains full functionality of whatever mounts on top.

### Enclosure Requirements

- Weatherproof (IP65+), sealed USB port with rubber plug
- PETG or ASA 3D print (UV resistant, impact resistant)
- Single status LED (power/recording/error)
- Clear orientation marking for consistent IMU axis alignment
- Internal component layout: battery on bottom, PCB stack above, SD slot accessible (or internal with pogo-pin access)

### Mounting

Seatpost via standard Garmin mount adapter. Position 10-15cm below saddle clamp, forward marking aligned with direction of travel, quarter-turn clockwise to lock.

## Firmware Architecture (V2)

### Core Loop

1. Initialize LSM6DS3 at 104Hz ODR, configure 8KB FIFO
2. Open new log file on SD card (timestamped filename)
3. Batch-read FIFO at ~10Hz (pull ~10 samples per read)
4. Write binary samples to SD card
5. On ride end (button press or timeout): close file, enter sync mode

### Data Format

Each sample (binary, ~24 bytes):
- Timestamp (4 bytes, ms since boot)
- Accel X/Y/Z (6 bytes, int16 scaled)
- Gyro X/Y/Z (6 bytes, int16 scaled)
- Padding/checksum as needed

At 100Hz × 24 bytes = 2.4 KB/s = ~8.6 MB/hour. An 8GB card holds ~900+ hours.

### Post-Ride Sync

After recording stops, the device advertises via BLE (or connects to known WiFi).
The companion app or web client downloads the binary log file and uploads to cloud for processing through the existing VTX analysis pipeline.

### Power Budget (Estimated)

| Component | Active Current |
|---|---|
| ESP32-S3 (active, WiFi off) | ~40mA |
| LSM6DS3 (104Hz) | ~0.9mA |
| SD card (intermittent writes) | ~30mA peak, ~5mA avg |
| TP4057 quiescent | ~2μA |
| **Total (recording)** | **~46mA avg** |

With a 360mAh battery: ~7-8 hours theoretical, ~5-6 hours practical (accounting for SD write peaks and BLE overhead during sync).

## Development Setup

### Arduino CLI

```bash
brew install arduino-cli
arduino-cli core install esp32:esp32
arduino-cli lib install "SparkFun LSM6DS3 Breakout"
```

### Initial Flash (via ESP32-S3 USB)

```bash
arduino-cli compile --fqbn esp32:esp32:esp32s3:CDCOnBoot=cdc .
arduino-cli upload --fqbn esp32:esp32:esp32s3:CDCOnBoot=cdc --port /dev/cu.usbmodemXXXX .
```

After initial flash, all subsequent updates should be OTA.
