# RFC 004: VTX Random Access Optimization

**Status:** Proposed
**Author:** Claude
**Date:** 2026-01-25
**Affects:** VTX file format, decoder, encoder, storage, API performance

## Summary

Enable O(1) or O(log n) random access to VTX IMU data by timestamp or time range, eliminating the need for full-file sequential iteration. Current architecture requires iterating all 203k+ records to extract a small time window, causing 3-4 second delays for common operations like zooming and analysis.

## Motivation

### Current Performance Problems

**Sequential-only access pattern:**
```typescript
// To get data between timestamps T1 and T2:
for (let i = 0; i < 203000; i++) {  // Must check EVERY record
  const record = decoder.readRecord(i)
  if (record.timestamp < T1) continue  // Skip
  if (record.timestamp > T2) break     // Stop
  samples.push(record)
}
// Time: O(n) = 3600ms for 203k records
```

**Common operations requiring time-based access:**
1. **Chart zoom** - Extract 5-minute window from 2-hour ride
2. **Pedaling efficiency** - Analyze specific climb segment
3. **GPS sync** - Get IMU data for specific GPS timespan
4. **Multi-ride comparison** - Extract overlapping time ranges
5. **Time-based filtering** - All API endpoints with `?start=...&end=...`

**Measured impact (203k record file):**
- Zoom to 10% of ride: Still reads 100% of file (3600ms)
- Extract 1-minute segment: Iterates 203k records (3600ms)
- Multiple zoom operations: 3600ms × N operations

### Why Sequential Access is Required Now

**Variable timestamp gaps:**
```
Record 0:   t=1000ms  (start of ride)
Record 1:   t=1030ms  (30ms gap - normal)
Record 2:   t=1060ms  (30ms gap - normal)
Record 3:   t=1090ms  (30ms gap - normal)
...
Record 500: t=16000ms (15s gap - paused recording)
Record 501: t=16030ms (30ms gap - resumed)
```

**Cannot use index-based estimation:**
- Sample rate: 30Hz (33ms expected spacing)
- Actual spacing: Varies due to pauses, clock drift, recording gaps
- Index estimation: `index = (targetTime - startTime) / avgSpacing`
- **Problem**: Misses all data when gaps exist

## Proposed Solutions

### Option 1: Index Block Structure (Recommended)

Add a timestamp index to VTX format that maps time ranges to file offsets.

#### Format Changes

**New header field:**
```
indexOffset: uint64  // Byte offset where index block starts
indexVersion: uint16 // Index format version (1)
```

**Index block structure (at end of file):**
```
[Index Header - 16 bytes]
- magic: "VTXIDX\0\0" (8 bytes)
- blockCount: uint32    (number of index entries)
- blockDuration: uint32 (milliseconds per block, e.g., 10000 = 10s)

[Index Entries - 12 bytes each]
- startTimestamp: uint64  (first record timestamp in this block)
- recordOffset: uint32    (file byte offset to first record in block)

[Footer - 8 bytes]
- indexChecksum: uint64 (XXHash of index block)
```

**Example (2-hour ride, 10-second blocks):**
```
Block 0:  t=0s-10s     → offset=1024,  records 0-300
Block 1:  t=10s-20s    → offset=12000, records 300-600
Block 2:  t=20s-30s    → offset=23000, records 600-900
...
Block 50: t=500s-510s  → offset=600000, records 15000-15300 (paused here)
Block 51: t=510s-520s  → MISSING (no data during pause)
Block 52: t=3000s-3010s → offset=605000, records 15300-15600 (resumed)
```

#### Access Algorithm

```typescript
// Find records between T1 and T2
function getRecordsByTimeRange(T1: number, T2: number): IMURecord[] {
  // 1. Binary search index for start block
  const startBlock = binarySearchIndex(T1)  // O(log n) where n = blockCount

  // 2. Binary search index for end block
  const endBlock = binarySearchIndex(T2)

  // 3. Seek to start block offset
  decoder.seek(index[startBlock].recordOffset)

  // 4. Read only records in relevant blocks
  const records = []
  for (let blockIdx = startBlock; blockIdx <= endBlock; blockIdx++) {
    const blockOffset = index[blockIdx].recordOffset
    const nextBlockOffset = index[blockIdx + 1]?.recordOffset || fileSize

    // Read records in this block
    decoder.seek(blockOffset)
    while (decoder.position < nextBlockOffset) {
      const record = decoder.readRecord()
      if (record.timestamp >= T1 && record.timestamp <= T2) {
        records.push(record)
      }
    }
  }
  return records
}

// Time complexity:
// - Index search: O(log blockCount) = O(log 720) ≈ 10 operations
// - Record reading: O(recordsInRange) instead of O(totalRecords)
// - 10% zoom: Read 20k records instead of 203k (10x faster)
```

