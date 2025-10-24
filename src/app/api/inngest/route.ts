import { serve } from 'inngest/next'
import { inngest } from '@/inngest/client'
import { parseIMU } from '@/inngest/functions/parse-imu'
import { parseFitFile } from '@/inngest/functions/parse-fit'
import { cleanupOldStorage } from '@/inngest/functions/cleanup-old-storage'

export const dynamic = 'force-dynamic'

const functions = [parseIMU, parseFitFile, cleanupOldStorage]

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions
})

