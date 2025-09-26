import React, { useState } from "react"
import "./App.css"
import TopBar from "./components/TopBar"
import TestView from "./components/admin/views/TestView"

type AdminHomeProps = {
  onLogout?: () => void
}

type AdminPage = "test"

const ADMIN_PAGES: { id: AdminPage; label: string }[] = [
  { id: "test", label: "Test View" }
]

export default function AdminHome({ onLogout }: AdminHomeProps) {
  const [activePage, setActivePage] = useState<AdminPage | null>(null)

  const renderActivePage = () => {
    if (activePage === "test") {
      return <TestView />
    }

    return null
  }

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
            className={`admin-menu-button${activePage === page.id ? " active" : ""}`}
            onClick={() => setActivePage(page.id)}
          >
            {page.label}
          </button>
        ))}
      </div>
      {renderActivePage()}
    </div>
  )
}
