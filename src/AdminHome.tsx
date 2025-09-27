import React, { useState } from "react"
import "./App.css"
import TopBar from "./components/TopBar"
import { ADMIN_PAGES, type AdminPageId } from "./adminPages"

type AdminHomeProps = {
  onLogout?: () => void
}

export default function AdminHome({ onLogout }: AdminHomeProps) {
  const [activePageId, setActivePageId] = useState<AdminPageId | null>(null)

  const activePage = activePageId
    ? ADMIN_PAGES.find(page => page.id === activePageId) ?? null
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
        {ADMIN_PAGES.map(page => (
          <button
            key={page.id}
            type="button"
            className={`admin-menu-button${activePageId === page.id ? " active" : ""}`}
            onClick={() => setActivePageId(page.id)}
          >
            {page.label}
          </button>
        ))}
      </div>
      {ActiveComponent ? <ActiveComponent /> : null}
    </div>
  )
}
