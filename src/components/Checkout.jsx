import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import EmptyState from './EmptyState.jsx'
import { useCart } from './CartContext.jsx'
import { formatZAR } from '../utils.js'

// No payment gateway is wired up anywhere in this app yet (see Donate.jsx) —
// same approach here: the real order flow (stock check, cart → order,
// confirmation) is fully built, but "Pay Now" is a placeholder rather than a
// live PayFast/Stripe charge. Swap handlePlaceOrder's RPC call for a real
// payment redirect later; place_merch_order() and everything downstream of
// it doesn't need to change.
export default function Checkout() {
  const navigate = useNavigate()
  const { items, subtotal, clearCart } = useCart()
  const [buyerNote, setBuyerNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [placedOrderId, setPlacedOrderId] = useState(null)

  async function handlePlaceOrder() {
    if (items.length === 0) return
    setSubmitting(true)
    setError(null)
    const { data, error: rpcError } = await supabase.rpc('place_merch_order', {
      p_items: items.map((i) => ({ variant_id: i.variantId, quantity: i.quantity })),
      p_buyer_note: buyerNote.trim(),
    })
    if (rpcError) {
      setError(rpcError.message || "Couldn't place your order.")
      setSubmitting(false)
      return
    }
    clearCart()
    setPlacedOrderId(data)
    setSubmitting(false)
  }

  if (placedOrderId) {
    return (
      <section className="panel checkout-page">
        <div className="checkout-confirmation">
          <div className="checkout-confirmation-icon" aria-hidden="true">✓</div>
          <h2 className="panel-title">Order placed</h2>
          <p>
            Order #{placedOrderId} is in — you'll get payment and collection details from the committee once
            it's confirmed. You can check its status any time under My Orders.
          </p>
          <div className="cart-actions">
            <button type="button" className="btn ghost" onClick={() => navigate('/shop')}>Back to shop</button>
            <button type="button" className="btn primary" onClick={() => navigate('/shop/orders')}>View my orders</button>
          </div>
        </div>
      </section>
    )
  }

  if (items.length === 0) {
    return (
      <section className="panel checkout-page">
        <EmptyState
          icon="business"
          message="Your cart is empty."
          subMessage="Add something from the shop before checking out."
          actionLabel="Go to shop"
          onAction={() => navigate('/shop')}
        />
      </section>
    )
  }

  return (
    <section className="panel checkout-page">
      <div className="panel-header-row">
        <div>
          <h2 className="panel-title">Checkout</h2>
          <p className="panel-sub">Pickup only — there's no shipping or delivery for merch orders.</p>
        </div>
      </div>

      <ul className="cart-list checkout-summary-list">
        {items.map((item) => (
          <li className="cart-row" key={item.variantId}>
            <div className="cart-row-image">
              {item.imageUrl ? <img src={item.imageUrl} alt="" /> : <div className="merch-card-image-placeholder" />}
            </div>
            <div className="cart-row-info">
              <span className="cart-row-name">{item.productName}</span>
              {item.variantLabel && <span className="cart-row-variant">{item.variantLabel}</span>}
              <span className="cart-row-price">{item.quantity} × {formatZAR(item.unitPrice)}</span>
            </div>
            <span className="cart-row-line-total">{formatZAR(item.unitPrice * item.quantity)}</span>
          </li>
        ))}
      </ul>

      <div className="cart-summary">
        <span className="cart-summary-label">Total</span>
        <span className="cart-summary-total">{formatZAR(subtotal)}</span>
      </div>

      <label className="field">
        <span>Anything the committee should know? (optional)</span>
        <textarea
          rows={3}
          value={buyerNote}
          onChange={(e) => setBuyerNote(e.target.value)}
          placeholder="e.g. I'll collect at the October reunion"
          maxLength={500}
        />
      </label>

      {error && <p className="form-error">{error}</p>}

      <div className="checkout-pay-block">
        <button type="button" className="btn primary wide" disabled={submitting} onClick={handlePlaceOrder}>
          {submitting ? 'Placing order…' : `Pay Now — ${formatZAR(subtotal)}`}
        </button>
        <p className="checkout-pay-note">
          Online payment isn't set up yet — this places your order and reserves the stock. The committee
          will follow up by email with how to pay and where to collect.
        </p>
      </div>
    </section>
  )
}
