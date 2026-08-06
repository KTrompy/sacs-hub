import { createPortal } from 'react-dom'
import useModal from '../useModal.js'

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
const LAST_UPDATED = '3 August 2026'

export function PrivacyPolicyContent() {
  return (
    <div className="privacy-policy-content">
      <p className="hint">Last updated {LAST_UPDATED}.</p>

      <p>
        SACS Alumni Hub ("the Hub") is an unofficial community site run by
        alumni, for alumni of SACS House, Stellenbosch. Kyle Trompeter
        administers it and is the responsible party for the personal
        information collected here under South Africa's Protection of
        Personal Information Act, 2013 (POPIA).
      </p>

      <h3>What we collect</h3>
      <p>
        When you join, we collect your name, email address, the years you
        lived in SACS, and a residential address, which the committee uses
        to verify you actually lived in the house before approving your
        account. From there, anything else on your profile is what you
        choose to add: phone number, city/country and the coordinates used
        to place you on the alumni map, occupation, employer, industry,
        LinkedIn profile, a bio, a CV upload, and business or mentoring
        details if you fill those sections in. We also keep a record of
        posts, event RSVPs, job listings, direct messages and business
        listings you create, and a last-seen timestamp used for the
        "recently online" indicator.
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
        → Privacy) allow — you control who can see your phone number, email,
        location and who can message you. Site admins can see full profiles
        in order to run the platform and moderate content. We use a small
        number of external processors to operate the site: Supabase (hosted
        in Frankfurt, Germany) for the database, authentication and file
        storage; Mapbox for map tiles and turning addresses into map
        coordinates; Cloudflare Turnstile for bot protection at signup; and
        Google, only if you choose to sign in with a Google account. None of
        these processors use your data for anything other than providing
        that service to the Hub.
      </p>
      <p>
        Because Supabase's servers are in the EU, your data is processed
        outside South Africa. The EU's data protection law (GDPR) is
        recognised as offering an adequate standard of protection, which is
        what POPIA requires for a cross-border transfer like this.
      </p>

      <h3>How long we keep it</h3>
      <p>
        For as long as your account exists. If you delete your account (or
        ask an admin to), your profile, posts, messages, uploaded files and
        other account data are permanently removed — this can't be undone,
        and there's no separate backup copy kept for marketing or analytics
        purposes.
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
        contact details, or opt out of the news/events emails, from Settings
        → Privacy. You can permanently delete your account and everything in
        it from Settings, with no need to ask anyone. If you'd like a copy of
        the data we hold on you, or have any other question about how your
        information is used, email the address below and we'll deal with it
        promptly.
      </p>

      <h3>Contact / complaints</h3>
      <p>
        Questions, access requests or complaints about how your information
        is handled: <a href="mailto:kyletrompeter0@gmail.com">kyletrompeter0@gmail.com</a>.
        If you're not satisfied with our response, you can also complain to
        South Africa's Information Regulator (<a href="https://inforegulator.org.za" target="_blank" rel="noopener noreferrer">inforegulator.org.za</a>).
      </p>
    </div>
  )
}

// Full page — routed at /privacy.
export default function PrivacyPolicy() {
  return (
    <div className="donate-panel privacy-policy-page">
      <h2>Privacy Policy</h2>
      <PrivacyPolicyContent />
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
