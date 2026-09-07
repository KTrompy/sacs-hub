import { useEffect, useState } from 'react'
import { supabase } from '../../supabaseClient'
import { PageHeader, MetricGrid, Skeleton } from './ui.jsx'

// Aggregate programme health only — counts and a median, nothing about who
// asked what or what any conversation contained. mentoring_admin_stats()
// enforces the same admin-only check server-side (belt and braces with the
// route already being admin-gated), and there is deliberately no query here
// that could pull an individual mentorship_connections.message or
// mentorship_sessions.notes value onto this page.
export default function MentoringPage() {
  const [stats, setStats] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    supabase.rpc('mentoring_admin_stats').then(({ data, error }) => {
      if (!alive) return
      if (error) setError(error.message)
      else setStats(data?.[0] || null)
      setLoading(false)
    })
    return () => { alive = false }
  }, [])

  if (loading) return (<><PageHeader title="Mentoring" description="Programme-wide health — never the content of any conversation." /><Skeleton rows={3} /></>)

  if (error) {
    return (
      <>
        <PageHeader title="Mentoring" />
        <p className="form-error">Couldn't load mentoring stats — {error}</p>
      </>
    )
  }

  const s = stats || {}

  return (
    <>
      <PageHeader title="Mentoring" description="Programme-wide health — never the content of any conversation." />
      <MetricGrid
        metrics={[
          { label: 'Looking for guidance', value: s.seeking_guidance_count, hint: 'Members with "seeking guidance" turned on.' },
          { label: 'Offering guidance', value: s.offering_guidance_count, hint: 'Members open to helping others.' },
          { label: 'Quick questions asked', value: s.questions_sent, hint: 'Total, all time.' },
          { label: 'Quick questions answered', value: s.questions_answered, hint: 'Of those asked.' },
          { label: 'Conversations arranged', value: s.conversations_arranged, hint: 'A time was suggested and accepted.' },
          { label: 'Mentorship requests', value: s.mentorship_requests, hint: 'Total, all time.' },
          { label: 'Mentorships started', value: s.mentorships_accepted, hint: 'Requests that became active.' },
          { label: 'Active now', value: s.active_mentorships },
          { label: 'Completed', value: s.completed_mentorships },
          { label: 'Inactive 45+ days', value: s.inactive_mentorships, tone: (s.inactive_mentorships > 0 ? 'action' : undefined), hint: "Active mentorships that have gone quiet — no one's fault, just worth a nudge." },
          { label: 'Median length', value: s.median_duration_days ? `${Math.round(s.median_duration_days)} days` : '–', hint: 'From start to end, for mentorships that have ended.' },
        ]}
      />
    </>
  )
}
