import { useState } from 'react'
import { createPortal } from 'react-dom'
import useModal from '../useModal.js'
import { supabase } from '../supabaseClient'
import EmailModal from './EmailModal.jsx'

// POPIA-facing privacy notice. Written to satisfy section 18 of the
// Protection of Personal Information Act (South Africa) — what's collected,
// why, who processes it, how long it's kept, and how to exercise the
// section 23/24 access-and-correction and deletion rights. Kept in one
// place and reused two ways:
//   - <PrivacyPolicy /> — the full page, routed at /privacy for anyone
//     already signed in (footer link, Settings).
//   - <PrivacyPolicyModal /> — same content in a dialog, for the signup
//     flow (Auth.jsx, FinishSignup.jsx), which renders before there's a
//     session and therefore before the router's protected routes exist.
// Update the "Last updated" date below whenever the content changes —
// POPIA notices are meant to reflect current practice, not history.
const LAST_UPDATED = '10 September 2026'

// withEmailModal=true swaps the plain mailto: link for the floating
// compose popup. Only the full page (<PrivacyPolicy/>, routed at /privacy)
// passes this — it's only reachable once someone is signed in, same as
// every other "email an admin" spot. <PrivacyPolicyModal/> is shown during
// signup, before any session exists, so it keeps the plain mailto: link —
// there's no account yet to authenticate the popup's send with.
export function PrivacyPolicyContent({ withEmailModal = false }) {
  const [emailOpen, setEmailOpen] = useState(false)
  return (
    <div className="privacy-policy-content">
      <p className="hint">Last updated {LAST_UPDATED}.</p>

      <p>
        SACS Alumni Hub ("the Hub") is an unofficial community site run by
        alumni, for alumni of SACS (South African College Schools), Newlands,
        Cape Town. Kyle Trompeter
        administers it and is the responsible party for the personal
        information collected here under South Africa's Protection of
        Personal Information Act, 2013 (POPIA).
      </p>

      <h3>What we collect</h3>
      <p>
        When you join, we collect your name, email address, the years you
        attended SACS, and your city/country, which the committee uses to
        verify you actually attended before approving your account. While
        you're signing up we also look up your city from your device's IP
        address (via two lookup services, ipapi.co and ipwho.is) to speed
        up that field — see "Who else sees it" below. A full postal
        address is optional and only asked for if you choose to add one.
        From there, anything else on your profile is what you choose to
        add: phone number, the coordinates used to place you on the alumni
        map, occupation, employer, industry, LinkedIn profile, a bio, a CV
        upload, and business or mentoring details if you fill those
        sections in. We also keep a record of posts, event RSVPs, job
        listings and business listings you create, a last-seen timestamp
        used for the "recently online" indicator, and, if you report a
        post, listing or member for admins to review, whatever you write
        in that report (which may describe another member). When you email
        another member through the site (the "Message" button on a
        profile, post or listing), the subject and message text pass
        through Resend, our email delivery provider, to reach them — we
        don't store the content of those emails ourselves.
      </p>

      <h3>Why we process it</h3>
      <p>
        To verify you're a genuine SACS alumnus before granting access, to
        run the directory, map, messaging, jobs board, events calendar and
        business directory features you use, and — only if you opt in during
        signup — to email you occasional news and event updates. We never
        sell or rent your information, and we don't use it for anything
        beyond running this community.
      </p>

      <h3>Who else sees it</h3>
      <p>
        Other approved members see whatever your privacy settings (Settings
        → Privacy) allow — you control who can see your phone number, email
        and location. Any approved member can email you using the
        "Message" button on your profile, a post, or a listing you've
        created. Site admins can see full profiles, including your email
        address, in order to run the platform, and see anything you submit
        when reporting a post, listing or member, in order to moderate it.
        We use a small number of external processors to operate the site:
        Supabase (hosted in Frankfurt, Germany) for the database,
        authentication and file storage; Mapbox for map tiles and turning
        addresses into map coordinates; ipapi.co and ipwho.is, which
        receive your IP address during signup to suggest your city; and
        Resend for delivering emails sent through the site (account emails
        and messages you send other members). Cloudflare Turnstile also
        runs bot-protection checks at signup and other sensitive actions
        where we've turned it on. If you sign in with a Google account,
        Google shares your name, email address and profile photo with us
        for that. None of these processors use your data for anything
        other than providing that service to the Hub.
      </p>
      <p>
        Because Supabase's servers are in the EU, your data is processed
        outside South Africa. The EU's data protection law (GDPR) is
        recognised as offering an adequate standard of protection, which is
        what POPIA requires for a cross-border transfer like this.
      </p>

      <h3>How long we keep it</h3>
      <p>
        For as long as your account exists. If you delete your own account,
        your profile, posts, uploaded files and other account data are
        permanently removed — this can't be undone, and there's no separate
        backup copy kept for marketing or analytics purposes. If an admin
        removes your account instead, the same data is deleted the same
        way, except that your name stays in our internal admin action log
        — a permanent record of who did what, kept for accountability, not
        as a backup of your profile.
      </p>

      <h3>Keeping it secure</h3>
      <p>
        Access to your data is controlled by row-level security policies in
        the database, so members can only ever query what the app's screens
        are meant to show them, and by default our file storage keeps
        sensitive uploads like CVs private rather than publicly accessible.
      </p>

      <h3>Your rights</h3>
      <p>
        You can view and correct almost everything we hold on you directly
        from your Profile page at any time. You can change who can see your
        contact details from Settings → Privacy, and opt in or out of
        committee news/event emails from Settings → Notifications. You can
        permanently delete your account and everything in it from Settings,
        with no need to ask anyone. If you'd like a copy of the data we
        hold on you, or have any other question about how your information
        is used, email the address below and we'll deal with it promptly.
      </p>

      <h3>Contact / complaints</h3>
      <p>
        Questions, access requests or complaints about how your information
        is handled: {withEmailModal ? (
          <button type="button" className="link-btn" onClick={() => setEmailOpen(true)}>kyletrompeter0@gmail.com</button>
        ) : (
          <a href="mailto:kyletrompeter0@gmail.com">kyletrompeter0@gmail.com</a>
        )}.
        If you're not satisfied with our response, you can also complain to
        South Africa's Information Regulator (<a href="https://inforegulator.org.za" target="_blank" rel="noopener noreferrer">inforegulator.org.za</a>).
      </p>
      {withEmailModal && emailOpen && (
        <EmailModal
          eyebrow="Contact"
          recipientName="SACS Alumni admin team"
          avatarUrl="/sacs-logo.png"
          subjectDefault="SACS Alumni — privacy question"
          onSend={(subject, message) => supabase.functions.invoke('send-support-email', { body: { subject, message } })}
          sentToast="Email sent."
          onClose={() => setEmailOpen(false)}
        />
      )}
    </div>
  )
}

// Full page — routed at /privacy.
export default function PrivacyPolicy() {
  return (
    <div className="donate-panel privacy-policy-page">
      <h2>Privacy Policy</h2>
      <PrivacyPolicyContent withEmailModal />
    </div>
  )
}

// Modal wrapper for screens rendered before there's a session (signup,
// finish-signup) where the /privacy route isn't reachable yet — App.jsx
// only mounts the router's <Routes> once someone is signed in.
export function PrivacyPolicyModal({ onClose }) {
  const modalRef = useModal({ onClose, history: false })

  return createPortal(
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="privacy-modal-title">
      <div className="modal modal-privacy" ref={modalRef} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 id="privacy-modal-title">Privacy Policy</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">
          <PrivacyPolicyContent />
        </div>
      </div>
    </div>,
    document.body
  )
}
