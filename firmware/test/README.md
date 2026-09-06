# Host-compiled tests — Vertex V2 firmware

Unit tests for the pure logic in `firmware/imu_manager_v2/`: the code that
*produces* the `.vtx` format, which `packages/vtx-parser/` only tested from the
decode side. A wrong byte offset in the write path produces files that parse
into plausible-looking garbage, silently — these tests are the check on that.

No Arduino IDE, no ESP32 toolchain, no third-party test framework.

```
cd firmware/test
make test        # 44 unit tests
make crosscheck  # firmware-encoded bytes -> packages/vtx-parser decode
make all         # both
```

`make test` needs only a C++17 compiler. `make crosscheck` additionally needs
`python3`; if the parser package is not importable it prints SKIP rather than
failing, so `make all` stays useful on a bare checkout.

## How the extraction works

The pure logic lives in `firmware/imu_manager_v2/vtx_format.h`, included by
both the firmware and these tests. The managers call the same functions the
tests do; hardware calls (`SD.write`, `Wire.read`, `digitalRead`) stay at the
call site. Nothing was restructured beyond that — no classes changed shape and
no hardware was mocked.

Extracted: header serialization, header patching, metadata JSON, filename
generation, axis remap + scale conversion, and the button state machine.

Verified with `arduino-cli compile --fqbn esp32:esp32:esp32s3` before and
after: **1,323,315 → 1,323,323 bytes flash (+8), RAM unchanged**. The default
partition scheme overflows at 100% of a 1.31MB app partition both before and
after this change — a pre-existing configuration issue, unrelated to these
tests. Use `PartitionScheme=huge_app` (or `min_spiffs`) to build.

## What is covered

| Area | Tests | Notes |
|---|---|---|
| Header serialization | 11 | Every documented field: offset, width, type, little-endian order. Poisons the buffer first to prove the writer clears reserved bytes. |
| Header patching | 4 | `record_count` @16 and `end_timestamp` @36; asserts byte-for-byte that no other header byte moves. |
| `IMURecord` layout | 5 | 28 bytes, all seven field offsets, accel/gyro triple contiguity, and that `packed` is honored rather than incidental. |
| Axis remap & scaling | 7 | Known values both paths, negatives and `int16` extremes, chip→body mapping, determinant/orthonormality, accel-gyro consistency. |
| Button state machine | 9 | Short press, long-press-while-held, no double-fire, sub-debounce rejection, threshold boundaries, repeat presses. |
| Filename generation | 8 | Known timestamps, PST day boundaries either side of midnight, pre-clock-sync epoch, buffer-length safety. |

Plus a full **cross-validation**: `gen_vtx_fixture.cpp` writes a real `.vtx`
file using the firmware's own serialization code, and `crosscheck.py` decodes
it with the shipping `packages/vtx-parser` Python implementation and compares
every header field, the metadata JSON, all 64 IMU records field-for-field, and
the v1.2 clock-sync section. Neither side defines correctness alone.

## Deliberately not covered

- **I2C/SPI/BLE/WiFi/SD** — hardware-coupled and out of scope; mocking `Wire`,
  `SD`, or NimBLE would test the mocks.
- **`readFIFO()` register protocol** — the FIFO word-count decode and per-word
  read loop need a mocked I2C bus. Only the conversion arithmetic was extracted.
- **Upload state machine** (`wifi_manager.cpp`) — explicitly out of scope.
- **`writeSyncSection()` sequencing** — depends on live `File` seek/size
  behavior. Its *byte layout* is covered by the cross-check.

## Open questions — answers

### 1. Gyro units: the docs are wrong. Values are deg/s, not rad/s.

`GYRO_SCALE = 0.035` is the LSM6DS3 datasheet's **deg/s per LSB** at ±1000 dps.
No radian conversion exists anywhere in the chain — firmware, TS parser, or
Python parser (verified by searching for `pi`/`57.3`/`radians` across
`packages/`, `firmware/`, and `analysis/`; the only hits are in V1 BNO055 code
and display-only analysis scripts).

Confirmed empirically against two real recordings in
`analysis/data/sample-recordings/`:

| | accel | gyro |
|---|---|---|
| `3_24_2026_54119728.vtx` | mean magnitude **9.55 m/s²** | peak **66.4** |
| `6_14_2026_29348131.vtx` | mean magnitude **9.73 m/s²** | peak **63.9** |

