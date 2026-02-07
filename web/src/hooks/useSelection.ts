import { useState, useCallback, useMemo } from 'react'

/**
 * Generic hook for managing selection state
 * Replaces duplicate selection logic across recordings and rides lists
 *
 * @template T - Item type extending { id: string }
 * @param items - Array of items to manage selection for
 * @returns Selection state and control functions
 *
 * @example
 * const selection = useSelection(recordings)
 * selection.toggle('rec-123')
 * console.log(selection.count) // 1
 * console.log(selection.isSelected('rec-123')) // true
 */
export function useSelection<T extends { id: string }>(items: T[]) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  /**
   * Toggle selection for a single item
   */
  const toggle = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  /**
   * Toggle all items (select all or clear all)
   */
  const toggleAll = useCallback(() => {
    setSelectedIds(prev => {
      if (prev.size === items.length) {
        return new Set() // Clear all
      } else {
        return new Set(items.map(i => i.id)) // Select all
      }
    })
  }, [items])

  /**
   * Clear all selections
   */
  const clear = useCallback(() => {
    setSelectedIds(new Set())
  }, [])

  /**
   * Check if a specific item is selected
   */
  const isSelected = useCallback((id: string) => {
    return selectedIds.has(id)
  }, [selectedIds])

  /**
   * Get all selected items
   */
  const selected = useMemo(
    () => items.filter(i => selectedIds.has(i.id)),
    [items, selectedIds]
  )

  return {
    selectedIds,
    selected,
    toggle,
    toggleAll,
    clear,
    isSelected,
    count: selectedIds.size
  }
}
