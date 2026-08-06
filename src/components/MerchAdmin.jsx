import { useEffect, useRef, useState } from 'react'
import { supabase, deleteStorageFilesFromUrls } from '../supabaseClient'
import EmptyState from './EmptyState.jsx'
import LoadingState from './LoadingState.jsx'
import DeleteButton from './DeleteButton.jsx'
import { useToast } from './Toast.jsx'
import { MERCH_CATEGORIES } from './Shop.jsx'
import { ORDER_STATUS_LABELS } from './MyOrders.jsx'
import { formatZAR } from '../utils.js'

const MAX_IMAGE_SIZE = 4 * 1024 * 1024
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const STATUS_FLOW = ['pending', 'confirmed', 'ready_for_pickup', 'collected', 'cancelled']

export default function MerchAdmin({ session }) {
  const [view, setView] = useState('orders')

  return (
    <>
      <div className="filter-radio-row pill-row">
        <button type="button" className={view === 'orders' ? 'on' : ''} onClick={() => setView('orders')}>Orders</button>
        <button type="button" className={view === 'products' ? 'on' : ''} onClick={() => setView('products')}>Products</button>
      </div>
      {view === 'orders' ? <MerchOrdersAdmin /> : <MerchProductsAdmin session={session} />}
    </>
  )
}

/* ================= ORDERS ================= */

