import { useCallback, useState } from 'react'
import ConfirmDialog from './ConfirmDialog.jsx'

// Stops a half-written post/job/business/event from vanishing on a stray
// click.
//
// Every composer in the app used to close straight to nothing the moment
// you clicked the backdrop — type four hundred words, mis-click two pixels
// outside the box, and it was gone with no warning and no undo. The app
// already treated *deleting* something as worth confirming (DeleteButton →
// ConfirmDialog everywhere), while destroying unsaved work took one
// mis-aimed click. This closes that gap using the same dialog.
//
// Usage:
//   const { requestClose, discardDialog } = useDiscardGuard({
//     dirty: hasUnsavedInput,
//     onDiscard: closeAndReset,
//   })
//   …
//   <div className="modal-backdrop" onClick={requestClose}>…</div>
//   {discardDialog}
//
// requestClose() closes immediately when nothing has been typed, so the
// common case (open, look, close) is unchanged — the prompt only appears
// when there's actually something to lose.
export default function useDiscardGuard({
  dirty,
  onDiscard,
  title = 'Discard this draft?',
  message = "Anything you've typed here will be lost. This can't be undone.",
  confirmLabel = 'Discard',
  cancelLabel = 'Keep editing',
}) {
  const [asking, setAsking] = useState(false)

  const requestClose = useCallback(() => {
    if (dirty) { setAsking(true); return }
    onDiscard()
  }, [dirty, onDiscard])

  const discardDialog = asking ? (
    <ConfirmDialog
      title={title}
      message={message}
      confirmLabel={confirmLabel}
      cancelLabel={cancelLabel}
      onConfirm={() => { setAsking(false); onDiscard() }}
      onCancel={() => setAsking(false)}
    />
  ) : null

  return { requestClose, discardDialog, asking }
}
