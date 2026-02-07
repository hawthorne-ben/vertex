# RFC 009: Recordings and Ride Details Code Quality Refactor

**Status:** Draft
**Author:** Code Audit
**Created:** 2026-02-07
**Related RFCs:** 001, 003, 004, 006, 007

## Summary

This RFC proposes systematic refactoring of the recordings and ride details pages to address code bloat, separation of concerns violations, useEffect abuse, and performance bottlenecks. The audit identified several critical anti-patterns that impact maintainability, readability, and performance.

## Motivation

Current issues identified during comprehensive audit:

### Critical Issues

1. **Monolithic Components**: `data-files-list.tsx` (905 LOC) and `rides-list-client.tsx` (435 LOC) violate SRP with mixed concerns
2. **Duplicate Logic**: Time formatting, file size formatting, selection state management repeated across multiple components
3. **useEffect Abuse**: Multiple effects with complex dependencies, state updates during render, nested async operations
4. **Inline Functions**: Event handlers and transformations defined inline causing unnecessary re-renders
5. **Performance**: Polling logic runs in useEffect without proper cleanup, processing time calculations on every render
6. **Poor Abstractions**: Direct Supabase calls in presentation components, API logic mixed with UI

### Moderate Issues

1. **Type Safety**: Inline interfaces instead of centralized types, `any` types in API responses
2. **State Management**: Multiple useState calls for related state, no reducer pattern for complex state
3. **Code Duplication**: Modal patterns, batch operations, toast notifications repeated
4. **Readability**: Deep nesting, long conditional chains, inconsistent naming conventions

## Detailed Analysis

### 1. Component Size & Separation of Concerns

#### data-files-list.tsx (905 LOC)

**Current Structure:**
```typescript
// Single component handles:
- File list rendering (UI)
- Selection state management
- Polling for processing updates
- Delete/download/merge operations (API calls)
- Modal state management (3 modals)
- Processing time calculations
- Batch operations
- Toast notifications
```

**Problems:**
- Violates Single Responsibility Principle
- Difficult to test individual concerns
- High cognitive load (too many responsibilities)
- Change to one feature requires understanding entire component

**Proposed Split:**
```
components/recordings/
  RecordingsList.tsx (150 LOC) - Pure presentation
  useRecordingsSelection.ts (50 LOC) - Selection state hook
  useRecordingsPolling.ts (80 LOC) - Processing status polling
  RecordingCard.tsx (120 LOC) - Individual recording display
  RecordingsHeader.tsx (80 LOC) - Header with batch actions
  ProcessingProgress.tsx (100 LOC) - Progress indicators
```

#### rides-list-client.tsx (435 LOC)

**Similar Issues:**
- Mixed concerns (UI + state + API + modals)
- Duplicate batch operation logic
- Similar patterns as data-files-list but not shared

**Proposed Structure:**
```
components/rides/
  RidesList.tsx (100 LOC) - Presentation
  useRidesSelection.ts (40 LOC) - Share with recordings
  RideCard.tsx (80 LOC) - Individual ride display
  RidesHeader.tsx (60 LOC) - Header with actions
```

### 2. useEffect Anti-Patterns

#### Polling Logic (data-files-list.tsx:137-196)

**Current Issues:**
```typescript
// Anti-pattern: State updates inside useEffect with setState callbacks
useEffect(() => {
  const interval = setInterval(async () => {
    setFiles(currentFiles => {
      const processingFileIds = currentFiles
        .filter(f => f.status === 'uploaded' || f.status === 'parsing')
        .map(f => f.id)

      // Async call inside setState callback!
      supabase.from('imu_data_files')
        .select('*')
        .in('id', processingFileIds)
        .then(({ data: updatedFiles }) => {
          setFiles(prev => prev.map(/* ... */))
        })

      return currentFiles
    })
  }, 2000)

  return () => clearInterval(interval)
}, [files.length, files.some(f => f.status === 'uploaded' || f.status === 'parsing')])
```

**Problems:**
- State update inside setState callback
- Async operation not properly handled
- Complex dependency array (array method in deps)
- Race conditions between interval and state updates
- No error boundaries

