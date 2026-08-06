import { useSearchParams } from 'react-router-dom'
import Directory from './Directory.jsx'
import AlumniMap from './AlumniMap.jsx'
import { useDirectoryFilters, DirectoryToolbar, DirectoryFilterPanel } from './DirectoryFilters.jsx'

// Directory and the alumni map both answer the same question — "find an
// Old Boy" — so they live under one nav item with a view toggle instead
// of splitting "search for a person" and "browse a map of people" into two
// separate places to check. The chosen view is kept in the URL (?view=map)
// so a link to it is shareable and survives a refresh.
//
// Search/filters live here (one `useDirectoryFilters` instance) rather than
// inside Directory or AlumniMap individually, so toggling List ↔ Map keeps
// whatever you'd searched or filtered for instead of resetting it.
export default function People({ session, onMessage, onGoToProfile, refetchTrigger }) {
  const [params, setParams] = useSearchParams()
  const view = params.get('view') === 'map' ? 'map' : 'list'
  const f = useDirectoryFilters(session, refetchTrigger)

  function setView(next) {
    const p = new URLSearchParams(params)
    if (next === 'list') p.delete('view')
    else p.set('view', next)
    setParams(p, { replace: true })
  }

  return (
    <section className="panel people-page">
      <div className="panel-header-row">
        <div>
          <h2 className="panel-title">Old Boys</h2>
          <p className="panel-sub">
            {view === 'list' ? 'Old Boys, out in the world.' : 'Where are we all now?'}
          </p>
        </div>
        <div className="view-switch" role="tablist" aria-label="Old Boys view">
          <button type="button" role="tab" aria-selected={view === 'list'} className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>
            <ListViewIcon /> List
          </button>
          <button type="button" role="tab" aria-selected={view === 'map'} className={view === 'map' ? 'on' : ''} onClick={() => setView('map')}>
            <MapViewIcon /> Map
          </button>
        </div>
      </div>

      <DirectoryToolbar f={f} />

      <div className="directory-layout">
        <div className="directory-main">
          {view === 'list'
            ? <Directory session={session} people={f.filtered} loading={f.loading} me={f.me} onMessage={onMessage} hideHeader />
            : <AlumniMap session={session} people={f.filtered} loading={f.loading} onMessage={onMessage} onGoToProfile={onGoToProfile} hideHeader />}
        </div>
        <DirectoryFilterPanel f={f} />
      </div>
    </section>
  )
}

function ListViewIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 6h13M8 12h13M8 18h13" />
      <path d="M3 6h.01M3 12h.01M3 18h.01" />
    </svg>
  )
}
function MapViewIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 4.5L3.5 6.7v13l5.5-2.2 6 2.2 5.5-2.2v-13L15 6.7l-6-2.2z" />
      <path d="M9 4.5v13.2M15 6.7v13.2" />
    </svg>
  )
}