Accel mean magnitude lands on gravity, so accel units are right. If the gyro
figures were rad/s they would be 3,800 deg/s — nearly 4× beyond the ±1000 dps
range the sensor is configured for, which is physically impossible. They are
deg/s.

**What's wrong is the labeling**, in three places: `README.md`'s record table,
the `rad/s` comments in `sensor_manager.h`/`sensor_manager.cpp`, and the
docstring in `analysis/scripts/load_vtx.py`.

**This matters downstream.** `analysis/check_gyro_saturation.py` prints these
values labeled `rad/s` and multiplies by `180/pi` to "convert to degrees" — they
are already degrees, so its degree figures come out 57.3× too large. (That
script targets V1 BNO055 hardware and its ±2000 dps saturation verdict is not
meaningful for V2 data regardless.) Any analysis-pipeline code that treats
these fields as rad/s carries the same factor-of-57.3 error; the V2 analysis
path was not audited as part of this work.

`gyro_units_are_degrees_per_second_not_radians` pins the actual behavior and is
tagged as a known defect. **Not fixed here**: correcting it means either editing
docs across three packages or changing the recorded units, which would
invalidate every existing recording and any tuned analysis coefficients. That is
a judgment call about the data, not a low-risk firmware fix.

### 2. `IMURecord` packing: enforced, not incidental.

`sensor_manager.h` carries `__attribute__((packed))` **and** a
`static_assert(sizeof(IMURecord) == 28)`, so it was already enforced. The
28-byte size would hold under natural alignment anyway (a `uint32` plus six
`float32`, all 4-byte aligned), which means a size assertion alone cannot tell
"packed" from "lucky". `imu_record_packing_is_enforced_not_incidental` closes
that gap by proving the attribute is honored by the compiler, and
`imu_record_field_offsets_match_spec` pins all seven offsets. No fix needed.

`ClockSyncRecord` is the same story and gets the same treatment — there the
offsets matter more, since without packing the `int64` members would force
8-byte alignment and `t2` would land at offset 8 only by coincidence.

### 3. Axis remap: a proper rotation. No handedness flip.

The mapping is body X = chip Z, body Y = chip X, body Z = chip Y — a cyclic
permutation. Its matrix is orthonormal with **determinant +1**, so it is
right-handed and preserves cross products and gyro signs.
`axis_remap_is_a_proper_rotation` derives the matrix by pushing unit vectors
through the real conversion and checks the determinant, rather than asserting
against a hand-copied matrix. No fix needed.

### 4. `getLatestAccel()` returns the oldest sample. Confirmed.

It reads `_buffer[0]`, the first sample of the last FIFO batch. With batches of
up to `MAX_FIFO_SAMPLES` (128) at 104 Hz, the value can be ~1.2 s stale; at the
typical ~10-sample batch it is ~100 ms stale. The newest sample is
`_buffer[count-1]`.

Only consumer is the BLE status payload (`ble_manager.cpp:168`,
`imu_manager_v2.ino:291,302`) — a live-orientation readout in the app. Harmless
in practice, but the name says something the function does not do.

**Not fixed**: `SensorManager` does not retain the batch count after
`readFIFO()` returns, so returning the newest sample means adding a member and
touching the FIFO path — more surgery than a display-only naming issue
justifies. Renaming to `getRecentAccel()`, or storing the last count, would both
be reasonable follow-ups.

## Other findings

**Stale comment corrected.** `imu_manager_v2.ino` documented the default clock
offset `1772349000000` as "2026-02-28 21:30:00 PST (2026-03-01 05:30:00 UTC)".
It is actually 07:10 UTC / 23:10 PST. Comment fixed; no behavior change. The
filename tests pin the real value.

**Pre-epoch filename.** If `wallClockMs()` returns 0, `vtxBuildFilename` shifts
8 h earlier and produces a 1969 filename with a negative `msInDay` intermediate.
It does not crash and stays a valid path, so it is pinned by
`filename_at_unix_epoch_zero` as a known defect rather than fixed. The
compiled-in default offset means this cannot occur in the shipping firmware.

## Toolchain note

This machine's Command Line Tools install has a
`usr/include/c++/v1` directory the compiler cannot read, so a plain
`clang++ -std=c++17` fails to find `<cstdint>` — for any file, unrelated to this
suite. The Makefile probes for that and falls back to the SDK's copy via
`xcrun --show-sdk-path`. A healthy toolchain adds no extra flags.
