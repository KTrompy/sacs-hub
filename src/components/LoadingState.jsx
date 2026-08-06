// Shown while the first fetch for a panel is still in flight, so a slow
// network doesn't briefly look like "no old boys"/"no listings" before
// data actually arrives.
export default function LoadingState({ message = 'Loading…' }) {
  return (
    <div className="loading-state">
      <span className="loading-spinner" aria-hidden="true" />
      <p className="loading-state-message">{message}</p>
    </div>
  )
}