#### Implementation Plan

**Phase 1: Format Extension**
- Add index fields to VTX v1.2 header
- Backward compatible: Old decoders ignore index, still work
- New decoders: Check for index, use if available, fallback to sequential

**Phase 2: Index Generation**
```typescript
// During encoding (VTXEncoder)
class VTXEncoder {
  private indexBlocks: IndexBlock[] = []
  private blockDuration = 10000 // 10 seconds

  addRecord(record: IMURecord) {
    // Determine which block this record belongs to
    const blockId = Math.floor(record.timestamp / this.blockDuration)

    // Create new block entry if needed
    if (!this.indexBlocks[blockId]) {
      this.indexBlocks[blockId] = {
        startTimestamp: record.timestamp,
        recordOffset: this.currentFileOffset
      }
    }

    // Write record as normal
    this.writeRecord(record)
  }

  encode(): ArrayBuffer {
    // Write header + metadata + records (as before)
    // ...

    // Write index block at end
    this.writeIndexBlock(this.indexBlocks)

    // Update header with index offset
    this.updateHeader({ indexOffset: this.indexBlockOffset })

    return buffer
  }
}
```

**Phase 3: Decoder Random Access**
```typescript
class VTXDecoder {
  private index?: TimestampIndex

  constructor(buffer: ArrayBuffer) {
    // Parse header
    this.header = this.parseHeader()

    // Load index if available
    if (this.header.indexOffset) {
      this.index = this.parseIndex(this.header.indexOffset)
    }
  }

  // New method: Random access by time range
  readRecordsByTimeRange(start: number, end: number): IMURecord[] {
    if (this.index) {
      return this.readRecordsByTimeRangeIndexed(start, end)  // O(log n + m)
    } else {
      return this.readRecordsByTimeRangeSequential(start, end)  // O(n)
    }
  }

  private readRecordsByTimeRangeIndexed(start: number, end: number): IMURecord[] {
    // Binary search index for block range
    const startBlock = this.index.findBlock(start)
    const endBlock = this.index.findBlock(end)

    // Read only relevant blocks
    const records = []
    for (let i = startBlock; i <= endBlock; i++) {
      const block = this.index.blocks[i]
      this.seek(block.recordOffset)

      // Read records until next block
      const nextOffset = this.index.blocks[i + 1]?.recordOffset || this.dataEnd
      while (this.position < nextOffset) {
        const record = this.readRecord()
        if (record.timestamp >= start && record.timestamp <= end) {
          records.push(record)
        }
      }
    }
    return records
  }
}
```

**Phase 4: Migration**
- Regenerate merged VTX files with index (background job)
- Update vtx-samples endpoint to use random access API
- Add index to newly uploaded files automatically

#### Pros
- **Fast random access**: O(log n) seek + O(m) read (m = records in range)
- **Backward compatible**: Old files/decoders still work
- **Space efficient**: ~8KB index for 2-hour ride (720 blocks × 12 bytes)
- **Handles gaps**: Index naturally represents sparse blocks
- **Incremental reads**: Can read single blocks for ultra-fast queries

#### Cons
- **File format change**: Requires VTX v1.2
- **Migration needed**: Existing merged files must be regenerated
- **Encoder complexity**: Must track offsets during write
- **Block size tradeoff**: Smaller = more granular access but larger index

---

### Option 2: Separate Timestamp Index File

Store index separately from VTX file (sidecar pattern).

**Structure:**
```
ride_data.vtx        (7.76MB - unchanged)
ride_data.vtx.idx    (8KB - timestamp index)
```

**Index format (JSON or binary):**
```json
{
  "vtx_file": "rides/abc123/merged.vtx",
  "vtx_checksum": "sha256:...",
  "block_duration_ms": 10000,
  "blocks": [
    { "start_ms": 0, "end_ms": 10000, "record_offset": 1024, "record_count": 300 },
    { "start_ms": 10000, "end_ms": 20000, "record_offset": 12000, "record_count": 300 },
    ...
  ]
}
```

**Storage in Supabase:**
```
recordings/
  rides/abc123/merged.vtx       (VTX data)
  rides/abc123/merged.vtx.idx   (Index file)
```

#### Implementation

