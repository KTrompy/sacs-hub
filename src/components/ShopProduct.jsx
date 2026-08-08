import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import EmptyState from './EmptyState.jsx'
import LoadingState from './LoadingState.jsx'
import { useToast } from './Toast.jsx'
import { useCart } from './CartContext.jsx'
import { formatZAR } from '../utils.js'

function variantLabel(v) {
  return [v.size, v.color].filter(Boolean).join(' / ') || 'One size'
}

export default function ShopProduct() {
  const { productId } = useParams()
  const navigate = useNavigate()
  const showToast = useToast()
  const { addItem } = useCart()

  const [product, setProduct] = useState(null)
  const [variants, setVariants] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [quantity, setQuantity] = useState(1)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      setLoading(true)
      // .eq('active', true) on both: RLS already hides inactive rows from
      // members, but admins can read everything — without the filter an admin
      // would see hidden variants in the picker (and adding one would fail at
      // checkout, since place_merch_order() re-checks active). Variants come
      // back in id (creation) order, matching the order the admin arranged
      // them in the Admin → Merch editor — sorting by size text put "L"
      // before "M" before "S".
      const [{ data: p, error: pErr }, { data: v, error: vErr }] = await Promise.all([
        supabase.from('merch_products').select('*').eq('id', productId).eq('active', true).maybeSingle(),
        supabase.from('merch_variants').select('*').eq('product_id', productId).eq('active', true).order('id', { ascending: true }),
      ])
      if (!alive) return
      if (pErr || vErr || !p) { setNotFound(true); setLoading(false); return }
      setProduct(p)
      setVariants(v || [])
      const firstInStock = (v || []).find((x) => x.stock_quantity > 0)
      setSelectedId(firstInStock?.id ?? v?.[0]?.id ?? null)
      setLoading(false)
    })()
    return () => { alive = false }
  }, [productId])

  if (loading) return <LoadingState message="Loading…" />

  if (notFound) {
    return (
      <section className="panel">
        <EmptyState icon="business" message="Item not found." subMessage="It may have been taken down." actionLabel="Back to shop" onAction={() => navigate('/shop')} />
      </section>
    )
  }

  const selected = variants.find((v) => v.id === selectedId) || null
  const unitPrice = Number(product.base_price) + Number(selected?.price_delta || 0)
  const maxQty = selected ? selected.stock_quantity : 0
  const canAdd = !!selected && selected.stock_quantity > 0 && quantity > 0 && quantity <= maxQty

  function pick(v) {
    setSelectedId(v.id)
    setQuantity(1)
  }

  function handleAddToCart() {
    if (!canAdd) return
    addItem({
      variantId: selected.id,
      productId: product.id,
      productName: product.name,
      variantLabel: variantLabel(selected),
      unitPrice,
      quantity,
      imageUrl: product.image_url,
      maxStock: selected.stock_quantity,
    })
    showToast(`Added ${quantity} × ${product.name} to your cart`)
    setQuantity(1)
  }

  return (
    <section className="panel shop-product-page">
      <button type="button" className="profile-back-btn" onClick={() => navigate('/shop')}>‹ SACS Merch</button>

      <div className="shop-product-layout">
        <div className="shop-product-image">
          {product.image_url ? <img src={product.image_url} alt={product.name} /> : <div className="merch-card-image-placeholder large" />}
        </div>

        <div className="shop-product-info">
          {product.category && <span className="merch-card-category">{product.category}</span>}
          <h2 className="panel-title">{product.name}</h2>
          <p className="shop-product-price">{formatZAR(unitPrice)}</p>
          {product.description && <p className="shop-product-description">{product.description}</p>}

          {variants.length === 0 ? (
            <p className="form-error">This item isn't available to order yet.</p>
          ) : (
            <>
              <div className="shop-product-options">
                <span className="shop-product-options-label">Options</span>
                <div className="shop-product-options-list">
                  {variants.map((v) => {
                    const soldOut = v.stock_quantity <= 0
                    return (
                      <button
                        type="button"
                        key={v.id}
                        className={[
                          'shop-variant-pill',
                          selectedId === v.id ? 'on' : '',
                          soldOut ? 'soldout' : '',
                        ].filter(Boolean).join(' ')}
                        disabled={soldOut}
                        onClick={() => pick(v)}
                      >
                        {variantLabel(v)}
                        {v.price_delta > 0 && <span className="shop-variant-pill-delta"> +{formatZAR(v.price_delta)}</span>}
                        {soldOut && <span className="shop-variant-pill-delta"> — sold out</span>}
                      </button>
                    )
                  })}
                </div>
              </div>

              {selected && (
                <>
                  <div className="shop-product-qty">
                    <span className="shop-product-options-label">Quantity</span>
                    <div className="qty-stepper">
                      <button type="button" onClick={() => setQuantity((q) => Math.max(1, q - 1))} disabled={quantity <= 1} aria-label="Decrease quantity">−</button>
                      <span>{quantity}</span>
                      <button type="button" onClick={() => setQuantity((q) => Math.min(maxQty, q + 1))} disabled={quantity >= maxQty} aria-label="Increase quantity">+</button>
                    </div>
                    <span className="shop-product-stock-hint">{maxQty} left</span>
                  </div>

                  <button type="button" className="btn primary wide" disabled={!canAdd} onClick={handleAddToCart}>
                    Add to cart
                  </button>
                </>
              )}
            </>
          )}

          <p className="merch-pickup-note">Pickup only — you'll arrange collection once your order's confirmed.</p>
        </div>
      </div>
    </section>
  )
}
