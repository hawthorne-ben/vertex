# V2 Firmware — On-Device Validation Plan

**Created:** 2026-09-06
**Status:** run 2026-09-06 — see Session Summary at the bottom

## Why this exists

Recent firmware changes were written and reasoned about but **never compiled
for the target, let alone flashed**. The host test suite
(`firmware/test/`, 44 tests) covers pure logic only — byte packing, the button
state machine, axis remap, filename generation. Everything that touches
hardware is unverified.

Separately, several fault-tolerance behaviours have always been *designed but
not tested*. Header patching against power loss is the important one: it is the
mechanism that makes a truncated recording recoverable, and nobody has ever
pulled the plug to find out whether it works.

This plan covers both. Sections are ordered so a failure early stops you
before wasting time downstream.

---

## Equipment

- V2 device, charged
- SD card (plus a second, nearly-full card for §C4 if convenient)
- USB-C cable and a serial monitor at 115200
- Phone with the companion app
- A way to cut power abruptly — pulling the battery JST is cleanest;
  a long press is *not* a substitute, it exercises the graceful path

## Conventions

Each check lists **Do**, **Expect**, and **If it fails**. Record the actual
result — a plan with no recorded outcomes is indistinguishable from one never
run. Fill in the results table at the bottom as you go.

---

## §A — Prerequisite

### A1. Compile for ESP32-S3

**Do:** build `firmware/imu_manager_v2/` in the Arduino IDE (board: ESP32S3
Dev Module, partition scheme `huge_app`). Do not flash yet.

**Expect:** clean compile.

**Why this is first:** the following are all uncompiled as of this document —
`STATE_FAULT` added to `DeviceState` and switched on in `loop()`;
`ButtonEvent` enum replacing `int` returns; `PowerManager::updateFaultLED()`;
new `StorageManager` members (`getFreeSpaceMBCached`,
`getRemainingSecondsCached`, `isSpaceLow`, `isSpaceCritical`,
`hasSpaceToStart`) plus a `private:`/`public:` section split in the header;
`shutdownWith()` in the sketch. Any of these could fail to build.

**If it fails:** fix and re-run before touching anything else. Likely
candidates are the header access-specifier split and the switch over
`DeviceState` now warning on unhandled cases.

**Actual result (2026-09-06):** compiled clean on the first attempt via
`arduino-cli` — neither suspect materialised. The `private:`/`public:` split in
`storage_manager.h` is well-formed and the `loop()` switch handles
`STATE_FAULT` explicitly, so no unhandled-case warning. A `--clean --warnings
all` rebuild produced five warnings, all in files git reports as unmodified
(2× `-Waddress-of-packed-member` at `sensor_manager.cpp:125`, 3× `BLE2902`
deprecation in `ble_manager.cpp`). Pre-existing, not introduced by this work.

**Trap worth recording:** the first build used
`--fqbn esp32:esp32:esp32s3:PartitionScheme=huge_app`, omitting `CDCOnBoot=cdc`
and `USBMode=hwcdc`. That combination compiles and links cleanly but produces a
binary with **no serial output at all** — indistinguishable at the bench from a
dead board, and it would have sent A2 chasing a phantom fault. Always use the
full FQBN from `firmware/imu_manager_v2/README.md`:
`esp32:esp32:esp32s3:CDCOnBoot=cdc,USBMode=hwcdc,PartitionScheme=huge_app`.

### A2. Flash and boot healthy

**Do:** flash with SD card inserted and IMU connected. Watch serial.

**Expect:** `[READY] Idle`, LED at the idle cadence, no `[FAULT]` lines.

**If it fails:** stop. Everything below assumes a good baseline.

---

## §B — New behaviour (written 2026-09-06, never run)

> **Hardware constraint discovered 2026-09-06 — §B is not runnable on this unit.**
>
> Both critical subsystems are permanently attached on the V2 production build:
> the **SD card is glued in** (deliberate, to stop it dislodging under
> high-vibration rides) and the **IMU is soldered** into the enclosure wiring.
> Nothing is separable except the battery. Every §B check requires a subsystem
> to fail at `init()`, so none of them can be injected here.
>
> **This is a limitation of the test article, not a finding about the firmware.**
> The fault-handling code is unverified on hardware — it should be described
> that way, and not as "tested".
>
> **What a rebuild would and would not buy.** A fresh bench unit (~1–2 h: new
> chips across all four boards, new battery) would make §B runnable, but it
> would validate *that* device's fault handling, not this one — and a
> hand-wired unit is more likely to surface a wiring fault than a firmware
> fault. Deferred in favour of §C, four of whose five checks run on this unit
> today with no rewiring.
>
> **Field history, for honesty about what is actually known:** no loose-solder
> failure, no mid-ride death, and no SD-full event has ever occurred on this
> device. The durability path was planned but never executed. The failure modes
> in §B are therefore untested *and* unobserved — argued from code review only.

### B1. Boot with no SD card

**Do:** power off, remove the SD card, power on.

**Expect:** serial `[FAULT] SD init failed — check card/wiring`; LED **red**,
blinking ~150 ms; `[FAULT] Recording disabled` banner.

**If it fails:** check `state = STATE_FAULT` is reached in `setup()` and that
`STATE_FAULT` is handled in the `loop()` switch.

**Not runnable as written (2026-09-06):** the SD card is **glued in** on this
unit, deliberately, to stop it dislodging under high-vibration rides. The card
cannot be removed without mechanical work.

**Substituted by B4.** Reading `imu_manager_v2.ino:216-219`, both causes enter
the *same* state through the same branch — `if (!sensorOk || !sdOk) { ...;
state = STATE_FAULT; }` — and everything downstream (red LED via
`updateFaultLED()`, button/BLE refusal switching on `state`, the 5 s retry
loop, the BLE state broadcast) is common to both. The only SD-specific
behaviour is which `[FAULT]` line prints. Disconnecting the IMU therefore
exercises B1, B2, B3, B5 and B7 identically; only the literal string
`[FAULT] SD init failed — check card/wiring` and `storage.init()`'s own
false-return go unverified.

**Cheaper route if the SD-specific path is ever needed:** do not wire a second
card. Lift or pull up `SD_CS_PIN` (GPIO 13, `config.h:69`) — `SD.begin()` fails
without CS asserting, no card removal required. Judged low ROI here: it
validates one `printf` and one library return value, against the risk that a
20 MHz SPI breakout on flying leads fails for wiring reasons and produces an
ambiguous result.

### B2. Fault recovery without reset

**Do:** with the device in fault from B1, insert the SD card. Wait 10 s.

**Expect:** within ~5 s, `[FAULT] Cleared — subsystems healthy, returning to
idle`; LED returns to the idle cadence; recording now starts normally.

**Why it matters:** the retry loop re-probes every 5 s. If this does not work
the fault state is a dead end requiring a power cycle.

### B3. Button refused in fault

**Do:** return to fault (remove card, reboot). Short-press the button. Also
try Start Recording from the app.

**Expect:** serial `[FAULT] Recording unavailable — IMU or SD card failed`. **No
file is created.** In the app, the button reads "Device Fault" and is disabled;
if pressed anyway, an error toast, not a success one.

