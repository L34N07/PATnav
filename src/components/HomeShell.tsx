import React, { ComponentType, ReactNode, useCallback, useEffect, useState } from "react"
import TopBar from "./TopBar"

export type HomeShellPage<PageId extends string = string> = {
  id: PageId
  label: string
  component: ComponentType
}

type HomeShellProps<PageId extends string> = {
  onLogout?: () => void
  leftPages: HomeShellPage<PageId>[]
  rightPages?: HomeShellPage<PageId>[]
  activePageId: PageId | null
  onSelectPage: (pageId: PageId) => void
  wrapContent?: (content: ReactNode, page: HomeShellPage<PageId>) => ReactNode
  emptyState?: ReactNode
}

export default function HomeShell<PageId extends string>({
  onLogout,
  leftPages,
  rightPages = [],
  activePageId,
  onSelectPage,
  wrapContent,
  emptyState
}: HomeShellProps<PageId>) {
  const [activePageRevision, setActivePageRevision] = useState(0)

  const activePage = activePageId
    ? [...leftPages, ...rightPages].find(page => page.id === activePageId) ?? null
    : null
  const ActiveComponent = activePage?.component

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("app:active-page-change", {
        detail: { pageId: activePageId }
      })
    )
  }, [activePageId])

  const handlePageSelect = useCallback(
    (pageId: PageId) => {
      if (pageId === activePageId) {
        setActivePageRevision(prev => prev + 1)
      }
      onSelectPage(pageId)
    },
    [activePageId, onSelectPage]
  )

  const renderMenuButtons = (pages: HomeShellPage<PageId>[]) =>
    pages.map(page => (
      <button
        key={page.id}
        type="button"
        className={`admin-menu-button${activePageId === page.id ? " active" : ""}`}
        onClick={() => handlePageSelect(page.id)}
      >
        {page.label}
      </button>
    ))

  const content =
    ActiveComponent && activePage
      ? wrapContent
        ? wrapContent(<ActiveComponent key={`${activePage.id}-${activePageRevision}`} />, activePage)
        : <ActiveComponent key={`${activePage.id}-${activePageRevision}`} />
      : null

  const body = content ?? emptyState ?? null

  return (
    <div className="app">
      <TopBar
        rightContent={
          onLogout ? (
            <button className="logout-button" type="button" onClick={onLogout}>
              Salir
            </button>
          ) : null
        }
      />
      <div className="admin-menu">
        <div className="admin-menu-group">{renderMenuButtons(leftPages)}</div>
        {rightPages.length > 0 ? (
          <div className="admin-menu-group admin-menu-group-right">
            {renderMenuButtons(rightPages)}
          </div>
        ) : null}
      </div>
      <div className="app-content">{body}</div>
    </div>
  )
}
