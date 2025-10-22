import { createClient } from '@supabase/supabase-js'
import { inngest } from '@/inngest/client'

export async function GET() {
  const checks = {
    supabase: false,
    inngest: false,
    storage: false,
    database: false
  }
  
  const errors: string[] = []
  
  try {
    // Check Supabase connection
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    
    const { data, error } = await supabase
      .from('imu_data_files')
      .select('count')
      .limit(1)
    
    if (error) throw error
    checks.supabase = true
    checks.database = true
    
  } catch (error) {
    errors.push(`Supabase: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
  
  try {
    // Check Inngest connection with timeout
    const inngestPromise = inngest.send({ name: 'test/health-check', data: { timestamp: Date.now() } })
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Inngest health check timeout')), 5000)
    })
    
    await Promise.race([inngestPromise, timeoutPromise])
    checks.inngest = true
  } catch (error) {
    errors.push(`Inngest: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
  
  try {
    // Check storage access
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    
    const { data, error } = await supabase.storage
      .from('uploads')
      .list('', { limit: 1 })
    
    if (error) throw error
    checks.storage = true
    
  } catch (error) {
    errors.push(`Storage: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
  
  const isHealthy = Object.values(checks).every(Boolean)
  
  return Response.json({
    status: isHealthy ? 'healthy' : 'unhealthy',
    checks,
    errors,
    timestamp: new Date().toISOString()
  })
}
