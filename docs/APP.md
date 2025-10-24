# Vertex - IMU Cycling Data Analysis Platform

## Project Vision

**Vertex** is a web-based platform for uploading, processing, and analyzing IMU cycling data logged from custom hardware. The application enables cyclists to gain detailed insights into their riding dynamics—cornering forces, braking behavior, road surface quality, and pedaling smoothness—by combining high-frequency IMU data with standard cycling computer FIT files.

**Target Scale**: 5-10 queries per second, single user to small team initially, cost-optimized for hobby/prosumer use.

---

## Core Requirements

### 1. User Authentication
- OAuth 2.0 or better (Google, GitHub, Strava integration desirable)
- Session management and user isolation
- Profile management (name, cycling preferences, bike configurations)

### 2. Cloud Infrastructure
- Plug-and-play deployment (Vercel, Railway, or similar)
- No manual server management
- Auto-scaling within reasonable limits
- Cost-effective for low-to-moderate traffic

### 3. Data Upload & Storage
- Multi-file upload UI for CSV IMU logs (30-150 MB per ride typically)
- FIT file upload for cycling computer data (GPS, power, heart rate)
- Raw data storage in database
- File integrity validation

### 4. Database Architecture
- Raw IMU data storage (time-series optimized)
- Processed ride metadata
- User profiles and associations
- Query performance for large datasets (millions of rows per ride at 50-100Hz)

### 5. Dashboard (Overview)
- Timeline view of uploaded IMU data (date ranges covered)
- List of processed rides with metadata (date, duration, distance)
- Quick stats (total rides, total hours logged)
- Placeholder sections for insights/analytics

### 6. Create Ride Workflow
- Manual ride definition: select time range from existing IMU data
- FIT file association: upload FIT file, auto-extract time bounds
- Ride metadata: name, location, bike type, conditions
- Background processing job initiation

### 7. Ride Detail Page
- Ride summary: date, duration, distance, elevation
- Basic FIT parsing: power, heart rate, cadence, GPS track
- IMU data visualization placeholders:
  - Traction circle (lateral vs. longitudinal G)
  - Lean angle over time
  - Braking events timeline
  - Road surface quality heatmap
- Export options (processed data, charts)

---

## Recommended Technology Stack

### Frontend Framework: **Next.js 14 (App Router)**

**Why:**
- React-based with excellent DX
- Built-in server components for performance
- Native deployment to Vercel (zero-config)
- API routes for backend logic
- File-based routing
- Excellent TypeScript support

**Alternatives Considered:**
- **SvelteKit**: Lighter, faster, but smaller ecosystem
- **Remix**: Good, but more complex deployment
- **Astro**: Better for static sites, less ideal for dynamic apps

**Recommendation**: Next.js for maturity and Vercel integration.

---

### Deployment Platform: **Vercel**

**Why:**
- Native Next.js hosting (made by same company)
- Automatic deployments from Git
- Edge functions for low-latency API routes
- Free tier generous for hobby projects
- Built-in analytics and monitoring
- Serverless architecture (pay-per-use)

**Pricing**:
- Free tier: 100 GB bandwidth, 6000 build minutes/month
- Pro tier: $20/month for production needs
- Edge function pricing: ~$40/million invocations

**Alternatives:**
- **Railway**: Similar simplicity, slightly cheaper, good PostgreSQL hosting
- **Fly.io**: More control, Docker-based, overkill for this use case
- **AWS Amplify**: More complex, better at scale

**Recommendation**: Vercel for simplicity and cost-effectiveness.

---

### Authentication: **Supabase Auth**

**Why:**
- **Integrated with Supabase database** - single service, unified architecture
- **Built-in Row Level Security (RLS)** - seamless user data isolation at database level
- **OAuth support** (Google, GitHub) + email/password, can add Strava
- **Completely free** - no MAU limits, included in Supabase free tier
- **Session management** built-in with JWT tokens
- **Security-first** - PostgreSQL-level access control
- **Custom UI** - build auth forms matching the editorial aesthetic with shadcn/ui

**Implementation**:
```tsx
// lib/supabase/client.ts
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'

export const supabase = createClientComponentClient()

// middleware.ts - Route protection
import { createMiddlewareClient } from '@supabase/auth-helpers-nextjs'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export async function middleware(req: NextRequest) {
  const res = NextResponse.next()
  const supabase = createMiddlewareClient({ req, res })
  const { data: { session } } = await supabase.auth.getSession()
  
  if (!session && req.nextUrl.pathname.startsWith('/dashboard')) {
    return NextResponse.redirect(new URL('/login', req.url))
  }
  
  return res
}

// app/login/page.tsx - Custom sign-in form
'use client'
import { useState } from 'react'
import { supabase } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'

export default function LoginPage() {
  const signInWithGoogle = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/dashboard` }
    })
  }
  
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="max-w-md w-full space-y-8">
        <h1 className="text-3xl font-serif">Sign In to Vertex</h1>
        <Button onClick={signInWithGoogle}>Continue with Google</Button>
      </div>
    </div>
  )
}
```

**Row Level Security (RLS) Example**:
```sql
-- Enable RLS on rides table
ALTER TABLE rides ENABLE ROW LEVEL SECURITY;

-- Users can only see their own rides
CREATE POLICY "Users can view own rides"
  ON rides FOR SELECT
  USING (auth.uid() = user_id);

-- Users can only insert their own rides
CREATE POLICY "Users can insert own rides"
  ON rides FOR INSERT
  WITH CHECK (auth.uid() = user_id);
```

**Alternatives:**
- **Clerk**: Faster setup with polished UI, but adds dependency and cost at scale
- **Auth.js (NextAuth v5)**: Open-source, more control, but most manual setup
- **Auth0**: Enterprise-grade, more expensive, overkill for this use case

**Recommendation**: Supabase Auth for security, architectural simplicity, and seamless RLS integration. Custom forms allow styling to match the editorial aesthetic while maintaining complete control over the auth flow.

---

### Database: **Supabase (PostgreSQL)**

**Why:**
- PostgreSQL with real-time subscriptions
- Generous free tier: 500 MB database, 1 GB file storage
- Built-in Row Level Security (RLS) for user data isolation
- RESTful API auto-generated from schema
- Good for time-series data with proper indexing
- pgvector support for future ML applications

**Schema Design**:

The complete database schema with all tables, constraints, RLS policies, and indexes is available in:

📄 **`/sql/complete-schema.sql`**

This file contains:
- User authentication and profile tables
- Storage bucket configuration and policies
- IMU data file metadata and samples
- Streaming processing logs and progress tracking
- FIT file support (future)
- Ride management tables
- All Row Level Security (RLS) policies
- Performance indexes
- Utility functions and views

**To instantiate the schema**, run the SQL file in your Supabase SQL Editor. The script is idempotent and safe to run multiple times.

**Scaling Considerations:**

For MVP, raw IMU data is stored directly in PostgreSQL. This is sufficient for:
- Single user or small team (< 10 users)
- Hundreds of rides (< 10 GB of data)
- Background processing (not real-time)

**Future Optimization (If Needed):**

If database grows beyond 10 GB or queries become slow (> 5 seconds), consider migrating raw IMU data to **Parquet files**:
- Store only metadata in Postgres (`imu_data_files`)
- Convert CSV uploads to compressed Parquet format (~10x smaller)
- Store Parquet files in S3/Supabase Storage
- Read Parquet files during ride processing instead of querying database

This migration can be done transparently using a repository pattern, without changing processing code. Expected performance improvement:
- **Storage**: 10x reduction (14 MB/hour → 1.5 MB/hour)
- **Query Speed**: 3-5x faster for bulk reads
- **Cost**: 5x cheaper storage ($0.023/GB vs $0.115/GB)

For hobby-scale usage, PostgreSQL is recommended for simplicity.

---

## Stream Processing Architecture

### Overview

The stream processing architecture transforms raw IMU sensor data into actionable cycling insights through multi-stage processing pipelines. This system handles high-frequency data (50-100Hz) from 2+ hour rides while maintaining real-time responsiveness and cost efficiency.

### Compensation Pattern for Data Consistency

**Problem**: In distributed systems like Inngest, traditional database transactions can't span across service boundaries. When processing fails after inserting data but before updating status, orphaned data is left behind.

**Solution**: The **Compensation Pattern** (also known as the **Saga Pattern**) ensures data consistency by implementing automatic cleanup when operations fail.

#### How It Works

Instead of trying to make everything atomic (impossible across services), we:

1. **Execute operations** in sequence
2. **If any step fails**, **compensate** (undo) the previous operations  
3. **Each operation** has a corresponding **compensation operation**

#### Implementation in IMU Processing

**Traditional Approach (Broken)**:
```typescript
// This doesn't work across Inngest steps
BEGIN TRANSACTION;
  INSERT samples...;
  UPDATE file status...;
COMMIT; // ❌ Can't do this across services
```

**Compensation Pattern (Our Solution)**:
```typescript
try {
  // Step 1: Insert samples
  await insertSamples();
  
  // Step 2: Update file status  
  await updateFileStatus();
  
} catch (error) {
  // COMPENSATION: Undo Step 1
  await deleteSamples(); // ✅ Clean up orphaned data
  await markFileAsFailed();
}
```

#### Real-World Example

**Scenario**: Processing a 2-hour ride with 720,000 samples
1. ✅ **Insert samples** (720k samples inserted successfully)
2. ❌ **Function fails** (timeout, memory error, network issue)
3. ❌ **Status never updated** to "ready" or "failed"
4. 💥 **Result**: File shows "parsing" but has 720k orphaned samples

**Compensation Response**:
```typescript
// Automatic cleanup in catch block
console.log(`🧹 Cleaning up orphaned samples for failed file ${fileId}`)

