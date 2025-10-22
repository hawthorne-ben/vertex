import { NextRequest, NextResponse } from 'next/server'
import { inngest } from '@/inngest/client'

export async function POST(req: NextRequest) {
  try {
    await inngest.send({
      name: 'test-event',
      data: { message: 'Hello from test!' }
    })
    
    return NextResponse.json({ status: 'test-event-sent' })
  } catch (error) {
    console.error('Test event send error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to send test event' },
      { status: 500 }
    )
  }
}
