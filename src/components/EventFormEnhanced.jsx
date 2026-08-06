import { useEffect, useRef, useState } from 'react'
import { supabase, deleteStorageFilesFromUrls } from '../supabaseClient'
import { geocodeCity } from '../geocode.js'
import CityAutocomplete from './CityAutocomplete.jsx'
import { useToast } from './Toast.jsx'
import useDiscardGuard from './useDiscardGuard.jsx'
import useModal from '../useModal.js'
import DateTimePicker from './DateTimePicker.jsx'
import RichTextToolbarExtended from './RichTextToolbarExtended.jsx'
import { isSafeHttpUrl } from '../utils.js'

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB

export default function EventFormEnhanced({ session, onCancel, onCreated, initial = null }) {
  const isEdit = !!initial
  const [title, setTitle] = useState(initial?.title || '')
  const [startDate, setStartDate] = useState(initial?.event_start_time ? new Date(initial.event_start_time) : null)
  const [endDate, setEndDate] = useState(initial?.event_end_time ? new Date(initial.event_end_time) : null)
  const [location, setLocation] = useState(initial?.location || '')
  // Coordinates captured straight from a picked CityAutocomplete suggestion
  // (address or city-level) — see handleLocationCoords. When present and
  // still matching what's in the field, submit uses these directly instead
  // of re-geocoding, same pattern as Jobs.jsx's "Post a role" form. Venue
  // names ("SACS, Stellenbosch") won't always be in Mapbox's suggestions,
  // so this field stays non-strict — free-typed text is still saved as-is.
  const [pickedCoords, setPickedCoords] = useState(
    isEdit && typeof initial?.lat === 'number' ? { lat: initial.lat, lng: initial.lng } : null
  )
  const [pickedLabel, setPickedLabel] = useState('')
  const [eventUrl, setEventUrl] = useState(initial?.event_url || '')
  const [description, setDescription] = useState(initial?.description || '')
  const [registrationLimit, setRegistrationLimit] = useState(initial?.max_registrations === null ? 'unlimited' : 'limited')
  const [registrationCount, setRegistrationCount] = useState(initial?.max_registrations || '')
  const [imageFile, setImageFile] = useState(null)
  const [imagePreview, setImagePreview] = useState(initial?.image_url || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [isClosing, setIsClosing] = useState(false)
  const textareaRef = useRef(null)
  const fileInputRef = useRef(null)
  const showToast = useToast()

  useEffect(() => {
    if (isEdit) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prevOverflow }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleCancel() {
    // A save in flight is doing real work (uploads, DB write) — closing
    // from under it just orphans the request without cleaning up.
    if (busy) return
    setIsClosing(true)
    setTimeout(onCancel, 200)
  }

  // See the fuller note on the same pattern in Jobs.jsx — a backdrop click
  // used to bin a part-written event with no warning. Unlike the job and
  // business forms this one has no localStorage draft to fall back on, so
  // the prompt is the only thing standing between a stray click and losing
  // the lot.
  const pristineRef = useRef(JSON.stringify({
    title: initial?.title || '',
    location: initial?.location || '',
    eventUrl: initial?.event_url || '',
    description: initial?.description || '',
    start: initial?.event_start_time || null,
    end: initial?.event_end_time || null,
    limit: initial?.max_registrations ?? null,
  }))
  const dirty = JSON.stringify({
    title,
    location,
    eventUrl,
    description,
    start: startDate ? startDate.toISOString() : null,
    end: endDate ? endDate.toISOString() : null,
    limit: registrationLimit === 'unlimited' ? null : (parseInt(registrationCount) || null),
  }) !== pristineRef.current || !!imageFile

  const { requestClose, discardDialog } = useDiscardGuard({
    dirty: dirty && !busy,
    onDiscard: handleCancel,
    title: isEdit ? 'Discard your changes?' : 'Discard this event?',
    message: "Anything you've entered here will be lost.",
    confirmLabel: 'Discard',
  })

  const panelRef = useModal({
    enabled: !isEdit,
    onClose: requestClose,
    closeOnEscape: !busy,
    // This form already locks body scroll itself, just above.
    lockScroll: false,
  })

  function handleLocationCoords(payload) {
    if (!payload) { setPickedCoords(null); setPickedLabel(''); return }
    setPickedCoords({ lat: payload.lat, lng: payload.lng })
    setPickedLabel(payload.label)
  }

  function handleImageSelect(e) {
    const file = e.target.files?.[0]
    if (!file) return

    if (file.size > MAX_FILE_SIZE) {
      setError('Image must be under 5MB')
      return
    }

    setImageFile(file)
    const reader = new FileReader()
    reader.onload = (evt) => setImagePreview(evt.target?.result)
    reader.readAsDataURL(file)
  }

  function clearImage() {
    setImageFile(null)
    setImagePreview('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function uploadImage(eventId) {
    if (!imageFile) return null

    const filename = `${session.user.id}/${Date.now()}-${imageFile.name}`
    const { data, error: uploadError } = await supabase.storage
      .from('event-images')
      .upload(filename, imageFile)

    if (uploadError) {
      console.error('Image upload error:', uploadError)
      return null
    }

    const { data: urlData } = supabase.storage.from('event-images').getPublicUrl(filename)
    return urlData?.publicUrl || null
  }

  async function submit() {
    if (!title.trim() || !startDate) {
      setError('Title and start date are required.')
      return
    }

    if (endDate && startDate > endDate) {
      setError('End date must be after start date.')
      return
    }

    if (registrationLimit === 'limited' && (!registrationCount || parseInt(registrationCount) < 1)) {
      setError('Registration limit must be at least 1.')
      return
    }

    if (eventUrl.trim() && !isSafeHttpUrl(eventUrl)) {
      setError('Event URL should start with http:// or https://.')
      return
    }

    // Lowering the cap below the number of people who've already RSVP'd used
    // to save silently, leaving the event over capacity with nothing flagging
    // it anywhere. Checked here rather than clamped automatically, because
    // which RSVPs would have to go is the organiser's call, not ours.
    if (isEdit && registrationLimit === 'limited') {
      const { count, error: countError } = await supabase
        .from('event_rsvps')
        .select('event_id', { count: 'exact', head: true })
        .eq('event_id', initial.id)
      if (!countError && typeof count === 'number' && parseInt(registrationCount) < count) {
        setError(
          `${count} ${count === 1 ? 'person has' : 'people have'} already RSVP'd, so the limit can't be lower than ${count}.`
        )
        return
      }
    }

    setBusy(true)
    setError(null)

    try {
      // Prefer coordinates captured straight from a picked suggestion —
      // already a confirmed, geocodable place/address, no need to look it
      // up again. Otherwise fall back to re-geocoding only when the
      // location text actually changed.
      const trimmedLocation = location.trim()
      let coords = { lat: initial?.lat ?? null, lng: initial?.lng ?? null }
      const locationChanged = !isEdit || trimmedLocation !== (initial?.location || '')

      if (pickedCoords && trimmedLocation === pickedLabel.trim()) {
        coords = pickedCoords
      } else if (locationChanged && trimmedLocation) {
        const geo = await geocodeCity(trimmedLocation, '')
        coords = { lat: geo?.lat ?? null, lng: geo?.lng ?? null }
      } else if (locationChanged && !trimmedLocation) {
        coords = { lat: null, lng: null }
      }

      // Handle image upload
      let imageUrl = initial?.image_url || ''
      const prevImageUrl = initial?.image_url || ''
      if (imageFile) {
        imageUrl = await uploadImage(initial?.id) || ''
      } else if (isEdit && !imagePreview && prevImageUrl) {
        // User cleared the image without uploading a new one — drop the URL
        // so the row no longer references a file we're about to delete.
        imageUrl = ''
      }

      const payload = {
        title: title.trim(),
        // Events.jsx (listing, sorting, calendar, Home.jsx's "upcoming
        // event" widget) all still query/sort on the original event_date
        // column, which is NOT NULL at the DB level — event_start_time/
        // event_end_time were added later for the richer edit form but
        // never wired back into event_date. Without this, every new/edited
        // event either fails to insert (NOT NULL violation) or, if the
        // constraint were ever relaxed, would silently vanish from every
        // listing that filters/sorts on event_date. Keep both in sync.
        event_date: startDate.toISOString(),
        event_start_time: startDate.toISOString(),
        event_end_time: endDate?.toISOString() || null,
        location: trimmedLocation,
        description: description.trim(),
        event_url: eventUrl.trim(),
        image_url: imageUrl,
        max_registrations: registrationLimit === 'unlimited' ? null : parseInt(registrationCount),
        ...coords,
      }

      const { error: dbError } = isEdit
        ? await supabase.from('events').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', initial.id)
        : await supabase.from('events').insert({ ...payload, created_by: session.user.id })

      if (dbError) {
        setError(
          dbError.message.includes('policy')
            ? 'Creating events unlocks once your account is approved.'
            : dbError.message
        )
      } else {
        // Best-effort cleanup: if we replaced (or cleared) the image, the old
        // file's URL is no longer referenced by anything and would otherwise
        // sit orphaned in the event-images bucket forever.
        if (isEdit && prevImageUrl && prevImageUrl !== imageUrl) {
          deleteStorageFilesFromUrls('event-images', prevImageUrl)
        }
        onCreated()
      }
    } catch (err) {
      setError(err.message || 'An error occurred.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className={isEdit ? '' : `create-panel-backdrop ${isClosing ? 'closing' : ''}`}
      onClick={isEdit ? undefined : (e) => e.target === e.currentTarget && requestClose()}
      role={isEdit ? undefined : 'dialog'}
      aria-modal={isEdit ? undefined : 'true'}
      aria-label={isEdit ? undefined : 'Add an event'}
    >
      {/* A real <form> so Enter submits — see the note in Jobs.jsx. */}
      <form
        className={isEdit ? 'create-panel inline' : `create-panel ${isClosing ? 'closing' : ''}`}
        ref={panelRef}
        onSubmit={(e) => { e.preventDefault(); if (!busy) submit() }}
        noValidate
      >
        <h3>{isEdit ? 'Edit event' : 'Add an event'}</h3>
        <div className="create-panel-content event-form-enhanced">
          {/* Basic info */}
          <label className="field">
            <span>Title</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="60-year reunion braai"
            />
          </label>

          {/* Date & Time */}
          <div className="field-row">
            <label className="field">
              <span>Start date & time</span>
              <DateTimePicker
                value={startDate}
                onChange={setStartDate}
                placeholder="Pick a start date & time"
              />
            </label>
            <label className="field">
              <span>End date & time (optional)</span>
              <DateTimePicker
                value={endDate}
                onChange={setEndDate}
                placeholder="Pick an end date & time"
              />
            </label>
          </div>

          {/* Location & URL */}
          <div className="field-row">
            <label className="field">
              <span>Location</span>
              <CityAutocomplete
                value={location}
                onChange={setLocation}
                onSelectCoords={handleLocationCoords}
                placeholder="SACS, Stellenbosch"
                strict={false}
              />
            </label>
            <label className="field">
              <span>Event URL (optional)</span>
              <input
                value={eventUrl}
                onChange={(e) => setEventUrl(e.target.value)}
                type="url"
                placeholder="https://example.com"
              />
            </label>
          </div>

          {/* Image upload */}
          <label className="field">
            <span>Event image (optional)</span>
            <div className="image-upload-box">
              {imagePreview ? (
                <div className="image-preview">
                  <img src={imagePreview} alt="Event" />
                  <button
                    type="button"
                    className="btn-clear-image"
                    onClick={clearImage}
                    aria-label="Remove image"
                  >
                    ×
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="btn ghost wide"
                  onClick={() => fileInputRef.current?.click()}
                >
                  Choose image
                </button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleImageSelect}
                style={{ display: 'none' }}
              />
            </div>
            <p className="field-hint">Max 5MB</p>
          </label>

          {/* Rich text description */}
          <label className="field">
            <span>Description</span>
            <RichTextToolbarExtended
              textareaRef={textareaRef}
              value={description}
              onChange={setDescription}
            />
            <textarea
              ref={textareaRef}
              rows={5}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What's happening, RSVP details, what to bring, cost…"
              style={{ resize: 'vertical' }}
              className="rte-textarea"
            />
          </label>

          {/* Registration limit */}
          <div className="field">
            <span>Registration limit</span>
            <div className="registration-limit-group">
              <label className="radio-label">
                <input
                  type="radio"
                  value="unlimited"
                  checked={registrationLimit === 'unlimited'}
                  onChange={(e) => setRegistrationLimit(e.target.value)}
                />
                <span>Unlimited registrations</span>
              </label>
              <label className="radio-label">
                <input
                  type="radio"
                  value="limited"
                  checked={registrationLimit === 'limited'}
                  onChange={(e) => setRegistrationLimit(e.target.value)}
                />
                <span>Limit to</span>
                <input
                  type="number"
                  min="1"
                  value={registrationCount}
                  onChange={(e) => setRegistrationCount(e.target.value)}
                  placeholder="50"
                  disabled={registrationLimit === 'unlimited'}
                  title={registrationLimit === 'unlimited' ? 'Choose "Limit to" to set a number' : undefined}
                  className="registration-input"
                />
                <span>people</span>
              </label>
            </div>
          </div>

          {error && <p className="form-error">{error}</p>}
        </div>

        <div className="btn-row">
          <button
            type="button"
            className="btn ghost"
            onClick={requestClose}
            disabled={isClosing || busy}
            title={busy ? 'Wait for the save to finish' : undefined}
          >
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy} title={busy ? 'Saving…' : undefined}>
            {busy ? 'Saving…' : isEdit ? 'Save changes' : 'Post event'}
          </button>
        </div>

      </form>
      {discardDialog}
    </div>
  )
}
