# RFC 001: Recording Reliability Improvements

## Problem

Long recordings (15+ min) are corrupted or lost when the user switches to another app (e.g. Spotify) and back. Android's Low Memory Killer terminates the process because the app has no real foreground service running — only a screen wake lock. When the process dies mid-recording, the VTX header still says 0 samples, making the file appear empty. Recovery exists but requires manual intervention on next launch, and up to 10 seconds of buffered data is lost regardless.

## Root Cause

The recording runs entirely in the React Native JS thread with no foreground service binding. `WakeLockService` calls `KeepAwake.activate()`, which prevents screen-off CPU sleep but does nothing to protect the process from being killed by the OS. The manifest declares `RNBackgroundActionsTask` and the dependency `react-native-background-actions` is installed, but neither is actually used during recording.

---

## Improvement 1: Start a Real Foreground Service

### Status: Ready to implement

### Problem

Without a foreground service, Android classifies the app as a regular background process. After ~10 minutes of memory pressure, the OOM adjuster kills it. This is the primary cause of recording loss.

### Proposal

Start a foreground service via `@notifee/react-native` when recording begins, using the existing recording notification as the foreground service notification. Stop it when recording ends.

### Justification

Foreground services receive the second-highest process priority (after the visible Activity). Apps like Strava, Wahoo, and Garmin Connect all use foreground services for recording. This is the standard Android pattern for long-running sensor recording. Without it, the OS is behaving exactly as designed — killing a background process it considers idle.

### What changes

- **App startup (index.js or App.tsx):** Register the foreground service task via `notifee.registerForegroundService(task)`. This must be called before any notification with `asForegroundService: true` is displayed. The task is a callback that returns a long-lived promise — it keeps the service alive for its duration. Since RecordingService already manages the recording lifecycle, the task just needs to wait until recording stops (e.g. resolve on a signal from `stopRecording()`).
- **`NotificationService.showRecordingNotification()`:** Add `asForegroundService: true` and `foregroundServiceTypes` (`connectedDevice`, `dataSync`, `location`) to the notification's android options. This promotes the existing recording notification to a foreground service notification. Updates via `notifee.displayNotification()` with the same ID update the service notification without restarting the service.
- **`RecordingService.stopRecording()`:** Call `notifee.stopForegroundService()` after cleanup. This stops the service and removes the notification.
- **`WakeLockService` / `KeepAwake` can be removed** — foreground services already hold a partial wake lock.
- **`BackgroundRecordingTask.ts` is deleted** (unused duplicate of RecordingService logic).
- **Manifest:** Update the service declaration from `RNBackgroundActionsTask` to notifee's service class (`app.notifee.core.ForegroundService`). Keep the existing `foregroundServiceType="dataSync|connectedDevice|location"`.

### Design decisions

**Notification ownership: Use notifee's `asForegroundService`, remove `react-native-background-actions`.**

`@notifee/react-native` (already used by `NotificationService`) supports `asForegroundService` on Android notifications. This lets the existing recording notification double as the foreground service binding — one notification, one library, no duplication. `react-native-background-actions` would require its own separate notification, meaning either two notifications during recording (noisy) or abandoning the notifee notification you already have (losing the rich formatting and update control). Since notifee can do both jobs, there's no reason to keep the second library.

**Foreground service task registration.** `notifee.registerForegroundService(task)` must be called at app startup (before any recording starts), not inside `startRecording()`. The task function receives a `notification` parameter and must return a promise that stays pending for the lifetime of the service. A simple pattern: create a promise whose `resolve` is stored on the RecordingService instance, and call it from `stopRecording()`. The task itself does no work — RecordingService handles everything via BLE callbacks and timers as it does today.

**Delete `BackgroundRecordingTask.ts`.** It duplicates buffer management, BLE subscription, and VTX encoding from `RecordingService`. The foreground service just needs to keep the process alive — the actual recording logic stays in `RecordingService` as-is. In React Native, the foreground service and the main app share the same JS thread, so there's no architectural benefit to moving logic into a background task handler.

