// A friendlier empty state than a single line of muted text. `icon` picks one
// of a few simple line-art illustrations; `message` and `subMessage` are
// copy. `actionLabel`/`onAction` add an optional CTA button so an empty
// state is a nudge toward doing something, not a dead end.
export default function EmptyState({ icon = 'feed', message, subMessage, actionLabel, onAction }) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">{ICONS[icon] || ICONS.feed}</div>
      <p className="empty-state-message">{message}</p>
      {subMessage && <p className="empty-state-sub">{subMessage}</p>}
      {actionLabel && onAction && (
        <button type="button" className="btn primary small empty-state-action" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  )
}

const ICONS = {
  feed: (
    <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="10" y="16" width="44" height="34" rx="4" stroke="currentColor" strokeWidth="2.5" />
      <path d="M10 24h44" stroke="currentColor" strokeWidth="2.5" />
      <path d="M18 32h20M18 39h28" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  ),
  events: (
    <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="10" y="14" width="44" height="38" rx="4" stroke="currentColor" strokeWidth="2.5" />
      <path d="M10 24h44" stroke="currentColor" strokeWidth="2.5" />
      <path d="M20 10v8M44 10v8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="22" cy="34" r="2.5" fill="currentColor" />
      <circle cx="32" cy="34" r="2.5" fill="currentColor" />
      <circle cx="42" cy="34" r="2.5" fill="currentColor" />
      <circle cx="22" cy="43" r="2.5" fill="currentColor" />
    </svg>
  ),
  jobs: (
    <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="9" y="22" width="46" height="30" rx="4" stroke="currentColor" strokeWidth="2.5" />
      <path d="M23 22v-5a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v5" stroke="currentColor" strokeWidth="2.5" />
      <path d="M9 32h46" stroke="currentColor" strokeWidth="2.5" />
      <rect x="27" y="29" width="10" height="6" rx="1.5" fill="currentColor" />
    </svg>
  ),
  search: (
    <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="28" cy="28" r="15" stroke="currentColor" strokeWidth="2.5" />
      <path d="M39 39l14 14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  ),
  business: (
    <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M8 26L32 10l24 16" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="13" y="26" width="38" height="28" rx="2" stroke="currentColor" strokeWidth="2.5" />
      <path d="M27 54V40a5 5 0 0 1 10 0v14" stroke="currentColor" strokeWidth="2.5" />
      <path d="M20 33h4M40 33h4M20 41h4M40 41h4" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  ),
}
