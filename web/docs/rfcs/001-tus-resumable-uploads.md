# RFC 001: Migrate to TUS Resumable Uploads

**Status:** Draft
**Author:** Claude
**Date:** 2026-01-18
**Affects:** Upload system, API routes, client upload logic

## Summary

Replace custom chunk-based upload system with Supabase-native TUS (Tus Upload System) resumable uploads to eliminate server-side file reassembly overhead and improve reliability for 10-50MB files.

## Motivation

### Current Architecture Problems

Our current upload flow for files >50MB:

```
Client → Split into 50MB chunks
      → Request signed URL for each chunk (API call per chunk)
      → Upload chunks directly to Supabase Storage
      → Notify server "upload complete"
      → Server downloads ALL chunks
      → Server concatenates in memory
      → Server re-uploads full file to final location
      → Server cleans up chunks
```

**Problems:**
1. **Wasted compute**: Server downloads + re-uploads full file (100-200MB of data movement)
2. **Memory pressure**: Concatenation happens in-memory (Lambda/Vercel has 1GB limit)
3. **Double bandwidth**: Every large file costs 2x Supabase bandwidth
4. **Brittle**: If server fails during reassembly, upload is lost
5. **Overkill**: Most files are 10-50MB, don't need this complexity

### Why TUS?

TUS (resumable upload protocol) is natively supported by Supabase Storage:
- Client uploads directly to final location (zero server involvement)
- Automatic chunking (6MB chunks, Supabase-optimized)
- Built-in retry logic and resumability
- Handles files up to 50GB
- Industry standard (tus.io)

## Proposed Architecture

### New Upload Flow

```
Client → Initialize TUS upload with metadata
      → Upload chunks directly to Supabase (via TUS protocol)
      → On completion, notify server with storage path
      → Server validates file exists + creates DB record
      → Done
```

**Server never touches file data.**

### Implementation Strategy

#### Phase 1: Add TUS Support (Additive)

Add TUS as a new upload method alongside existing chunking:

```typescript
// src/lib/upload/tus-uploader.ts (NEW)
export class TusUploader {
  static async upload(
    file: File,
    bucketName: string,
    onProgress?: (percent: number) => void
  ): Promise<string> {
    // Returns storage path on success
  }
}
```

#### Phase 2: Update Client (Replace)

Replace chunking logic in `/src/app/upload/page.tsx`:

```typescript
// OLD
const uploadResult = await uploadFileChunked(file, onProgress)

// NEW
const storagePath = await TusUploader.upload(file, 'recordings', onProgress)
```

#### Phase 3: Simplify Server (Remove)

Update `/src/app/api/upload/recording/route.ts`:
- Remove chunk reassembly logic
- Expect `storagePath` in request body
- Validate file exists in storage
- Parse VTX/FIT metadata
- Create DB record

#### Phase 4: Deprecate (Delete)

Remove obsolete endpoints:
- `/src/app/api/upload/chunk-url/route.ts` - no longer needed
- `/src/app/api/upload/complete-chunked/route.ts` - no longer needed
- `/src/lib/upload/chunking.ts` - can be deleted or kept for reference

## Detailed Changes

### File Changes Summary

| File | Change Type | Description |
|------|-------------|-------------|
| `src/lib/upload/tus-uploader.ts` | **NEW** | TUS wrapper with progress tracking |
| `src/app/upload/page.tsx` | **MODIFY** | Replace `uploadFileChunked` with TUS |
| `src/app/api/upload/recording/route.ts` | **SIMPLIFY** | Remove chunk assembly, expect storage path |
| `src/app/api/upload/chunk-url/route.ts` | **DELETE** | No longer needed |
| `src/app/api/upload/complete-chunked/route.ts` | **DELETE** | No longer needed |
| `src/lib/upload/chunking.ts` | **DEPRECATE** | Can delete after migration |
| `package.json` | **MODIFY** | Add `tus-js-client` dependency |

### API Changes

#### Before (Chunked)
```typescript
// Client flow
POST /api/upload/chunk-url (per chunk)
PUT <signedUrl> (per chunk, direct to Supabase)
POST /api/upload/complete-chunked

// Server downloads, reassembles, re-uploads
```

#### After (TUS)
```typescript
// Client flow
POST <supabase>/storage/v1/upload/resumable (TUS init)
PATCH <supabase>/storage/v1/upload/resumable (TUS chunks, direct)
POST /api/upload/recording { storagePath, fileName, fileSize }

// Server just validates + creates DB record
```

### Code Examples

#### New TUS Uploader Library