// Delete orphaned samples in batches (10k at a time)
let deletedCount = 0
const BATCH_SIZE = 10000
let hasMore = true

while (hasMore) {
  const sampleBatch = await fetchBatchToDelete(fileId, BATCH_SIZE)
  await deleteBatch(sampleBatch)
  deletedCount += sampleBatch.length
  console.log(`✅ Cleaned up ${deletedCount} orphaned samples`)
}

// Mark file as failed with proper error message
await markFileAsFailed(fileId, errorMessage)
```

#### Benefits

- **Data Consistency**: No orphaned data left behind
- **Observable**: Clear logging of cleanup operations
- **Idempotent**: Safe to run multiple times
- **Automatic**: No manual intervention required
- **Scalable**: Works with millions of samples

#### Pattern Variations

1. **Choreography**: Each service knows how to compensate itself (our approach)
2. **Orchestration**: Central coordinator manages compensations
3. **Event Sourcing**: Store events and replay/compensate as needed

We use **Choreography** - each Inngest function knows how to clean up after itself.

#### Database Impact

**Before Compensation Pattern**:
```sql
-- Orphaned data example
SELECT f.id, f.filename, f.status, COUNT(s.id) as sample_count 
FROM imu_data_files f 
LEFT JOIN imu_samples s ON f.id = s.imu_file_id 
WHERE f.status = 'parsing'
GROUP BY f.id, f.filename, f.status;

-- Result: File stuck in "parsing" with 2.14M samples
-- id: 77c19734-efc2-46d5-a07a-bba03bd51844
-- status: parsing
-- sample_count: 2140000
```

**After Compensation Pattern**:
```sql
-- Clean state - no orphaned data
SELECT f.id, f.filename, f.status, COUNT(s.id) as sample_count 
FROM imu_data_files f 
LEFT JOIN imu_samples s ON f.id = s.imu_file_id 
WHERE f.status = 'parsing'
GROUP BY f.id, f.filename, f.status;

-- Result: Empty (no files stuck in parsing with samples)
```

#### Implementation Files

- **`src/inngest/functions/parse-imu.ts`**: Standard processing with compensation
- **`src/inngest/functions/parse-imu-streaming.ts`**: Streaming processing with compensation  
- **`cleanup-orphaned-data.sh`**: Manual cleanup script for existing orphaned data

This pattern ensures **data integrity** in distributed systems without requiring complex distributed transaction protocols.

### Current Schema Compatibility

**✅ Excellent Foundation**: The existing schema is well-designed for stream processing:

- **`imu_samples`**: Perfect for raw time-series data with proper indexing
- **`imu_processed`**: Ideal for derived calculations (G-forces, lean angles, filtered data)
- **`ride_imu_summary`**: Ready for aggregated statistics and event counts
- **Time-centric design**: Enables efficient windowed queries and range-based processing
- **RLS policies**: Maintains security across all processing stages

**Minor Enhancements Needed**:
- Add `processing_stage` field to `imu_processed` for multi-stage tracking
- Consider `imu_events` table for detected cornering/braking events
- Add `processing_metadata` table for pipeline observability

### Stream Processing Phases

#### **Phase 1: True Streaming Processing** ✅ **IMPLEMENTED**

**Objective**: Handle large files (2+ hours, 100Hz) with constant memory usage through true streaming

**Implementation Status**: ✅ Complete with real-time progress tracking

**Implemented Features**:
- ✅ **Client-side chunking**: Split large files into 50MB uploads for reliability
- ✅ **True streaming CSV parsing**: PapaParse `step` callback for row-by-row processing
- ✅ **Constant memory usage**: Process data without loading entire file into memory
- ✅ **Real-time progress tracking**: Database updates after every batch (50k samples)
- ✅ **Progress bar with ETA**: Frontend displays percentage complete and estimated time remaining
- ✅ **Checkpoint tracking**: `samples_processed` and `last_checkpoint_at` stored in database
- ✅ **Batch processing logs**: Detailed `streaming_processing_logs` table for monitoring
- ✅ **Compensation pattern**: Automatic cleanup of orphaned data on failure

**Implementation Details**:
- **Streaming CSV Parser**: PapaParse with `step` callback processes rows individually
- **Memory Management**: Constant ~10-20MB memory usage regardless of file size
- **Progress Updates**: Database checkpoint written after each 10k sample batch
- **Batch Inserts**: 10k row batches for optimal database performance and progress resolution
- **Performance Monitoring**: Each batch logs processing time and sample count
- **Progress Calculation**: Real-time ETA based on samples processed, buffered over 3-4 updates for smoothness
- **Timeout Configuration**: 15-minute timeout for large files (100MB+)

**Schema Enhancements**:

All progress tracking schema enhancements are included in `/sql/complete-schema.sql`:
- Progress tracking columns (`samples_processed`, `last_checkpoint_at`, `processing_started_at`)
- `streaming_processing_logs` table for detailed batch monitoring
- Utility functions (`get_file_processing_progress`, `get_stuck_streaming_processes`, `reset_stuck_streaming_processes`)
- Status views (`streaming_processing_status`, `streaming_performance_metrics`)

**User Experience**:
- **Real-time feedback**: Progress bar updates every 10k samples (~2-second intervals on Supabase Pro)
- **Accurate ETA**: Estimated time remaining calculated from processing velocity, buffered over 3-4 updates
- **Visual progress**: Percentage complete, samples processed, and time remaining
- **No black box**: Users see exactly what's happening during long processing jobs
- **Clean UI**: Metadata only shown after completion (no noisy estimates during processing)
- **Smooth navigation**: Optimized polling with no interval leaks

**Achieved Performance**:
- **Processing Time**: Real-time processing (starts immediately, ~5-7min for 100MB on Supabase Pro)
- **Memory Usage**: Constant ~10-20MB (vs 500-800MB previously)
- **Reliability**: 99%+ success rate (no memory crashes, proper timeout handling)
- **Scalability**: Successfully handles 100MB files (~1M samples)
- **Progress Resolution**: Updates every 10k samples for smooth visual feedback
- **File Size Estimation**: 90 bytes/row for accurate progress tracking
- **Infrastructure**: Supabase Pro + Vercel Pro recommended for production workloads

**Deployment**:
All schema is deployed via `/sql/complete-schema.sql` in the Supabase SQL Editor.

#### **Phase 2: Multi-Dimensional Stream Processing** (Weeks 3-4)

**Objective**: Calculate advanced metrics in real-time during processing

**Processing Dimensions**:
- **G-Force Analysis**: Lateral, longitudinal, vertical G-forces with smoothing
- **Orientation Processing**: Quaternion-to-Euler conversion, lean angle calculation
- **Sensor Fusion**: Complementary filter for gyroscope/accelerometer fusion
- **Derivative Calculations**: Rate of change for acceleration and angular velocity

**Implementation Strategy**:
- **Streaming Windowed Processing**: Process data in 10-second windows (1000 samples at 100Hz) as data streams
- **Real-time Calculations**: Calculate metrics as data flows through the stream
- **Database Integration**: Insert processed data into `imu_processed` table in real-time
- **Inngest Enhancement**: Add new `process-ride-analytics` function for streaming calculations

**Key Details**:
- Leverage existing `imu_processed` table structure (lateral_g, longitudinal_g, vertical_g, lean_angle)
- Use PostgreSQL window functions for efficient rolling calculations
- Implement Butterworth filtering for noise reduction
- Add processing stage tracking (`basic`, `enhanced`, `premium`)

**Expected Performance**:
- **Processing Time**: +1-2 minutes for advanced calculations
- **Storage Growth**: ~2x increase (raw + processed data)
- **Query Performance**: 5-10x faster for analytics queries

#### **Phase 3: Frequency Domain Analysis** (Weeks 5-6)

**Objective**: Analyze road surface quality through vibration frequency analysis

**Processing Capabilities**:
- **FFT Analysis**: Fast Fourier Transform on vertical acceleration data
- **Frequency Detection**: Identify dominant vibration frequencies (road buzz, pedaling)
- **Roughness Scoring**: Calculate RMS values and roughness metrics
- **Spectral Analysis**: Detect resonant frequencies from bike components

**Implementation Strategy**:
- **JavaScript FFT**: Use `fft-js` or `ml-matrix` libraries for frequency analysis
- **Windowed FFT**: Process 5-second windows for frequency resolution
- **Database Storage**: Store frequency data in `ride_imu_summary` (avg_vibration_magnitude, rough_section_count)
- **Real-time Processing**: Calculate during stream processing, not post-processing

**Key Details**:
- Integrate with existing `ride_imu_summary.avg_vibration_magnitude` field
- Add new fields: `dominant_frequency_hz`, `spectral_centroid`, `roughness_score`
- Use Web Workers for CPU-intensive FFT calculations
- Implement frequency-based event detection (potholes, rough sections)

**Expected Performance**:
- **Processing Time**: +30-60 seconds for FFT analysis
- **CPU Usage**: Moderate increase during frequency calculations
- **Insights**: Objective road quality metrics, component resonance detection

#### **Phase 4: Event Detection & Classification** (Weeks 7-8)

**Objective**: Automatically detect and classify cycling events (cornering, braking, acceleration)

**Event Types**:
- **Cornering Events**: Left/right turns with lean angle thresholds
- **Braking Events**: Hard deceleration detection with G-force thresholds
- **Acceleration Events**: Sprint detection and power analysis
- **Road Events**: Pothole detection, rough section identification

**Implementation Strategy**:
- **Threshold-based Detection**: Use configurable G-force and lean angle thresholds
- **Machine Learning**: Implement simple classification algorithms for event validation
- **Database Integration**: Create `imu_events` table for event storage
- **Real-time Processing**: Detect events during stream processing

**Key Details**:
- Extend existing `ride_imu_summary` event counts (corner_count_left, braking_events_count)
- Add `imu_events` table with event type, timestamp, confidence score
- Implement event validation to reduce false positives
- Create event timeline visualization for ride analysis

**Expected Performance**:
- **Processing Time**: +15-30 seconds for event detection
- **Storage**: Minimal increase (~1KB per event)
- **Accuracy**: 85-95% event detection accuracy with tuning

#### **Phase 5: Advanced Analytics & Machine Learning** (Weeks 9-12)

**Objective**: Implement predictive analytics and advanced cycling insights

**Advanced Features**:
- **Performance Prediction**: Predict power output from IMU data
- **Fatigue Detection**: Analyze pedaling smoothness degradation over time
- **Equipment Analysis**: Detect component wear through vibration patterns
- **Comparative Analytics**: Compare rides across different bikes/conditions

**Implementation Strategy**:
- **TensorFlow.js**: Implement client-side ML models for real-time inference
- **Feature Engineering**: Extract advanced features from processed data
- **Model Training**: Use historical data to train classification models
- **API Integration**: Create analytics endpoints for advanced queries

**Key Details**:
- Leverage existing `imu_processed` data for feature extraction
- Implement model versioning and A/B testing
- Add `ride_analytics` table for ML predictions and insights
- Create comparative analysis tools for multi-ride evaluation

**Expected Performance**:
- **Processing Time**: +2-5 minutes for ML inference
- **Accuracy**: 70-85% prediction accuracy (improves with more data)
- **Cost**: Moderate increase for ML compute resources

### Integration with Current Stack

**Inngest Functions**:
- **`parse-imu-streaming`**: True streaming CSV parser with PapaParse step callback
- **`process-ride-analytics-streaming`**: Real-time multi-dimensional processing
- **`analyze-ride-events-streaming`**: Streaming event detection and classification
- **`generate-ride-insights-streaming`**: Real-time ML-based analytics

**Supabase Integration**:
- **Database**: Leverage existing schema with minor enhancements
- **Storage**: Continue using current upload bucket with chunking
- **RLS**: Maintain security across all processing stages
- **Real-time**: Use Supabase subscriptions for processing status updates

**Vercel Integration**:
- **API Routes**: Extend current upload/processing endpoints
- **Edge Functions**: Use for lightweight processing tasks
- **Cron Jobs**: Implement scheduled analytics and cleanup tasks
- **Monitoring**: Integrate with Vercel Analytics for performance tracking

### Performance & Cost Optimization

**Resource Management**:
- **Tiered Processing**: Basic (free), Enhanced ($25/month), Premium ($100/month)
- **Dynamic Scaling**: Adjust processing resources based on file size and complexity
- **Caching Strategy**: Cache processed results to avoid recomputation
- **Cleanup Policies**: Automatic cleanup of old raw data after processing

**Expected Costs**:
- **Phase 1-2**: $0-25/month (basic processing)
- **Phase 3-4**: $25-75/month (enhanced analytics)
- **Phase 5**: $75-150/month (ML and advanced features)

This stream processing architecture maintains compatibility with your existing stack while providing a clear path to advanced cycling analytics capabilities.

**Alternatives:**
- **PlanetScale**: Serverless MySQL, very fast, but less ideal for time-series
- **Neon**: Serverless Postgres, similar to Supabase but less feature-rich
- **MongoDB Atlas**: NoSQL, good for unstructured data, less ideal for relational queries

**Recommendation**: Supabase for PostgreSQL power, generous free tier, and excellent Next.js integration.

---

### File Storage: **AWS S3** (via Supabase Storage or direct)

**Why:**
- Industry standard for object storage
- Pay-per-use (pennies per GB)
- High availability and durability
- Direct integration with processing pipelines

**Implementation Options**:

**Option A: Supabase Storage** (Recommended for simplicity)
- Built on top of S3
- Automatic signed URLs
- Integrated with Supabase auth
- Free tier: 1 GB storage

**Option B: AWS S3 Direct**
- More control
- Cheaper at scale
- Requires AWS SDK setup
- Presigned URLs for client-side upload

**Upload Flow**:
1. Client requests upload URL from API route
2. API generates presigned URL (S3 or Supabase)
3. Client uploads directly to storage (bypasses server)
4. Client notifies API of completion
5. Background job parses file and populates DB

**Recommendation**: Start with Supabase Storage, migrate to S3 direct if cost becomes an issue.

---

### Background Job Processing: **Inngest**

**Why:**
- Serverless background job execution
- Event-driven architecture
- Built-in retries and error handling
- Excellent for data-intensive processing
- Free tier: 1000 hours of job execution/month
- No infrastructure to manage

**Use Cases**:
1. Parse uploaded CSV IMU files
2. Extract data from FIT files
3. Calculate ride statistics
4. Generate traction circle plots
5. Detect braking events

**Example Implementation**:
```typescript
import { Inngest } from 'inngest'
import { parseIMUFile } from '@/lib/imu-parser'
import { supabase } from '@/lib/supabase'

