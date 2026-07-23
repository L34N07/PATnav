import React, { useCallback, useState } from "react"
import type { ComponentType, ReactNode } from "react"
import "./App.css"
import HomeShell, { type HomeShellPage } from "./components/HomeShell"
import AdminPanelView from "./components/admin/views/AdminPanelView"
import TransferTablesView from "./components/admin/views/TransferTablesView"
import { ADMIN_PAGES, type AdminPageDefinition, type AdminPageId } from "./adminPages"

type AdminHomeProps = {
  onLogout?: () => void
}

type AdminPanelPage = {
  id: "adminPanel" | "transferTables"
  label: string
  component: ComponentType
}

type AdminHomePage = AdminPanelPage | AdminPageDefinition

type AdminHomePageId = AdminHomePage["id"]

const ADMIN_PANEL_PAGE: AdminPanelPage = {
  id: "adminPanel",
  label: "Admin Panel",
  component: AdminPanelView
}

const TRANSFER_TABLES_PAGE: AdminPanelPage = {
  id: "transferTables",
  label: "Tablas Transferencias",
  component: TransferTablesView
}

export default function AdminHome({ onLogout }: AdminHomeProps) {
  const [activePageId, setActivePageId] = useState<AdminHomePageId | null>(null)

  const handleSelectPage = useCallback((pageId: AdminHomePageId) => {
    setActivePageId(pageId)
  }, [])

  const wrapContent = useCallback(
    (content: ReactNode, page: HomeShellPage<AdminHomePageId>) =>
      page.id === ADMIN_PANEL_PAGE.id ? <div className="admin-panel-wrapper">{content}</div> : content,
    []
  )

  return (
    <HomeShell
      onLogout={onLogout}
      leftPages={[...ADMIN_PAGES, TRANSFER_TABLES_PAGE]}
      rightPages={[ADMIN_PANEL_PAGE]}
      activePageId={activePageId}
      onSelectPage={handleSelectPage}
      pageProps={{ isAdmin: true }}
      wrapContent={wrapContent}
    />
  )
}