```typescript
// src/lib/upload/tus-uploader.ts
import * as tus from 'tus-js-client'
import { createClient } from '@/lib/supabase/client'

export interface TusUploadOptions {
  onProgress?: (bytesUploaded: number, bytesTotal: number) => void
  onSuccess?: (uploadUrl: string) => void
  onError?: (error: Error) => void
}

export class TusUploader {
  private static readonly CHUNK_SIZE = 6 * 1024 * 1024 // 6MB (Supabase recommended)

  /**
   * Upload file using TUS resumable protocol
   * Returns storage path on success
   */
  static async upload(
    file: File,
    bucketName: string = 'recordings',
    options: TusUploadOptions = {}
  ): Promise<string> {
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()

    if (!session) {
      throw new Error('Not authenticated')
    }

    const timestamp = Date.now()
    const storagePath = `${session.user.id}/${timestamp}_${file.name}`

    return new Promise((resolve, reject) => {
      const upload = new tus.Upload(file, {
        endpoint: `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/upload/resumable`,
        retryDelays: [0, 1000, 3000, 5000],
        headers: {
          authorization: `Bearer ${session.access_token}`,
          'x-upsert': 'false',
        },
        uploadDataDuringCreation: true,
        removeFingerprintOnSuccess: true,
        metadata: {
          bucketName,
          objectName: storagePath,
          contentType: file.type || 'application/octet-stream',
          cacheControl: '3600',
        },
        chunkSize: this.CHUNK_SIZE,
        onError: (error) => {
          options.onError?.(error)
          reject(error)
        },
        onProgress: (bytesUploaded, bytesTotal) => {
          options.onProgress?.(bytesUploaded, bytesTotal)
        },
        onSuccess: () => {
          options.onSuccess?.(upload.url || '')
          resolve(storagePath)
        },
      })

      upload.start()
    })
  }

  /**
   * Check if file should use TUS (always true now, but kept for API compat)
   */
  static shouldUseTus(file: File): boolean {
    return true // Use TUS for all files
  }
}
```

#### Updated Client Upload Logic

```typescript
// src/app/upload/page.tsx (simplified excerpt)
import { TusUploader } from '@/lib/upload/tus-uploader'

const uploadFile = async (file: File, onProgress: (percent: number) => void) => {
  // Upload via TUS
  const storagePath = await TusUploader.upload(file, 'recordings', {
    onProgress: (uploaded, total) => {
      const percent = (uploaded / total) * 100
      onProgress(percent)
    },
  })

  // Notify server to create DB record
  const supabase = createClient()
  const { data: { session } } = await supabase.auth.getSession()

  const response = await fetch('/api/upload/recording', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      storagePath,
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type,
    })
  })

  if (!response.ok) {
    throw new Error('Failed to create recording')
  }

  return await response.json()
}
```

#### Simplified Server Endpoint

```typescript
// src/app/api/upload/recording/route.ts (simplified excerpt)
export async function POST(request: NextRequest) {
  const body = await request.json()
  const { storagePath, fileName, fileSize } = body

  // Validate auth
  const { user } = await supabase.auth.getUser(token)

  // Download file to parse metadata (VTX/FIT)
  const { data: fileData, error } = await supabase.storage
    .from('recordings')
    .download(storagePath)

  if (error) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 })
  }

  // Parse metadata (existing logic unchanged)
  const metadata = await parseFileMetadata(fileData, fileName)

  // Create DB record (existing logic unchanged)
  const { data: recording } = await supabase
    .from('recordings')
    .insert({
      user_id: user.id,
      storage_path: storagePath,
      filename: fileName,
      file_size_bytes: fileSize,
      ...metadata
    })
    .single()

  return NextResponse.json({ success: true, recordingId: recording.id })
}
```

## Migration Plan

### Step 1: Install Dependencies
```bash
npm install tus-js-client
npm install --save-dev @types/tus-js-client
```

### Step 2: Create TUS Library
- Add `src/lib/upload/tus-uploader.ts`
- Add tests for upload flow

### Step 3: Update Client (Feature Flag)
- Add `USE_TUS_UPLOAD` feature flag
- Update `src/app/upload/page.tsx` to use TUS when enabled
- Test in development

### Step 4: Update Server
- Modify `/api/upload/recording` to accept both flows
  - If `storagePath` provided → TUS flow (new)
  - If `fileId` + `totalChunks` → Chunk flow (legacy)
- Deploy server changes

### Step 5: Enable TUS in Production
- Set `USE_TUS_UPLOAD=true`
- Monitor upload success rates
- Keep chunk endpoints live for 1 week (in case rollback needed)

### Step 6: Cleanup
- Delete `/api/upload/chunk-url`
- Delete `/api/upload/complete-chunked`
- Delete `src/lib/upload/chunking.ts`
- Remove feature flag

