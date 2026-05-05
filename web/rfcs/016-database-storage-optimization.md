# RFC 016: Database Storage Optimization

**Status:** Implemented (2026-04-28)
**Created:** 2026-04-28

## Outcome

All four bottlenecks identified in Motivation are resolved. A 4-hour ride that previously could not finish analysis (timed out at 633s on the multi-MB JSONB writes) now completes in ~30s. A 2-hour ride completes in 11s. The Supabase IO Budget alert that prompted this work has not recurred.

The migration was executed as a fresh-project rebuild rather than the dual-write/backfill plan originally drafted (see "Migration Plan — what actually shipped" below). Both dev and prod environments now run the post-RFC-016 schema.

## Summary

Move bulky time-series sample data out of the `ride_analysis` row and into Supabase Storage as compressed blobs. Drop unused JSONB GIN indexes that add write amplification on every analysis upsert. Denormalize `user_id` onto `ride_analysis` and `ride_recordings` so RLS policies can hit a single index instead of an `EXISTS` join. Consolidate the migration history into a clean baseline so fresh environments can be reproduced reliably.

## Motivation

A 4-hour ride upload triggered a Supabase Disk IO Budget alert and made the analyze-ride-imu job hang for 10+ minutes. Investigation found three compounding issues:

1. **`ride_analysis.samples` is a multi-MB JSONB column.** At 5 Hz output for a 4-hour ride, each of the 4 analysis rows holds ~10–20 MB of TOAST data. Every read of *any* column on those rows fights TOAST, and the route handlers were doing `SELECT *` on every status poll. One open ride page polling every 3s = ~16 MB/s sustained read off disk — well above the smallest compute tier's 43 MB/s baseline once you include other traffic.

2. **GIN indexes on JSONB columns nobody queries.** `recordings` has GIN indexes on `gap_info`, `device_info`, and `session_metadata`; `ride_analysis` has one on `metadata`. None of these JSONB columns are queried with containment operators in app code. GIN indexes have steep write amplification — every UPDATE rewrites the pending list and occasionally triggers fastupdate flushes that do random IO. On the analysis hot path (4 upserts per ride plus the parse-fit metadata write) this is pure cost.

3. **RLS policies do per-row `EXISTS` joins.** `ride_analysis`, `ride_recordings`, and `recording_analysis` each check ownership through a subquery against `rides`. On point lookups via PostgREST this can execute as a per-row probe instead of a single semi-join. `ride_summaries` already uses the cheaper `user_id = auth.uid()` pattern; the rest should match.

4. **Migration history is messy.** Two `003_*` files (different topics), three unnumbered SQL files at the migrations root, and an unfollowed plan doc proposing consolidation. Fresh environment setup is currently fragile.

## Goals

- Cut `ride_analysis` per-row size from ~10 MB+ to ~1 KB so polling and listing become trivially cheap.
- Make the chart fetch path Storage-backed so it benefits from CDN caching and never touches Postgres for the bulky data.
- Cut write amplification on the analysis upsert path by removing dead GIN indexes.
- Make RLS evaluation single-table and index-friendly.
- Produce one clean baseline migration plus a forward delta, so fresh environments and dev resets are reliable.

## Non-Goals

- Changing the analysis algorithms themselves.
- Migrating to a different database (TimescaleDB, ClickHouse, Parquet on object storage as primary).
- Partitioning `ride_analysis` or `ride_summaries`. Designed-for, not done.
- Splitting the analyze-ride-imu Inngest job into per-metric functions. Tracked separately.

## Design

### 1. Move `samples` to Storage

Each analysis writes its samples array as a gzipped JSON blob to Supabase Storage:

```
ride-analyses/{user_id}/{ride_id}/{analysis_type}-{algorithm_version}.json.gz
```

The `algorithm_version` in the path makes the blob immutable per `(ride, type, version)` — readers can set `Cache-Control: public, immutable, max-age=31536000`. Recomputes write a new path; the old one becomes garbage to be collected (tracked separately).

`ride_analysis` shape after the change:

