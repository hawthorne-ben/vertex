import { inngest } from '../client'

export const parseIMUTest = inngest.createFunction(
  { 
    id: 'parse-imu-test',
    name: 'Parse IMU Test (Minimal)'
  },
  { event: 'imu/parse' },
  async ({ event, step }) => {
    console.log('🎉 Parse IMU Test function executed!', { event })
    return { success: true, message: 'Parse IMU test worked!', eventData: event.data }
  }
)
