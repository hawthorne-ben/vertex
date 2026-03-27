import { serve } from 'inngest/next'
import { inngest } from '@/inngest/client'
import { parseFitFile } from '@/inngest/functions/parse-fit'
import { cleanupOldStorage } from '@/inngest/functions/cleanup-old-storage'
import { mergeRideVTX } from '@/inngest/functions/merge-ride-vtx'
import { analyzeRideImuJob } from '@/inngest/functions/analyze-ride-imu'
import { mergeVTXRecordings } from '@/inngest/functions/merge-vtx-recordings'

export const dynamic = 'force-dynamic'

const functions = [
  parseFitFile,
  cleanupOldStorage,
  mergeRideVTX,
  analyzeRideImuJob,
  mergeVTXRecordings
]

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions
})

