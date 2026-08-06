import { useState } from 'react'

/*
 * The Admin Handbook — the "how to run this site" manual, kept inside the
 * site itself.
 *
 * The point of this file is succession. Everything an incoming admin needs to
 * know used to live in one person's head, plus a scattering of markdown files
 * in the repo that a non-technical committee member will never see. If the
 * handover is a WhatsApp message and a password, the site dies the first time
 * something goes wrong.
 *
 * So: written for someone who has never opened a terminal, will never read the
 * repo, and inherited this job at an AGM. Plain English, no jargon without an
 * explanation, and an explicit "stop and phone someone technical" line
 * wherever guessing could do damage.
 *
 * Keeping it in the app rather than in a README is deliberate — a document
 * only helps if the person who needs it can find it, and the only place
 * they're guaranteed to look is the Admin page they're already standing on.
 *
 * When you change how the site works, change this too. It is the handover.
 */

/* Things only Kyle can fill in — spelled out rather than left blank so a
   reader knows the gap is known about rather than an oversight. */
const TODO = (text) => <span className="hb-todo">TODO: {text}</span>

function Section({ id, title, summary, children, openByDefault = false }) {
  const [open, setOpen] = useState(openByDefault)
  return (
    <section className={open ? 'hb-section open' : 'hb-section'} id={id}>
      <button type="button" className="hb-section-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="hb-section-title">{title}</span>
        <span className="hb-section-summary">{summary}</span>
        <span className="hb-chevron" aria-hidden="true">{open ? '−' : '+'}</span>
      </button>
      {open && <div className="hb-section-body">{children}</div>}
    </section>
  )
}

function Callout({ tone = 'note', title, children }) {
  return (
    <div className={`hb-callout ${tone}`}>
      {title && <strong>{title}</strong>}
      <div>{children}</div>
    </div>
  )
}

