import { useEffect, useState } from 'react'
import { supabase } from '../../supabaseClient'
import { PageHeader, MetricGrid, Skeleton } from './ui.jsx'
import { normalizeExpertise } from '../../utils.js'

// The mentoring programme is now just a directory + email intro, so there's
// no lifecycle to report on (no requests, no sessions) — just how many
// Old Boys have opted in and how many currently show up. Reads straight
// from `profiles` rather than a dedicated RPC, same as every other simple
// count on this dashboard, and never touches anything a mentor wrote in
// free text beyond counting whether they wrote something.
export default function MentoringPage() {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    supabase
      .from('profiles')
      .select('is_open_to_opportunities, mentor_paused, expertise, mentor_note')
      .then(({ data, error }) => {
        if (!alive) return
        if (error) setError(error.message)
        else setRows(data || [])
        setLoading(false)
      })
    return () => { alive = false }
  }, [])

  if (loading) return (<><PageHeader title="Mentoring" description="Who's registered as a mentor, and how many currently show up in the directory." /><Skeleton rows={2} /></>)

  if (error) {
    return (
      <>
        <PageHeader title="Mentoring" />
        <p className="form-error">Couldn't load mentoring stats — {error}</p>
      </>
    )
  }

  const mentors = (rows || []).filter((r) => r.is_open_to_opportunities)
  const available = mentors.filter((m) => !m.mentor_paused)
  const withDescription = mentors.filter((m) => (m.mentor_note || '').trim().length > 0)

  const categoryCounts = new Map()
  for (const m of mentors) {
    for (const c of normalizeExpertise(m.expertise)) categoryCounts.set(c, (categoryCounts.get(c) || 0) + 1)
  }
  const topCategories = Array.from(categoryCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5)

  return (
    <>
      <PageHeader title="Mentoring" description="Who's registered as a mentor, and how many currently show up in the directory." />
      <MetricGrid
        metrics={[
          { label: 'Registered mentors', value: mentors.length, hint: 'Have turned on "I can help others".' },
          { label: 'Currently available', value: available.length, hint: 'Show up in the active directory right now.' },
          { label: 'Not currently available', value: mentors.length - available.length, hint: 'Registered, but paused for now.' },
          { label: 'Wrote a description', value: withDescription.length, hint: 'Filled in "Anything else you\'d like people to know?"' },
        ]}
      />
      {topCategories.length > 0 && (
        <div style={{ marginTop: 'var(--sp-6)' }}>
          <h3 style={{ margin: '0 0 8px' }}>Most common areas</h3>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {topCategories.map(([c, n]) => <li key={c}>{c} — {n}</li>)}
          </ul>
        </div>
      )}
    </>
  )
}