const inngest = new Inngest({ id: 'imu-analyzer' })

export const processIMUFile = inngest.createFunction(
  { id: 'process-imu-file' },
  { event: 'imu/file.uploaded' },
  async ({ event, step }) => {
    // Step 1: Download file from S3
    const fileData = await step.run('download-file', async () => {
      return await downloadFromS3(event.data.s3Key)
    })
    
    // Step 2: Parse CSV
    const parsedData = await step.run('parse-csv', async () => {
      return await parseIMUFile(fileData)
    })
    
    // Step 3: Insert into database (batched)
    await step.run('insert-to-db', async () => {
      return await supabase
        .from('imu_data_points')
        .insert(parsedData)
    })
    
    // Step 4: Calculate summary statistics
    const summary = await step.run('calculate-stats', async () => {
      return await calculateRideStatistics(parsedData)
    })
    
    return { success: true, summary }
  }
)
```

**Alternatives**:
- **Upstash QStash**: Simpler, cron-based, less feature-rich
- **BullMQ + Redis**: More control, requires Redis instance
- **Trigger.dev**: Similar to Inngest, good alternative

**Recommendation**: Inngest for zero-ops background processing with excellent observability.

---

### Data Processing Libraries

#### CSV Parsing: **Papa Parse**
```typescript
import Papa from 'papaparse'

const results = Papa.parse(csvString, {
  header: true,
  dynamicTyping: true,
  skipEmptyLines: true
})
```

#### FIT File Parsing: **fit-file-parser** or **easy-fit**
```typescript
import FitParser from 'fit-file-parser'

const fitParser = new FitParser()
fitParser.parse(buffer, (error, data) => {
  // data.records contains all data points
  // data.sessions contains ride summary
})
```

#### Numerical Analysis: **mathjs** or **simple-statistics**
```typescript
import { mean, std, max, min } from 'simple-statistics'

const avgLeanAngle = mean(leanAngles)
const maxGForce = max(lateralGs)
```

#### Signal Processing: **fili.js** (DSP filters)
```typescript
import Fili from 'fili'

const iirCalculator = new Fili.IirFilter()
const lowpass = iirCalculator.lowpass({
  order: 3,
  characteristic: 'butterworth',
  Fs: 50, // sampling frequency
  Fc: 5   // cutoff frequency
})

const filteredData = data.map(sample => lowpass.singleStep(sample))
```

---

### Data Visualization: **uPlot** + **Plotly.js** (Hybrid Approach)

**Current Implementation: uPlot** ✅ (Implemented October 2025)

**Primary Charting Library: uPlot**
```typescript
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'

const opts = {
  width: 800,
  height: 400,
  series: [
    { label: 'Time' },
    { label: 'Accel X', stroke: '#f00', width: 2 },
    { label: 'Accel Y', stroke: '#0f0', width: 2 },
    { label: 'Accel Z', stroke: '#00f', width: 2 }
  ],
  cursor: {
    drag: { x: true, y: false },  // Drag-to-zoom
    sync: { key: 'imu-sync' }     // Sync with other charts
  }
}

