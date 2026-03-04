# RFC 010: Garmin & Wahoo Automatic Upload Integration

**Status:** Draft
**Author:** Ben Hawthorne
**Created:** 2026-03-02
**Related RFCs:** None

## Summary

Integrate with Garmin Connect and Wahoo Cloud APIs to automatically receive .fit activity files when users complete rides. Users link their accounts via OAuth, and new activities are pushed to our webhook endpoints — no manual export/upload required.

## Motivation

Currently, users must manually export .fit files from their device ecosystem (Coros app, Garmin Connect, etc.) and upload them via the web app. This is the biggest friction point in the user workflow. Garmin and Wahoo both offer push-based APIs that deliver the original .fit file (with all raw fields preserved) immediately after a ride syncs.

Target user base is primarily Garmin and Wahoo users. Coros lacks a public developer API, but most Coros users can be served indirectly via Strava (with the caveat that Strava strips raw .fit fields — see Limitations).

## Architecture

```
User links account (one-time)
──────────────────────────────
Browser → OAuth redirect → Garmin/Wahoo → Callback with auth tokens → Store in DB

Activity auto-sync (ongoing)
──────────────────────────────
User finishes ride → Device syncs to Garmin/Wahoo cloud
                     → Garmin/Wahoo POST .fit file to our webhook
                     → Parse .fit, store in Supabase Storage + create DB record
                     → User sees ride in Vertex dashboard (no action required)
```

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
  provider text not null, -- 'garmin' | 'wahoo'
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
- Show Garmin / Wahoo cards with Connect / Disconnect buttons
- Connected state shows provider username and last sync time
- Rides from integrations are tagged with source icon in ride list

## Implementation Order

1. **Wahoo first** — OAuth 2.0 is simpler, faster to implement and validate the full pipeline
2. **Garmin second** — Larger user base, but OAuth 1.0a adds complexity
3. **Strava (future)** — Catch-all for other ecosystems, but doesn't preserve raw .fit fields

Estimated effort: ~1 weekend per integration once the shared infrastructure (DB schema, webhook handling, .fit parsing pipeline) is in place from the first one.

## Limitations

- **Coros** — No public developer API. Users would need to manually upload or sync via Strava (which strips raw .fit fields like pedal smoothness, torque effectiveness, power phase)
- **Strava** — Provides normalized streams only, not original .fit files. Sufficient for basic metrics (power, HR, GPS) but loses niche power meter fields
- **Garmin OAuth 1.0a** — More complex than OAuth 2.0, requires request signing. Well-documented but annoying
- **Webhook reliability** — Need retry/dead-letter handling for failed webhook deliveries. Both APIs support backfill/re-push

## Open Questions

- Do we want to auto-import all activities or let users filter by type (ride, run, etc.)?
- Should imported rides be editable/deletable independently from the source?
- Do we need bi-directional sync (push Vertex IMU data back to Garmin/Wahoo)?
- How do we handle users who have both Garmin + Wahoo recording the same ride (dedup by time window)?