**Proposed Solution:**
```typescript
// hooks/useRecordingsPolling.ts
export function useRecordingsPolling(files: Recording[]) {
  const [updates, setUpdates] = useState<Record<string, Recording>>({})
  const processingIds = useMemo(
    () => files.filter(isProcessing).map(f => f.id),
    [files]
  )

  useEffect(() => {
    if (processingIds.length === 0) return

    const controller = new AbortController()

    const poll = async () => {
      try {
        const updated = await fetchProcessingStatus(processingIds, controller.signal)
        setUpdates(prev => ({ ...prev, ...updated }))
      } catch (err) {
        if (!controller.signal.aborted) {
          console.error('Polling error:', err)
        }
      }
    }

    poll() // Initial fetch
    const interval = setInterval(poll, 3000)

    return () => {
      controller.abort()
      clearInterval(interval)
    }
  }, [processingIds.join(',')]) // Stable string dependency

  return useMemo(() => applyUpdates(files, updates), [files, updates])
}
```

#### Time Calculations (data-files-list.tsx:14-95)

**Current Issues:**
```typescript
// Three separate components doing similar time calculations
function ProcessingTimeDisplay({ uploadedAt }: { uploadedAt: string }) {
  const [timeElapsed, setTimeElapsed] = useState('Processing...')

  useEffect(() => {
    const updateTime = () => {
      try {
        const uploadTime = new Date(uploadedAt)
        const processingTime = new Date().getTime() - uploadTime.getTime()
        const minutes = Math.floor(processingTime / 60000)
        const seconds = Math.floor((processingTime % 60000) / 1000)
        setTimeElapsed(`Processing... (${minutes}m ${seconds}s)`)
      } catch (error) {
        setTimeElapsed('Processing...')
      }
    }

    updateTime()
    const interval = setInterval(updateTime, 1000)
    return () => clearInterval(interval)
  }, [uploadedAt])

  return <span className="text-info">{timeElapsed}</span>
}
```

**Problems:**
- Duplicate components (ProcessingTimeDisplay, ProgressTimeDisplay, ElapsedTimeDisplay)
- Each creates interval and state
- No shared logic for time formatting
- Accessibility issues (screen readers get confused by rapid updates)

**Proposed Solution:**
```typescript
// hooks/useElapsedTime.ts
export function useElapsedTime(startTime: string | null, options?: {
  format?: 'short' | 'long' | 'seconds'
  updateInterval?: number
}) {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!startTime) return

    const update = () => {
      const start = new Date(startTime).getTime()
      setElapsed(Date.now() - start)
    }

    update()
    const interval = setInterval(update, options?.updateInterval ?? 1000)
    return () => clearInterval(interval)
  }, [startTime, options?.updateInterval])

  return formatElapsedTime(elapsed, options?.format ?? 'long')
}

// Usage
const elapsed = useElapsedTime(file.processing_started_at, { format: 'short' })
return <span>{elapsed}</span>
```

### 3. Inline Functions & Performance

#### Event Handlers (data-files-list.tsx:259-270)

**Current Issue:**
```typescript
{files.map((file) => (
  <div key={file.id}>
    <button
      onClick={(e) => toggleSelection(file.id, e)} // Recreated every render
      className={/* ... */}
    >
      {/* ... */}
    </button>
  </div>
))}
```

**Problem:**
- New function created for each file on every render
- Can cause child component re-renders if memoized
- Makes React DevTools profiling harder

**Proposed Solution:**
```typescript
// components/recordings/RecordingCard.tsx
interface RecordingCardProps {
  recording: Recording
  isSelected: boolean
  onToggleSelection: (id: string, e: React.MouseEvent) => void
  onDelete: (id: string) => void
  onDownload: (id: string, e: React.MouseEvent) => void
}

export const RecordingCard = memo(function RecordingCard({
  recording,
  isSelected,
  onToggleSelection,
  onDelete,
  onDownload
}: RecordingCardProps) {
  const handleToggle = useCallback((e: React.MouseEvent) => {
    onToggleSelection(recording.id, e)
  }, [recording.id, onToggleSelection])

  const handleDelete = useCallback(() => {
    onDelete(recording.id)
  }, [recording.id, onDelete])

  const handleDownload = useCallback((e: React.MouseEvent) => {
    onDownload(recording.id, e)
  }, [recording.id, onDownload])

  return (
    <div className="recording-card">
      <SelectionCheckbox
        isSelected={isSelected}
        onToggle={handleToggle}
      />
      {/* ... */}
    </div>
  )
})
```

