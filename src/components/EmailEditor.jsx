import { useEffect, useRef, useState } from 'react'
import { sanitizeEmailHtml } from '../sanitizeHtml.js'
import { supabase } from '../supabaseClient'

const EMOJI = ['😀', '😂', '😍', '👍', '🙌', '🎉', '☕', '🍺', '🍽️', '🛍️', '💼', '📍', '📞', '✉️', '🌍', '⭐']

const ALIGN_COMMANDS = {
  left: 'justifyLeft',
  center: 'justifyCenter',
  right: 'justifyRight',
  justify: 'justifyFull',
}

export default function EmailEditor({ value, onChange, placeholder, disabled }) {
  const ref = useRef(null)
  const [active, setActive] = useState({ bold: false, italic: false, underline: false, ul: false, ol: false })
  const [showEmoji, setShowEmoji] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState(null)
  const imageFileRef = useRef(null)

  // Seed the contentEditable div with whatever's already in `value` on
  // mount — contentEditable isn't a controlled input, so without this the
  // editor renders blank even when editing a business that already has a
  // description, and the very first keystroke would silently blow away the
  // real content the moment onChange fires with just the new text.
  useEffect(() => {
    if (ref.current) ref.current.innerHTML = value || ''
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Only force the DOM to match `value` when the parent has reset it to
  // empty (e.g. after a successful save) — re-syncing every keystroke would
  // fight the browser's own cursor position.
  useEffect(() => {
    if (value === '' && ref.current && ref.current.innerHTML !== '') {
      ref.current.innerHTML = ''
    }
  }, [value])

  function emitChange() {
    if (!ref.current) return
    onChange(sanitizeEmailHtml(ref.current.innerHTML))
  }

  function updateActiveState() {
    try {
      setActive({
        bold: document.queryCommandState('bold'),
        italic: document.queryCommandState('italic'),
        underline: document.queryCommandState('underline'),
        ul: document.queryCommandState('insertUnorderedList'),
        ol: document.queryCommandState('insertOrderedList'),
      })
    } catch {
      // queryCommandState can throw in odd focus states — safe to ignore.
    }
  }

  function runCommand(cmd, arg = null) {
    if (disabled) return
    ref.current?.focus()
    document.execCommand(cmd, false, arg)
    emitChange()
    updateActiveState()
  }

  function insertLink() {
    if (disabled) return
    const url = window.prompt('Link URL')
    if (!url || !url.trim()) return
    const href = /^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`
    runCommand('createLink', href)
  }

  const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
  const MAX_IMAGE_SIZE = 5 * 1024 * 1024 // 5MB, matches the broadcast-email-images bucket limit

  function pickImage() {
    if (disabled || uploading) return
    imageFileRef.current?.click()
  }

  async function handleImageFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!IMAGE_TYPES.includes(file.type)) {
      setUploadError('Images must be a JPG, PNG or WebP.')
      return
    }
    if (file.size > MAX_IMAGE_SIZE) {
      setUploadError('That image is over 5MB — try a smaller one.')
      return
    }
    setUploadError(null)
    setUploading(true)
    try {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
      const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
      const { error: upErr } = await supabase.storage
        .from('broadcast-email-images')
        .upload(path, file, { upsert: false, contentType: file.type })
      if (upErr) throw upErr
      const { data } = supabase.storage.from('broadcast-email-images').getPublicUrl(path)
      ref.current?.focus()
      document.execCommand('insertImage', false, data.publicUrl)
      emitChange()
    } catch (err) {
      setUploadError(err?.message || "Couldn't upload that image. Please try again.")
    } finally {
      setUploading(false)
    }
  }

  function insertDivider() {
    runCommand('insertHorizontalRule')
  }

  function insertHeading() {
    if (disabled) return
    // Toggle: pick the heading if the cursor isn't already in one, back to
    // a plain paragraph if it is -- so the same button adds and removes it.
    try {
      const block = document.queryCommandValue('formatBlock')
      runCommand('formatBlock', /^h2$/i.test(block) ? 'p' : 'h2')
    } catch {
      runCommand('formatBlock', 'h2')
    }
  }

  function insertEmoji(emoji) {
    if (disabled) return
    runCommand('insertText', emoji)
    setShowEmoji(false)
  }

  function handlePaste(e) {
    e.preventDefault()
    const text = e.clipboardData.getData('text/plain')
    document.execCommand('insertText', false, text)
  }

  return (
    <div className={disabled ? 'rte-editor-wrap rte-editor-wrap-full disabled' : 'rte-editor-wrap rte-editor-wrap-full'}>
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
      <div className="rte-toolbar rte-toolbar-full" role="toolbar" aria-label="Description formatting">
        <div className="rte-toolbar-formats">
          <button type="button" className={active.bold ? 'rte-btn on' : 'rte-btn'} title="Bold" disabled={disabled}
            onMouseDown={(e) => { e.preventDefault(); runCommand('bold') }}>
            <strong>B</strong>
          </button>
          <button type="button" className={active.italic ? 'rte-btn on' : 'rte-btn'} title="Italic" disabled={disabled}
            onMouseDown={(e) => { e.preventDefault(); runCommand('italic') }}>
            <em>i</em>
          </button>
          <button type="button" className={active.underline ? 'rte-btn on' : 'rte-btn'} title="Underline" disabled={disabled}
            onMouseDown={(e) => { e.preventDefault(); runCommand('underline') }}>
            <span style={{ textDecoration: 'underline' }}>U</span>
          </button>

          <span className="toolbar-divider" aria-hidden="true" />

          <button type="button" className="rte-btn" title="Undo" disabled={disabled}
            onMouseDown={(e) => { e.preventDefault(); runCommand('undo') }}>
            <UndoIcon />
          </button>
          <button type="button" className="rte-btn" title="Redo" disabled={disabled}
            onMouseDown={(e) => { e.preventDefault(); runCommand('redo') }}>
            <RedoIcon />
          </button>

          <span className="toolbar-divider" aria-hidden="true" />

          {Object.entries(ALIGN_COMMANDS).map(([key, cmd]) => (
            <button
              key={key}
              type="button"
              className="rte-btn"
              title={`Align ${key}`}
              disabled={disabled}
              onMouseDown={(e) => { e.preventDefault(); runCommand(cmd) }}
            >
              <AlignIcon type={key} />
            </button>
          ))}

          <span className="toolbar-divider" aria-hidden="true" />

          <button type="button" className="rte-btn" title="Decrease indent" disabled={disabled}
            onMouseDown={(e) => { e.preventDefault(); runCommand('outdent') }}>
            <IndentIcon out />
          </button>
          <button type="button" className="rte-btn" title="Increase indent" disabled={disabled}
            onMouseDown={(e) => { e.preventDefault(); runCommand('indent') }}>
            <IndentIcon />
          </button>

          <span className="toolbar-divider" aria-hidden="true" />

          <button type="button" className={active.ul ? 'rte-btn on' : 'rte-btn'} title="Bullet list" disabled={disabled}
            onMouseDown={(e) => { e.preventDefault(); runCommand('insertUnorderedList') }}>
            <BulletListIcon />
          </button>
          <button type="button" className={active.ol ? 'rte-btn on' : 'rte-btn'} title="Numbered list" disabled={disabled}
            onMouseDown={(e) => { e.preventDefault(); runCommand('insertOrderedList') }}>
            <NumberListIcon />
          </button>

          <span className="toolbar-divider" aria-hidden="true" />

          <button type="button" className="rte-btn" title="Insert link" disabled={disabled}
            onMouseDown={(e) => { e.preventDefault(); insertLink() }}>
            <LinkIcon />
          </button>
          <button type="button" className="rte-btn" title="Heading" disabled={disabled}
            onMouseDown={(e) => { e.preventDefault(); insertHeading() }}>
            <span style={{ fontWeight: 700, fontSize: 12 }}>H</span>
          </button>
          <button type="button" className="rte-btn" title="Divider" disabled={disabled}
            onMouseDown={(e) => { e.preventDefault(); insertDivider() }}>
            <DividerIcon />
          </button>
          <button type="button" className="rte-btn" title="Insert image" disabled={disabled || uploading}
            onMouseDown={(e) => { e.preventDefault(); pickImage() }}>
            {uploading ? <span className="rte-btn-spinner" aria-hidden="true" /> : <ImageIcon />}
          </button>
          <input
            ref={imageFileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            style={{ display: 'none' }}
            onChange={handleImageFile}
          />

          <div className="rte-emoji-wrap">
            <button
              type="button"
              className={showEmoji ? 'rte-btn on' : 'rte-btn'}
              title="Insert emoji"
              disabled={disabled}
              onMouseDown={(e) => { e.preventDefault(); setShowEmoji((s) => !s) }}
            >
              🙂
            </button>
            {showEmoji && (
              <div className="rte-emoji-panel" role="menu" aria-label="Emoji">
                {EMOJI.map((em) => (
                  <button
                    key={em}
                    type="button"
                    className="rte-emoji-btn"
                    onMouseDown={(e) => { e.preventDefault(); insertEmoji(em) }}
                  >
                    {em}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      {uploadError && <p className="rte-upload-error">{uploadError}</p>}
    </div>
  )
}

function UndoIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  )
}
function RedoIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
      <path d="M21 3v5h-5" />
    </svg>
  )
}
function AlignIcon({ type }) {
  const lines = {
    left: ['0', '0', '0', '0'],
    center: ['3', '0', '2', '0'],
    right: ['6', '0', '4', '0'],
    justify: ['0', '0', '0', '0'],
  }
  const widths = {
    left: [18, 12, 18, 12],
    center: [18, 12, 18, 12],
    right: [18, 12, 18, 12],
    justify: [18, 18, 18, 18],
  }
  const offs = lines[type] || lines.left
  const ws = widths[type] || widths.left
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1={3 + Number(offs[0])} y1="6" x2={3 + Number(offs[0]) + ws[0]} y2="6" />
      <line x1={3 + Number(offs[1])} y1="11" x2={3 + Number(offs[1]) + ws[1]} y2="11" />
      <line x1={3 + Number(offs[2])} y1="16" x2={3 + Number(offs[2]) + ws[2]} y2="16" />
      <line x1={3 + Number(offs[3])} y1="21" x2={3 + Number(offs[3]) + ws[3]} y2="21" />
    </svg>
  )
}
function IndentIcon({ out = false }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="9" y1="6" x2="21" y2="6" />
      <line x1="9" y1="12" x2="21" y2="12" />
      <line x1="9" y1="18" x2="21" y2="18" />
      {out ? <path d="M6 9l-3 3 3 3" /> : <path d="M3 9l3 3-3 3" />}
    </svg>
  )
}
function BulletListIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="4" cy="6" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="4" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="4" cy="18" r="1.2" fill="currentColor" stroke="none" />
      <line x1="9" y1="6" x2="21" y2="6" />
      <line x1="9" y1="12" x2="21" y2="12" />
      <line x1="9" y1="18" x2="21" y2="18" />
    </svg>
  )
}
function NumberListIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <text x="1.5" y="8.5" fontSize="7" fill="currentColor" stroke="none">1</text>
      <text x="1.5" y="14.5" fontSize="7" fill="currentColor" stroke="none">2</text>
      <text x="1.5" y="20.5" fontSize="7" fill="currentColor" stroke="none">3</text>
      <line x1="9" y1="6" x2="21" y2="6" />
      <line x1="9" y1="12" x2="21" y2="12" />
      <line x1="9" y1="18" x2="21" y2="18" />
    </svg>
  )
}
function LinkIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1.5 1.5" />
      <path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1.5-1.5" />
    </svg>
  )
}

function ImageIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  )
}

function DividerIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="12" x2="21" y2="12" />
    </svg>
  )
}
