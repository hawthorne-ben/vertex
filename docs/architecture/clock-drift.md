# Clock Drift Measurement — V2 Firmware, `.vtx` Format v1.2, Parsers

**Date:** 2026-09-05
**Status:** implemented and tested in software; **unvalidated on hardware**

---

## The problem

IMU sample timestamps are `uint32` ms offsets from recording start, derived
from `millis()`. `millis()` comes off a crystal with a tolerance on the order
of tens of ppm. We sampled the phone's wall clock exactly once, at BLE
connect, and assumed that offset held for the whole recording.

It doesn't. At 30 ppm the device and phone clocks diverge ~108 ms per hour —
and that error is invisible in the file, so anything aligned against an
external timeline (a FIT file from a head unit, video with timecode) silently
inherits it.

## What was built

Periodic clock-sync sampling, **recorded as data, not applied as a
correction.** Every 60 s of recording the device asks the phone for its wall
clock over BLE and stores the exchange in the `.vtx` file. Resolution happens
offline, in the parser, where the whole recording is visible at once.

Four things changed:

| Layer | Change |
|---|---|
| Firmware | Non-blocking BLE time exchange + 60 s cadence + trailing sync section on file close |
| App | Responder that answers a device time request on the earliest available callback |
| Format | v1.2 — sync stream in a trailing section, header bytes 58–63 |
| Parsers | TS + Python read the stream; `computeClockDrift()` fits it |

---

## Format extension: where the sync records live, and why

**Chosen: a trailing section, with offset and count in the header's last 6
reserved bytes.**

```
[64B header] [JSON metadata] [IMU records] [GPS records] [SYNC records]
                                                          ^ sync_data_offset
```

| Offset | Size | Field |
|---|---|---|
| 58 | 4 | `sync_data_offset` (uint32) — 0 means absent |
| 62 | 2 | `sync_record_count` (uint16) — 0 means absent |

The header stays 64 bytes. Growing it would have invalidated every existing
file, since `data_offset` is absolute.

### Inline vs. trailing — the actual tradeoff

The IMU region is a fixed-width array and both parsers seek directly to
sample *i* at `data_offset + i * record_size`. The web `vtx-samples` route
and the analysis scripts depend on that. Interleaving a differently-sized
record destroys the invariant: every reader would need a linear scan, or the
format would need a per-record discriminator byte, turning 28-byte records
into 29 and invalidating every file on disk.

The cost of going trailing is real and worth stating plainly: **the section
offset isn't known until the IMU record count is final, so sync records are
buffered in RAM (512 × 24 B = 12 KB) and written at `closeFile()`. A
recording that loses power mid-ride keeps its IMU data — the header is
patched every ~10 s — but loses its sync records.** Inline records would have
survived that. Accepted on the grounds that a power-loss file has larger
problems than drift correction, and the 12 KB buffer covers 8.5 h at the 60 s
cadence.

`sync_record_count` is `uint16` rather than the `uint64` GPS used: it wouldn't
have fit in the remaining space, and 65535 records is 45 days of continuous
recording against a battery envelope of single-digit hours.

**One consequence to flag: the reserved region is now fully consumed.** GPS
took 46–57 in v1.1, sync takes 58–63. A third stream needs a section table or
a v2.0 header. That is the main structural cost of this design.

---

## Sync record layout (24 bytes) and how RTT is accounted for

| Offset | Size | Type | Field |
|---|---|---|---|
| 0 | 4 | uint32 | `t1_device_ms` — `millis()` at request send |
| 4 | 4 | uint32 | `t4_device_ms` — `millis()` at response receipt |
| 8 | 8 | int64 | `t2_phone_unix_ms` — phone `Date.now()` at request receipt |
| 16 | 8 | int64 | `t3_phone_unix_ms` — phone `Date.now()` at reply send |

This is the NTP/SNTP four-timestamp exchange:

```
offset = ((t2 - t1) + (t3 - t4)) / 2      // phone-minus-device, transport delay cancelled
rtt    = (t4 - t1) - (t3 - t2)            // round trip, phone processing removed
```

