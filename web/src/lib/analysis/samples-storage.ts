import { gzipSync, gunzipSync } from 'zlib'
import type { SupabaseClient } from '@supabase/supabase-js'
import { LRUCache } from 'lru-cache'

const BUCKET = 'ride-analyses'

/**
 * Build the canonical Storage path for an analysis blob. Includes
 * algorithm_version so each (ride, analysis_type, version) combination is
 * an immutable object — recomputes write a new path, old paths become
 * identifiable as stale (garbage-collected later).
 */
export function buildSamplesPath(
  userId: string,
  rideId: string,
  analysisType: string,
  algorithmVersion: string
): string {
  return `${userId}/${rideId}/${analysisType}-${algorithmVersion}.json.gz`
}

/**
 * Gzip the samples array, upload to Storage. Returns the path + size for
 * persistence on the ride_analysis row.
 */
export async function uploadSamples(
  supabase: SupabaseClient,
  path: string,
  samples: any[]
): Promise<{ path: string; sizeBytes: number; sampleCount: number }> {
  const json = JSON.stringify(samples)
  const compressed = gzipSync(Buffer.from(json, 'utf-8'))

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, compressed, {
      contentType: 'application/json',
      cacheControl: 'public, immutable, max-age=31536000',
      upsert: true,
    })

  if (error) {
    // On upsert, Supabase JS can return a network-level error even when the
    // write lands (e.g. connection reset after the server accepted the body).
    // Verify the object exists before propagating the failure.
    const { data: existing } = await supabase.storage.from(BUCKET).list(
      path.substring(0, path.lastIndexOf('/')),
      { search: path.substring(path.lastIndexOf('/') + 1) }
    )
    if (!existing?.length) {
      throw new Error(`Failed to upload samples to ${path}: ${error.message}`)
    }
    console.warn(`uploadSamples: upload returned error but object exists, continuing. Error was: ${error.message}`)
  }

  return {
    path,
    sizeBytes: compressed.byteLength,
    sampleCount: samples.length,
  }
}

/**
 * In-process cache of decompressed sample arrays. Keyed by Storage path.
 * Path includes algorithm_version, so contents are immutable — no TTL needed.
 * The route layer re-uses this across requests so a chart hovering through
 * the same ride doesn't re-fetch + re-decompress on every poll-completion.
 */
const decompressedCache = new LRUCache<string, any[]>({
  max: 50,
  // Each analysis is typically a few MB decompressed; cap total by counting
  // approximate size from JSON length on insertion.
  maxSize: 256 * 1024 * 1024, // 256MB
  sizeCalculation: (value) => {
    // Rough estimate; avoid stringify-on-set since that's O(n).
    return value.length * 200
  },
  ttl: 1000 * 60 * 30, // 30min — analyses don't change but env can shift
})

/**
 * Download the gzipped blob for an analysis from Storage and decompress.
 * Reads through an LRU cache so repeated chart polls for the same analysis
 * hit memory after the first download.
 */
export async function downloadSamples(
  supabase: SupabaseClient,
  path: string
): Promise<any[]> {
  const cached = decompressedCache.get(path)
  if (cached) return cached

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .download(path)

  if (error || !data) {
    throw new Error(`Failed to download samples from ${path}: ${error?.message ?? 'no data'}`)
  }

  const compressed = Buffer.from(await data.arrayBuffer())
  const json = gunzipSync(compressed).toString('utf-8')
  const samples = JSON.parse(json) as any[]

  decompressedCache.set(path, samples)
  return samples
}
