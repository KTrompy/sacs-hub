import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import EmptyState from './EmptyState.jsx'
import LoadingState from './LoadingState.jsx'
import ConfirmDialog from './ConfirmDialog.jsx'
import { useToast } from './Toast.jsx'
import { formatZAR } from '../utils.js'

export const ORDER_STATUS_LABELS = {
  pending: 'Awaiting confirmation',
  confirmed: 'Confirmed',
  ready_for_pickup: 'Ready for pickup',
  collected: 'Collected',
  cancelled: 'Cancelled',
}

// Same tone vocabulary as Admin.jsx's ACTION_LABELS (good/warn/bad) — kept
// separate rather than imported since this file needs to stay usable from a
// plain member's My Orders page, not just the admin panel.
const STATUS_TONE = {
  pending: 'warn',
  confirmed: 'good',
  ready_for_pickup: 'good',
  collected: 'good',
  cancelled: 'bad',
}

export default function MyOrders({ session }) {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [cancelling, setCancelling] = useState(null)
  const [openId, setOpenId] = useState(null)
  const showToast = useToast()
  const navigate = useNavigate()

  async function load() {
    setLoading(true)
    const { data, error: err } = await supabase
      .from('merch_orders')
      .select('*, merch_order_items(*)')
      .eq('buyer_id', session.user.id)
      .order('created_at', { ascending: false })
    if (err) setError(err.message)
    else { setOrders(data || []); setError(null) }
    setLoading(false)
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function confirmCancel(order) {
    setCancelling(null)
    // .select() so we can tell "cancelled" apart from "RLS filtered out every
    // row" — if an admin confirmed this order while the list here was stale,
    // the update matches nothing, err is null, and without this check we'd
    // toast success and flip the row to cancelled locally when nothing
    // actually changed on the server.
    const { data, error: err } = await supabase
      .from('merch_orders')
      .update({ status: 'cancelled' })
      .eq('id', order.id)
      .eq('status', 'pending')
      .select('id')
    if (err) { showToast("Couldn't cancel that order.", { type: 'error' }); return }
    if (!data || data.length === 0) {
      showToast("That order's already been confirmed — contact the committee to cancel it.", { type: 'error' })
      load()
      return
    }
    showToast('Order cancelled')
    setOrders((prev) => prev.map((o) => (o.id === order.id ? { ...o, status: 'cancelled' } : o)))
  }

  if (loading) return <LoadingState message="Loading your orders…" />

  return (
    <section className="panel my-orders-page">
      <div className="panel-header-row">
        <div>
          <h2 className="panel-title">My orders</h2>
          <p className="panel-sub">Everything you've ordered from the SACS shop.</p>
        </div>
      </div>

      {error && <p className="form-error">{error}</p>}

      {orders.length === 0 ? (
        <EmptyState
          icon="business"
          message="No orders yet."
          subMessage="Once you check out from the shop, your orders will show up here."
          actionLabel="Go to shop"
          onAction={() => navigate('/shop')}
        />
      ) : (
        <ul className="admin-list">
          {orders.map((o) => {
            const open = openId === o.id
            return (
              <li className="admin-row order-row" key={o.id}>
                <button type="button" className="order-row-summary" onClick={() => setOpenId(open ? null : o.id)} aria-expanded={open}>
                  <div className="admin-row-info">
                    <span className="admin-row-name">
                      Order #{o.id}
                      <span className={`order-status-badge tone-${STATUS_TONE[o.status] || 'warn'}`}>
                        {ORDER_STATUS_LABELS[o.status] || o.status}
                      </span>
                    </span>
                    <span className="admin-row-meta">
                      {new Date(o.created_at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })}
                      {' · '}{o.merch_order_items.length} item{o.merch_order_items.length === 1 ? '' : 's'}
                      {' · '}{formatZAR(o.total_amount)}
                    </span>
                  </div>
                  <span className="order-row-chevron" aria-hidden="true">{open ? '▲' : '▼'}</span>
                </button>

                {open && (
                  <div className="order-row-detail">
                    <ul className="order-items-list">
                      {o.merch_order_items.map((item) => (
                        <li key={item.id}>
                          <span>{item.product_name}{item.variant_label ? ` — ${item.variant_label}` : ''}</span>
                          <span>{item.quantity} × {formatZAR(item.unit_price)}</span>
                        </li>
                      ))}
                    </ul>
                    {o.buyer_note && <p className="order-row-note"><strong>Your note:</strong> {o.buyer_note}</p>}
                    {o.status === 'pending' && (
                      <button type="button" className="btn ghost small delete-danger" onClick={() => setCancelling(o)}>
                        Cancel order
                      </button>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {cancelling && (
        <ConfirmDialog
          title="Cancel this order?"
          message={`This releases the stock for order #${cancelling.id} back to the shop. This can't be undone.`}
          confirmLabel="Cancel order"
          onConfirm={() => confirmCancel(cancelling)}
          onCancel={() => setCancelling(null)}
        />
      )}
    </section>
  )
}
