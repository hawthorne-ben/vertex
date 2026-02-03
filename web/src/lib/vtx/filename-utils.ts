/**
 * Generate default filename for merged VTX files based on time range
 *
 * Format: merged_YYYY-MM-DD_HHMMSS.vtx
 *
 * @param startTime - ISO timestamp of earliest recording
 * @param endTime - ISO timestamp of latest recording
 * @returns Suggested filename
 */
export function generateMergedFilename(startTime: string, endTime: string): string {
  const start = new Date(startTime)
  const end = new Date(endTime)

  const year = start.getFullYear()
  const month = String(start.getMonth() + 1).padStart(2, '0')
  const day = String(start.getDate()).padStart(2, '0')
  const hours = String(start.getHours()).padStart(2, '0')
  const minutes = String(start.getMinutes()).padStart(2, '0')
  const seconds = String(start.getSeconds()).padStart(2, '0')

  // If same day, use time range in filename
  const sameDay = start.toDateString() === end.toDateString()

  if (sameDay) {
    const endHours = String(end.getHours()).padStart(2, '0')
    const endMinutes = String(end.getMinutes()).padStart(2, '0')
    const endSeconds = String(end.getSeconds()).padStart(2, '0')

    return `merged_${year}-${month}-${day}_${hours}${minutes}${seconds}-${endHours}${endMinutes}${endSeconds}.vtx`
  } else {
    return `merged_${year}-${month}-${day}_${hours}${minutes}${seconds}.vtx`
  }
}
