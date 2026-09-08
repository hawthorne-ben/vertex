'use client'

import { useEffect, useMemo, useState } from 'react'

export const DEFAULT_PAGE_SIZE = 10
export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const

/**
 * Client-side pagination over an in-memory list.
 *
 * Both list pages already fetch every row server-side and filter/sort on the
 * client, so paginating here keeps selection, search and sort working unchanged.
 * If a list ever grows past the point where fetching it all is the problem,
 * this is the seam to move server-side.
 *
 * `storageKey` persists the page size (not the page number) in localStorage, so
 * a chosen size sticks across visits while navigation always starts at page 1.
 */
export function usePagination<T>(items: T[], storageKey: string) {
  const [pageSize, setPageSizeState] = useState<number>(DEFAULT_PAGE_SIZE)
  const [page, setPage] = useState(1)

  // Read the persisted size after mount. Doing this in useState's initializer
  // would diverge from the server-rendered HTML and hydrate-mismatch.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(storageKey)
      if (!stored) return
      const parsed = parseInt(stored, 10)
      if (PAGE_SIZE_OPTIONS.includes(parsed as (typeof PAGE_SIZE_OPTIONS)[number])) {
        setPageSizeState(parsed)
      }
    } catch {
      // Private mode or blocked storage — the default is fine.
    }
  }, [storageKey])

  const setPageSize = (size: number) => {
    setPageSizeState(size)
    setPage(1) // keep the user near what they were looking at, not past the end
    try {
      window.localStorage.setItem(storageKey, String(size))
    } catch {
      // Non-fatal: the size still applies for this session.
    }
  }

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize))

  // Clamp when the list shrinks under us (a delete, or a filter narrowing the
  // set) so the user is never stranded on an empty page past the end.
  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

  const safePage = Math.min(page, totalPages)

  const pageItems = useMemo(() => {
    const start = (safePage - 1) * pageSize
    return items.slice(start, start + pageSize)
  }, [items, safePage, pageSize])

  return {
    pageItems,
    page: safePage,
    setPage,
    pageSize,
    setPageSize,
    totalPages,
    totalItems: items.length,
    // Inclusive 1-based range of what is on screen, for "Showing X–Y of Z".
    rangeStart: items.length === 0 ? 0 : (safePage - 1) * pageSize + 1,
    rangeEnd: Math.min(safePage * pageSize, items.length),
  }
}
