import { useState } from 'react'
import { supabase } from '../../supabaseClient'
import MultiSelectAutocomplete from '../MultiSelectAutocomplete.jsx'
import { EXPERTISE_OPTIONS } from '../../constants.js'
import { saveMentoringProfile } from './data.js'

const PAUSE_OPTIONS = [
  { value: '', label: 'Not paused' },
  { value: '14', label: '2 weeks' },
  { value: '30', label: '1 month' },
  { value: '90', label: '3 months' },
  { value: 'indefinite', label: 'Until I turn it back on' },
]

// The secondary page the redesign calls for — reachable from a header link,
// never a primary destination. Nothing here is discovered by accident; it's
// where someone goes once they already know they want to change something.
export default function MentoringProfile({ me, myMentoringProfile, reload, showToast, onProfileChange, onOpenOnboarding }) {
  const mp = myMentoringProfile || {}
  const [offersGuidance, setOffersGuidance] = useState(!!me?.is_open_to_opportunities)
  const [wantsGuidance, setWantsGuidance] = useState(!!me?.seeking_mentor)
  const [expertise, setExpertise] = useState(me?.expertise || [])
  const [goals, setGoals] = useState(me?.mentee_goals || [])
  const [guidanceGoal, setGuidanceGoal] = useState(mp.guidance_goal || '')
  const [capacity, setCapacity] = useState(me?.mentor_capacity || 2)
  const [channels, setChannels] = useState({
    quick_questions_enabled: mp.quick_questions_enabled !== false,
    conversations_enabled: mp.conversations_enabled !== false,
    mentorships_enabled: mp.mentorships_enabled !== false,
  })
  const [pause, setPause] = useState(mp.mentor_paused_until ? 'custom' : (me?.mentor_paused ? 'indefinite' : ''))
  const [prefs, setPrefs] = useState({
    pref_same_industry: !!mp.pref_same_industry,
    pref_local: !!mp.pref_local,
    pref_international: !!mp.pref_international,
    pref_seniority: !!mp.pref_seniority,
  })
  const [saving, setSaving] = useState(false)

  function toggleChannel(key) { setChannels((c) => ({ ...c, [key]: !c[key] })) }
  function togglePref(key) { setPrefs((p) => ({ ...p, [key]: !p[key] })) }

  async function save() {
    setSaving(true)
    const pausedUntil = pause && pause !== 'indefinite' && pause !== 'custom'
      ? new Date(Date.now() + Number(pause) * 86400000).toISOString()
      : null
    const [profileRes] = await Promise.all([
      supabase.from('profiles').update({
        is_open_to_opportunities: offersGuidance,
        seeking_mentor: wantsGuidance,
        expertise,
        mentee_goals: goals,
        mentor_capacity: capacity,
        mentor_paused: pause === 'indefinite',
      }).eq('id', me.id).select().maybeSingle(),
      saveMentoringProfile(me.id, {
        ...channels,
        ...prefs,
        guidance_goal: guidanceGoal,
        mentor_paused_until: pausedUntil,
      }),
    ])
    setSaving(false)
    if (profileRes.data) onProfileChange?.(profileRes.data)
    showToast('Saved.')
    reload({ quiet: true })
  }

  return (
    <div style={{ maxWidth: 640 }}>
      <div className="mtg-profile-section">
        <div className="mtg-profile-row">
          <div className="mtg-profile-row-text">
            <strong>I can help others</strong>
            <span>Show up as someone other members can ask or request mentorship from.</span>
          </div>
          <label className="mtg-switch">
            <input type="checkbox" checked={offersGuidance} onChange={() => setOffersGuidance((v) => !v)} />
            <span className="mtg-switch-track" />
          </label>
        </div>
        <div className="mtg-profile-row">
          <div className="mtg-profile-row-text">
            <strong>I am looking for guidance</strong>
            <span>Show up to people who might be able to help you.</span>
          </div>
          <label className="mtg-switch">
            <input type="checkbox" checked={wantsGuidance} onChange={() => setWantsGuidance((v) => !v)} />
            <span className="mtg-switch-track" />
          </label>
        </div>
        <button type="button" className="link-btn" onClick={onOpenOnboarding}>Retake the setup questions</button>
      </div>

      {offersGuidance && (
        <div className="mtg-profile-section">
          <h3 style={{ marginTop: 0 }}>What you can help with</h3>
          <MultiSelectAutocomplete values={expertise} onChange={setExpertise} options={EXPERTISE_OPTIONS} placeholder="Search areas, or type your own" allowCustom />

          <div className="mtg-profile-row" style={{ marginTop: 'var(--sp-5)' }}>
            <div className="mtg-profile-row-text"><strong>Quick questions</strong><span>A one-off question, no ongoing commitment.</span></div>
            <label className="mtg-switch"><input type="checkbox" checked={channels.quick_questions_enabled} onChange={() => toggleChannel('quick_questions_enabled')} /><span className="mtg-switch-track" /></label>
          </div>
          <div className="mtg-profile-row">
            <div className="mtg-profile-row-text"><strong>Conversations</strong><span>A single 20–45 minute conversation.</span></div>
            <label className="mtg-switch"><input type="checkbox" checked={channels.conversations_enabled} onChange={() => toggleChannel('conversations_enabled')} /><span className="mtg-switch-track" /></label>
          </div>
          <div className="mtg-profile-row">
            <div className="mtg-profile-row-text"><strong>Ongoing mentorship</strong><span>A longer relationship with regular check-ins.</span></div>
            <label className="mtg-switch"><input type="checkbox" checked={channels.mentorships_enabled} onChange={() => toggleChannel('mentorships_enabled')} /><span className="mtg-switch-track" /></label>
          </div>

          {channels.mentorships_enabled && (
            <div className="field">
              <span>How many mentorships at once?</span>
              <div className="mtg-capacity-row">
                {[1, 2, 3, 4].map((n) => <button key={n} type="button" className={`mtg-choice-card ${capacity === n ? 'on' : ''}`} onClick={() => setCapacity(n)}>{n}</button>)}
              </div>
            </div>
          )}

          <div className="field" style={{ marginTop: 'var(--sp-4)' }}>
            <span>Pause new mentorships</span>
            <div className="mtg-choice-grid">
              {PAUSE_OPTIONS.map((o) => <button key={o.value} type="button" className={`mtg-choice-card ${pause === o.value ? 'on' : ''}`} onClick={() => setPause(o.value)}>{o.label}</button>)}
            </div>
            <p className="hint">Quick questions and conversations still come through while paused, unless you turn them off above.</p>
          </div>
        </div>
      )}

      {wantsGuidance && (
        <div className="mtg-profile-section">
          <h3 style={{ marginTop: 0 }}>What you'd like guidance on</h3>
          <MultiSelectAutocomplete values={goals} onChange={setGoals} options={EXPERTISE_OPTIONS} placeholder="Search topics, or type your own" allowCustom />
          <label className="field" style={{ marginTop: 'var(--sp-4)' }}>
            <span>In your own words, what are you hoping for?</span>
            <textarea rows={3} value={guidanceGoal} onChange={(e) => setGuidanceGoal(e.target.value.slice(0, 500))} />
          </label>
          <div className="field" style={{ marginTop: 'var(--sp-4)' }}>
            <span>What matters most to you in a match?</span>
            <div className="mtg-choice-grid">
              <button type="button" className={`mtg-choice-card ${prefs.pref_same_industry ? 'on' : ''}`} onClick={() => togglePref('pref_same_industry')}>Same industry</button>
              <button type="button" className={`mtg-choice-card ${prefs.pref_local ? 'on' : ''}`} onClick={() => togglePref('pref_local')}>Based near me</button>
              <button type="button" className={`mtg-choice-card ${prefs.pref_international ? 'on' : ''}`} onClick={() => togglePref('pref_international')}>International experience</button>
              <button type="button" className={`mtg-choice-card ${prefs.pref_seniority ? 'on' : ''}`} onClick={() => togglePref('pref_seniority')}>Significantly more experienced</button>
            </div>
          </div>
        </div>
      )}

      <div className="mentoring-form-actions" style={{ marginTop: 'var(--sp-6)' }}>
        <button type="button" className="btn primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
      </div>
    </div>
  )
}
