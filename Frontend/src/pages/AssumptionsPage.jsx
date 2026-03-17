import React, { useState, useEffect } from 'react'
import { Save, Loader2 } from 'lucide-react'
import { fetchSettings, saveSettings } from '../lib/api'

const FIELDS = [
  { key: 'ltv',          label: 'Loan-to-Value (LTV)',      type: 'pct',  help: 'e.g. 0.70 = 70%' },
  { key: 'closing_pct',  label: 'Closing Cost %',           type: 'pct',  help: 'e.g. 0.02 = 2%' },
  { key: 'vacancy',      label: 'Vacancy Rate',             type: 'pct',  help: 'e.g. 0.07 = 7%' },
  { key: 'opex_ratio',   label: 'Operating Expense Ratio',  type: 'pct',  help: 'e.g. 0.35 = 35%' },
  { key: 'int_rate',     label: 'Interest Rate',            type: 'pct',  help: 'e.g. 0.065 = 6.5%' },
  { key: 'rent_growth_1',label: 'Year 1 Rent Growth',       type: 'pct',  help: 'e.g. 0.03 = 3%' },
  { key: 'other_inc_mo', label: 'Other Monthly Income ($)', type: 'usd',  help: 'Per-unit monthly (laundry, parking, etc.)' },
]

export default function AssumptionsPage() {
  const [values,  setValues]  = useState({})
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [saved,   setSaved]   = useState(false)
  const [error,   setError]   = useState('')

  useEffect(() => {
    fetchSettings()
      .then(d => setValues(d.assumptions || d || {}))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  function handleChange(key, val) {
    setValues(prev => ({ ...prev, [key]: val }))
    setSaved(false)
  }

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      // Convert string values to numbers
      const numeric = Object.fromEntries(
        Object.entries(values).map(([k, v]) => [k, parseFloat(v) || 0])
      )
      await saveSettings({ assumptions: numeric })
      setSaved(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="max-w-xl mx-auto px-4 py-10 text-center text-slate-400 text-sm">Loading…</div>

  return (
    <div className="max-w-xl mx-auto px-4 py-7">
      <div className="mb-6">
        <h1 className="text-base font-bold text-slate-900">Assumptions</h1>
        <p className="text-sm text-slate-500 mt-0.5">Default financial assumptions used in every underwriting.</p>
      </div>

      <form onSubmit={handleSave} className="card p-6 space-y-4">
        {FIELDS.map(({ key, label, type, help }) => (
          <div key={key}>
            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1">
              {label}
            </label>
            <input
              className="input"
              type="number"
              step={type === 'pct' ? '0.001' : '1'}
              value={values[key] ?? ''}
              onChange={e => handleChange(key, e.target.value)}
              placeholder={help}
            />
            <p className="text-[11px] text-slate-400 mt-0.5">{help}</p>
          </div>
        ))}

        {error && <p className="text-xs text-red-500">{error}</p>}

        <div className="pt-2 flex items-center gap-3">
          <button type="submit" disabled={saving} className="btn-primary flex items-center gap-2">
            {saving
              ? <><Loader2 size={13} className="animate-spin" /> Saving…</>
              : <><Save size={13} /> Save Assumptions</>
            }
          </button>
          {saved && <span className="text-xs text-emerald-600 font-medium">✓ Saved</span>}
        </div>
      </form>
    </div>
  )
}
