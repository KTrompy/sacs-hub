import { useEffect, useRef, useState } from 'react'
import { sanitizeHtml } from '../sanitizeHtml.js'

// A small What-You-See-Is-What-You-Get editor: a contentEditable region with
// Bold / Italic / Bullet buttons, built on document.execCommand. That API is
// old and technically deprecated, but every current browser still supports
// the handful of commands we use, and it avoids pulling in a large editor
// framework for three buttons.
//
// Safety: paste is forced to plain text (so no one can paste in arbitrary
// HTML from Word or a webpage), and every keystroke's HTML is run through
// DOMPurify with a tight whitelist before it's handed to the parent. The
// same sanitizer runs again at render time as a second line of defence.
// Posts/group posts are stored with a `char_length(content) between 1 and
// 4000` check constraint (see schema.sql) on the sanitized HTML that
// actually gets saved — so the counter below counts `value`'s length
// (already-sanitized HTML), the same string the database check applies to,
// rather than the plain-text length a person is actually typing.
const DEFAULT_MAX_LENGTH = 4000

export default function RichTextEditor({ value, onChange, placeholder, disabled, toolbarExtra, maxLength = DEFAULT_MAX_LENGTH }) {
  const ref = useRef(null)
  const [active, setActive] = useState({ bold: false, italic: false, list: false })

  // Only force the DOM to match `value` when the parent has reset it to
  // empty (e.g. after a successful post). Re-syncing on every keystroke
  // would fight the browser's own cursor position.
  useEffect(() => {
    if (value === '' && ref.current && ref.current.innerHTML !== '') {
      ref.current.innerHTML = ''
    }
  }, [value])

  function emitChange() {
    if (!ref.current) return
    onChange(sanitizeHtml(ref.current.innerHTML))
  }

  const length = (value || '').length
  const overLimit = length > maxLength

  function updateActiveState() {
    try {
      setActive({
        bold: document.queryCommandState('bold'),
        italic: document.queryCommandState('italic'),
        list: document.queryCommandState('insertUnorderedList'),
      })
    } catch {
      // queryCommandState can throw in odd focus states — safe to ignore.
    }
  }

  function runCommand(cmd) {
    if (disabled) return
    ref.current?.focus()
    document.execCommand(cmd, false, null)
    emitChange()
    updateActiveState()
  }

  function handlePaste(e) {
    e.preventDefault()
    const text = e.clipboardData.getData('text/plain')
    document.execCommand('insertText', false, text)
  }

  return (
    <div className={disabled ? 'rte-editor-wrap disabled' : 'rte-editor-wrap'}>
      <div
        ref={ref}
        className="rte-editor"
        contentEditable={!disabled}
        suppressContentEditableWarning
        data-placeholder={placeholder}
        onInput={emitChange}
        onPaste={handlePaste}
        onKeyUp={updateActiveState}
        onMouseUp={updateActiveState}
        onFocus={updateActiveState}
      />
      <div className="rte-toolbar" role="toolbar" aria-label="Text formatting">
        <div className="rte-toolbar-formats">
          <button
            type="button"
            className={active.bold ? 'rte-btn on' : 'rte-btn'}
            title="Bold"
            disabled={disabled}
            onMouseDown={(e) => { e.preventDefault(); runCommand('bold') }}
          >
            <strong>B</strong>
          </button>
          <button
            type="button"
            className={active.italic ? 'rte-btn on' : 'rte-btn'}
            title="Italic"
            disabled={disabled}
            onMouseDown={(e) => { e.preventDefault(); runCommand('italic') }}
          >
            <em>i</em>
          </button>
          <button
            type="button"
            className={active.list ? 'rte-btn on' : 'rte-btn'}
            title="Bullet list"
            disabled={disabled}
            onMouseDown={(e) => { e.preventDefault(); runCommand('insertUnorderedList') }}
          >
            ≡
          </button>
        </div>
        {toolbarExtra && <div className="rte-toolbar-extra">{toolbarExtra}</div>}
        <span className={overLimit ? 'rte-char-count over' : 'rte-char-count'}>
          {length}/{maxLength}
        </span>
      </div>
    </div>
  )
}
