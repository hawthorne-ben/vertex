import { serve } from 'inngest/next'
import { inngest } from '@/inngest/client'
import { parseIMU } from '@/inngest/functions/parse-imu'
import { cleanupOldStorage } from '@/inngest/functions/cleanup-old-storage'

export const dynamic = 'force-dynamic'

const functions = [parseIMU, cleanupOldStorage]

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions
})