---

## Improvement 2: Periodic Header Updates (Eliminate Corruption Window)

### Status: Ready to implement

### Problem

The VTX header is written once at `initialize()` with `recordCount: 0`, then only patched during `stopRecording()`. The patching process reads the entire file into memory as base64, replaces the first 64 bytes, and writes the whole file back. If the process is killed at any point during recording (or during this finalization), the header remains stale and the file appears empty/corrupted.

### Proposal

After every buffer flush, call `vtxStreamEncoder.finalize()` to get the current header bytes, then write them to the file at offset 0 using `RNFS.write(filePath, headerBase64, 0, 'base64')`. This is a 64-byte write at a fixed offset — no need to read the file first.

### Justification

This eliminates the corruption window entirely. If the process dies at any point during recording, the header reflects the state as of the last flush. The file is always valid and parseable. The recovery mechanism (`recoverCorruptedVTXFile`) becomes a fallback for edge cases rather than the primary defense.

The I/O cost is trivial: 64 bytes written every 2-3 seconds (at the proposed reduced buffer size). Modern flash storage handles this without measurable impact.

### What changes

- `RecordingService.flushBuffer()` calls `finalize()` and writes the 64-byte header at offset 0 using `RNFS.write(filePath, headerBase64, 0, 'base64')` after each successful data flush. Skipped if `recordCount === 0` (before the first sample is written), since `finalize()` throws in that case.
- **`RecordingService.stopRecording()` no longer reads or rewrites the file.** The current implementation (lines 297-318) reads the entire file into memory as base64, decodes it to a byte array, patches 64 bytes, re-encodes to base64, and writes the whole file back. For a 15-minute recording this is ~3.6MB binary → ~4.8MB base64 → byte array → base64 again, totaling ~17MB of transient allocations. This is why saving takes several seconds and risks both OOM kills and corruption if interrupted. With periodic header updates, `stopRecording()` becomes: flush remaining buffer (which patches the header as part of the flush) → stop foreground service → cleanup. The entire read-rewrite block is deleted.

### Design decisions

**`finalize()` is safe to call repeatedly.** Verified in `packages/vtx-parser/src/stream-encoder.ts` — `finalize()` only reads internal state (`recordCount`, `startTimestamp`, `lastTimestamp`, `gpsRecordCount`, `gpsDataOffset`) and creates a fresh 64-byte header buffer from it. It does not mutate encoder state, close any streams, or call the write callback. The only guard is that it throws if `recordCount === 0`, so the periodic update must skip the call until at least one record has been flushed.

---

## Improvement 3: Reduce Buffer Size

### Status: Ready to implement

### Problem

The write buffer holds 1000 samples (10 seconds at 100Hz). If the process is killed, everything in the buffer is lost. Combined with periodic header updates, the buffer size directly determines the maximum data loss window.

### Proposal

Reduce `BUFFER_SIZE` from 1000 to 250 (2.5 seconds at 100Hz).

### Justification

The buffer exists to batch I/O for efficiency, but the marginal benefit of 1000 vs 250 samples per write is negligible. Each flush appends ~10KB (250 records * ~40 bytes/record) to the file — well within a single filesystem write. The event loop yield pattern (writing in 100-sample chunks with `setImmediate`) already handles larger batches gracefully, so reducing the trigger threshold just means flushing more often.

The tradeoff is slightly more frequent I/O (every 2.5s vs every 10s), which has no measurable impact on battery or performance for sequential appends to a single file.

### What changes

- `RecordingService.BUFFER_SIZE` changes from 1000 to 250
- Session persistence frequency (`sampleCount % 1000`) stays at 1000 — it's just AsyncStorage metadata, not sample data, and doesn't need to be tighter

---

## Improvement 4: Fix Concurrent Flush Starvation

### Status: Ready to implement

### Problem

`flushBuffer()` (RecordingService.ts:564-567) returns immediately if `isWriting` is true. When a slow I/O operation blocks the flush, incoming data accumulates in `writeBuffer` without bound. If the buffer keeps growing because flushes are being skipped, the app's memory footprint increases, making it a more attractive target for the OOM killer.

