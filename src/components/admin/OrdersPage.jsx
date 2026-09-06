import { useEffect, useState } from 'react'
import { supabase } from '../../supabaseClient'
import { formatZAR } from '../../utils.js'
import { ORDER_STATUS_LABELS } from '../MyOrders.jsx'
import { useToast } from '../Toast.jsx'
import EmptyState from '../EmptyState.jsx'
import { PageHeader, DataTable, StatusBadge, Toolbar, Drawer, DrawerSection, DrawerField, Skeleton } from './ui.jsx'

const STATUS_FLOW = ['pending', 'confirmed', 'ready_for_pickup', 'collected', 'cancelled']
const STATUS_TONE = { pending: 'pending', confirmed: 'info', ready_for_pickup: 'info', collected: 'good', cancelled: 'neutral' }

/* The only self-updating list in the whole admin app: merch_orders is in the
   supabase_realtime publication specifically so a new order lands here
   without a manual refresh, same as the storefront's own order list. */
export default function OrdersPage() {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [statusFilter, setStatusFilter] = useState('')
  const [openId, setOpenId] = useState(null)
  const showToast = useToast()

  async function load() {
    const { data, error: err } = await supabase
      .from('merch_orders')
      .select('*, profiles(full_name, phone), merch_order_items(*)')
      .order('created_at', { ascending: false })
    if (err) setError(err.message)
    else { setOrders(data || []); setError(null) }
    setLoading(false)
  }

  useEffect(() => {
    load()
    const channel = supabase
      .channel('admin-merch-orders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'merch_orders' }, () => load())
      .subscribe()
    return () => supabase.removeChannel(channel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function setStatus(order, status) {
    const { error: err } = await supabase.from('merch_orders').update({ status }).eq('id', order.id)
    if (err) { showToast("Couldn't update that order.", { type: 'error' }); return }
    setOrders((prev) => prev.map((o) => (o.id === order.id ? { ...o, status } : o)))
    showToast('Order updated')
  }

  async function saveNote(order, note) {
    const { error: err } = await supabase.from('merch_orders').update({ admin_note: note }).eq('id', order.id)
    if (err) { showToast("Couldn't save that note.", { type: 'error' }); return }
    setOrders((prev) => prev.map((o) => (o.id === order.id ? { ...o, admin_note: note } : o)))
    showToast('Note saved')
  }

  const counts = {}
  orders.forEach((o) => { counts[o.status] = (counts[o.status] || 0) + 1 })
  const visible = statusFilter ? orders.filter((o) => o.status === statusFilter) : orders
  const openOrder = orders.find((o) => o.id === openId)

  const columns = [
    { key: 'id', label: 'Order', render: (o) => `#${o.id}` },
    { key: 'buyer', label: 'Buyer', render: (o) => o.profiles?.full_name || 'Unknown member' },
    { key: 'items', label: 'Items', render: (o) => `${o.merch_order_items.length} item${o.merch_order_items.length === 1 ? '' : 's'}` },
    { key: 'total', label: 'Total', render: (o) => formatZAR(o.total_amount) },
    { key: 'status', label: 'Status', render: (o) => <StatusBadge tone={STATUS_TONE[o.status] || 'neutral'}>{ORDER_STATUS_LABELS[o.status] || o.status}</StatusBadge> },
    { key: 'when', label: 'Placed', render: (o) => new Date(o.created_at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' }) },
  ]

  return (
    <>
      <PageHeader
        title="Orders"
        description="Nothing's actually been paid yet — there's no live payment gateway wired up — so “Pending” means arrange payment with this person before moving them along. Cancelling puts stock back automatically."
      />

      <Toolbar
        filters={[{ id: '', label: 'All', count: orders.length }, ...STATUS_FLOW.map((s) => ({ id: s, label: ORDER_STATUS_LABELS[s], count: counts[s] || 0 }))]}
        active={statusFilter}
        onFilter={setStatusFilter}
      />

      {error && <p className="form-error">{error}</p>}

      {loading ? (
        <Skeleton rows={5} />
      ) : visible.length === 0 ? (
        <EmptyState icon="business" message="No orders here." />
      ) : (
        <DataTable columns={columns} rows={visible} onRowClick={(o) => setOpenId(o.id)} />
      )}

      <Drawer open={!!openOrder} onClose={() => setOpenId(null)} title={openOrder ? `Order #${openOrder.id}` : ''} eyebrow="Order">
        {openOrder && <OrderDrawerBody order={openOrder} onSetStatus={(s) => setStatus(openOrder, s)} onSaveNote={(n) => saveNote(openOrder, n)} />}
      </Drawer>
    </>
  )
}

function OrderDrawerBody({ order, onSetStatus, onSaveNote }) {
  const [note, setNote] = useState(order.admin_note || '')
  useEffect(() => { setNote(order.admin_note || '') }, [order.id, order.admin_note])
  const noteDirty = note !== (order.admin_note || '')

  return (
    <>
      <DrawerSection label="Items">
        <ul className="adm-order-items">
          {order.merch_order_items.map((item) => (
            <li key={item.id}>
              <span>{item.product_name}{item.variant_label ? ` — ${item.variant_label}` : ''}</span>
              <span>{item.quantity} × {formatZAR(item.unit_price)}</span>
            </li>
          ))}
        </ul>
        <DrawerField label="Total">{formatZAR(order.total_amount)}</DrawerField>
      </DrawerSection>

      <DrawerSection label="Buyer">
        <DrawerField label="Contact">{order.profiles?.full_name || 'Unknown'}{order.profiles?.phone ? ` · ${order.profiles.phone}` : ''}</DrawerField>
        <DrawerField label="Buyer's note">{order.buyer_note}</DrawerField>
      </DrawerSection>

      <DrawerSection label="Status">
        <label className="field">
          <span>Order status</span>
          <div className="select-wrap">
            <select value={order.status} onChange={(e) => onSetStatus(e.target.value)}>
              {STATUS_FLOW.map((s) => <option key={s} value={s}>{ORDER_STATUS_LABELS[s]}</option>)}
            </select>
          </div>
        </label>
        <label className="field">
          <span>Internal note (not visible to the buyer)</span>
          <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
        </label>
        {noteDirty && <button type="button" className="btn secondary small" onClick={() => onSaveNote(note)}>Save note</button>}
      </DrawerSection>
    </>
  )
}
