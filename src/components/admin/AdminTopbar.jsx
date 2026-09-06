import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAdmin } from './AdminContext.jsx'
import { SearchIcon, MenuIcon, ChevronDown } from './icons.jsx'

const SECTIONS = [
  { to: '/admin/overview', label: 'Overview' },
  { to: '/admin/pending', label: 'Pending' },
  { to: '/admin/members', label: 'Members' },
  { to: '/admin/reports', label: 'Reports' },
  { to: '/admin/posts', label: 'Posts' },
  { to: '/admin/jobs', label: 'Jobs' },
  { to: '/admin/events', label: 'Events' },
  { to: '/admin/businesses', label: 'Businesses' },
  { to: '/admin/orders', label: 'Orders' },
  { to: '/admin/products', label: 'Products' },
  { to: '/admin/legends', label: 'Legends' },
  { to: '/admin/activity', label: 'Activity' },
  { to: '/admin/handbook', label: 'Handbook' },
]

/* A real, if modest, search: it can only find what the Admin shell already
   has loaded (sections, and the member list the sidebar's badges already
   use) — it does not claim to search posts, jobs, orders or reports, since
   none of that is fetched until you open the page it lives on. Picking a
   member jumps to Members with that name prefilled into its own search box,
   rather than half-building a second member list here. */
function useSearchResults(q) {
  const { members } = useAdmin()
  return useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return { sections: [], members: [] }
    return {
      sections: SECTIONS.filter((s) => s.label.toLowerCase().includes(needle)).slice(0, 5),
      members: members
        .filter((m) => [m.full_name, m.email].filter(Boolean).join(' ').toLowerCase().includes(needle))
        .slice(0, 5),
    }
  }, [q, members])
}

export default function AdminTopbar({ onOpenMobileNav }) {
  const navigate = useNavigate()
  const { session, members } = useAdmin()
  const [q, setQ] = useState('')
  const [focused, setFocused] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const results = useSearchResults(q)
  const showResults = focused && q.trim().length > 0

  const me = members.find((m) => m.id === session?.user?.id)
  const displayName = me?.full_name || session?.user?.email || 'Admin'

  function go(to) {
    setQ('')
    setFocused(false)
    navigate(to)
  }

  return (
    <header className="adm-topbar">
      <button type="button" className="adm-topbar-menu-btn" onClick={onOpenMobileNav} aria-label="Open admin navigation">
        <MenuIcon />
      </button>
      <span className="adm-topbar-mobile-title">Admin</span>

      <div className="adm-topbar-search">
        <SearchIcon />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 120)}
          placeholder="Search admin…"
          aria-label="Search admin"
        />
        {showResults && (
          <div className="adm-search-results" role="listbox">
            {results.sections.length === 0 && results.members.length === 0 && (
              <p className="adm-search-empty">No matches.</p>
            )}
            {results.sections.length > 0 && (
              <>
                <span className="adm-search-group-label">Sections</span>
                {results.sections.map((s) => (
                  <button type="button" key={s.to} className="adm-search-result" onMouseDown={() => go(s.to)}>{s.label}</button>
                ))}
              </>
            )}
            {results.members.length > 0 && (
              <>
                <span className="adm-search-group-label">Members</span>
                {results.members.map((m) => (
                  <button
                    type="button"
                    key={m.id}
                    className="adm-search-result"
                    onMouseDown={() => go(`/admin/members?q=${encodeURIComponent(m.full_name || m.email)}`)}
                  >
                    {m.full_name || m.email}
                  </button>
                ))}
              </>
            )}
          </div>
        )}
      </div>

      <div className="adm-topbar-account">
        <button type="button" className="adm-account-btn" onClick={() => setAccountOpen((o) => !o)}>
          {displayName}<ChevronDown />
        </button>
        {accountOpen && (
          <div className="adm-account-menu" onMouseLeave={() => setAccountOpen(false)}>
            {me && (
              <button type="button" onClick={() => { setAccountOpen(false); navigate(`/people/${me.id}`) }}>
                View my profile
              </button>
            )}
            <button type="button" onClick={() => { setAccountOpen(false); navigate('/settings') }}>Settings</button>
            <button type="button" onClick={() => { setAccountOpen(false); navigate('/home') }}>Back to the site</button>
          </div>
        )}
      </div>
    </header>
  )
}
