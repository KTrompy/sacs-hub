import { useState } from 'react'
import AdminHandbook from '../AdminHandbook.jsx'
import { PageHeader } from './ui.jsx'

const SECTIONS = [
  { id: 'hb-job', num: 1, title: 'What the job actually is', summary: 'About 10 minutes a week' },
  { id: 'hb-tools', num: 2, title: 'Every button, and what it does', summary: 'Read before you click anything with a red label' },
  { id: 'hb-judgement', num: 3, title: 'Judgement calls, decided in advance', summary: 'What to do about the awkward ones' },
  { id: 'hb-broken', num: 4, title: 'When something breaks', summary: 'What to try, and when to stop' },
  { id: 'hb-where', num: 5, title: 'Where the site actually lives', summary: 'The four services behind it, in plain English' },
  { id: 'hb-handover', num: 6, title: 'Handover checklist', summary: 'Do all of this before you stop being the admin' },
  { id: 'hb-unfinished', num: 7, title: 'Known gaps and unfinished business', summary: 'Things a new admin will otherwise discover the hard way' },
  { id: 'hb-tech', num: 8, title: 'For whoever inherits the code', summary: "Skip this unless you're technical" },
]

// Three doors in, for the three moods someone actually opens this page in:
// brand new to the job, something is currently on fire, or handing it off
// to someone else. Everything else is one click away in the left nav.
const ENTRY_BLOCKS = [
  { id: 'hb-job', label: 'New to the job?', desc: 'Start here — the whole role, in about ten minutes.' },
  { id: 'hb-broken', label: 'Something broke', desc: 'What to try, and exactly when to stop and call someone technical.' },
  { id: 'hb-handover', label: 'Handing over?', desc: 'The checklist to work through before you stop being the admin.' },
]

/* Apple-style docs layout: a left nav of fixed section names and a right
   pane that shows exactly one of them at a time, plus a landing view (no
   section selected) that offers three obvious starting points rather than
   a wall of eight equally-weighted links. */
export default function HandbookPage() {
  const [activeId, setActiveId] = useState(null)
  const active = SECTIONS.find((s) => s.id === activeId)

  return (
    <div className="adm-handbook-shell">
      <nav className="adm-handbook-nav" aria-label="Handbook sections">
        <button type="button" className={!activeId ? 'adm-handbook-nav-item on' : 'adm-handbook-nav-item'} onClick={() => setActiveId(null)}>
          Handbook home
        </button>
        {SECTIONS.map((s) => (
          <button
            type="button"
            key={s.id}
            className={activeId === s.id ? 'adm-handbook-nav-item on' : 'adm-handbook-nav-item'}
            onClick={() => setActiveId(s.id)}
          >
            <span className="adm-handbook-nav-num">{s.num}</span>
            <span>{s.title}</span>
          </button>
        ))}
      </nav>

      <div className="adm-handbook-content">
        {!activeId ? (
          <>
            <PageHeader
              title="Running SACS Alumni Hub"
              description="This is the whole job, written down. It assumes you've never touched the technical side of a website — you don't need to. If you're handing this site over to someone else, point them here first."
            />
            <div className="adm-handbook-entries">
              {ENTRY_BLOCKS.map((e) => (
                <button type="button" className="adm-handbook-entry" key={e.id} onClick={() => setActiveId(e.id)}>
                  <strong>{e.label}</strong>
                  <p>{e.desc}</p>
                </button>
              ))}
            </div>
            <h3 className="adm-content-heading">Everything else</h3>
            <ul className="adm-handbook-toc">
              {SECTIONS.map((s) => (
                <li key={s.id}>
                  <button type="button" onClick={() => setActiveId(s.id)}>
                    <span className="adm-handbook-nav-num">{s.num}</span> {s.title}
                    <span className="adm-content-preview">{s.summary}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <PageHeader
              crumbs={[{ label: 'Handbook', onClick: () => setActiveId(null) }, { label: active.title }]}
              title={`${active.num}. ${active.title}`}
              description={active.summary}
            />
            <AdminHandbook activeId={activeId} />
          </>
        )}
      </div>
    </div>
  )
}
