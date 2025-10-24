# Vertex - Project Save State

**Last Updated**: October 24, 2025  
**Phase**: MVP - Data Upload & Visualization Complete  
**Status**: ✅ Production Pipeline Optimized, Charting System Complete, Ready for Phase 2

---

## 🎯 Project Overview

**Vertex** is a web application for analyzing cycling dynamics using IMU sensor data. The platform combines high-frequency inertial measurement data with standard cycling computer (FIT file) data to provide insights into cornering forces, braking behavior, road surface quality, and equipment performance.

**Current State**: Full-stack application with authentication, data upload pipeline, and visualization capabilities deployed and functional. **Status**: Production pipeline working correctly, dev environment optimized for reliability.

---

## ✅ Recent Accomplishments (October 24, 2025)

### High-Performance Charting System (uPlot + LTTB)
- ✅ **uPlot Integration**: Replaced Recharts with high-performance uPlot for 100k+ sample datasets
- ✅ **LTTB Downsampling**: Intelligent data reduction preserves visual fidelity (Largest Triangle Three Buckets algorithm)
- ✅ **Interactive Zoom**: Drag-to-select zoom with progressive detail loading
- ✅ **Scalable Data Fetching**: SQL-based systematic sampling for 1M+ sample datasets
- ✅ **Theme Support**: Dynamic colors for light/dark mode, custom legend styling
- ✅ **Timezone Handling**: Server vs client rendering timezone issues resolved
- ✅ **Batch Pagination**: Overcame Supabase 1000-row RPC limit with batching

### Progress Tracking Refinements
- ✅ **Sub-Batch Progress**: Fire-and-forget updates every 2 seconds during CSV parsing
- ✅ **Non-Blocking Updates**: Async progress updates don't slow down main processing
- ✅ **Delete During Processing**: Jobs gracefully abort if file is deleted mid-processing
- ✅ **10k Batch Size**: Optimal balance of speed and progress resolution (reverted from 25k)

### UI/UX Polish & Theming
- ✅ **Timezone Display**: Client-side rendering for accurate local time display
- ✅ **Header Formatting**: Clean date/time format without seconds (e.g., "Oct 24, 7:02 PM → 7:06 PM")
- ✅ **Light Mode Fixes**: Modal theming, delete button contrast, error foreground colors
- ✅ **Dark Mode Chart Support**: Dynamic theme colors for axes, labels, and zoom selector
- ✅ **Chart Styling**: Removed grid noise, custom legend with colored squircles, sparse X-axis
- ✅ **Status Icons with Tooltips**: Replaced noisy status pills with icon hover tooltips
- ✅ **Settings Page Layout**: Left-aligned action buttons (editorial theme)

### Synthetic Data Generation
- ✅ **Realistic Ride Preset**: 2-hour cycling session with varied terrain
- ✅ **Test Files Generated**: 30MB (1hr, 360k samples), 61MB (2hr, 628k samples)
- ✅ **Physics-Based Scenarios**: Warmup, intervals, climbing, descents, sprints, technical sections

### Code Architecture
- ✅ **Parser Consolidation**: Removed old parsers, unified to single streaming implementation
- ✅ **SQL Consolidation**: All schema in single idempotent `complete-schema.sql`
- ✅ **Storage Cleanup**: 30-day retention policy for raw uploaded files
- ✅ **Codemod Approach**: Automated `text-tertiary` → `text-secondary` replacement

## Previous Accomplishments (October 22, 2025)

### Production Pipeline Resolution
- ✅ **Inngest Function Registration Fixed**: Production pipeline now working correctly
- ✅ **Real-time Status Updates**: Polling system implemented for live processing updates
- ✅ **Large File Handling**: Successfully tested with 50MB+ files in production
- ✅ **Error Handling**: Comprehensive error states and user feedback
- ✅ **File Size Validation**: Client-side validation with clear error messages

---

### Current Known Issues & Considerations

#### Infrastructure Requirements
- ℹ️ **Supabase NANO Insufficient**: Free tier times out on large files due to low compute
- ✅ **Supabase Pro Required**: MICRO compute ($10/month) handles 100MB files reliably
- ✅ **Vercel Pro Recommended**: Better performance and monitoring ($20/month)

#### Performance Characteristics
- ℹ️ **Processing Time**: ~5-7min for 100MB files on Supabase Pro
- ℹ️ **Batch Size**: 10k samples provides optimal balance of speed and progress resolution
- ℹ️ **File Size Estimation**: 90 bytes/row empirically accurate for IMU CSVs
- ⚠️ **Timeout Configuration**: Configured 15-minute limit but still timing out at 5 minutes (Inngest free tier limitation)