### 4. Duplicate Logic & Utilities

#### Identified Duplicates

**Time Formatting:**
- `formatDate` (data-files-list.tsx:542-550)
- `formatDate` (rides-list-client.tsx:41-49)
- `formatDate` (add-vtx-data-button.tsx:131-138)
- `formatDate` (rides/[id]/page.tsx:66-75)

**File Size Formatting:**
- `formatFileSize` (data-files-list.tsx:554-558)
- `formatFileSize` (add-vtx-data-button.tsx:142-146)
- `formatFileSize` (rides/[id]/page.tsx:91-95)

**Selection State:**
- Duplicate Set<string> management in both list components
- Identical `toggleSelection` logic

**Proposed Shared Utilities:**
```typescript
// lib/utils/formatting.ts
export const formatters = {
  date: (date: string, format: 'short' | 'long' = 'short') => { /* ... */ },
  fileSize: (bytes: number) => { /* ... */ },
  duration: (ms: number) => { /* ... */ },
  distance: (meters: number, unit: 'mi' | 'km' = 'mi') => { /* ... */ },
  elevation: (meters: number, unit: 'ft' | 'm' = 'ft') => { /* ... */ }
}

// hooks/useSelection.ts
export function useSelection<T extends { id: string }>(items: T[]) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const toggle = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }, [])

  const toggleAll = useCallback(() => {
    setSelectedIds(prev =>
      prev.size === items.length ? new Set() : new Set(items.map(i => i.id))
    )
  }, [items])

  const clear = useCallback(() => setSelectedIds(new Set()), [])

  const selected = useMemo(
    () => items.filter(i => selectedIds.has(i.id)),
    [items, selectedIds]
  )

  return { selectedIds, selected, toggle, toggleAll, clear }
}
```

### 5. Type Safety Issues

#### Current Problems

**Inline Interfaces:**
```typescript
// data-files-list.tsx:97-114
interface IMUDataFile {
  id: string
  user_id: string
  filename: string
  // ... 10 more fields
}

// Similar interface in other files
```

**Any Types:**
```typescript
// ride-visualizations-client.tsx:22
samples: any[] | null

// rides-list-client.tsx:24
analysis_results: any
```

**Proposed Solution:**
```typescript
// types/recordings.ts
export interface Recording {
  id: string
  user_id: string
  filename: string
  file_type: 'fit' | 'vtx'
  file_size_bytes: number
  storage_path: string
  start_time: string | null
  end_time: string | null
  sample_rate: number | null
  sample_count: number | null
  status: RecordingStatus
  error_message: string | null
  uploaded_at: string
  parsed_at: string | null
  samples_processed: number | null
  last_checkpoint_at: string | null
  processing_started_at: string | null
}

export type RecordingStatus = 'uploaded' | 'parsing' | 'ready' | 'failed'

// types/rides.ts
export interface Ride {
  id: string
  user_id: string
  name: string
  start_time: string
  end_time: string
  duration_seconds: number
  distance_meters: number | null
  elevation_gain_meters: number | null
  created_at: string
  fit_recording_id: string | null
  analysis_results: RideAnalysis | null
}

export interface RideAnalysis {
  avg_speed_mph: number
  max_speed_mph: number
  has_gps_data: boolean
  has_power: boolean
  has_heart_rate: boolean
  has_cadence: boolean
}
```

### 6. Chart Components Analysis

#### Positive Patterns Observed

The chart components (`IMUSensorChart.tsx`, `DerivedMetricsChart.tsx`, `RideChartsClient.tsx`) demonstrate **good architecture**:

