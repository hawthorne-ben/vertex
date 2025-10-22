import { serve } from 'inngest/next'
import { inngest } from '@/inngest/client'
import { parseIMU } from '@/inngest/functions/parse-imu'
import { testFunction } from '@/inngest/functions/test-function'
import { parseIMUTest } from '@/inngest/functions/parse-imu-test'

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    parseIMU,
    parseIMUTest,
    testFunction
  ]
})

