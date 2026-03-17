import React from 'react'
import { ArrowRight } from 'lucide-react'

// The New Analysis form is driven by the Chrome extension (it scrapes the listing
// and pre-fills the form). This page is a placeholder that explains the workflow
// and links out to the extension. Full form editing can be added here as needed.

export default function NewAnalysisPage() {
  return (
    <div className="max-w-xl mx-auto px-4 py-10 text-center">
      <div className="text-4xl mb-4">🏘</div>
      <h1 className="text-lg font-bold text-slate-900 mb-2">New Analysis</h1>
      <p className="text-sm text-slate-500 mb-6 max-w-sm mx-auto">
        Open a property listing in Chrome and use the <strong>Ping Analyst</strong> extension
        to auto-fill and run a new analysis. Results will appear in your Deals dashboard.
      </p>
      <div className="card p-5 text-left space-y-3 text-sm text-slate-600">
        <Step n={1} text="Navigate to a Zillow, CoStar, or MLS listing" />
        <Step n={2} text="Open the Ping Analyst side panel" />
        <Step n={3} text="Review the pre-filled details and select an assumptions preset" />
        <Step n={4} text="Click Run Analysis — results will appear here in Deals" />
      </div>
    </div>
  )
}

function Step({ n, text }) {
  return (
    <div className="flex items-start gap-3">
      <span className="shrink-0 w-5 h-5 rounded-full bg-navy text-white text-[10px] font-bold flex items-center justify-center mt-0.5">
        {n}
      </span>
      <span>{text}</span>
    </div>
  )
}
