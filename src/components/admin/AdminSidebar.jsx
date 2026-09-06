import { NavLink } from 'react-router-dom'
import { useAdmin } from './AdminContext.jsx'
import {
  OverviewIcon, PendingIcon, MembersIcon, ReportsIcon, PostsIcon, JobsIcon,
  EventsIcon, BusinessesIcon, OrdersIcon, ProductsIcon, LegendsIcon, ActivityIcon, HandbookIcon,
} from './icons.jsx'

/* Badges are shown only where a number means "work waiting for you" —
   Pending and Reports — never just because a count exists (Members, Posts,
   Orders and so on have no badge here; their totals live on Overview). */
function useNavGroups() {
  const { readyToApprove, openReportsCount } = useAdmin()
  return [
    {
      label: 'People',
      items: [
        { to: '/admin/pending', label: 'Pending', icon: PendingIcon, badge: readyToApprove.length || null },
        { to: '/admin/members', label: 'Members', icon: MembersIcon },
        { to: '/admin/reports', label: 'Reports', icon: ReportsIcon, badge: openReportsCount || null },
      ],
    },
    {
      label: 'Content',
      items: [
        { to: '/admin/posts', label: 'Posts', icon: PostsIcon },
        { to: '/admin/jobs', label: 'Jobs', icon: JobsIcon },
        { to: '/admin/events', label: 'Events', icon: EventsIcon },
        { to: '/admin/businesses', label: 'Businesses', icon: BusinessesIcon },
      ],
    },
    {
      label: 'Shop',
      items: [
        { to: '/admin/orders', label: 'Orders', icon: OrdersIcon },
        { to: '/admin/products', label: 'Products', icon: ProductsIcon },
      ],
    },
    {
      label: 'Site',
      items: [
        { to: '/admin/legends', label: 'Legends', icon: LegendsIcon },
        { to: '/admin/activity', label: 'Activity', icon: ActivityIcon },
        { to: '/admin/handbook', label: 'Handbook', icon: HandbookIcon },
      ],
    },
  ]
}

export default function AdminSidebar({ mobileOpen, onCloseMobile }) {
  const groups = useNavGroups()

  const content = (
    <>
      <div className="adm-side-brand">
        <span className="adm-side-brand-kicker">Admin</span>
        <span className="adm-side-brand-name">SACS Alumni Hub</span>
      </div>

      <nav className="adm-side-nav" aria-label="Admin sections">
        <NavLink
          to="/admin/overview"
          className={({ isActive }) => (isActive ? 'adm-side-item adm-side-overview on' : 'adm-side-item adm-side-overview')}
          onClick={onCloseMobile}
        >
          <OverviewIcon />
          <span>Overview</span>
        </NavLink>

        {groups.map((g) => (
          <div className="adm-side-group" key={g.label}>
            <span className="adm-side-group-label">{g.label}</span>
            {g.items.map((it) => (
              <NavLink
                key={it.to}
                to={it.to}
                className={({ isActive }) => (isActive ? 'adm-side-item on' : 'adm-side-item')}
                onClick={onCloseMobile}
              >
                <it.icon />
                <span>{it.label}</span>
                {!!it.badge && <span className="adm-side-badge">{it.badge}</span>}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
    </>
  )

  return (
    <>
      <aside className="adm-sidebar" aria-label="Admin navigation">{content}</aside>

      {/* Mobile: a slide-over drawer version of the same nav, rather than a
          squeezed-down copy of the desktop rail. */}
      {mobileOpen && (
        <div className="adm-side-mobile-backdrop" onClick={onCloseMobile} role="presentation">
          <aside className="adm-sidebar adm-sidebar-mobile" onClick={(e) => e.stopPropagation()} aria-label="Admin navigation">
            {content}
          </aside>
        </div>
      )}
    </>
  )
}
