import React, { useCallback, useEffect, useMemo, useState } from "react"
import "./App.css"
import HomeShell from "./components/HomeShell"
import { ADMIN_PAGES, type AdminPageId } from "./adminPages"

type UserHomeProps = {
  onLogout?: () => void
  allowedPageIds: AdminPageId[]
}

export default function UserHome({ onLogout, allowedPageIds }: UserHomeProps) {
  const visiblePages = useMemo(
    () => ADMIN_PAGES.filter(page => allowedPageIds.includes(page.id)),
    [allowedPageIds]
  )

  const [activePageId, setActivePageId] = useState<AdminPageId | null>(null)

  useEffect(() => {
    if (visiblePages.length === 0) {
      setActivePageId(null)
      return
    }

    if (activePageId != null && !visiblePages.some(page => page.id === activePageId)) {
      setActivePageId(null)
    }
  }, [visiblePages, activePageId])

  const handleSelectPage = useCallback((pageId: AdminPageId) => {
    setActivePageId(pageId)
  }, [])

  const emptyState =
    visiblePages.length === 0 ? (
      <div className="no-views-message">No hay vistas habilitadas para este usuario.</div>
    ) : null

  return (
    <HomeShell
      onLogout={onLogout}
      leftPages={visiblePages}
      activePageId={activePageId}
      onSelectPage={handleSelectPage}
      emptyState={emptyState}
    />
  )
}
