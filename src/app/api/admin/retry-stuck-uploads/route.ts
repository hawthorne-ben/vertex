import { createClient } from '@supabase/supabase-js'
import { inngest } from '@/inngest/client'

export async function POST() {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    
    // Find stuck uploads (status = 'uploaded' for >5 minutes)
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    
    const { data: stuckFiles, error } = await supabase
      .from('imu_data_files')
      .select('id, user_id, filename, created_at')
      .eq('status', 'uploaded')
      .lt('created_at', fiveMinutesAgo)
    
    if (error) throw error
    
    if (!stuckFiles || stuckFiles.length === 0) {
      return Response.json({ 
        message: 'No stuck files found',
        count: 0 
      })
    }
    
    console.log(`Found ${stuckFiles.length} stuck files, retrying...`)
    
    // Retry each stuck file
    const results = []
    for (const file of stuckFiles) {
      try {
        await inngest.send({
          name: 'imu/parse',
          data: { fileId: file.id, userId: file.user_id }
        })
        
        results.push({ 
          fileId: file.id, 
          filename: file.filename, 
          status: 'retried' 
        })
        
        console.log(`Retried file: ${file.filename} (${file.id})`)
        
      } catch (error) {
        results.push({ 
          fileId: file.id, 
          filename: file.filename, 
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error'
        })
      }
    }
    
    return Response.json({
      message: `Retried ${results.length} stuck files`,
      count: results.length,
      results
    })
    
  } catch (error) {
    console.error('Recovery script failed:', error)
    return Response.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
