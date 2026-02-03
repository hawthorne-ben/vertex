# RFC 006: Batch Recording Operations & VTX Merge UI

**Status:** Draft
**Author:** Claude
**Date:** 2026-02-02
**Affects:** Recordings page UI, API routes, VTX merge functionality

## Summary

Add batch selection UI and operations (download, delete, merge) to the recordings page, with special support for ad-hoc VTX file merging that creates a new merged file and removes originals.

## Motivation

### Current Limitations

1. **Individual Actions Only**: Users can only download/delete one recording at a time
2. **No Ad-hoc Merging**: VTX files only merge automatically when associated with a ride
3. **Inefficient Workflows**: Users wanting to clean up or organize multiple recordings must perform repetitive actions
4. **Missing Merge Use Case**: Users may want to merge VTX files into a single segment before associating with a ride (or without a ride at all)

### User Stories

1. **Batch Delete**: "I have 10 failed/duplicate recordings I want to remove at once"
2. **Batch Download**: "I want to download multiple recordings for offline analysis"
3. **Ad-hoc Merge**: "I have 3 VTX files from a session that I want to merge into one clean recording before creating a ride"
4. **Selective Operations**: "I want to select specific recordings based on visual scanning, not filters"

## Proposed Solution

### UI Changes

#### Selection Interface

- Add checkbox overlays on each list item that appear **on hover**
- Remove current inline download/delete buttons from list items
- Add dynamic action buttons in page header that appear when ≥1 items selected
- Selection state persists across polling updates but clears on manual refresh

```
┌─────────────────────────────────────────────────┐
│ Recordings                                      │
│                                                 │
│ [✓] Download Selected (3)  [✓] Delete Selected │
│ [✓] Merge Selected (VTX only, 2-10 files)      │
└─────────────────────────────────────────────────┘

┌─[ ]──────────────────────────────────────────┐ ← Checkbox visible on hover
│ ✓  Oct 24, 7:02 PM → 7:06 PM                │
│    1,234 samples • 500 Hz • 4m 12s           │
│    Source: ride_001.vtx (2.3 MB)             │
└──────────────────────────────────────────────┘
```

#### Action Buttons (Header)

Buttons appear dynamically based on selection:

- **Download Selected (N)**: Always available when N ≥ 1
- **Delete Selected (N)**: Always available when N ≥ 1
- **Merge Selected (VTX)**: Only when:
  - All selected files are VTX type
  - All selected files have `status === 'ready'`
  - 2 ≤ N ≤ 10 files selected (configurable limit)

#### Merge Modal

When user clicks "Merge Selected", show themed modal:

```
┌──────────────────────────────────────────┐
│  Merge VTX Recordings                    │
│                                          │
│  You are merging 3 recordings:          │
│  • Oct 24, 7:02 PM → 7:06 PM (2.3 MB)   │
│  • Oct 24, 7:07 PM → 7:15 PM (4.1 MB)   │
│  • Oct 24, 7:16 PM → 7:22 PM (3.2 MB)   │
│                                          │
│  New recording name:                     │
│  ┌────────────────────────────────────┐ │
│  │ merged_2026-10-24.vtx              │ │
│  └────────────────────────────────────┘ │
│                                          │
│  ⚠️  Original files will be deleted     │
│                                          │
│  [Cancel]              [Merge Files]    │
└──────────────────────────────────────────┘
```

- Default name: `merged_YYYY-MM-DD.vtx` (using earliest start time)
- User can edit name (validation: non-empty, .vtx extension auto-appended)
- Shows warning that originals will be deleted
- Show file list with metadata for confirmation

### API Implementation

#### New Endpoint: `POST /api/recordings/merge`

```typescript
// Request
{
  recordingIds: string[]        // 2-10 UUIDs
  newFilename: string          // User-provided name
}

// Response (202 Accepted)
{
  jobId: string                // Inngest job ID for polling
  message: string
  estimatedCompletionSeconds: number
}

// Polling: GET /api/recordings/merge/status/[jobId]
// Returns: { status: 'pending' | 'processing' | 'completed' | 'failed', ... }
```

**Validation:**
- Verify all recordings belong to authenticated user (RLS)
- Verify all recordings are VTX type
- Verify all recordings have `status === 'ready'`
- Verify 2 ≤ count ≤ 10
- Verify filename is valid (sanitize, add .vtx extension)
- Verify files are merge-compatible (sample rate, format match)

**Operation:**
- Trigger Inngest job (async processing)
- Return job ID for status polling
- Job downloads files, validates compatibility, merges, uploads, deletes originals

#### New Endpoint: `POST /api/recordings/batch-delete`

```typescript
// Request
{
  recordingIds: string[]       // 1-100 UUIDs
}

// Response
{
  deleted: number
  failed: Array<{ id: string, error: string }>
}
```

**Validation:**
- Verify all recordings belong to authenticated user (RLS)
- Limit to 100 recordings per request

**Operation:**
- Delete from storage bucket (parallel)
- Delete from database (batch DELETE)
- Return count of successful deletes + any errors

#### New Endpoint: `POST /api/recordings/batch-download`

```typescript
// Request
{
  recordingIds: string[]       // 1-20 UUIDs
}

// Response (streaming ZIP)
Content-Type: application/zip
Content-Disposition: attachment; filename="recordings-YYYY-MM-DD.zip"

<ZIP file stream>
```

**Validation:**
- Verify all recordings belong to authenticated user (RLS)
- Limit to 20 recordings per request (size considerations)
- Verify all files have `status === 'ready'`

