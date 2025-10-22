import { serve } from 'inngest/next'
import { inngest } from '@/inngest/client'
import { testFunction } from '@/inngest/functions/test-function'
import { parseIMUTest } from '@/inngest/functions/parse-imu-test'

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    testFunction,
    parseIMUTest
  ]
})

