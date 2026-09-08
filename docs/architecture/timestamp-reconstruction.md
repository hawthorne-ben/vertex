# Timestamp Reconstruction — `.vtx` Parsers (post-processing)

**Date:** 2026-09-05
**Status:** implemented and tested in both parsers; measured against the
V2 corpus. Post-processing only — no firmware change, no format change, no
rewriting of stored files.

---

## The problem

`readFIFO()` captures `millis()` once per FIFO read and stamps every sample in
that batch with the same value (`sensor_manager.cpp:107,121`). The timestamp is
taken *after* the I2C reads complete, so it marks when the read finished, not
when any sample was captured.

Two distinct artifacts follow, and they are not equally fixable:

1. **Duplicate timestamps.** `loop()` runs without delay, so it normally
   out-runs sample production and finds one sample waiting. Multi-sample reads
   occur only when the loop stalls — SD write, BLE status push, WiFi tick — and
   a backlog accumulates in the FIFO.
2. **Quantization.** `millis()` has 1 ms resolution against a 9.615 ms sample
   period — a clock roughly 10x coarser than the thing it is timing. Deltas
   quantize to 9/10/11 ms.

This work fixes (1). **It cannot fix (2)** — see *What this does not buy*.

### Measured before (V2 corpus, 6.63 M samples across 6 raw 104 Hz recordings)

| | |
|---|---|
| Samples carrying a unique timestamp | 98.91% |
| Duplicate-timestamp samples | **1.09%** (72,383) |
| Distinct loop-stall events (runs > 1) | 9,514 |
| Longest run sharing one timestamp | **25 samples** (~231 ms collapsed to a point) |
| Median inter-sample delta | 10 ms (true interval 9.615 ms) |
| Files with strictly monotonic stored timestamps | **0 of 6** |

These reproduce Module 2e's figures. The small differences (1.09% vs 0.70%
duplicates; 98.91% vs 99.89% unique) come from scope: Module 2e's percentages
average over a corpus that includes V1 and merged files, which contain no
duplicates at all and dilute the rate. Restricted to raw V2 recordings — the
only files the firmware path in question produced — the duplicate rate is
higher. Longest run (25) and median delta (10 ms) match exactly.

---

## The algorithm

Anchored, per-batch, backward distribution.

1. **Group** consecutive samples sharing a stored timestamp. Each run is one
   FIFO read.
2. **Distribute backward** from the recorded time at the nominal interval
   (`1 / header.sampleRate`). A run of length *n* ending at *t* is placed at
   `t-(n-1)·dt, …, t-dt, t`. The samples were captured *before* the read
   completed, so the recorded time belongs to the **last** sample in the run.
3. **Detect gaps.** Between batches, compare elapsed wall time against what
   the sample count accounts for. Where elapsed time exceeds that, samples were
   dropped: **flag the gap, do not interpolate across it.**
4. **Compose with drift correction** for nominal-vs-actual crystal error.

### Why not `start + i / rate`

Global indexing assumes zero dropped samples for an entire recording. One FIFO
overflow, I2C failure, or SD stall shifts every subsequent timestamp
permanently, and the error is silent and cumulative — worse than the problem
being solved.

Per-batch anchoring is self-correcting by construction: every batch re-anchors
on a real recorded observation, so a dropped sample perturbs one interval
instead of everything downstream. This is tested explicitly
(`a dropped sample perturbs one interval, not everything downstream`), and it
is the case the naive approach gets wrong.

### Composition with `computeClockDrift()`

The two corrections are orthogonal and must not be double-counted:

- **Reconstruction** works entirely inside the device time base. It fixes
  *where within a batch* a sample sits. It does not move batch anchors, so it
  does not change the device-time-to-true-time mapping.
- **Drift correction** maps device time to true unix time.

Order matters: reconstruct first, then map each result through `correct()`
exactly once. Applying drift first would place samples at the *nominal*
interval in corrected time, re-introducing the rate error the fit just removed.
`reconstructAndCorrect()` / `reconstruct_and_correct()` enforce this order.

---

## Interface

Opt-in and non-destructive. **Default decode behavior is unchanged** — the
decoder still returns stored timestamps as-is, raw timestamps remain available
on the result, and existing callers keep working.

| TypeScript | Python |
|---|---|
| `reconstructTimestamps(timestamps, rateHz, opts?)` | `reconstruct_timestamps(timestamps, rate_hz, ...)` |
| `reconstructRecordTimestamps(records, header, opts?)` | `reconstruct_record_timestamps(records, header, ...)` |
| `reconstructAndCorrect(records, header, correct, opts?)` | `reconstruct_and_correct(records, header, correct, ...)` |
| `findBatchRuns(timestamps)` | `find_batch_runs(timestamps)` |

Every call returns a quality report: run count, run-length histogram, longest
run, stall-event count, duplicate samples, samples adjusted, max adjustment,
the list of detected gaps with location and implied missing samples, observed
vs. nominal rate, and a **`trustworthy` flag with human-readable `warnings`** —
the same contract as `computeClockDrift()`'s `trustworthy`.

`trustworthy: false` means "read the warnings before relying on this," not
"the output is garbage." It is set when gaps were found, when monotonicity
clamping was needed, when the input is degenerate, or when the header's rate is
contradicted by the data.

### V1 files are handled explicitly, not by assumption

The rate always comes from `header.sampleRate`, so a 20 Hz V1 file is placed at
50 ms intervals and a 104 Hz V2 file at 9.615 ms. No 104 Hz assumption is ever
applied to a V1 file — tested directly.

This surfaced a **pre-existing data defect worth knowing about**: 24 of 33 V1
files in the corpus have headers that do not describe their own data.

