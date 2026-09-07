// The sticky "you have unsaved changes" bar for Edit Profile. Only ever
// rendered while `dirty` is true (Profile.jsx unmounts it otherwise) — the
// page never shows a permanently-visible Save button, per the redesign
// brief. Instant-save toggles (mentoring gates, photo, CV) bypass this
// entirely and are unaffected by it — see Profile.jsx's saveToggle().
export default function SaveBar({ busy, error, onDiscard, onSave }) {
  return (
    <div className="pe-savebar" role="region" aria-label="Unsaved changes">
      <div className="pe-savebar-inner">
        <span className="pe-savebar-text">
          {error ? <span className="pe-savebar-error">{error}</span> : 'You have unsaved changes'}
        </span>
        <div className="pe-savebar-actions">
          <button type="button" className="btn ghost small" onClick={onDiscard} disabled={busy}>
            Discard
          </button>
          <button type="button" className="btn primary small" onClick={onSave} disabled={busy}>
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  )
}
