import { useEffect, useRef, useState } from 'react'
import { supabase, deleteStorageFilesFromUrls } from '../../supabaseClient'
import { LEGEND_CATEGORIES } from '../Legends.jsx'
import { useToast } from '../Toast.jsx'
import EmptyState from '../EmptyState.jsx'
import DeleteButton from '../DeleteButton.jsx'
import { useAdmin } from './AdminContext.jsx'
import { PageHeader, Skeleton } from './ui.jsx'

const MAX_LEGEND_PHOTO_SIZE = 5 * 1024 * 1024
const LEGEND_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const EMPTY_LEGEND = { name: '', years: '', degree: '', category: 'sport', headline: '', story: '', photo_url: '', link_url: '', link_label: '', active: true }

function truncate(text, n = 140) {
  if (!text) return ''
  return text.length > n ? `${text.slice(0, n).trim()}…` : text
}

/* The home page's hall of fame. Editorial rows rather than a plain table —
   this is content the admin writes, not records to scan — and a dedicated
   full-page editor for the same reason Products gets one: story, photo and
   link together are too much for a modal. */
export default function LegendsPage() {
  const [legends, setLegends] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)
  const showToast = useToast()
  const { session } = useAdmin()

  async function load() {
    const { data, error } = await supabase.from('legends').select('*').order('sort_order', { ascending: true }).order('created_at', { ascending: true })
    if (error) showToast("Couldn't load entries.", { type: 'error' })
    setLegends(data || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  async function toggleActive(l) {
    const { error } = await supabase.from('legends').update({ active: !l.active }).eq('id', l.id)
    if (error) { showToast("Couldn't update that.", { type: 'error' }); return }
    setLegends((prev) => prev.map((x) => (x.id === l.id ? { ...x, active: !x.active } : x)))
  }
  async function remove(l) {
    const { error } = await supabase.from('legends').delete().eq('id', l.id)
    if (error) { showToast("Couldn't delete that.", { type: 'error' }); return }
    if (l.photo_url) deleteStorageFilesFromUrls('legend-photos', l.photo_url)
    setLegends((prev) => prev.filter((x) => x.id !== l.id))
  }
  // Renumbers sort_order for the whole list from the array index rather than
  // swapping the two rows' values — see ProductsPage-era note carried over:
  // an upsert of a partial {id, sort_order} payload fails NOT NULL checks
  // before Postgres ever reaches the conflict target, so this does one
  // UPDATE per row instead.
  async function move(index, delta) {
    const target = index + delta
    if (target < 0 || target >= legends.length) return
    const next = [...legends]
    ;[next[index], next[target]] = [next[target], next[index]]
    setLegends(next)
    const results = await Promise.all(next.map((l, i) => supabase.from('legends').update({ sort_order: i }).eq('id', l.id)))
    if (results.some((r) => r.error)) { showToast("Couldn't save the new order.", { type: 'error' }); load() }
  }

  if (editing) {
    return <LegendEditor session={session} initial={editing} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} />
  }

  return (
    <>
      <PageHeader
        title="Legends"
        description="Three entries show on the home page at a time, chosen by the week so everyone sees the same set. Add at least six before it stops repeating. Order here decides which trio comes up first."
        action={<button type="button" className="btn primary small" onClick={() => setEditing(EMPTY_LEGEND)}>Add someone</button>}
      />

      {loading ? (
        <Skeleton rows={3} />
      ) : legends.length === 0 ? (
        <EmptyState icon="people" message="No one added yet." subMessage="Old boys worth remembering — Springboks, founders, cabinet ministers, anyone whose name still comes up." />
      ) : (
        <ul className="adm-legend-rows">
          {legends.map((l, i) => (
            <li className="adm-legend-row" key={l.id}>
              {l.photo_url ? <img className="adm-legend-row-thumb" src={l.photo_url} alt="" /> : <div className="adm-legend-row-thumb empty" />}
              <div className="adm-legend-row-info">
                <span className="adm-legend-row-name">{l.name}{!l.active && <span className="adm-badge adm-badge-neutral" style={{ marginLeft: 8 }}>Hidden</span>}</span>
                <span className="adm-content-preview">
                  {(LEGEND_CATEGORIES.find((c) => c.key === l.category)?.label) || l.category}{l.years ? ` · ${l.years}` : ''} · {truncate(l.headline, 80)}
                </span>
              </div>
              <div className="adm-legend-row-actions">
                <button type="button" className="btn ghost small" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${l.name} up`} title="Move up">↑</button>
                <button type="button" className="btn ghost small" onClick={() => move(i, 1)} disabled={i === legends.length - 1} aria-label={`Move ${l.name} down`} title="Move down">↓</button>
                <button type="button" className="btn ghost small" onClick={() => toggleActive(l)}>{l.active ? 'Hide' : 'Show'}</button>
                <button type="button" className="btn ghost small" onClick={() => setEditing(l)}>Edit</button>
                <DeleteButton onConfirm={() => remove(l)} label="Delete entry" message="This removes the write-up and the photo for good. Hide is the reversible option." />
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

function LegendEditor({ session, initial, onCancel, onSaved }) {
  const [form, setForm] = useState({ ...EMPTY_LEGEND, ...initial })
  const [photoFile, setPhotoFile] = useState(null)
  const [preview, setPreview] = useState(initial.photo_url || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const fileRef = useRef(null)
  const showToast = useToast()
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  useEffect(() => {
    if (!photoFile) return
    const url = URL.createObjectURL(photoFile)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [photoFile])

  function pickPhoto(e) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    if (!LEGEND_PHOTO_TYPES.includes(f.type)) { setError('Photo must be a JPG, PNG or WebP.'); return }
    if (f.size > MAX_LEGEND_PHOTO_SIZE) { setError('Photo is over 5MB.'); return }
    setError(null)
    setPhotoFile(f)
  }

  async function uploadPhoto() {
    const ext = photoFile.name.split('.').pop().toLowerCase()
    const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
    const { error: upErr } = await supabase.storage.from('legend-photos').upload(path, photoFile, { upsert: false, contentType: photoFile.type })
    if (upErr) throw upErr
    const { data } = supabase.storage.from('legend-photos').getPublicUrl(path)
    return data.publicUrl
  }

  async function save(e) {
    e.preventDefault()
    if (!form.name.trim()) { setError('Give the person a name.'); return }
    if (!form.headline.trim()) { setError('Add the one-line claim to fame — it’s what the tile shows.'); return }
    if (!photoFile && !form.photo_url) { setError('A photo is required — the tile is built around it.'); return }
    setSaving(true)
    setError(null)
    try {
      let photoUrl = form.photo_url
      if (photoFile) {
        photoUrl = await uploadPhoto()
        if (form.photo_url) deleteStorageFilesFromUrls('legend-photos', form.photo_url)
      }
      const payload = {
        name: form.name.trim(), years: form.years.trim() || null, degree: form.degree.trim() || null,
        category: form.category, headline: form.headline.trim(), story: form.story.trim() || null,
        photo_url: photoUrl, link_url: form.link_url.trim() || null, link_label: form.link_label.trim() || null,
        active: form.active,
      }
      const { error: dbErr } = initial.id
        ? await supabase.from('legends').update(payload).eq('id', initial.id)
        : await supabase.from('legends').insert({ ...payload, created_by: session.user.id })
      if (dbErr) throw dbErr
      showToast(initial.id ? 'Entry updated.' : 'Entry added.')
      onSaved()
    } catch (err) {
      setError(err.message || 'Something went wrong saving that.')
      setSaving(false)
    }
  }

  return (
    <div className="adm-editor-page">
      <button type="button" className="adm-editor-back" onClick={onCancel}>‹ Legends</button>
      <PageHeader title={initial.id ? (initial.name || 'Edit entry') : 'Add someone'} description="Landscape photos work best — the tile crops to fill, and a portrait loses the top of the head." />

      <form className="adm-editor-form" onSubmit={save}>
        <h4 className="form-section-label">Basic information</h4>
        <div className="field-row">
          <label className="field"><span>Full name *</span><input value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={80} placeholder="Jan van der Merwe" /></label>
          <label className="field"><span>Category *</span>
            <div className="select-wrap">
              <select value={form.category} onChange={(e) => set('category', e.target.value)}>
                {LEGEND_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </div>
          </label>
        </div>
        <div className="field-row">
          <label className="field"><span>Years in SACS</span><input value={form.years} onChange={(e) => set('years', e.target.value)} maxLength={40} placeholder="1962–1966" /></label>
          <label className="field"><span>Degree</span><input value={form.degree} onChange={(e) => set('degree', e.target.value)} maxLength={60} placeholder="BSc Ingenieurswese" /></label>
        </div>

        <h4 className="form-section-label">Feature</h4>
        <label className="field"><span>Claim to fame *</span>
          <input value={form.headline} onChange={(e) => set('headline', e.target.value)} maxLength={160} placeholder="Springbok lock with 34 caps who captained the side in 1971" />
        </label>
        <p className="form-hint" style={{ marginTop: -6 }}>One sentence, shown on the tile under the name.</p>

        <label className="field"><span>Photo *</span></label>
        <div className="job-logo-picker">
          {preview ? <img className="admin-legend-preview" src={preview} alt="Photo preview" /> : <div className="admin-legend-preview admin-legend-preview-empty" aria-hidden="true" />}
          <div className="job-logo-picker-actions">
            <button type="button" className="btn ghost small" onClick={() => fileRef.current?.click()}>{preview ? 'Replace photo' : 'Upload photo'}</button>
          </div>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }} onChange={pickPhoto} />
        </div>

        <label className="field"><span>Long-form write-up</span>
          <textarea rows={9} value={form.story} onChange={(e) => set('story', e.target.value)} placeholder="Shown when someone opens the tile. Leave a blank line between paragraphs." />
        </label>

        <h4 className="form-section-label">Link</h4>
        <div className="field-row">
          <label className="field"><span>Read-more link</span><input value={form.link_url} onChange={(e) => set('link_url', e.target.value)} placeholder="https://en.wikipedia.org/wiki/…" /></label>
          <label className="field"><span>Link wording</span><input value={form.link_label} onChange={(e) => set('link_label', e.target.value)} maxLength={40} placeholder="Read his obituary" /></label>
        </div>

        <h4 className="form-section-label">Visibility</h4>
        <label className="checkbox-row"><input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} /><span>Show on the home page</span></label>

        {error && <p className="form-error">{error}</p>}
        <div className="btn-row">
          <button type="button" className="btn ghost" onClick={onCancel} disabled={saving}>Cancel</button>
          <button type="submit" className="btn primary" disabled={saving}>{saving ? 'Saving…' : (initial.id ? 'Save changes' : 'Add legend')}</button>
        </div>
      </form>
    </div>
  )
}
