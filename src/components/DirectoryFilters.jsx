import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import { COUNTRIES, INDUSTRIES, INDUSTRY_KEYWORDS, SA_CITIES, SERVICES_OFFERED } from '../constants.js'
import MultiSelectAutocomplete from './MultiSelectAutocomplete.jsx'
import { useIsWide } from '../utils.js'

// Shared by both Old Boys views (List = Directory.jsx, Map = AlumniMap.jsx)
// so switching between them doesn't reset your search/filters — People.jsx
// owns one instance of this hook and hands the filtered list to whichever
// view is currently showing, same toolbar and "Filter by" panel either way.

export const EMPTY_FILTERS = {
  name: '',
  yearFrom: '',
  yearTo: '',
  countries: [],
  industries: [],
  services: [],
  mentoringOnly: false,
  classOf: [],
  occupations: [],
  provinces: [],
  schoolRelationship: [], // currentParent, currentStaffMember, oldBoy, pastParent, pastStaffMember
}

const QUICK_TABS = [
  { id: 'all', label: 'All' },
  { id: 'location', label: 'My Location' },
  { id: 'industry', label: 'My Industry' },
  { id: 'mentors', label: 'Mentors' },
]

const PEOPLE_SELECT = 'id, full_name, grad_year, degree, occupation, industry, company, city, country, ' +
  'bio, avatar_url, linkedin_url, approved, lat, lng, last_seen, ' +
  'expertise, services_offered, business_website, looking_to_connect, ' +
  'availability, geographic_focus, is_open_to_opportunities, created_at, experience'