**This is the bug being fixed:** previously a dead IMU let a recording start,
blink the recording LED for hours, and produce a valid `.vtx` with zero
records.

### B4. Boot with the IMU disconnected

**Do:** power off, disconnect the IMU (SDA or power), power on with the SD
card in.

**Expect:** three `WHO_AM_I` retries logged, then
`[FAULT] IMU init failed`, red LED, recording refused.

**If it fails:** verify `sensor.init()` returns false — the retry loop may be
succeeding against a floating bus.

### B5. Long press from fault

**Do:** in fault, long-press the button.

**Expect:** `[PWR] Long press — shutting down`, clean shutdown.

**Why it matters:** powering off must never depend on the device being
healthy. Easy to break when adding a state.

### B6. Space refusal

**Do:** temporarily set `SD_MIN_START_MB` in `config.h` above the card's
actual free space. Reflash. Try to record from button and from app.

**Expect:** `[REC] Refused — N MB free, need M MB (~T min of recording left)`.
App shows "Not enough space to start (N MB free)" as an **error** toast, not a
success one. **Restore `SD_MIN_START_MB` afterwards.**

**Why:** this also validates the app fix — previously the toast said
"Recording started" whenever the BLE write landed, regardless of what the
device did.

### B7. LED state transitions

**Do:** cycle fault → idle → recording → idle.

**Expect:** correct colour and cadence at each step, no stuck or wrong-colour
states.

**Why:** `updateFaultLED()` shares `_lastLEDUpdate` and `_animStep` with
`updateLED()`. Interleaving could leave the LED mid-animation.

### B8. Happy path still works

**Do:** a normal 10-minute recording, then upload.

**Expect:** file records, closes, uploads, and parses (`analysis/` loader or
`packages/vtx-parser`).

**Do not skip.** This is the most likely thing to have regressed and the
easiest to forget.

---

## §C — Long-standing gaps (designed, never tested)

### C1. Power cut mid-recording ★ highest value

**Do:** start recording. After ~2 minutes, **cut power abruptly** (pull the
battery JST — not a long press, which exercises the graceful path). Repeat 3×,
varying how long after the last header patch you cut. Recover each file.

**Expect:** every file parses. `record_count` matches the actual record count
in the file, or under-reports by at most one patch interval
(~1040 records ≈ 10 s). Nothing is corrupt or unparseable.

**Verify with:**
```
cd analysis && ../venv-analysis/bin/python -c "
import sys; sys.path.insert(0,'../packages/vtx-parser/python')
from vtx_parser import decode_vtx
v = decode_vtx(open('PATH.vtx','rb').read())
print('header count:', v.header.record_count, ' actual:', len(v.records))
"
```

**Why it matters most:** this is the mechanism the whole crash-tolerance story
rests on, and it is currently reasoned rather than measured. A pass turns the
weakest row in the validation table into a result.

**Known sub-risk:** a cut *during* `patchHeader()` itself — two seeks, two
8-byte writes — could leave an inconsistent header. Low probability, unexamined
consequence. If one of the three files is odd, this is the first suspect.

**Unplanned trial 0 (2026-09-06):** the first recording of the session was
terminated by an accidental **reset** rather than a stop —
`/vtx/2_28_2026_83403228.vtx`. This is an ungraceful termination: `closeFile()`
never runs, so the file's `record_count` is whatever the last `patchHeader()`
wrote. It exercises the same header-patch recovery path as a power cut, but is
**not** a full substitute — a reset keeps the SD card powered and lets in-flight
FS writes complete, where a battery pull does not. Treat it as a weaker
lower bound on the same mechanism.

Paired baseline from the same session: `/vtx/2_28_2026_83407471.vtx`, stopped
cleanly, `[SD] Closed — 10134 records, 0 sync, 277KB`.

**Concrete prediction to test.** The patch fires on
`_recordCount % (IMU_ODR_HZ * 10) == 0`, i.e. every 1040 records
(`storage_manager.cpp:94`). 10134 = 9×1040 + 774, so the clean file's last
periodic patch wrote 9360 and `closeFile()` corrected it to 10134. The reset
file's header count should therefore land on a **multiple of 1040**, with the
records after it present in the file body but uncounted.

**Latent risk noticed while reading this (not yet observed).** The trigger is an
exact-equality modulo on a counter advanced by a *variable* batch size
(`_recordCount += count`). If a batch straddles the boundary — 1039 → 1041 —
the condition never fires and that patch interval is skipped, doubling the
worst-case loss to ~20 s. The README records that FIFO reads are normally 1
sample but reach 25 when the loop stalls, so this is reachable. Would show up
as a header count that is *not* a multiple of 1040 on an unclean file, or a
gap larger than one interval.

### C1 measured result (2026-09-06)

Three files recovered from the device (uploaded via the app, downloaded to
`analysis/data/sample-recordings/recordings-2026-09-06 (1)/`). Identity
confirmed arithmetically: the filename suffix is the last 8 digits of
`start_timestamp` (`1772349000947` → `83400947`).

| File | Termination | Duration | Header count | Actual records | Delta | count % 1040 |
|---|---|---|---|---|---|---|
| `2_28_2026_83400947.vtx` | clean (inferred) | 40.7 s | 4,192 | 4,192 | **0** | 32 |
| `2_28_2026_83403228.vtx` | **reset mid-recording** | 181.9 s | 18,720 | 18,720 | **0** | **0** |
| `2_28_2026_83407471.vtx` | clean stop | 98.5 s | 10,134 | 10,134 | **0** | 774 |

**All three parse. `record_count` matches the actual record count exactly in
every case — zero discrepancy, not merely within the one-interval tolerance.**

**The reset file is the result that matters.** It was terminated ungracefully,
so `closeFile()` never ran and the header is entirely the work of the last
periodic `patchHeader()`. Its count is an exact multiple of 1040 — the patch
boundary — and every record after that boundary was lost with the reset rather
than left written-but-uncounted. The header does not merely survive; it
describes the file correctly. This is the header-patch mechanism behaving
exactly as designed, measured rather than argued.

The two clean files confirm the complementary path: counts of 4,192 and 10,134
are *not* multiples of 1040, so `closeFile()` patched the true count past the
last periodic boundary.

**Supporting cross-checks (all pass):**
- Byte arithmetic exact on all three: 64-byte header + JSON metadata +
  n × 28 B equals the on-disk size.
- Implied sample rate 102.98–103.06 Hz against 104 Hz nominal — ~1% low and
  consistent across all three files, i.e. ODR tolerance, not dropped samples.
- `end_timestamp` within 7 ms of the last record's timestamp in every file.
- 0 sync records in all three, as expected with no phone connected.

**Straddle risk: not observed.** The reset landed exactly on a patch boundary.
The concern above remains live in the code — it is unobserved here, not
disproven, and one trial cannot distinguish "cannot happen" from "did not
happen this time."

**Trial 1 — real power cut (2026-09-06).** Battery JST pulled mid-recording,
device rebooted, file uploaded: `9_6_2026_38967247.vtx` (436,979 B).