**Why all four.** At a 30–50 ms BLE connection interval, latency varies by
tens of ms between samples — the same order as several hours of accumulated
crystal drift. Recording only `t1`/`t4` and one phone timestamp folds that
variable latency straight into the offset, and nothing downstream could
separate a slow exchange from real drift. With four timestamps the transport
delay cancels to first order, and `rtt` survives as a per-sample quality
weight.

The cancellation is exact only for a symmetric path. BLE isn't reliably
symmetric, so residual error is bounded by roughly `rtt/2` — which is why
`rtt` is stored rather than discarded. Two extra int64s cost 16 bytes per
record; a 4-hour ride's 240 records total 5,760 bytes against ~42 MB of IMU
data. There is no storage argument for a narrower record.

**Both ends stamp at the boundary.** The device stamps `t1` immediately
before handing the packet to the stack and captures `t4` inside the BLE write
callback — not in `processCommands()` on a later loop, which would charge
main-loop scheduling to the round trip. The app stamps `t2` as the first
statement in its notification handler, before base64 decoding, and stamps
`t3` immediately before the write *without awaiting it* — awaiting would put
BLE write latency inside the phone's reported processing window, which is
exactly what `t3 - t2` is supposed to exclude.

Outlier handling in the fit is two independent layers: an absolute cap
(RTT > 500 ms) and a median-relative rule (RTT > 4× median). Tests confirm
each catches a stalled exchange on its own. Negative RTT — the phone claiming
more processing time than the entire round trip — is rejected as physically
impossible.

---

## The fit: method and assumptions

**Ordinary least squares of offset against device time**, after RTT
filtering. Returns ppm, a `correct()` function mapping device `millis()` to
estimated true unix ms, residual RMS/max, and a `trustworthy` boolean with
human-readable warnings.

**Why linear.** Crystal frequency error is dominated by a fixed manufacturing
offset plus a temperature coefficient. Over one ride the manufacturing term
is constant, so offset accumulates linearly and a straight line is the
correct model — not merely a convenient one.

Sign convention: positive ppm means the device clock runs *slow*. Verified
numerically — 30 ppm produces 108 ms/hour.

**Where it breaks, explicitly:**

- **Thermal transients.** A tuning-fork crystal's frequency follows a parabola
  in temperature (≈ −0.035 ppm/°C² about a ~25 °C turnover). A device that
  starts indoors and is ridden into cold air sweeps that curve, and the drift
  rate genuinely isn't constant. This shows up as *structured* residuals,
  which is why residual RMS is reported rather than an R² — R² would look
  excellent while the model was wrong in a patterned way.
- **A phone clock step.** NTP correcting the phone mid-ride moves the offset
  discontinuously, and a single OLS line absorbs it as slope error across the
  whole recording. Tested: a 1.2 s step during a 30 ppm recording throws the
  fit by more than 50 ppm.
- **Short spans.** Under ~10 minutes, BLE latency noise dominates a drift
  signal of microseconds. Reported, but flagged untrustworthy.

**Detecting a phone clock step** — the open question worth answering
directly. In a *single* sample a phone jump is indeed indistinguishable from
device drift. Across the series it isn't: drift is slow and monotonic (3 ms
per minute at 50 ppm), while an NTP correction moves the offset tens to
hundreds of ms between two adjacent samples. `detectClockSteps()` takes the
median slope of the offset series and flags points whose first difference
departs from the median-predicted value by more than 250 ms. Verified to fire
on an injected step and to produce no false positives on smooth drift up to
45 ppm. The honest limitation: a step smaller than the per-sample noise floor
is undetectable, and a step in the first or last sample can't be distinguished
from a bad measurement. When a step is flagged the caller should refit per
segment rather than trust one line — the helper reports it rather than
silently papering over it.

**Degenerate inputs never throw.** Zero records → identity correction,
untrustworthy. One record → constant offset, no rate, untrustworthy (exactly
the pre-v1.2 behavior). A missed sync is not an error: BLE is disconnected for
most of a typical ride, and the absence of sync records degrades cleanly to
the old single-sync behavior.

---

## Is 60 s the right cadence?

It buys resolution we can't otherwise get, at a cost that rounds to zero:

- **BLE cost:** one 5-byte notify + one 17-byte write per minute. Against a
  connection interval of 30–50 ms, the radio is already waking ~1,200–2,000
  times a minute for the connection event itself. This adds one packet to one
  of them.
