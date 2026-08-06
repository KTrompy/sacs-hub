import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { LEGEND_FIELDS, LegendTile, shuffled } from './Legends.jsx'
import LoadingState from './LoadingState.jsx'
import EmptyState from './EmptyState.jsx'

// The full "Hoek van Helde" page — everyone an admin has curated, not just
// this week's three. Reached from the Home band's "See others" link (and
// bookmarkable/shareable on its own, unlike the old in-place cycling it
// replaced).
export default function LegendsHall() {
  const navigate = useNavigate()
  const [legends, setLegends] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const { data, error } = await supabase
        .from('legends')
        .select(LEGEND_FIELDS)
        .eq('active', true)
      if (cancelled) return
      if (error) console.error(error)
      setLegends(data || [])
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [])

  // Fresh shuffle every time this page loads, same as the Home band —
  // reordered once per fetch (not on every render), so the grid doesn't
  // reshuffle itself while you're looking at it.
  const order = useMemo(() => shuffled(legends), [legends])

  return (
    <section className="panel legends-hall-page">
      <button type="button" className="profile-back-btn" onClick={() => navigate('/home')}>‹ Home</button>

      <div className="legends-hall-head">
        <h2 className="legends-hall-title">Notable Old Boys</h2>
        <p className="legends-hall-sub">Old Boys who've made their mark — on the field, in business, in public life, and beyond.</p>
      </div>

      {loading ? (
        <LoadingState message="Loading Notable Old Boys…" />
      ) : order.length === 0 ? (
        <EmptyState icon="search" message="No entries curated yet." subMessage="Check back soon." />
      ) : (
        <div className="legends-hall-grid">
          {order.map((l) => <LegendTile key={l.id} legend={l} />)}
        </div>
      )}
    </section>
  )
}
