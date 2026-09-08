'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS } from '@/hooks/usePagination'

interface ServerPage<T> {
  items: T[]
  total: number
}

/**
 * Pagination where each page is its own request.
 *
 * The counterpart to usePagination, which slices an already-fetched array. Use
 * this when fetching the whole list is the thing you are trying to avoid: the
 * server renders page 1, and page changes fetch just that page.
 *
 * Exposes the same shape usePagination does, so <PaginationControls> takes
 * either without knowing which it has.
 *
 * `initialItems`/`initialTotal` come from the server component, so the first
 * paint needs no client fetch at all.
 */
export function useServerPagination<T extends { id: string }>({
  initialItems,
  initialTotal,
  storageKey,
  fetchPage,
}: {
  initialItems: T[]
  initialTotal: number
  storageKey: string
  fetchPage: (page: number, pageSize: number) => Promise<ServerPage<T>>
}) {
  const [items, setItems] = useState<T[]>(initialItems)
  const [total, setTotal] = useState(initialTotal)
  const [page, setPageState] = useState(1)
  const [pageSize, setPageSizeState] = useState<number>(DEFAULT_PAGE_SIZE)
  const [loading, setLoading] = useState(false)

  // Guards an out-of-order response from overwriting a newer one: rapid clicks
  // on "next" can resolve in any order, and only the latest should win.
  const requestId = useRef(0)

  // The list container, so scroll preservation can watch it resize. Attach via
  // the returned `listRef`; without it preserveScroll falls back to frames.
  const listRef = useRef<HTMLElement | null>(null)

  const load = useCallback(
    async (nextPage: number, nextSize: number) => {
      const id = ++requestId.current
      setLoading(true)
      try {
        const res = await fetchPage(nextPage, nextSize)
        if (id !== requestId.current) return
        setItems(res.items)
        setTotal(res.total)
      } catch {
        // Leave the current page on screen rather than blanking the list.
      } finally {
        if (id === requestId.current) setLoading(false)
      }
    },
    [fetchPage],
  )

  // Restore the persisted page size after mount. Refetches only if it differs
  // from the default the server already rendered.
  const restored = useRef(false)
  useEffect(() => {
    if (restored.current) return
    restored.current = true
    try {
      const stored = window.localStorage.getItem(storageKey)
      if (!stored) return
      const parsed = parseInt(stored, 10)
      if (
        PAGE_SIZE_OPTIONS.includes(parsed as (typeof PAGE_SIZE_OPTIONS)[number]) &&
        parsed !== DEFAULT_PAGE_SIZE
      ) {
        setPageSizeState(parsed)
        void load(1, parsed)
      }
    } catch {
      // Blocked storage — the server-rendered default page stands.
    }
  }, [storageKey, load])

  /**
   * Hold the viewport still across a page change.
   *
   * Pages are not all the same height — the last one is usually short — so
   * swapping an 8-card page for a 10-card page grows the document and the
   * browser's scroll anchoring shifts the viewport to keep its anchor element
   * visible. You land exactly the height difference away (two cards, for an
   * 18-record list). It only bites going *back*, short page to full page,
   * which is why it looks asymmetric.
   *
   * Frame-counting after the fetch resolves does not work: setItems runs in an
   * async continuation, so React may not have committed — let alone laid out —
   * the new rows by the time any fixed number of rAFs have passed, and the
   * correction then runs against the old height and no-ops.
   *
   * So watch for the layout change instead. A ResizeObserver on the list
   * fires when the rows actually change height, which is precisely the moment
   * the browser has shifted the scroll position and the moment to put it back.
   */
  const preserveScroll = useCallback(() => {
    if (typeof window === 'undefined') return
    const el = listRef.current
    const y = window.scrollY

    if (!el || typeof ResizeObserver === 'undefined') {
      // No observer (or no element registered): fall back to frame-counting,
      // which handles the common case where the swap is already painted.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (window.scrollY !== y) window.scrollTo({ top: y })
        })
      })
      return
    }

    let done = false
    const restore = () => {
      if (done) return
      done = true
      obs.disconnect()
      clearTimeout(timer)
      if (window.scrollY !== y) window.scrollTo({ top: y })
    }

    const obs = new ResizeObserver(() => {
      // The height just changed; correct on the next frame, once the browser
      // has finished its own anchoring adjustment.
      requestAnimationFrame(restore)
    })
    obs.observe(el)

    // Stop watching if the height never changes (same-size pages), so the
    // observer is not left attached.
    const timer = setTimeout(restore, 1000)
  }, [])

  const setPage = useCallback(
    (next: number) => {
      setPageState(next)
      void load(next, pageSize).then(preserveScroll)
    },
    [load, pageSize, preserveScroll],
  )

  const setPageSize = useCallback(
    (size: number) => {
      setPageSizeState(size)
      setPageState(1)
      try {
        window.localStorage.setItem(storageKey, String(size))
      } catch {
        // Non-fatal; the size still applies for this session.
      }
      void load(1, size).then(preserveScroll)
    },
    [load, storageKey, preserveScroll],
  )

  /**
   * Drop rows locally after a delete and refetch the current page, so the page
   * refills from the server instead of shrinking. Clamps back a page when the
   * last item on the final page goes away.
   */
  const removeItems = useCallback(
    (ids: Set<string>) => {
      const remaining = total - ids.size
      const lastPage = Math.max(1, Math.ceil(remaining / pageSize))
      const target = Math.min(page, lastPage)
      setItems(prev => prev.filter(i => !ids.has(i.id)))
      setTotal(remaining)
      setPageState(target)
      void load(target, pageSize)
    },
    [load, page, pageSize, total],
  )

  /** Refetch the current page in place — after a merge completes, say. */
  const refresh = useCallback(() => {
    void load(page, pageSize)
  }, [load, page, pageSize])

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return {
    pageItems: items,
    /** Attach to the element wrapping the rows so paging can hold scroll. */
    listRef,
    refresh,
    page,
    setPage,
    pageSize,
    setPageSize,
    totalPages,
    totalItems: total,
    loading,
    removeItems,
    rangeStart: total === 0 ? 0 : (page - 1) * pageSize + 1,
    rangeEnd: Math.min(page * pageSize, total),
  }
}