- **Storage:** 24 B/min = 1.4 KB/hour, against ~10 MB/hour of IMU data.
- **Resolution:** the useful limit is set by per-sample noise, not cadence.
  With ~10 ms of residual timing noise, N samples over a span T give a slope
  uncertainty of roughly `noise / (T * sqrt(N))`. Over a 2-hour ride, 120
  samples resolve well under 1 ppm — far finer than the tens-of-ppm effect
  being measured.

Cadence could drop to 5 minutes and still resolve the drift, since precision
is dominated by the *span*, not the sample count. 60 s was kept because the
extra samples cost nothing measurable and give the outlier filter and the
step detector enough points to work with — a step detector on 5-minute
samples would have poor time resolution on *when* a jump occurred. If BLE
wakeups ever prove costly on battery, this is a safe knob to turn.

---

## Verification

| Check | Result |
|---|---|
| TS parser suite | **100 passed** (68 new) |
| Python parser suite | **92 passed** (69 new) |
| Backward compat, real files | **all 42** `.vtx` in `analysis/data/sample-recordings/` parse unchanged, both parsers |
| Forward compat | v1.2 file readable by IMU-only paths; `recoveryMode` no longer miscounts the trailing section |
| Round-trip | encode → decode returns byte-identical sync records |
| Drift recovery | 5, 30, −18, 75 ppm recovered to ±0.1 ppm; unaffected by symmetric 120 ms RTT |
| Degenerate | 0 records, 1 record, 2 records, all-rejected, negative RTT, identical timestamps — all handled, none throw |
| Firmware build | compiles and links clean (ESP32 core 3.3.6, `huge_app`) |
| Firmware cost | **+1,212 B flash (+0.09%)**, **+12,328 B RAM** (12,288 = the sync buffer) |
| App typecheck | 46 errors before, 46 after — **zero introduced** |

Two pre-existing bugs were fixed in passing: a stale `versionMinor === 0`
assertion that had been failing since the v1.1 GPS bump, and `recoveryMode`
counting trailing sections as IMU records (which affected GPS too).

### FIFO safety — the constraint that mattered most

The requirement was that the sync exchange cannot stall FIFO servicing.
Measured against the hardware limits:

- LSM6DS3 FIFO is 4096 words = **682 samples**; threshold is 60.
- Headroom from threshold to overflow at 104 Hz: **~5,980 ms**.
- `serviceClockSync()` does a flag test, two `millis()` comparisons, and —
  once per 60 s — one 5-byte BLE notify. No `delay()`, no busy-wait, no SD
  I/O. The 2 s response timeout is a deadline *checked by comparison*, never
  waited on.
- Even a pathological 50 ms notify consumes **0.84%** of the available
  headroom.

Overflow would require a ~6-second stall; nothing on this path can block.

---

## What remains unvalidated

Stated plainly, because this feeds a presentation:

1. **No hardware run. There are no measured drift numbers.** Every ppm figure
   here is from synthetic records with a known injected rate. The actual
   crystal tolerance of the ESP32-S3 in this build is still unknown — the
   "tens of ppm" figure is a datasheet expectation, not a measurement. The
   first real recording with sync records is what turns this from plumbing
   into data.
2. **Real BLE RTT distribution is unmeasured.** The 500 ms cap and 4× median
   rule are reasoned from connection-interval arithmetic, not fitted to
   observed latency. They may need retuning once real exchanges exist.
3. **Thermal behavior is untested.** The linear model's main predicted failure
   mode — a cold-start ride sweeping the crystal's temperature parabola — has
   not been observed. Structured residuals would be the tell.
4. **The app responder has not run against real firmware.** Both sides are
   written to the same wire format and typecheck, but the exchange has never
   completed end-to-end.
5. **Power-loss behavior is by design, not by test.** Sync records are lost if
   a recording never closes; this is reasoned from the write path, not
   verified by pulling power mid-recording.
6. **The 42 backward-compat files are all pre-v1.2 by construction.** They
   prove old files still parse; they cannot prove a v1.2 file written by real
   firmware parses, because none exists yet.

The obvious next step is a single multi-hour ride with the phone connected,
then `computeClockDrift()` on the result — which yields both the device's real
ppm and a first look at whether the residuals are random or structured.
