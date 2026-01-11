# GPS Overlay Integration Audit

**Date:** January 10, 2026
**Purpose:** Audit database schema and ride page for GPS + IMU data association

---

## Database Schema Status: ✅ READY

### Tables (from 002_unified_schema.sql)

**1. `recordings` table** - Stores both VTX and FIT files
```sql
CREATE TABLE recordings (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  filename TEXT NOT NULL,
  file_type TEXT CHECK (file_type IN ('vtx', 'fit')),
  storage_path TEXT NOT NULL UNIQUE,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  duration_ms INTEGER NOT NULL,
  sample_rate REAL,              -- VTX only
  sample_count BIGINT,            -- VTX only
  device_info JSONB,
  session_metadata JSONB,
  analysis_results JSONB,
  status TEXT,                    -- 'uploaded', 'processing', 'ready', 'failed'
  uploaded_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ
)
```

**2. `rides` table** - User-created rides (from FIT upload)
```sql
CREATE TABLE rides (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  name TEXT NOT NULL,
  description TEXT,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  duration_seconds INTEGER NOT NULL,
  distance_meters REAL,
  elevation_gain_meters REAL,
  bike_type TEXT,
  conditions TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
```

**3. `ride_recordings` table** - Association table (many-to-many)
```sql
CREATE TABLE ride_recordings (
  id UUID PRIMARY KEY,
  ride_id UUID REFERENCES rides(id) ON DELETE CASCADE,
  recording_id UUID REFERENCES recordings(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ,
  CONSTRAINT ride_recordings_unique UNIQUE (ride_id, recording_id)
)
```

**Status:** ✅ Schema fully supports associations
**Migration:** Already applied (002_unified_schema.sql)
**RLS Policies:** ✅ In place and secure

---

## Ride Page Current State

**File:** `/src/app/rides/[id]/page.tsx`

### What's Implemented ✅

1. **Association Query**
   - Lines 20-44: Already queries `ride_recordings` table
   - Fetches associated VTX files via JOIN
   - Separates FIT vs VTX recordings

2. **UI Components**
   - FIT data displayed with GPS map (`RideMapClient`)
   - FIT charts (`RideChartsClient`)
   - VTX file list (lines 294-312)
   - "Add Vertex IMU Data" button (`AddVtxDataButton`)

3. **Data Flow**
   - Reads existing associations from database
   - Displays linked VTX files with "View" links
   - Shows "No IMU data" message if no associations

### What's NOT Implemented ❌

1. **AddVtxDataButton** (`/components/add-vtx-data-button.tsx`)
   - Lines 88-101: **Dummy implementation**
   - Shows toast but doesn't save to database
   - Comment: "This doesn't actually save yet"

2. **IMU Charts on Ride Page**
   - No IMU charts shown (only FIT charts)
   - Would need to add `IMUUPlotCharts` component

3. **GPS Overlay**
   - No combined GPS + IMU visualization
   - Would need new component to overlay data

---

## Gap Analysis

### Missing Components

| Component | Status | Location | Priority |
|-----------|--------|----------|----------|
| **Association API** | ❌ Missing | `/api/rides/[id]/recordings` | HIGH |
| **AddVtxDataButton Save Logic** | ❌ Stub only | `/components/add-vtx-data-button.tsx` | HIGH |
| **IMU Charts on Ride Page** | ❌ Missing | `/app/rides/[id]/page.tsx` | MEDIUM |
| **GPS Overlay Component** | ❌ Missing | `/components/gps-imu-overlay.tsx` | MEDIUM |

### What Works ✅