#### Development Environment
- ⚠️ **Local Blocking**: Long-running Inngest jobs can block Next.js dev server
- ✅ **Workaround**: Use production for testing large files, local for development
- ✅ **Documentation**: `LOCAL_DEV_LIMITATIONS.md` explains the constraint

---

## ✅ Completed Features

### 1. Authentication & User Management
- ✅ Supabase Auth integration (email/password)
- ✅ Protected routes with middleware
- ✅ User profiles (settings page with name/email management)
- ✅ Session management with automatic refresh
- ✅ Row Level Security (RLS) on all user-scoped tables
- ✅ Secure environment variable configuration

### 2. Landing Page
- ✅ Professional hero section with background image
- ✅ Problem/solution framework
- ✅ "How It Works" 3-step process
- ✅ Features section (4 cards)
- ✅ Hardware transparency section with waitlist
- ✅ FAQ section with expandable items
- ✅ Email waitlist capture
- ✅ Technology stack display
- ✅ Mobile responsive design
- ✅ Dynamic header (shows login/signup or dashboard/profile based on auth state)

### 3. Database Schema
- ✅ 10 production tables with full RLS policies
- ✅ `users`, `imu_data_files`, `fit_files`, `imu_samples`, `rides`, `imu_processed`, `ride_imu_summary`, `fit_data_points`, `bikes`, `user_preferences`
- ✅ User creation trigger (auto-populates `public.users` from `auth.users`)
- ✅ Storage bucket with RLS policies
- ✅ Optimized indexes for time-range queries
- ✅ Correct RLS policies with both `USING` and `WITH CHECK` clauses

### 4. IMU Data Upload Pipeline
- ✅ Drag-and-drop CSV upload interface (`/upload`)
- ✅ Supabase Storage integration
- ⚠️ Background parsing with Inngest (PRODUCTION ISSUE - functions not registering)
- ✅ CSV validation (required columns, data types, timestamps)
- ✅ Bulk insert optimization (10k rows per batch)
- ✅ Real-time status updates (uploaded → parsing → ready)
- ✅ Error handling with user-friendly messages

### 5. IMU Data Visualization
- ✅ Data list page (`/data`) showing time segments
- ✅ Time-centric display (sorted by data time range, not upload time)
- ✅ Clickable cards linking to detail pages
- ✅ Detail page (`/data/[id]`) with interactive charts
- ✅ Toggle between Accelerometer, Gyroscope, Magnetometer
- ✅ Min/Max/Mean statistics for each axis
- ✅ Auto-downsampling for performance (10k → 2k points)
- ✅ Recharts integration with responsive design

### 6. Developer Tools
- ✅ Synthetic IMU data generator (`tools/generate_synthetic_imu.py`)
- ✅ Realistic physics models (acceleration, cornering, braking)
- ✅ Configurable sample rate and duration
- ✅ CSV output compatible with upload pipeline

### 7. Infrastructure
- ✅ Next.js 15 (App Router) with TypeScript
- ✅ Vercel deployment at `ridevertex.com`
- ✅ Vercel Analytics integration
- ✅ Supabase PostgreSQL database
- ✅ Supabase Storage for file uploads
- ✅ Inngest for background job processing
- ✅ Git repository with proper `.gitignore`

### 8. UI/UX
- ✅ Consistent navigation (header with breadcrumbs)
- ✅ Soft beige color scheme (stone-x Tailwind palette)
- ✅ Loading states and placeholders
- ✅ Error boundaries and user feedback
- ✅ Mobile responsive across all pages
- ✅ Hover states and transitions

---

## 📊 Technical Architecture

### Data Model: Time-Centric
**Key Insight**: IMU data is represented as **time ranges**, not files.

- Files are ephemeral transport mechanisms
- Database stores continuous time segments of valid sensor data
- Rides will query IMU data by time range for synchronization
- Enables gap detection, overlap handling, and multi-source fusion

### Security Model
- All user data isolated by RLS policies
- Service role key only used in Inngest background jobs
- Client uses anon key (respects RLS)
- HTTP-only cookies for session management
- Environment variables never committed to repository

### Performance Optimizations
- Bulk inserts (10k rows at a time)
- Time-based indexes for fast queries
- Auto-downsampling for chart rendering
- Lazy loading of samples (only on detail page)
- Static generation where possible

---

## 🚀 Next Steps (Priority Order)

