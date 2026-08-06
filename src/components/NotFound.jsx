import { useNavigate } from 'react-router-dom'
import EmptyState from './EmptyState.jsx'

// Shown for any URL that doesn't match a real route, instead of silently
// bouncing straight to /home — a mistyped or stale link (an old shared
// /people/:id, a stale bookmark, etc.) should tell the person
// what happened rather than just quietly swapping the page on them.
export default function NotFound() {
  const navigate = useNavigate()
  return (
    <section className="panel">
      <EmptyState
        icon="search"
        message="Page not found."
        subMessage="That link may be mistyped, or the page may have been moved or removed."
        actionLabel="Back to Home"
        onAction={() => navigate('/home', { replace: true })}
      />
    </section>
  )
}
