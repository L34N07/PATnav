import React from 'react'
import logo from '../assets/logopng.png'

type TopBarProps = {
  rightContent?: React.ReactNode
}

export default function TopBar({ rightContent }: TopBarProps) {
  return (
    <div className="top-bar">
      <div className="top-bar-left">
        <img src={logo} alt="logo" />
        <span className="top-bar-title">La Naviera</span>
      </div>
      {rightContent ? <div className="top-bar-right">{rightContent}</div> : null}
    </div>
  )
}
