import { inngest } from '../client'

// Test each import individually
export const importTest = inngest.createFunction(
  { 
    id: 'import-test',
    name: 'Import Test Function'
  },
  { event: 'test/import' },
  async ({ event, step }) => {
    const results = []
    
    // Test 1: Inngest client
    try {
      results.push('✅ Inngest client imported')
    } catch (error) {
      results.push(`❌ Inngest client failed: ${error}`)
    }
    
    // Test 2: IMU parser
    try {
      const { parseIMUCSV, IMUParseError } = await import('@/lib/imu/parser')
      results.push('✅ IMU parser imported')
    } catch (error) {
      results.push(`❌ IMU parser failed: ${error}`)
    }
    
    // Test 3: IMU types
    try {
      const typesModule = await import('@/lib/imu/types')
      results.push('✅ IMU types imported')
    } catch (error) {
      results.push(`❌ IMU types failed: ${error}`)
    }
    
    // Test 4: Supabase client
    try {
      const { createClient } = await import('@supabase/supabase-js')
      results.push('✅ Supabase client imported')
    } catch (error) {
      results.push(`❌ Supabase client failed: ${error}`)
    }
    
    return { results }
  }
)
