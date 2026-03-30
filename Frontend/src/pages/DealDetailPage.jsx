import React, { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Download, MapPin } from 'lucide-react'
import { fetchDeals, updateDealStage, dealDownloadUrl } from '../lib/api'
import StageBadge from '../components/StageBadge'

const STAGES = ['New', 'Active', 'Under Review', 'Closed']

function MetricCard({ label, value }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      <div className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-2">{label}</div>
      <div className="text-3xl font-bold text-slate-900">{value}</div>
    </div>
  )
}

function DetailGrid({ items }) {
  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden">
      {items.map(([label, value], i) => (
        <div
          key={label}
          className={`grid grid-cols-2 px-5 py-3.5 ${i !== items.length - 1 ? 'border-b border-slate-100' : ''}`}
        >
          <div className="text-[11px] font-bold text-slate-400 uppercase tracking-widest self-center">{label}</div>
          <div className="text-sm font-medium text-slate-900">{value || '—'}</div>
        </div>
      ))}
    </div>
  )
}

function formatUSD(v) {
  const n = parseFloat(String(v || '').replace(/[^0-9.]/g, ''))
  return isNaN(n) ? '—' : '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

function formatPct(v) {
  if (v == null || isNaN(v)) return '—'
  return `${(parseFloat(v) * 100).toFixed(1)}%`
}

function formatDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

export default function DealDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [deal,    setDeal]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [stage,   setStage]   = useState('')
  const [saving,  setSaving]  = useState(false)

  useEffect(() => {
    fetchDeals()
      .then(data => {
        const deals = Array.isArray(data) ? data : (data.deals || [])
        const found = deals.find(d => d.search_id === id)
        setDeal(found || null)
        setStage(found?.stage || 'New')
      })
      .finally(() => setLoading(false))
  }, [id])

  async function handleStage(e) {
    const s = e.target.value
    setStage(s)
    setSaving(true)
    try { await updateDealStage(id, s) } catch { /* silent */ }
    finally { setSaving(false) }
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400 text-sm">Loading…</div>
  if (!deal) return (
    <div className="max-w-3xl mx-auto px-6 py-10 text-center">
      <p className="text-slate-500">Deal not found.</p>
      <button onClick={() => navigate('/deals')} className="btn-secondary mt-4">Back to Deals</button>
    </div>
  )

  const meta    = deal.search_meta || {}
  const results = deal.results || {}

  // Top metrics
  const coc   = results.coc   ?? results.cash_on_cash   ?? null
  const moic  = results.moic  ?? null
  const irr   = results.irr   ?? null

  // Comp summary data
  const compSummary = deal.comp_summary || results.comp_summary || {}

  const propertyDetails = [
    ['Date',          formatDate(deal.created_at)],
    ['Total Units',   meta.total_units || (meta.combos || []).reduce((s, c) => s + (c.units || 1), 0) || '—'],
    ['Price',         formatUSD(meta.listing_price || meta.price)],
    ['Improvements',  formatUSD(meta.cost || meta.improvements)],
    ['Building SQFT', meta.sqft ? `${Number(meta.sqft).toLocaleString()} sqft` : '—'],
    ['Submitted By',  meta.email || deal.user_email || deal.email || '—'],
  ]

  const compDetails = Object.keys(compSummary).length > 0 ? [
    ['Avg Rent/Unit',   formatUSD(compSummary.avg_rent)],
    ['Avg SQFT',        compSummary.avg_sqft ? `${Math.round(compSummary.avg_sqft)} sqft` : '—'],
    ['Total Comps',     compSummary.count || '—'],
    ['Radius',          meta.radius ? `${meta.radius} mi` : '—'],
  ] : null

  return (
    <div className="max-w-5xl mx-auto px-6 py-7">
      {/* Back */}
      <button
        onClick={() => navigate('/deals')}
        className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-6 transition-colors"
      >
        <ArrowLeft size={15} /> Back to Deals
      </button>

      {/* Title */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 mb-1">
          {meta.address || deal.address || 'Deal Detail'}
        </h1>
        <div className="text-sm font-mono text-slate-500">{deal.search_id}</div>
        <div className="text-xs text-slate-400 uppercase tracking-widest mt-1">
          Timestamp: {deal.created_at || '—'}
        </div>
      </div>

      {/* Top Metrics */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <MetricCard label="Avg COC"  value={coc  !== null ? formatPct(coc)  : '—'} />
        <MetricCard label="MOIC"     value={moic !== null ? `${Number(moic).toFixed(1)}x` : '—'} />
        <MetricCard label="IRR"      value={irr  !== null ? formatPct(irr)  : '—'} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Property Details */}
          <section>
            <h2 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-3">Property Details</h2>
            <DetailGrid items={propertyDetails} />
          </section>

          {/* Comp Summary */}
          {compDetails && (
            <section>
              <h2 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-3">Comp Summary</h2>
              <DetailGrid items={compDetails} />
            </section>
          )}

          {/* Assumptions Snapshot */}
          {deal.assumptions_snapshot && Object.keys(deal.assumptions_snapshot).length > 0 && (
            <section>
              <h2 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-3">
                Assumptions{deal.preset_name ? ` — ${deal.preset_name}` : ''}
              </h2>
              <DetailGrid items={[
                ['LTV',                 deal.assumptions_snapshot.ltv != null ? (deal.assumptions_snapshot.ltv * 100).toFixed(1) + '%' : '—'],
                ['Vacancy Rate',        deal.assumptions_snapshot.vacancy != null ? (deal.assumptions_snapshot.vacancy * 100).toFixed(1) + '%' : '—'],
                ['Interest Rate',       deal.assumptions_snapshot.intRate != null ? (deal.assumptions_snapshot.intRate * 100).toFixed(2) + '%' : '—'],
                ['Closing Cost %',      deal.assumptions_snapshot.closingPct != null ? (deal.assumptions_snapshot.closingPct * 100).toFixed(1) + '%' : '—'],
                ['Operating Expense %', deal.assumptions_snapshot.opexRatio != null ? (deal.assumptions_snapshot.opexRatio * 100).toFixed(1) + '%' : '—'],
                ['Year 1 Rent Growth',  deal.assumptions_snapshot.rentGrowth1 != null ? (deal.assumptions_snapshot.rentGrowth1 * 100).toFixed(1) + '%' : '—'],
                ['Other Monthly Income',deal.assumptions_snapshot.otherIncMo != null ? '$' + Number(deal.assumptions_snapshot.otherIncMo).toLocaleString() : '—'],
              ].filter(([, v]) => v !== '—')} />
            </section>
          )}

          {/* Financial Results */}
          {Object.keys(results).length > 0 && (
            <section>
              <h2 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-3">Financial Results</h2>
              <DetailGrid items={[
                ['Cap Rate',    results.cap_rate ? formatPct(results.cap_rate) : '—'],
                ['NOI',         formatUSD(results.noi)],
                ['Monthly CF',  formatUSD(results.monthly_cash_flow)],
                ['Loan Amount', formatUSD(results.loan_amount)],
                ['Down Payment',formatUSD(results.down_payment)],
                ['DSCR',        results.dscr ? Number(results.dscr).toFixed(2) : '—'],
              ].filter(([, v]) => v !== '—')} />
            </section>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Stage */}
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Stage</div>
            <select
              value={stage}
              onChange={handleStage}
              disabled={saving}
              className="input mb-2"
            >
              {STAGES.map(s => <option key={s}>{s}</option>)}
            </select>
            {saving && <p className="text-xs text-slate-400">Saving…</p>}
          </div>

          {/* Preset */}
          {deal.preset_name && (
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Assumptions Preset</div>
              <span className="text-xs bg-blue-50 text-blue-700 border border-blue-200 px-2.5 py-1 rounded-full font-medium">
                {deal.preset_name}
              </span>
            </div>
          )}

          {/* Downloads */}
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Downloads</div>
            <div className="space-y-2">
              <a
                href={dealDownloadUrl(id, 'excel')}
                target="_blank" rel="noreferrer"
                className="flex items-center gap-2 w-full px-3 py-2.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg text-sm font-medium hover:bg-emerald-100 transition-colors"
              >
                <Download size={13} /> Excel Model
              </a>
              <a
                href={dealDownloadUrl(id, 'word')}
                target="_blank" rel="noreferrer"
                className="flex items-center gap-2 w-full px-3 py-2.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg text-sm font-medium hover:bg-blue-100 transition-colors"
              >
                <Download size={13} /> Word Summary
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