**Operation:**
- Create ZIP archive on-the-fly (use streaming to avoid memory limits)
- Include original filenames in ZIP
- Stream response

### Inngest Job: Merge VTX Recordings

Create new job similar to `merge-ride-vtx.ts` but for standalone merges:

```typescript
// src/inngest/functions/merge-vtx-recordings.ts

export const mergeVTXRecordings = inngest.createFunction(
  { id: 'merge-vtx-recordings', retries: 3 },
  { event: 'recordings/vtx.merge-requested' },
  async ({ event, step }) => {
    const { recordingIds, newFilename, userId } = event.data

    // Step 1: Fetch and validate recordings
    // Step 2: Download, merge, upload (atomic step)
    // Step 3: Create new recording DB entry
    // Step 4: Delete original recordings (DB + storage)

    return { success: true, newRecordingId: '...' }
  }
)
```

**Differences from ride merge:**
- No ride association
- User provides filename
- Originals are deleted after successful merge
- New recording created with `uploaded_at = NOW()`

## Implementation Phases

### Phase 1: Selection UI (Frontend)

**Tasks:**
- Add selection state to `data-files-list.tsx`
- Add checkbox overlays (hidden by default, visible on hover)
- Add header action buttons (conditional rendering)
- Add merge modal component
- Update click handlers to prevent navigation when selecting

**Estimated effort:** 4-6 hours

### Phase 2: Batch Delete & Download (Backend + Frontend)

**Tasks:**
- Create `POST /api/recordings/batch-delete` endpoint
- Create `POST /api/recordings/batch-download` endpoint (with ZIP streaming)
- Wire up frontend "Delete Selected" button
- Wire up frontend "Download Selected" button
- Add confirmation modals with file lists
- Add loading states and error handling

**Estimated effort:** 6-8 hours

### Phase 3: VTX Merge (Backend + Frontend)

**Tasks:**
- Create `POST /api/recordings/merge` endpoint
- Create Inngest job `merge-vtx-recordings.ts`
- Register job in Inngest server
- Create job status polling endpoint
- Wire up frontend "Merge Selected" button
- Add merge modal with name input
- Add polling UI during merge
- Handle success/failure states

**Estimated effort:** 8-10 hours

## Decisions

### Technical

1. **Merge Validation**: Pre-flight validation in API endpoint with abstracted validation logic (no duplication)
2. **Merge Limits**: 10 files maximum
3. **Merge Job Priority**: Same as ride-triggered merges
4. **Original File Deletion**: Immediate deletion after successful merge
5. **Merge Conflicts**: Allow merging files associated with rides (recordings should be editable/deletable even after ride association)
6. **ZIP Streaming Library**: Use `archiver`

### Product

7. **Selection Persistence**: Clear on navigation
8. **Select All**: No select all checkbox
9. **Merge Naming**: Auto-generate based on date range of input files, with edit option
10. **Batch Size Limits**: Delete: 100 max, Download: 20 max, Merge: 10 max
11. **Download Format**: Always ZIP
12. **Merge Metadata**: Merge `device_info`, drop `session_metadata`
13. **UI Feedback During Merge**: Polling with status messages
14. **Post-Merge**: Auto-refresh page to show new merged file

## Dependencies

- **@vertex-pkg/vtx-parser**: Already has `VTXMerger.merge()` and `validateMergeCompatibility()`
- **Inngest**: Already configured for background jobs
- **ZIP Library**: Need to install `archiver` or `jszip`
- **Modal Component**: Use existing `ConfirmationModal`, may need to extend for text input

## Risks & Mitigations

1. **Risk**: User merges files with incompatible sample rates → Job fails
   - **Mitigation**: Pre-flight validation in API endpoint, clear error messaging

2. **Risk**: Merge job fails midway, originals already deleted
   - **Mitigation**: Delete originals ONLY after new file is successfully uploaded and DB record created

3. **Risk**: Large file downloads timeout or consume too much memory
   - **Mitigation**: Streaming ZIP creation, enforce size limits, use chunked transfer encoding

4. **Risk**: User selects 100 files for download → server overwhelmed
   - **Mitigation**: Enforce strict limits (20 max), add rate limiting to batch endpoints

5. **Risk**: Selection state becomes stale during polling updates
   - **Mitigation**: Preserve selection by ID across re-renders, clear selection on manual refresh

## Alternative Approaches Considered

### Alternative 1: Server-Side Multi-Select with Filters

Instead of checkboxes, use filter UI to bulk select by criteria (date range, status, size).

**Pros:** Faster for large-scale operations, less manual clicking
**Cons:** Less precise, doesn't match user mental model of "visually select what I want"
**Decision:** Rejected - checkboxes provide better control and match existing patterns

### Alternative 2: Drag-and-Drop Merge

Allow users to drag VTX files onto each other to trigger merge.

**Pros:** Intuitive, discoverable
**Cons:** Harder on mobile, requires more complex state management
**Decision:** Deferred - could add in Phase 4 as enhancement

### Alternative 3: Command Palette for Batch Actions

Add keyboard shortcuts and command palette for power users (Cmd+K → "Delete selected").

**Pros:** Very fast for power users
**Cons:** Low discoverability, requires tutorial
**Decision:** Deferred - could add in future as advanced feature

## Similar Patterns in Codebase

- **VTX Merge for Rides**: `/src/inngest/functions/merge-ride-vtx.ts` (similar merge logic)
- **Batch Recording Parsing**: Already uses Inngest for async processing
- **File Download**: `/src/components/data-files-list.tsx` line 250 (individual download)
- **Delete with Confirmation**: `/src/components/data-files-list.tsx` line 190 (individual delete)
