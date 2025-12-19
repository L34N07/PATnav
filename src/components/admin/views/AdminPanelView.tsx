import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useAutoDismissMessage } from '../../../hooks/useAutoDismissMessage'
import StatusToasts from '../../StatusToasts'
import { ADMIN_PAGES } from '../../../adminPages'
import {
  buildRowMap,
  derivePermissionMap,
  emptyPermissionMap,
  findEntry
} from '../../../adminPermissions'

const USERNAME_FIELD_CANDIDATES = [
  'username',
  'user',
  'usuario',
  'userName',
  'login',
  'appusername'
]
const USER_ID_FIELD_CANDIDATES = [
  'userid',
  'user_id',
  'id',
  'appuserid',
  'appuser_id',
  'appuserid'
]
const SUCCESS_MESSAGE_DURATION_MS = 2000
const ERROR_MESSAGE_DURATION_MS = 2600

const toDisplayValue = (value: unknown) => String(value ?? '').trim()
const toNumericId = (value: unknown) => {
  if (value === null || value === undefined) {
    return null
  }

  if (typeof value === 'number' && Number.isInteger(value)) {
    return value
  }

  const parsed = Number.parseInt(String(value).trim(), 10)
  return Number.isNaN(parsed) ? null : parsed
}

type PermissionMap = Record<string, boolean>

type AdminUserRecord = {
  userId: number
  username: string
  permissions: PermissionMap
}

