import { createContext, useContext, useEffect, useMemo, useState } from 'react'

// Client-side merch cart. Nothing here is trusted server-side — the price
// and stock shown in the cart are re-checked (and the authoritative total
// re-computed) inside place_merch_order() at checkout, same reasoning as
// that function's own comment. This is just what lets someone browse the
// shop, build up a cart across a few page visits, and see a running total
// without a round trip on every click.
//
// Persisted to localStorage (not sessionStorage) so a cart survives closing
// the tab — the same expectation any shopping site sets. Keyed by variant
// id, not product id, since two sizes of the same hoodie are different line
// items with different stock.
const CART_STORAGE_KEY = 'sacs-merch-cart-v1'
const CartContext = createContext(null)

function loadCart() {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(CART_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((i) => i && i.variantId && i.quantity > 0) : []
  } catch {
    return []
  }
}

export function CartProvider({ children }) {
  const [items, setItems] = useState(loadCart)

  useEffect(() => {
    try { window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items)) } catch {
      // Best-effort — a full/blocked localStorage shouldn't break shopping,
      // just mean the cart doesn't survive a reload.
    }
  }, [items])

  // item: { variantId, productId, productName, variantLabel, unitPrice,
  //          quantity, imageUrl, maxStock }
  // Adding an already-present variant merges quantities (capped at the
  // stock this component last saw) rather than adding a duplicate line —
  // the place_merch_order() comment on the server side assumes the cart
  // never sends the same variant twice.
  function addItem(item) {
    setItems((prev) => {
      const idx = prev.findIndex((i) => i.variantId === item.variantId)
      if (idx === -1) return [...prev, item]
      const next = [...prev]
      const cap = item.maxStock ?? next[idx].maxStock ?? Infinity
      next[idx] = { ...next[idx], ...item, quantity: Math.min(next[idx].quantity + item.quantity, cap) }
      return next
    })
  }

  function updateQuantity(variantId, quantity) {
    setItems((prev) => prev
      .map((i) => (i.variantId === variantId ? { ...i, quantity } : i))
      .filter((i) => i.quantity > 0))
  }

  function removeItem(variantId) {
    setItems((prev) => prev.filter((i) => i.variantId !== variantId))
  }

  function clearCart() {
    setItems([])
  }

  const count = useMemo(() => items.reduce((n, i) => n + i.quantity, 0), [items])
  const subtotal = useMemo(() => items.reduce((n, i) => n + i.unitPrice * i.quantity, 0), [items])

  const value = useMemo(
    () => ({ items, addItem, updateQuantity, removeItem, clearCart, count, subtotal }),
    [items, count, subtotal]
  )

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export function useCart() {
  const ctx = useContext(CartContext)
  // Falls back to a harmless no-op cart rather than throwing — a stray
  // import of a component that reads useCart() outside the provider (tests,
  // Storybook-style previews) shouldn't crash the whole tree over a cart
  // badge.
  return ctx || { items: [], addItem: () => {}, updateQuantity: () => {}, removeItem: () => {}, clearCart: () => {}, count: 0, subtotal: 0 }
}
