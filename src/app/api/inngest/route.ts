import { serve } from 'inngest/next'
import { inngest } from '@/inngest/client'
import { testFunction } from '@/inngest/functions/test-function'
import { parseIMU } from '@/inngest/functions/parse-imu'
import { parseIMUChunked } from '@/inngest/functions/parse-imu-chunked'
import { parseIMUStreaming } from '@/inngest/functions/parse-imu-streaming'

const functions = [testFunction, parseIMU, parseIMUChunked, parseIMUStreaming]

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions
})