const chart = new uPlot(opts, data, target)
```

**uPlot Pros**:
- ✅ **Tiny bundle size**: 50KB (vs Recharts 400KB, Plotly 3MB)
- ✅ **Blazing fast**: Renders 100k+ points in milliseconds
- ✅ **Interactive zoom/pan**: Drag-to-select, scroll to pan
- ✅ **Multi-chart sync**: Cursor sync across multiple charts
- ✅ **Time series optimized**: Perfect for 100Hz IMU data (720k samples/ride)
- ✅ **Low memory overhead**: Critical for mobile performance
- ✅ **Touch-friendly**: Works great on mobile devices

**uPlot Cons**:
- ❌ Limited to basic chart types (line, area, bar)
- ❌ No 3D visualizations
- ❌ No built-in heatmaps
- ❌ Sparse documentation (more DIY)

**Current Features (Implemented)**:
- ✅ LTTB downsampling (preserves visual features better than naive sampling)
- ✅ Progressive detail loading (fetch high-res data on zoom)
- ✅ Multi-axis synchronization
- ✅ Real-time performance with 500k-1M sample datasets
- ✅ API endpoint: `/api/data/[id]/samples?start=X&end=Y&resolution=high`

**Future Implementation: Plotly.js** (When Needed)

**Use Plotly for:**
1. **Traction Circle** (scatter plot: lateral G vs longitudinal G with color scale)
2. **3D Visualizations** (orientation quaternions, bike lean angle over GPS track)
3. **Heatmaps** (road surface quality, vibration frequency analysis)
4. **Contour Plots** (power/speed/lean angle correlations)
5. **Statistical Charts** (box plots, violin plots for ride comparisons)

**Plotly Implementation Strategy**:
- Use `plotly.js-cartesian-dist` (900KB) instead of full Plotly (3MB)
- Lazy load Plotly only on pages that need it (ride analysis, not raw data view)
- Keep uPlot as primary library for all time-series line charts

**Bundle Size Impact**:
- **Current**: uPlot (50KB) ← Optimized for speed
- **Future**: uPlot (50KB) + Plotly-cartesian (900KB) = 950KB total
- **Tradeoff**: 20x larger than uPlot alone, but 3x smaller than full Plotly

**Architecture: Smart Downsampling**

```typescript
// Server-side LTTB downsampling
import { downsampleLTTB, downsampleMultiSeries } from '@/lib/imu/lttb-downsample'

// Initial view: 20k samples → 2k points (LTTB)
const initialData = downsampleMultiSeries(rawSamples, 2000)

// On zoom: Fetch high-res data for selected range
const detailData = await fetch(`/api/data/${fileId}/samples?start=${start}&end=${end}&resolution=high`)
```

**Why LTTB over Naive Sampling?**
- Preserves peaks, valleys, and visual features
- Better representation of braking events, cornering forces
- Uses triangle area algorithm to select most visually significant points

**Performance Benchmarks** (Measured on MacBook Air M2):
- **100k points**: ~150ms render (uPlot), ~2s render (Recharts)
- **500k points**: ~600ms render (uPlot), unusable (Recharts)
- **Memory**: 50MB (uPlot), 200MB+ (Recharts) for 500k points

---

### UI Component Library: **shadcn/ui**

**Why:**
- Tailwind CSS-based components
- Copy-paste, not NPM package (full control)
- Accessible (Radix UI primitives)
- Modern, minimal aesthetic
- Excellent with Next.js

**Key Components for This App**:
- `Table`: Ride list, data file management
- `Dialog`: Upload modals, ride creation
- `Card`: Dashboard metrics
- `Button`, `Input`, `Select`: Forms
- `Tabs`: Ride detail page sections
- `Skeleton`: Loading states

**Example**:
```tsx
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'

<Card>
  <CardHeader>
    <CardTitle>Upload IMU Data</CardTitle>
  </CardHeader>
  <CardContent>
    <Button variant="outline">Select Files</Button>
  </CardContent>
</Card>
```

**Alternatives**:
- **Chakra UI**: More batteries-included, but heavier
- **Mantine**: Excellent, similar to shadcn/ui
- **Ant Design**: Enterprise-grade, but opinionated styling

**Recommendation**: shadcn/ui for flexibility and modern aesthetic.

---

### State Management: **Zustand** (if needed)

For client-side global state (user preferences, UI state):

```typescript
import { create } from 'zustand'

const useStore = create((set) => ({
  selectedRide: null,
  setSelectedRide: (ride) => set({ selectedRide: ride }),
  
  uploadProgress: 0,
  setUploadProgress: (progress) => set({ uploadProgress: progress })
}))
```

**Why Zustand**:
- Minimal boilerplate
- No provider wrapping needed
- TypeScript-friendly
- Good for small-to-medium state needs

**Note**: With Next.js server components, you may not need much client-side state management. React Query (TanStack Query) handles server state caching automatically.

---

### Data Fetching: **TanStack Query (React Query)**

**Why:**
- Automatic caching, refetching, and synchronization
- Optimistic updates
- Excellent for server state management
- Works seamlessly with Next.js

```typescript
import { useQuery } from '@tanstack/react-query'

function RideList() {
  const { data: rides, isLoading } = useQuery({
    queryKey: ['rides'],
    queryFn: async () => {
      const res = await fetch('/api/rides')
      return res.json()
    }
  })
  
  if (isLoading) return <Skeleton />
  
  return rides.map(ride => <RideCard key={ride.id} ride={ride} />)
}
```

---

## Application Architecture

### High-Level Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER BROWSER                             │
├─────────────────────────────────────────────────────────────────┤
│  Next.js Frontend (React Components + Server Components)        │
│                                                                  │
│  Pages:                                                          │
│  - Dashboard (/dashboard)                                        │
│  - Upload (/upload)                                              │
│  - Create Ride (/rides/create)                                   │
│  - Ride Detail (/rides/[id])                                     │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                      VERCEL (Next.js API Routes)                 │
├─────────────────────────────────────────────────────────────────┤
│  /api/upload/presigned-url  → Generate S3 upload URL            │
│  /api/upload/complete       → Trigger processing job            │
│  /api/rides                 → CRUD operations                    │
│  /api/rides/[id]/data       → Fetch time-series data            │
│  /api/fit/parse             → FIT file metadata extraction       │
└─────┬──────────────────────────┬────────────────────────────────┘
      │                          │
      ▼                          ▼
┌──────────────┐        ┌──────────────────────┐
│Supabase Auth │        │   Inngest Jobs       │
│              │        │                      │
│ - OAuth      │        │ - Parse IMU CSV      │
│ - Session    │        │ - Process FIT        │
│ - RLS        │        │ - Calculate Stats    │
└──────────────┘        │ - Generate Charts    │
                        └──────────┬───────────┘
                                   │
                                   ▼
                        ┌──────────────────────┐
                        │  Supabase Storage    │
                        │  (S3-backed)         │
                        │                      │
                        │  - Raw IMU CSVs      │
                        │  - FIT files         │
                        │  - Generated charts  │
                        └──────────────────────┘
                                   │
                                   ▼
                        ┌──────────────────────┐
                        │  Supabase Database   │
                        │  (PostgreSQL)        │
                        │                      │
                        │  - Users             │
                        │  - IMU data files    │
                        │  - Rides             │
                        │  - FIT metadata      │
                        │  - Time-series data  │
                        └──────────────────────┘
```

---

## Page Structure & Features

### 1. Dashboard (`/dashboard`)

**Purpose**: Overview of user's cycling data

**Components**:
- **Header**: User profile, sign out
- **Stats Cards**: 
  - Total rides logged
  - Total hours of IMU data
  - Latest ride date
  - Storage used (MB)
- **Timeline View**: Calendar heatmap or timeline showing dates with uploaded data
- **Recent Rides**: Table of last 10 processed rides
  - Columns: Name, Date, Duration, Distance, Max Lean Angle
  - Click row → navigate to ride detail
- **Insights Placeholder**: "Coming Soon: Ride comparison, trends, personal bests"

**Implementation**:
```tsx
// app/dashboard/page.tsx
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { StatsCards } from '@/components/dashboard/stats-cards'
import { RidesList } from '@/components/dashboard/rides-list'
import { TimelineView } from '@/components/dashboard/timeline'

export default async function DashboardPage() {
  const supabase = createServerComponentClient({ cookies })
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) redirect('/login')
  
  // Fetch data in server component
  const stats = await getStatsForUser(user.id)
  const recentRides = await getRecentRides(user.id)
  
  return (
    <div className="container mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6">Dashboard</h1>
      <StatsCards stats={stats} />
      <TimelineView userId={user.id} />
      <RidesList rides={recentRides} />
    </div>
  )
}
```

---

### 2. Upload Page (`/upload`)

**Purpose**: Upload IMU CSV files and FIT files

**Components**:
- **File Upload Dropzone**: Drag-and-drop or click to select
  - Multi-file support
  - File type validation (.csv, .fit)
  - File size display
- **Upload Progress**: Per-file progress bars
- **Upload History**: List of recently uploaded files with status
  - Status: Uploading, Processing, Complete, Failed
  - Actions: View details, delete

**Features**:
- Client-side direct upload to S3 (presigned URLs)
- Progress tracking with XHR or fetch API
- Automatic processing job trigger on completion

**Implementation**:
```tsx
// app/upload/page.tsx
'use client'

import { useDropzone } from 'react-dropzone'
import { useMutation } from '@tanstack/react-query'
import { uploadToS3 } from '@/lib/upload'

export default function UploadPage() {
  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      // Get presigned URL
      const { url, key } = await fetch('/api/upload/presigned-url', {
        method: 'POST',
        body: JSON.stringify({ filename: file.name, size: file.size })
      }).then(r => r.json())
      
      // Upload directly to S3
      await uploadToS3(url, file, (progress) => {
        console.log(`Upload progress: ${progress}%`)
      })
      
      // Notify backend to start processing
      await fetch('/api/upload/complete', {
        method: 'POST',
        body: JSON.stringify({ key, filename: file.name })
      })
    }
  })
  
  const { getRootProps, getInputProps } = useDropzone({
    accept: {
      'text/csv': ['.csv'],
      'application/octet-stream': ['.fit']
    },
    onDrop: (files) => {
      files.forEach(file => uploadMutation.mutate(file))
    }
  })
  
  return (
    <div {...getRootProps()} className="border-2 border-dashed p-12">
      <input {...getInputProps()} />
      <p>Drag & drop files here, or click to select</p>
    </div>
  )
}
```

