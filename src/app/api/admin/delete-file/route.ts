import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function DELETE(request: NextRequest) {
  try {
    const { fileId } = await request.json()
    
    if (!fileId) {
      return NextResponse.json({ error: 'fileId is required' }, { status: 400 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // Step 1: Get file info before deletion
    const { data: fileData, error: fileError } = await supabase
      .from('imu_data_files')
      .select('*')
      .eq('id', fileId)
      .single()

    if (fileError || !fileData) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    // Step 2: Delete all associated samples in batches to avoid timeout
    console.log(`🗑️ Starting batch deletion of samples for file ${fileId}`)
    let deletedCount = 0
    const BATCH_SIZE = 10000 // Delete 10k samples at a time
    let hasMore = true
    
    while (hasMore) {
      // Get a batch of sample IDs to delete
      const { data: sampleBatch, error: fetchError } = await supabase
        .from('imu_samples')
        .select('id')
        .eq('imu_file_id', fileId)
        .limit(BATCH_SIZE)
      
      if (fetchError) {
        console.error('Failed to fetch samples for deletion:', fetchError)
        return NextResponse.json({ error: 'Failed to fetch samples for deletion' }, { status: 500 })
      }
      
      if (!sampleBatch || sampleBatch.length === 0) {
        hasMore = false
        break
      }
      
      // Delete this batch
      const { error: batchDeleteError } = await supabase
        .from('imu_samples')
        .delete()
        .in('id', sampleBatch.map(s => s.id))
      
      if (batchDeleteError) {
        console.error('Failed to delete sample batch:', batchDeleteError)
        return NextResponse.json({ error: 'Failed to delete sample batch' }, { status: 500 })
      }
      
      deletedCount += sampleBatch.length
      console.log(`✅ Deleted batch: ${deletedCount} samples deleted so far`)
      
      // If we got fewer samples than the batch size, we're done
      if (sampleBatch.length < BATCH_SIZE) {
        hasMore = false
      }
    }
    
    console.log(`✅ Successfully deleted ${deletedCount} samples for file ${fileId}`)

    // Step 3: Delete the file record
    const { error: fileDeleteError } = await supabase
      .from('imu_data_files')
      .delete()
      .eq('id', fileId)

    if (fileDeleteError) {
      console.error('Failed to delete file record:', fileDeleteError)
      return NextResponse.json({ error: 'Failed to delete file record' }, { status: 500 })
    }

    // Step 4: Delete from storage (if storage_path exists)
    if (fileData.storage_path) {
      const { error: storageError } = await supabase.storage
        .from('uploads')
        .remove([fileData.storage_path])
      
      if (storageError) {
        console.warn('Storage deletion failed (non-critical):', storageError)
      }
    }

    return NextResponse.json({ 
      success: true, 
      message: `File ${fileData.filename} and ${deletedCount} associated samples deleted successfully` 
    })

  } catch (error) {
    console.error('Error deleting file:', error)
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    )
  }
}