export default function AdminHandbook() {
  return (
    <div className="admin-handbook">
      <div className="hb-intro">
        <h3>Running SACS Alumni Hub</h3>
        <p>
          This is the whole job, written down. It assumes you've never touched the technical side
          of a website — you don't need to. Nearly everything is done from the tabs above this one.
          Read the first two sections now; come back to the rest when you need them.
        </p>
        <p className="hb-intro-note">
          If you're handing this site over to someone else, point them here first.
        </p>
      </div>

      {/* ------------------------------------------------------------------ */}
      <Section
        id="hb-job"
        title="1. What the job actually is"
        summary="About 10 minutes a week"
        openByDefault
      >
        <p>
          You are the gatekeeper and the caretaker. The site runs itself; you decide who gets in
          and you deal with anything members flag. That's it.
        </p>
        <h4>The weekly routine</h4>
        <ol className="hb-list">
          <li>
            <strong>Open the Admin page.</strong> The banner at the top tells you if anything needs
            you. If it's green, you're done — close the tab.
          </li>
          <li>
            <strong>Pending approval.</strong> Approve the people you recognise as real Old Boys.
            Leave anyone you're unsure about and ask around before approving.
          </li>
          <li>
            <strong>Reports.</strong> Members can flag a post, job, business or profile. Look at
            what was flagged, then either remove it or dismiss the report.
          </li>
          <li>
            <strong>That's the routine.</strong> Posts, Jobs, Events and Businesses tabs only exist
            for when you need to remove something specific — you don't have to review them.
          </li>
        </ol>
        <Callout tone="good" title="The single most important habit">
          Never approve someone you can't place. An approved account can read every member's
          profile, message anyone privately, and post to the feed. Approval is the only wall
          between the alumni community and the internet. It takes one WhatsApp to a classmate to check.
        </Callout>
        <h4>What you are <em>not</em> responsible for</h4>
        <ul className="hb-list">
          <li>Writing content — members post their own.</li>
          <li>Keeping the site online — the hosting does that by itself.</li>
          <li>Fixing bugs. If something is broken, see <em>“When something breaks”</em> below.</li>
        </ul>
      </Section>

      {/* ------------------------------------------------------------------ */}
      <Section
        id="hb-tools"
        title="2. Every button on this page, and what it does"
        summary="Read before you click anything with a red label"
      >
        <h4>Pending approval</h4>
        <dl className="hb-dl">
          <dt>Approve</dt>
          <dd>
            Lets that person into the site. They can immediately see the directory, message members
            and post. Reversible — see <em>Un-approve</em>.
          </dd>
          <dt>“Hasn't finished signing up”</dt>
          <dd>
            Not a problem and not your job to fix. Someone started signing up — usually via the
            Google button — and closed the tab before filling in the rest. There's nothing to
            approve yet. It clears itself when they come back and finish. If it's been sitting
            there for weeks, you can delete the account from the Members tab.
          </dd>
        </dl>

        <h4>Members</h4>
        <dl className="hb-dl">
          <dt>Un-approve</dt>
          <dd>
            Puts someone back outside the wall. They lose access and see the “waiting to be
            verified” screen. <strong>Nothing they've written is deleted</strong> and you can
            approve them again any time. This is the right tool for “I approved the wrong person”
            or “this needs to be paused while we sort something out”.
          </dd>
          <dt>Make admin / Remove admin</dt>
          <dd>
            Gives someone the exact same powers you have, including the power to delete accounts.
            Only for people the committee has actually agreed on. The site won't let you remove the
            last remaining admin, and it won't let you change your own status — that's a deliberate
            safety catch, not a bug.
          </dd>
          <dt className="hb-dt-danger">Delete account</dt>
          <dd>
            <strong>Permanent. There is no undo and no backup of it.</strong> It removes their
            login, profile, posts, comments, job listings, events, RSVPs, business listings,
            messages and uploaded files. Use <em>Un-approve</em> unless the person has genuinely
            asked to be erased or is a spam account. When in doubt, un-approve and sleep on it.
          </dd>
        </dl>

        <h4>Reports</h4>
        <dl className="hb-dl">
          <dt>View</dt>
          <dd>Jumps to the thing that was reported so you can judge it yourself.</dd>
          <dt>Mark reviewed</dt>
          <dd>“I've looked at this and dealt with it.” Use after you've removed the content.</dd>
          <dt>Dismiss</dt>
          <dd>“I've looked at this and there's nothing wrong.” Use when the report was mistaken.</dd>
        </dl>
        <p className="hb-note">
          Neither button deletes anything. To actually remove the reported item, use View, or find
          it in the Posts / Jobs / Events / Businesses tab and delete it there.
        </p>

        <h4>Posts, Jobs, Events, Businesses</h4>
        <dl className="hb-dl">
          <dt>Delete</dt>
          <dd>
            Removes the item for everyone, permanently. For events this also wipes the RSVPs.
            Members can already delete their own things, so you're only doing this for content
            that shouldn't be up.
          </dd>
          <dt>Feature / Unfeature (Businesses only)</dt>
          <dd>
            Pins a business to the top of the directory. Harmless and reversible. Worth agreeing a
            rule with the committee — e.g. only for sponsors — so it doesn't become a favour.
          </dd>
        </dl>

        <h4>Activity log</h4>
        <p>
          Every approval, removal, deletion and admin promotion is recorded automatically, with who
          did it and when. Nobody can edit or erase it, including you. It exists so questions like
          “who let this person in?” have an answer rather than an argument.
        </p>
      </Section>

      {/* ------------------------------------------------------------------ */}
      <Section
        id="hb-judgement"
        title="3. Judgement calls, decided in advance"
        summary="What to do about the awkward ones"
      >
        <p>
          Deciding these in the moment, alone, under pressure from whoever's complaining, goes
          badly. Here's a starting position for each — change them by committee decision, not on
          the fly.
        </p>
        <dl className="hb-dl">
          <dt>Someone signs up that nobody recognises</dt>
          <dd>
            Leave them pending and ask in the committee group. Pending costs them nothing but a
            wait; a wrong approval is very hard to unwind socially.
          </dd>
          <dt>An argument in the comments</dt>
          <dd>
            Let members disagree. Step in for personal attacks, not for strong opinions. Remove the
            comment, message the person privately, and only escalate to un-approving if it repeats.
          </dd>
          <dt>Someone using the site to sell things</dt>
          <dd>
            The Businesses tab is the right home for that. Move it there — i.e. remove the feed post
            and tell them to list the business — rather than banning them.
          </dd>
          <dt>A member asks you to delete their account</dt>
          <dd>
            They can do it themselves under Settings, which is cleaner. If they insist you do it,
            confirm in writing first, because it's irreversible.
          </dd>
          <dt>A member asks for someone else's contact details</dt>
          <dd>
            Don't hand them over. Point them at the messaging feature — that's exactly what it's
            for, and it lets the other person choose whether to reply.
          </dd>
          <dt>Someone has died</dt>
          <dd>
            Don't delete the account — the family may want what's there, and the deletion is
            permanent. Un-approve it so it's dormant, and ask the family what they'd like.
          </dd>
        </dl>
        <Callout tone="warn" title="Privacy, in one line">
          You can see every member's email address on this page. That list is not a mailing list
          for anything the members didn't sign up for, and it must never leave this page.
        </Callout>
      </Section>

      {/* ------------------------------------------------------------------ */}
      <Section
        id="hb-broken"
        title="4. When something breaks"
        summary="What to try, and when to stop"
      >
        <h4>Try this first, in order</h4>
        <ol className="hb-list">
          <li>Refresh the page. A surprising amount of it is this.</li>
          <li>Sign out and back in. Fixes anything caused by a stale login.</li>
          <li>Try a different browser or your phone, to see whether it's the site or your device.</li>
          <li>Ask another member whether they see it too.</li>
        </ol>

        <h4>Known messages and what they mean</h4>
        <dl className="hb-dl">
          <dt>“One-time setup needed” banner on this page</dt>
          <dd>
            A database update hasn't been run. You can't fix this from here — it needs someone
            technical. Everything else on the site keeps working in the meantime.
          </dd>
          <dt>Nobody can sign in, at all</dt>
          <dd>
            Most likely the database provider (Supabase) has paused or is having an outage. Check
            the section below on where the site lives. Usually resolves itself; if it doesn't
            within a few hours, it needs someone technical.
          </dd>
          <dt>A new member says they never got their confirmation email</dt>
          <dd>
            Tell them to check spam first. Emails are sent on a free allowance that can run out
            during a burst of signups — waiting an hour and retrying usually works.
          </dd>
          <dt>The map is blank</dt>
          <dd>
            Cosmetic, and it doesn't affect anything else. The map service allowance may have run
            out for the month. Note it and mention it to someone technical; don't panic.
          </dd>
        </dl>

        <Callout tone="warn" title="Stop and call someone technical when">
          <ul className="hb-list tight">
            <li>Members are losing data, or seeing other people's data.</li>
            <li>The whole site is down for more than a few hours.</li>
            <li>Anyone asks you to paste something into a “SQL editor” and you don't know why.</li>
            <li>You get an email saying a bill is unpaid or an account will be suspended.</li>
          </ul>
        </Callout>

        <Callout tone="bad" title="Never do these">
          <ul className="hb-list tight">
            <li>Never share the admin logins for the hosting or database accounts outside the committee.</li>
            <li>Never delete a member's account to “test whether delete works”.</li>
            <li>Never paste a command or SQL snippet that someone sent you unsolicited.</li>
            <li>Never take a copy of the member list off this page.</li>
          </ul>
        </Callout>
      </Section>

      {/* ------------------------------------------------------------------ */}
      <Section
        id="hb-where"
        title="5. Where the site actually lives"
        summary="The four services behind it, in plain English"
      >
        <p>
          You don't need to log into any of these day to day. You need to know they exist, because
          if one of them lapses, the site disappears.
        </p>
        <div className="hb-table-wrap">
          <table className="hb-table">
            <thead>
              <tr><th>Service</th><th>What it does</th><th>If it lapses</th><th>Cost</th></tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>Vercel</strong></td>
                <td>Serves the actual web page to visitors.</td>
                <td>Site shows nothing at all.</td>
                <td>Free</td>
              </tr>
              <tr>
                <td><strong>Supabase</strong></td>
                <td>
                  The database. Every member, post, message and photo. Also handles logins.
                  Project name: <code>SACS Alumni</code>.
                </td>
                <td>
                  Everything stops. This is the one that matters — the data lives here and nowhere
                  else.
                </td>
                <td>Free</td>
              </tr>
              <tr>
                <td><strong>Mapbox</strong></td>
                <td>Draws the “where are we all now” alumni map.</td>
                <td>Only the map breaks.</td>
                <td>Free</td>
              </tr>
              <tr>
                <td><strong>Cloudflare Turnstile</strong></td>
                <td>The “are you human” check on the signup form.</td>
                <td>More spam signups; site keeps working.</td>
                <td>Free</td>
              </tr>
              <tr>
                <td><strong>Domain name</strong></td>
                <td>The web address people type in.</td>
                <td>Site becomes unreachable at that address.</td>
                <td>~R180/year</td>
              </tr>
            </tbody>
          </table>
        </div>

        <Callout tone="note" title="Current address">
          There is no custom domain yet — the site runs on its free Vercel web address. Buying a
          <code> .co.za</code> domain costs roughly R180 a year and is the only thing about this
          site that costs money. {TODO('once the domain is bought, record the exact address, the registrar it was bought from, and the renewal date here.')}
        </Callout>

        <h4>What it costs to run</h4>
        <p>
          Effectively nothing. Every service sits inside a free allowance with a large margin — at
          2,000 alumni the database uses well under 1% of its limit. The full breakdown, including
          the free-tier ceilings and what to do if the site ever outgrows them, is in{' '}
          <code>SACS_Hosting_Costs.pdf</code> in the project folder.
        </p>
        <p className="hb-note">
          Two things in that document are worth knowing without reading it: Vercel's free plan
          technically disallows commercial use, so if the site ever takes payments it must move
          (Cloudflare Pages is free and has no such rule); and uploaded photos are the one limit
          that could realistically be hit, because storage is capped at 1&nbsp;GB.
        </p>
      </Section>

      {/* ------------------------------------------------------------------ */}
      <Section
        id="hb-handover"
        title="6. Handover checklist"
        summary="Do all of this before you stop being the admin"
        openByDefault
      >
        <Callout tone="warn" title="Read this if you are the outgoing admin">
          Every account behind this site is currently registered to Kyle personally, on personal
          email addresses. That is the single biggest risk to the site's survival: if those inboxes
          go stale, nobody can recover the hosting, the database, or the domain — and the members'
          data goes with them. Fixing it is the first task below, not the last.
        </Callout>

        <h4>Before you hand over</h4>
        <ol className="hb-list">
          <li>
            <strong>Create a shared committee email address</strong> (e.g. an address the committee
            controls, not an individual). Everything else hangs off this.
          </li>
          <li>
            <strong>Move each service account to that address</strong> — Vercel, Supabase, Mapbox,
            Cloudflare, and the domain registrar once a domain exists. Each one has a
            “transfer ownership” or “change email” option in its settings.
            {' '}{TODO('confirm each transfer as it is done, and tick it off here.')}
          </li>
          <li>
            <strong>Store the passwords somewhere the committee shares</strong> — a password
            manager, not a WhatsApp message. Include the Supabase database password.
          </li>
          <li>
            <strong>Make the incoming person an admin</strong> from the Members tab, and watch them
            approve someone once so you know it works.
          </li>
          <li>
            <strong>Keep at least two admins at all times.</strong> One admin is one lost phone
            away from a locked-out site.
          </li>
          <li>
            <strong>Export a backup</strong> of the database from the Supabase dashboard and give a
            copy to the committee. The free plan keeps no automatic backups — this is the only
            copy that will exist.
          </li>
          <li>
            <strong>Hand over the code.</strong> The site is built from a GitHub repository; make
            sure the committee, not one person, controls it.
            {' '}{TODO('record the repository address and who owns it.')}
          </li>
          <li>
            <strong>Walk them through this handbook</strong> in one sitting. Twenty minutes now
            saves a panicked phone call later.
          </li>
        </ol>

        <h4>Who to contact</h4>
        <p>
          {TODO('name the person who is willing to be phoned when something technical breaks, and how to reach them. Without this, section 4 has no ending.')}
        </p>
      </Section>

      {/* ------------------------------------------------------------------ */}
      <Section
        id="hb-unfinished"
        title="7. Known gaps and unfinished business"
        summary="Things a new admin will otherwise discover the hard way"
      >
        <p>
          An honest list of what isn't done. None of it stops the site working, but all of it will
          eventually confuse somebody.
        </p>
        <dl className="hb-dl">
          <dt>Approved members aren't emailed automatically</dt>
          <dd>
            When you approve someone, nothing tells them. They find out by pressing “Check my
            status” on the waiting screen, or by you messaging them. Sending it automatically needs
            an email service to be set up. Until then: <strong>tell people you've approved them.</strong>
          </dd>
          <dt>No custom domain</dt>
          <dd>The site is on its free hosting address. See section 5.</dd>
          <dt>No automatic backups</dt>
          <dd>
            The free database plan doesn't back up on a schedule. A manual export from the Supabase
            dashboard, once a term, is worth the five minutes.
          </dd>
          <dt>Photos aren't compressed before upload</dt>
          <dd>
            Storage is capped at 1&nbsp;GB. At current membership this is fine, but it's the limit
            the site would hit first if it grew. Noted here so whoever notices the warning knows
            it was expected.
          </dd>
          <dt>Two server functions may still need deploying</dt>
          <dd>
            Account deletion runs through a small server-side function. If “Delete account” ever
            fails with a “not found” error, that's what it means — it's a one-command fix for
            someone technical, and nothing is deleted in the meantime.
          </dd>
        </dl>
      </Section>

      {/* ------------------------------------------------------------------ */}
      <Section
        id="hb-tech"
        title="8. For whoever inherits the code"
        summary="Skip this unless you're technical"
      >
        <p>This section is for a developer, not for the committee admin.</p>
        <ul className="hb-list">
          <li>
            <strong>Stack:</strong> React 18 + Vite, React Router, Supabase (Postgres, Auth,
            Storage, Realtime). No backend of its own beyond two Supabase Edge Functions.
          </li>
          <li>
            <strong>Environment variables:</strong> <code>VITE_SUPABASE_URL</code>,{' '}
            <code>VITE_SUPABASE_ANON_KEY</code>, <code>VITE_MAPBOX_TOKEN</code>,{' '}
            <code>VITE_TURNSTILE_SITE_KEY</code>. All four are public by design; the service-role
            key is never in the client.
          </li>
          <li>
            <strong>Database changes</strong> are plain SQL files in the project root, numbered{' '}
            <code>schema.sql</code> then <code>schema-update-1.sql</code> onward. Run them in
            order in the Supabase SQL editor. They're written to be safe to re-run.
          </li>
          <li>
            <strong>Security model:</strong> Postgres row-level security does the real enforcement —
            the front end's checks are for UX only. <code>is_admin()</code> and{' '}
            <code>is_approved()</code> are the two functions nearly every policy leans on.
          </li>
          <li>
            <strong>Edge Functions:</strong> <code>delete-account</code> (self) and{' '}
            <code>admin-delete-member</code> (admin). Both do storage cleanup then delete the auth
            user via the Admin API. Deploy with <code>supabase functions deploy &lt;name&gt;</code>.
          </li>
          <li>
            <strong>Activity log:</strong> written by database triggers (
            <code>schema-update-52.sql</code>), not by the front end, so it can't be bypassed by a
            client bug or by someone working directly in the Supabase dashboard.
          </li>
          <li>
            <strong>Deploy:</strong> push to the GitHub repo; the host builds automatically.
            <code> npm run build</code> locally to check it compiles first.
          </li>
        </ul>
      </Section>
    </div>
  )
}
