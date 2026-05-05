# Database Migrations

## Layout

- `baseline.sql` — single source of truth for the current schema. Run on a fresh environment (new dev DB, new staging instance) to bring it to the latest state in one shot. Idempotent.
- `001_*.sql` … `010_*.sql` — historical forward deltas. Run in order against environments that pre-date a given migration. Existing production runs through these.
- `utilities/` — one-off scripts (cleanup, validation). Not migrations; not run automatically.

## Adding a new migration

Two files always change together:

1. Add `NNN_short_description.sql` as the forward delta.
2. Update `baseline.sql` to reflect the new shape.

Keep both idempotent. Use `IF NOT EXISTS` / `IF EXISTS`, drop-then-create for policies, `CREATE OR REPLACE` for functions.

## Running

Fresh environment:
```bash
psql ... < baseline.sql
```

Existing environment that's behind:
```bash
psql ... < migrations/0NN_<the-next-one>.sql
```

## Historical notes

Migrations 001 and 002 overlap (002 was a consolidation attempt that ran alongside 001). Two `003_*` files exist (`003_fix_duration_overflow.sql` and `003_waitlist.sql`) due to a numbering collision; both ran in production and are preserved as-is. The `baseline.sql` resolves all of this — fresh environments do not run the historical numbered files.

The previous `SCHEMA_MIGRATION_PLAN.md` lived here describing a never-completed consolidation effort. It has been moved to `rfcs/archive/SCHEMA_MIGRATION_PLAN_2025.md`. RFC 016 supersedes it.
