import { inngest } from '../client'

export const testFunction = inngest.createFunction(
  { 
    id: 'test-function',
    name: 'Test Function'
  },
  { event: 'test-event' },
  async ({ event, step }) => {
    console.log('🎉 Test function executed!', { event })
    return { success: true, message: 'Test function worked!' }
  }
)
