import { useState } from 'react'
import { supabase } from '../supabaseClient'
import { useToast } from './Toast.jsx'
import useModal from '../useModal.js'

const REASONS = [
  { id: 'spam', label: 'Spam or misleading' },
  { id: 'harassment', label: 'Harassment or abuse' },
  { id: 'inappropriate', label: 'Inappropriate content' },
  { id: 'scam', label: 'Scam or fraud' },
  { id: 'other', label: 'Something else' },
]

// One shared "flag this" button + modal, dropped into any post/job/
// business/profile's action row so reporting looks and behaves
// identically everywhere instead of every feature reinventing it. Writes
// to the `reports` table (see schema-update-28.sql) — an admin reviews
// everything filed here from the new Reports tab in Admin.jsx. Not gated
// behind account approval (unlike posting/messaging): flagging something
// is a safety action, not a content-creation privilege.
export default function ReportButton({ session, entityType, entityId, className = 'post-action', label = 'Report', title = 'Report this' }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [details, setDetails] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [checkingExisting, setCheckingExisting] = useState(false)
  // Whether this person has already filed an open report on this exact
  // entity — there's no DB constraint stopping the same report being
  // filed repeatedly, so this check is what keeps someone (accidentally or
  // otherwise) from flooding the admin queue with duplicates of their own
  // report on the same post/job/business/profile.
  const [alreadyReported, setAlreadyReported] = useState(false)
  const showToast = useToast()

  async function openDialog(e) {
    e.stopPropagation()
    setOpen(true)
    setCheckingExisting(true)
    const { data } = await supabase
      .from('reports')
      .select('id')
      .eq('reporter_id', session.user.id)
      .eq('entity_type', entityType)
      .eq('entity_id', String(entityId))
      .eq('status', 'open')
      .limit(1)
      .maybeSingle()
    setAlreadyReported(!!data)
    setCheckingExisting(false)
  }

  async function submit() {
    if (!reason) return
    setBusy(true)
    const { error } = await supabase.from('reports').insert({
      reporter_id: session.user.id,
      entity_type: entityType,
      entity_id: String(entityId),
      reason,
      details: details.trim(),
    })
    setBusy(false)
    if (error) {
      showToast('Could not submit report.', { type: 'error' })
      return
    }
    setDone(true)
  }

  function close(e) {
    e?.stopPropagation()
    setOpen(false)
    setTimeout(() => { setReason(''); setDetails(''); setDone(false); setAlreadyReported(false) }, 200)
  }

  // Escape, focus trap, focus restore and Back-button close — this dialog
  // was closable by backdrop click only, which is the half of the pair that
  // keyboard users can't reach.
  const modalRef = useModal({ enabled: open, onClose: () => close(), closeOnEscape: !busy })

  return (
    <>
      <button
        type="button"
        className={className}
        onClick={openDialog}
        title={title}
        aria-label={title}
      >
        <FlagIcon />{label && ` ${label}`}
      </button>

      {open && (
        <div className="modal-backdrop" onClick={close} role="dialog" aria-modal="true" aria-label="Report content">
          {/* A real <form> so Enter submits the report — see the note in
              Jobs.jsx. */}
          <form
            className="modal"
            ref={modalRef}
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => { e.preventDefault(); if (!busy && reason && !checkingExisting) submit() }}
            noValidate
            style={{ maxWidth: 420 }}
          >
            <div className="modal-header">
              <h2>{done ? 'Thanks — we got it' : alreadyReported ? "You've already reported this" : 'Report this'}</h2>
              <button type="button" className="modal-close" onClick={close} aria-label="Close">×</button>
            </div>
            <div className="modal-body">
              {checkingExisting ? (
                <p>Checking…</p>
              ) : done ? (
                <p>An admin will take a look. The person you flagged won't be told who reported it.</p>
              ) : alreadyReported ? (
                <p>You already filed a report on this that's still open — an admin hasn't reviewed it yet. No need to submit it again.</p>
              ) : (
                <>
                  <label className="field"><span>What's wrong?</span>
                    <select value={reason} onChange={(e) => setReason(e.target.value)}>
                      <option value="">Choose a reason…</option>
                      {REASONS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                    </select>
                  </label>
                  <label className="field"><span>Anything else? (optional)</span>
                    <textarea value={details} onChange={(e) => setDetails(e.target.value)} rows={3} maxLength={500} />
                  </label>
                </>
              )}
            </div>
            <div className="modal-footer">
              {done || alreadyReported ? (
                <button type="button" className="btn primary" onClick={close}>{done ? 'Done' : 'Close'}</button>
              ) : (
                <>
                  <button type="button" className="btn ghost" onClick={close} disabled={busy}>Cancel</button>
                  <button
                    type="submit"
                    className="btn primary"
                    disabled={busy || !reason || checkingExisting}
                    title={checkingExisting ? 'Checking your existing reports…' : (!reason ? 'Choose a reason first' : undefined)}
                  >
                    {busy ? 'Sending…' : 'Submit report'}
                  </button>
                </>
              )}
            </div>
          </form>
        </div>
      )}
    </>
  )
}

function FlagIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 21V4" />
      <path d="M5 4h13l-3 4 3 4H5" />
    </svg>
  )
}