### Phase 2: Ride Creation & Management (Ready to Begin)

#### 1. FIT File Upload (Highest Priority)
**Why:** Required to associate IMU data with actual rides.

**Tasks:**
- [ ] Create FIT file parser (using `fit-file-parser` library)
- [ ] Extract ride metadata (start/end time, distance, GPS track)
- [ ] Upload interface similar to IMU CSV upload
- [ ] Store parsed data in `fit_files` and `fit_data_points` tables
- [ ] Background job for FIT processing

**Estimated Time:** 3-4 hours

---

#### 2. Ride Creation UX
**Why:** Link FIT files with IMU time ranges to create analyzable rides.

**Tasks:**
- [ ] Create ride creation page (`/rides/create`)
- [ ] FIT file upload + metadata extraction
- [ ] Automatic IMU data association by time range query
- [ ] Manual time range selection if no FIT file
- [ ] Ride naming and metadata (bike, location, conditions)
- [ ] Create `rides` record

**UI Flow:**
```
1. Upload FIT file OR manually select time range
2. Show FIT metadata (time, distance, etc.)
3. Query available IMU data for that time range
4. Preview data coverage (show gaps if any)
5. Name ride and add metadata
6. Create ride → trigger processing job
```

**Estimated Time:** 4-6 hours

---

#### 3. Ride List Page
**Why:** Central hub for accessing rides.

**Tasks:**
- [ ] Fetch all user rides from database
- [ ] Display as cards or table (date, name, duration, distance)
- [ ] Sort by date (most recent first)
- [ ] Filter by bike, date range
- [ ] Click to view ride details
- [ ] Processing status indicator

**Estimated Time:** 2-3 hours

---

### Phase 3: IMU Data Processing

#### 4. IMU Processing Job (Core Analytics)
**Why:** This is the VALUE - turn raw sensor data into insights.

**Tasks:**
- [ ] Implement processing algorithms:
  - [ ] Calculate lean angle from accelerometer + gyroscope
  - [ ] Detect cornering events (left/right turns)
  - [ ] Calculate g-forces (lateral, longitudinal, vertical)
  - [ ] Detect braking/acceleration events
  - [ ] Analyze road surface quality (vibration magnitude)
- [ ] Insert processed data into `imu_processed` table
- [ ] Generate ride summary statistics → `ride_imu_summary`
- [ ] Inngest background job triggered after ride creation
- [ ] Update ride status to `ready` when complete

**Algorithm Priorities:**
1. Lean angle calculation (most critical for cornering analysis)
2. G-force calculations (lateral, longitudinal, vertical)
3. Event detection (corners, braking, acceleration)
4. Road surface quality metrics

**Estimated Time:** 8-12 hours (core algorithms)

**Research Needed:**
- [ ] Quaternion to Euler angle conversion (for lean angle)
- [ ] Kalman filtering or complementary filter for sensor fusion
- [ ] Threshold tuning for event detection
- [ ] Vibration analysis methods (FFT, RMS)

---

#### 5. Ride Detail Page (Visualization)
**Why:** Show processed insights to users.

**Tasks:**
- [ ] Ride header (name, date, duration, distance, bike)
- [ ] Summary statistics cards (max lean angle, max g-force, corner count)
- [ ] GPS map with track overlay (from FIT file)
- [ ] Time-series charts:
  - [ ] Speed/Power/Heart Rate (from FIT)
  - [ ] Lean angle over time
  - [ ] G-forces over time
  - [ ] Road surface quality
- [ ] Event markers on timeline (corners, braking)
- [ ] Comparison table (compare with other rides)
- [ ] Export options (CSV, PDF report)

**Estimated Time:** 6-8 hours

---

### Phase 4: Advanced Features

#### 6. Multi-Ride Comparison
- [ ] Select 2-4 rides to compare
- [ ] Overlay charts (same time scale or distance scale)
- [ ] Highlight differences in key metrics
- [ ] Identify performance improvements

**Estimated Time:** 4-5 hours

---

#### 7. Equipment Tracking
- [ ] Bike management (already have schema)
- [ ] Component tracking (tires, wheels, saddle)
- [ ] Associate equipment with rides
- [ ] Analyze performance across equipment

**Estimated Time:** 3-4 hours

---

#### 8. Data Export & Sharing
- [ ] Export processed data as CSV
- [ ] Generate PDF ride reports
- [ ] Share ride link (public view, no auth required)
- [ ] Strava integration (export to Strava)

**Estimated Time:** 4-6 hours

---

## ❓ Open Questions

### Technical