✅ **Proper Hooks Usage:**
- `useIMUData` and `useDerivedMetric` properly encapsulate data fetching
- Stable dependency arrays
- Cleanup functions for polling

✅ **Memoization:**
- `chartData` computation memoized
- Expensive transformations cached

✅ **Error Handling:**
- Clear loading/error/empty states
- User-friendly error messages

✅ **Props Interface:**
- Well-defined TypeScript interfaces
- Optional zoom/highlight props for composition

**Minor Improvements:**
```typescript
// Current: chartData calculation is complex but memoized
const chartData = useMemo((): { data: uPlot.AlignedData; ... } => {
  // 100+ lines of processing
}, [samples, dataType, zoomRange])

// Proposed: Extract to pure function for testability
const chartData = useMemo(
  () => processChartData(samples, dataType, zoomRange),
  [samples, dataType, zoomRange]
)

// lib/charts/data-processing.ts
export function processChartData(
  samples: IMUSample[],
  dataType: IMUDataType,
  zoomRange: ZoomRange | null
): ChartData {
  // Testable, pure function
}
```

### 7. State Management

#### Current Issues

**Related State in Multiple useState:**
```typescript
const [deleting, setDeleting] = useState<string | null>(null)
const [downloading, setDownloading] = useState<string | null>(null)
const [batchOperating, setBatchOperating] = useState(false)
const [showDeleteModal, setShowDeleteModal] = useState(false)
const [fileToDelete, setFileToDelete] = useState<IMUDataFile | null>(null)
const [showMergeModal, setShowMergeModal] = useState(false)
const [mergeFilename, setMergeFilename] = useState('')
const [merging, setMerging] = useState(false)
```

**Problems:**
- Hard to reason about valid state combinations
- Easy to create impossible states (e.g., deleting && batchOperating)
- No single source of truth

**Proposed Solution:**
```typescript
type RecordingsAction =
  | { type: 'DELETE_START'; recordingId: string }
  | { type: 'DELETE_SUCCESS'; recordingId: string }
  | { type: 'DELETE_ERROR'; error: string }
  | { type: 'BATCH_DELETE_START'; recordingIds: string[] }
  | { type: 'BATCH_DELETE_SUCCESS' }
  | { type: 'DOWNLOAD_START'; recordingId: string }
  | { type: 'DOWNLOAD_SUCCESS'; recordingId: string }
  | { type: 'MODAL_OPEN'; modal: 'delete' | 'merge'; data?: any }
  | { type: 'MODAL_CLOSE' }

interface RecordingsState {
  operation: {
    type: 'idle' | 'deleting' | 'downloading' | 'batch' | 'merging'
    target?: string
    progress?: number
  }
  modal: {
    type: null | 'delete' | 'merge'
    data?: any
  }
  error: string | null
}

function recordingsReducer(
  state: RecordingsState,
  action: RecordingsAction
): RecordingsState {
  // Single place to manage state transitions
}

// Usage
const [state, dispatch] = useReducer(recordingsReducer, initialState)
```

### 8. API Integration

#### Current Issues

**Direct Supabase in Components:**
```typescript
// data-files-list.tsx:148
const supabase = createClient()

// data-files-list.tsx:324
const supabase = createClient()
const { data: { session } } = await supabase.auth.getSession()

// data-files-list.tsx:414
const supabase = createClient()
const { data } = await supabase
  .from('recordings')
  .select('id')
  .eq('filename', result.filename)
```

**Problems:**
- Business logic in presentation layer
- Hard to test
- Duplicate auth/error handling
- No request deduplication

**Proposed Solution:**
```typescript
// lib/api/recordings.ts
export const recordingsApi = {
  async getProcessingStatus(ids: string[]): Promise<Record<string, Recording>> {
    const client = createClient()
    const { data, error } = await client
      .from('recordings')
      .select('*')
      .in('id', ids)

    if (error) throw new RecordingsApiError('Failed to fetch status', error)
    return Object.fromEntries(data.map(r => [r.id, r]))
  },

  async delete(id: string): Promise<void> {
    const response = await fetch(`/api/recordings/${id}`, {
      method: 'DELETE'
    })
    if (!response.ok) {
      const { error } = await response.json()
      throw new RecordingsApiError('Delete failed', error)
    }
  },

  async batchDelete(ids: string[]): Promise<void> {
    // Implementation
  },

  async download(id: string): Promise<Blob> {
    // Implementation with retry logic
  }
}

// Usage in components
const { mutate: deleteRecording } = useMutation({
  mutationFn: recordingsApi.delete,
  onSuccess: () => {
    queryClient.invalidateQueries(['recordings'])
  }
})
```