- Database schema (ride_recordings table exists)
- Query for associations (ride page already fetches linked VTX files)
- UI for selecting VTX files (modal works, just doesn't save)
- Individual file viewers (recordings/[id] page with IMU charts)

---

## Recommended Implementation Plan

### Phase 1: Basic Association (1-2 hours)

**Goal:** Make the "Add Vertex IMU Data" button actually work

**Tasks:**
1. Create API endpoint: `POST /api/rides/[id]/recordings`
   - Accept array of recording IDs
   - Insert into `ride_recordings` table
   - Return success/error

2. Update `AddVtxDataButton.handleSubmit()`
   - Call API endpoint instead of setTimeout
   - Reload page on success to show new associations
   - Handle errors properly

**Result:** Users can manually link VTX files to rides

---

### Phase 2: IMU Charts on Ride Page (2-3 hours)

**Goal:** Show IMU data alongside FIT data on ride page

**Approach:** Reuse existing `IMUUPlotCharts` component

**Implementation:**
```tsx
// In /app/rides/[id]/page.tsx, after FIT charts:

{vtxRecordings.length > 0 && (
  <div className="mb-8">
    <Card>
      <CardHeader>
        <CardTitle>IMU Sensor Data</CardTitle>
      </CardHeader>
      <CardContent>
        {vtxRecordings.map((vtx: any) => (
          <div key={vtx.id} className="mb-6">
            <h3 className="text-lg font-semibold mb-4">{vtx.filename}</h3>
            <IMUChartsServerWrapper recordingId={vtx.id} />
          </div>
        ))}
      </CardContent>
    </Card>
  </div>
)}
```

**Why this works:**
- `IMUUPlotCharts` already exists and works well
- Shows Orientation, Accel, Gyro, Smoothed tabs
- Handles zoom, downsampling, filtering
- Just need server wrapper to fetch initial samples

---

### Phase 3: Simple GPS Overlay (3-4 hours)

**Goal:** Show GPS track with IMU events overlaid

**Approach:** Add event markers to existing map

**Implementation:**
```tsx
// New component: /components/gps-imu-overlay-map.tsx

export function GPSIMUOverlayMap({
  rideId,
  fitRecordingId,
  vtxRecordings
}) {
  // Fetch GPS track from FIT
  // Fetch IMU events (braking, max lean) from VTX
  // Overlay on map:
  //   - GPS track (blue line)
  //   - Braking events (red markers)
  //   - Max lean angles (yellow markers with degree labels)
  //   - Roughness heatmap (color-coded segments)

  return <LeafletMap with markers />
}
```

**Data needed:**
- GPS track: Already available from FIT
- IMU events: Need to compute from VTX (braking, lean angle peaks)
- Time synchronization: Match GPS timestamp to nearest IMU timestamp (±0.5s)

---

### Phase 4: Event Detection & Analysis (Future)

**Goal:** Compute events from IMU data for overlay

**Events to detect:**
1. **Braking**: Forward decel > 2.5 m/s² for >0.3s
2. **Max lean per turn**: Peak roll during GPS heading change
3. **Roughness segments**: RMS vertical accel per 1s window

**Storage:** Use `recording_analysis` table
```json
{
  "recording_id": "vtx-uuid",
  "analysis_type": "braking_events",
  "results": {
    "events": [
      {
        "timestamp": "2026-01-10T13:45:23Z",
        "deceleration": -3.8,
        "duration_ms": 1200,
        "gps_position": {"lat": 37.8, "lon": -122.4}
      }
    ]
  }
}
```

---

## Immediate Next Steps (To Get GPS Overlay Working)

### Step 1: Create Association API (Do First)
```
File: /src/app/api/rides/[id]/recordings/route.ts

POST /api/rides/[id]/recordings
Body: { recordingIds: string[] }
Action: Insert into ride_recordings table
```

### Step 2: Fix AddVtxDataButton (Do Second)
```
File: /src/components/add-vtx-data-button.tsx
Change: Replace dummy setTimeout with actual API call
Result: Associations are saved to database
```

### Step 3: Add IMU Charts to Ride Page (Do Third)
```
File: /src/app/rides/[id]/page.tsx
Change: Add IMUUPlotCharts component for each VTX recording
Result: Can view IMU data without navigating away
```

### Step 4: Basic GPS Track Overlay (Do Fourth)
```
File: /src/components/gps-imu-overlay-map.tsx
Content: GPS track from FIT + IMU sample markers
Result: Visual correlation of GPS position with IMU data
```

---

## Technical Considerations

### Time Synchronization

**GPS from FIT:** 1 Hz (every 1 second)
**IMU from VTX:** 25 Hz (every 40ms)

**Matching strategy:**
```typescript
// For each GPS point at time T:
const imuSamples = vtxData.filter(s =>
  Math.abs(s.timestamp - gpsTimestamp) < 500 // ±500ms window
)

// Use nearest IMU sample
const nearest = imuSamples.reduce((closest, current) =>
  Math.abs(current.timestamp - gpsTimestamp) <
  Math.abs(closest.timestamp - gpsTimestamp)
    ? current : closest
)
```

### Data Volume

**FIT GPS track:** ~1000-5000 points per ride (1 Hz × duration)
**VTX IMU data:** 25,000-150,000 samples per ride (25 Hz × duration)

**For overlay:** Downsample IMU to match GPS rate (1 Hz)
- Only show IMU samples that align with GPS points
- Or aggregate IMU data per 1-second GPS window

---

## Current Capabilities for GPS Overlay

From hawk_descent_2.vtx analysis:

### Available from FIT (GPS)
- ✅ Position (lat/lon) - 1 Hz
- ✅ Speed - 1 Hz
- ✅ Heading - 1 Hz (±5-10° accuracy)
- ✅ Altitude (barometer) - 1 Hz (±1-2m)
- ✅ Heart rate, power, cadence (if available)

### Available from VTX (IMU)
- ✅ Roll (lean angle) - 25 Hz (±3-5° for peaks)
- ✅ Pitch (drifts, use GPS grade instead) - 25 Hz
- ✅ Yaw (relative, needs GPS correction) - 25 Hz
- ✅ Acceleration (forward/lateral/vertical) - 25 Hz
- ✅ Gyro (rotation rates) - 25 Hz

### Derivable Events
- ✅ Braking: accel_x < -2.5 m/s²
- ✅ Max lean per turn: peak roll during GPS heading change
- ✅ Roughness: RMS of accel_z per 1s window
- ✅ G-forces: magnitude of total accel vector

---

## Example GPS + IMU Overlay Visualization

```
Map View:
┌──────────────────────────────────┐
│  GPS Track (blue line)           │
│    ↓                              │
│  🔴 Braking event                 │
│    marker: "-3.8 m/s²"           │
│    ↓                              │
│  🟡 Max lean angle                │
│    marker: "32° @ 18 mph"        │
│    ↓                              │
│  🟠 Rough road segment            │
│    heatmap: color intensity      │
└──────────────────────────────────┘

Timeline Sync:
GPS:  ●────●────●────●────●  (1 Hz)
IMU:  ●●●●●●●●●●●●●●●●●●●●  (25 Hz)
      ↑         ↑
   Brake    Max lean
```

---

## Recommendation: Phased Approach

### MVP (This Week)
1. ✅ Database schema ready (no changes needed)
2. Create association API endpoint
3. Fix AddVtxDataButton to save associations
4. Add IMU charts to ride page (reuse existing component)
5. Basic GPS track with IMU sample markers (no events yet)

**Result:** Can view GPS + IMU side-by-side, manual correlation

### Phase 2 (Next Week)
1. Compute braking events from IMU
2. Compute max lean per turn
3. Overlay events on GPS map
4. Color-code GPS track by roughness

**Result:** Automated event detection with GPS overlay

### Phase 3 (Future)
1. Real-time event computation during upload
2. Pre-computed analysis in recording_analysis table
3. Advanced visualizations (3D path with lean angles)
4. Export capabilities

---

## Code Reuse Strategy

**Already exists and works:**
- ✅ `IMUUPlotCharts` component (full-featured charting)
- ✅ `RideMapClient` component (GPS track visualization)
- ✅ `RideChartsClient` component (FIT data charts)
- ✅ `/api/recordings/[id]/samples` (IMU data endpoint)
- ✅ `/api/rides/[id]/samples` (FIT GPS data endpoint)

**What to build new:**
- API endpoint for saving associations (simple insert)
- Combined GPS + IMU overlay component
- Event detection algorithms (braking, lean angle)

**Reuse ratio:** ~80% existing code, 20% new

---

## Next Action Items

### Immediate (Get Basic Association Working)

1. **Create API endpoint** (15 minutes)
   ```
   File: /src/app/api/rides/[id]/recordings/route.ts
   Method: POST
   Body: { recordingIds: string[] }
   Action: Batch insert into ride_recordings
   ```

2. **Fix AddVtxDataButton** (10 minutes)
   ```
   File: /src/components/add-vtx-data-button.tsx
   Change: Replace setTimeout with fetch() call
   ```

3. **Test association flow** (5 minutes)
   - Upload VTX file
   - Create ride from FIT
   - Click "Add Vertex IMU Data"
   - Select VTX file
   - Verify it appears on ride page

### Short-term (Display IMU Charts)

4. **Add IMU charts to ride page** (30 minutes)
   ```
   File: /src/app/rides/[id]/page.tsx
   Change: Add IMUUPlotCharts for each VTX recording
   ```

5. **Create server wrapper for IMU charts** (20 minutes)
   ```
   File: /src/components/imu-charts-server-wrapper.tsx
   Purpose: Fetch initial samples server-side, pass to client component
   ```

### Medium-term (GPS Overlay)

6. **Create combined map component** (1-2 hours)
   ```
   File: /src/components/gps-imu-overlay-map.tsx
   Purpose: GPS track + IMU sample markers
   Approach: Extend RideMapClient with IMU markers
   ```

7. **Implement time-based matching** (30 minutes)
   ```
   Algorithm: For each GPS point, find nearest IMU sample (±500ms)
   Display: Marker color = roll angle, popup = accel data
   ```

---

## Success Criteria

After Phase 1 (Basic Association):
- [ ] Can manually link VTX files to rides
- [ ] Associated VTX files persist in database
- [ ] Ride page shows list of linked VTX files
- [ ] Can navigate to individual VTX file viewer

After Phase 2 (IMU Charts):
- [ ] IMU charts appear on ride page
- [ ] Can view orientation, accel, gyro data
- [ ] Charts sync with ride time range
- [ ] Can zoom/explore IMU data without leaving ride page

After Phase 3 (GPS Overlay):
- [ ] GPS track displays on map
- [ ] IMU data points overlaid on track
- [ ] Can click GPS point to see corresponding IMU data
- [ ] Visual correlation confirms time synchronization

---

## Blockers: NONE

**Database:** ✅ Ready (ride_recordings table exists)
**UI Components:** ✅ Ready (AddVtxDataButton exists, just needs save logic)
**Data Flow:** ✅ Ready (ride page already queries associations)
**API Infrastructure:** ✅ Ready (just need one new endpoint)

**All green lights to proceed!** 🚀

The vtx-parser package issue is resolved (0.5.0 published, web app now pulling from npm), so production builds will work on Vercel.
