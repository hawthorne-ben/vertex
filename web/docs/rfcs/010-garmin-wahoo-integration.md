# RFC 010: Third-Party Activity Integration (TrainingPeaks, Garmin, Wahoo)

**Status:** Draft
**Author:** Ben Hawthorne
**Created:** 2026-03-02
**Updated:** 2026-03-16
**Related RFCs:** None

## Summary

Integrate with third-party fitness platforms to automatically receive activity data when users complete rides. Users link their accounts via OAuth, and new activities are delivered via webhooks — no manual export/upload required.

**Priority order:** TrainingPeaks first (Coros/universal coverage, OAuth 2.0), then Garmin (largest user base), then Wahoo, then Strava as a future catch-all.

## Motivation

Currently, users must manually export .fit files from their device ecosystem (Coros app, Garmin Connect, etc.) and upload them via the web app. This is the biggest friction point in the user workflow.

Coros (the primary dev device) lacks a public API, but auto-syncs to TrainingPeaks. TrainingPeaks provides parsed activity streams via API — not raw .fit files, but sufficient for all core metrics (power, HR, cadence, speed, GPS, elevation). Garmin and Wahoo offer push-based APIs that deliver the original .fit file with all raw fields preserved.

## Architecture

```
User links account (one-time)
──────────────────────────────
Browser → OAuth redirect → Provider → Callback with auth tokens → Store in DB

Activity auto-sync (ongoing)
──────────────────────────────
User finishes ride → Device syncs to provider cloud
                     → Provider POSTs webhook notification
                     → We fetch activity data (.fit file or parsed streams)
                     → Store in Supabase Storage + create DB record
                     → User sees ride in Vertex dashboard (no action required)
```

## TrainingPeaks API

### Registration

- Developer access request at api.trainingpeaks.com/request-access
- **Approval-only** — must describe company and use case, 7-10 day review
- Intended for commercial fitness apps (personal use prohibited)
- Sandbox environment available for dev/testing

### Auth

- **OAuth 2.0** Authorization Code Grant (3-legged)
- Authorize: `https://oauth.trainingpeaks.com/OAuth/Authorize`
- Token: `https://oauth.trainingpeaks.com/oauth/token`
- **Access tokens expire in 10 minutes** — aggressive refresh required
- Refresh tokens provided; HTTP 401 = expired, HTTP 400 on refresh = user revoked
- Scopes are non-inclusive (e.g., `workouts:details` does NOT include `workouts:read`)
- Required scopes: `workouts:read`, `workouts:details`, `webhook:read-subscriptions`, `webhook:write-subscriptions`

### Activity Data

- **No raw .fit file download** — API provides parsed JSON streams only
- `GET v2/workouts/{start}/{end}` — workout summaries for date range (scope: `workouts:read`)
- `GET v2/workouts/id/{id}/details` — full time-series streams (scope: `workouts:details`)
  - Channels: cadence, distance, elevation, HR, power, speed, temperature, GPS
  - Includes WorkoutStats, LapStats
  - Sufficient for all core Vertex metrics (power, HR, cadence, speed, GPS, elevation)
  - Missing: raw power meter fields (pedal smoothness, torque effectiveness, power phase)
- `GET v2/workouts/changed?date={date}` — polling fallback for changed workouts

### Webhooks (Early Access)

- `POST v1/webhook/subscriptions` — create subscription (scope: `webhook:write-subscriptions`)
- Events: `workout-created`, `workout-updated`, `workout-deleted`
- Per-athlete, per-event-type subscriptions
- On `workout-created`: fetch workout details via API, convert to our format, store

### Data Quality vs Raw FIT

The workout details endpoint returns 43 channels — remarkably comprehensive. Covers everything Vertex currently uses: GPS, power, HR, cadence, speed, elevation, temperature, grade, L/R balance, pedal smoothness, torque effectiveness, and power phase (L/R start/end/peak).

**Gaps vs raw FIT (minor):**
- No absolute timestamps (only `MillisecondOffset` from start — reconstructible from workout start time)
- No gear shift events
- No accumulated power field
- No raw event messages (TP simplifies to Start/None/Stop)
- No developer fields

**TP adds over raw FIT:**
- NormalizedPower per sample (rolling 30s calculation)
- PowerLeft/PowerRight as separate watt values (FIT only stores balance %)
- TSS, IF, VI in WorkoutStats/LapStats

**vs Strava API (11 channels only):**
Strava strips L/R balance, pedal smoothness, torque effectiveness, power phase, running dynamics, muscle O2. Also has 7-day cache limit, no-AI/ML clause, and no-data-aggregation restriction — incompatible with longitudinal analytics. TP is far superior for data quality.

### Key Implementation Details

- 10-minute token TTL means every API call must check expiry and refresh if needed
- Webhook delivers notification only — we pull the data (like Garmin)
- Convert TP JSON streams → synthetic .fit-like record array for our existing pipeline
- Coros Dura auto-syncs to TP — this is the primary path for Coros users
- Need to handle TP's non-inclusive scopes carefully in OAuth consent screen
- **Blocker: approval-only API access** — apply at api.trainingpeaks.com/request-access, expect 7-10 day review. Framed as B2B/commercial partners only. Deferred pending approval.

## Garmin Connect API

### Registration

- Public developer program at developer.garmin.com
- Self-serve registration, no approval gate for basic access
- Rate limits: TBD (confirm during registration)

