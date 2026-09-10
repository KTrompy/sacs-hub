// Placeholder — no payment integration yet. When you're ready to accept
// donations, hook up PayFast (SA-standard) or a Stripe Payment Link and
// swap the "Get in touch" button for a real donate button.
import { useState } from 'react'
import { supabase } from '../supabaseClient'
import EmailModal from './EmailModal.jsx'

export default function Donate() {
  const [emailOpen, setEmailOpen] = useState(false)
  return (
    <div className="donate-panel">
      <img src="/sacs-logo.png" alt="SACS logo" className="donate-logo" />
      <h2>Support SACS</h2>
      <p>
        SACS has shaped Old Boys since 1829. If it shaped you, consider
        giving something back — every contribution keeps SACS strong for
        the next intake.
      </p>

      <div className="pillars">
        <div className="donate-pillar">
          <strong>Bursaries</strong>
          <span>Help academically strong students who couldn't otherwise afford it call SACS home.</span>
        </div>
        <div className="donate-pillar">
          <strong>School projects</strong>
          <span>Renovations, sports gear, facility upgrades — the small things that make SACS what it is.</span>
        </div>
        <div className="donate-pillar">
          <strong>Reunions & events</strong>
          <span>Underwrite the get-togethers that keep the alumni network alive year on year.</span>
        </div>
      </div>

      <p>
        For now, contributions are arranged directly with the alumni committee.
        Reach out and we'll walk you through the options.
      </p>

      <button type="button" className="btn primary" onClick={() => setEmailOpen(true)}>
        Get in touch
      </button>
      {emailOpen && (
        <EmailModal
          eyebrow="Contact"
          recipientName="SACS Alumni admin team"
          avatarUrl="/sacs-logo.png"
          subjectDefault="Supporting SACS"
          onSend={(subject, message) => supabase.functions.invoke('send-support-email', { body: { subject, message } })}
          sentToast="Email sent."
          onClose={() => setEmailOpen(false)}
        />
      )}

      <p style={{ marginTop: 24, fontSize: 12, color: 'var(--ink-soft)' }}>
        Spectemur Agendo · Since 1829
      </p>
    </div>
  )
}
