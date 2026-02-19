# RFC 011: Longitudinal Metrics and Trends Infrastructure

**Status:** Draft
**Created:** 2026-02-15

## Summary

Add infrastructure for cross-ride trends and longitudinal analysis. A new `ride_summaries` table stores a flat row of scalar metrics per ride, computed by the existing Inngest pipeline. A trends API queries across summaries to return time-series for any metric. This lets us surface IMU-derived insights that Strava/TrainingPeaks cannot — technique progression, body position patterns, and eventually braking/cornering scores — all tracked over weeks and months.

## Motivation

Per-ride analytics (efficiency %, standing time) are interesting once but don't answer the questions that keep riders coming back:

- "Is my pedaling technique actually improving?"
- "Do I stand more on longer rides? At higher cadences?"
- "How does today's efficiency compare to my last month?"

These require comparing across rides. Today we have no way to do that — `ride_analysis` stores full time-series JSONB per ride, which is expensive to query across and impossible to aggregate efficiently.

The competitive angle: Strava and TrainingPeaks own power/HR/pace longitudinal analysis. We can't out-execute them there, and we shouldn't try. But they have zero IMU data. Our moat is technique metrics derived from accelerometer + gyro — efficiency, position, and future metrics like braking smoothness and cornering stability — tracked over time.

## Design

### 1. `ride_summaries` Table

One row per ride. Flat, typed columns — no JSONB. Queryable, indexable, aggregatable with plain SQL.

```sql
CREATE TABLE ride_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id UUID NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Ride context (denormalized from rides table for query efficiency)
  ride_started_at TIMESTAMPTZ NOT NULL,  -- Full timestamp preserves ordering for multi-ride days
  duration_seconds BIGINT NOT NULL,
  distance_meters REAL,
  elevation_gain_meters REAL,

  -- FIT-derived basics (from recordings.analysis_results)
  avg_speed_ms REAL,
  avg_heart_rate REAL,
  avg_power_watts REAL,
  avg_cadence REAL,
  max_heart_rate REAL,
  max_power_watts REAL,
  max_cadence REAL,
  normalized_power_watts REAL,        -- Future: NP calculation

  -- IMU-derived: Pedaling Efficiency (from ride_analysis)
  avg_efficiency_percent REAL,        -- 0-100
  smooth_percent REAL,                -- % time efficiency > 70
  rough_percent REAL,                 -- % time efficiency < 50
  pedaling_percent REAL,              -- % time pedaling (cadence > 0)

  -- IMU-derived: Riding Position (from ride_analysis)
  standing_percent REAL,              -- % pedaling time standing
  seated_percent REAL,                -- % pedaling time seated
  avg_cadence_standing REAL,
  avg_cadence_seated REAL,

  -- IMU-derived: Future metrics (nullable, populated as algorithms ship)
  braking_smoothness_score REAL,      -- Future
  cornering_stability_score REAL,     -- Future
  sprint_count INTEGER,               -- Future
  avg_sprint_power_watts REAL,        -- Future

  -- Algorithm versioning (per-metric, nullable when metric not yet computed)
  efficiency_version TEXT,            -- Version of efficiency algorithm used
  position_version TEXT,              -- Version of position algorithm used
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT ride_summaries_ride_unique UNIQUE (ride_id)
);

-- Query patterns: user's rides ordered by date, filtered by date range
CREATE INDEX idx_ride_summaries_user_date ON ride_summaries(user_id, ride_started_at DESC);
-- Aggregation queries
CREATE INDEX idx_ride_summaries_user_id ON ride_summaries(user_id);
```

**Why flat columns instead of JSONB?**

- `SELECT AVG(avg_efficiency_percent) FROM ride_summaries WHERE user_id = $1 AND ride_started_at > $2` is a single index scan
- JSONB would require `(metadata->>'avgEfficiencyPercent')::real` casts in every query, no index benefit, and fragile key naming
- Adding a column is a cheap `ALTER TABLE ADD COLUMN` — same migration cost as adding a JSONB key, but with type safety and indexability
- The table will have at most ~1000 rows per user (years of daily riding). This is not a scale problem.

