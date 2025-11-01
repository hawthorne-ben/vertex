import { NextResponse } from 'next/server'
import { inngest } from '@/inngest/client'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/**
 * Manual trigger for storage cleanup
 * Requires authentication - admin-only operation
 */
export async function POST() {
  try {
    // Authenticate user
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized - Authentication required' },
        { status: 401 }
      )
    }

    // TODO: Add admin role check here when admin roles are implemented
    // For now, any authenticated user can trigger cleanup
    // In production, add: if (user.role !== 'admin') { return 403 }

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

