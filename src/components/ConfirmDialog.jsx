import { createPortal } from 'react-dom'
import useModal from '../useModal.js'

// A styled stand-in for window.confirm() — same modal chrome as ProfileModal,
// so a destructive action gets an on-brand prompt instead of the browser's
// native confirm() dialog.
//
// Rendered via a portal into document.body rather than in place. DeleteButton
// (and therefore this dialog) often gets mounted deep inside list rows —
// e.g. Jobs.jsx's .job-card, which has a `transform` on :hover for the lift
// effect. A CSS transform on any ancestor creates a new containing block for
// `position: fixed` children, so without the portal this dialog would get
// sized/positioned relative to that hovered card instead of the viewport
// (squished, clipped, or jumping the moment the mouse left the card). Portaling
// to <body> sidesteps that entirely, regardless of where the button lives.
export default function ConfirmDialog({
  title = 'Are you sure?',
  message,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}) {
  // history: false — this dialog is a transient answer-and-go prompt, not a
  // view worth a Back-button stop. It also frequently unmounts in the same
  // tick as the modal underneath it (confirm a discard and both disappear),
  // and two overlapping history pops in one frame is a good way to eat a
  // Back press.
  const modalRef = useModal({ onClose: onCancel, history: false })

  return createPortal(
    <div className="modal-backdrop" onClick={onCancel} role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title">
      <div className="modal modal-confirm" ref={modalRef} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 id="confirm-dialog-title">{title}</h2>
          <button type="button" className="modal-close" onClick={onCancel} aria-label="Close">×</button>
        </div>
        {message && (
          <div className="modal-body">
            <p>{message}</p>
          </div>
        )}
        <div className="modal-footer">
          {/* data-autofocus on Cancel, not Confirm — an accidental Enter
              right after the dialog appears should land on the safe half of
              a destructive choice. */}
          <button type="button" className="btn ghost" data-autofocus onClick={onCancel}>{cancelLabel}</button>
          <button type="button" className="btn danger" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>,
    document.body
  )
}
