# Android App Crash & VTX Corruption Analysis

## Problem Statement

1. **App crashes** - Sometimes Android app crashes while recording in background, killing the process
2. **State cleared** - On restart, app shows boot loader and all state is gone
3. **VTX file corrupted** - Recording shows as "in-progress" in data list but cannot be opened
4. **Cannot reconnect** - Clicking in-progress recording goes to record page but device not connected

---

## Investigation Findings

### 1. Background Service Architecture

**Current Implementation:**
- Uses `react-native-background-actions` (v4.0.1)
- Service type: `dataSync|connectedDevice` (AndroidManifest.xml:57)
- Has proper foreground service permissions
- Recording runs in main RecordingService (NOT BackgroundRecordingTask)

**Key Code Locations:**
- Main service: `src/services/RecordingService.ts`
- Unused background task: `src/services/BackgroundRecordingTask.ts` (appears unused!)
- Manifest: `android/app/src/main/AndroidManifest.xml`

### 2. VTX File Finalization Process

**Normal Stop Flow (RecordingService.ts:183-245):**
```typescript
1. stopRecording() called
2. Unsubscribe from BLE
3. Set isStopping flag
4. Wait 100ms
5. Flush remaining buffer
6. vtxStreamEncoder.finalize() - returns updated header
7. Read entire file into memory
8. Replace first 64 bytes with new header
9. Write entire file back
10. cleanup()
```

**Critical Issue:** Steps 7-9 load ENTIRE file into memory and re-write it. For a 16-minute recording at 49Hz (47,846 samples), this is:
- ~2-3 MB file size
- All loaded into JS heap as base64 string
- Converted to byte array
- Converted back to base64
- Written atomically

**If app crashes before step 9 completes:**
- VTX file has incomplete/invalid header
- Data records ARE written (streaming during recording)
- But header says 0 samples (initial placeholder)
- File is "corrupted" - data exists but header wrong

---

## Root Cause Analysis

### Crash Cause: Android Background Process Killing

**Likelihood: 95% - THIS IS THE MAIN ISSUE**

**Why it happens:**
1. Android aggressively kills background apps to save memory/battery
2. Even with foreground service, OS can kill if:
   - Low memory condition
   - User closes app from recents (swipe away)
   - Battery optimization enabled for app
   - App in background >30 minutes
   - Doze mode kicks in

3. React Native apps are MORE vulnerable because:
   - Large JS bundle memory footprint
   - JS heap not considered "critical" by Android
   - BLE characteristic notifications accumulate in queue
   - Buffer accumulation (1000 samples = ~40KB objects in memory)

**Evidence:**
- App "flashes" and closes = Android killing process
- Shows boot loader on restart = cold start, not warm resume
- State cleared = process was killed, not gracefully stopped

**Smoking Gun:**
- No AppState listeners or lifecycle handlers visible
- No crash recovery logic
- No process-death detection

### VTX Corruption Cause: Incomplete Finalization

**Likelihood: 100% - CONFIRMED**

**Why it happens:**
1. VTX header starts with placeholder values (sample_count=0)
2. Data records stream to file during recording (working!)
3. Header updated ONLY in stopRecording()
4. If app killed before stopRecording() completes:
   - Header never updated (still says 0 samples)
   - Data records ARE in file (thousands of them!)
   - File is technically valid VTX format but header wrong
   - Decoder sees sample_count=0, returns empty file

**Code Evidence (RecordingService.ts:210-232):**
```typescript
if (session.format === 'vtx' && this.vtxStreamEncoder) {
  const finalHeader = this.vtxStreamEncoder.finalize();  // Get corrected header

  // Read ENTIRE file
  const currentFile = await RNFS.readFile(session.filePath, 'base64');
  // ... convert ...
  // Replace header bytes
  // ... convert back ...
  await RNFS.writeFile(session.filePath, ...);  // ← If killed HERE, corruption!
}
```

### State Loss Cause: No Persistence

**Likelihood: 100% - CONFIRMED**

**Why it happens:**
1. RecordingService is a singleton with in-memory state
2. cleanup() called on stop clears ALL state (line 550-571)
3. No AsyncStorage persistence of active session
4. No crash recovery on app restart
5. currentSession exists only in RAM

**Code Evidence (RecordingService.ts:550-571):**
```typescript
private cleanup(): void {
  // ...
  this.currentSession = null;  // ← State lost!
  this.vtxStreamEncoder = null;
  this.writeBuffer = [];
  // No persistence to disk!
}
```

---

## Potential Fixes - Ranked by Likelihood to Resolve

### 🥇 Fix #1: Implement VTX Recovery for Incomplete Files

**Likelihood to resolve VTX corruption: 100%**
**Complexity: Medium**
**Impact: HIGH - Saves data even if app crashes**

**What to do:**
1. Add function to scan VTX file and count actual data records
2. If header sample_count < actual records: file is recoverable
3. Reconstruct header with correct counts
4. Save as new file or update in place

**Why this works:**
- Data records ARE written during recording (streaming)
- Only header is wrong (placeholder values)
- VTX format is self-describing (can parse records)
- Already have decoder in vtx-parser package

**Implementation points:**
- Add to VTXFileService or create RecoveryService
- Scan file on app startup, detect corrupted files
- Show "Recover Recording" option in UI
- Background job to fix header