---

### 3. Create Ride Page (`/rides/create`)

**Purpose**: Define a ride from uploaded data

**Components**:

**Mode 1: Manual Definition**
- Date/time range picker
  - Start: Date + Time input
  - End: Date + Time input
- Available data indicator: Show if IMU data exists for selected range
- Ride metadata form:
  - Name (text input)
  - Location (text input, future: map picker)
  - Bike (dropdown: Road, Gravel, MTB, etc.)
  - Conditions (checkboxes: Dry, Wet, Windy)
  - Notes (textarea)

**Mode 2: FIT File Association**
- FIT file upload (if not already uploaded)
- Auto-extract time bounds from FIT data
- Display summary: Distance, duration, avg speed
- Check for overlapping IMU data
- Same metadata form as above

**Implementation Flow**:
1. User selects mode (Manual or FIT upload)
2. Define time bounds
3. System validates IMU data availability
4. User fills metadata
5. Submit → Trigger background processing job
6. Redirect to ride detail page (processing in progress)

---

### 4. Ride Detail Page (`/rides/[id]`)

**Purpose**: View processed ride data and analysis

**Layout Sections**:

**Header**:
- Ride name (editable)
- Date, duration, distance
- Actions: Export, Delete, Share (future)

**Tabs**:

**Tab 1: Overview**
- Summary stats cards:
  - Max lean angle (left/right)
  - Max lateral G-force
  - Max longitudinal G-force
  - Hard braking events count
  - Avg road roughness score
- GPS map (if FIT data available)
- Elevation profile

**Tab 2: IMU Analysis**
- **Traction Circle**: Scatter plot of lateral vs. longitudinal G
- **Lean Angle Timeline**: Line chart of roll angle over ride
- **G-Force Timeline**: 3-axis acceleration over time
- **Braking Events**: Annotated timeline showing hard braking points

**Tab 3: Power Analysis** (if FIT data available)
- Power vs. grade correlation
- Power curve
- Heart rate zones

**Tab 4: Raw Data**
- Download options:
  - Processed CSV
  - Original files
  - Chart images
- Data table with pagination (first 1000 rows preview)

**Placeholder States**:
- If processing incomplete: "Analysis in progress... Refresh in a moment"
- If no FIT data: "Upload FIT file to see power analysis"

**Implementation**:
```tsx
// app/rides/[id]/page.tsx
import { notFound } from 'next/navigation'
import { TractionCircle } from '@/components/rides/traction-circle'
import { LeanAngleChart } from '@/components/rides/lean-angle-chart'

export default async function RidePage({ params }: { params: { id: string } }) {
  const ride = await getRideById(params.id)
  
  if (!ride) notFound()
  
  return (
    <div className="container mx-auto p-6">
      <RideHeader ride={ride} />
      
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="imu">IMU Analysis</TabsTrigger>
          <TabsTrigger value="power">Power</TabsTrigger>
          <TabsTrigger value="data">Raw Data</TabsTrigger>
        </TabsList>
        
        <TabsContent value="overview">
          <StatsSummary ride={ride} />
        </TabsContent>
        
        <TabsContent value="imu">
          <TractionCircle data={ride.imu_summary} />
          <LeanAngleChart rideId={ride.id} />
        </TabsContent>
        
        {/* ... other tabs */}
      </Tabs>
    </div>
  )
}
```

---

### 5. Authentication Pages

#### `/login` - Sign In Page

**Purpose**: User authentication entry point

**Components**:
- **Page Title**: "Sign In to Vertex"
- **OAuth Providers**: 
  - Google button (primary)
  - GitHub button (secondary)
- **Divider**: "or continue with email"
- **Email/Password Form**:
  - Email input
  - Password input
  - "Forgot password?" link
  - Submit button
- **Footer Links**: 
  - "Don't have an account? Sign up"
  - Terms of Service, Privacy Policy

**Status**: ✅ Implemented in `src/app/login/page.tsx`

#### `/signup` - Registration Page

**Purpose**: New user registration

**Components**: Similar to login page, with additional fields:
- Confirm password input
- Display name input (optional)
- Accept terms checkbox
- "Already have an account? Sign in" link

**Status**: ✅ Implemented in `src/app/signup/page.tsx`

#### `/auth/callback` - OAuth Callback Handler

**Purpose**: Handle OAuth redirects from Google/GitHub

**Status**: ✅ Implemented in `src/app/auth/callback/page.tsx` (route handler will be added with Supabase integration)

---

### 6. Settings Page (`/settings`)

**Purpose**: User profile and application preferences

**Components**:

**Tabs**:
1. **Profile** (default)
   - Avatar upload
   - Full name
   - Email (read-only, from auth)
   - Timezone selector
   
2. **Bikes**
   - List of bikes user owns
   - Add bike: Name, Type (Road/Gravel/MTB), Weight
   - Edit/Delete bikes
   - Used in ride metadata dropdown
   
3. **Preferences**
   - Units: Metric / Imperial
   - Default bike (for new rides)
   - Email notifications (future)
   
4. **Account**
   - Connected accounts (Google, GitHub)
   - Change password
   - Delete account (with confirmation)

**Status**: ✅ Implemented in `src/app/settings/page.tsx` (components for each tab will be added with Supabase integration)

**Database Schema Addition**:
The `bikes` and `user_preferences` tables are included in `/sql/complete-schema.sql` (currently commented out as future features).

---

### 7. Navigation Structure

**Layout**: Breadcrumb navigation (no sidebar or hamburger menu)

**Components**:

**Status**: ✅ Implemented in `src/components/layout/header.tsx`

**Status**: ✅ Implemented in `src/components/breadcrumbs.tsx`

**Status**: ✅ Implemented in `src/components/user-button.tsx`

**Status**: ✅ Root layout updated in `src/app/layout.tsx` with Header component integrated

---

### 8. Data Management Page (Future / Post-MVP)

**Purpose**: Manage all uploaded raw IMU and FIT files

**Scope**: Table for later implementation

**Features** (to be implemented):
- View all uploaded files (not just recent)
- Filter by date, type, processed/unprocessed status
- See which files are assigned to rides vs orphaned
- Bulk delete old files
- Re-process files if needed
- Storage usage breakdown

**Route**: `/data` or `/files`

**Priority**: Post-MVP - users can manage data through upload page and ride detail pages initially

---

## Data Processing Pipeline

### Upload → Processing Flow

**Step 1: Client-Side Upload**
```typescript
// Client requests presigned URL
POST /api/upload/presigned-url
Body: { filename: "ride_20251021.csv", size: 72000000 }

Response: { 
  url: "https://s3.amazonaws.com/...",
  key: "users/user123/imu/ride_20251021.csv"
}

// Client uploads directly to S3
PUT <presigned_url>
Body: <file_binary>

// Client notifies completion
POST /api/upload/complete
Body: { key: "users/user123/imu/ride_20251021.csv" }
```

**Step 2: Background Processing (Inngest)**
```typescript
// api/upload/complete triggers event
await inngest.send({
  name: 'imu/file.uploaded',
  data: { 
    userId: 'user123',
    s3Key: 'users/user123/imu/ride_20251021.csv',
    filename: 'ride_20251021.csv'
  }
})

// Inngest function processes file
export const processIMUFile = inngest.createFunction(
  { id: 'process-imu-file' },
  { event: 'imu/file.uploaded' },
  async ({ event, step }) => {
    // Download from S3
    const fileBuffer = await step.run('download', async () => {
      return await downloadFromS3(event.data.s3Key)
    })
    
    // Parse CSV (streaming for large files)
    const { data, metadata } = await step.run('parse', async () => {
      return await parseIMUCSV(fileBuffer)
    })
    
    // Extract time bounds
    const startTime = data[0].timestamp
    const endTime = data[data.length - 1].timestamp
    
    // Insert metadata into DB
    await step.run('save-metadata', async () => {
      return await supabase.from('imu_data_files').insert({
        user_id: event.data.userId,
        filename: event.data.filename,
        s3_key: event.data.s3Key,
        start_time: startTime,
        end_time: endTime,
        sample_rate: metadata.sampleRate,
        sample_count: data.length
      })
    })
    
    return { success: true, sampleCount: data.length }
  }
)
```

**Step 3: Ride Creation Processing**
```typescript
export const processRide = inngest.createFunction(
  { id: 'process-ride' },
  { event: 'ride/created' },
  async ({ event, step }) => {
    const { rideId, startTime, endTime } = event.data
    
    // Query IMU data for time range
    const imuData = await step.run('fetch-imu-data', async () => {
      return await supabase
        .from('imu_data_points')
        .select('*')
        .gte('timestamp', startTime)
        .lte('timestamp', endTime)
    })
    
    // Calculate statistics
    const stats = await step.run('calculate-stats', async () => {
      return {
        maxLateralG: max(imuData.map(d => Math.abs(d.accel_y))),
        maxLongitudinalG: max(imuData.map(d => Math.abs(d.accel_x))),
        maxLeanAngle: max(imuData.map(d => Math.abs(d.roll))),
        brakingEvents: detectBrakingEvents(imuData),
        avgRoughness: calculateRoughness(imuData)
      }
    })
    
    // Save summary
    await step.run('save-summary', async () => {
      return await supabase.from('ride_imu_summary').insert({
        ride_id: rideId,
        ...stats,
        processing_completed_at: new Date()
      })
    })
    
    return { success: true, stats }
  }
)
```

