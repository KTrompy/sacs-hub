import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import AdminSidebar from './AdminSidebar.jsx'
import AdminTopbar from './AdminTopbar.jsx'
import { useAdmin } from './AdminContext.jsx'

/* The persistent frame: sidebar + topbar stay mounted across every admin
   route (an <Outlet/> swaps the workspace underneath them), so switching
   sections never re-renders navigation chrome, never loses scroll position
   on the rail, and — because it's real routing, not subtab state — the URL,
   the browser's Back/Forward buttons and a bookmark or shared link all work
   exactly the way they would on any other page in the app. */
export default function AdminShell() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const { needsSetup, memberError } = useAdmin()

  return (
    <div className="adm-shell">
      <AdminSidebar mobileOpen={mobileNavOpen} onCloseMobile={() => setMobileNavOpen(false)} />
      <div className="adm-shell-main">
        <AdminTopbar onOpenMobileNav={() => setMobileNavOpen(true)} />
        <div className="adm-workspace">
          {/* Shown above whichever page is active, exactly as it was shown
              beneath the old page's tab strip regardless of which subtab was
              open — a missing migration affects every workspace that reads
              `members`, not just one of them. */}
          {needsSetup ? (
            <div className="admin-setup-banner">
              <strong>One-time setup needed</strong>
              <p>
                The admin tools (approving members, granting admin access) rely on a database migration
                that hasn't been run yet. Open the Supabase dashboard for this project, go to the
                <strong> SQL Editor</strong>, and run <code>schema-update-8.sql</code> from the project
                folder — it's safe to re-run if you're not sure whether it already went through.
              </p>
              <p className="admin-setup-banner-detail">Error detail: {memberError}</p>
            </div>
          ) : memberError && (
            <p className="form-error">{memberError}</p>
          )}
          <Outlet />
        </div>
      </div>
    </div>
  )
}