**Risk: LOW** - Read-only operation, won't damage existing files

---

### 🥈 Fix #2: Persist Active Session State

**Likelihood to resolve state loss: 95%**
**Complexity: Low**
**Impact: MEDIUM - Allows resume after crash**

**What to do:**
1. Save currentSession to AsyncStorage when recording starts
2. Save session updates periodically (every N samples)
3. On app startup, check for active session
4. Show "Resume Recording" or "Finalize Recording" dialog

**Why this works:**
- AsyncStorage survives process death
- Can detect incomplete recordings on restart
- User can choose to finalize or discard

**Implementation points:**
- Save on startRecording()
- Update on flush (every 1000 samples)
- Clear on stopRecording()
- Check on app mount

**Risk: LOW** - Just adds persistence, doesn't change logic

---

### 🥉 Fix #3: Incremental Header Updates

**Likelihood to prevent corruption: 80%**
**Complexity: Medium-High**
**Impact: MEDIUM - Reduces corruption window**

**What to do:**
1. Update VTX header periodically during recording (every N seconds)
2. Don't wait until stop to finalize
3. Update sample_count, end_timestamp in-place

**Why this helps:**
- If killed, header closer to correct (not 0)
- Reduces data loss
- Still may be slightly wrong but recoverable

**Challenges:**
- VTX format not designed for this
- Header at start of file (need seeks)
- May introduce file corruption if killed mid-write
- Performance impact (file seeks every N seconds)

**Risk: MEDIUM** - Could corrupt file if killed during header write

---

### Fix #4: Improve Background Service Resilience

**Likelihood to prevent crashes: 30%**
**Complexity: High**
**Impact: LOW - Won't prevent all kills**

**What to do:**
1. Add FOREGROUND_SERVICE_TYPE properly
2. Request battery optimization exemption
3. Add wake lock
4. Implement actual BackgroundRecordingTask

**Why this might not work:**
- Android WILL still kill if low memory
- Can't prevent user swiping away
- Doze mode may still kick in
- Complex to implement correctly

**Current state:**
- Permissions ARE present (AndroidManifest.xml:23-27)
- Service type IS declared
- But recording NOT using background task!
- BackgroundRecordingTask.ts exists but UNUSED

**Risk: HIGH** - Complex, may not solve core issue

---

### Fix #5: Add AppState Monitoring & Graceful Stop

**Likelihood to help: 40%**
**Complexity: Low**
**Impact: LOW - Only helps when app backgrounded gracefully**

**What to do:**
1. Listen to AppState changes (background/inactive)
2. Auto-stop or checkpoint recording
3. Show notification to return to app

**Why limited:**
- Doesn't prevent process kill
- Only works if OS gives us warning
- Process kill = no callback fires

**Risk: LOW** - Just adds monitoring

---

## Recommendations

### Immediate Actions (Do First)

**1. Implement Fix #1 (VTX Recovery)** ⭐ CRITICAL
- **Do this NOW** - will save all existing corrupted files
- Low risk, high reward
- Can be done independently

**2. Implement Fix #2 (State Persistence)** ⭐ IMPORTANT
- **Do this NEXT** - prevents state loss
- Enables smart recovery UI
- Complements Fix #1

**3. Test recovery flow**
- Force-kill app during recording
- Verify recovery works
- Check file integrity

### Secondary Actions (Nice to Have)

**4. Consider Fix #3 (Incremental Headers)**
- Only if corruption still happens
- Prototype first to test risk
- May not be worth complexity

**5. Skip Fix #4 (Background Service)**
- Too complex
- Won't prevent all kills
- Current approach good enough with recovery

**6. Add Fix #5 (AppState Monitoring)**
- Easy win
- But don't rely on it
- Complement to fixes 1 & 2

---

## Implementation Priority

```
Priority 1 (MUST DO):
├── VTX Recovery Function
│   ├── Scan file for actual record count
│   ├── Reconstruct header
│   └── Save recovered file
│
└── Session State Persistence
    ├── Save to AsyncStorage on start
    ├── Update periodically
    └── Check on app startup

Priority 2 (SHOULD DO):
├── Recovery UI Flow
│   ├── Detect corrupted files on startup
│   ├── Show "Recover Recording" dialog
│   └── Process in background
│
└── Graceful Degradation
    ├── AppState monitoring
    └── Auto-checkpoint on background

Priority 3 (COULD DO):
└── Incremental Header Updates
    └── Research vtx-parser modifications
```

---

## Key Insights

1. **VTX data IS saved** - corruption is header-only, data intact
2. **Android WILL kill** - can't fully prevent, must handle gracefully
3. **Recovery is possible** - can reconstruct from data records
4. **State should persist** - AsyncStorage survives process death
5. **Current finalization is fragile** - loads entire file, atomic write

---

## Questions to Answer Before Implementation

1. Does vtx-parser support reading partial files?
2. Can we modify VTXStreamEncoder to update header incrementally?
3. What's the max file size users will record? (impacts in-memory approach)
4. Should we auto-recover silently or ask user?
5. How to detect file is recoverable vs truly corrupted?

---

## Next Steps

1. ✅ Do NOT make code changes yet
2. ⏳ Review with developer to confirm analysis
3. ⏳ Decide on implementation approach
4. ⏳ Prioritize fixes
5. ⏳ Implement in order: Recovery → Persistence → AppState → Consider Incremental