### 9. Performance Bottlenecks

#### Identified Issues

**1. Processing Time Calculations:**
```typescript
// data-files-list.tsx:797-835
// Complex calculation runs on every render inside JSX
{(() => {
  const startTime = new Date(file.processing_started_at).getTime()
  const now = Date.now()
  const elapsedSeconds = (now - startTime) / 1000
  const samplesPerSecond = file.samples_processed / elapsedSeconds
  // ... more calculations
})()}
```

**2. Map Re-renders:**
```typescript
// No memoization of filtered/transformed data
{files.map((file) => (/* ... */))}
```

**3. Large Data Sets:**
- No virtualization for long lists (>100 items)
- All items rendered at once

**Proposed Solutions:**
```typescript
// 1. Extract calculations to useMemo
const processingStats = useMemo(() => {
  return files.map(file => {
    if (!file.processing_started_at) return null
    return calculateProcessingStats(file)
  })
}, [files])

// 2. Virtualize long lists
import { useVirtualizer } from '@tanstack/react-virtual'

function RecordingsList({ recordings }: { recordings: Recording[] }) {
  const parentRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: recordings.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 120, // Estimated row height
    overscan: 5
  })

  return (
    <div ref={parentRef} style={{ height: '600px', overflow: 'auto' }}>
      <div style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map(virtualRow => (
          <RecordingCard
            key={recordings[virtualRow.index].id}
            recording={recordings[virtualRow.index]}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${virtualRow.start}px)`
            }}
          />
        ))}
      </div>
    </div>
  )
}
```

### 10. Accessibility Issues

**Identified Problems:**

1. **Rapid Time Updates:**
   - Screen readers announce every second update
   - No `aria-live="polite"` or `aria-atomic`

2. **Selection Checkboxes:**
   - No keyboard navigation support
   - No focus indicators
   - No ARIA labels

3. **Modals:**
   - No focus trap
   - No escape key handling (partially implemented)
   - No return focus on close

**Proposed Improvements:**
```typescript
// components/recordings/ProcessingProgress.tsx
<div
  role="status"
  aria-live="polite"
  aria-atomic="true"
  aria-label={`Processing ${filename}`}
>
  <span className="sr-only">
    {samples_processed} of {sample_count} samples processed
  </span>
  <ProgressBar value={percentage} />
</div>

// components/ui/SelectionCheckbox.tsx
<button
  role="checkbox"
  aria-checked={isSelected}
  aria-label={`Select ${itemName}`}
  onKeyDown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onToggle()
    }
  }}
>
  {isSelected && <CheckIcon />}
