import { useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../../supabaseClient'
import useModal from '../../useModal.js'
import MultiSelectAutocomplete from '../MultiSelectAutocomplete.jsx'
import { EXPERTISE_OPTIONS } from '../../constants.js'
import { saveMentoringProfile } from './data.js'

// First-time setup, shown once from the Overview page rather than buried in
// a Settings tab — this *is* how someone tells the programme what they
// need, not an optional preferences form. Writes to both `profiles` (the
// fields Directory/PersonProfile/Profile.jsx already read) and
// `mentoring_profiles` (the finer switches only this redesign uses).
export default function OnboardingWizard({ me, onDone }) {
  const [step, setStep] = useState(1)
  const [wantsGuidance, setWantsGuidance] = useState(false)
  const [offersGuidance, setOffersGuidance] = useState(false)
  const [goals, setGoals] = useState([])
  const [expertise, setExpertise] = useState([])
  const [prefs, setPrefs] = useState({ pref_same_industry: false, pref_local: false, pref_international: false, pref_seniority: false })
  const [capacity, setCapacity] = useState(2)
  const [channels, setChannels] = useState({ quick_questions_enabled: true, conversations_enabled: true, mentorships_enabled: true })
  const [saving, setSaving] = useState(false)
  const modalRef = useModal({ onClose: () => {}, closeOnEscape: false })

  const steps = ['intent', ...(wantsGuidance ? ['goals'] : []), ...(offersGuidance ? ['expertise'] : []), ...(wantsGuidance ? ['prefs'] : []), ...(offersGuidance ? ['capacity'] : [])]
  const current = steps[step - 1]

  function togglePref(key) { setPrefs((p) => ({ ...p, [key]: !p[key] })) }
  function toggleChannel(key) { setChannels((c) => ({ ...c, [key]: !c[key] })) }

  async function finish() {
    setSaving(true)
    await Promise.all([
      supabase.from('profiles').update({
        seeking_mentor: wantsGuidance,
        is_open_to_opportunities: offersGuidance,
        ...(wantsGuidance ? { mentee_goals: goals } : {}),
        ...(offersGuidance ? { expertise, mentor_capacity: capacity } : {}),
      }).eq('id', me.id),
      saveMentoringProfile(me.id, {
        ...prefs,
        ...channels,
        onboarding_completed_at: new Date().toISOString(),
      }),
    ])
    setSaving(false)
    onDone?.({ wantsGuidance, offersGuidance, goals, expertise })
  }

  async function skip() {
    setSaving(true)
    await saveMentoringProfile(me.id, { onboarding_completed_at: new Date().toISOString() })
    setSaving(false)
    onDone?.(null)
  }

  const canContinue =
    current === 'intent' ? (wantsGuidance || offersGuidance) :
    current === 'goals' ? goals.length > 0 :
    current === 'expertise' ? expertise.length > 0 :
    true

  return createPortal(
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal mtg-wizard-step" ref={modalRef} style={{ maxWidth: 560, padding: 'var(--sp-7)' }}>
        <button type="button" className="link-btn subtle" style={{ alignSelf: 'flex-end', marginBottom: -8 }} onClick={skip} disabled={saving}>
          Skip for now
        </button>
        <div className="mtg-wizard-progress">
          {steps.map((_, i) => <span key={i} className={i < step ? 'done' : ''} />)}
        </div>

        {current === 'intent' && (
          <>
            <h2>What brings you to Mentoring?</h2>
            <p className="hint">Pick as many as apply — you can change this any time.</p>
            <div className="mtg-intent-grid">
              <button type="button" className={`mtg-intent-option ${wantsGuidance ? 'on' : ''}`} onClick={() => setWantsGuidance((v) => !v)}>
                <strong>I'd like guidance</strong>
                <span>Find people who've done what I'm trying to do.</span>
              </button>
              <button type="button" className={`mtg-intent-option ${offersGuidance ? 'on' : ''}`} onClick={() => setOffersGuidance((v) => !v)}>
                <strong>I can offer experience</strong>
                <span>Help other old boys with what I know.</span>
              </button>
            </div>
          </>
        )}

        {current === 'goals' && (
          <>
            <h2>What would you like guidance on?</h2>
            <p className="hint">Pick a few — this drives who you'll see first.</p>
            <MultiSelectAutocomplete values={goals} onChange={setGoals} options={EXPERTISE_OPTIONS} placeholder="Search topics, or type your own" allowCustom />
          </>
        )}

        {current === 'expertise' && (
          <>
            <h2>What can you help other old boys with?</h2>
            <p className="hint">Pick a few areas — you can add more later.</p>
            <MultiSelectAutocomplete values={expertise} onChange={setExpertise} options={EXPERTISE_OPTIONS} placeholder="Search areas, or type your own" allowCustom />
          </>
        )}

        {current === 'prefs' && (
          <>
            <h2>What makes someone especially useful to you?</h2>
            <p className="hint">Optional — helps us weigh recommendations, never a hard filter.</p>
            <div className="mtg-choice-grid">
              <button type="button" className={`mtg-choice-card ${prefs.pref_same_industry ? 'on' : ''}`} onClick={() => togglePref('pref_same_industry')}>Same industry</button>
              <button type="button" className={`mtg-choice-card ${prefs.pref_local ? 'on' : ''}`} onClick={() => togglePref('pref_local')}>Based near me</button>
              <button type="button" className={`mtg-choice-card ${prefs.pref_international ? 'on' : ''}`} onClick={() => togglePref('pref_international')}>International experience</button>
              <button type="button" className={`mtg-choice-card ${prefs.pref_seniority ? 'on' : ''}`} onClick={() => togglePref('pref_seniority')}>Significantly more experienced</button>
            </div>
          </>
        )}

        {current === 'capacity' && (
          <>
            <h2>How would you like to be reached?</h2>
            <div className="mtg-profile-row">
              <div className="mtg-profile-row-text"><strong>Quick questions</strong><span>A one-off question, no ongoing commitment.</span></div>
              <label className="mtg-switch">
                <input type="checkbox" checked={channels.quick_questions_enabled} onChange={() => toggleChannel('quick_questions_enabled')} />
                <span className="mtg-switch-track" />
              </label>
            </div>
            <div className="mtg-profile-row">
              <div className="mtg-profile-row-text"><strong>Conversations</strong><span>A single 20–45 minute conversation.</span></div>
              <label className="mtg-switch">
                <input type="checkbox" checked={channels.conversations_enabled} onChange={() => toggleChannel('conversations_enabled')} />
                <span className="mtg-switch-track" />
              </label>
            </div>
            <div className="mtg-profile-row">
              <div className="mtg-profile-row-text"><strong>Ongoing mentorship</strong><span>A longer relationship with regular check-ins.</span></div>
              <label className="mtg-switch">
                <input type="checkbox" checked={channels.mentorships_enabled} onChange={() => toggleChannel('mentorships_enabled')} />
                <span className="mtg-switch-track" />
              </label>
            </div>
            {channels.mentorships_enabled && (
              <div className="field" style={{ marginTop: 'var(--sp-4)' }}>
                <span>How many mentorships at once?</span>
                <div className="mtg-capacity-row">
                  {[1, 2, 3, 4].map((n) => (
                    <button key={n} type="button" className={`mtg-choice-card ${capacity === n ? 'on' : ''}`} onClick={() => setCapacity(n)}>{n}</button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        <div className="mentoring-form-actions" style={{ justifyContent: 'space-between', marginTop: 'var(--sp-4)' }}>
          {step > 1 ? (
            <button type="button" className="btn ghost" onClick={() => setStep(step - 1)} disabled={saving}>Back</button>
          ) : <span />}
          {step < steps.length ? (
            <button type="button" className="btn primary" onClick={() => setStep(step + 1)} disabled={!canContinue}>Continue</button>
          ) : (
            <button type="button" className="btn primary" onClick={finish} disabled={saving || !canContinue}>
              {saving ? 'Saving…' : 'Done'}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