| Metric | Value |
|---|---|
| header `record_count` | 15,600 |
| actual records | 15,600 |
| delta | **0** |
| `record_count % 1040` | **0** (exact patch boundary) |
| duration | 151.6 s |
| `end_timestamp` − last record ts | **1 ms** |
| implied rate | 102.98 Hz |

**Result: the header-patch mechanism works under real power loss.** No graceful
shutdown, no `closeFile()`, and the file still parses with a header that
describes it exactly. The count sits on a 1040 boundary, so the records after
the last patch were lost with the power rather than left written-but-uncounted.
The 1 ms agreement between `end_timestamp` and the final record shows both
header fields — count at offset 16, timestamp at offset 36 — were consistent
with each other and with the file body: **the torn-`patchHeader()` case did not
occur in this trial.**

**Clock note:** `start_timestamp` decodes to 2026-09-06T18:49:27 UTC, so the
connect-time `CMD_SYNC_CLOCK` did land — but **0 sync records** were written
where ~2 would be expected at a 60 s cadence over 151 s. Consistent with the
companion app not yet implementing periodic time responses (`CMD_TIME_RESPONSE`).
Not a firmware fault, but it means C3 is untested rather than passing.

**What one trial does and does not establish.** The plan called for 3 cuts at
varying offsets from the last patch; **1 was run.** Both unclean terminations so
far (this cut and the earlier reset) landed on exact patch boundaries, which is
the favourable case. A single trial cannot distinguish "the torn-write window is
too narrow to hit" from "we did not hit it this time" — the two seeks plus two
8-byte writes remain a real if small window. State this as *did not fail in one
trial*, not as *cannot fail*.

### C2. WiFi drop mid-upload

**Do:** start a sync of a multi-MB file. Mid-`STREAMING`, kill the AP or walk
out of range. Reconnect and sync again.

**Expect:** the second sync completes without duplicating the file. No partial
object in Supabase Storage. `CHECK_EXISTING` should skip anything already
complete.

**Known limitation to confirm rather than discover:** `WIFI_ERROR` does not
retry — it waits 3 s and returns to idle
(`wifi_manager.cpp:306-312`). Recovery is manual by design. Confirm that
nothing is *lost*, which is the actual requirement.

### C3. Clock sync end to end

**Do:** record ≥30 minutes with the phone connected and the app foregrounded.
Then run the drift fit on the resulting file.

**Expect:** sync records present (one per 60 s). `computeClockDrift()` returns
a plausible ppm — tens of ppm, positive or negative. Residuals unstructured.

**Why:** firmware and app were written to the same wire format and both
typecheck, but **the exchange has never completed against real hardware.**
This is also the first real measurement of the device's crystal error; every
ppm figure to date is from synthetic records.

### C4. SD card fills during recording

**Do:** use a nearly-full card, or lower `SD_CRITICAL_MB` so the threshold is
reachable. Record until it trips.

**Expect:** `[REC] SD nearly full (N MB) — closing file cleanly`, recording
stops on its own, file parses.

**Why the device stops rather than waiting for a write failure:** a failed
write loses the tail; a failure inside `patchHeader()` can lose the whole
recording. Stopping early is deliberate.

**Also validates** the prediction-with-reconciliation path: free space is
computed from records written and reconciled against the FAT every 10 minutes,
so a long recording exercises both.

### C4 result (2026-09-06)

Run by raising `SD_CRITICAL_MB` from 20 to **7400** — above the card's real
7,348 MB free — so the threshold was reachable without a full card.
`SD_MIN_START_MB` was left at 60 so the start would still be permitted.

```
[SD] Recording to /vtx/2_28_2026_83403929.vtx
[REC] Started
[REC] SD nearly full (7348 MB) — closing file cleanly
[SD] Closed /vtx/2_28_2026_83403929.vtx — 0 records, 0 sync, 0KB
[REC] Stopped
```

**Stop path: PASS.** The recording stopped on the device's own terms via
`isSpaceCritical()`, `closeFile()` ran normally, and the LED returned to the
idle cadence. Critically the *prevention* path fired, not the *detection* path
— no `[REC] SD write failed`. This is the behaviour the design argument rests
on: stopping early rather than risking a failure inside `patchHeader()`.

**Prediction path: NOT exercised.** With 7,348 MB genuinely free,
`getFreeSpaceMBCached()` returns the real FAT value on its first call and never
has to predict downward. The plan's claim that C4 "also validates
prediction-with-reconciliation" does **not** hold for this method of reaching
the threshold — that needs a genuinely filling card over >10 minutes
(`SD_SPACE_RECONCILE_MS`). Still untested.

### BUG FOUND — empty file created when the space thresholds disagree

`[SD] Closed — 0 records, 0 sync, 0KB`. The run created, opened and cleanly
closed a **file containing nothing**.

**Cause — a gating gap, not a threshold artefact.** `startRecording()`
(`imu_manager_v2.ino:146`) gates only on `hasSpaceToStart()`, i.e. against
`SD_MIN_START_MB`. `isSpaceCritical()` is consulted **only** at
`imu_manager_v2.ino:317`, inside the recording loop. Nothing reconciles the two
thresholds, so whenever `SD_CRITICAL_MB > SD_MIN_START_MB` the start check
passes, the file opens, and the loop's critical check stops it before the first
write — on **every** start attempt.

**Why it matters beyond this test.** This is the same silent-failure *shape*
that the 2026-09-06 fail-fast work set out to eliminate: a `.vtx` that exists,
was closed cleanly, and holds zero records. The IMU/SD case is now guarded at
the operation; the space case is not. In the shipped config
(`SD_CRITICAL_MB` 20 < `SD_MIN_START_MB` 60) the window cannot open, so this is
**latent, not live** — but it is one config edit away, and nothing in the code
prevents that edit.

