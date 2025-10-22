import { serve } from 'inngest/next'
import { inngest } from '@/inngest/client'
import { parseIMU } from '@/inngest/functions/parse-imu'
import { testFunction } from '@/inngest/functions/test-function'

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    parseIMU,
    testFunction
  ]
})

