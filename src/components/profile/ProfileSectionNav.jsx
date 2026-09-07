// Section navigation for the Edit Profile page. One component, two looks:
// a sticky left sidebar on desktop, a horizontally-scrollable pill row
// ("jump to section") on mobile — the same markup, styled differently per
// breakpoint in styles.css (.pe-nav), rather than two separate components
// with logic that could drift apart.
export default function ProfileSectionNav({ sections, activeId, onNavigate }) {
  return (
    <nav className="pe-nav" aria-label="Profile sections">
      <ul className="pe-nav-list">
        {sections.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              className={s.id === activeId ? 'pe-nav-item active' : 'pe-nav-item'}
              onClick={() => onNavigate(s.id)}
              aria-current={s.id === activeId ? 'true' : undefined}
            >
              {s.hasMissing && <span className="pe-nav-dot" aria-hidden="true" />}
              {s.label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}
