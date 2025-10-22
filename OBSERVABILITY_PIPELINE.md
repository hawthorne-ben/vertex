# Vertex Observability Pipeline

**Goal**: Comprehensive monitoring and debugging for async data processing pipeline

---

## Current Problem

**Issue**: Data stuck in "uploaded" status, no visibility into:
- Inngest function execution status
- Database operation failures  
- Storage access issues
- Environment variable problems
- Function timeout/deadlock issues

**Root Cause**: Lack of centralized observability across multiple services (Vercel, Inngest, Supabase)

---

## Proposed Observability Architecture

### 1. **Centralized Logging & Monitoring**

#### **Primary Platform: Sentry**
- **Why**: Excellent Next.js integration, real-time error tracking, performance monitoring
- **Cost**: Free tier (5k errors/month), Pro $26/month
- **Setup**: 
  ```bash
  npm install @sentry/nextjs
  ```

#### **Secondary Platform: LogRocket** 
- **Why**: Session replay, user behavior, frontend error tracking
- **Cost**: Free tier (1k sessions/month), Pro $99/month
- **Use Case**: Debug user-facing issues, session replay for upload failures

### 2. **Structured Logging Strategy**

#### **Log Levels & Context**
```typescript
// Upload Pipeline Logging
logger.info('upload_started', {
  fileId: 'uuid',
  userId: 'uuid', 
  fileName: 'test.csv',
  fileSize: 1024,
  timestamp: '2024-01-01T00:00:00Z'
});

logger.info('inngest_event_sent', {
  eventName: 'imu/parse',
  fileId: 'uuid',
  userId: 'uuid',
  timestamp: '2024-01-01T00:00:00Z'
});

logger.error('parse_function_failed', {
  fileId: 'uuid',
  error: 'Database connection timeout',
  stack: '...',
  timestamp: '2024-01-01T00:00:00Z'
});
```

#### **Correlation IDs**
- Generate unique `correlationId` for each upload
- Pass through entire pipeline: Frontend → API → Inngest → Database
- Enable tracing across all services

### 3. **Health Checks & Status Endpoints**

#### **API Health Endpoints**
```typescript
// /api/health/upload-pipeline
export async function GET() {
  const checks = {
    supabase: await checkSupabaseConnection(),
    inngest: await checkInngestConnection(), 
    storage: await checkStorageAccess(),
    database: await checkDatabaseHealth()
  };
  
  return Response.json({
    status: Object.values(checks).every(Boolean) ? 'healthy' : 'unhealthy',
    checks,
    timestamp: new Date().toISOString()
  });
}
```

#### **Database Health Queries**
```sql
-- Check for stuck uploads
SELECT COUNT(*) as stuck_uploads 
FROM imu_data_files 
WHERE status = 'uploaded' 
AND created_at < NOW() - INTERVAL '5 minutes';

-- Check recent errors
SELECT COUNT(*) as recent_errors
FROM imu_data_files 
WHERE status = 'error' 
AND created_at > NOW() - INTERVAL '1 hour';
```

### 4. **Real-time Monitoring Dashboard**

#### **Custom Dashboard Components**
```typescript
// Admin dashboard for monitoring
export function PipelineStatusDashboard() {
  const { data: health } = useSWR('/api/health/upload-pipeline');
  const { data: stats } = useSWR('/api/admin/pipeline-stats');
  
  return (
    <div className="grid grid-cols-4 gap-4">
      <MetricCard 
        title="Uploads (24h)" 
        value={stats?.uploads24h} 
        trend={stats?.uploadsTrend}
      />
      <MetricCard 
        title="Processing Time" 
        value={`${stats?.avgProcessingTime}s`}
        status={stats?.avgProcessingTime < 30 ? 'good' : 'warning'}
      />
      <MetricCard 
        title="Error Rate" 
        value={`${stats?.errorRate}%`}
        status={stats?.errorRate < 5 ? 'good' : 'critical'}
      />
      <MetricCard 
        title="Stuck Files" 
        value={stats?.stuckFiles}
        status={stats?.stuckFiles === 0 ? 'good' : 'warning'}
      />
    </div>
  );
}
```

### 5. **Alerting Strategy**

#### **Critical Alerts (Immediate)**
- Upload pipeline down (>5 min)
- Error rate >10% (1 hour)
- Stuck files >5 (15 min)
- Database connection failures

#### **Warning Alerts (15 min delay)**
- Processing time >60s average
- Error rate >5% (1 hour)  
- Storage quota >80%
- Function timeout rate >5%

#### **Alert Channels**
- **Slack**: Real-time notifications to #vertex-alerts
- **Email**: Daily digest to team
- **PagerDuty**: Critical alerts only (if needed)

