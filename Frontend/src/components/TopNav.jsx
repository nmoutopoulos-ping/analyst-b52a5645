import React from 'react'
import { NavLink } from 'react-router-dom'
import { LayoutDashboard, PlusCircle, Settings, LogOut } from 'lucide-react'
import { getStoredAuth, clearStoredAuth } from '../lib/auth'

const tabs = [
  { to: '/analysis', label: 'New Analysis', icon: PlusCircle },
  { to: '/deals',    label: 'Deals',        icon: LayoutDashboard },
  { to: '/settings', label: 'Assumptions',  icon: Settings },
]

export default function TopNav({ onSignOut }) {
  const { userName, userEmail } = getStoredAuth()

  function handleSignOut() {
    clearStoredAuth()
    onSignOut()
  }

  return (
    <nav className="bg-navy sticky top-0 z-50 flex items-center px-6 h-14 gap-8">
      {/* Brand */}
      <div className="flex items-center gap-2 text-white font-bold text-sm shrink-0">
        <span className="text-base">🏘</span>
        <span>Ping Analyst</span>
      </div>

      {/* Tabs */}
      <div className="flex gap-0.5 flex-1">
        {tabs.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors
               ${isActive
                 ? 'text-white bg-white/12'
                 : 'text-white/60 hover:text-white/85 hover:bg-white/7'}`
            }
          >
            <Icon size={13} />
            {label}
          </NavLink>
        ))}
      </div>

      {/* User + Sign out */}
      <div className="flex items-center gap-3">
        {(userName || userEmail) && (
          <span className="text-white/50 text-xs hidden sm:block">
            {userName || userEmail}
          </span>
        )}
        <button
          onClick={handleSignOut}
          className="flex items-center gap-1.5 text-white/60 hover:text-white text-xs transition-colors"
        >
          <LogOut size={13} />
          Sign out
        </button>
      </div>
    </nav>
  )
}
