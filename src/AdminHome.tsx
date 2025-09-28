
import React, { useState } from "react"
import type { ComponentType } from "react"
import "./App.css"
import TopBar from "./components/TopBar"
import AdminPanelView from "./components/admin/views/AdminPanelView"
import { ADMIN_PAGES, type AdminPageDefinition, type AdminPageId } from "./adminPages"

type AdminHomeProps = {
  onLogout?: () => void
}

type AdminPanelPage = {
  id: "adminPanel"
  label: string
  component: ComponentType
}

type AdminHomePage = AdminPanelPage | AdminPageDefinition

type AdminHomePageId = AdminHomePage["id"]

const ADMIN_PANEL_PAGE: AdminPanelPage = {
  id: "adminPanel",
  label: "Panel Admin",
  component: AdminPanelView
}

export default function AdminHome({ onLogout }: AdminHomeProps) {
  const [activePageId, setActivePageId] = useState<AdminHomePageId | null>(null)

  const activePage: AdminHomePage | null =
    activePageId == null
      ? null
      : activePageId === ADMIN_PANEL_PAGE.id
        ? ADMIN_PANEL_PAGE
        : (ADMIN_PAGES.find(page => page.id === activePageId) ?? null)
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
        <div className="admin-menu-group">
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
        <div className="admin-menu-group admin-menu-group-right">
          <button
            type="button"
            className={`admin-menu-button${activePageId === ADMIN_PANEL_PAGE.id ? " active" : ""}`}
            onClick={() => setActivePageId(ADMIN_PANEL_PAGE.id)}
          >
            {ADMIN_PANEL_PAGE.label}
          </button>
        </div>
      </div>
      {ActiveComponent ? (
        activePageId === ADMIN_PANEL_PAGE.id ? (
          <div className="admin-panel-wrapper">
            <ActiveComponent />
          </div>
        ) : (
          <ActiveComponent />
        )
      ) : null}
    </div>
  )
}