| Declared | Observed | Files |
|---|---|---|
| 800 Hz | 25 Hz | 5 |
| 30 Hz | 25 Hz | 6 |
| 20 Hz | 25 Hz | 7 |
| 10 Hz | 25 Hz | 3 |
| 10 Hz / 40 Hz | 50 Hz | 2 |

Reconstruction measures the observed cadence, and when it disagrees with the
header by more than 15% it **suppresses gap detection and marks the file
untrustworthy** rather than emitting a spurious gap for every ordinary
interval. (Correct headers measure ~0% disagreement, so the threshold separates
the two populations with wide margin.) The check needs at least 20 batches, so
a few genuine dropouts are never mistaken for a wrong header.

---

## Measured after

### V2 raw recordings (6 files, 6.63 M samples)

| | Before | After |
|---|---|---|
| Duplicate timestamps | 72,383 (1.09%) | **0** |
| Unique timestamps | 6,565,883 | **6,628,752 (all)** |
| Strictly monotonic files | **0 / 6** | **6 / 6** |
| Largest correction applied | — | 230.8 ms (the 25-sample stall) |

Gaps detected: **3,719**, implying **7,874 dropped samples — 0.12% of the
corpus.** Per file:

| File | Samples | Dup % | Longest run | Stalls | Gaps | Missing |
|---|---|---|---|---|---|---|
| `3_19_2026_49535472` | 38,802 | 0.86% | 10 | 71 | 24 | 48 |
| `3_24_2026_54119728` | 936,745 | 0.90% | 16 | 1,203 | 378 | 758 |
| `4_25_2026_23923024` | 1,777,119 | 1.23% | 25 | 2,733 | 1,175 | 2,551 |
| `5_21_2026_54030254` | 616,677 | 0.73% | 14 | 751 | 121 | 242 |
| `5_30_2026_29857045` | 1,757,356 | 1.19% | 22 | 2,635 | 1,129 | 2,426 |
| `6_14_2026_29348131` | 1,502,053 | 1.09% | 21 | 2,121 | 892 | 1,849 |

Every reconstructed series is strictly monotonic, and outside flagged gaps no
sample moves further from its stored value than the longest run in that file
permits.

### V1 recordings (33 files, 1.15 M samples)

No duplicates to fix (single-sample reads throughout), so timestamps are
unchanged. 9 files with trustworthy headers show **1,096 gaps / 36,030 missing
samples** — real, small dropouts of roughly 0.5–1.5%. The other 24 are flagged
for the header/data rate mismatch above.

### Merged files (3 files, 2.32 M samples)

No duplicates — but not because the loop never stalled. **`VTXMerger`
deduplicates on exact timestamp match** (`merger.ts:99-110`), so it silently
discarded the backlog samples that shared a timestamp. Reconstruction now flags
what is left: 3,013 gaps. One file shows a 743k-sample gap, which is the
join between two separate recording sessions rather than data loss.

**Implication worth acting on separately:** merging before reconstructing
destroys the batch structure this algorithm depends on, and throws away real
samples. Reconstruct first, then merge. That reordering is out of scope here
and is not yet done.

---

## What this does not buy

**The ~1 ms quantization in the source data is irreducible in
post-processing.** This is the honest headline, and it should be stated plainly
rather than buried.

Reconstruction places samples *within* a batch. It cannot make a batch's own
anchor more precise than the clock that recorded it. Every anchor is a
`millis()` value with 1 ms resolution against a 9.615 ms period, so
per-sample timing remains accurate to roughly ±1 ms — about 10% of a sample
period — no matter what is done offline. Recovering better than that requires
a finer timestamp *at capture* (`micros()`, or a hardware timer latched on the
data-ready interrupt). That is a firmware change, explicitly out of scope.

Also not addressed:

- **Interrupt-driven acquisition.** A legitimate alternative (INT1 data-ready
  into an ISR that timestamps at a known point relative to sample arrival),
  deliberately not pursued — see Module 2e. The trade: polling with FIFO
  headroom costs ~1 ms of timing accuracy and avoids ISR complexity,
  shared-buffer synchronization, and a class of bug that is miserable to debug
  on a sealed device.
- **The dropped samples themselves.** Gaps are located and counted, never
  filled. Interpolating across them would fabricate data.
- **Which consumers should adopt this.** Nothing in the app or web pipeline
  calls the new API yet; it is opt-in and unwired by design. Braking detection
  (0.75 s windows / 0.2 s hop) and FIT–VTX alignment benefit most; windowed RMS
  over 3.0 s barely notices.
- **The merge ordering issue** described above.
- **Hardware validation.** Like the clock-drift work, this is verified against
  recorded corpus data, not against an independent timing reference.

---

## Tests

`packages/vtx-parser/__tests__/timestamp-reconstruction.test.ts` and
`packages/vtx-parser/python/tests/test_timestamp_reconstruction.py` — 46 tests
per language, mirrored, covering:

- Synthetic batches with exactly known expected output
- Duplicate runs of length 1, 2, 10, and 25 (the measured worst case)
- **Dropped samples: gap detected and flagged, not interpolated** — plus the
  explicit demonstration that a drop perturbs one interval rather than
  everything downstream
- Quantization (9/10/11 ms) not mistaken for a gap
- Degenerate inputs: zero samples, one sample, all-identical timestamps,
  non-monotonic input, invalid sample rate — all reported, none throwing
- Rate taken from the header; 104 Hz assumptions never applied to a 20 Hz file
- Header/data rate mismatch detection and gap suppression
- Non-destructive behavior and unchanged default decode
- Composition with `computeClockDrift()` without double-counting
- Real V2 recordings: monotonicity, bounded deviation from stored times outside
  gaps, duplicates eliminated

**Suite status: 149 TypeScript, 138 Python, 44 firmware — all passing.**
(Baselines were 103 / 92 / 44.)
