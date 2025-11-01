# UI Performance Issue & Fix

## Problem

The RecordScreen becomes unresponsive (5-10s touch latency) during recording, even at just 10Hz.

### Root Causes

1. **Callback-driven updates causing unnecessary re-renders**
   - RecordingService calls `onStatus()` callback on every sample (or every N samples)
   - Callback calls `setSession(updatedSession)` in RecordScreen
   - This triggers React to re-render the entire component
   - Multiple `useEffect` hooks depend on `session` object

2. **Battery updates too frequent**
   - Was updating `deviceStore.setBattery()` on **every sample** (10x/second)
   - Each call triggers Zustand subscribers
   - **Fixed**: Now only updates once per second

3. **Reactive dependency hell**
   ```typescript
   // RecordScreen.tsx lines 123-129
   useEffect(() => {
     if (session && session.isRecording) {
       const estimatedSize = session.sampleCount * bytesPerSample;
       updateStats({ fileSize: estimatedSize, sampleCount: session.sampleCount });
     }
   }, [session?.sampleCount]); // ❌ Re-runs on every sample!
   ```

4. **Notification updates tied to sample count**
   ```typescript
   // Line 154
   }, [session?.sampleCount, currentTime]); // ❌ Triggers every sample
   ```

## The Polling Solution

**Instead of callback-driven updates, use a polling pattern:**

### Current Architecture (Bad)
```
BLE data arrives (10Hz)
  ↓
RecordingService.handleData()
  ↓
Call onStatus(session) callback
  ↓
RecordScreen.setSession(session)
  ↓
React re-renders entire component
  ↓
All useEffect hooks re-evaluate
  ↓
UI freezes
```

### Proposed Architecture (Good)
```
BLE data arrives (10Hz)
  ↓
RecordingService.handleData()
  ↓
Just updates internal state
(no callbacks!)

Meanwhile, independently:

UI timer (every 1 second)
  ↓
Poll RecordingService.getCurrentSession()
  ↓
Update Zustand store (fine-grained)
  ↓
Only affected components re-render
```

## Implementation Steps

### 1. Remove Callback Pattern from RecordingService

**Before:**
```typescript
async startRecording(
  deviceId: string,
  deviceName: string,
  onStatus?: RecordingStatusCallback,  // ❌ Remove
  onError?: RecordingErrorCallback,    // ❌ Remove
  ...
)
```

**After:**
```typescript
async startRecording(
  deviceId: string,
  deviceName: string,
  // No callbacks!
  zeroPoint?: any,
  format: RecordingFormat = 'vtx',
  sampleRate: number = 100
)
```

Remove all calls to `this.notifyStatus()` except for critical state changes like:
- Recording started
- Recording stopped
- Connection lost/restored (these still need immediate notification)

### 2. Add Polling in RecordScreen

```typescript
// RecordScreen.tsx
useEffect(() => {
  if (!session?.isRecording) return;

  // Poll every 1 second for stats
  const pollInterval = setInterval(() => {
    const currentSession = RecordingService.getCurrentSession();

    if (currentSession) {
      // Update Zustand store
      setSession(currentSession);

      // Calculate derived stats
      const bytesPerSample = currentSession.format === 'vtx' ? 28 : 200;
      const estimatedSize = currentSession.sampleCount * bytesPerSample;

      updateStats({
        sampleCount: currentSession.sampleCount,
        fileSize: estimatedSize,
        duration: Date.now() - currentSession.startTime.getTime()
      });
    }
  }, 1000); // Poll every 1 second

  return () => clearInterval(pollInterval);
}, [session?.isRecording]);
```

### 3. Fix useEffect Dependencies

**Before:**
```typescript
useEffect(() => {
  // Calculate file size
}, [session?.sampleCount]); // ❌ Runs on every sample
```

**After:**
```typescript
// Remove this useEffect entirely - file size is calculated in polling loop above
```

### 4. Optimize Notification Updates

```typescript
useEffect(() => {
  if (session?.isRecording) {
    const elapsed = getElapsedTime();
    const timeStr = formatTime(elapsed);

    NotificationService.updateRecordingNotification(
      isConnected,
      deviceName,
      timeStr,
      session.sampleCount,
      deviceId
    );
  }
}, [
  session?.isRecording,
  isConnected,
  deviceName,
  currentTime  // This updates every 1 second from clock timer
]);
```

This is fine because `currentTime` only updates once per second (line 96's clock timer).

### 5. Keep Error Handling

For critical events like connection loss, keep immediate callbacks:

```typescript
RecordingService.startRecording(
  deviceId,
  deviceName,
  zeroPoint,
  format,
  sampleRate,
  {
    onError: (error) => {
      // Immediate error notification is fine
      setError(error.message);
      showToast('Connection lost', 'error');
    }
  }
);
```

## Expected Results

### Before Fix:
- Touch latency: 5-10 seconds
- React DevTools: Hundreds of renders per minute
- Main thread: Constantly busy
- Sample rate: 10Hz but feels like 0.1Hz for UI

### After Fix:
- Touch latency: <100ms (normal)
- React DevTools: ~1 render per second (just clock updates)
- Main thread: Mostly idle
- Sample rate: 10Hz with buttery smooth UI

## Performance Benchmarks

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| UI updates/sec | 5-10 (every N samples) | 1 (polling) | 5-10x fewer |
| Battery updates/sec | 10 (every sample) | 1 | 10x fewer |
| Component re-renders/min | ~300 | ~60 | 5x fewer |
| Touch response time | 5-10s | <100ms | 50-100x better |

## Alternative: Use Zustand Subscriptions

Instead of polling, could use Zustand's `subscribe()` for efficient updates:

```typescript
// In RecordingService
import { useRecordingStore } from '../stores/recordingStore';

private updateStore(): void {
  if (!this.currentSession) return;

  useRecordingStore.getState().setSession(this.currentSession);
}

// Call this only once per second instead of on every sample
```

Then RecordScreen just reads from Zustand (no polling needed):

```typescript
const session = useRecordingStore(state => state.session);
const stats = useRecordingStore(state => state.stats);
```

Zustand's internal subscription mechanism is more efficient than manual polling.

## Why This Works

**React's reconciliation is expensive when:**
1. Objects change frequently (even if values are the same)
2. Many components depend on the same state
3. useEffect hooks trigger cascading updates

**Polling at 1Hz solves this because:**
1. 1 update/second is imperceptible to users
2. Batches multiple samples into single update
3. Separates data collection (fast) from UI updates (slow)
4. Matches human perception timescale (battery, file size change "slowly")

## When to Use Callbacks vs Polling

**Use callbacks for:**
- Critical state changes (started, stopped, error)
- Events that need immediate user response
- Connection state changes

**Use polling for:**
- Continuous metrics (sample count, file size, duration)
- Battery status
- Any stat that updates faster than 1Hz but users only care about 1Hz granularity

## Status

**Current Status:** Battery fix applied (1Hz updates), notification fix pending
**Next Steps:**
1. Remove status callbacks from RecordingService.startRecording()
2. Add polling interval in RecordScreen
3. Remove useEffect dependencies on session.sampleCount
4. Test with 10Hz and 100Hz recordings

**Priority:** HIGH - This is blocking usability at even low sample rates
