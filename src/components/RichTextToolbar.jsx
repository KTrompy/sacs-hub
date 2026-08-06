import { toggleWrap, toggleBullets } from '../richText.jsx'

// A small formatting toolbar for a <textarea>. Call with a ref to the textarea
// and the current value + setter; it reads the live selection off the DOM node
// (React state can lag a tick behind, so we read textareaRef.current directly).
export default function RichTextToolbar({ textareaRef, value, onChange }) {
  function apply(fn) {
    const el = textareaRef.current
    if (!el) return
    const { selectionStart, selectionEnd } = el
    const result = fn(value, selectionStart, selectionEnd)
    onChange(result.value)
    // Restore focus + selection after React re-renders the textarea.
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(result.start, result.end)
    })
  }

  return (
    <div className="rte-toolbar" role="toolbar" aria-label="Text formatting">
      <button type="button" className="rte-btn" title="Bold" onClick={() => apply((v, s, e) => toggleWrap(v, s, e, '**'))}>
        <strong>B</strong>
      </button>
      <button type="button" className="rte-btn" title="Italic" onClick={() => apply((v, s, e) => toggleWrap(v, s, e, '_'))}>
        <em>i</em>
      </button>
      <button type="button" className="rte-btn" title="Bullet list" onClick={() => apply(toggleBullets)}>
        ≡
      </button>
    </div>
  )
}