1. **IMU Processing Algorithms**
   - Which filtering method for sensor fusion? (Kalman, complementary filter, or Madgwick filter?)
   - Threshold values for event detection? (needs real-world data tuning)
   - How to handle sensor drift over long rides?

2. **Performance at Scale**
   - Current: unknown
   - At 100 Hz for 2-hour ride: 720,000 samples
   - Will bulk insert still be fast enough? (estimate: ~2 minutes)
   - Consider: Keep PostgreSQL for MVP, monitor performance, migrate to Parquet if needed

3. **GPS/IMU Synchronization**
   - FIT files typically at 1 Hz (GPS)
   - IMU at 50-100 Hz
   - How to interpolate GPS position for high-frequency IMU data?
   - Use nearest neighbor or linear interpolation?

4. **Real-World Testing**
   - Need actual hardware IMU data to validate:
     - Sensor orientation assumptions
     - Calibration requirements
     - Noise characteristics
     - Event detection thresholds

### Product

5. **User Onboarding**
   - Should there be a demo ride with synthetic data?
   - Tutorial for first upload?
   - Help documentation?

6. **Hardware Integration**
   - How will users get CSV files from device? (SD card, Bluetooth, WiFi?)
   - Auto-upload from device?
   - Mobile app needed?

7. **Pricing Model** (future)
   - Free tier limits? (storage, processing)
   - Paid tier features? (advanced analytics, unlimited storage)
   - Estimated costs at scale?

---

## 🛠️ Development Setup

### Prerequisites
```bash
Node.js 18+
Python 3.8+ (for synthetic data generator)
npm or pnpm
Supabase account
Inngest account (or local dev mode)
```

### Environment Variables
```env
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGc...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...
INNGEST_EVENT_KEY=test
INNGEST_SIGNING_KEY=test
```

### Run Development
```bash
# Terminal 1: Next.js dev server
npm run dev

# Terminal 2: Inngest dev server
npx inngest-cli@latest dev

# Generate test data
cd tools
python3 generate_synthetic_imu.py -o test_ride.csv --sample-rate 100
```

### Deploy
```bash
# Push to main branch → Vercel auto-deploys
git push origin main

# Set env vars in Vercel dashboard
# Run schema SQL in Supabase dashboard
```

---

## 📚 Documentation Structure

### Core Files (Keep)
- **`APP.md`**: Complete technical specification, schema, implementation notes
- **`BUILD.md`**: Hardware design, form factors, component specs
- **`README.md`**: Public-facing project overview
- **`DEPLOYMENT.md`**: Deployment instructions, domain setup
- **`LOGO_GUIDE.md`**: Branding guidelines, logo concepts
- **`RULES.md`**: AI assistant behavior rules
- **`SAVE_STATE.md`**: This file - current status and roadmap

### Development Files (Gitignored)
- `fix_imu_files_rls.sql`: RLS policy fixes (already applied)
- `tools/generate_synthetic_imu.py`: Data generator
- `tools/README.md`: Generator documentation

### Archived Files (Deleted)
- ~~`plan.txt`~~: Superseded by APP.md
- ~~`LANDING_PAGE_RECOMMENDATIONS.md`~~: Landing page complete
- ~~`SECURITY_AUDIT.md`~~: Notes consolidated into APP.md
- ~~`SCHEMA_REVIEW.md`~~: Schema notes in APP.md
- ~~`UPLOAD_TESTING.md`~~: Upload pipeline working
- ~~`DATA_ARCHITECTURE.md`~~: Architecture notes in APP.md

---

## 🎓 Key Learnings

### What Worked Well
1. **Time-centric data model**: Thinking in time ranges instead of files was the right abstraction
2. **Supabase RLS**: Provides security without custom auth logic
3. **Inngest for background jobs**: Clean separation of concerns, easy monitoring
4. **React Server Components**: Fast initial load, good DX
5. **Synthetic data generator**: Essential for testing without hardware
6. **Real-time progress tracking**: Dramatically improved UX for long-running jobs
7. **Buffered ETA calculations**: Smoothing estimates over 3-4 updates prevents jitter
8. **Consolidated SQL**: Single `complete-schema.sql` file simplifies deployment

### What Was Challenging
1. **RLS policy syntax**: Forgot `WITH CHECK` clause initially (required for INSERT)
2. **Next.js 15 async params**: API change caught during build
3. **Sample rate type mismatch**: Database INTEGER vs calculated float
4. **Inngest local setup**: Required separate dev server + env vars
5. **Supabase NANO tier**: Insufficient compute for production workloads (timeouts)
6. **React useEffect polling**: Dependency array causing interval leaks
7. **Progress math accuracy**: Initial estimates (45 bytes/row) were 2x off
8. **TypeScript control flow**: Timestamp variables inferred as `never` due to async context

