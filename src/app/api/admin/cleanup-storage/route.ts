import { NextResponse } from 'next/server'
import { inngest } from '@/inngest/client'

/**
 * Manual trigger for storage cleanup
 * Useful for testing or running cleanup on-demand
 */
export async function POST() {
  try {
    // Trigger the cleanup function
    await inngest.send({
      name: 'inngest/function.invoked',
      data: {
        function_id: 'cleanup-old-storage'
      }
    })

    return NextResponse.json({ 
      success: true, 
      message: 'Cleanup job triggered successfully' 
    })
  } catch (error) {
    console.error('Failed to trigger cleanup:', error)
    return NextResponse.json(
      { error: 'Failed to trigger cleanup job' },
      { status: 500 }
    )
  }
}