```sql
CREATE TABLE ride_analysis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id UUID NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,  -- denorm for RLS
  analysis_type TEXT NOT NULL CHECK (...),
  status TEXT NOT NULL CHECK (...),
  error_message TEXT,
  algorithm_version TEXT NOT NULL,
  parameters JSONB NOT NULL,
  metadata JSONB NOT NULL,            -- summary scalars, small
  samples_path TEXT,                  -- Storage path; null while pending/processing/failed
  samples_size_bytes INTEGER,         -- compressed blob size for cost tracking
  sample_count INTEGER,               -- how many time-series points
  sample_rate_hz REAL,                -- output rate (typically 5)
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ride_analysis_unique UNIQUE (ride_id, analysis_type)
);
```

Effects:

- Per-row size: ~10–20 MB → ~1 KB. Status polls, list queries, summary joins all become cheap.
- Backups shrink. Supabase nightly backups currently include all of this TOAST data.
- The chart fetch path becomes: read tiny row → issue signed-URL GET → decompress in route. The bulky read leaves Postgres entirely.
- gzip on time-series JSON typically saves 70–85%. ~15 MB → ~3 MB. Brotli would do better but isn't necessary.

### 2. Drop unused JSONB GIN indexes

```sql
DROP INDEX IF EXISTS idx_recordings_gap_info;
DROP INDEX IF EXISTS idx_recordings_device_info;
DROP INDEX IF EXISTS idx_recordings_session_metadata;
DROP INDEX IF EXISTS idx_ride_analysis_metadata;
```

If we ever need JSON containment search later, these can be added back in minutes. They're insurance we're not collecting on.

### 3. Denormalize `user_id` for RLS

Add `user_id` to `ride_analysis` and `ride_recordings`, backfill from `rides`, set NOT NULL, replace the `EXISTS` policies with `user_id = auth.uid()`. Match the pattern `ride_summaries` already uses.

### 4. Consolidate migration history

Produce two files going forward:

- `migrations/baseline.sql` — current shape of the database after RFC 016 lands. The single source of truth a fresh environment runs to get caught up. **Not** numbered; used for new envs only.
- `migrations/010_storage_optimization.sql` — the forward delta from `009_braking_analysis.sql` to the new shape. Run by existing environments.

Existing numbered migrations (001–009) are preserved as-is for historical reference but are not run on fresh setups (the baseline supersedes them). The unnumbered files (`cleanup_ride_associations.sql`, `create_uploads_bucket.sql`, `validate_recordings_bucket.sql`) move to `migrations/utilities/` since they're one-off scripts, not migrations.

The duplicate `003_*` collision is left in place — both already ran against production environments — but the baseline naturally resolves it.

## Migration Plan — what actually shipped

The original draft proposed a six-phase forward migration (additive schema → dual-write → backfill → switch reads → drop policies/indexes → drop `samples` column) designed to be safe under a multi-user production load with historical data that couldn't be re-derived.

In practice, the dataset was a single user with ~30 rides, all derivable from raw VTX/FIT files in Supabase Storage. That made the dual-write/backfill scaffolding unnecessary: a fresh recompute is faster than a careful migration. The actual rollout:

### What we did

1. **Wrote `migrations/baseline.sql`** as the post-RFC-016 schema source-of-truth. Includes the new `samples_path`/`samples_size_bytes`/`sample_count`/`sample_rate_hz` columns on `ride_analysis`, denormalized `user_id` on `ride_analysis` and `ride_recordings`, no JSONB GIN indexes, `user_id = auth.uid()` RLS policies, and the `ride-analyses` Storage bucket. **No `samples` JSONB column** — gone from day one of the new schema.

2. **Wrote `migrations/010_storage_optimization.sql` + `010b_backfill_user_id.sql`** as a forward delta intended for environments running 009. These ended up unused for the actual rollout (see below) but are kept in tree as a reference for any future environment that needs to migrate forward through history.

3. **Dev environment**: nuked the old schema (`DROP TABLE`), ran `baseline.sql` fresh. Resigned-up the user, re-uploaded files for testing.

4. **Application code**: rewrote the four analysis routes, `analyze-ride-imu` Inngest function, and `recompute` route to write samples to Storage (gzipped JSON blobs) and read via `samples_path`. New helper `src/lib/analysis/samples-storage.ts` owns the upload/download path with an LRU cache for decompressed reads. Skipped dual-write entirely — the new code reads and writes Storage exclusively.

