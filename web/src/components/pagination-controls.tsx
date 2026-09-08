'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { PAGE_SIZE_OPTIONS } from '@/hooks/usePagination'

interface PaginationControlsProps {
  page: number
  totalPages: number
  pageSize: number
  totalItems: number
  rangeStart: number
  rangeEnd: number
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
  /** A page fetch is in flight — guards against queueing duplicate requests. */
  loading?: boolean
  /** Noun for the count line, e.g. "rides" or "recordings". */
  itemLabel?: string
  className?: string
}

/**
 * Page navigation plus a per-page selector.
 *
 * Renders nothing when everything fits on one page at the default size — an
 * empty or short list should not grow a control that does nothing. The selector
 * still appears once there is more than a page's worth to page through.
 */
export function PaginationControls({
  page,
  totalPages,
  pageSize,
  totalItems,
  rangeStart,
  rangeEnd,
  onPageChange,
  onPageSizeChange,
  loading = false,
  itemLabel = 'items',
  className = '',
}: PaginationControlsProps) {
  if (totalItems === 0) return null
  if (totalPages <= 1 && pageSize === PAGE_SIZE_OPTIONS[0]) return null

  return (
    <div
      className={`flex flex-col sm:flex-row items-center justify-between gap-4 mt-6 mb-12 ${className}`}
    >
      <div className="text-sm text-secondary">
        Showing {rangeStart}–{rangeEnd} of {totalItems} {itemLabel}
      </div>

      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-secondary">
          <span className="hidden sm:inline">Per page</span>
          <select
            value={pageSize}
            onChange={e => onPageSizeChange(Number(e.target.value))}
            disabled={loading}
            className="bg-background border border-border rounded px-2 py-1 text-sm text-primary"
            aria-label={`${itemLabel} per page`}
          >
            {PAGE_SIZE_OPTIONS.map(size => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>

        {totalPages > 1 && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => onPageChange(page - 1)}
              disabled={page <= 1 || loading}
              className="p-2 rounded border border-border text-primary disabled:opacity-40 disabled:cursor-not-allowed hover:border-primary transition-colors"
              aria-label="Previous page"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <span className="text-sm text-secondary px-2 tabular-nums" aria-live="polite">
              {page} / {totalPages}
            </span>

            <button
              onClick={() => onPageChange(page + 1)}
              disabled={page >= totalPages || loading}
              className="p-2 rounded border border-border text-primary disabled:opacity-40 disabled:cursor-not-allowed hover:border-primary transition-colors"
              aria-label="Next page"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
