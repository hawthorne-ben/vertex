import { Inngest } from 'inngest'

export const inngest = new Inngest({ 
  id: 'vertex',
  name: 'Vertex',
  eventKey: process.env.INNGEST_EVENT_KEY,
  signingKey: process.env.INNGEST_SIGNING_KEY,
  // Add webhook URL for production
  ...(process.env.NODE_ENV === 'production' && {
    webhookURL: process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}/api/inngest` : undefined
  })
})

