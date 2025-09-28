import React, { useEffect, useMemo, useState } from 'react'
import './App.css'
import TopBar from './components/TopBar'
import { ADMIN_PAGES, type AdminPageId } from './adminPages'

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

  const activePage = activePageId
    ? visiblePages.find(page => page.id === activePageId) ?? null
    : null
  const ActiveComponent = activePage?.component

  return (
    <div className="app">
      <TopBar
        rightContent={onLogout ? (
          <button className="logout-button" type="button" onClick={onLogout}>
            Cerrar sesion
          </button>
        ) : null}
      />
      <div className="admin-menu">
        {visiblePages.map(page => (
          <button
            key={page.id}
            type="button"
            className={`admin-menu-button${activePageId === page.id ? ' active' : ''}`}
            onClick={() => setActivePageId(page.id)}
          >
            {page.label}
          </button>
        ))}
      </div>
      {visiblePages.length === 0 ? (
        <div className="no-views-message">No hay vistas habilitadas para este usuario.</div>
      ) : ActiveComponent ? (
        <ActiveComponent />
      ) : null}
    </div>
  )
}
