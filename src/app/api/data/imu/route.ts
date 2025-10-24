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

    // Fetch user's IMU files
    const { data: imuFiles, error: imuError } = await supabase
      .from('imu_data_files')
      .select('*')
      .eq('user_id', user.id)
      .order('uploaded_at', { ascending: false })

    if (imuError) {
      console.error('Failed to fetch IMU files:', imuError)
      return NextResponse.json({ error: 'Failed to fetch IMU files' }, { status: 500 })
    }

    return NextResponse.json({ files: imuFiles || [] })

  } catch (error) {
    console.error('IMU files API error:', error)
    return NextResponse.json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}
