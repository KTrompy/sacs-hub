import { useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../supabaseClient'
import { useToast } from './Toast.jsx'
import useDiscardGuard from './useDiscardGuard.jsx'
import useModal from '../useModal.js'

const MAX_MESSAGE = 4000
const MAX_SUBJECT = 150

// Replaces the old floating real-time DM widget. Every "Message" button in
// the app still calls the same onMessage(targetProfile, draftText) it always
// did (see App.jsx's openMessage) — the only thing that changed is what
// opens: instead of a chat thread backed by a `messages` table, this is a
// one-shot compose dialog that relays a single email through Resend
// (send-contact-email). Nothing here is stored — there's no history to come
// back to, so closing this loses the draft, same as closing a real email.
export default function ContactModal({ target, draftText, profile, onClose }) {
  const showToast = useToast()
  const [subject, setSubject] = useState(
    () => `Message from ${profile?.full_name || 'a fellow Old Boy'} via SACS Alumni Hub`
  )
  const [messageText, setMessageText] = useState(draftText || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [sent, setSent] = useState(false)

  const dirty = !sent && (!!messageText.trim() || subject.trim() !== '')

  const { requestClose, discardDialog } = useDiscardGuard({
    dirty: dirty && !busy,
    onDiscard: onClose,
    title: 'Discard this email?',
    message: "What you've written won't be sent.",
    confirmLabel: 'Discard',
  })

  const modalRef = useModal({ onClose: requestClose, closeOnEscape: !busy })

  const firstName = (target?.full_name || '').trim().split(/\s+/)[0] || 'this member'

  async function send() {
    if (!messageText.trim()) {
      setError('Write a message before sending.')
      return
    }
    setBusy(true)
    setError(null)
    const { data, error: fnError } = await supabase.functions.invoke('send-contact-email', {
      body: {
        recipient_id: target.id,
        subject: subject.trim(),
        message: messageText.trim(),
      },
    })
    // supabase-js resolves function errors into `error` rather than
    // rejecting, but the friendly message from our own function body is
    // inside the response context, not on the error object — same gotcha
    // as everywhere else in this app that calls .functions.invoke().
    if (fnError || data?.error) {
      const friendly =
        data?.error ||
        (fnError?.message?.includes('Failed to fetch')
          ? "Couldn't reach the email service — check your connection and try again."
          : fnError?.message) ||
        "Couldn't send that email. Please try again."
      setError(friendly)
      setBusy(false)
      return
    }
    setSent(true)
    showToast(`Email sent to ${firstName}.`)
    onClose()
  }

  return createPortal(
    <>
      <div className="modal-backdrop" onClick={requestClose} role="dialog" aria-modal="true" aria-labelledby="contact-modal-title">
        <form
          className="modal modal-contact"
          ref={modalRef}
          onClick={(e) => e.stopPropagation()}
          onSubmit={(e) => { e.preventDefault(); if (!busy) send() }}
          noValidate
        >
          <div className="modal-header">
            <h2 id="contact-modal-title">Email {target?.full_name || 'member'}</h2>
            <button type="button" className="modal-close" onClick={requestClose} aria-label="Close">×</button>
          </div>

          <div className="modal-body">
            <label className="field">
              <span>Subject</span>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value.slice(0, MAX_SUBJECT))}
                maxLength={MAX_SUBJECT}
              />
            </label>

            <label className="field">
              <span>Message</span>
              <textarea
                className="apply-modal-textarea"
                value={messageText}
                onChange={(e) => setMessageText(e.target.value.slice(0, MAX_MESSAGE))}
                placeholder={`Write your message to ${firstName}…`}
                rows={6}
                autoFocus
              />
              <span className="apply-modal-counter">{messageText.length} / {MAX_MESSAGE}</span>
            </label>

            {error && <p className="form-error">{error}</p>}
          </div>

          <div className="modal-footer">
            <button
              type="button"
              className="btn ghost"
              onClick={requestClose}
              disabled={busy}
              title={busy ? 'Wait for the email to finish sending' : undefined}
            >
              Cancel
            </button>
            <button type="submit" className="btn primary" disabled={busy} title={busy ? 'Sending…' : undefined}>
              {busy ? 'Sending…' : 'Send'}
            </button>
          </div>
        </form>
      </div>
      {discardDialog}
    </>,
    document.body
  )
}
