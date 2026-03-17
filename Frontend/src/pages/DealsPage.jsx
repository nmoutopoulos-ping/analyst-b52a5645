import React, { useState, useEffect, useMemo } from 'react'
import { Search, Download, ChevronDown } from 'lucide-react'
import { fetchDeals, updateDealStage, dealDownloadUrl } from '../lib/api'
import StageBadge from '../components/StageBadge'

const STAGES = ['New', 'Review', 'Offer', 'Contract', 'Closed', 'Pass']

function formatUSD(v) {
  const n = parseFloat(String(v).replace(/[^0-9.]/g, ''))
  return isNaN(n) ? '—' : '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

function formatDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function DealModal({ deal, onClose, onStageChange }) {
  const [stage, setStage] = useState(deal.stage || 'New')
  const [saving, setSaving] = useState(false)

  async function handleStage(e) {
    const s = e.target.value
    setStage(s)
    setSaving(true)
    try { await updateDealStage(deal.search_id, s); onStageChange(deal.search_id, s) }
    catch { /* silent */ }
    finally { setSaving(false) }
  }

  const meta = deal.search_meta || {}
  const results = deal.results || {}

  return (
    <div
      className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="p-5 border-b border-slate-100 flex items-start justify-between gap-3">
          <div>
            <div className="font-bold text-base text-slate-900">{meta.address || deal.address || '—'}</div>
            <div className="text-[11px] text-slate-400 font-mono mt-0.5">{deal.search_id}</div>
          </div>
          <button onClick={onClose} className="shrink-0 w-7 h-7 rounded-md border border-slate-200 bg-slate-50 hover:bg-slate-100 flex items-center justify-center text-slate-500 text-base">×</button>
        </div>

        <div className="p-5 space-y-5">
          {/* Stage */}
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Stage</div>
            <div className="flex items-center gap-3">
              <select
                value={stage}
                onChange={handleStage}
                disabled={saving}
                className="input w-auto"
              >
                {STAGES.map(s => <option key={s}>{s}</option>)}
              </select>
              {saving && <span className="text-xs text-slate-400">Saving…</span>}
            </div>
          </div>

          {/* Key Metrics */}
          {Object.keys(results).length > 0 && (
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Key Metrics</div>
              <div className="grid grid-cols-2 gap-2">
                {[
                  ['Purchase Price', formatUSD(meta.listing_price)],
                  ['Units', meta.total_units || '—'],
                  ['Cap Rate', results.cap_rate ? `${(results.cap_rate * 100).toFixed(2)}%` : '—'],
                  ['Cash-on-Cash', results.coc ? `${(results.coc * 100).toFixed(2)}%` : '—'],
                  ['NOI', formatUSD(results.noi)],
                  ['Monthly CF', formatUSD(results.monthly_cash_flow)],
                ].map(([label, val]) => (
                  <div key={label} className="bg-slate-50 rounded-lg p-3">
                    <div className="text-[10px] text-slate-400 mb-0.5">{label}</div>
                    <div className="font-semibold text-sm text-slate-900">{val}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Assumptions */}
          {deal.preset_name && (
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Assumptions</div>
              <span className="text-xs bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-full font-medium">
                {deal.preset_name}
              </span>
            </div>
          )}

          {/* Downloads */}
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Downloads</div>
            <div className="flex gap-2 flex-wrap">
              <a
                href={dealDownloadUrl(deal.search_id, 'excel')}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg text-xs font-medium hover:bg-emerald-100 transition-colors"
              >
                <Download size={12} /> Excel
              </a>
              <a
                href={dealDownloadUrl(deal.search_id, 'word')}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg text-xs font-medium hover:bg-blue-100 transition-colors"
              >
                <Download size={12} /> Word
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function DealsPage() {
  const [deals,     setDeals]     = useState([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState('')
  const [query,     setQuery]     = useState('')
  const [selected,  setSelected]  = useState(null)

  useEffect(() => {
    fetchDeals()
      .then(d => setDeals(Array.isArray(d) ? d : (d.deals || [])))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const filtered = useMemo(() => {
    if (!query) return deals
    const q = query.toLowerCase()
    return deals.filter(d => {
      const addr = (d.search_meta?.address || d.address || '').toLowerCase()
      const id   = (d.search_id || '').toLowerCase()
      return addr.includes(q) || id.includes(q)
    })
  }, [deals, query])

  function handleStageChange(searchId, stage) {
    setDeals(prev => prev.map(d => d.search_id === searchId ? { ...d, stage } : d))
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-7">
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4 gap-3">
        <h1 className="text-base font-bold text-slate-900">Deals</h1>
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            className="input pl-8 w-64"
            placeholder="Search address or ID…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-slate-400 text-sm">Loading deals…</div>
        ) : error ? (
          <div className="p-10 text-center text-red-500 text-sm">{error}</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <div className="text-2xl mb-2">🏘</div>
            <div className="font-semibold text-slate-600 mb-1">No deals yet</div>
            <div className="text-xs text-slate-400">Run an analysis from the extension to get started.</div>
          </div>
        ) : (
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                {['ID', 'Address', 'Date', 'Price', 'Units', 'Stage'].map(h => (
                  <th key={h} className="bg-slate-50 text-slate-400 font-bold text-[10px] uppercase tracking-[0.6px] px-3.5 py-2.5 text-left border-b border-slate-100 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(deal => {
                const meta = deal.search_meta || {}
                return (
                  <tr
                    key={deal.search_id}
                    onClick={() => setSelected(deal)}
                    className="cursor-pointer hover:bg-slate-50 transition-colors border-b border-slate-100 last:border-0"
                  >
                    <td className="px-3.5 py-3 font-mono text-[11px] font-semibold text-navy">{deal.search_id}</td>
                    <td className="px-3.5 py-3">
                      <div className="font-medium text-slate-900 max-w-[220px] truncate">{meta.address || deal.address || '—'}</div>
                      <div className="text-[11px] text-slate-400 mt-0.5">{meta.city || ''}</div>
                    </td>
                    <td className="px-3.5 py-3 text-slate-500 whitespace-nowrap">{formatDate(deal.created_at)}</td>
                    <td className="px-3.5 py-3 text-slate-700 whitespace-nowrap">{formatUSD(meta.listing_price)}</td>
                    <td className="px-3.5 py-3 text-slate-500">{meta.total_units || '—'}</td>
                    <td className="px-3.5 py-3"><StageBadge stage={deal.stage || 'New'} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {selected && (
        <DealModal
          deal={selected}
          onClose={() => setSelected(null)}
          onStageChange={handleStageChange}
        />
      )}
    </div>
  )
}
