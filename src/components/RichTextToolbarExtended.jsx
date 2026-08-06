import { toggleWrap, toggleBullets } from '../richText.jsx'
import { toggleStrikethrough, toggleHeaders, insertLink } from '../richTextExtended.jsx'

export default function RichTextToolbarExtended({ textareaRef, value, onChange }) {
  function apply(fn) {
    const el = textareaRef.current
    if (!el) return
    const { selectionStart, selectionEnd } = el
    const result = fn(value, selectionStart, selectionEnd)
    onChange(result.value)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(result.start, result.end)
    })
  }

  function handleLink() {
    const el = textareaRef.current
    if (!el) return
    const url = prompt('Enter URL:', 'https://')
    if (url !== null) {
      apply((v, s, e) => insertLink(v, s, e, url))
    }
  }

  return (
    <div className="rte-toolbar" role="toolbar" aria-label="Text formatting">
      <button
        type="button"
        className="rte-btn"
        title="Bold"
        onClick={() => apply((v, s, e) => toggleWrap(v, s, e, '**'))}
      >
        <strong>B</strong>
      </button>
      <button
        type="button"
        className="rte-btn"
        title="Italic"
        onClick={() => apply((v, s, e) => toggleWrap(v, s, e, '_'))}
      >
        <em>i</em>
      </button>
      <button
        type="button"
        className="rte-btn"
        title="Strikethrough"
        onClick={() => apply(toggleStrikethrough)}
      >
        <s>S</s>
      </button>
      <button
        type="button"
        className="rte-btn"
        title="Header"
        onClick={() => apply(toggleHeaders)}
      >
        H
      </button>
      <button
        type="button"
        className="rte-btn"
        title="Bullet list"
        onClick={() => apply(toggleBullets)}
      >
        ≡
      </button>
      <button
        type="button"
        className="rte-btn"
        title="Link"
        onClick={handleLink}
      >
        🔗
      </button>
    </div>
  )
}