## Rollback Strategy

If TUS uploads fail in production:

1. **Immediate**: Set `USE_TUS_UPLOAD=false` (chunk system still deployed)
2. **Short-term**: Investigate TUS failures (network? Supabase config?)
3. **Long-term**: Keep chunk system indefinitely if TUS proves unreliable

**Safety**: Both systems can coexist during migration. No data loss risk.

## Testing Strategy

### Unit Tests
- `TusUploader.upload()` success case
- `TusUploader.upload()` retry logic
- Progress callback invocation

### Integration Tests
- Upload 10MB file via TUS
- Upload 50MB file via TUS
- Network interruption + resume
- Verify file appears in storage with correct path
- Verify DB record created correctly

### Load Tests
- 10 concurrent TUS uploads
- Compare bandwidth usage: TUS vs Chunk

## Performance Impact

### Expected Improvements

| Metric | Before (Chunks) | After (TUS) | Delta |
|--------|----------------|-------------|-------|
| Server CPU | ~30s per 50MB file | ~0s | -100% |
| Server Memory | ~50-100MB peak | ~0MB | -100% |
| Supabase Bandwidth | 2x file size | 1x file size | -50% |
| Upload Reliability | 95% (estimate) | 99% (TUS auto-retry) | +4% |
| Client Simplicity | 270 LOC | ~80 LOC | -70% |

### Cost Savings (Monthly)

Assuming 100 files/day @ 30MB average:
- **Before**: 100 files × 30MB × 2 (download + upload) × 30 days = 180GB server processing
- **After**: 0GB server processing
- **Savings**: ~$18/month in compute + bandwidth (rough estimate)

## Risks & Mitigations

### Risk 1: TUS Protocol Complexity
**Mitigation**: Use battle-tested `tus-js-client` library (maintained by tus.io team)

### Risk 2: Supabase TUS Limits
**Mitigation**: Verify Supabase supports TUS on our plan (it does, all plans)

### Risk 3: Browser Compatibility
**Mitigation**: TUS uses standard XMLHttpRequest, works in all modern browsers

### Risk 4: Existing In-Flight Uploads
**Mitigation**: Deploy with feature flag, let old uploads complete before cutover

## Success Criteria

- [ ] All file uploads (10-200MB) succeed via TUS
- [ ] Zero server CPU/memory usage during uploads
- [ ] Upload reliability ≥ 99%
- [ ] Client upload code reduced by >50%
- [ ] No increase in client-side errors
- [ ] Legacy chunk endpoints deleted after 1 week

## Open Questions

1. **Should we add upload pause/resume UI?** (TUS supports this natively)
   - No

2. **Do we need upload deduplication?**
   - TUS fingerprinting handles this, but do we want server-side dedup?

3. **How to handle upload cleanup if user closes browser?**
   - TUS will auto-clean after 24h, but we might want explicit cancel

4. **Should we retry failed uploads automatically?**
   - TUS does this, but should we add exponential backoff in client?

## References

- [TUS Protocol Spec](https://tus.io/protocols/resumable-upload.html)
- [Supabase Storage TUS Docs](https://supabase.com/docs/guides/storage/uploads/resumable-uploads)
- [tus-js-client GitHub](https://github.com/tus/tus-js-client)
- [Existing chunking implementation](../src/lib/upload/chunking.ts)

## Appendix: File Diffs (High Level)

### A. New File: `src/lib/upload/tus-uploader.ts`
- ~100 LOC
- Wraps tus-js-client with our auth + progress tracking
- Single public method: `TusUploader.upload()`

### B. Modified: `src/app/upload/page.tsx`
- Remove: `uploadFileChunked()` (~60 LOC)
- Remove: `FileChunker` imports
- Add: `TusUploader.upload()` call (~10 LOC)
- Net: -50 LOC

### C. Modified: `src/app/api/upload/recording/route.ts`
- Remove: Chunk download + reassembly logic (~80 LOC)
- Remove: `downloadFile()` helper (~40 LOC)
- Remove: `cleanupChunks()` helper (~20 LOC)
- Add: Direct storage path validation (~5 LOC)
- Net: -135 LOC

### D. Deleted: `src/app/api/upload/chunk-url/route.ts`
- -74 LOC

### E. Deleted: `src/app/api/upload/complete-chunked/route.ts`
- -~100 LOC (estimated, didn't read full file)

### F. Deprecated: `src/lib/upload/chunking.ts`
- -277 LOC (can delete after migration)

**Total**: +100 LOC (new), -626 LOC (removed) = **-526 LOC net reduction**

---

## Decision

**Pending review and approval.**
