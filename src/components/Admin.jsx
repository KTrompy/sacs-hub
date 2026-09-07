import { Navigate, Route, Routes } from 'react-router-dom'
import AdminProvider from './admin/AdminContext.jsx'
import AdminShell from './admin/AdminShell.jsx'
import OverviewPage from './admin/OverviewPage.jsx'
import PendingPage from './admin/PendingPage.jsx'
import MembersPage from './admin/MembersPage.jsx'
import ReportsPage from './admin/ReportsPage.jsx'
import MentoringPage from './admin/MentoringPage.jsx'
import { PostsPage, JobsPage, EventsPage, BusinessesPage } from './admin/ContentPages.jsx'
import OrdersPage from './admin/OrdersPage.jsx'
import ProductsPage from './admin/ProductsPage.jsx'
import LegendsPage from './admin/LegendsPage.jsx'
import ActivityPage from './admin/ActivityPage.jsx'
import HandbookPage from './admin/HandbookPage.jsx'

/*
 * The Admin application's entry point and router.
 *
 * This used to be a single ~2000-line component holding every tab's markup,
 * state and mutations, switched between with a `subtab` string. It is now a
 * thin router: real URLs (so refresh, back/forward and bookmarking all
 * work), a persistent shell (sidebar + topbar, via AdminShell) that never
 * unmounts between sections, and one small page component per workspace.
 *
 * Nothing about WHAT the admin tools do changed in this rebuild — every
 * Supabase call, every RLS-backed guard, every confirmation dialog for a
 * destructive action, is carried over unchanged (mostly living in
 * AdminContext.jsx now, since Overview/Pending/Members/the sidebar's badges
 * all need the same member data). Only the navigation model and the visual
 * design changed. The permission boundary is still the database: this file
 * gates entry the same way it always did (see App.jsx, which only renders
 * <Admin/> at all when profile.is_admin is true), and every mutation below
 * still goes through RLS-protected tables, a security-definer RPC, or an
 * Edge Function using the Admin API — never a client-only check standing in
 * for one.
 */
export default function Admin({ session }) {
  return (
    <AdminProvider session={session}>
      <Routes>
        <Route element={<AdminShell />}>
          <Route index element={<Navigate to="overview" replace />} />
          <Route path="overview" element={<OverviewPage />} />
          <Route path="pending" element={<PendingPage />} />
          <Route path="members" element={<MembersPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="mentoring" element={<MentoringPage />} />
          <Route path="posts" element={<PostsPage />} />
          <Route path="jobs" element={<JobsPage />} />
          <Route path="events" element={<EventsPage />} />
          <Route path="businesses" element={<BusinessesPage />} />
          <Route path="orders" element={<OrdersPage />} />
          <Route path="products" element={<ProductsPage />} />
          <Route path="legends" element={<LegendsPage />} />
          <Route path="activity" element={<ActivityPage />} />
          <Route path="handbook" element={<HandbookPage />} />
          <Route path="*" element={<Navigate to="overview" replace />} />
        </Route>
      </Routes>
    </AdminProvider>
  )
}