function MerchOrdersAdmin() {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [statusFilter, setStatusFilter] = useState('')
  const [openId, setOpenId] = useState(null)
  const showToast = useToast()

  async function load() {
    setLoading(true)
    const { data, error: err } = await supabase
      .from('merch_orders')
      .select('*, profiles(full_name, phone), merch_order_items(*)')
      .order('created_at', { ascending: false })
    if (err) setError(err.message)
    else { setOrders(data || []); setError(null) }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

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

  if (loading) return <LoadingState message="Loading orders…" />

  const counts = {}
  orders.forEach((o) => { counts[o.status] = (counts[o.status] || 0) + 1 })
  const visible = statusFilter ? orders.filter((o) => o.status === statusFilter) : orders

  return (
    <>
      <p className="admin-tab-footnote" style={{ marginTop: 0, marginBottom: 12 }}>
        Orders land here as soon as someone checks out — nothing's actually been paid yet (there's no live
        payment gateway wired up), so "Pending" means "arrange payment with this person before moving them
        along." Cancelling an order puts its stock back automatically.
      </p>

      <div className="filter-radio-row pill-row">
        <button type="button" className={statusFilter === '' ? 'on' : ''} onClick={() => setStatusFilter('')}>
          All ({orders.length})
        </button>
        {STATUS_FLOW.map((s) => (
          <button type="button" key={s} className={statusFilter === s ? 'on' : ''} onClick={() => setStatusFilter(s)}>
            {ORDER_STATUS_LABELS[s]} ({counts[s] || 0})
          </button>
        ))}
      </div>

      {error && <p className="form-error">{error}</p>}

      {visible.length === 0 ? (
        <EmptyState icon="business" message="No orders here." />
      ) : (
        <ul className="admin-list">
          {visible.map((o) => {
            const open = openId === o.id
            return (
              <li className="admin-row order-row" key={o.id}>
                <button type="button" className="order-row-summary" onClick={() => setOpenId(open ? null : o.id)} aria-expanded={open}>
                  <div className="admin-row-info">
                    <span className="admin-row-name">
                      Order #{o.id} — {o.profiles?.full_name || 'Unknown member'}
                    </span>
                    <span className="admin-row-meta">
                      {new Date(o.created_at).toLocaleString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      {' · '}{o.merch_order_items.length} item{o.merch_order_items.length === 1 ? '' : 's'}
                      {' · '}{formatZAR(o.total_amount)}
                    </span>
                  </div>
                  <span className="order-row-chevron" aria-hidden="true">{open ? '▲' : '▼'}</span>
                </button>

                {open && (
                  <OrderDetail order={o} onSetStatus={(s) => setStatus(o, s)} onSaveNote={(n) => saveNote(o, n)} />
                )}
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}

function OrderDetail({ order, onSetStatus, onSaveNote }) {
  const [note, setNote] = useState(order.admin_note || '')
  const noteDirty = note !== (order.admin_note || '')

  return (
    <div className="order-row-detail">
      <ul className="order-items-list">
        {order.merch_order_items.map((item) => (
          <li key={item.id}>
            <span>{item.product_name}{item.variant_label ? ` — ${item.variant_label}` : ''}</span>
            <span>{item.quantity} × {formatZAR(item.unit_price)}</span>
          </li>
        ))}
      </ul>

      <p className="order-row-note">
        <strong>Contact:</strong> {order.profiles?.full_name || 'Unknown'}
        {order.profiles?.phone ? ` · ${order.profiles.phone}` : ''}
      </p>
      {order.buyer_note && <p className="order-row-note"><strong>Buyer's note:</strong> {order.buyer_note}</p>}

      <div className="order-status-row">
        <label className="field">
          <span>Status</span>
          <div className="select-wrap">
            <select value={order.status} onChange={(e) => onSetStatus(e.target.value)}>
              {STATUS_FLOW.map((s) => <option key={s} value={s}>{ORDER_STATUS_LABELS[s]}</option>)}
            </select>
          </div>
        </label>
      </div>

      <label className="field">
        <span>Internal note (not visible to the buyer)</span>
        <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
      </label>
      {noteDirty && (
        <button type="button" className="btn ghost small" onClick={() => onSaveNote(note)}>Save note</button>
      )}
    </div>
  )
}

/* ================= PRODUCTS ================= */

const EMPTY_PRODUCT = { name: '', description: '', category: MERCH_CATEGORIES[0], base_price: '', image_url: '', active: true }

function MerchProductsAdmin({ session }) {
  const [products, setProducts] = useState([])
  const [variantsByProduct, setVariantsByProduct] = useState({})
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null) // null = list, else product row or EMPTY_PRODUCT
  const showToast = useToast()

  async function load() {
    setLoading(true)
    const { data: productRows, error: pErr } = await supabase
      .from('merch_products')
      .select('*')
      .order('created_at', { ascending: false })
    if (pErr) { showToast("Couldn't load products.", { type: 'error' }); setLoading(false); return }

    const ids = (productRows || []).map((p) => p.id)
    let variantRows = []
    if (ids.length > 0) {
      const { data } = await supabase.from('merch_variants').select('id, product_id, stock_quantity, active').in('product_id', ids)
      variantRows = data || []
    }
    const grouped = {}
    variantRows.forEach((v) => { (grouped[v.product_id] ||= []).push(v) })
    setVariantsByProduct(grouped)
    setProducts(productRows || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function toggleActive(p) {
    const { error } = await supabase.from('merch_products').update({ active: !p.active }).eq('id', p.id)
    if (error) { showToast("Couldn't update that.", { type: 'error' }); return }
    setProducts((prev) => prev.map((x) => (x.id === p.id ? { ...x, active: !x.active } : x)))
  }

  async function remove(p) {
    const { error } = await supabase.from('merch_products').delete().eq('id', p.id)
    if (error) { showToast("Couldn't delete that product.", { type: 'error' }); return }
    if (p.image_url) deleteStorageFilesFromUrls('merch-images', p.image_url)
    setProducts((prev) => prev.filter((x) => x.id !== p.id))
    showToast('Product deleted')
  }

  if (editing) {
    return (
      <ProductForm
        session={session}
        initial={editing}
        // Same handler either way: even "cancel"/"close" without further
        // changes should refresh the list, since Save (which happens inline,
        // before Close is ever clicked) may already have created or edited
        // a row while this screen was open.
        onCancel={() => { setEditing(null); load() }}
        onSaved={() => { setEditing(null); load() }}
      />
    )
  }

  if (loading) return <LoadingState message="Loading products…" />

  return (
    <>
      <button type="button" className="btn primary small" style={{ marginBottom: 14 }} onClick={() => setEditing(EMPTY_PRODUCT)}>
        Add product
      </button>

      {products.length === 0 ? (
        <EmptyState
          icon="business"
          message="No products yet."
          subMessage="Add the first item — a t-shirt, a cap, whatever's in the boot of someone's car — and it'll show up in the shop once it has at least one size/colour option with stock."
        />
      ) : (
        <ul className="admin-list">
          {products.map((p) => {
            const variants = variantsByProduct[p.id] || []
            const totalStock = variants.reduce((n, v) => n + (v.active ? v.stock_quantity : 0), 0)
            return (
              <li className="admin-row" key={p.id}>
                {p.image_url ? <img className="admin-legend-thumb" src={p.image_url} alt="" /> : <div className="admin-legend-thumb admin-merch-thumb-empty" />}
                <div className="admin-row-info">
                  <span className="admin-row-name">
                    {p.name}
                    {!p.active && <span className="admin-badge" style={{ marginLeft: 8 }}>Hidden</span>}
                  </span>
                  <span className="admin-row-meta">
                    {p.category || 'Uncategorised'} · {formatZAR(p.base_price)} · {variants.length} option{variants.length === 1 ? '' : 's'} · {totalStock} in stock
                  </span>
                </div>
                <div className="admin-row-actions">
                  <button type="button" className="btn ghost small" onClick={() => toggleActive(p)}>{p.active ? 'Hide' : 'Show'}</button>
                  <button type="button" className="btn ghost small" onClick={() => setEditing(p)}>Edit</button>
                  <DeleteButton
                    onConfirm={() => remove(p)}
                    label="Delete product"
                    message="This removes the product, its size/colour options, and its photo for good. Existing orders keep a snapshot of what was bought, so past orders are unaffected. Hide is the reversible option."
                  />
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}

function ProductForm({ session, initial, onCancel, onSaved }) {
  const [product, setProduct] = useState({ ...EMPTY_PRODUCT, ...initial })
  const [imageFile, setImageFile] = useState(null)
  const [preview, setPreview] = useState(initial.image_url || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const fileRef = useRef(null)
  const showToast = useToast()

  const set = (k, v) => setProduct((f) => ({ ...f, [k]: v }))

  useEffect(() => {
    if (!imageFile) return
    const url = URL.createObjectURL(imageFile)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [imageFile])

  function pickImage(e) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    if (!IMAGE_TYPES.includes(f.type)) { setError('Photo must be a JPG, PNG or WebP.'); return }
    if (f.size > MAX_IMAGE_SIZE) { setError('Photo is over 4MB.'); return }
    setError(null)
    setImageFile(f)
  }

  async function uploadImage() {
    const ext = imageFile.name.split('.').pop().toLowerCase()
    const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
    const { error: upErr } = await supabase.storage
      .from('merch-images')
      .upload(path, imageFile, { upsert: false, contentType: imageFile.type })
    if (upErr) throw upErr
    const { data } = supabase.storage.from('merch-images').getPublicUrl(path)
    return data.publicUrl
  }

  async function save(e) {
    e.preventDefault()
    const price = Number(product.base_price)
    if (!product.name.trim()) { setError('Give the product a name.'); return }
    if (!Number.isFinite(price) || price < 0) { setError('Enter a valid price.'); return }

    setSaving(true)
    setError(null)
    try {
      let imageUrl = product.image_url
      if (imageFile) {
        imageUrl = await uploadImage()
        if (product.image_url) deleteStorageFilesFromUrls('merch-images', product.image_url)
      }

      const payload = {
        name: product.name.trim(),
        description: product.description.trim(),
        category: product.category,
        base_price: price,
        image_url: imageUrl,
        active: product.active,
      }

      if (product.id) {
        const { data, error: upErr } = await supabase
          .from('merch_products')
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq('id', product.id)
          .select()
          .single()
        if (upErr) throw upErr
        setProduct(data)
        showToast('Product saved')
      } else {
        const { data, error: insErr } = await supabase
          .from('merch_products')
          .insert({ ...payload, created_by: session.user.id })
          .select()
          .single()
        if (insErr) throw insErr
        setProduct(data)
        showToast('Product created — now add size/colour options below')
      }
    } catch (err) {
      setError(err.message || "Couldn't save that product.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="merch-admin-product-editor">
      <button type="button" className="profile-back-btn" onClick={onCancel}>‹ Products</button>

      <form onSubmit={save} className="admin-legend-form merch-product-form">
        <label className="field"><span>Name *</span>
          <input value={product.name} onChange={(e) => set('name', e.target.value)} maxLength={120} required />
        </label>

        <label className="field"><span>Description</span>
          <textarea rows={3} value={product.description} onChange={(e) => set('description', e.target.value)} maxLength={1000} />
        </label>

        <div className="field-row">
          <label className="field"><span>Category</span>
            <div className="select-wrap">
              <select value={product.category} onChange={(e) => set('category', e.target.value)}>
                {MERCH_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </label>
          <label className="field"><span>Base price (R) *</span>
            <input type="number" min="0" step="0.01" value={product.base_price} onChange={(e) => set('base_price', e.target.value)} required />
          </label>
        </div>

        <label className="field"><span>Photo</span></label>
        <div className="job-logo-picker">
          {preview
            ? <img className="admin-legend-preview" src={preview} alt="Photo preview" />
            : <div className="admin-legend-preview admin-legend-preview-empty" aria-hidden="true" />}
          <div className="job-logo-picker-actions">
            <button type="button" className="btn ghost small" onClick={() => fileRef.current?.click()}>
              {preview ? 'Replace photo' : 'Upload photo'}
            </button>
          </div>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }} onChange={pickImage} />
        </div>

        <label className="checkbox-row">
          <input type="checkbox" checked={product.active} onChange={(e) => set('active', e.target.checked)} />
          <span>Visible in the shop</span>
        </label>

        {error && <p className="form-error">{error}</p>}

        <div className="btn-row">
          <button type="button" className="btn ghost" onClick={onCancel} disabled={saving}>Close</button>
          <button type="submit" className="btn primary" disabled={saving}>{saving ? 'Saving…' : 'Save product'}</button>
        </div>
      </form>

      {product.id ? (
        <VariantsEditor productId={product.id} basePrice={price(product.base_price)} />
      ) : (
        <p className="admin-tab-footnote">Save the product first, then add its size/colour options here.</p>
      )}
    </div>
  )
}

function price(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

const EMPTY_VARIANT = { size: '', color: '', sku: '', price_delta: '0', stock_quantity: '0', active: true }

function VariantsEditor({ productId, basePrice }) {
  const [variants, setVariants] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null) // null = not editing, else variant row or EMPTY_VARIANT
  const [error, setError] = useState(null)
  const showToast = useToast()

  async function load() {
    setLoading(true)
    const { data, error: err } = await supabase
      .from('merch_variants')
      .select('*')
      .eq('product_id', productId)
      .order('id', { ascending: true })
    if (err) showToast("Couldn't load options.", { type: 'error' })
    setVariants(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [productId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function toggleActive(v) {
    const { error: err } = await supabase.from('merch_variants').update({ active: !v.active }).eq('id', v.id)
    if (err) { showToast("Couldn't update that option.", { type: 'error' }); return }
    setVariants((prev) => prev.map((x) => (x.id === v.id ? { ...x, active: !x.active } : x)))
  }

  async function remove(v) {
    const { error: err } = await supabase.from('merch_variants').delete().eq('id', v.id)
    if (err) { showToast("Couldn't delete that option.", { type: 'error' }); return }
    setVariants((prev) => prev.filter((x) => x.id !== v.id))
  }

  async function saveVariant(form) {
    setError(null)
    const stock = Number(form.stock_quantity)
    const delta = Number(form.price_delta)
    if (!Number.isFinite(stock) || stock < 0) { setError('Enter a valid stock count.'); return }
    if (!Number.isFinite(delta)) { setError('Enter a valid price adjustment.'); return }

    const payload = {
      product_id: productId,
      size: form.size.trim(),
      color: form.color.trim(),
      sku: form.sku.trim(),
      price_delta: delta,
      stock_quantity: Math.round(stock),
      active: form.active,
    }

    const q = form.id
      ? supabase.from('merch_variants').update(payload).eq('id', form.id)
      : supabase.from('merch_variants').insert(payload)
    const { error: err } = await q
    if (err) {
      setError(err.code === '23505' ? 'That size/colour combination already exists.' : (err.message || "Couldn't save that option."))
      return
    }
    setEditing(null)
    showToast('Option saved')
    load()
  }

  return (
    <div className="variants-editor">
      <h3 className="variants-editor-title">Size / colour options</h3>
      {error && <p className="form-error">{error}</p>}

      {loading ? (
        <LoadingState message="Loading options…" />
      ) : variants.length === 0 && !editing ? (
        <EmptyState message="No options yet." subMessage="A product needs at least one option — even if it's just “One size” — before it can be ordered." />
      ) : (
        <ul className="admin-list">
          {variants.map((v) => (
            <li className="admin-row" key={v.id}>
              <div className="admin-row-info">
                <span className="admin-row-name">
                  {[v.size, v.color].filter(Boolean).join(' / ') || 'One size'}
                  {!v.active && <span className="admin-badge" style={{ marginLeft: 8 }}>Hidden</span>}
                </span>
                <span className="admin-row-meta">
                  {formatZAR(basePrice + Number(v.price_delta))}
                  {v.price_delta > 0 ? ` (+${formatZAR(v.price_delta)})` : ''}
                  {' · '}{v.stock_quantity} in stock{v.sku ? ` · SKU ${v.sku}` : ''}
                </span>
              </div>
              <div className="admin-row-actions">
                <button type="button" className="btn ghost small" onClick={() => toggleActive(v)}>{v.active ? 'Hide' : 'Show'}</button>
                <button type="button" className="btn ghost small" onClick={() => setEditing(v)}>Edit</button>
                <DeleteButton onConfirm={() => remove(v)} label="Delete option" message="This removes this size/colour option. Past orders keep their own snapshot, so this won't change order history." />
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing ? (
        <VariantForm initial={editing} onCancel={() => setEditing(null)} onSave={saveVariant} />
      ) : (
        <button type="button" className="btn ghost small" onClick={() => setEditing(EMPTY_VARIANT)}>+ Add option</button>
      )}
    </div>
  )
}

function VariantForm({ initial, onCancel, onSave }) {
  const [form, setForm] = useState({ ...EMPTY_VARIANT, ...initial, price_delta: String(initial.price_delta ?? '0'), stock_quantity: String(initial.stock_quantity ?? '0') })
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  return (
    <div className="variant-form">
      <div className="field-row">
        <label className="field"><span>Size</span>
          <input value={form.size} onChange={(e) => set('size', e.target.value)} placeholder="e.g. M, or leave blank" maxLength={30} />
        </label>
        <label className="field"><span>Colour</span>
          <input value={form.color} onChange={(e) => set('color', e.target.value)} placeholder="e.g. Navy, or leave blank" maxLength={30} />
        </label>
      </div>
      <div className="field-row">
        <label className="field"><span>Price adjustment (R)</span>
          <input type="number" step="0.01" value={form.price_delta} onChange={(e) => set('price_delta', e.target.value)} />
        </label>
        <label className="field"><span>Stock</span>
          <input type="number" min="0" step="1" value={form.stock_quantity} onChange={(e) => set('stock_quantity', e.target.value)} />
        </label>
      </div>
      <label className="field"><span>SKU (optional)</span>
        <input value={form.sku} onChange={(e) => set('sku', e.target.value)} maxLength={60} />
      </label>
      <label className="checkbox-row">
        <input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} />
        <span>Available to order</span>
      </label>
      <div className="btn-row variant-form-btn-row">
        <button type="button" className="btn ghost small" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn primary small" onClick={() => onSave(form)}>Save option</button>
      </div>
    </div>
  )
}
