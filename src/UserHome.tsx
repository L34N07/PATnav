import React from 'react'
import './App.css'
import TopBar from './components/TopBar'

type UserHomeProps = {
  onLogout?: () => void
}

export default function UserHome({ onLogout }: UserHomeProps) {
  return (
    <div className="app">
      <TopBar rightContent={onLogout ? (
        <button className="logout-button" type="button" onClick={onLogout}>
          Cerrar sesion
        </button>
      ) : null} />
    </div>
  )
}
