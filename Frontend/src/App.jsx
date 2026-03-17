import React, { useState, useEffect } from 'react'
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { isAuthenticated } from './lib/auth'
import TopNav from './components/TopNav'
import LoginPage from './pages/LoginPage'
import NewAnalysisPage from './pages/NewAnalysisPage'
import DealsPage from './pages/DealsPage'
import AssumptionsPage from './pages/AssumptionsPage'

function PrivateRoute({ children }) {
  return isAuthenticated() ? children : <Navigate to="/login" replace />
}

export default function App() {
  const [authed, setAuthed] = useState(isAuthenticated())
  const navigate = useNavigate()

  function handleLogin() {
    setAuthed(true)
    navigate('/deals')
  }

  function handleSignOut() {
    setAuthed(false)
    navigate('/login')
  }

  return (
    <div className="min-h-screen bg-slate-100">
      {authed && <TopNav onSignOut={handleSignOut} />}
      <Routes>
        <Route path="/login" element={<LoginPage onLogin={handleLogin} />} />
        <Route path="/analysis" element={<PrivateRoute><NewAnalysisPage /></PrivateRoute>} />
        <Route path="/deals"    element={<PrivateRoute><DealsPage /></PrivateRoute>} />
        <Route path="/settings" element={<PrivateRoute><AssumptionsPage /></PrivateRoute>} />
        <Route path="*"         element={<Navigate to={authed ? '/deals' : '/login'} replace />} />
      </Routes>
    </div>
  )
}