**Suggested fix (not applied — structural, owner's call).** Check
`isSpaceCritical()` in `startRecording()` alongside `hasSpaceToStart()`, and/or
add a `static_assert(SD_CRITICAL_MB < SD_MIN_START_MB)` in `config.h` so the
inconsistent configuration cannot compile. The `static_assert` is the cheaper
and more durable guard.

### C5. Sync buffer saturation

**Do:** a recording longer than 8.5 hours, or lower `MAX_SYNC_RECORDS` to make
it reachable in minutes.

**Expect:** at the limit, sync records stop and recording continues. Confirm
the file still parses and the sync section is truncated rather than corrupt.

**Why:** 512 records at 60 s is 8.5 h. The longest real recording is
**6h43m — 79% of the way there.** Past the limit the tail of a ride silently
loses drift correction with no indication.

---

## Results

Fill in as you go. "Not run" is a valid and useful entry.

| # | Check | Result | Notes |
|---|---|---|---|
| A1 | Compiles for ESP32-S3 | **PASS** | Clean first-try build, no source changes needed. Correct FQBN per README (`CDCOnBoot=cdc,USBMode=hwcdc,PartitionScheme=huge_app`): 1,319,883 B flash (41%), 66,836 B static RAM (20%). |
| A2 | Flash and boot healthy | **PASS** | `[READY] Idle`, no `[FAULT]` lines. IMU detected + configured (104Hz, ±8g, ±1000dps, FIFO continuous); SD ready 7664MB total / 7349MB free; BLE advertising as `Vertex-V2`. LED slow-blinking blue = idle cadence. |
| B1 | Boot, no SD → fault | **BLOCKED — hardware** | SD glued in; IMU soldered. No init-failure injectable on this unit. See "Hardware constraint" below. |
| B2 | Fault clears on insert | **BLOCKED — hardware** | Requires reaching `STATE_FAULT` first; not injectable. |
| B3 | Button refused in fault | **BLOCKED — hardware** | Requires reaching `STATE_FAULT` first; not injectable. |
| B4 | Boot, no IMU → fault | **BLOCKED — hardware** | IMU soldered into the V2 enclosure; SDA/power not separable. |
| B5 | Long press from fault | **BLOCKED — hardware** | Requires reaching `STATE_FAULT` first; not injectable. |
| B6 | Space refusal + app toast | **NOT RUN** | Device-side path is reachable by config (raise `SD_MIN_START_MB` above free space), but the check's purpose is validating the **app** error-toast fix, and the app has not been rebuilt with fault-state support. Defer until it is. |
| B7 | LED transitions | **PARTIAL** | Idle (slow blue) confirmed at A2. Fault→idle→recording cycle needs `STATE_FAULT`; not injectable. |
| B8 | Happy path unbroken | **PASS** | `[REC] Started` → `[SD] Closed — 10134 records, 0 sync, 277KB` → `[REC] Stopped`. Guard did not misfire on healthy hardware. File parses: header count 10,134 = actual 10,134, delta 0. Upload path exercised (device → app → Supabase → download). |
| C1 | Power cut ×3 | **PASS (1 of 3 trials)** | Real battery pull: header 15,600 = actual 15,600, delta **0**, exact 1040 boundary, `end_timestamp` within **1 ms** of last record. Plus a reset trial, same result (18,720/18,720). 1 power-cut trial run, not 3 — see C1 notes on what one trial can and cannot establish. |
| C2 | WiFi drop mid-upload | **NOT RUN** | Not attempted this session. No blocker — needs only the AP and a multi-MB file, both available. |
| C3 | Clock sync end to end | **FAIL on a real ride — cause NOT yet established** | Bench (debug build): **PASS** — 5 records/5 min, zero timeouts, exact 60 s cadence, RTT median 89 ms. Real 2.6 h ride 2026-09-07 (**release build**): **0 sync records of ~156 due**, not even sync #1. IMU data perfect (966,093 records, delta 0). Two candidate causes, neither confirmed: (a) responder torn down by `cleanupSubscriptions()` on any disconnect and never re-registered — but this needs a drop in the first 60 s, which the foreground service makes implausible; (b) **release vs. debug build difference** (console stripped, ProGuard, separate app id) — the bench pass and ride fail differ in exactly this. **Crystal error still unmeasured.** |
| C4 | SD fills during recording | **PARTIAL PASS + bug found** | Stop path verified: `[REC] SD nearly full (7348 MB) — closing file cleanly` → clean `closeFile()`, LED back to idle. Prevention path fired, not the write-failure detection path. **But produced a 0-record empty file** — see C4 finding. Prediction/reconciliation path NOT exercised. |
| C5 | Sync buffer saturation | **BLOCKED — app** | Reachable by lowering `MAX_SYNC_RECORDS`, but sync records require the app's periodic time responses, which are not built. Highest remaining risk: longest real recording is 6h43m vs. the 8.5 h limit. |

## If time is short

Three, in order: **A1** (prerequisite), **B1** (validates the day's work),
**C1** (closes the gap most relevant to fault-tolerant design). Everything else
can wait.

## Follow-ups

- Any check that fails: file the actual behaviour here before fixing, so the
  failure is recorded rather than only the fix.
- ~~Restore `SD_MIN_START_MB`, `SD_CRITICAL_MB`, and `MAX_SYNC_RECORDS` after
  B6/C4/C5.~~ **DONE 2026-09-06.** Only `SD_CRITICAL_MB` was ever changed
  (20 → 7400 for C4). `config.h` restored from backup and the device
  **reflashed**; the restored build is byte-identical to the A1/A2 build
  (1,319,883 B flash / 66,836 B RAM), confirming the shipped values are back.
  `SD_MIN_START_MB` and `MAX_SYNC_RECORDS` were never modified.

**Restoration verified on-device**, not just by byte count: post-reflash the
device boots to `[READY] Idle` and a short recording ran and closed normally —
`[SD] Closed /vtx/2_28_2026_83406723.vtx — 473 records, 0 sync, 12KB` — with
**no** `[REC] SD nearly full` line. The C4 threshold no longer trips against the
card's real free space.
- Results feed `notes/firmware-deep-dive.md` Module 4b, which currently lists
  most of §C as "designed but not tested".

---

## Session Summary — 2026-09-06

Bench session on the V2 production unit. **6 of 15 checks produced a result;
6 were blocked by the test article; 3 were not reached.**

### Measured — what is now verified rather than argued

**C1 — power loss mid-recording. The headline result.** The header-patch
mechanism was the single largest untested claim in the fault-tolerance story.
It now has a measurement behind it. Across two unclean terminations — one
accidental reset, one **real battery pull** — the header described the file
*exactly*:

| Trial | Termination | Header count | Actual | Delta |
|---|---|---|---|---|
| 0 | reset mid-recording | 18,720 | 18,720 | **0** |
| 1 | **battery pull** | 15,600 | 15,600 | **0** |

Both counts landed on exact 1040-record patch boundaries, and on the power-cut
file `end_timestamp` agreed with the last record to **1 ms** — the two header
fields stayed mutually consistent and consistent with the body. Records after
the last patch were lost with the power, not left written-but-uncounted.

**A1 — compiles clean.** First try, no source changes. The build failure the
plan expected did not happen.

**A2 / B8 — no regression.** Healthy boot; a normal recording started, ran,
closed at 10,134 records and parsed with delta 0. The new `startRecording()`
guard did **not** misfire on healthy hardware, which was the main regression
risk from the 2026-09-06 changes.

**C4 (partial) — the prevention path fired.** With the threshold raised to make
the condition reachable, the device stopped itself with
`[REC] SD nearly full — closing file cleanly` and closed the file normally. It
did **not** wait for a write to fail. That is the design intent demonstrated.

### Bug found

**Empty file created when the two space thresholds disagree.**
`startRecording()` gates only on `hasSpaceToStart()` (`SD_MIN_START_MB`);
`isSpaceCritical()` (`SD_CRITICAL_MB`) is checked only inside the recording
loop. Whenever `SD_CRITICAL_MB > SD_MIN_START_MB`, every start attempt opens a
file, stops before the first write, and cleanly closes a **0-record `.vtx`** —
the same silent-failure shape the fail-fast work was meant to eliminate.
**Latent, not live:** the shipped config (20 < 60) cannot reach it.

**Fixed 2026-09-06:** `static_assert(SD_CRITICAL_MB < SD_MIN_START_MB)` added
to `config.h`. **Consequence for future sessions:** this makes the C4 workaround
used here a build error. To re-run C4, lower *both* constants keeping the
ordering (e.g. `SD_MIN_START_MB 2`, `SD_CRITICAL_MB 1`) rather than raising
critical above min.

### Blocked — and why this is a limitation of the test article

**All of §B (B1–B5, B7) could not be run.** The SD card is **glued in**
(deliberate — vibration resistance) and the IMU is **soldered** into the V2
enclosure. Nothing but the battery is separable, so no subsystem can be failed
at `init()`, and every §B check requires exactly that.

**The fault-handling code therefore remains unverified on hardware.** It should
be described that way. The reasoning is reviewable and the guard is visible in
`startRecording()`, but no `STATE_FAULT` transition has been observed on a
device. A compile-time fault injector would make B1/B2/B3/B5/B7 runnable
without rewiring; a fresh bench unit (~1–2 h) would make them runnable properly.

Also relevant to how much is actually known: this unit has **never** had a
loose-solder failure, a mid-ride death, or an SD-full event in the field. The
§B failure modes are untested *and* unobserved.

### Not reached

- **C2** (WiFi drop mid-upload) — not attempted.
- **C3** (clock sync end to end) — **blocked on the companion app.** The
  connect-time `CMD_SYNC_CLOCK` works (the power-cut file carries a correct
  2026-09-06 wall-clock timestamp), but **0 periodic sync records** were written
  in 151 s where ~2 were due. The app does not yet implement
  `CMD_TIME_RESPONSE`. No crystal-error measurement was obtained; every ppm
  figure to date remains synthetic.
- **C5** (sync buffer saturation) — also blocked on the app, for the same
  reason. Still the sharpest open risk: the longest real recording is 6h43m
  against an 8.5 h limit, past which drift correction stops silently.

### Precision about what was measured

- C1 ran **1 power-cut trial, not the 3 the plan called for.** Both unclean
  terminations landed on exact patch boundaries — the favourable case. The
  torn-`patchHeader()` window (two seeks, two 8-byte writes) was **not** hit.
  One trial cannot distinguish "too narrow to hit" from "not hit this time":
  this is *did not fail in one trial*, not *cannot fail*.
- A latent risk was noticed by inspection but **not observed**: the patch
  trigger is an exact-equality modulo (`_recordCount % 1040 == 0`) on a counter
  advanced by variable batch sizes, so a straddling batch could skip a patch
  interval and double the worst-case loss to ~20 s. Unobserved here, not
  disproven.
- C4's **prediction-with-reconciliation path was not exercised** — the card had
  7.3 GB genuinely free, so the cached value never had to predict downward. The
  plan's claim that C4 covers it does not hold for this method.
- The ~103 Hz implied sample rate against 104 Hz nominal is consistent across
  all five files — ODR tolerance, not dropped samples.

### Tooling added

`analysis/vtx_ble.py` — phone-free BLE control (status / list / sync), written
because every route off the device is BLE-gated. Decoders unit-tested offline;
**not yet verified against hardware** — the scan returned nothing, most likely a
macOS Bluetooth permission grant for the terminal. Files for this session were
recovered with the companion app instead.

Incidentally confirmed while writing it: the GATT service has **no pairing,
bonding or encryption**. Anything in range can send `CMD_START_RECORDING` or
`CMD_DELETE_FILE`. Not today's problem, but it belongs alongside the
`void`-returning `init()` calls in the honest-gaps list.

### Config restored

`SD_CRITICAL_MB` (20 → 7400 for C4) was the only constant changed. `config.h`
restored **and the device reflashed**; the restored build is byte-identical to
the A1/A2 build (1,319,883 B), confirming shipped values are back.
`SD_MIN_START_MB` and `MAX_SYNC_RECORDS` were never modified.

**Restoration verified on-device**, not just by byte count: post-reflash the
device boots to `[READY] Idle` and a short recording ran and closed normally —
`[SD] Closed /vtx/2_28_2026_83406723.vtx — 473 records, 0 sync, 12KB` — with
**no** `[REC] SD nearly full` line. The C4 threshold no longer trips against the
card's real free space.

---

## Session — 2026-09-06 (later): C3/C5 re-attempt

### Correction to the earlier C3 diagnosis

The session above recorded C3 as **BLOCKED — app**, concluding "the app does
not yet implement `CMD_TIME_RESPONSE`." **That conclusion was wrong.**
`BleService.subscribeToTimeRequests()` already existed and already spoke the
correct wire format. Two separate causes produced the observed zero:

1. **The installed app build predated the handler.** The app was never rebuilt
   after the clock-sync work landed, so the running binary genuinely had no
   responder — consistent with the observation, but not with the stated cause.
2. **The handler was never called.** `subscribeToTimeRequests()` was defined
   and exported but had **no call site anywhere in the app.** A rebuild alone
   would therefore *not* have fixed it, which is why this matters as a
   correction rather than a footnote.

Both are addressed as of 2026-09-06: `DeviceDetailV2Screen.tsx` subscribes on
connect and tears down on disconnect (`isConnected` effect), and `BleService`
also registers the responder in its own connect path so a recording started
from the **device button** is covered without the screen mounted.

**Lesson worth keeping:** "feature absent from the running build" and "feature
absent from the source" are different failures with the same symptom. The
earlier session inferred the second from the first without checking the source.

### Pre-bench verification (desk, before touching hardware)

Done before the bench session to avoid burning bench time on software faults:

| Item | Result |
|---|---|
| Wire format, both ends | **Agrees.** Device sends 5 B `[0xF0][t1 u32]` on the file-list characteristic (`ble_manager.cpp:339`); app replies 17 B `[0x0E][t2 i64][t3 i64]` little-endian (`setBigInt64(..., true)`); firmware reads `data+1`/`data+9` via `memcpy` on a little-endian target (`ble_manager.cpp:60`). |
| `0xF0` discrimination | **Present.** `BleService.ts:1044` returns early unless `data[0] === NOTIFY_TIME_REQUEST`, so file listings on the shared characteristic are ignored rather than mis-parsed. This was the flagged first suspect for a file-list regression. |
| Reply path latency | **No queue or mutex.** `writeConfigCommand` (`BleService.ts:1419`) calls the BLE stack directly, so nothing serialises the reply behind other traffic and risks the 2 s `CLOCK_SYNC_TIMEOUT_MS`. |
| `t2`/`t3` stamping | **As designed.** `t2` is the first statement in the notification handler, before base64 decode; `t3` is stamped immediately before the write, and the write is **not** awaited first. |
| Analysis path | **Exercised on a synthetic v1.2 file.** `analysis/drift_report.py` (added this session) recovered an injected **27 ppm** from 35 records, rejected an injected 898 ms stalled exchange via the 500 ms cap, and reported residual RMS 0.4 ms. The reporting path is known-good before real data reaches it. |

**Status of the fixes: uncommitted working-tree changes** to
`DeviceDetailV2Screen.tsx` and `BleService.ts`. The bench build must come from
the working tree; do not stash or reset before C3/C5 are complete.

**Nothing above is a hardware result.** These checks establish only that the
software cannot be blamed for a zero on the next run — they do not measure
anything. C3 and C5 remain unrun.

### C3 — first completed exchange on hardware (2026-09-06)

**The BLE time exchange has completed against real firmware.** First observed
sync line, ~60 s into a recording with the rebuilt dev app connected and
foregrounded:

```
[CLK] Sync #1 — rtt=92ms
```

This retires item 4 of the clock-drift doc's unvalidated list ("the app
responder has not run against real firmware"). Both ends had only ever been
argued to agree; they now demonstrably do — the app replied within
`CLOCK_SYNC_TIMEOUT_MS` (2000 ms) and the device paired the reply with its own
t1/t4 rather than recording a miss.

Also confirmed in the same trace: connect-time `CMD_SYNC_CLOCK` (0x09) returned
`[CLK] Synced — wall clock: 1788723865946` = 2026-09-06, consistent with the
earlier session.

**Measurement conditions worth recording — the app polls status at 2 Hz.**
`DeviceDetailV2Screen.tsx:206` runs `getStatusV2()` on a 500 ms `setInterval`,
gated only on `isConnected && !isSyncing`, so `CMD_GET_STATUS` (0x01) is on the
wire twice a second throughout **both idle and recording**. This is by design
(it keeps the battery/state display live), not a fault, but it means every RTT
figure below was measured with steady competing BLE traffic. That is the
realistic in-app condition, and it is the right thing to measure — but it is
**not** an idle-radio RTT floor, and the two should not be conflated when
judging the 500 ms cap.

**First RTT data point: 92 ms.** Notably higher than the 30–50 ms connection
interval the outlier thresholds were reasoned from. One sample establishes
nothing about the distribution; recorded here so it is not lost if the
distribution later looks different.

### C3 — behaviour across phone screen-sleep (2026-09-06)

Observed mid-run: the 2 Hz `0x01` status poll **stops** when the phone screen
sleeps, and on wake two sync records appeared in immediate succession:

```
[CLK] Sync #2 — rtt=78ms
[CLK] Sync #3 — rtt=65ms
```

**Assessed as expected, not a duplicate.** Reasoning from
`imu_manager_v2.ino:81-115`:

- The device **cannot** queue a burst. `requestPhoneTime()` refuses while one
  exchange is in flight (`_timeReqPending || _timeRespReady`), and
  `_lastSyncRequestMs` advances unconditionally on cadence precisely so a long
  disconnection does not produce a backlog. Two records therefore mean two
  genuinely separate exchanges.
- A reply that had been stalled through the sleep/wake cycle could not have
  been recorded at all: `expireStaleTimeRequest()` drops the request after
  `CLOCK_SYNC_TIMEOUT_MS` (2 s), after which the `onWrite` handler ignores the
  late reply (`ble_manager.cpp:61`, gated on `_timeReqPending`).
- **The RTTs are the evidence.** 78 ms and 65 ms are in line with the 92 ms
  first sample. A reply delayed by a sleep/wake cycle would show an RTT of
  seconds. Both exchanges completed promptly.

**What this tells us about the app's behaviour when backgrounded — useful, and
better than assumed.** The JS `setInterval` status poll is throttled by the OS
when the screen sleeps, but the native `monitorCharacteristicForService`
callback that answers time requests **kept firing**. The responder survives
screen-off; only the foreground UI poll pauses. The close spacing is the 60 s
cadence slipping during sleep and then catching up, not a double-fire.

**Caveat — this is one observation on one platform (Android dev build), across
a short screen-off.** It does not establish that the responder survives a long
background period, Doze, or an app switch. The step-3 long recording should
still be run foregrounded, and any gaps noted against screen state.

### C3 — short exchange test PASSED (2026-09-06)

5-minute recording, dev app connected and foregrounded (screen slept briefly
mid-run; see above).

```
[CLK] Sync #1 — rtt=92ms
[CLK] Sync #2 — rtt=78ms
[CLK] Sync #3 — rtt=65ms
[CLK] Sync #5 — rtt=89ms
[BLE] Command: 0x03
[SD] Wrote 5 sync records at offset 916395
[SD] Closed /vtx/9_6_2026_42266036.vtx — 32722 records, 5 sync, 894KB
[REC] Stopped
```

**5 sync records in ~5 minutes — the expected 4–5 at the 60 s cadence.** Zero
`[CLK] Sync request timed out` lines: every request the device issued was
answered inside the 2 s window. The `[SD] Wrote N sync records` and the `N sync`
field of the close line are **non-zero for the first time on hardware**; the
trailing-section write path has now executed against a real file rather than a
synthetic one.

This is the check the 2026-09-06 (earlier) session recorded as
**BLOCKED — app** with 0 records in 151 s. With the app rebuilt from the
working tree and `subscribeToTimeRequests()` actually called, the same
condition produces records on cadence.

**RTT, 4 observed samples: 92, 78, 65, 89 ms — median ~83 ms.** Measured with
the 2 Hz status poll running concurrently. See the threshold assessment below.

**Not yet measured: drift.** A 5-minute span is far too short to separate a
tens-of-ppm signal from BLE timing noise, and the fit is expected to come back
untrustworthy. That is the correct outcome for this check — step 2 validates
the *plumbing*, not the crystal. The ppm figure comes from the long recording.

### C3 — short-run fit result (2026-09-06)

`analysis/drift_report.py` on `9_6_2026_42266036.vtx` (916,515 B; sync section
at offset 916,395 = exactly 5 × 24 B, consistent with the close line):

```
sync records: 5
span: 240.0 s (4.0 min)
inter-record gap s: min 60.0 median 60.0 max 60.0
gaps > 90 s (missed syncs): 0

RTT ms: min 65 median 89 p90 92 max 97
  negative RTT (rejected): 0
  over 500 ms cap:         0
  over 4x median (356 ms): 0

ppm: 112.49
drift over span: 27.0 ms over 4.0 min
residual_rms_ms: 14.9   residual_max_ms: 20.1
used: 5   rejected: 0
trustworthy: False
warnings: ['sync span 4.0 min is short: BLE latency noise dominates the drift signal']
suspected_steps: none
```

**The 112 ppm figure is NOT a drift measurement and must not be quoted as one.**
The fit reports it while flagging itself untrustworthy, correctly: 27 ms of
apparent drift across the span against a residual RMS of **14.9 ms** means the
slope is fitting BLE jitter, not crystal error. This is the documented
short-span failure mode (`docs/architecture/clock-drift.md`, "Short spans"),
reproduced on real data for the first time. **The device's crystal error remains
unmeasured** pending the long recording.

**Round-trip through real firmware: PASS.** Records written by firmware to SD,
uploaded over WiFi, and parsed by the Python parser — the first v1.2 file
produced by actual hardware. This retires item 6 of the clock-drift doc's
unvalidated list ("the 42 backward-compat files are all pre-v1.2 by
construction... they cannot prove a v1.2 file written by real firmware parses").

**Cadence: exact.** Inter-record gaps of 60.0 s at min, median and max, zero
missed. The mid-run phone screen-sleep produced **no gap**, corroborating that
the native `monitorCharacteristicForService` callback keeps answering while only
the JS status poll is throttled.

### First real BLE RTT distribution — assessment of the outlier thresholds

The 500 ms cap and 4× median rule were "reasoned from connection-interval
arithmetic, not fitted to observed latency" (clock-drift.md, item 2). First real
data, n=5, **measured with the app's 2 Hz status poll running concurrently**:

| | ms |
|---|---|
| min | 65 |
| median | **89** |
| p90 | 92 |
| max | 97 |

**Two findings, opposite in direction:**

1. **Absolute latency is ~2× the design assumption.** The thresholds were
   reasoned from a 30–50 ms connection interval; the observed median is 89 ms.
   The 4× median rule therefore fires at **356 ms** in practice, not the ~160 ms
   the arithmetic implied — a materially looser filter than intended, and it
   sits close enough to the 500 ms absolute cap that the two rules are far less
   independent than the design assumed. The doc claims "tests confirm each
   catches a stalled exchange on its own"; against real latency they largely
   overlap.
2. **Dispersion is very tight.** 65–97 ms, a 32 ms spread with no outliers and
   nothing rejected by either rule. The concern that "wildly variable RTT
   undermines the offset estimates" does **not** materialise here. Residual
   error is bounded by roughly rtt/2 ≈ 45 ms, which is consistent with the
   observed 14.9 ms residual RMS.

**Recommendation (not applied — needs the long run's n before acting):** the
absolute cap looks about right, but the 4× median factor should probably tighten
to ~2–2.5× given how tightly real RTT clusters. Revisit with the long
recording's sample count.

**Caveats.** n=5, one device, one phone, one BLE stack, stationary on a bench,
with a 2 Hz status poll competing. This is not the RTT floor and not a
distribution a ride would produce — motion, distance and interference are all
absent.

### Firmware reflash — file-listing fix (2026-09-06)

Flashed mid-session, between the C3 short test and the long recording, to pick
up a file-listing fix (chronological sort by filename timestamp before taking
the 10 most recent, plus `spaceLow`/`spaceCritical` status flags and
`getFreeSpaceMBCached()` in the status path).

| | |
|---|---|
| Host tests | **48/48 pass** (was 44 at A1 — new sort-key tests included) |
| Compile | Clean, full FQBN per README |
| Flash | 1,336,527 B (42%) — **+16,644 B** over the 1,319,883 B A1/A2 baseline |
| Static RAM | 66,836 B (20%) — **unchanged** |
| Upload | `Hash of data verified`, hard reset via RTS |
| Config check | Shipped values confirmed before flashing: `MAX_SYNC_RECORDS` 512, `SD_CRITICAL_MB` 20 < `SD_MIN_START_MB` 60 (`static_assert` passes) |

Post-flash serial shows the IMU streaming plausible values (gravity ~9.5 m/s²
distributed across axes, small stable gyro bias), so the device is running.

**Not captured: the boot banner.** `arduino-cli monitor` could not be driven
from the automation here, and with `USBMode=hwcdc` the USB stack is
firmware-managed so host-side DTR/RTS and 1200-baud-touch resets do not force a
reboot. `[READY] Idle` and the SD/BLE init lines were **not** observed for this
build — to be confirmed by IDE monitor. The A2-equivalent check is therefore
**outstanding for this build**, though the running IMU stream is strong evidence
the boot path completed.

**Note on the listing fix's scope:** `[BLE] N files on SD (M fetched)` now
reports two distinct quantities. The chronological sort applies only to the M
fetched (cap 32), so with more than 32 files on the card the "10 most recent"
are the 10 most recent *of the first 32 the enumerator returns* — not of the
card. Not a regression (the old code had no ordering guarantee at all), but the
guarantee is bounded.

### Firmware reflash #2 — free-space wrap bug (2026-09-06)

Reflashed minutes after the listing fix. Two real bugs fixed in
`storage_manager.cpp`, both found by the owner after the previous flash.

**Bug 1 — unsigned wrap in the free-space prediction. Would have aborted the
§C3 long recording within seconds.** `openNewFile()` resets `_recordCount` to 0
but left `_recordCountAtReconcile` holding the *previous* recording's count.
`getFreeSpaceMBCached()` differences the two in unsigned arithmetic, so the
second recording of a session computed `0 - 32722`, wrapped to ~4.29e9, and
`usedMb` swamped the cache — the prediction returned **0 MB free on a card with
7.3 GB**, tripping `isSpaceCritical()` and stopping the recording immediately
with "SD nearly full (0 MB)".

Directly relevant to this session: the C3 short test left `_recordCountAtReconcile`
at 32,722, so **the next recording started would have died on the spot.** The
long run would have failed in a way easily misread as an SD fault.

Fixed twice over, which is the right call: `openNewFile()` now re-baselines
(`_freeMbCacheAt`, `_freeMbCache`, `_recordCountAtReconcile`), *and* the
subtraction itself is guarded (`_recordCount >= _recordCountAtReconcile ? … : 0`)
so a future caller cannot reintroduce silent wrap.

**This also explains the C4 finding from the earlier session in a new light.**
That session recorded a 0-record empty file and attributed it to the
`SD_CRITICAL_MB > SD_MIN_START_MB` gating gap. That analysis stands on its own,
but this wrap is a second, independent path to the same "stops before the first
write" symptom — and it needs no unusual config at all. Worth re-reading the C4
notes with that in mind.

**Bug 2 — `listFiles()` returned a count larger than the entries written.**
`count` advanced for every file on disk while only `maxEntries` slots were
filled, so a caller iterating to the returned value read **uninitialised
memory** past the end of the filled region. Now returns entries *written* when
`entries != nullptr`, and the disk total only when called with `nullptr`. The
BLE listing path is a direct consumer.

Also in this change: directory-prefix stripping (`/vtx/name.vtx` → `name.vtx`)
so BLE, the app's filename date parser, and delete-by-name all see the same
form; and `file.close()` in the enumeration loop, which was previously leaked
per iteration.

| | |
|---|---|
| Host tests | **48/48 pass** |
| Compile | Clean |
| Flash | 1,336,547 B (42%) — +20 B over reflash #1 |
| Static RAM | 66,836 B (20%) — unchanged |
| Upload | `Hash of data verified`, hard reset via RTS |

**Boot banner again not captured** by the automation (same `USBMode=hwcdc`
limitation); owner monitoring via the Arduino IDE. `[READY] Idle` still
unobserved for the current build at time of writing.

---

## §C3 long recording — 2.5 h real ride, 2026-09-07: ZERO sync records

**The ride recorded perfectly. It contains no clock-sync data.**

`9_7_2026_33823744.vtx`, 27,050,783 bytes:

| | |
|---|---|
| Version | 1.2 |
| Duration | **2.61 h** (9,387.5 s) |
| IMU records | **966,093** |
| Implied rate | 102.91 Hz (consistent with the ~103 Hz seen across the corpus) |
| `sync_data_offset` | **0** (header bytes 58–63 all zero) |
| `sync_record_count` | **0** |
| Sync records due at 60 s | **~156** |

**The IMU data is intact — this is not a lost ride.** File size is *exactly*
64 + 115 + 966,093 × 28 = 27,050,783 bytes, delta **0**. Nothing is truncated
or corrupt. The file simply has no trailing sync section.

**Not a parse failure.** Header bytes 58–63 are literally zero, which is the
firmware's "absent" encoding, not a misread. `writeSyncSection()`
(`storage_manager.cpp:129`) returns early when `_syncCount == 0`, leaving those
fields untouched — so **the sync buffer was empty at `closeFile()`**. No
four-timestamp exchange completed at any point in 2.6 hours.

This is not the §C5 buffer-saturation path either: that would have produced 512
records and a `[CLK] Sync buffer full` line, not zero.

**What is established vs. what is not.** The exchange demonstrably works — it
was measured on the bench hours earlier (5 records in 5 min, zero timeouts,
exact 60 s cadence). What has now failed is the exchange *under real ride
conditions*. The difference between the two runs is the ride itself, not the
code.

**Consequence: the device's crystal error remains unmeasured.** Every ppm
figure in the project is still synthetic. The honest statement is unchanged:
"the algorithm recovers injected drift" — not "the device drifts by N ppm."

**Diagnosis is not yet possible from the file alone.** `_syncCount == 0` is
consistent with several causes that the file cannot distinguish (see below).
The device serial log for the ride, if captured, would separate them
immediately — `[CLK] Sync request timed out (N missed)` lines would show the
device requesting and the phone not answering, whereas their *absence* would
point at the device never requesting.

### Diagnosis — why the ride produced zero sync records

**Ride conditions (from the owner):** phone in a pocket, app opened and checked
periodically mid-ride, and **the app showed the device still connected at the
end of the ride.** Recording started with the phone connected — confirmed
independently by the file: `start_timestamp` is a correct wall clock
(2026-09-07 10:23:43), so connect-time `CMD_SYNC_CLOCK` succeeded.

"The BLE link simply dropped and stayed down" does **not** fit that evidence.

**Identified defect: the time responder is torn down on disconnect and never
re-registered on reconnect.**

`BleService.subscribeToTimeRequests()` is registered in exactly one place on
the connect path — inside the `isV2Device` block of `connectToDevice()`
(`BleService.ts:350`), pushed onto `activeSubscriptions`. Every disconnect path
calls `cleanupSubscriptions()` (`:116`, `:270`, `:311`, `:1387`), which removes
**all** subscriptions including the responder, sets `connectedDevice = null`,
and notifies listeners with `false`.

Nothing re-registers it except a fresh explicit `connectToDevice()` call:

- The screen's responder effect keys on `isConnected`, so it also tears down on
  the same event (`DeviceDetailV2Screen.tsx:113-123`).
- The screen only auto-connects **on mount**
  (`if (!BleService.isConnected()) handleConnect()`), not in response to a
  later disconnect.

**Consequence.** A single transient BLE drop — trivially likely over 2.6 h with
the phone in a jersey pocket, the radio at the edge of range and the body
between phone and seatpost — permanently disables clock sync for the rest of
the recording, while the app may still *display* a connected device once the
link re-establishes underneath (or on a later screen mount). This matches the
observed outcome precisely: a correct connect-time sync, then **zero** periodic
exchanges across 156 opportunities, with the app appearing connected at the end.

**Why the bench test passed and the ride did not.** The 5-minute bench run never
disconnected: device on the desk, phone beside it, no range or body-blocking. It
therefore exercised only the register-once-and-stay-connected path — the one
case where this defect is invisible. The screen-sleep episode during that run
was *not* an equivalent test: sleeping the screen throttles the JS status poll
but does not disconnect BLE, which is exactly why sync records kept landing
through it.

**Status: diagnosed by code inspection, not yet proven on hardware.** The
mechanism is visible in the source and fits every observed fact, but the
decisive evidence — device serial showing `[CLK] Sync request timed out (N
missed)` accumulating while the app shows connected — was not captured, because
the owner was riding. Confirming it needs a deliberate disconnect/reconnect
test (below), not another ride.

**This is an app defect, not a firmware one.** The device behaved correctly
throughout: it requested on cadence, treated every unanswered request as a
normal miss, and wrote no section because the buffer was legitimately empty.

### Diagnosis, revised — the reconnect defect does NOT explain this ride

The owner pushed back on the reconnect explanation, correctly. It requires a
BLE drop within the **first 60 s** (nothing was ever recorded, not even sync
#1), and the ride ran with an Android **foreground service + persistent notifee
notification** added specifically to keep the process and the link alive. The
notification survived the whole ride, and tapping it returned to a live
recording screen showing the device **still connected**. A drop inside the first
minute that then never recovered, under those conditions, is not credible.

**The reconnect defect is real and still worth fixing** — `cleanupSubscriptions()`
removes the responder on any disconnect and only an explicit `connectToDevice()`
restores it — but it is **not established as the cause of this ride**, and the
plan should not claim it is.

**Critical build-provenance finding.** The APK almost certainly used for the
ride is a **release build**:

```
app/android/app/build/outputs/apk/release/app-release.apk   Sep 6 13:42
src/screens/DeviceDetailV2Screen.tsx                        Sep 6 13:28
src/services/NotificationService.ts                         Sep 6 13:29
ride                                                        Sep 7 10:23–13:00
```

The foregrounding/notifee work (13:28–13:29) **was** compiled into that APK
(13:42), so the ride did have that code. But a release build differs from the
bench debug build in ways that bear directly on this failure:

1. **`console.log` is stripped** (`babel.config.js`, `transform-remove-console`
   with `exclude: ['warn','error']`, triggered by `NODE_ENV=production` which
   `build-release.sh` exports). Every diagnostic this session has relied on —
   `[BLE] V2 time-request responder active` among them — is **absent from the
   ride build**. There is therefore no app-side log evidence for this ride even
   in principle.
2. **`minifyEnabled`/ProGuard applies** to the release build type, which the
   bench build never exercised.
3. **No `applicationIdSuffix ".debug"`**, so the release APK installs as a
   *separate app* from the debug build tested at the bench. Which of the two was
   actually running during the ride is not established by the file.

**The bench PASS was on a debug build; the ride FAIL was on a release build.**
That is an uncontrolled difference between the only run that worked and the only
run that failed, and it is a stronger lead than the reconnect defect.

**Open question, not yet answered:** does the time responder work at all in a
release build? Nothing here proves it does. Candidate mechanisms — none
verified — include ProGuard/minification affecting the BLE callback path, and
differing background-execution behaviour between the two app identities.

**Next step is a bench test, not another ride.** Two runs, both with device
serial captured (the device logs regardless of app build type):

1. **Release build, stationary, 5 min.** Does sync #1 land at all? This alone
   separates "release builds don't do clock sync" from "something about riding".
2. **Debug build, deliberate disconnect/reconnect.** Start recording, confirm
   sync #1, walk out of range until the app drops, walk back, and see whether
   syncs resume. This tests the reconnect defect specifically.

Run (1) first: it is the cheaper test and covers the more likely cause.
