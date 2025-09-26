import React, { useState } from 'react'
import './App.css'
import AdminHome from './AdminHome'
import UserHome from './UserHome'

type View = 'login' | 'admin' | 'user'
type Role = Exclude<View, 'login'>

type UserCredentials = {
  password: string
  view: Role
}

const USERS: Record<Role, UserCredentials> = {
  admin: { password: 'admin', view: 'admin' },
  user: { password: 'user', view: 'user' }
}

const isKnownUser = (value: string): value is Role => {
  return value === 'admin' || value === 'user'
}

export default function App() {
  const [view, setView] = useState<View>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  const resetForm = () => {
    setUsername('')
    setPassword('')
  }

  const handleLogin = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmedUser = username.trim()
    if (!trimmedUser || password.length === 0) {
      setError('Ingrese usuario y contrasena')
      return
    }

    if (!isKnownUser(trimmedUser)) {
      setError('Credenciales invalidas')
      return
    }

    const credentials = USERS[trimmedUser]
    if (credentials.password !== password) {
      setError('Credenciales invalidas')
      return
    }

    setView(credentials.view)
    setError(null)
    resetForm()
  }

  const handleLogout = () => {
    setView('login')
    setError(null)
    resetForm()
  }

  if (view === 'admin') {
    return <AdminHome onLogout={handleLogout} />
  }

  if (view === 'user') {
    return <UserHome onLogout={handleLogout} />
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
        <button className="login-button" type="submit">
          Ingresar
        </button>
      </form>
    </div>
  )
}