### 6. **Performance Monitoring**

#### **Key Metrics to Track**
```typescript
interface PipelineMetrics {
  // Upload metrics
  uploadSuccessRate: number;        // % successful uploads
  avgUploadTime: number;           // seconds from upload to ready
  
  // Processing metrics  
  avgParseTime: number;            // seconds for CSV parsing
  avgInsertTime: number;           // seconds for database insert
  samplesPerSecond: number;        // processing throughput
  
  // Error metrics
  errorRate: number;               // % failed uploads
  errorTypes: Record<string, number>; // error categorization
  
  // Resource metrics
  storageUsage: number;            // bytes used
  databaseConnections: number;    // active connections
  functionExecutions: number;     // Inngest function runs/hour
}
```

#### **Custom Metrics Collection**
```typescript
// In Inngest function
export const parseIMU = inngest.createFunction(
  { id: 'parse-imu-file', name: 'Parse IMU CSV File' },
  { event: 'imu/parse' },
  async ({ event, step }) => {
    const startTime = Date.now();
    
    try {
      // ... processing logic ...
      
      // Record success metrics
      await recordMetric('parse_success', {
        fileId: event.data.fileId,
        processingTime: Date.now() - startTime,
        sampleCount: parsedData.sampleCount
      });
      
    } catch (error) {
      // Record error metrics
      await recordMetric('parse_error', {
        fileId: event.data.fileId,
        error: error.message,
        processingTime: Date.now() - startTime
      });
      throw error;
    }
  }
);
```

### 7. **Implementation Phases**

#### **Phase 1: Basic Monitoring (Week 1)**
- [ ] Sentry integration
- [ ] Structured logging in upload pipeline
- [ ] Health check endpoints
- [ ] Basic error alerting

#### **Phase 2: Enhanced Observability (Week 2)**
- [ ] Custom admin dashboard
- [ ] Performance metrics collection
- [ ] Correlation ID tracking
- [ ] Slack alerting

#### **Phase 3: Advanced Analytics (Week 3)**
- [ ] LogRocket integration
- [ ] Historical trend analysis
- [ ] Predictive alerting
- [ ] Automated recovery scripts

### 8. **Cost Estimation**

#### **Monthly Costs**
- **Sentry**: $26/month (Pro tier)
- **LogRocket**: $99/month (Pro tier) 
- **Slack**: $0 (existing workspace)
- **Additional Vercel**: ~$5/month (function execution)
- **Total**: ~$130/month

#### **ROI Justification**
- **Time Saved**: 2-3 hours/week debugging = $200-300/month
- **User Experience**: Reduced failed uploads = higher retention
- **Development Velocity**: Faster issue resolution = faster feature delivery

### 9. **Quick Wins (Immediate)**

#### **This Week**
1. **Add Sentry to Next.js**
   ```bash
   npm install @sentry/nextjs
   ```

2. **Enhanced Error Logging**
   ```typescript
   // In upload API route
   try {
     await inngest.send({ name: 'imu/parse', data: { fileId, userId } });
   } catch (error) {
     console.error('Inngest send failed:', { fileId, userId, error });
     // Send to Sentry
     Sentry.captureException(error, { 
       tags: { component: 'upload-api' },
       extra: { fileId, userId }
     });
   }
   ```

3. **Database Status Query**
   ```sql
   -- Add to admin dashboard
   SELECT 
     status,
     COUNT(*) as count,
     AVG(EXTRACT(EPOCH FROM (updated_at - created_at))) as avg_processing_time
   FROM imu_data_files 
   WHERE created_at > NOW() - INTERVAL '24 hours'
   GROUP BY status;
   ```

4. **Manual Recovery Script**
   ```typescript
   // /api/admin/retry-stuck-uploads
   export async function POST() {
     const stuckFiles = await supabase
       .from('imu_data_files')
       .select('id, user_id')
       .eq('status', 'uploaded')
       .lt('created_at', new Date(Date.now() - 5 * 60 * 1000)); // 5 min ago
     
     for (const file of stuckFiles.data || []) {
       await inngest.send({
         name: 'imu/parse',
         data: { fileId: file.id, userId: file.user_id }
       });
     }
   }
   ```

---

## Next Steps

1. **Immediate**: Check Inngest Cloud dashboard for failed function runs
2. **This Week**: Implement Sentry + basic health checks
3. **Next Week**: Build admin dashboard + performance metrics
4. **Month 1**: Full observability pipeline with alerting

This observability pipeline will give you complete visibility into your async processing pipeline and enable rapid debugging of production issues.
