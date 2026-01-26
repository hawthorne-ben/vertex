import { serve } from 'inngest/next'
import { inngest } from '@/inngest/client'
import { parseFitFile } from '@/inngest/functions/parse-fit'
import { cleanupOldStorage } from '@/inngest/functions/cleanup-old-storage'
import { mergeRideVTX } from '@/inngest/functions/merge-ride-vtx'
import { calculatePedalingEfficiencyJob } from '@/inngest/functions/calculate-pedaling-efficiency'

export const dynamic = 'force-dynamic'

const functions = [
  parseFitFile,
  cleanupOldStorage,
  mergeRideVTX,
  calculatePedalingEfficiencyJob
]

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions
})

