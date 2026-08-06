import { useState } from 'react'
import ConfirmDialog from './ConfirmDialog.jsx'

// A trashcan icon button that always confirms before doing anything
// destructive. Swaps out the plain-text "Delete" links that were easy to
// tap by accident and didn't visually read as destructive.
export default function DeleteButton({
  onConfirm,
  label = 'Delete',
  title,
  message = "This can't be undone.",
  className = 'icon-btn-delete',
  children,
}) {
  const [confirming, setConfirming] = useState(false)

  return (
    <>
      <button
        type="button"
        className={className}
        onClick={(e) => { e.stopPropagation(); setConfirming(true) }}
        aria-label={label}
        title={label}
      >
        <TrashIcon />
        {children}
      </button>
      {confirming && (
        <ConfirmDialog
          title={title || label}
          message={message}
          confirmLabel="Delete"
          onConfirm={() => { setConfirming(false); onConfirm() }}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  )
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  )
}
