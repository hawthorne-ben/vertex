import { inngest } from '../client'
import { createClient } from '@supabase/supabase-js'

/**
 * Cleanup old storage files after 30 days
 * Runs daily to remove CSV files from Supabase Storage for files that were successfully parsed 30+ days ago
 * Database records are retained for querying, only storage files are deleted
 */
export const cleanupOldStorage = inngest.createFunction(
  { 
    id: 'cleanup-old-storage',
    name: 'Cleanup Old Storage Files',
  },
  { cron: '0 2 * * *' }, // Run daily at 2 AM
  async ({ step }) => {
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    )

    // Step 1: Find files older than 30 days that are ready and still have storage_path
    const filesResult = await step.run('find-old-files', async () => {
      const thirtyDaysAgo = new Date()
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

      const { data: files, error } = await supabaseAdmin
        .from('imu_data_files')
        .select('id, filename, storage_path, chunk_count, parsed_at')
        .eq('status', 'ready')
        .not('storage_path', 'is', null)
        .lt('parsed_at', thirtyDaysAgo.toISOString())

      if (error) {
        console.error('❌ Failed to fetch old files:', error)
        throw error
      }

      console.log(`📊 Found ${files?.length || 0} files older than 30 days`)
      return files || []
    })

    if (filesResult.length === 0) {
      console.log('✅ No old files to clean up')
      return { cleaned: 0 }
    }

    // Step 2: Delete storage files
    let cleaned = 0
    let failed = 0

    for (const file of filesResult) {
      try {
        console.log(`🗑️ Cleaning up storage for file ${file.id}: ${file.filename}`)

        // Delete chunks if this was a chunked upload
        if (file.chunk_count && file.chunk_count > 1) {
          const originalFileId = file.storage_path.replace('chunks/', '')
          
          // List all chunks
          const { data: chunkList, error: listError } = await supabaseAdmin.storage
            .from('uploads')
            .list(`chunks/${originalFileId}`)

          if (listError) {
            console.error(`❌ Failed to list chunks for ${file.id}:`, listError)
            failed++
            continue
          }

          if (chunkList && chunkList.length > 0) {
            const chunkPaths = chunkList.map(chunk => `chunks/${originalFileId}/${chunk.name}`)
            
            const { error: deleteError } = await supabaseAdmin.storage
              .from('uploads')
              .remove(chunkPaths)

            if (deleteError) {
              console.error(`❌ Failed to delete chunks for ${file.id}:`, deleteError)
              failed++
              continue
            }

            console.log(`✅ Deleted ${chunkPaths.length} chunks for ${file.filename}`)
          }
        } else {
          // Delete single file
          const { error: deleteError } = await supabaseAdmin.storage
            .from('uploads')
            .remove([file.storage_path])

          if (deleteError) {
            console.error(`❌ Failed to delete storage file for ${file.id}:`, deleteError)
            failed++
            continue
          }

          console.log(`✅ Deleted storage file for ${file.filename}`)
        }

        // Update database to mark storage as cleaned
        const { error: updateError } = await supabaseAdmin
          .from('imu_data_files')
          .update({ 
            storage_path: null,
            chunk_count: null
          })
          .eq('id', file.id)

        if (updateError) {
          console.error(`⚠️ Failed to update storage_path for ${file.id}:`, updateError)
          // Non-critical, storage is deleted anyway
        }

        cleaned++

      } catch (error) {
        console.error(`❌ Error cleaning file ${file.id}:`, error)
        failed++
      }
    }

    console.log(`✅ Cleanup complete: ${cleaned} files cleaned, ${failed} failed`)
    
    return {
      cleaned,
      failed,
      total: filesResult.length
    }
  }
)

