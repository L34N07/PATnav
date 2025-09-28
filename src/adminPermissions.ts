import type { AdminPageId } from "./adminPages"
import { ADMIN_PAGES } from "./adminPages"

export type RowEntry = {
  key: string
  value: unknown
}

const normalizeKey = (value: string) => value.trim().toLowerCase()

export const buildRowMap = (row: Record<string, unknown>) => {
  const map = new Map<string, RowEntry>()
  Object.entries(row).forEach(([key, value]) => {
    map.set(normalizeKey(key), { key, value })
  })
  return map
}

export const findEntry = (rowMap: Map<string, RowEntry>, candidates: string[]) => {
  for (const candidate of candidates) {
    if (!candidate) {
      continue
    }
    const entry = rowMap.get(normalizeKey(candidate))
    if (entry) {
      return entry
    }
  }
  return undefined
}

export const isViewEnabled = (value: unknown) => {
  if (value === null || value === undefined) {
    return false
  }

  if (typeof value === "boolean") {
    return value
  }

  if (typeof value === "number") {
    return value !== 0
  }

  const normalized = String(value).trim().toLowerCase()
  if (normalized === "" || normalized === "0" || normalized === "false" || normalized === "no") {
    return false
  }

  return true
}

export const deriveAllowedPages = (rowMap: Map<string, RowEntry>): AdminPageId[] => {
  const allowed: AdminPageId[] = []

  for (const page of ADMIN_PAGES) {
    const candidates = [page.permissionKey, page.id]
    const entry = findEntry(rowMap, candidates)
    if (entry && isViewEnabled(entry.value) && !allowed.includes(page.id)) {
      allowed.push(page.id)
    }
  }

  return allowed
}

export const derivePermissionMap = (rowMap: Map<string, RowEntry>) => {
  const permissions: Record<string, boolean> = {}

  for (const page of ADMIN_PAGES) {
    const candidates = [page.permissionKey, page.id]
    const entry = findEntry(rowMap, candidates)
    permissions[page.permissionKey] = entry ? isViewEnabled(entry.value) : false
  }

  return permissions
}

export const emptyPermissionMap = () => {
  const permissions: Record<string, boolean> = {}
  for (const page of ADMIN_PAGES) {
    permissions[page.permissionKey] = false
  }
  return permissions
}
