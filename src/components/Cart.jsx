import { useNavigate } from 'react-router-dom'
import EmptyState from './EmptyState.jsx'
import { useCart } from './CartContext.jsx'
import { formatZAR } from '../utils.js'

export default function Cart() {
  const navigate = useNavigate()
  const { items, updateQuantity, removeItem, subtotal } = useCart()

  return (
    <section className="panel cart-page">
      <div className="panel-header-row">
        <div>
          <h2 className="panel-title">Your cart</h2>
          <p className="panel-sub">Nothing's charged until an admin confirms your order — this just holds your spot.</p>
        </div>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon="business"
          message="Your cart is empty."
          subMessage="Have a look through the shop — there might be something with your name on it."
          actionLabel="Go to shop"
          onAction={() => navigate('/shop')}
        />
      ) : (
        <>
          <ul className="cart-list">
            {items.map((item) => (
              <li className="cart-row" key={item.variantId}>
                <div className="cart-row-image">
                  {item.imageUrl ? <img src={item.imageUrl} alt="" /> : <div className="merch-card-image-placeholder" />}
                </div>
                <div className="cart-row-info">
                  <span className="cart-row-name">{item.productName}</span>
                  {item.variantLabel && <span className="cart-row-variant">{item.variantLabel}</span>}
                  <span className="cart-row-price">{formatZAR(item.unitPrice)} each</span>
                </div>
                <div className="qty-stepper">
                  <button type="button" onClick={() => updateQuantity(item.variantId, Math.max(1, item.quantity - 1))} disabled={item.quantity <= 1} aria-label={`Decrease quantity of ${item.productName}`}>−</button>
                  <span>{item.quantity}</span>
                  <button
                    type="button"
                    onClick={() => updateQuantity(item.variantId, item.maxStock ? Math.min(item.maxStock, item.quantity + 1) : item.quantity + 1)}
                    disabled={!!item.maxStock && item.quantity >= item.maxStock}
                    aria-label={`Increase quantity of ${item.productName}`}
                  >
                    +
                  </button>
                </div>
                <span className="cart-row-line-total">{formatZAR(item.unitPrice * item.quantity)}</span>
                <button type="button" className="icon-btn-delete" onClick={() => removeItem(item.variantId)} aria-label={`Remove ${item.productName} from cart`} title="Remove">
                  ×
                </button>
              </li>
            ))}
          </ul>

          <div className="cart-summary">
            <span className="cart-summary-label">Subtotal</span>
            <span className="cart-summary-total">{formatZAR(subtotal)}</span>
          </div>

          <div className="cart-actions">
            <button type="button" className="btn ghost" onClick={() => navigate('/shop')}>Continue shopping</button>
            <button type="button" className="btn primary" onClick={() => navigate('/shop/checkout')}>Checkout</button>
          </div>
        </>
      )}
    </section>
  )
}