export function useDirectoryFilters(session, refetchTrigger) {
  const [people, setPeople] = useState([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [draftFilters, setDraftFilters] = useState(EMPTY_FILTERS)
  const [filterOpen, setFilterOpen] = useState(false)
  const [quickTab, setQuickTab] = useState('all')
  const isWide = useIsWide(900)

  async function fetchPeople() {
    setLoading(true)
    // approved only. Without this filter the Old Boys list and the
    // alumni map showed every pending signup — including the ones that only
    // got as far as the Google button, which have no name yet and rendered
    // as blank cards. Home.jsx already filtered this way; the directory
    // didn't. (The RLS policies added in schema-update-46 stop *unapproved
    // members* reading the directory at all; this is the other direction —
    // keeping unapproved people out of what approved members see.)
    const { data } = await supabase
      .from('profiles')
      .select(PEOPLE_SELECT)
      .eq('approved', true)
      .order('grad_year', { ascending: false, nullsFirst: false })
    setPeople(data || [])
    setLoading(false)
  }

  useEffect(() => { fetchPeople() }, [])
  useEffect(() => { if (refetchTrigger) fetchPeople() }, [refetchTrigger])

  useEffect(() => {
    if (!filterOpen || isWide) return
    // Plain `overflow: hidden` on body isn't enough on mobile Safari — it
    // still lets the page rubber-band/scroll behind the drawer via touch.
    // Pinning body to `position: fixed` at its current scroll offset is the
    // standard fix; we restore the exact scroll position on close so the
    // page doesn't jump.
    const scrollY = window.scrollY
    const body = document.body
    const prev = { overflow: body.style.overflow, position: body.style.position, top: body.style.top, width: body.style.width }
    body.style.overflow = 'hidden'
    body.style.position = 'fixed'
    body.style.top = `-${scrollY}px`
    body.style.width = '100%'
    function onKey(e) { if (e.key === 'Escape') setFilterOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => {
      body.style.overflow = prev.overflow
      body.style.position = prev.position
      body.style.top = prev.top
      body.style.width = prev.width
      window.scrollTo(0, scrollY)
      document.removeEventListener('keydown', onKey)
    }
  }, [filterOpen, isWide])

  const decadeOptions = useMemo(() => {
    const years = people.map((p) => p.grad_year).filter(Boolean)
    if (years.length === 0) return []
    const startDecade = Math.floor(Math.min(...years) / 10) * 10
    const endDecade = Math.floor(Math.max(...years) / 10) * 10
    const out = []
    for (let d = startDecade; d <= endDecade; d += 10) out.push(d)
    return out
  }, [people])

  function setDraft(k, v) { setDraftFilters((f) => ({ ...f, [k]: v })); setQuickTab(null) }
  function openFilterPanel() { setDraftFilters(filters); setFilterOpen(true) }
  function applyDraftFilters() { setFilters(draftFilters); setFilterOpen(false) }
  function clearDraftFilters() { setDraftFilters(EMPTY_FILTERS) }
  function clearAllFilters() {
    setFilters(EMPTY_FILTERS); setDraftFilters(EMPTY_FILTERS); setQ(''); setQuickTab('all')
  }

  function toggleDecade(startYear) {
    const isActive = Number(draftFilters.yearFrom) === startYear && Number(draftFilters.yearTo) === startYear + 9
    if (isActive) { setDraft('yearFrom', ''); setDraft('yearTo', '') }
    else {
      setDraftFilters((f) => ({ ...f, yearFrom: String(startYear), yearTo: String(startYear + 9) }))
      setQuickTab(null)
    }
  }

  const needle = q.trim().toLowerCase()
  function matches(p, f) {
    if (needle) {
      const hay = [p.full_name, p.occupation, p.company, p.city, p.industry, String(p.grad_year || '')]
        .join(' ').toLowerCase()
      if (!hay.includes(needle)) return false
    }
    if (f.name && !(p.full_name || '').toLowerCase().includes(f.name.trim().toLowerCase())) return false
    if (f.yearFrom && (!p.grad_year || p.grad_year < Number(f.yearFrom))) return false
    if (f.yearTo && (!p.grad_year || p.grad_year > Number(f.yearTo))) return false
    if (f.countries.length && !f.countries.includes(p.country)) return false
    if (f.industries.length && !f.industries.includes(p.industry)) return false
    if (f.services.length && !(p.services_offered || []).some((s) => f.services.includes(s))) return false
    if (f.mentoringOnly && !p.is_open_to_opportunities) return false
    if (f.classOf.length && !f.classOf.includes(p.grad_year?.toString())) return false
    if (f.occupations.length && !(p.occupation || '').split(',').map((s) => s.trim().toLowerCase()).some((occ) => f.occupations.some((fOcc) => occ.includes(fOcc.toLowerCase())))) return false
    if (f.provinces.length && !f.provinces.includes(p.province)) return false
    if (f.schoolRelationship.length) {
      const hasRelationship = f.schoolRelationship.some((rel) => {
        if (rel === 'current-parent' && p.is_current_parent === true) return true
        if (rel === 'current-staff' && p.is_current_staff === true) return true
        if (rel === 'old-boy' && p.is_old_boy === true) return true
        if (rel === 'past-parent' && p.is_past_parent === true) return true
        if (rel === 'past-staff' && p.is_past_staff === true) return true
        return false
      })
      if (!hasRelationship) return false
    }
    return true
  }

  const me = useMemo(() => people.find((p) => p.id === session.user.id), [people, session.user.id])
  const effectiveFilters = isWide ? draftFilters : filters

  function applyQuickTab(id) {
    setQuickTab(id)
    let next = EMPTY_FILTERS
    if (id === 'location' && me?.country) next = { ...EMPTY_FILTERS, countries: [me.country] }
    else if (id === 'industry' && me?.industry) next = { ...EMPTY_FILTERS, industries: [me.industry] }
    else if (id === 'mentors') next = { ...EMPTY_FILTERS, mentoringOnly: true }
    setFilters(next); setDraftFilters(next); setQ('')
  }

  const filtered = useMemo(() => people.filter((p) => matches(p, effectiveFilters)), [people, effectiveFilters, needle])
  const previewCount = useMemo(() => people.filter((p) => matches(p, draftFilters)).length, [people, draftFilters, needle])

  function countActive(f) {
    return Object.entries(f).filter(([k, v]) => {
      if (Array.isArray(v)) return v.length > 0
      if (typeof v === 'boolean') return v
      return Boolean(v)
    }).length
  }
  const activeFilterCount = countActive(effectiveFilters)
  const draftActiveFilterCount = countActive(draftFilters)

  return {
    people, loading, me, q, setQ, quickTab, applyQuickTab,
    filters, draftFilters, setDraft, filterOpen, setFilterOpen, openFilterPanel,
    applyDraftFilters, clearDraftFilters, clearAllFilters, toggleDecade, decadeOptions,
    isWide, filtered, previewCount, activeFilterCount, draftActiveFilterCount,
  }
}

/* ---------- Toolbar: search + quick tabs (shared by List and Map) ---------- */
export function DirectoryToolbar({ f }) {
  return (
    <>
      <div className="directory-toolbar">
        <div className="search-wrap">
          <input
            className="search directory-search"
            value={f.q}
            onChange={(e) => f.setQ(e.target.value)}
            placeholder="Search by name, company, city…"
          />
          {f.q && <button type="button" className="search-clear" onClick={() => f.setQ('')} aria-label="Clear search">×</button>}
        </div>
        {!f.isWide && (
          <button type="button" className="filters-toggle-btn" onClick={f.openFilterPanel}>
            <FilterIcon />
            Filters
            {f.activeFilterCount > 0 && <span className="filters-toggle-badge">{f.activeFilterCount}</span>}
          </button>
        )}
      </div>

      <div className="quick-tabs" role="tablist" aria-label="Quick filters">
        {QUICK_TABS.map((t) => (
          <button type="button"
            key={t.id}
            role="tab"
            aria-selected={f.quickTab === t.id}
            className={f.quickTab === t.id ? 'quick-tab on' : 'quick-tab'}
            onClick={() => f.applyQuickTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
    </>
  )
}

/* ---------- Filter panel: persistent sidebar (wide) or slide-in drawer (narrow) ---------- */
export function DirectoryFilterPanel({ f }) {
  const fields = (
    <>
      <FilterSection title="Name">
        <div className="input-clear-wrap">
          <input
            type="text"
            placeholder="Search by name"
            value={f.draftFilters.name}
            onChange={(e) => f.setDraft('name', e.target.value)}
          />
          {f.draftFilters.name && <button type="button" className="search-clear" onClick={() => f.setDraft('name', '')} aria-label="Clear name">×</button>}
        </div>
      </FilterSection>

      <FilterSection title="Industry">
        <MultiSelectAutocomplete
          options={INDUSTRIES}
          keywords={INDUSTRY_KEYWORDS}
          values={f.draftFilters.industries}
          onChange={(v) => f.setDraft('industries', v)}
          placeholder="All industries — start typing to add one"
        />
      </FilterSection>


      <FilterSection title="Class year" defaultOpen={false}>
        {f.decadeOptions.length > 0 && (
          <div className="filter-radio-row decade-row">
            {f.decadeOptions.map((d) => {
              const active = Number(f.draftFilters.yearFrom) === d && Number(f.draftFilters.yearTo) === d + 9
              return <button type="button" key={d} className={active ? 'on' : ''} onClick={() => f.toggleDecade(d)}>{decadeLabel(d)}</button>
            })}
          </div>
        )}
        <div className="filter-year-row">
          <div className="input-clear-wrap">
            <input type="number" placeholder="From" value={f.draftFilters.yearFrom} onChange={(e) => f.setDraft('yearFrom', e.target.value)} />
            {f.draftFilters.yearFrom && <button type="button" className="search-clear" onClick={() => f.setDraft('yearFrom', '')} aria-label="Clear from year">×</button>}
          </div>
          <span aria-hidden="true">–</span>
          <div className="input-clear-wrap">
            <input type="number" placeholder="To" value={f.draftFilters.yearTo} onChange={(e) => f.setDraft('yearTo', e.target.value)} />
            {f.draftFilters.yearTo && <button type="button" className="search-clear" onClick={() => f.setDraft('yearTo', '')} aria-label="Clear to year">×</button>}
          </div>
        </div>
        {/* An inverted range can never match anything, and used to just
            return a silent zero results with no clue why. */}
        {f.draftFilters.yearFrom && f.draftFilters.yearTo
          && Number(f.draftFilters.yearFrom) > Number(f.draftFilters.yearTo) && (
          <p className="form-error filter-year-error" role="alert">
            The &ldquo;from&rdquo; year is after the &ldquo;to&rdquo; year, so nothing can match.
          </p>
        )}
      </FilterSection>

      <FilterSection title="Skills & services" defaultOpen={false}>
        <MultiSelectAutocomplete
          options={SERVICES_OFFERED}
          values={f.draftFilters.services}
          onChange={(v) => f.setDraft('services', v)}
          placeholder="Any service — start typing to add one"
        />
      </FilterSection>

      <FilterSection title="Class of" defaultOpen={false}>
        <div className="filter-checkbox-list">
          {f.decadeOptions.map((d) => (
            <label key={d} className="checkbox-label">
              <input
                type="checkbox"
                checked={f.draftFilters.classOf.includes(d.toString())}
                onChange={(e) => {
                  const val = d.toString()
                  const isChecked = e.target.checked
                  const newClassOf = isChecked
                    ? [...f.draftFilters.classOf, val]
                    : f.draftFilters.classOf.filter((x) => x !== val)
                  f.setDraft('classOf', newClassOf)
                }}
              />
              {decadeLabel(d)}
            </label>
          ))}
        </div>
      </FilterSection>

      <FilterSection title="Country" defaultOpen={false}>
        <MultiSelectAutocomplete
          options={COUNTRIES}
          values={f.draftFilters.countries}
          onChange={(v) => f.setDraft('countries', v)}
          placeholder="All countries — start typing to add one"
        />
      </FilterSection>

      <FilterSection title="Occupation" defaultOpen={false}>
        <div className="input-clear-wrap">
          <input
            type="text"
            placeholder="Search occupations"
            value={f.draftFilters.occupations.join(', ')}
            onChange={(e) => f.setDraft('occupations', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
          />
          {f.draftFilters.occupations.length > 0 && (
            <button type="button" className="search-clear" onClick={() => f.setDraft('occupations', [])} aria-label="Clear occupations">×</button>
          )}
        </div>
      </FilterSection>

      <FilterSection title="School Relationship" defaultOpen={false}>
        <div className="filter-checkbox-list">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={f.draftFilters.schoolRelationship.includes('current-parent')}
              onChange={(e) => {
                const val = 'current-parent'
                const isChecked = e.target.checked
                const newRels = isChecked
                  ? [...f.draftFilters.schoolRelationship, val]
                  : f.draftFilters.schoolRelationship.filter((x) => x !== val)
                f.setDraft('schoolRelationship', newRels)
              }}
            />
            Current Parent
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={f.draftFilters.schoolRelationship.includes('current-staff')}
              onChange={(e) => {
                const val = 'current-staff'
                const isChecked = e.target.checked
                const newRels = isChecked
                  ? [...f.draftFilters.schoolRelationship, val]
                  : f.draftFilters.schoolRelationship.filter((x) => x !== val)
                f.setDraft('schoolRelationship', newRels)
              }}
            />
            Current Staff Member
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={f.draftFilters.schoolRelationship.includes('old-boy')}
              onChange={(e) => {
                const val = 'old-boy'
                const isChecked = e.target.checked
                const newRels = isChecked
                  ? [...f.draftFilters.schoolRelationship, val]
                  : f.draftFilters.schoolRelationship.filter((x) => x !== val)
                f.setDraft('schoolRelationship', newRels)
              }}
            />
            Old Boy
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={f.draftFilters.schoolRelationship.includes('past-parent')}
              onChange={(e) => {
                const val = 'past-parent'
                const isChecked = e.target.checked
                const newRels = isChecked
                  ? [...f.draftFilters.schoolRelationship, val]
                  : f.draftFilters.schoolRelationship.filter((x) => x !== val)
                f.setDraft('schoolRelationship', newRels)
              }}
            />
            Past Parent
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={f.draftFilters.schoolRelationship.includes('past-staff')}
              onChange={(e) => {
                const val = 'past-staff'
                const isChecked = e.target.checked
                const newRels = isChecked
                  ? [...f.draftFilters.schoolRelationship, val]
                  : f.draftFilters.schoolRelationship.filter((x) => x !== val)
                f.setDraft('schoolRelationship', newRels)
              }}
            />
            Past Staff Member
          </label>
        </div>
      </FilterSection>

      <FilterSection title="Province" defaultOpen={false}>
        <MultiSelectAutocomplete
          options={SA_CITIES.map((city) => city.split(',')[1]?.trim()).filter(Boolean)}
          values={f.draftFilters.provinces}
          onChange={(v) => f.setDraft('provinces', v)}
          placeholder="All provinces — start typing to add one"
        />
      </FilterSection>

    </>
  )

  if (f.isWide) {
    return (
      <aside className="filter-panel persistent" aria-label="Filter Old Boys">
        <div className="filter-panel-header"><h3><FilterIcon /> Filter by</h3></div>
        {fields}
        <div className="filter-panel-footer static">
          <button type="button" className="filter-clear" onClick={f.clearAllFilters}>Reset</button>
        </div>
      </aside>
    )
  }

  if (!f.filterOpen) return null
  return (
    <>
      <div className="filter-backdrop" onClick={() => f.setFilterOpen(false)} />
      <aside className="filter-panel open" aria-label="Filter alumni">
        <div className="filter-panel-header">
          <h3>Filter · {f.draftActiveFilterCount || 'none'}</h3>
          <button type="button" className="modal-close" onClick={() => f.setFilterOpen(false)} aria-label="Close filters">×</button>
        </div>
        {fields}
        <div className="filter-panel-footer">
          <button type="button" className="filter-clear" onClick={f.clearDraftFilters}>Clear all filters</button>
          <button type="button" className="btn primary wide" onClick={f.applyDraftFilters}>
            Show {f.previewCount} {f.previewCount === 1 ? 'result' : 'results'}
          </button>
        </div>
      </aside>
    </>
  )
}

function FilterSection({ title, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={open ? 'filter-section open' : 'filter-section'}>
      <button type="button" className="filter-section-header" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span>{title}</span>
        <span className="chev" aria-hidden="true">▸</span>
      </button>
      {open && <div className="filter-section-body">{children}</div>}
    </div>
  )
}

function decadeLabel(d) { return d < 2000 ? `’${String(d).slice(2)}s` : `${d}s` }

function FilterIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 6h16M7 12h10M10 18h4" />
    </svg>
  )
}