**Why `ride_started_at TIMESTAMPTZ` instead of `DATE`?**

If a rider does a morning and evening ride on the same day, `DATE` loses the ordering. `TIMESTAMPTZ` preserves it. Grouping by date/week is still trivial with `DATE_TRUNC`. The column is denormalized from `rides.start_time`.

**Why denormalize `user_id` and ride context?**

The trends API queries `ride_summaries` exclusively. Joining through `rides` on every request adds latency and complexity for no benefit. The `user_id` column also enables RLS without a subquery. FIT stats are denormalized from `recordings.analysis_results` for the same reason.

### 2. Summary Computation

Extend the existing `calculatePedalingEfficiencyJob` Inngest function. After writing to `ride_analysis`, upsert `ride_summaries`:

```
Event: ride/vtx.merged
  ↓
[calculatePedalingEfficiencyJob] (existing)
  Step 1: Check existing analyses (existing)
  Step 2: Compute efficiency + position (existing)
  Step 3: Store in ride_analysis (existing)
  Step 4: Upsert ride_summaries ← NEW
```

Step 4 logic:
1. Read efficiency metadata from step 2 result (already in memory)
2. Read position metadata from step 2 result (already in memory)
3. Query ride context from `rides` table (`start_time`, `duration_seconds`, `distance_meters`, `elevation_gain_meters`)
4. Query FIT summary stats from `recordings.analysis_results` JSONB — `avg_heart_rate`, `avg_power_watts`, `avg_cadence`, `max_heart_rate`, `max_power_watts`, `max_cadence`, `avg_speed_ms`. These are already computed during FIT parsing (`parse-fit.ts`) and stored per-recording. Read from the FIT recording associated with the ride.
5. Upsert into `ride_summaries` with `efficiency_version` and `position_version` from the analysis algorithms used

FIT stats are nullable — rides without a FIT file (VTX-only) get null for those columns. The summary row is still created with IMU-derived metrics.

**Backfill:** A one-time script iterates all rides with `completed` analyses in `ride_analysis`, extracts metadata, and populates `ride_summaries`. The script should also join through `recordings` to pull FIT summary stats for rides that have them. Older `ride_analysis` rows may have different metadata shapes — the backfill should handle missing fields gracefully by inserting nulls for any field not present.

### 3. Trends API

```
GET /api/trends?metric=efficiency&period=8w
GET /api/trends?metric=standing&period=6m
GET /api/trends?metric=efficiency,standing&period=12w
```

**Metric allowlist:** The API accepts friendly metric names, not raw column names. This decouples the client from the schema and prevents SQL injection.

| API name | Column | Unit | Trend thresholds (per week) |
|----------|--------|------|----------------------------|
| `efficiency` | `avg_efficiency_percent` | % (0-100) | stable: ±0.5 pp |
| `smooth` | `smooth_percent` | % | stable: ±1.0 pp |
| `rough` | `rough_percent` | % | stable: ±1.0 pp |
| `pedaling` | `pedaling_percent` | % | stable: ±2.0 pp |
| `standing` | `standing_percent` | % | stable: ±1.0 pp |
| `avg_hr` | `avg_heart_rate` | bpm | stable: ±1.0 bpm |
| `avg_power` | `avg_power_watts` | W | stable: ±3.0 W |
| `avg_cadence` | `avg_cadence` | rpm | stable: ±1.0 rpm |

Each metric has its own threshold for `"stable"` vs `"improving"`/`"declining"` — 0.5 percentage points per week is meaningful for efficiency but noise for standing percent.

**Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `metric` | string (CSV) | required | Metric name(s) from allowlist above |
| `period` | string | `8w` | Lookback: `4w`, `8w`, `3m`, `6m`, `1y`, `all` |
| `group_by` | string | `ride` | `ride` (per-ride points) or `week` (weekly averages) |

