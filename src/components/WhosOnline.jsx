// Live presence strip using Supabase Realtime Presence. Joins a shared
// "online-members" channel while mounted, so this is "who has the app open
// right now", and it forgets people the moment they close the tab.
//
// NOT the same thing as the green dot / "Recently online" sort in the
// Old Boys directory — that reads profiles.last_seen, written by the
// heartbeat in App.jsx, and survives a closed tab.
//
// Lives in its own file rather than inside Feed.jsx because Home renders it
// too: importing it from Feed pulled that whole 60 kB module (composer, rich
// text editor, comment threads, infinite scroll) into the initial bundle and
// defeated the lazy route split in App.jsx.

import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { Avatar } from './Directory.jsx'
import useModal from '../useModal.js'

export function WhosOnline({ session, onOpenProfile }) {
  const [members, setMembers] = useState([])
  const [showAll, setShowAll] = useState(false)
  // Escape, focus trap and Back-button close for the "Live members" list —
  // it was closable by backdrop click only.
  const liveMembersRef = useModal({ enabled: showAll, onClose: () => setShowAll(false) })

  useEffect(() => {
    let cancelled = false
    async function join() {
      const { data: me } = await supabase
        .from('profiles')
        .select('id, full_name, avatar_url')
        .eq('id', session.user.id)
        .single()
      if (cancelled) return

      const channel = supabase.channel('online-members', {
        config: { presence: { key: session.user.id } },
      })
      channel
        .on('presence', { event: 'sync' }, () => {
          if (cancelled) return
          const state = channel.presenceState()
          const list = Object.values(state)
            .map((entries) => entries[0])
            .filter(Boolean)
          setMembers(list)
        })
        .subscribe(async (status) => {
          // Home and Feed both render this component, so navigating quickly
          // between them can unmount before SUBSCRIBED lands — and tracking
          // into a channel that removeChannel() has already torn down throws
          // from inside a callback nothing is awaiting.
          if (status === 'SUBSCRIBED' && !cancelled) {
            await channel.track({
              id: session.user.id,
              full_name: me?.full_name || 'Alumnus',
              avatar_url: me?.avatar_url || null,
              online_at: new Date().toISOString(),
            })
          }
        })

      return () => supabase.removeChannel(channel)
    }
    const cleanupPromise = join()
    return () => {
      cancelled = true
      cleanupPromise.then((fn) => fn?.()).catch(() => { /* join bailed early — nothing to tear down */ })
    }
  }, [session.user.id])

  if (members.length === 0) return null

  const shown = members.slice(0, 9)

  return (
    <div className="whos-online">
      <div className="whos-online-head">
        {/* "Here now", not "recently online" — this is live Supabase presence
            scoped to whoever currently has this page open, and it forgets
            people the moment they close the tab. The green dot and the
            "Recently online" sort in the Old Boys directory are a
            different thing entirely (profiles.last_seen, written by the
            heartbeat in App.jsx). The old label claimed to be both. */}
        <span className="whos-online-title">
          <span className="whos-online-dot" /> Here now
        </span>
        {members.length > shown.length && (
          <button type="button" className="whos-online-seeall" onClick={() => setShowAll(true)}>See all live members ›</button>
        )}
      </div>
      <div className="whos-online-strip">
        {shown.map((m) => (
          <button type="button"
            key={m.id}
            className="whos-online-avatar"
            onClick={() => onOpenProfile?.(m.id)}
            title={m.full_name}
            aria-label={`Open profile for ${m.full_name}`}
          >
            <Avatar url={m.avatar_url} name={m.full_name} size={44} />
          </button>
        ))}
      </div>

      {showAll && (
        <div className="modal-backdrop" onClick={() => setShowAll(false)} role="dialog" aria-modal="true" aria-label="Live members">
          <div className="modal" ref={liveMembersRef} onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <div className="modal-header">
              <h2>Live members ({members.length})</h2>
              <button type="button" className="modal-close" onClick={() => setShowAll(false)} aria-label="Close">×</button>
            </div>
            <div className="modal-body">
              <ul className="whos-online-list">
                {members.map((m) => (
                  <li key={m.id}>
                    <button type="button" className="whos-online-list-row" onClick={() => { setShowAll(false); onOpenProfile?.(m.id) }}>
                      <Avatar url={m.avatar_url} name={m.full_name} size={36} />
                      <span>{m.full_name}{m.id === session.user.id ? ' (you)' : ''}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