5. **Prod environment**: created a new Supabase project (`ombmerkqdnlnimmqvyaz`) with the post-RFC-016 schema. Wrote `scripts/migrate-prod.ts` to copy `recordings`, `rides`, `ride_recordings`, `ride_summaries`, `waitlist` rows + the contents of the `recordings` and `uploads` Storage buckets from the old project, rewriting `user_id` to the new project's freshly-signed-up user. Did **not** copy `ride_analysis` rows — `scripts/recompute-all-rides.ts` regenerates them by firing `ride/vtx.merged` Inngest events.

6. **Old prod project** kept running as a passive backup until the new project was verified. To be deleted after a soak period.

### What was different from the original plan

- **Phase 2 (dual-write) and Phase 3 (backfill) were skipped.** Both existed for the multi-user, can't-lose-data case. Single-user with derivable analyses → fresh recompute is simpler and faster.
- **Phase 6 (`DROP COLUMN samples`) happened by construction**, not by `ALTER TABLE`. The new schema never had the column.
- **Migration ordering issues** caused several debugging cycles during prod rollout — duplicate Vercel env vars pointing at the old project, stale PostgREST schema caches, Inngest memoized step state from failed attempts. Captured in the lessons section below.

## Lessons

- **Vercel env vars don't update from `.env.production`.** Local file changes don't propagate. Use `vercel env ls production` and `vercel env pull` to see what the deployed app actually sees.
- **PostgREST schema cache can stick.** `NOTIFY pgrst, 'reload schema'` doesn't always work on Supabase. A direct PostgREST probe (e.g. `curl -X POST` with the column in question) is the fastest way to verify what the cache sees. If it's actually stale, pause/resume the project forces a hard reload.
- **Supabase web SQL editor has a 20s statement timeout.** Anything that touches multi-MB JSONB rows (e.g. an `UPDATE` on `ride_analysis` that rewrites every row, including TOAST data) blows past it. Run those through psql / CLI instead, or chunk.
- **Inngest memoizes step output across retries.** Cancelling a failed run doesn't always evict the memoized state. After fixing a root cause (env vars, schema, etc.), prefer firing fresh events over retrying old ones.
- **Compute tier matters.** The original Nano-tier project's "unhealthy" status was almost certainly memory pressure from large file decodes in Inngest workers + multi-MB JSONB writes. Micro tier ($10/mo) handles the same load comfortably. Don't pick Nano for anything beyond a marketing demo.

## Rollback

Both environments are now post-RFC-016 with no historical `samples` column to fall back to. Rollback would require:
- Adding `samples` JSONB back to `ride_analysis`.
- A backfill job that reads each row's `samples_path` from Storage, decompresses, writes JSONB.
- Reverting application code to read from JSONB.

The old prod project (`iugsvgldddswexhntsjm`) remains as a passive read-only backup until decommissioned. Until that project is deleted, the worst-case rollback is to point Vercel back at the old project's env vars and re-deploy a pre-RFC-016 git tag.

## Out of scope (future work)

- **Splitting the 4-analysis Inngest job into per-metric functions** so a single failure doesn't block all four. Currently coupled. Acceptable today because runs complete in seconds.
- **Per-analysis writes to `ride_summaries`** — currently coupled to the whole compute step succeeding. If any of the 4 analyses fails, no summary row gets written.
- **Partitioning `ride_analysis` and `ride_summaries`** by date or user. Designed-for-not-done. Future work when row counts grow into the hundreds of thousands.
- **Garbage collection of stale `samples_path` blobs after recompute.** New paths include `algorithm_version`, so old blobs become orphaned in Storage when an analysis is recomputed. No cleanup today.
- **Decommission the old prod project.** Pending soak period on the new one.

## Resolved Open Questions

1. **Compression format.** Shipped as gzip. Decompression cost is invisible in profiling.
2. **Schema for the blob.** Shipped as plain JSON. Adequate for current chart fetch volumes.
3. **Garbage collection of stale blobs.** Deferred — see Out of Scope.