**Response:**
```json
{
  "metrics": {
    "efficiency": {
      "points": [
        { "date": "2026-02-01T08:30:00Z", "value": 62.3, "rideId": "...", "rideName": "Morning Loop" },
        { "date": "2026-02-03T17:15:00Z", "value": 65.1, "rideId": "...", "rideName": "Hill Repeats" }
      ],
      "stats": {
        "current": 65.1,
        "periodAvg": 63.2,
        "periodMin": 58.4,
        "periodMax": 68.9,
        "trend": 0.4,
        "trendDirection": "improving"
      }
    }
  },
  "period": { "start": "2025-12-21", "end": "2026-02-15" },
  "rideCount": 24,
  "algorithmVersions": {
    "efficiency": { "versions": ["3.0.0"], "mixed": false },
    "standing": { "versions": ["1.0.0", "1.1.0"], "mixed": true }
  }
}
```

**`stats.trend`**: Slope of linear regression over the period, in units per week. Sign indicates direction. `trendDirection` is a human-readable label derived from the metric-specific threshold: `"improving"`, `"declining"`, `"stable"`.

**`algorithmVersions`**: For each requested metric, lists the distinct algorithm versions present in the returned data. When `mixed: true`, the client should display a notice: "Some rides were analyzed with different algorithm versions. Trends may reflect algorithm changes, not just riding changes." This lets us iterate fast on algorithms without hiding data — the user sees everything but knows when to take trends with a grain of salt.

**`group_by=week`**: Returns `{ "week": "2026-W06", "value": 64.2, "rideCount": 3 }` instead of per-ride points. Useful for smoothing noisy metrics over longer periods.

**Implementation:** Single SQL query per metric:

```sql
SELECT
  ride_started_at as date,
  avg_efficiency_percent as value,
  efficiency_version,
  ride_id,
  r.name as ride_name
FROM ride_summaries rs
JOIN rides r ON r.id = rs.ride_id
WHERE rs.user_id = $1
  AND rs.ride_started_at >= NOW() - INTERVAL '8 weeks'
  AND avg_efficiency_percent IS NOT NULL
ORDER BY rs.ride_started_at ASC
```

The `IS NOT NULL` filter skips rides where the metric wasn't computed (e.g. VTX-only rides querying HR, or rides before a metric algorithm existed). The version column is collected per-row and aggregated in the API layer to build `algorithmVersions`.

Weekly grouping:

```sql
SELECT
  DATE_TRUNC('week', ride_started_at) as week,
  AVG(avg_efficiency_percent) as value,
  COUNT(*) as ride_count
FROM ride_summaries
WHERE user_id = $1
  AND ride_started_at >= NOW() - INTERVAL '8 weeks'
  AND avg_efficiency_percent IS NOT NULL
GROUP BY DATE_TRUNC('week', ride_started_at)
ORDER BY week ASC
```

Trend calculation (linear regression) runs in the API layer on the returned points — not worth a SQL function for <1000 points.

### 4. Ride Summary on Ride Detail Page

Surface the "so what" immediately on each ride. Add a summary bar to the ride detail page showing key metrics with context:

```
Efficiency: 65.1%  ▲ +1.9 vs 8-week avg (63.2%)
Standing:   12.3%  ▼ -3.1 vs 8-week avg (15.4%)
```

This requires one additional query when loading a ride: fetch the user's rolling averages from `ride_summaries`. This can be a single query:

```sql
SELECT
  AVG(avg_efficiency_percent) as avg_efficiency,
  AVG(standing_percent) as avg_standing
FROM ride_summaries
WHERE user_id = $1
  AND ride_started_at >= NOW() - INTERVAL '8 weeks'
  AND ride_id != $2  -- Exclude current ride
```

### 5. RLS Policy

```sql
ALTER TABLE ride_summaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own summaries" ON ride_summaries
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Service role can manage all summaries" ON ride_summaries
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);
```

Only service role writes (via Inngest). Users only read.

## Features: What We Can Build Now

With efficiency + position summaries across rides:

1. **Efficiency trend line** — "Your pedaling efficiency over the last 8 weeks" on dashboard. Simple line chart. The single most compelling proof that longitudinal analysis works.

2. **Per-ride comparison bar** — On ride detail: "65.1% efficiency (▲ +1.9 vs your 8-week avg)". Zero new UI complexity, massive context gain.

3. **Standing time by ride duration** — Scatter plot: ride duration vs standing %. Shows whether the rider fatigues into standing on longer rides. Nobody else can surface this.