```typescript
// Generate index file during merge
async function generateVTXIndex(vtxPath: string): Promise<string> {
  const decoder = new VTXDecoder(vtxBuffer)
  const blocks = []

  let currentBlock = null
  for (let i = 0; i < decoder.recordCount; i++) {
    const record = decoder.readRecord(i)
    const blockId = Math.floor(record.timestamp / BLOCK_DURATION)

    if (!currentBlock || currentBlock.id !== blockId) {
      if (currentBlock) blocks.push(currentBlock)
      currentBlock = {
        id: blockId,
        start_ms: blockId * BLOCK_DURATION,
        end_ms: (blockId + 1) * BLOCK_DURATION,
        record_offset: decoder.position,
        record_count: 0
      }
    }
    currentBlock.record_count++
  }

  const indexPath = `${vtxPath}.idx`
  await supabase.storage
    .from('recordings')
    .upload(indexPath, JSON.stringify({ blocks }))

  return indexPath
}

// Use index for queries
async function getRecordsByTimeRange(vtxPath: string, start: number, end: number) {
  // 1. Download index file (8KB - fast)
  const indexData = await supabase.storage
    .from('recordings')
    .download(`${vtxPath}.idx`)

  const index = JSON.parse(await indexData.text())

  // 2. Find relevant blocks
  const relevantBlocks = index.blocks.filter(b =>
    b.start_ms <= end && b.end_ms >= start
  )

  // 3. Use byte range requests to fetch only needed portions
  // (Supabase supports Range header)
  const minOffset = Math.min(...relevantBlocks.map(b => b.record_offset))
  const maxOffset = Math.max(...relevantBlocks.map(b =>
    b.record_offset + (b.record_count * RECORD_SIZE)
  ))

  // Download only the needed portion of VTX file
  const vtxData = await supabase.storage
    .from('recordings')
    .download(vtxPath, {
      headers: { 'Range': `bytes=${minOffset}-${maxOffset}` }
    })

  // 4. Parse records from partial buffer
  const decoder = new VTXDecoder(vtxData, { offset: minOffset })
  return decoder.readRecordsByTimeRange(start, end)
}
```

#### Pros
- **No format change**: VTX files remain unchanged
- **No migration**: Can generate indexes on-demand
- **Fast index updates**: Can regenerate index without touching VTX file
- **HTTP Range support**: Can download only needed portions of VTX file
- **Easy debugging**: JSON index is human-readable

#### Cons
- **Two files to manage**: Upload, download, delete must handle both
- **Index drift**: Index can become stale if VTX file changes
- **Extra storage**: Separate file for each VTX (though small)
- **Network overhead**: Two downloads (index + data) instead of one

---

### Option 3: Database Timestamp Index

Store timestamp-to-offset mapping in PostgreSQL.

**Schema:**
```sql
CREATE TABLE vtx_index_blocks (
  id BIGSERIAL PRIMARY KEY,
  recording_id UUID REFERENCES recordings(id) ON DELETE CASCADE,
  block_number INT NOT NULL,
  start_timestamp_ms BIGINT NOT NULL,
  end_timestamp_ms BIGINT NOT NULL,
  file_offset BIGINT NOT NULL,
  record_count INT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  UNIQUE(recording_id, block_number)
);

CREATE INDEX idx_vtx_blocks_recording_time
  ON vtx_index_blocks(recording_id, start_timestamp_ms, end_timestamp_ms);
```

**Usage:**
```typescript
// Find blocks overlapping time range
const blocks = await supabase
  .from('vtx_index_blocks')
  .select('file_offset, record_count')
  .eq('recording_id', rideId)
  .lte('start_timestamp_ms', endTime)
  .gte('end_timestamp_ms', startTime)
  .order('block_number')

// Download only needed portions
const minOffset = Math.min(...blocks.map(b => b.file_offset))
const maxOffset = Math.max(...blocks.map(b => b.file_offset + b.record_count * RECORD_SIZE))

const vtxData = await supabase.storage
  .from('recordings')
  .download(vtxPath, {
    headers: { 'Range': `bytes=${minOffset}-${maxOffset}` }
  })
```

#### Pros
- **Fast queries**: Postgres indexes enable fast time range lookups
- **Easy to update**: SQL updates vs file uploads
- **Queryable**: Can analyze index data (e.g., find rides with gaps)
- **Transactional**: Index updates are atomic with ride changes
- **No file management**: No need to sync index files

#### Cons
- **Database bloat**: 720 rows per 2-hour ride × many rides
- **Extra query**: Must query DB before accessing storage
- **Migration complexity**: Must populate table for all existing rides
- **Coupling**: Index tied to specific VTX file path

---

### Option 4: Fixed-Rate Padding (Not Recommended)

Pad VTX file with null records to maintain fixed sample rate.

**Approach:**
```
Record 0:   t=0ms,    data={accel_x: 5.2, ...}
Record 1:   t=33ms,   data={accel_x: 5.1, ...}
Record 2:   t=66ms,   data={accel_x: 5.3, ...}
...
Record 500: t=16500ms data=null  (padding - no sensor reading)
Record 501: t=16533ms data=null  (padding)
...
Record 600: t=19800ms data={accel_x: 4.8, ...} (resumed)
```

