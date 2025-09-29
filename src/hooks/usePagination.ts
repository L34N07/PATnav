import { useCallback, useEffect, useMemo, useState } from "react"

export function usePagination<T>(items: readonly T[], itemsPerPage: number) {
  const [currentPage, setCurrentPage] = useState(0)

  const pageCount = useMemo(() => {
    if (itemsPerPage <= 0) {
      return 0
    }
    return Math.ceil(items.length / itemsPerPage)
  }, [items.length, itemsPerPage])

  useEffect(() => {
    if (pageCount === 0) {
      if (currentPage !== 0) {
        setCurrentPage(0)
      }
      return
    }

    if (currentPage > pageCount - 1) {
      setCurrentPage(pageCount - 1)
    }
  }, [pageCount, currentPage])

  const goToPage = useCallback(
    (page: number) => {
      setCurrentPage(() => {
        if (pageCount === 0) {
          return 0
        }
        return Math.max(0, Math.min(page, pageCount - 1))
      })
    },
    [pageCount]
  )

  const pageItems = useMemo(() => {
    if (pageCount === 0) {
      return [] as T[]
    }

    const start = currentPage * itemsPerPage
    const end = start + itemsPerPage
    return items.slice(start, end)
  }, [items, currentPage, itemsPerPage, pageCount])

  const resetPage = useCallback(() => {
    setCurrentPage(0)
  }, [])

  return {
    currentPage,
    pageCount,
    pageItems,
    itemCount: items.length,
    goToPage,
    resetPage
  }
}
