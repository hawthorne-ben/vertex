import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Get current user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Fetch user's FIT files
    const { data: fitFiles, error: fitError } = await supabase
      .from('fit_files')
      .select('*')
      .eq('user_id', user.id)
      .order('uploaded_at', { ascending: false })

    if (fitError) {
      console.error('Failed to fetch FIT files:', fitError)
      return NextResponse.json({ error: 'Failed to fetch FIT files' }, { status: 500 })
    }

    return NextResponse.json({ files: fitFiles || [] })

  } catch (error) {
    console.error('FIT files API error:', error)
    return NextResponse.json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}
