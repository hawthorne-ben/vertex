# RFC 002: Ride List & Ride Detail Screens

## Problem

The Rides tab is a placeholder with three hardcoded mock rides. There is no way to view real ride data, derived metrics, or route maps in the mobile app. The web app has a full ride visualization suite (route map, efficiency/position overlays, FIT metric charts, trend comparisons) — we need to bring a useful subset to mobile.

## Scope

Build a **Ride List** and **Ride Detail** screen in the mobile app, backed by the existing Next.js API layer. This RFC covers the initial implementation — not full feature parity with the web app.

---

## Current State

| Concern | Status |
|---------|--------|
| **Ride list** | Mock data, no API calls |
| **Ride detail screen** | Does not exist |
| **API endpoints** | All ride endpoints exist and use Bearer token auth (same pattern the upload flow already uses) |
| **Ride list API** | No REST list endpoint — web uses direct Supabase queries in Server Components |
| **Mapping library** | Not installed. `docs/MAPS_SETUP.md` exists but was never implemented. No `react-native-maps` in package.json |
| **RoutePolylines / overlays** | Web-only, built on Leaflet (`ride-map.tsx`). Not portable to React Native as-is |
| **Charting** | Web uses uPlot. Mobile has existing IMU charts in DataDetailScreen (what library?) |
| **Navigation** | `RootStackParamList` has no `RideDetail` entry |

---

## Proposal

### Phase 1: Ride List (API + UI)

#### New API endpoint: `GET /api/rides`

The web app fetches rides via direct Supabase in a Server Component. Mobile needs a REST endpoint. Add:

```
GET /api/rides
Authorization: Bearer <token>
Response: { rides: Ride[] }
```

Returns rides ordered by `start_time` desc, with summary fields: `id`, `name`, `start_time`, `end_time`, `duration_seconds`, `distance_meters`, `elevation_gain_meters`, `fit_recording_id`. Include `analysis_results` from the FIT recording join (same query as `web/src/app/rides/page.tsx`).

#### Ride List Screen

Replace mock data in `RidesScreen.tsx`:
- Fetch from `/api/rides` using the existing auth token pattern (see upload flow in syncStore)
- Show ride cards with: name, date, distance, duration, elevation gain
- Show ride status badge (uploaded → parsing → ready / failed) using existing `RecordingStatus` type
- Pull-to-refresh
- Empty state when no rides
- Loading skeleton
- Tap navigates to RideDetail

### Phase 2: Ride Detail Screen

#### New screen: `RideDetailScreen.tsx`

Add to `RootStackParamList`:
```typescript
RideDetail: { rideId: string }
```

**Sections:**

1. **Header** — Ride name, date, status badge
2. **Quick Stats** — Distance, duration, elevation gain, avg speed, max speed (from existing ride record + FIT samples metadata)
3. **Route Map** — GPS track polyline on a map (Phase 2a, see Map section below)
4. **Performance Charts** — Power, HR, cadence, speed over time (from `/api/rides/[id]/samples`)
5. **Derived Metrics Cards** — Pedaling efficiency avg, smooth %, standing % (from `/api/rides/[id]/pedaling-efficiency` and `/api/rides/[id]/riding-position`)
6. **Trend Comparison** — Current ride vs 8-week rolling average (from `/api/trends`)

**Data fetching:** Use the existing endpoints — they all support Bearer token auth already. Poll for derived metrics status (pending → processing → completed) same as web's `useDerivedMetric` hook, but simpler.

### Phase 2a: Route Map

**Option A: `react-native-maps`** (Google Maps on Android, Apple Maps on iOS)
- Most mature RN mapping library
- Supports polylines natively via `<Polyline>` component
- Requires Google Maps API key for Android
- `docs/MAPS_SETUP.md` already documents this approach

**Option B: `@rnmapbox/maps`** (Mapbox GL)
- Better tile styling, matches web dark/light theme more easily
- Free tier generous for small user base
- Requires Mapbox access token

