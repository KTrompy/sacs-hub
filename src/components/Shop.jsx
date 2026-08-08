import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import EmptyState from './EmptyState.jsx'
import LoadingState from './LoadingState.jsx'
import { formatZAR } from '../utils.js'

// Shared with MerchAdmin.jsx's product form, same reasoning as
// LEGEND_CATEGORIES living in Legends.jsx and being imported into Admin.jsx —
// one list, so the filter pills here and the dropdown there can't drift.
export const MERCH_CATEGORIES = ['Apparel', 'Headwear', 'Drinkware', 'Accessories', 'Stationery', 'Homeware', 'Other']

export default function Shop() {
  const [products, setProducts] = useState([])
  const [variantsByProduct, setVariantsByProduct] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [category, setCategory] = useState('')
  const [query, setQuery] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    let alive = true
    ;(async () => {
      setLoading(true)
      // RLS already hides inactive products from ordinary members, but the
      // SELECT policy lets admins read everything — without this filter an
      // admin browsing the shop would see hidden/draft products mixed into
      // the public storefront. Filtering here keeps the storefront identical
      // for everyone; admins preview drafts via Admin → Merch instead.
      const { data: productRows, error: productErr } = await supabase
        .from('merch_products')
        .select('id, name, description, category, base_price, image_url, created_at')
        .eq('active', true)
        .order('created_at', { ascending: false })
      if (!alive) return
      if (productErr) { setError(productErr.message); setLoading(false); return }

      const ids = (productRows || []).map((p) => p.id)
      let variantRows = []
      if (ids.length > 0) {
        const { data, error: variantErr } = await supabase
          .from('merch_variants')
          .select('id, product_id, size, color, price_delta, stock_quantity')
          .eq('active', true) // same admin-bypass reasoning as the products query above
          .in('product_id', ids)
        if (variantErr) { setError(variantErr.message); setLoading(false); return }
        variantRows = data || []
      }

      if (!alive) return
      const grouped = {}
      variantRows.forEach((v) => {
        ;(grouped[v.product_id] ||= []).push(v)
      })
      setVariantsByProduct(grouped)
      setProducts(productRows || [])
      setError(null)
      setLoading(false)
    })()
    return () => { alive = false }
  }, [])

  const categoriesPresent = useMemo(
    () => MERCH_CATEGORIES.filter((c) => products.some((p) => p.category === c)),
    [products]
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return products.filter((p) => {
      if (category && p.category !== category) return false
      if (!q) return true
      return p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)
    })
  }, [products, category, query])

  if (loading) return <LoadingState message="Loading the shop…" />

  return (
    <section className="panel merch-shop">
      <div className="panel-header-row">
        <div>
          <h2 className="panel-title">SACS Merch</h2>
          <p className="panel-sub">Old Boys kit — pick it up at a reunion or arrange collection once your order's confirmed.</p>
        </div>
      </div>

      {error && <p className="form-error">{error}</p>}

      {products.length > 0 && (
        <>
          <div className="search-wrap">
            <input
              className="search"
              type="search"
              placeholder="Search merch…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search merch"
            />
            {query && (
              <button type="button" className="search-clear" onClick={() => setQuery('')} aria-label="Clear search">×</button>
            )}
          </div>
          {categoriesPresent.length > 0 && (
            <div className="filter-radio-row pill-row">
              <button type="button" className={category === '' ? 'on' : ''} onClick={() => setCategory('')}>All</button>
              {categoriesPresent.map((c) => (
                <button type="button" key={c} className={category === c ? 'on' : ''} onClick={() => setCategory(c)}>{c}</button>
              ))}
            </div>
          )}
        </>
      )}

      {products.length === 0 ? (
        <EmptyState
          icon="business"
          message="Nothing in the shop yet."
          subMessage="Check back once the committee's added some stock — or if you're an admin, add the first item from Admin → Merch."
        />
      ) : filtered.length === 0 ? (
        <EmptyState icon="search" message="No merch matches that search." />
      ) : (
        <div className="merch-grid">
          {filtered.map((p) => {
            const variants = variantsByProduct[p.id] || []
            const inStock = variants.some((v) => v.stock_quantity > 0)
            const hasVariants = variants.length > 0
            const prices = variants.length > 0
              ? variants.map((v) => Number(p.base_price) + Number(v.price_delta))
              : [Number(p.base_price)]
            const minPrice = Math.min(...prices)
            const maxPrice = Math.max(...prices)

            return (
              <button
                type="button"
                key={p.id}
                className="merch-card"
                onClick={() => navigate(`/shop/${p.id}`)}
              >
                <div className="merch-card-image">
                  {p.image_url ? <img src={p.image_url} alt="" /> : <div className="merch-card-image-placeholder" />}
                  {hasVariants && !inStock && <span className="merch-badge merch-badge-soldout">Sold out</span>}
                </div>
                <div className="merch-card-body">
                  {p.category && <span className="merch-card-category">{p.category}</span>}
                  <span className="merch-card-name">{p.name}</span>
                  <span className="merch-card-price">
                    {minPrice === maxPrice ? formatZAR(minPrice) : `From ${formatZAR(minPrice)}`}
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </section>
  )
}
