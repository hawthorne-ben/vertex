"use client"

import { DataFilesList } from '@/components/data-files-list'

interface DataTabsProps {
  /** First page, rendered on the server. Later pages are fetched. */
  imuFiles: any[]
  /** Total VTX recordings for this user, across all pages. */
  totalCount: number
}

export function DataTabs({ imuFiles, totalCount }: DataTabsProps) {
  // Paging and refresh now live in DataFilesList, which owns the fetch. This
  // used to hold a refreshData() that re-queried every recording; with the list
  // server-paged that would fight the pagination state and re-introduce the
  // fetch-everything cost this change removes.
  return (
    <div className="w-full">
      <DataFilesList files={imuFiles || []} totalCount={totalCount} />
    </div>
  )
}