#### RoutePolylines: Fork or Abstract?

The web's `RoutePolylines` component (`ride-map.tsx:405-594`) is tightly coupled to Leaflet:
- Uses `L.polyline()`, Leaflet event handlers, `useMap()` hook
- The *logic* is portable: gap detection (>10s between GPS points), segment color calculation, overlay building (`buildOverlaySegments`)
- The *rendering* is not portable

**Recommendation: Extract shared logic, separate renderers.**

Create a shared utility (could live in a `shared/` package or just be duplicated initially):
- `buildRouteSegments(gpsPoints, maxGapSeconds)` → segments with gap detection
- `buildOverlaySegments(gpsPoints, colorFn)` → colored segments for efficiency/position/stats
- Color scale functions (efficiency gradient, percentile gradient)

Then each platform has its own thin renderer:
- Web: Leaflet polylines (existing)
- Mobile: `react-native-maps` `<Polyline>` components

For the initial mobile implementation, **start with a single-color route polyline** (no overlays). Colored overlays can follow once the basic map works.

### Phase 3 (Future, out of scope)

- Segmentation overlays on mobile map (colored efficiency/position/stats overlays)
- Elevation profile chart
- IMU sensor tabs (orientation, acceleration, rotation)
- Ride editing (name, notes)
- Sparkline trends on ride list cards
---

## API Readiness Summary

| Endpoint | Exists? | Mobile-ready? |
|----------|---------|---------------|
| `GET /api/rides` (list) | **No** | Needs to be created |
| `GET /api/rides/[id]/samples` | Yes | Yes (Bearer auth) |
| `GET /api/rides/[id]/vtx-samples` | Yes | Yes |
| `GET /api/rides/[id]/pedaling-efficiency` | Yes | Yes |
| `GET /api/rides/[id]/riding-position` | Yes | Yes |
| `GET /api/trends` | Yes | Yes |
| `POST /api/upload/recording` | Yes | Already used by mobile |
| `POST /api/recordings/check-sync` | Yes | Already used by mobile |
| `DELETE /api/rides/[id]` | Yes | Yes |

Only one new endpoint is needed: **ride list**.

---

## Technical Decisions

| Decision | Recommendation |
|----------|---------------|
| **State management** | Zustand store (`rideStore.ts`), consistent with `dataStore`, `syncStore` |
| **API client** | Thin fetch wrapper reusing auth pattern from upload flow |
| **Charting library** | `react-native-gifted-charts` (already installed, used by DataDetailScreen) |
| **Map library** | `@rnmapbox/maps` — visual consistency with web's Leaflet/OSM tiles |
| **Route logic sharing** | Extract gap detection + color math to pure functions; duplicate for now, monorepo shared package later |
| **Navigation** | Add `RideDetail` to `RootStackParamList`, push from RidesScreen |

---

## Decisions

1. **Map library:** `@rnmapbox/maps` (Mapbox GL). Aim for visual consistency with the web's Leaflet/OSM tile aesthetic. Mapbox supports custom styles for dark/light mode parity.

2. **Charting library:** Use existing `react-native-gifted-charts` for now. Already installed and used for IMU charts in DataDetailScreen. Revisit if performance is insufficient for large ride datasets.

3. **Ride list API:** Add `GET /api/rides` to Next.js API routes. Refactor web's rides page to use the same endpoint (currently queries Supabase directly in Server Component). Single source of truth for ride list query logic.

4. **Derived metrics polling:** Same 3-second polling as web. Ensure polling stops immediately when status reaches `completed` or `failed` — no unnecessary requests after data is already fetched.

5. **Ride card richness:** Include mini-metrics (avg power, efficiency score, etc.) — all the same data as web, though layout may differ for mobile form factor.

6. **Offline/caching:** Implement caching. Cache ride list and detail data locally for offline viewing.
