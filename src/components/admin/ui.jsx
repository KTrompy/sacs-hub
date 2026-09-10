import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { lockBodyScroll } from '../../scrollLock.js'

/* ---------- Page header ----------
   Every workspace opens the same way: an optional breadcrumb, a title, one
   line of plain-English description, and an optional right-aligned action —
   the same four things in the same order everywhere, so "where am I / what
   is this for" never has to be re-learned per page. */
export function PageHeader({ crumbs, title, description, action, children }) {
  return (
    <div className="adm-page-head">
      {crumbs && crumbs.length > 0 && (
        <nav className="adm-crumbs" aria-label="Breadcrumb">
          {crumbs.map((c, i) => (
            <span key={i}>
              {i > 0 && <span className="adm-crumb-sep" aria-hidden="true">/</span>}
              {c.onClick ? (
                <button type="button" className="adm-crumb-link" onClick={c.onClick}>{c.label}</button>
              ) : (
                <span className="adm-crumb-current">{c.label}</span>
              )}
            </span>
          ))}
        </nav>
      )}
      <div className="adm-page-head-row">
        <div>
          <h1 className="adm-page-title">{title}</h1>
          {description && <p className="adm-page-desc">{description}</p>}
        </div>
        {action && <div className="adm-page-head-action">{action}</div>}
      </div>
      {children}
    </div>
  )
}

/* ---------- Metric grid ----------
   "Site at a glance" — one unified surface with hairline dividers between
   cells rather than eight separate shadowed cards. `tone` on a cell adds a
   small status word under the value ("Needs action") without changing the
   grid's structure. */
export function MetricGrid({ metrics }) {
  return (
    <div className="adm-metric-grid">
      {metrics.map((m) => (
        <button
          type="button"
          key={m.label}
          className={m.tone ? `adm-metric adm-metric-${m.tone}` : 'adm-metric'}
          onClick={m.onClick}
          title={m.hint}
        >
          <span className="adm-metric-label">{m.label}</span>
          <span className="adm-metric-value">{m.value === null || m.value === undefined ? '–' : m.value}</span>
          <span className="adm-metric-hint">{m.hint}</span>
        </button>
      ))}
    </div>
  )
}

/* ---------- Status badge ----------
   One small component for every coloured status word in the app (member
   status, order status, report status, featured/hidden) so the same five
   tones are used everywhere rather than each page inventing its own. */
export function StatusBadge({ tone = 'neutral', children }) {
  return <span className={`adm-badge adm-badge-${tone}`}>{children}</span>
}

/* ---------- Data table ----------
   A plain, quiet table: hairline row separators, no cell borders, no zebra
   striping. `columns` is [{ key, label, render(row), className }]. Passing
   `onRowClick` makes each row a button-like target (for opening a drawer)
   without turning the row itself into a real <button> (so inline action
   buttons inside a cell still work independently). */
export function DataTable({ columns, rows, onRowClick, rowKey = (r) => r.id, emptyMessage }) {
  if (rows.length === 0) {
    return <p className="adm-table-empty">{emptyMessage || 'Nothing here yet.'}</p>
  }
  return (
    <div className="adm-table-wrap">
      <table className="adm-table">
        <thead>
          <tr>
            {columns.map((c) => <th key={c.key} className={c.className}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className={onRowClick ? 'adm-table-row clickable' : 'adm-table-row'}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              onKeyDown={onRowClick ? (e) => { if (e.key === 'Enter') onRowClick(row) } : undefined}
            >
              {columns.map((c) => <td key={c.key} className={c.className}>{c.render ? c.render(row) : row[c.key]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ---------- Drawer ----------
   The "information" half of the drawer/modal split: member details, a
   report's context, an order's line items. Slides in from the right,
   portaled to <body> for the same reason ConfirmDialog is (an ancestor row
   with a hover transform would otherwise break position:fixed), closes on
   Escape or a backdrop click, and hands focus to itself on open so a
   keyboard user isn't left behind on the trigger button. */
export function Drawer({ open, onClose, title, eyebrow, children, footer, wide }) {
  const panelRef = useRef(null)

  useEffect(() => {
    if (!open) return
    function onKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    panelRef.current?.focus()
    const unlockScroll = lockBodyScroll()
    return () => {
      document.removeEventListener('keydown', onKey)
      unlockScroll()
    }
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div className="adm-drawer-backdrop" onClick={onClose} role="presentation">
      <div
        className={wide ? 'adm-drawer adm-drawer-wide' : 'adm-drawer'}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={panelRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="adm-drawer-head">
          <div>
            {eyebrow && <span className="adm-drawer-eyebrow">{eyebrow}</span>}
            <h2>{title}</h2>
          </div>
          <button type="button" className="adm-drawer-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="adm-drawer-body">{children}</div>
        {footer && <div className="adm-drawer-footer">{footer}</div>}
      </div>
    </div>,
    document.body
  )
}

/* A labelled group of fields inside a drawer — "PROFILE", "MEMBERSHIP",
   "ACCOUNT" — so a dense record still reads in named chunks. */
export function DrawerSection({ label, children }) {
  return (
    <div className="adm-drawer-section">
      {label && <h3 className="adm-drawer-section-label">{label}</h3>}
      {children}
    </div>
  )
}

export function DrawerField({ label, children }) {
  if (children === undefined || children === null || children === '') return null
  return (
    <div className="adm-drawer-field">
      <span className="adm-drawer-field-label">{label}</span>
      <span className="adm-drawer-field-value">{children}</span>
    </div>
  )
}

/* ---------- Loading skeleton ----------
   Rough shape of the real layout instead of a spinner, per row. `rows`
   controls how many placeholder lines to draw. */
export function Skeleton({ rows = 4 }) {
  return (
    <div className="adm-skeleton" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div className="adm-skeleton-row" key={i}>
          <span className="adm-skeleton-bar" style={{ width: '28%' }} />
          <span className="adm-skeleton-bar" style={{ width: '18%' }} />
          <span className="adm-skeleton-bar" style={{ width: '40%' }} />
        </div>
      ))}
    </div>
  )
}

/* Simple toolbar row: a search box plus a row of filter chips, shared by
   every list-based page instead of each re-implementing the same layout. */
export function Toolbar({ search, onSearch, searchPlaceholder, filters, active, onFilter }) {
  return (
    <div className="adm-toolbar">
      {onSearch && (
        <input
          className="adm-search"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder={searchPlaceholder || 'Search…'}
        />
      )}
      {filters && filters.length > 0 && (
        <div className="adm-chip-row" role="group">
          {filters.map((f) => (
            <button
              type="button"
              key={f.id}
              className={active === f.id ? 'adm-chip on' : 'adm-chip'}
              onClick={() => onFilter(f.id)}
            >
              {f.label}{f.count !== undefined ? <span className="adm-chip-count">{f.count}</span> : null}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
