import { serve } from 'inngest/next'
import { inngest } from '@/inngest/client'
import { testFunction } from '@/inngest/functions/test-function'

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    testFunction
  ]
})