---

## Budget & Infrastructure Plan

### Production Budget: $100/month

**Target User Scale**: 1-5 active users, 50-100 rides/month, production-grade reliability

---

### Recommended Allocation

| Service | Tier/Plan | Monthly Cost | Justification |
|---------|-----------|--------------|---------------|
| **Supabase** | Pro tier + MICRO compute | **$35-45** | Database performance is critical - NANO tier causes timeouts |
| **Vercel** | Pro tier | **$20** | Production domains, better analytics, team collaboration |
| **Inngest** | Hobby tier (optimized) | **$0** | 5-min timeout - supports up to 30-35MB files with progress tracking |
| **Domain** | Custom domain | **$12/year** | Professional branding (vertex-imu.com) |
| **Sentry** | Free tier | **$0** | Error tracking (5k errors/month sufficient) |
| **Buffer** | Contingency | **$15-35** | Overages, testing, scaling headroom |

**Total: $55-65/month** (optimized for free tier - handles up to 35MB files reliably)

---

### Service Details

#### Supabase: $35-45/month ⭐ **Critical Investment**

**Base Pro Plan**: $25/month
- 8 GB database (vs 500 MB free)
- 100 GB storage (vs 1 GB free)
- 50 GB bandwidth (vs 2 GB free)
- Daily backups (7 days retention)
- Email support

**Compute Add-on**: $10-20/month
- **MICRO tier** ($10/month): 1 GB RAM, 2-core ARM CPU
  - ✅ Handles 10k batch inserts in 1-2 seconds (vs timeouts on NANO)
  - ✅ Dedicated CPU (not shared/throttled)
  - ✅ Suitable for 1-5 users
- **SMALL tier** ($15/month): 2 GB RAM, 2-core ARM CPU
  - If processing >50 files/month
  - Better for concurrent users

**Why This Matters**: 
- NANO tier (free) **cannot handle production workloads** - times out on batch inserts
- MICRO tier eliminates timeouts, reduces processing time from 10+ minutes to 1-2 minutes
- Database performance is the #1 bottleneck - worth the investment

**ROI**: ~$40/month buys you 10-20x faster processing and zero timeouts

---

#### Vercel: $20/month

**Pro Tier Benefits**:
- 100 GB bandwidth (vs 100 GB free) - same, but pro gets priority
- Unlimited team members (vs solo on free)
- Advanced analytics & insights
- Commercial deployment rights
- Password protection for preview deployments
- Edge function logs (debugging)

**Alternative - Stay on Free Tier**:
- ✅ 100 GB bandwidth sufficient for <100 users
- ✅ No team collaboration needed yet
- ✅ Analytics not critical
- ❌ Missing: advanced debugging tools, commercial rights

**Recommendation**: 
- **Start on free tier**, upgrade to Pro when:
  - Need team collaboration
  - Approaching bandwidth limits (>50 GB/month)
  - Want better observability

**Save $20/month initially** → reallocate to Supabase compute

---

#### Inngest: Free Tier (Sufficient)

**Free Tier Limits**:
- 1,000 job-hours/month
- 50 concurrent runs
- 7 days of logs

**Your Usage**:
- ~100 files/month × 2 minutes each = 200 minutes = **3.3 job-hours/month**
- Well within free tier (300x headroom)

**Paid Tier ($25/month)** only needed if:
- Processing >10,000 files/month
- Need 30+ days of logs
- Require priority support

**Recommendation**: **Stay on free tier** indefinitely

---

#### Additional Services (Optional)

**Sentry - Error Tracking**: Free tier
- 5,000 errors/month
- 7 days retention
- Sufficient for early stage
- **Cost**: $0/month
- **Upgrade at**: >5k errors/month or need longer retention

**Custom Domain**: $12/year (~$1/month)
- vertex-cycling.com or vertex-imu.com
- Professional branding
- **Cost**: $12/year one-time
- **Buy through**: Vercel or Namecheap

**Uptime Monitoring** (BetterUptime): Free tier
- 3 monitors
- 60-second checks
- Email/Slack alerts
- **Cost**: $0/month
- **Useful for**: Production health checks

---

### Budget Scenarios

#### Scenario A: Cost-Optimized ($35-40/month)

| Service | Plan | Cost |
|---------|------|------|
| Supabase Pro + MICRO compute | Pro + MICRO | $35 |
| Vercel | Free tier | $0 |
| Inngest | Free tier | $0 |
| Sentry | Free tier | $0 |
| Domain | vertex-*.com | $1/month |
| **Total** | | **$36/month** |

**Best for**: Solo use, cost-conscious, proven product-market fit

---

#### Scenario B: Production-Ready ($55-65/month) ⭐ **Recommended**

| Service | Plan | Cost |
|---------|------|------|
| Supabase Pro + MICRO compute | Pro + MICRO | $35 |
| Vercel | Pro tier | $20 |
| Inngest | Free tier | $0 |
| Sentry | Free tier | $0 |
| Domain | vertex-*.com | $1/month |
| **Total** | | **$56/month** |

**Best for**: Professional app, 1-5 users, team collaboration, commercial deployment

---

#### Scenario C: Performance-Optimized ($70-80/month)

| Service | Plan | Cost |
|---------|------|------|
| Supabase Pro + SMALL compute | Pro + SMALL | $40 |
| Supabase Storage (extra 100 GB) | Add-on | $10 |
| Vercel | Pro tier | $20 |
| Inngest | Free tier | $0 |
| Sentry | Free tier | $0 |
| Domain | vertex-*.com | $1/month |
| **Total** | | **$71/month** |

**Best for**: 5-10 users, heavy processing (>100 files/month), faster response times

---

### Growth Thresholds (When to Upgrade)

**Supabase**:
- MICRO → SMALL: Processing >50 files/month or 3+ concurrent users
- SMALL → MEDIUM: Processing >200 files/month or 10+ users
- Add storage: Exceeding 100 GB (100 GB × $0.125/GB = $12.50 per 100 GB)

**Vercel**:
- Free → Pro: Bandwidth >80 GB/month or need team collaboration
- Pro → Enterprise: >100 concurrent users or need advanced security

**Inngest**:
- Free → Pro: Processing >1,000 files/month (rare)

---

### Immediate Action Plan

**Week 1: Fix Performance Issues**
1. ✅ **Upgrade Supabase to MICRO compute** ($10/month)
   - Eliminates timeouts
   - 10-20x faster batch inserts
   - Critical for production
2. ✅ Deploy optimized batch size (10k samples)
3. ✅ Test with 50MB files - should complete in 1-2 minutes

**Month 1-3: Validate on Free Tier + MICRO Compute**
- Cost: ~$35/month (Supabase Pro + MICRO)
- Stay on Vercel free tier
- Monitor usage and performance
- Collect user feedback

**Month 4+: Upgrade to Pro Stack if Needed**
- Add Vercel Pro if bandwidth >80 GB/month
- Upgrade to SMALL compute if >50 files/month
- Total: $55-70/month

---

### Cost Per Ride (Economics)

**At $56/month production budget**:
- 100 rides/month = **$0.56/ride**
- 50 rides/month = **$1.12/ride**
- 200 rides/month = **$0.28/ride**

**Compared to alternatives**:
- Strava Summit: $60/year = $5/month (no IMU data)
- TrainingPeaks: $20/month (no IMU data)
- **Vertex**: $56/month with full IMU analysis

**Value prop**: Unique capability (IMU data), professional-grade reliability

---

### Free Tier Limitations (Why Upgrade Matters)

| Issue | Free Tier | MICRO Tier | Impact |
|-------|-----------|------------|---------|
| **Batch insert timeouts** | ❌ Constant | ✅ None | **Critical** |
| **Processing time** | ⏱️ 10+ min | ⏱️ 1-2 min | 5-10x faster |
| **Concurrent users** | ⚠️ 1 user | ✅ 3-5 users | Scalability |
| **Database size** | 🔴 500 MB | ✅ 8 GB | Growth headroom |
| **Storage** | 🔴 1 GB | ✅ 100 GB | 100x capacity |

**Bottom line**: Free tier worked for prototyping, but NANO compute **cannot handle production workloads**. MICRO tier ($10/month) is the minimum viable production configuration.

---

## Development Roadmap

### Phase 1: MVP (Weeks 1-2)
- [x] Next.js project setup with TypeScript
- [ ] Supabase Auth integration (Google OAuth, custom forms)
- [ ] Supabase database schema with RLS policies
- [ ] Basic upload page with S3 presigned URLs
- [ ] Dashboard with uploaded files list
- [ ] Create ride page (manual time selection only)
- [ ] Ride detail page (metadata only, no charts)

### Phase 2: Data Processing (Weeks 3-4)
- [ ] Inngest job for CSV parsing
- [ ] Insert time-series data into PostgreSQL
- [ ] Calculate basic statistics (max lean, max G)
- [ ] Display stats on ride detail page