4. **Efficiency by cadence band** — Does the rider pedal smoother at 85 RPM vs 95 RPM? Requires storing `avg_cadence` in summary (already planned). Group rides by cadence band, compare efficiency.

5. **Weekly summary digest** — "This week: 3 rides, avg efficiency 64%, standing 11%. Last week: 4 rides, 61%, 14%." Could be a dashboard card or even an email.

## Features: What We Should Build (Require New Algorithms)

These are the metrics that expand the IMU moat. Each one slots into `ride_summaries` as a new column and immediately gets trends + comparisons for free.

1. **Braking smoothness** — Score based on longitudinal deceleration patterns. Smooth braking = progressive, modulated. Harsh braking = sudden, late. Useful for MTB skills progression. *Algorithm: high-pass filtered X-axis deceleration events, score based on onset rate and duration distribution.*

2. **Cornering stability** — Score based on lateral acceleration consistency through turns. Stable = smooth lean, consistent g-force. Unstable = corrections, wobble. *Algorithm: detect turns via gyro yaw rate, score lateral acceleration variance within each turn, aggregate.*

3. **Sprint detection and power proxy** — Count acceleration events above threshold. Without a power meter, acceleration magnitude × known bike mass approximates instantaneous power. *Algorithm: detect bursts in longitudinal acceleration above threshold lasting >3s, count and score.*

4. **Climbing technique score** — Composite of efficiency-on-grade + position-on-grade. "You stand on grades >8% and your efficiency drops 15% when you do." Requires correlating IMU metrics with FIT grade data per-sample, then summarizing. *Mostly a metadata enrichment of existing data — the per-sample data already has grade + efficiency + position.*

5. **Fatigue detection** — Efficiency trend within a single ride, then tracked across rides. "Your efficiency drops 12% in the last 20 minutes. 8 weeks ago it dropped 18%." *Algorithm: split ride into quartiles by time, compute efficiency per quartile, store as `efficiency_q1`..`efficiency_q4` in summary.*

## Migration

```sql
-- 007_ride_summaries.sql
-- See schema in Section 1 above
```

The migration adds the table, indexes, and RLS. No changes to existing tables.

## Implementation Order

1. **Migration + table** — Create `ride_summaries`
2. **Inngest step 4** — Upsert summary after analysis completes
3. **Backfill script** — Populate from existing `ride_analysis` metadata
4. **Trends API** — `GET /api/trends`
5. **Ride detail comparison bar** — Per-ride "vs your average"
6. **Dashboard trend chart** — Efficiency over time

Steps 1-3 are infrastructure (no UI). Step 4 is a single API route. Steps 5-6 are the first user-facing value.

## Not Changed

- `ride_analysis` — Still stores full time-series for per-ride charts. `ride_summaries` is a separate, complementary table.
- `rides` — No schema changes. Context fields are denormalized into summaries.
- Existing API routes — No changes. Trends API is additive.
- Inngest event flow — Same events, just an additional step in the existing job.

## Resolved Decisions

1. **FIT summary stats:** Computed in the same Inngest job (Step 4). FIT stats are already available in `recordings.analysis_results` from the `parse-fit` job — Step 4 reads them from there. No re-parsing of FIT files. Rides without FIT data get nulls for those columns.

2. **Algorithm versioning:** Per-metric version columns (`efficiency_version`, `position_version`, future `braking_version` etc.). All data is included in trends regardless of version — we don't gate queries by version. Instead, the trends API returns `algorithmVersions` metadata so the client can inform the user when trend data spans algorithm changes. This lets us iterate on algorithms without hiding historical data, while being transparent about comparability.

3. **Retention:** `ride_summaries` grows linearly with rides. At ~500 bytes per row and <1000 rides per active user, this is <500KB per user. Not a concern for years.

## Open Questions

1. **Trends UI location:** Where does the trends chart live? Options: (a) new section on the existing dashboard below recent rides, (b) dedicated `/trends` page, (c) both — summary card on dashboard linking to full page. Leaning toward (a) initially, expand to (b) when we have enough metrics to warrant a full page.
