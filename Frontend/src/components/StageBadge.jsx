import React from 'react'

const stageStyles = {
  New:      'bg-sky-50 text-sky-700 border border-sky-200',
  Review:   'bg-amber-50 text-amber-700 border border-amber-300',
  Offer:    'bg-purple-50 text-purple-700 border border-purple-200',
  Contract: 'bg-blue-50 text-blue-700 border border-blue-200',
  Closed:   'bg-emerald-50 text-emerald-700 border border-emerald-200',
  Pass:     'bg-slate-50 text-slate-400 border border-slate-200',
}

export default function StageBadge({ stage }) {
  const cls = stageStyles[stage] || stageStyles.New
  return (
    <span className={`stage-badge ${cls}`}>{stage}</span>
  )
}