export default function AdminPanelView() {
  const electronAPI = window.electronAPI

  const [users, setUsers] = useState<AdminUserRecord[]>([])
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null)
  const [permissionDraft, setPermissionDraft] = useState<PermissionMap>(() => emptyPermissionMap())
  const [isLoading, setIsLoading] = useState(false)
  const [isUpdating, setIsUpdating] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useAutoDismissMessage(statusMessage, setStatusMessage, SUCCESS_MESSAGE_DURATION_MS)
  useAutoDismissMessage(errorMessage, setErrorMessage, ERROR_MESSAGE_DURATION_MS)

  const clearMessages = useCallback(() => {
    setErrorMessage(null)
    setStatusMessage(null)
  }, [setErrorMessage, setStatusMessage])

  const selectedUser = useMemo(
    () => (selectedUserId != null ? users.find(user => user.userId === selectedUserId) ?? null : null),
    [users, selectedUserId]
  )

  useEffect(() => {
    if (!selectedUser) {
      setPermissionDraft(emptyPermissionMap())
      return
    }

    setPermissionDraft({ ...selectedUser.permissions })
  }, [selectedUser])


  const fetchUsers = useCallback(async () => {
    if (!electronAPI?.getAppUsers) {
      setErrorMessage('Servicio de usuarios no disponible')
      return
    }

    setIsLoading(true)
    clearMessages()

    try {
      const result = await electronAPI.getAppUsers('user')
      if (result.error) {
        throw new Error(result.details || result.error)
      }

      const rows = (result.rows ?? []) as Record<string, unknown>[]
      const mapped: AdminUserRecord[] = []

      rows.forEach(record => {
        const row = record ?? {}
        const rowMap = buildRowMap(row)
        const userIdEntry = findEntry(rowMap, USER_ID_FIELD_CANDIDATES)
        const userId = userIdEntry ? toNumericId(userIdEntry.value) : null
        if (userId === null) {
          return
        }
        const usernameEntry = findEntry(rowMap, USERNAME_FIELD_CANDIDATES)
        const username = usernameEntry ? toDisplayValue(usernameEntry.value) : ''
        if (!username) {
          return
        }

        const permissions = derivePermissionMap(rowMap)
        mapped.push({ userId, username, permissions })
      })

      mapped.sort((a, b) => a.username.localeCompare(b.username, 'es', { sensitivity: 'base' }))

      setUsers(mapped)
      if (mapped.length > 0) {
        setSelectedUserId(prev => {
          if (prev != null && mapped.some(user => user.userId === prev)) {
            return prev
          }
          return mapped[0].userId
        })
      } else {
        setSelectedUserId(null)
      }

      setStatusMessage('Usuarios cargados correctamente.')
    } catch (error) {
      console.error('No se pudieron traer los usuarios de la app:', error)
      setUsers([])
      setSelectedUserId(null)
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Error desconocido al traer los usuarios.'
      )
    } finally {
      setIsLoading(false)
    }
  }, [electronAPI])

  useEffect(() => {
    void fetchUsers()
  }, [fetchUsers])

  const handleRefresh = () => {
    void fetchUsers()
  }

  const handleTogglePermission = (permissionKey: string) => {
    setPermissionDraft(prev => {
      const next = { ...prev }
      const current = Boolean(next[permissionKey])
      next[permissionKey] = !current
      return next
    })
  }

  const hasChanges = useMemo(() => {
    if (!selectedUser) {
      return false
    }

    return ADMIN_PAGES.some(page => {
      const key = page.permissionKey
      const originalValue = selectedUser.permissions[key] ?? false
      const draftValue = permissionDraft[key] ?? false
      return originalValue !== draftValue
    })
  }, [permissionDraft, selectedUser])

  const handleUpdatePermissions = async () => {
    if (!selectedUser) {
      return
    }

    if (!electronAPI?.updateUserPermissions) {
      setErrorMessage('Servicio de permisos no disponible')
      return
    }

    setIsUpdating(true)
    clearMessages()

    try {
      const result = await electronAPI.updateUserPermissions({
        userId: selectedUser.userId,
        permissions: permissionDraft
      })

      if (result.error) {
        throw new Error(result.details || result.error)
      }

      setUsers(prev =>
        prev.map(user =>
          user.userId === selectedUser.userId
            ? { ...user, permissions: { ...permissionDraft } }
            : user
        )
      )

      setStatusMessage('Permisos actualizados correctamente.')
    } catch (error) {
      console.error('No se pudieron actualizar los permisos del usuario:', error)
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Error desconocido al actualizar los permisos.'
      )
    } finally {
      setIsUpdating(false)
    }
  }

  return (
    <>
      <StatusToasts statusMessage={statusMessage} errorMessage={errorMessage} />
      <div className="admin-panel">
        <div className="admin-panel-header">
          <div>
            <h2 className="admin-panel-title">Panel de administracion</h2>
            <p className="admin-panel-subtitle">
              Gestiona las vistas habilitadas para los usuarios del tipo "user".
            </p>
          </div>
          <div className="admin-panel-actions">
            <button
              className="admin-panel-button"
              type="button"
              onClick={handleRefresh}
              disabled={isLoading}
            >
              {isLoading ? 'Cargando...' : 'Recargar'}
            </button>
          </div>
        </div>
        <div className="admin-panel-body">
          <div className="admin-panel-users">
            <h3 className="admin-panel-section-title">Usuarios</h3>
            {users.length === 0 ? (
              <div className="admin-panel-empty">
                {isLoading ? 'Cargando usuarios...' : 'No hay usuarios de tipo user disponibles.'}
              </div>
            ) : (
              <ul className="admin-panel-user-list">
                {users.map(user => (
                  <li key={user.userId}>
                    <button
                      type="button"
                      className={`admin-panel-user${user.userId === selectedUserId ? ' selected' : ''}`}
                      onClick={() => setSelectedUserId(user.userId)}
                      disabled={isLoading}
                    >
                      {user.username}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="admin-panel-permissions">
            <h3 className="admin-panel-section-title">Permisos por vista</h3>
            {!selectedUser ? (
              <div className="admin-panel-empty">Selecciona un usuario para editar sus permisos.</div>
            ) : (
              <>
                <div className="admin-panel-permission-grid">
                  {ADMIN_PAGES.map(page => (
                    <label key={page.id} className="admin-panel-permission-item">
                      <input
                        type="checkbox"
                        checked={Boolean(permissionDraft[page.permissionKey])}
                        onChange={() => handleTogglePermission(page.permissionKey)}
                        disabled={isUpdating}
                      />
                      <span>{page.label}</span>
                    </label>
                  ))}
                </div>
                <button
                  className="admin-panel-button primary admin-panel-button--success"
                  type="button"
                  onClick={handleUpdatePermissions}
                  disabled={!hasChanges || isUpdating}
                >
                  {isUpdating ? 'Actualizando...' : 'Actualizar Permisos'}
                </button>
              </>
            )}
          </div>
        </div>
        <div className="admin-panel-messages" />
      </div>
    </>
  )
}
