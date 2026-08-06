import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { CATEGORY_LABEL, LEGEND_FIELDS, legendMeta } from './Legends.jsx'
import LoadingState from './LoadingState.jsx'
import EmptyState from './EmptyState.jsx'

// One legend's own page — what used to be a modal opened from the Home band
// (or the Hall grid) now has a real URL, so it's shareable and gets a
// browser "back" for free instead of a close button.
export default function LegendProfile() {
  const { legendId } = useParams()
  const navigate = useNavigate()
  const [legend, setLegend] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const { data, error } = await supabase
        .from('legends')
        .select(LEGEND_FIELDS)
        .eq('id', legendId)
        .eq('active', true)
        .maybeSingle()
      if (cancelled) return
      if (error) console.error(error)
      setLegend(data || null)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [legendId])

  if (loading) return <section className="panel"><LoadingState message="Loading…" /></section>

  if (!legend) {
    return (
      <section className="panel">
        <button type="button" className="profile-back-btn" onClick={() => navigate('/legends')}>‹ Notable Old Boys</button>
        <EmptyState icon="search" message="Couldn't find that person." subMessage="They may have been unpublished." actionLabel="Back to Notable Old Boys" onAction={() => navigate('/legends')} />
      </section>
    )
  }

  const meta = legendMeta(legend)
  // Story is stored as plain text, so paragraph breaks are blank lines. Split
  // rather than white-space: pre-wrap so the spacing between paragraphs is the
  // stylesheet's decision, not the typist's — same approach the old modal used.
  const paragraphs = (legend.story || '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)

  return (
    <section className="panel legend-profile-page">
      <button type="button" className="profile-back-btn" onClick={() => navigate('/legends')}>‹ Notable Old Boys</button>

      <div className="legend-profile-card">
        <div className="legend-modal-photo legend-profile-photo">
          <img src={legend.photo_url} alt={`Portrait of ${legend.name}`} />
        </div>
        <h1 className="legend-profile-name">{legend.name}</h1>
        <div className="legend-modal-meta">
          <span className={`legend-pill legend-pill-${legend.category}`}>
            {CATEGORY_LABEL[legend.category] || 'SACS'}
          </span>
          {meta && <span className="legend-modal-years">{meta}</span>}
        </div>
        <p className="legend-modal-headline">{legend.headline}</p>
        {paragraphs.map((p, i) => <p className="legend-modal-story" key={i}>{p}</p>)}
        {legend.link_url && (
          /* rel="noopener noreferrer" because this URL is typed in by an
             admin and points off-site — without it the destination gets a
             handle on our window via window.opener. */
          <a className="legend-modal-link" href={legend.link_url} target="_blank" rel="noopener noreferrer">
            {legend.link_label || 'Read more'} <ArrowRightIcon />
          </a>
        )}
      </div>
    </section>
  )
}

function ArrowRightIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <path d="M5 12h14" />
      <path d="M13 6l6 6-6 6" />
    </svg>
  )
}
