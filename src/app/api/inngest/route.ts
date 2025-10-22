import { serve } from 'inngest/next'
import { inngest } from '@/inngest/client'
import { testFunction } from '@/inngest/functions/test-function'
import { parseIMU } from '@/inngest/functions/parse-imu'

const functions = [testFunction, parseIMU]

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions
})