### Proposal

Replace the boolean `isWriting` guard with a simple queue: if a flush is requested while one is in progress, set a `pendingFlush` flag. When the current flush completes, check the flag and flush again if set.

### Justification

This ensures data always drains to disk in bounded time. The current pattern can theoretically grow the buffer to arbitrary size under sustained I/O delays (e.g. if the filesystem is busy with Spotify caching). In practice this is unlikely to cause issues at the reduced 250-sample buffer size, but the fix is trivial and eliminates the class of bug entirely.

### What changes

- Replace `isWriting: boolean` with `flushPending: boolean`
- At the end of `flushBuffer()`, if `flushPending` is true, reset it and flush again
- When a flush is requested and one is in progress, set `flushPending = true` instead of returning

---

## Improvement 5: Auto-Resume After Process Restart

### Status: Ready to implement

### Problem

When the OS kills and restarts the process (which happens when the user navigates back to the app), `App.tsx` detects the interrupted session and shows a recovery dialog. But this requires manual user action, and the recording is effectively over — there's no option to resume.

### Proposal

After detecting an interrupted session (file is valid thanks to periodic header updates), automatically reconnect to the BLE device and start a new recording into a new VTX file. The server already merges multiple VTX files per ride, so the gap is handled transparently. The user sees a toast ("Recording resumed after interruption") rather than a blocking dialog.

### Justification

The whole point of the reliability improvements is that the user shouldn't have to babysit their phone. If the OS kills the process but the user returns within a reasonable window (BLE device still in range, ride still in progress), the app should pick up where it left off. Starting a new file avoids any complexity around resuming a VTX stream mid-file and leverages the existing server-side merge infrastructure.

### What changes

- On detecting an interrupted session with a valid file (periodic header updates mean it almost always will be), attempt BLE reconnection automatically
- If reconnection succeeds within 10 seconds, start a new recording for the same device (new VTX file). Show a toast: "Recording resumed — previous segment saved"
- If reconnection fails (device out of range, powered off), show a non-blocking toast: "Previous recording saved (X samples)" and navigate to the record screen in idle state. No dialog needed since the file is already valid.
- The existing recovery dialog and `recoverCorruptedVTXFile` flow is kept as a fallback for files that were interrupted before periodic header updates were implemented (i.e. existing corrupted files on disk from before this update)

### Design decisions

**Start a new file, not append.** Appending to the same file would require VTXStreamEncoder to support "resume" (re-initialize with existing record count, timestamps, and write offset). This is unnecessary complexity — the server already merges multiple VTX files per ride via the ride-level vtx-samples endpoint. Two files with a gap is the correct representation of what happened.

**10-second reconnection timeout.** BLE reconnection to a device in range typically completes in 1-3 seconds. 10 seconds gives enough margin for the BLE stack to reinitialize after a process restart without making the user wait too long. If the device is genuinely out of range (user walked away from bike), 10 seconds is short enough to fail fast.

---

## Implementation Order

1. **Foreground service** — Largest impact, prevents the kill in most cases
2. **Periodic header updates** — Eliminates corruption when kills do happen
3. **Reduce buffer size** — Minimizes data loss window
4. **Flush queue** — Prevents memory growth under I/O pressure
5. **Auto-resume** — Best UX but most complex, and less necessary once kills are rare

Items 1-4 can be implemented independently in any order. Item 5 depends on items 2-3 being in place (so the interrupted file is always valid).

---

## Cleanup

The following can be removed as part of this work:

- `BackgroundRecordingTask.ts` — unused duplicate of RecordingService logic
- `WakeLockService.ts` — replaced by foreground service wake lock
- `react-native-background-actions` dependency — replaced by notifee foreground service
- `CRASH_AND_CORRUPTION_ANALYSIS.md`, `BACKGROUND_SURVIVAL_STRATEGIES.md`, `TESTING_CRASH_RECOVERY.md` — superseded by this RFC and the implementation