</button>
```

## Proposed Refactor Plan

### Phase 1: Foundation

**Priority: High | Risk: Low**

1. **Shared Types & Utilities:**
   - Create `types/recordings.ts` and `types/rides.ts`
   - Implement shared formatters in `lib/utils/formatting.ts`
   - Create `hooks/useSelection.ts`
   - Create `hooks/useElapsedTime.ts`

2. **API Layer:**
   - Create `lib/api/recordings.ts`
   - Create `lib/api/rides.ts`
   - Add error classes and handling

### Phase 2: Component Extraction

**Priority: High | Risk: Medium**

1. **Recordings Components:**
   - Extract `RecordingCard.tsx`
   - Extract `ProcessingProgress.tsx`
   - Extract `RecordingsHeader.tsx`
   - Create `useRecordingsPolling.ts`

2. **Rides Components:**
   - Extract `RideCard.tsx`
   - Extract `RidesHeader.tsx`

3. **Shared UI Components:**
   - Create `SelectionCheckbox.tsx`
   - Create `BatchActionsBar.tsx`

### Phase 3: Refactor List Components

**Priority: High | Risk: High**

1. **Refactor data-files-list.tsx:**
   - Reduce to < 200 LOC
   - Use extracted components
   - Implement useReducer for state
   - Add proper memoization

2. **Refactor rides-list-client.tsx:**
   - Similar to above
   - Share patterns with recordings

### Phase 4: Chart Improvements

**Priority: Medium | Risk: Low**

1. **Extract Data Processing:**
   - Create pure functions in `lib/charts/`
   - Improve performance

2. **Improve Type Safety:**
   - Remove `any` types
   - Add strict API response types

### Phase 5: Performance & Accessibility

**Priority: Medium | Risk: Low**

1. **Performance Audit:**
   - Run React DevTools profiler
   - Optimize re-renders
   - Add bundle analysis

2. **Accessibility Improvements:**
   - Add ARIA labels
   - Implement focus management
   - Screen reader compatibility

## Manual Testing Strategy

After each phase, manually verify the following:

### Phase 1 - Foundation
- Formatting utilities work correctly in console
- Types compile without errors

### Phase 2 - Component Extraction
- Recording cards render correctly
- Selection checkboxes work
- Processing progress displays accurately

### Phase 3 - List Refactor
- All existing features work (delete, download, batch operations)
- Polling updates status correctly
- No regressions in UI/UX

### Phase 4 - Chart Improvements
- Charts render correctly
- Data transformations are accurate
- Zoom and interactions work

### Phase 5 - Performance & Accessibility
- Page loads faster
- No visual regressions
- Keyboard navigation works

## Migration Path

### Backward Compatibility

All refactors maintain backward compatibility with existing API contracts. Changes are internal to components.

### Rollout Strategy

1. **Feature flag** for new components
2. **A/B test** with subset of users
3. **Gradual rollout** based on metrics
4. **Rollback plan** if issues detected

### Metrics to Monitor

- **Performance:**
  - Time to Interactive (TTI)
  - Largest Contentful Paint (LCP)
  - First Input Delay (FID)

- **Reliability:**
  - Error rate
  - API timeout rate
  - Polling failure rate

- **User Experience:**
  - Task completion rate
  - Time to complete operations
  - User feedback

## Success Criteria

### Code Quality

- [ ] No components > 300 LOC
- [ ] TypeScript strict mode enabled
- [ ] No `any` types in component props
- [ ] All hooks follow Rules of Hooks
- [ ] Shared utilities extracted

### Performance

- [ ] Page load feels faster
- [ ] No visual stuttering
- [ ] Smooth scrolling on large lists

### User Experience

- [ ] Better keyboard navigation
- [ ] No regressions in existing functionality
- [ ] Cleaner, more readable UI

## Risks & Mitigations

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Breaking existing features | High | Medium | Comprehensive integration tests, gradual rollout |
| Performance regression | Medium | Low | Before/after benchmarks, profiling |
| Team velocity slowdown | Medium | Medium | Incremental refactors, pair programming |
| Increased bundle size | Low | Medium | Code splitting, tree shaking analysis |
| Learning curve for new patterns | Medium | High | Documentation, training sessions, code reviews |

## Open Questions

1. Should we introduce React Query for server state management? (Would eliminate manual polling)
2. Should we migrate to Zustand for complex client state? (Alternative to useReducer)
3. Should we use Radix UI primitives for modals/dialogs? (Better accessibility out of box)
4. Timeline for deprecating old components vs feature flag duration?

## References

- [React: Rules of Hooks](https://react.dev/reference/rules/rules-of-hooks)
- [Kent C. Dodds: Application State Management](https://kentcdodds.com/blog/application-state-management-with-react)
- [TanStack Query Documentation](https://tanstack.com/query/latest)
- [WCAG 2.1 Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)
- Prior RFCs: 001 (Upload), 003 (API Optimization), 007 (Chart Zoom)

## Appendix A: LLM Readability Considerations

### Current Issues for LLM Context

1. **Large Monolithic Files:**
   - 900+ LOC files exceed typical context windows
   - Hard for LLM to reason about entire component
   - Code navigation difficult in chat interfaces

2. **Nested Logic:**
   - Deep callback nesting reduces comprehension
   - Inline arrow functions break logical flow
   - Conditional rendering spans 50+ lines

3. **Implicit Dependencies:**
   - Side effects spread across multiple useEffect
   - Unclear data flow between hooks
   - Hard to trace state changes

### Proposed Improvements

1. **Smaller, Focused Files:**
   - Each file < 200 LOC
   - Single responsibility
   - Clear exports and imports

2. **Explicit Flow:**
   - Named functions instead of inline arrows
   - Early returns for error cases
   - Flat component structure

3. **Clear Interfaces:**
   - Well-documented props
   - Type exports at file top
   - JSDoc for complex functions

Example improvement:

```typescript
// Before: Hard for LLM to understand
const handleDelete = async () => {
  if (!fileToDelete || deleting) return
  setDeleting(fileToDelete.id)
  setShowDeleteModal(false)
  try {
    const response = await fetch(`/api/recordings/${fileToDelete.id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' }
    })
    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(errorData.error || 'Delete failed')
    }
    setFiles(prev => prev.filter(f => f.id !== fileToDelete.id))
    if (onDataChange) onDataChange()
    addToast({ type: 'success', title: 'File deleted', message: `${fileToDelete.filename} has been successfully deleted.` })
  } catch (err) {
    console.error('Delete error:', err)
    addToast({ type: 'error', title: 'Delete failed', message: `Failed to delete file: ${err instanceof Error ? err.message : 'Unknown error'}` })
  } finally {
    setDeleting(null)
    setFileToDelete(null)
  }
}

// After: Clear structure for LLM
async function handleDelete(recording: Recording): Promise<void> {
  try {
    await recordingsApi.delete(recording.id)
    onRecordingDeleted(recording)
    showSuccessToast(`Deleted ${recording.filename}`)
  } catch (error) {
    showErrorToast('Delete failed', error)
  }
}
```

## Appendix B: Component Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                         Pages                                │
├─────────────────────────────────────────────────────────────┤
│  /recordings/page.tsx          /rides/page.tsx              │
│         │                              │                     │
│         ├─ RecordingsListContainer    ├─ RidesListContainer │
│         │   (Server Component)        │   (Server Component)│
└─────────┴──────────────────────────────┴─────────────────────┘
                 │                              │
                 │ Initial Data                 │ Initial Data
                 ▼                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   Client Containers                          │
├─────────────────────────────────────────────────────────────┤
│  RecordingsList                 RidesList                   │
│  ├─ useRecordingsData           ├─ useRidesData             │
│  ├─ useRecordingsPolling        ├─ useSelection             │
│  ├─ useSelection                └─ useOperations            │
│  └─ useOperations                                            │
└─────────────────────────────────────────────────────────────┘
                 │                              │
                 │ Props                        │ Props
                 ▼                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   Presentational Components                  │
├─────────────────────────────────────────────────────────────┤
│  RecordingsHeader              RidesHeader                  │
│  RecordingCard                 RideCard                     │
│  ProcessingProgress            RideMetrics                  │
│  SelectionCheckbox             SelectionCheckbox            │
│  BatchActionsBar               BatchActionsBar              │
└─────────────────────────────────────────────────────────────┘
                 │                              │
                 │ Shared Utilities             │ Shared Utilities
                 ▼                              ▼
┌─────────────────────────────────────────────────────────────┐
│                       Shared Layer                           │
├─────────────────────────────────────────────────────────────┤
│  hooks/                       lib/api/                      │
│  ├─ useSelection              ├─ recordings.ts              │
│  ├─ useElapsedTime            └─ rides.ts                   │
│  └─ useOperations                                            │
│                               lib/utils/                     │
│  types/                       └─ formatting.ts              │
│  ├─ recordings.ts                                            │
│  └─ rides.ts                                                 │
└─────────────────────────────────────────────────────────────┘
```

---

**Status:** Ready for team review and prioritization
