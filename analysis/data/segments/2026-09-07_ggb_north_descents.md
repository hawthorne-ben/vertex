# Golden Gate Bridge north side → Fort Baker — 3 instrumented descents

**Date:** 2026-09-07
**Recording:** `analysis/data/sample-recordings/9_7_2026_33823744.vtx`
**Device:** V2 (LSM6DS3, 104 Hz), 966,093 records, 156.5 min, header count = actual
**Recording start:** 2026-09-07 10:23:43.808 PDT

The controlled experiment behind the presentation's "measure the difference,
not the absolute" argument. Same rider, same bike, same road, three runs at
deliberately different commitment. Everything that would confound a two-rider
comparison — mass, geometry, mount position, tyre pressure, road surface,
conditions — is held constant. What varies is intent.

## Segment definition

- **Top:** apex of the first corner. Deliberately excludes the lead-in, so the
  window starts with the bike already committed.
- **Bottom:** the point where the road flattens out at Fort Baker.

## The three runs

| Run | Confidence | Top | Bottom | Elapsed | Description |
|---|---|---|---|---|---|
| 1 | **Low** | 10:55:14 (+31:30) | 10:56:33 (+32:49) | **79 s** | Hesitant. Riding the brakes the whole way down. |
| 2 | **Medium** | 11:06:17 (+42:33) | 11:07:15 (+43:31) | **58 s** | Some rolling speed carried. Harder braking before corners, some lean. |
| 3 | **High** | 11:14:01 (+50:17) | 11:14:54 (+51:10) | **53 s** | Full send within reason. Max speed, hard braking, good lean. |

**Offsets in seconds from recording start**, for scripting:

| Run | Top (s) | Bottom (s) |
|---|---|---|
| 1 | 1890 | 1969 |
| 2 | 2553 | 2611 |
| 3 | 3017 | 3070 |

Wall-clock times reconstruct one second earlier than stated (10:55:13 vs.
10:55:14) because the recording starts at `.808` and the display truncates.
Not a discrepancy — the offsets are internally consistent and are the
authoritative values.

## Why this dataset matters

**A 26-second spread across a ~1 minute segment.** Run 1 took 49% longer than
run 3. That is a large, unambiguous difference in outcome, deliberately
produced, with a known ordering of intent — which is exactly what the earlier
Hawk Hill pair lacked (those two were within 1 s of each other over a Strava
segment, so no claim about technique could be attached to the timing).

Three tiers also allow a **monotonicity check**: if a derived metric tracks
commitment, it should order the runs 1 < 2 < 3 (or the reverse), not just
separate the extremes. Two runs cannot show that.

## Caveats to state alongside any result

- **n=1 rider, 1 session, 3 runs.** Fatigue and learning both run in the same
  direction as the intended variable — later runs are both more committed
  *and* more practised on the day. Not separable from this data.
- **Confidence tiers are self-reported**, assigned before the runs but scored
  by the rider. No independent ground truth (no video with timecode on this
  session).
- Elapsed times come from the marked gates, which were read off a 1 Hz GPS
  map slider — roughly ±1 s per gate. The 26 s spread is far outside that;
  the 5 s gap between runs 2 and 3 is not comfortably so.

## Related

- Tooling: `analysis/corner_compare.py`
- Framing: `notes/spacex-presentation-outline.md` → "THE V1 → V2 FRAMING",
  slide 4 in `notes/slide-build-spec.md`
- Prior attempt (2 runs, inconclusive timing): Hawk Hill,
  `5_14_2026_18510832.vtx` and `03-13_155529-174815.vtx`