### Auth

- **OAuth 1.0a** (not 2.0 — more complex to implement)
- Three-legged flow: request token → user authorization → access token
- Tokens don't expire (no refresh flow needed), but user can revoke

### Activity Push

- Register a webhook URL during app setup
- Garmin POSTs a summary notification when a new activity is available
- We then call `GET /wellness-api/rest/backfill/activityDetails` (or similar) to fetch the actual .fit file
- The push contains: `userId`, `summaryId`, `activityType`, `startTimeInSeconds`
- .fit file is the original device recording with all fields preserved

### Key Implementation Details

- OAuth 1.0a requires signing every request (use a library — `oauth-1.0a` on npm)
- Garmin sends a ping, then we pull the file (not a direct push of file data)
- Need to handle deduplication (same activity could be re-synced)
- Garmin user ID is separate from our user ID — need a mapping table

## Wahoo Cloud API

### Registration

- Public developer program at developers.wahooligan.com
- Self-serve registration
- Smaller user base than Garmin but growing

### Auth

- **OAuth 2.0** (standard, much easier than Garmin)
- Authorization code flow → access token + refresh token
- Tokens expire, refresh flow required

### Activity Push

- Register webhook URL for `workout_summary` events
- Wahoo POSTs workout data directly to webhook when a workout completes
- Payload includes workout summary + link to download .fit file
- .fit file is the original device recording

### Key Implementation Details

- Standard OAuth 2.0 — straightforward with `next-auth` or manual implementation
- Webhook payload includes workout metadata + file download URL
- Need to verify webhook signatures for security

## Database Schema

```sql
-- Third-party account links
create table integration_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  provider text not null, -- 'trainingpeaks' | 'garmin' | 'wahoo'
  provider_user_id text not null,
  access_token text not null,
  refresh_token text, -- null for Garmin (tokens don't expire)
  token_secret text, -- OAuth 1.0a only (Garmin)
  token_expires_at timestamptz, -- null for Garmin
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(provider, provider_user_id)
);

-- Track synced activities to prevent duplicates
create table integration_activities (
  id uuid primary key default gen_random_uuid(),
  integration_account_id uuid references integration_accounts(id) on delete cascade,
  provider_activity_id text not null,
  recording_id uuid references recordings(id),
  synced_at timestamptz default now(),
  unique(integration_account_id, provider_activity_id)
);
```

## API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /api/integrations/tp/connect` | Initiate TrainingPeaks OAuth 2.0 flow |
| `GET /api/integrations/tp/callback` | OAuth callback, store tokens |
| `POST /api/integrations/tp/webhook` | Receive workout-created notifications |
| `GET /api/integrations/garmin/connect` | Initiate Garmin OAuth 1.0a flow |
| `GET /api/integrations/garmin/callback` | OAuth callback, store tokens |
| `POST /api/integrations/garmin/webhook` | Receive activity notifications |
| `GET /api/integrations/wahoo/connect` | Initiate Wahoo OAuth 2.0 flow |
| `GET /api/integrations/wahoo/callback` | OAuth callback, store tokens |
| `POST /api/integrations/wahoo/webhook` | Receive workout push |
| `DELETE /api/integrations/:provider` | Disconnect account |
| `GET /api/integrations` | List connected accounts |

## Web App UI

- **Settings page** → "Connected Services" section
- Show TrainingPeaks / Garmin / Wahoo cards with Connect / Disconnect buttons
- Connected state shows provider username and last sync time
- Rides from integrations are tagged with source icon in ride list

## Implementation Order

1. **TrainingPeaks first** — OAuth 2.0, covers Coros users (primary dev device), validates shared infrastructure
2. **Garmin second** — Largest user base, but OAuth 1.0a adds complexity
3. **Wahoo third** — OAuth 2.0, reuses TP patterns, smaller user base
4. **Strava (future)** — Catch-all for other ecosystems, but doesn't preserve raw .fit fields

Estimated effort: ~1 weekend per integration once the shared infrastructure (DB schema, webhook handling, activity parsing pipeline) is in place from the first one.

## Limitations

- **TrainingPeaks** — Approval-only API access (not self-serve). No raw .fit download — parsed JSON streams only. 10-minute access token TTL requires aggressive refresh. Webhooks are "Early Access" and may change. Missing raw power meter fields (pedal smoothness, torque effectiveness, power phase)
- **Coros** — No public developer API. Best path is Coros → TrainingPeaks auto-sync → our webhook
- **Strava** — Provides normalized streams only, not original .fit files. Sufficient for basic metrics (power, HR, GPS) but loses niche power meter fields
- **Garmin OAuth 1.0a** — More complex than OAuth 2.0, requires request signing. Well-documented but annoying
- **Webhook reliability** — Need retry/dead-letter handling for failed webhook deliveries. All APIs support backfill/re-push

## Open Questions

- Do we want to auto-import all activities or let users filter by type (ride, run, etc.)?
- Should imported rides be editable/deletable independently from the source?
- Do we need bi-directional sync (push Vertex IMU data back to providers)?
- How do we handle users who have multiple providers recording the same ride (dedup by time window)?
- TrainingPeaks API approval: what's the best framing for a small/indie cycling analytics app?
- TP webhook "Early Access" stability: should we implement polling fallback (`workouts/changed`) from day one?
- TP JSON streams → our pipeline: convert to synthetic FIT records or add a separate non-FIT ingest path?