### Key Decisions & Findings
1. **Batch Size**: 10k samples optimal (25k was slower - larger batches stress DB more)
2. **File Size Estimation**: 90 bytes/row empirically accurate for IMU CSVs
3. **Timeout Limits**: Inngest free tier hard 5-minute limit (not configurable)
4. **File Size Limit**: ~30-35MB reliably processable within 5-minute timeout
5. **Charting Library**: uPlot >> Recharts for large datasets (10x faster rendering)
6. **Downsampling**: LTTB algorithm preserves visual fidelity better than naive sampling
7. **Supabase RPC Limits**: 1000-row default requires pagination or `.limit()` override
8. **Server vs Client Rendering**: Timezone formatting must be client-side to match user locale
9. **Progress Updates**: Fire-and-forget async updates (non-blocking) every 2 seconds during parsing
10. **Delete Safety**: Mark files as 'failed' before deletion to stop running background jobs

### What to Watch
1. **File Size Limits**: 30-35MB max with free tier (1 hour rides at 100Hz)
2. **Chart Performance**: uPlot handles 100k+ samples well, monitor for slowness on older devices
3. **Storage costs**: Supabase Pro includes 100GB (current usage: <1GB)
4. **Processing time**: Validated at ~2-3min for 30MB files on Supabase MICRO
5. **User onboarding**: Will users understand the upload → visualize flow?
6. **Inngest upgrade path**: Pro tier ($75/month) needed for files >35MB (2+ hour rides)

---

## 🔗 Links

- **Live Site**: https://ridevertex.com
- **GitHub Repo**: [private]
- **Supabase Dashboard**: https://supabase.com/dashboard
- **Vercel Dashboard**: https://vercel.com/dashboard
- **Inngest Dashboard** (dev): http://localhost:8288

---

## 📝 Notes for Next Session

1. **✅ COMPLETED: High-Performance Charting & Visualization**
   - uPlot + LTTB downsampling for scalable charts
   - Interactive zoom with progressive detail loading
   - Full timezone handling (server/client rendering)
   - Complete light/dark mode theming
   - Sub-batch progress tracking with non-blocking updates
   - Delete-during-processing safety
   - Synthetic test data generator (realistic ride patterns)

2. **✅ VALIDATED: File Size Limits**
   - **30-35MB max** on Inngest free tier (~1 hour rides at 100Hz)
   - Test file available: `scripts/test_ride_30mb.csv` (360k samples, 1 hour)
   - Larger files (61MB) timeout after 5 minutes
   - Upgrade path clear: Inngest Pro ($75/mo) for 2+ hour rides

3. **Next Priority: FIT File Upload Implementation**
   - Use `fit-file-parser` or `@riderize/fit-file-parser` npm package
   - Extract: timestamp, GPS coordinates, power, heart rate, cadence, speed
   - Upload interface similar to IMU CSV (reuse components)
   - Store in `fit_files` table, parse into `fit_data_points`
   - Background job for FIT parsing (should be fast, <10 seconds)
   - Test with sample FIT files from Strava/Garmin Connect

4. **Design Ride Creation UX**
   - **Recommended flow**: FIT-first (upload FIT → auto-detect IMU data by time range)
   - Alternative: Manual time-range selection for rides without FIT file
   - UI mockup needed for time range picker and data coverage preview
   - Show gaps in IMU data coverage if any

5. **Research IMU Processing Algorithms**
   - Lean angle from accelerometer + gyroscope (quaternion to Euler)
   - G-force calculations (lateral, longitudinal, vertical)
   - Event detection: corners, braking, acceleration (threshold tuning needed)
   - Road surface quality: vibration magnitude (FFT or RMS)
   - Consider: Madgwick filter for sensor fusion

6. **Future Optimizations (Not Critical)**
   - Server-sent events for real-time progress (replace polling)
   - Plotly.js integration for advanced visualizations (traction circle, 3D plots)
   - Incremental static regeneration for data list page
   - CSV export of processed ride data

---

**Ready to continue! Next task: FIT file upload implementation** 🚴‍♂️📊

**Current Status**: Phase 1 (Data Upload & Visualization) **COMPLETE**. System is production-ready for initial users with 30-35MB file support. Ready to begin Phase 2 (Ride Creation & FIT Integration).


