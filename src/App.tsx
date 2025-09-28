import React, { useState } from 'react'
import './App.css'
import AdminHome from './AdminHome'
import UserHome from './UserHome'
import { buildRowMap, deriveAllowedPages, findEntry } from './adminPermissions'
import { ADMIN_PAGES, type AdminPageId } from './adminPages'

type Role = 'admin' | 'user'

type Session = {
  role: Role
  username: string
  allowedPageIds: AdminPageId[]
}

const PASSWORD_FIELD_CANDIDATES = ['password', 'pass', 'contrasena', 'apppassword']
const TYPE_FIELD_CANDIDATES = ['tipo', 'type', 'usertype', 'tipo_usuario', 'perfil', 'appusertype']
const ALL_PAGE_IDS: AdminPageId[] = ADMIN_PAGES.map(page => page.id)

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const resetForm = () => {
    setUsername('')
    setPassword('')
  }

  const handleLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const trimmedUser = username.trim()
    if (!trimmedUser || password.length === 0) {
      setError('Ingrese usuario y contrasena')
      return
    }

    const electronAPI = window.electronAPI
    if (!electronAPI?.getAppUser) {
      setError('Servicio de autenticacion no disponible')
      return
    }

    setIsSubmitting(true)
    try {
      const result = await electronAPI.getAppUser(trimmedUser)
      if (result.error) {
        console.error('get_app_user failed:', result)
        setError('No se pudo validar las credenciales')
        return
      }

      const rows = result.rows ?? []
      if (rows.length === 0) {
        setError('Credenciales invalidas')
        return
      }

      const row = (rows[0] ?? {}) as Record<string, unknown>
      const rowMap = buildRowMap(row)

      const passwordEntry = findEntry(rowMap, PASSWORD_FIELD_CANDIDATES)
      if (!passwordEntry) {
        setError('El usuario no tiene contrasena configurada')
        return
      }

      const storedPassword = String(passwordEntry.value ?? '').trim()
      if (storedPassword !== password) {
        setError('Credenciales invalidas')
        return
      }

      const typeEntry = findEntry(rowMap, TYPE_FIELD_CANDIDATES)
      if (!typeEntry) {
        setError('No se pudo determinar el tipo de usuario')
        return
      }

      const userTypeRaw = String(typeEntry.value ?? '').trim().toLowerCase()
      if (userTypeRaw !== 'admin' && userTypeRaw !== 'user') {
        setError(`Tipo de usuario desconocido: ${typeEntry.value ?? ''}`)
        return
      }

      const role = userTypeRaw as Role
      const allowedPageIds = role === 'admin' ? [...ALL_PAGE_IDS] : deriveAllowedPages(rowMap)

      setSession({ role, username: trimmedUser, allowedPageIds })
      setError(null)
      resetForm()
    } catch (err) {
      console.error('Login error', err)
      setError('No se pudo validar las credenciales')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleLogout = () => {
    setSession(null)
    setError(null)
    resetForm()
  }

  if (session?.role === 'admin') {
    return <AdminHome onLogout={handleLogout} />
  }

  if (session?.role === 'user') {
    return <UserHome onLogout={handleLogout} allowedPageIds={session.allowedPageIds} />
  }

  return (
    <div className="login-wrapper">
      <form className="login-card" onSubmit={handleLogin}>
        <h1 className="login-title">La Naviera</h1>
        <label className="login-field">
          Usuario
          <input
            type="text"
            value={username}
            onChange={event => setUsername(event.target.value)}
            autoComplete="username"
            autoFocus
          />
        </label>
        <label className="login-field">
          Contrasena
          <input
            type="password"
            value={password}
            onChange={event => setPassword(event.target.value)}
            autoComplete="current-password"
          />
        </label>
        {error ? <div className="login-error">{error}</div> : null}
        <button className="login-button" type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Ingresando...' : 'Ingresar'}
        </button>
      </form>
    </div>
  )
}