### Phase 3: Visualization (Weeks 5-6)
- [x] Time series charts with zoom/pan (uPlot) ✅ October 2025
- [x] LTTB downsampling for performance (uPlot) ✅ October 2025
- [ ] Traction circle plot (Plotly.js)
- [ ] Lean angle timeline (uPlot)
- [ ] G-force timeline (uPlot)
- [ ] Braking events detection and display

### Phase 4: FIT Integration (Week 7)
- [ ] FIT file upload and parsing
- [ ] Extract GPS, power, heart rate data
- [ ] Display map and elevation profile
- [ ] Auto-associate ride time bounds from FIT

### Phase 5: Polish & Optimization (Week 8)
- [ ] Improve loading states and error handling
- [ ] Add data export functionality
- [ ] Performance optimization for large datasets
- [ ] Mobile responsive design refinement
- [ ] Documentation and deployment

---

## Key Libraries Summary

| Category | Library | Purpose |
|----------|---------|---------|
| **Framework** | Next.js 14 | React framework, server components, API routes |
| **Deployment** | Vercel | Hosting, serverless functions, automatic deployments |
| **Auth** | Supabase Auth | OAuth, session management, RLS integration |
| **Database** | Supabase (PostgreSQL) | Relational database, real-time subscriptions, RLS |
| **Storage** | Supabase Storage / S3 | Object storage for CSV and FIT files |
| **Background Jobs** | Inngest | Serverless job processing, event-driven |
| **Data Fetching** | TanStack Query | Server state management, caching, mutations |
| **UI Components** | shadcn/ui | Tailwind-based components, accessible, customizable |
| **Charts** | uPlot + Plotly.js | High-performance time series, scientific visualizations |
| **CSV Parsing** | Papa Parse | Fast CSV parser with streaming support |
| **FIT Parsing** | fit-file-parser | Garmin FIT file decoder |
| **Numerical** | simple-statistics | Statistical calculations, mean, std, max, min |
| **Signal Processing** | fili.js | Digital filters (low-pass, high-pass) |
| **File Upload** | react-dropzone | Drag-and-drop file upload UI |
| **State** | Zustand (optional) | Minimal client-side state management |

---

## Next Steps

1. **Initialize Repository**:
   ```bash
   npx create-next-app@latest imu-analyzer --typescript --tailwind --app
   cd imu-analyzer
   ```

2. **Install Core Dependencies**:
   ```bash
   npm install @supabase/supabase-js @supabase/auth-helpers-nextjs inngest
   npm install @tanstack/react-query papaparse fit-file-parser
   npm install uplot simple-statistics fili
   npm install react-dropzone
   
   # Optional: Add Plotly when needed for traction circle, heatmaps
   npm install plotly.js-cartesian-dist  # 900KB (smaller than full plotly.js)
   ```

3. **Setup shadcn/ui**:
   ```bash
   npx shadcn-ui@latest init
   npx shadcn-ui@latest add button card dialog input table tabs
   ```

4. **Configure Environment Variables** (`.env.local`):
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJh...
   SUPABASE_SERVICE_ROLE_KEY=eyJh...
   
   INNGEST_SIGNING_KEY=signkey-...
   INNGEST_EVENT_KEY=eventkey-...
   ```

5. **Setup Database Schema**: Run SQL from database section in Supabase SQL editor

6. **Implement MVP pages** following the structure outlined above

---

## Open Questions / Future Considerations

1. **Data Downsampling**: Should we downsample 100 Hz data to 10-20 Hz for visualization to improve browser performance?

2. **Real-time Processing**: Could we process data as it's being uploaded (streaming) rather than waiting for full file upload?

3. **Caching Strategy**: Should we pre-generate chart data and cache it, or compute on-demand?

4. **Multi-bike Support**: Track different bikes, compare performance across bikes?

5. **Social Features**: Share rides publicly, leaderboards, compare with friends?

6. **Mobile App**: Native mobile app for easier upload from phone (SD card reader → phone → cloud)?

7. **Advanced Analytics**: Machine learning for ride classification, anomaly detection, personalized recommendations?

---

## Brand Identity & Visual Design

### Brand Name: Vertex

**Meaning**: The point where two lines meet to form an angle; the apex of a corner; the peak of performance.

**Tagline Options**:
- "Measure Every Angle"
- "Where Data Meets Dynamics"
- "The Point of Performance"
- "Precision in Motion"

**Visual Identity**: Sophisticated, analytical, subtly editorial. References the resurgence of serif typography in modern digital products (CoStar, Vacation) while maintaining clarity and data-focused functionality.

---

### Typography

**Primary Typeface: Serif (Display & Body)**

Inspired by the editorial sophistication of CoStar and Vacation, Vertex uses serif fonts throughout the application to create a distinct, refined aesthetic that stands apart from typical cycling tech products.

**Recommended Font Pairings**:

**Option 1: Modern Editorial** (Recommended)
- **Display**: **Tiempos Text** or **Freight Display** 
  - Headers, page titles, hero text
  - Elegant, slightly condensed, readable at large sizes
- **Body**: **Tiempos Text** (same family for cohesion)
  - Paragraphs, descriptions, form labels
  - Highly legible, optimized for screen reading
- **Data/Monospace**: **JetBrains Mono** or **SF Mono**
  - Numbers, timestamps, technical values
  - Maintains precision for data presentation

**Option 2: Classic Tech-Serif**
- **Display**: **Lyon** or **Surveyor**
  - Strong personality, slightly more assertive
- **Body**: **Lyon Text**
  - Clean, modern serif with excellent legibility
- **Data/Monospace**: **Input Mono** or **IBM Plex Mono**

**Option 3: Open Source Alternative**
- **Display & Body**: **Crimson Pro** (Google Fonts)
  - Free, high-quality serif
  - Good for prototyping before investing in premium fonts
- **Data/Monospace**: **JetBrains Mono** (free)

**Typography Scale**:
```css
/* Tailwind config */
fontSize: {
  'xs': '0.75rem',      // 12px - Captions, metadata
  'sm': '0.875rem',     // 14px - Secondary text
  'base': '1rem',       // 16px - Body text
  'lg': '1.125rem',     // 18px - Large body
  'xl': '1.25rem',      // 20px - Subheadings
  '2xl': '1.5rem',      // 24px - Section titles
  '3xl': '1.875rem',    // 30px - Page titles
  '4xl': '2.25rem',     // 36px - Hero text
  '5xl': '3rem',        // 48px - Landing hero
}
```

**Implementation Note**: Configure in `tailwind.config.ts`:
```typescript
import { type Config } from "tailwindcss"

const config: Config = {
  theme: {
    extend: {
      fontFamily: {
        serif: ['var(--font-tiempos)', 'Georgia', 'serif'],
        mono: ['var(--font-jetbrains)', 'Consolas', 'monospace'],
      }
    }
  }
}
```

---

### Visual Style & Design Principles

**1. Subtle Editorial Aesthetic**
- Serif typography creates refined, almost magazine-like quality
- Not overly decorative - maintains data clarity
- Generous whitespace, breathing room around content
- Restrained use of color for hierarchy

**2. Data-Forward Presentation**
- Charts and visualizations are primary
- UI chrome is minimal, unobtrusive
- Tables and data displays feel authoritative, trustworthy
- Monospace for all numerical data (precision matters)

**3. Sophisticated Simplicity**
- Avoid cycling clichés (neon colors, aggressive gradients, race graphics)
- Think "financial analytics meets cycling" not "fitness app"
- Muted, professional color palette (see below)
- Clean layouts with strong typographic hierarchy

**4. Functional Motion**
- Transitions are subtle, purposeful
- No gratuitous animations
- Loading states are elegant, not flashy
- Micro-interactions enhance usability without distraction

---

### Color Palette

**[PLACEHOLDER - Reference Image TBD]**

**Design Direction**: 
- Muted, sophisticated earth tones or deep jewel tones
- Avoid bright primary colors common in cycling tech (Wahoo blue, Garmin teal)
- High contrast for data readability
- Accent color for CTAs and data highlights

**Palette Structure**:
```typescript
// To be populated with specific hex values
colors: {
  // Primary brand color
  primary: {
    50: '#...',   // Lightest tint
    100: '#...',
    // ... 200-800
    900: '#...',  // Darkest shade
  },
  
  // Neutral grays (for backgrounds, text, borders)
  neutral: {
    50: '#...',   // Near white
    100: '#...',
    // ... 200-800
    900: '#...',  // Near black
  },
  
  // Accent color (for CTAs, highlights, interactive elements)
  accent: {
    50: '#...',
    // ...
    900: '#...',
  },
  
  // Data visualization (distinct from brand colors)
  chart: {
    'g-force': '#...',      // Lateral G-forces
    'lean-angle': '#...',   // Lean angle data
    'braking': '#...',      // Braking events
    'elevation': '#...',    // Elevation/grade
    'power': '#...',        // Power data
    'heart-rate': '#...',   // HR data
  },
  
  // Semantic colors (success, warning, error)
  success: '#...',
  warning: '#...',
  error: '#...',
}
```

**Inspiration References**:
- CoStar: Muted olive, warm grays, editorial black
- Vacation: Earth tones, terracotta, sage green
- Alternative: Deep navy, warm stone, rust accent

---

### UI Component Styling

**Cards**:
```tsx
<Card className="border-neutral-200 bg-white shadow-sm">
  <CardHeader className="border-b border-neutral-100">
    <CardTitle className="font-serif text-2xl">Ride Statistics</CardTitle>
  </CardHeader>
  <CardContent className="pt-6">
    {/* Content */}
  </CardContent>
