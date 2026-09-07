import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useToast } from './Toast.jsx'
import useDiscardGuard from './useDiscardGuard.jsx'
import useModal from '../useModal.js'
import { Avatar } from './Directory.jsx'

const MAX_MESSAGE = 4000
const MAX_SUBJECT = 150
// Same lingering delay as ContactModal.jsx, so every "email" action in the
// app feels like the same widget.
const CLOSE_DELAY_MS = 650

// Generalized sibling of ContactModal.jsx. ContactModal is wired specifically
// to member-to-member messaging (send-contact-email, a target profile with
// an id). This component is the same floating compose dialog — subject +
// message, no mail app, nothing stored — for every OTHER place in the app
// that used to be a mailto: link: emailing an admin, nudging a pending
// signup, emailing a business's listed contact address, etc. The caller
// supplies who it's going to (recipientName/avatarUrl, just for display) and
// how to actually send it (onSend), so this file has zero knowledge of which
// Edge Function is behind any given button.
export default function EmailModal({
  eyebrow = 'New message',
  recipientName,
  avatarUrl = null,
  subjectDefault = '',
  messageDefault = '',
  placeholder = 'Write your message…',
  sentToast = 'Email sent.',
  onSend,
  onClose,
}) {
  const showToast = useToast()
  const [subject, setSubject] = useState(subjectDefault)
  const [messageText, setMessageText] = useState(messageDefault)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [sent, setSent] = useState(false)
  const closeTimer = useRef(null)

  useEffect(() => () => clearTimeout(closeTimer.current), [])

  const dirty = !sent && (!!messageText.trim() || subject.trim() !== subjectDefault.trim())

  const { requestClose, discardDialog } = useDiscardGuard({
    dirty: dirty && !busy,
    onDiscard: onClose,
    title: 'Discard this email?',
    message: "What you've written won't be sent.",
    confirmLabel: 'Discard',
  })

  const modalRef = useModal({ onClose: requestClose, closeOnEscape: !busy && !sent })

  const remaining = MAX_MESSAGE - messageText.length
  const counterLow = remaining <= 200

  async function send() {
    if (!messageText.trim()) {
      setError('Write a message before sending.')
      return
    }
    setBusy(true)
    setError(null)
    const { data, error: fnError } = await onSend(subject.trim(), messageText.trim())
    // Same gotcha as ContactModal: supabase-js resolves function errors into
    // `error` rather than rejecting, and the friendly message from our own
    // function body lives in the response context, not on the error object.
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
    showToast(typeof sentToast === 'function' ? sentToast(data) : sentToast)
    closeTimer.current = setTimeout(onClose, CLOSE_DELAY_MS)
  }

  return createPortal(
    <>
      <div className="modal-backdrop" onClick={requestClose} role="dialog" aria-modal="true" aria-labelledby="email-modal-title">
        <form
          className="modal modal-contact"
          ref={modalRef}
          onClick={(e) => e.stopPropagation()}
          onSubmit={(e) => { e.preventDefault(); if (!busy && !sent) send() }}
          noValidate
        >
          <div className="modal-header contact-modal-header">
            <div className="contact-modal-recipient">
              <Avatar url={avatarUrl} name={recipientName} size={40} />
              <div className="contact-modal-recipient-text">
                <span className="contact-modal-eyebrow">{eyebrow}</span>
                <h2 id="email-modal-title">{recipientName}</h2>
              </div>
            </div>
            <button
              type="button"
              className="contact-modal-close"
              onClick={requestClose}
              disabled={sent}
              aria-label="Close"
            >
              <CloseIcon />
            </button>
          </div>

          <div className="modal-body">
            <label className="field contact-modal-subject">
              <span>Subject</span>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value.slice(0, MAX_SUBJECT))}
                maxLength={MAX_SUBJECT}
                disabled={sent}
              />
            </label>

            <label className="field contact-modal-message">
              <span>Message</span>
              <textarea
                className="contact-modal-textarea"
                value={messageText}
                onChange={(e) => setMessageText(e.target.value.slice(0, MAX_MESSAGE))}
                placeholder={placeholder}
                rows={7}
                autoFocus
                disabled={sent}
              />
              <span className={`contact-modal-counter${counterLow ? ' is-low' : ''}`}>
                {messageText.length} / {MAX_MESSAGE}
              </span>
            </label>

            {error && (
              <p className="form-error contact-modal-error">
                <ErrorIcon />
                <span>{error}</span>
              </p>
            )}
          </div>

          <div className="modal-footer contact-modal-footer">
            <button
              type="button"
              className="btn ghost contact-modal-cancel"
              onClick={requestClose}
              disabled={busy || sent}
              title={busy ? 'Wait for the email to finish sending' : undefined}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={`btn primary contact-modal-send${sent ? ' is-sent' : ''}`}
              disabled={busy || sent}
            >
              {sent ? (
                <>
                  <CheckIcon /> Sent
                </>
              ) : busy ? (
                <>
                  <Spinner /> Sending…
                </>
              ) : (
                'Send'
              )}
            </button>
          </div>
        </form>
      </div>
      {discardDialog}
    </>,
    document.body
  )
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="5" y1="5" x2="19" y2="19" />
      <line x1="19" y1="5" x2="5" y2="19" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

function ErrorIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="8" x2="12" y2="13" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  )
}

function Spinner() {
  return <span className="contact-modal-spinner" aria-hidden="true" />
}