**Index calculation:**
```typescript
// With fixed 30Hz (33ms spacing)
const index = Math.floor((targetTimestamp - startTimestamp) / 33)
const record = decoder.readRecord(index)  // O(1) access
```

#### Pros
- **True O(1) access**: Direct index calculation
- **Simple decoder**: No index parsing needed
- **Predictable**: File size = recordCount × recordSize

#### Cons
- **Massive space waste**: 2-hour ride with 10-min pause = 18,000 null records
- **File bloat**: Can double or triple file size for rides with pauses
- **Encoding complexity**: Must detect and fill gaps
- **Lost information**: Can't distinguish "no data" from "sensor read zero"

---

## Comparison Matrix

| Feature | Option 1: Index Block | Option 2: Sidecar File | Option 3: DB Index | Option 4: Padding |
|---------|----------------------|------------------------|-------------------|-------------------|
| **Random Access** | O(log n + m) | O(log n + m) | O(log n + m) | O(1) |
| **Space Overhead** | ~8KB/ride | ~8KB/ride | 720 rows/ride | +50-200% file size |
| **Format Change** | Yes (v1.2) | No | No | Yes |
| **Migration Needed** | Regen merged files | On-demand | Populate table | Regen all files |
| **Complexity** | Medium | Low | Low | High |
| **Gap Handling** | Native | Native | Native | Synthetic nulls |
| **HTTP Range** | Manual | Built-in | Manual | Not needed |
| **Debugging** | Binary index | JSON/binary | SQL queries | N/A |

---

## Recommendation

**Option 1: Index Block Structure** is the best long-term solution:

1. **Performance**: Near-optimal random access (O(log n) seek is negligible)
2. **Efficiency**: Minimal space overhead (~0.1% file size increase)
3. **Self-contained**: Index travels with file (no external dependencies)
4. **Backward compatible**: Graceful degradation for old decoders
5. **Future-proof**: Enables advanced features (byte-range downloads, streaming)

**Implementation priority:**
- Phase 1 (Week 1): Add index to VTXEncoder, update format to v1.2
- Phase 2 (Week 2): Update VTXDecoder with random access methods
- Phase 3 (Week 3): Background job to regenerate merged files with index
- Phase 4 (Week 4): Update API endpoints to use random access

**Fallback**: If HTTP Range requests are needed before v1.2, implement Option 2 as a temporary bridge.

---

## Performance Impact (Projected)

### Before (Sequential)
```
Zoom to 10% of ride:
- Read all records: 203k × 18ms = 3600ms
- Filter: 20k matches, 183k skipped
- Total: 3600ms
```

### After (Indexed)
```
Zoom to 10% of ride:
- Binary search index: log₂(720) = 10 operations ≈ 1ms
- Seek to block: 1ms
- Read relevant records: 20k × 18ms = 360ms
- Total: 362ms (10x faster)
```

### API Response Times
| Operation | Before | After | Improvement |
|-----------|--------|-------|-------------|
| Full ride view | 3600ms | 3600ms | Same (reads all) |
| 10% zoom | 3600ms | 360ms | **10x faster** |
| 1% zoom (1-min segment) | 3600ms | 36ms | **100x faster** |
| Pedaling efficiency (full) | 3600ms | 3600ms | Same (needs all) |
| Pedaling efficiency (zoom) | 3600ms | 360ms | **10x faster** |

---

## Open Questions

1. **Block duration**: 10 seconds? 30 seconds? Configurable?
   - Smaller = more granular access, larger index
   - Larger = coarser access, smaller index
   - **Recommendation**: 10 seconds (good balance)

2. **Index in header or footer?**
   - Header: Faster to find, but requires knowing size during encode
   - Footer: Easier to append, but requires seeking to end first
   - **Recommendation**: Footer (matches common append-only pattern)

3. **Index encoding format?**
   - Binary (compact, fast)
   - JSON (debuggable, flexible)
   - **Recommendation**: Binary for production, JSON option for debug builds

4. **Handle corrupted index?**
   - Fallback to sequential read
   - Regenerate index on-the-fly
   - **Recommendation**: Checksum + fallback

---

## Next Steps

1. **Approval**: Review and approve RFC
2. **Prototype**: Implement Option 1 in `@vertex-pkg/vtx-parser@0.7.0`
3. **Test**: Benchmark against current sequential access
4. **Deploy**: Update encoder, decoder, merge pipeline
5. **Migrate**: Regenerate existing merged files (background job)

---

## References

- [VTX Format Specification](../packages/vtx-parser/README.md)
- [RFC 003: Ride Data API Optimization](./003-ride-data-api-optimization.md)
- [B-tree indexing patterns](https://en.wikipedia.org/wiki/B-tree)
- [HTTP Range Requests](https://developer.mozilla.org/en-US/docs/Web/HTTP/Range_requests)