</Card>
```

**Buttons**:
```tsx
// Primary CTA
<Button className="bg-primary-600 hover:bg-primary-700 font-serif">
  Upload Data
</Button>

// Secondary
<Button variant="outline" className="border-neutral-300 font-serif">
  Cancel
</Button>
```

**Data Display**:
```tsx
// Metric card
<div className="space-y-1">
  <p className="text-sm text-neutral-600 font-serif">Max Lean Angle</p>
  <p className="text-3xl font-mono font-semibold text-neutral-900">
    32.4°
  </p>
  <p className="text-xs text-neutral-500 font-serif">Left turn, 14:23</p>
</div>
```

**Tables**:
```tsx
<Table className="font-serif">
  <TableHeader>
    <TableRow className="border-neutral-200">
      <TableHead className="font-serif font-semibold">Date</TableHead>
      <TableHead className="font-mono">Duration</TableHead>
      {/* ... */}
    </TableRow>
  </TableHeader>
  <TableBody>
    <TableRow className="border-neutral-100">
      <TableCell className="font-serif">Oct 21, 2025</TableCell>
      <TableCell className="font-mono">2:14:33</TableCell>
      {/* ... */}
    </TableRow>
  </TableBody>
</Table>
```

---

### Logo Concept

**Wordmark**: "VERTEX" in serif capitals
- Simple, authoritative
- No icon necessary initially (wordmark stands alone)

**Optional Icon**: 
- Geometric abstraction of a corner apex
- Three converging lines forming a vertex point
- Minimal, can work as favicon

```
    /\
   /  \
  /____\
  VERTEX
```

---

### Design Checklist

When implementing UI components, ensure:
- [ ] Serif font used for all text except data/code
- [ ] Monospace font for all numerical values
- [ ] Generous padding and whitespace (not cramped)
- [ ] Subtle borders (neutral-200 or lighter)
- [ ] Minimal use of shadows (shadow-sm only)
- [ ] Color used sparingly for emphasis
- [ ] High contrast for readability
- [ ] Consistent spacing scale (4, 8, 16, 24, 32, 48px)

---

## Critical Implementation Notes

### Data Architecture: Time-Centric Model

**Core Concept**: The fundamental unit is a **time range**, not a file.

**Mental Model:**
- ❌ "I uploaded test_ride.csv"
- ✅ "I have IMU data from 2:15 PM to 3:10 PM"

**Implementation:**
- `imu_data_files` represents continuous time segments
- Primary key is time range (`start_time` → `end_time`)
- Filename preserved for debugging, but not core to data model
- UI sorted by `start_time DESC` (when data represents, not when uploaded)
- Rides query IMU data by time range, not by file association

**Why:** Enables gap/overlap detection, multi-source data fusion, natural ride association, and efficient time-range queries.

---

### Security & RLS

**Critical**: All user-scoped tables have Row Level Security enabled.

**Pattern:**
```sql
CREATE POLICY "policy_name"
  ON table_name FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
```

**Note**: Both `USING` and `WITH CHECK` required:
- `USING`: Applies to SELECT, UPDATE, DELETE
- `WITH CHECK`: Applies to INSERT, UPDATE

**Service Role Key**: Only used in Inngest background jobs for bulk operations. Never exposed to client.

---

### Upload Pipeline

**Flow:**
1. User uploads CSV via `/upload` (react-dropzone)
2. File → Supabase Storage (`uploads` bucket, RLS protected)
3. Metadata record created in `imu_data_files` (status: `uploaded`)
4. Inngest event triggered (`imu/parse`)
5. Background job:
   - Downloads CSV from storage
   - Parses with PapaParse
   - Validates columns & data
   - Bulk inserts to `imu_samples` (10k rows at a time)
   - Updates metadata (start_time, end_time, sample_count, sample_rate, status: `ready`)
6. User sees "Ready" status in `/data`

**Performance:**
- 5500 samples parsed & inserted in ~5-8 seconds
- Sample rate rounded to nearest integer (database constraint)
- Auto-downsampling for visualization (10k → 2k points)

---

### Environment Setup

**Required `.env.local` variables:**
```env
# Supabase (from dashboard → Settings → API)
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGc...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc... # For Inngest jobs only

# Inngest (local dev)
INNGEST_EVENT_KEY=test
INNGEST_SIGNING_KEY=test
```

**Production Environment Variables (Vercel):**
```env
# Supabase (same as local)
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGc...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...

# Inngest Cloud (from https://app.inngest.com)
INNGEST_EVENT_KEY=your_real_event_key_here
INNGEST_SIGNING_KEY=your_real_signing_key_here
```

**Dev Server Requirements:**
- Main terminal: `npm run dev` (Next.js)
- Second terminal: `npx inngest-cli@latest dev` (Inngest dashboard at localhost:8288)

---

### Inngest Background Jobs

**Architecture:**
- **Development**: Local Inngest dev server (persistent connection)
- **Production**: Inngest Cloud (webhook-based)

**Setup Process:**
1. Sign up at https://app.inngest.com
2. Create app: `vertex-prod`
3. Copy Event Key and Signing Key
4. Add to Vercel environment variables
5. Deploy (git push triggers auto-deployment)

**Current Functions:**
- `parse-imu-file`: CSV parsing and bulk insert to database
- Triggered by: `imu/parse` event with `{ fileId, userId }`
- Steps: Download CSV → Parse → Insert samples → Update metadata

**Monitoring:**
- **Dev**: http://localhost:8288 (Inngest dev dashboard)
- **Prod**: https://app.inngest.com (Inngest Cloud dashboard)
- Real-time execution logs, retry logic, error handling

**Pricing:**
- **Free Tier**: 100k events/month, 1k function runs/month, 7 days logs
- **Pro Tier**: $25/month for 1M events, 10k runs, 30 days logs
- **Current Usage**: ~1 event per CSV upload (well within free tier)

---

### Database Schema Notes

**User Creation Trigger**: Critical for foreign keys to work.
```sql
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
```
Without this, `public.users` never gets populated, breaking all user-scoped inserts.

**Storage Bucket**: Must be created manually with RLS policies for user-specific folders.

**Indexes**: Time-based queries optimized with:
```sql
CREATE INDEX idx_imu_files_user_time 
  ON imu_data_files (user_id, start_time, end_time);

CREATE INDEX idx_imu_samples_user_time 
  ON imu_samples (user_id, timestamp);
```

---

### Synthetic Data Generator

**Location**: `tools/generate_synthetic_imu.py`

**Basic Usage:**
```bash
python3 tools/generate_synthetic_imu.py -o test_ride.csv --sample-rate 100
```

**Advanced Usage:**
```bash
# Preset ride types
python3 tools/generate_synthetic_imu.py --preset short -o short_ride.csv      # ~14s
python3 tools/generate_synthetic_imu.py --preset medium -o medium_ride.csv   # ~60s (default)
python3 tools/generate_synthetic_imu.py --preset long -o long_ride.csv        # ~3min
python3 tools/generate_synthetic_imu.py --preset aggressive -o aggressive.csv # High speed, tight corners
python3 tools/generate_synthetic_imu.py --preset endurance -o endurance.csv  # Steady pace, gentle corners

# Custom duration and scenarios
python3 tools/generate_synthetic_imu.py --preset medium --duration 120 -o custom_ride.csv
python3 tools/generate_synthetic_imu.py --scenarios acceleration cornering braking --duration 30 -o custom.csv

# Scenario-specific parameters
python3 tools/generate_synthetic_imu.py --scenarios cornering --corner-speed 15 --corner-radius 10 --corner-direction left -o tight_corner.csv
python3 tools/generate_synthetic_imu.py --scenarios acceleration --target-speed 20 --accel-rate 4.0 -o hard_accel.csv
python3 tools/generate_synthetic_imu.py --scenarios braking --initial-speed 15 --decel-rate 5.0 -o emergency_brake.csv
```

**Output**: CSV with realistic cycling motion (acceleration, cornering, braking) at specified sample rate.

**Physics Models:**
- Stationary: Gravity only (~9.8 m/s² on Z-axis)
- Acceleration: Linear velocity increase with configurable rate
- Cornering: Centripetal forces + lean angle with configurable radius/speed
- Braking: Deceleration with configurable rate
- Noise: Realistic sensor noise (configurable level)

**Preset Configurations:**
- **Short**: Quick test (~14s) - basic functionality testing
- **Medium**: Balanced ride (~60s) - comprehensive testing (default)
- **Long**: Extended cruise (~3min) - longer training simulation
- **Aggressive**: High speeds, tight corners (~30s) - extreme scenario testing
- **Endurance**: Steady pace, gentle corners (~3.5min) - endurance/audax simulation

---

## Implementation Status

**✅ Completed:**
- Authentication (Supabase Auth, email/password)
- Database schema (10 tables, full RLS)
- Landing page with hero, features, FAQ
- Upload pipeline (CSV → Storage → Parse → Database)
- Data visualization (/data with clickable time segments)
- Interactive charts (accelerometer, gyroscope, magnetometer)
- Breadcrumb navigation
- Mobile responsive design
- Vercel Analytics integration

**🚧 In Progress:**
- None (all planned features complete for Phase 1)

**📋 Next Steps:**
- See SAVE_STATE.md for detailed roadmap

---

**End of APP.md**

