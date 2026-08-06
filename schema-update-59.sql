-- ============================================================
-- Update 59: Merch shop.
--
-- Products with size/colour variants (each variant carries its own stock),
-- orders and order items, pickup-only fulfilment, approved-alumni-only
-- storefront. Checkout ends in a placeholder "Pay Now" button (see
-- Checkout.jsx) rather than a real payment gateway — same "ship the real
-- feature, stub the payment" approach as Donate.jsx. Orders land as
-- 'pending' and an admin reconciles/confirms them once payment is arranged
-- separately. Swap the placeholder button for PayFast/Stripe later without
-- touching this schema.
--
-- Run this in Supabase SQL Editor. Safe to re-run.
-- ============================================================

-- ---------- PRODUCTS ----------
create table if not exists public.merch_products (
  id bigint generated always as identity primary key,
  name text not null,
  description text not null default '',
  category text not null default '',
  base_price numeric(10,2) not null check (base_price >= 0),
  image_url text not null default '',
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

alter table public.merch_products enable row level security;

drop policy if exists "Approved members can read active products" on public.merch_products;
create policy "Approved members can read active products"
  on public.merch_products for select to authenticated
  using (public.is_admin() or (active and public.is_approved()));

drop policy if exists "Admins manage products" on public.merch_products;
create policy "Admins manage products"
  on public.merch_products for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------- VARIANTS (size / colour, each with its own stock) ----------
create table if not exists public.merch_variants (
  id bigint generated always as identity primary key,
  product_id bigint not null references public.merch_products(id) on delete cascade,
  size text not null default '',
  color text not null default '',
  sku text not null default '',
  price_delta numeric(10,2) not null default 0,
  stock_quantity integer not null default 0 check (stock_quantity >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (product_id, size, color)
);

alter table public.merch_variants enable row level security;

drop policy if exists "Approved members can read active variants" on public.merch_variants;
create policy "Approved members can read active variants"
  on public.merch_variants for select to authenticated
  using (
    public.is_admin()
    or (
      active and public.is_approved()
      and exists (select 1 from public.merch_products p where p.id = product_id and p.active)
    )
  );

drop policy if exists "Admins manage variants" on public.merch_variants;
create policy "Admins manage variants"
  on public.merch_variants for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create index if not exists merch_variants_product_idx on public.merch_variants (product_id);

-- ---------- ORDERS ----------
create table if not exists public.merch_orders (
  id bigint generated always as identity primary key,
  buyer_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'ready_for_pickup', 'collected', 'cancelled')),
  total_amount numeric(10,2) not null check (total_amount >= 0),
  buyer_note text not null default '',
  admin_note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

alter table public.merch_orders enable row level security;

drop policy if exists "Buyers read own orders" on public.merch_orders;
create policy "Buyers read own orders"
  on public.merch_orders for select to authenticated
  using (buyer_id = auth.uid() or public.is_admin());

-- No insert policy for authenticated on purpose — orders are created through
-- place_merch_order() below (security definer), which checks stock and
-- decrements it atomically. A raw client insert could race two buyers for
-- the last item, or insert a total that doesn't match the cart.

-- Buyers can cancel their own order while it's still unconfirmed. Every
-- other transition (confirming, ready for pickup, collected, or cancelling
-- anything past 'pending') is admin-only, via the policy below.
drop policy if exists "Buyers can cancel own pending order" on public.merch_orders;
create policy "Buyers can cancel own pending order"
  on public.merch_orders for update to authenticated
  using (buyer_id = auth.uid() and status = 'pending')
  with check (buyer_id = auth.uid() and status = 'cancelled');

drop policy if exists "Admins manage orders" on public.merch_orders;
create policy "Admins manage orders"
  on public.merch_orders for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create index if not exists merch_orders_buyer_idx on public.merch_orders (buyer_id);
create index if not exists merch_orders_status_idx on public.merch_orders (status);

-- ---------- ORDER ITEMS ----------
create table if not exists public.merch_order_items (
  id bigint generated always as identity primary key,
  order_id bigint not null references public.merch_orders(id) on delete cascade,
  product_id bigint references public.merch_products(id) on delete set null,
  variant_id bigint references public.merch_variants(id) on delete set null,
  -- Snapshots: an order should still read sensibly after the product is
  -- edited, hidden, or deleted — same reasoning as actor_name/target_label
  -- on admin_actions.
  product_name text not null,
  variant_label text not null default '',
  unit_price numeric(10,2) not null check (unit_price >= 0),
  quantity integer not null check (quantity > 0),
  line_total numeric(10,2) not null check (line_total >= 0)
);

alter table public.merch_order_items enable row level security;

drop policy if exists "Read own order items" on public.merch_order_items;
create policy "Read own order items"
  on public.merch_order_items for select to authenticated
  using (
    public.is_admin()
    or exists (select 1 from public.merch_orders o where o.id = order_id and o.buyer_id = auth.uid())
  );

-- No insert/update/delete policy for authenticated — rows are only ever
-- written by place_merch_order() below, the same pattern notifications uses.

create index if not exists merch_order_items_order_idx on public.merch_order_items (order_id);

-- ---------- PLACE ORDER (atomic stock check + decrement) ----------
-- Takes a JSON array of {variant_id, quantity}. Price and current stock are
-- re-read server-side rather than trusted from the client, so a stale price
-- in a browser tab that's been open a while can't buy at yesterday's price,
-- and `for update` locks each variant row so two people racing the last
-- hoodie can't both "win". The cart on the client is expected to merge
-- duplicate variants into one line before calling this — a variant repeated
-- across two lines is checked against the same starting stock for each.
create or replace function public.place_merch_order(
  p_items jsonb,
  p_buyer_note text default ''
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id bigint;
  v_item jsonb;
  v_variant record;
  v_total numeric(10,2) := 0;
  v_line_total numeric(10,2);
  v_qty integer;
begin
  if not public.is_approved() then
    raise exception 'Only approved members can place orders.';
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Your cart is empty.';
  end if;

  -- Pass 1: lock every variant row involved and validate stock/availability,
  -- computing the trusted total before any row is written.
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_qty := (v_item->>'quantity')::integer;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Invalid quantity.';
    end if;

    select v.id, v.stock_quantity, v.active, v.price_delta,
           p.id as product_id, p.name as product_name, p.base_price, p.active as product_active
      into v_variant
      from public.merch_variants v
      join public.merch_products p on p.id = v.product_id
      where v.id = (v_item->>'variant_id')::bigint
      for update of v;

    if v_variant.id is null or not v_variant.active or not v_variant.product_active then
      raise exception 'One of the items in your cart is no longer available.';
    end if;
    if v_variant.stock_quantity < v_qty then
      raise exception '% is out of stock — only % left.', v_variant.product_name, v_variant.stock_quantity;
    end if;

    v_line_total := (v_variant.base_price + v_variant.price_delta) * v_qty;
    v_total := v_total + v_line_total;
  end loop;

  insert into public.merch_orders (buyer_id, status, total_amount, buyer_note)
  values (auth.uid(), 'pending', v_total, coalesce(p_buyer_note, ''))
  returning id into v_order_id;

  -- Pass 2: write the order items and decrement stock now that the order
  -- row exists to hang them off.
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_qty := (v_item->>'quantity')::integer;

    select v.id, v.stock_quantity, v.price_delta, v.size, v.color,
           p.id as product_id, p.name as product_name, p.base_price
      into v_variant
      from public.merch_variants v
      join public.merch_products p on p.id = v.product_id
      where v.id = (v_item->>'variant_id')::bigint
      for update of v;

    v_line_total := (v_variant.base_price + v_variant.price_delta) * v_qty;

    insert into public.merch_order_items
      (order_id, product_id, variant_id, product_name, variant_label, unit_price, quantity, line_total)
    values (
      v_order_id, v_variant.product_id, v_variant.id, v_variant.product_name,
      coalesce(nullif(concat_ws(' / ', nullif(v_variant.size, ''), nullif(v_variant.color, '')), ''), ''),
      v_variant.base_price + v_variant.price_delta, v_qty, v_line_total
    );

    update public.merch_variants
      set stock_quantity = stock_quantity - v_qty
      where id = v_variant.id;
  end loop;

  -- Same notification pattern as notify_admins_new_signup — every admin
  -- except the buyer themselves (an admin buying something shouldn't notify
  -- themselves).
  insert into public.notifications (user_id, actor_id, type, entity_type, entity_id, message)
  select a.id, auth.uid(), 'merch_order', 'merch_order', v_order_id,
         coalesce(nullif(btrim((select full_name from public.profiles where id = auth.uid())), ''), 'Someone')
           || ' placed a merch order.'
    from public.profiles a
   where a.is_admin and a.id <> auth.uid();

  return v_order_id;
end;
$$;

-- Callable by any signed-in user — is_approved() inside does the real gate,
-- same shape as job_applications' insert policy but as an RPC instead of a
-- raw insert because it needs to do more than one thing atomically.
revoke all on function public.place_merch_order(jsonb, text) from public, anon;
grant execute on function public.place_merch_order(jsonb, text) to authenticated;

-- ---------- STOCK RESTORE ON CANCEL ----------
-- Whichever path cancels an order (buyer self-cancel or admin), the stock
-- that order reserved should come back. A trigger on the table catches both
-- instead of needing the restore logic duplicated in two RLS-gated call sites.
create or replace function public.restore_stock_on_merch_cancel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    update public.merch_variants v
      set stock_quantity = v.stock_quantity + oi.quantity
      from public.merch_order_items oi
      where oi.order_id = new.id and oi.variant_id = v.id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_restore_stock_on_merch_cancel on public.merch_orders;
create trigger trg_restore_stock_on_merch_cancel
  after update on public.merch_orders
  for each row execute function public.restore_stock_on_merch_cancel();

-- ---------- ACTIVITY LOG ----------
-- Follows the existing admin_actions convention (see schema-all.sql's
-- log_job_moderation/log_event_moderation): log admin-initiated actions,
-- not a member's own routine self-service ones.
create or replace function public.log_merch_product_delete()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  perform public.log_admin_action('delete_merch_product', 'merch_product', old.id::text, old.name, null);
  return old;
end;
$$;

drop trigger if exists on_merch_product_delete on public.merch_products;
create trigger on_merch_product_delete before delete on public.merch_products
  for each row execute function public.log_merch_product_delete();

create or replace function public.log_merch_order_status_change()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_buyer_name text;
begin
  if new.status = old.status then return new; end if;
  -- Don't log a buyer cancelling their own order — that's the normal
  -- ungated self-service action, same reasoning as skipping the log when a
  -- job poster deletes their own listing.
  if auth.uid() = new.buyer_id then return new; end if;
  select full_name into v_buyer_name from public.profiles where id = new.buyer_id;
  perform public.log_admin_action(
    'update_merch_order_status',
    'merch_order',
    new.id::text,
    'Order #' || new.id || ' — ' || coalesce(nullif(v_buyer_name, ''), 'unknown buyer'),
    old.status || ' → ' || new.status
  );
  return new;
end;
$$;

drop trigger if exists on_merch_order_status_change on public.merch_orders;
create trigger on_merch_order_status_change after update on public.merch_orders
  for each row execute function public.log_merch_order_status_change();

-- ---------- MERCH IMAGES STORAGE ----------
-- Public read (product photos are meant to be seen), admin-only write —
-- unlike job-logos/legend-photos, ordinary members never upload here since
-- only admins create products.
insert into storage.buckets (id, name, public)
values ('merch-images', 'merch-images', true)
on conflict (id) do nothing;

drop policy if exists "Anyone can view merch images" on storage.objects;
create policy "Anyone can view merch images"
  on storage.objects for select
  using (bucket_id = 'merch-images');

drop policy if exists "Admins upload merch images" on storage.objects;
create policy "Admins upload merch images"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'merch-images' and public.is_admin());

drop policy if exists "Admins replace merch images" on storage.objects;
create policy "Admins replace merch images"
  on storage.objects for update to authenticated
  using (bucket_id = 'merch-images' and public.is_admin());

drop policy if exists "Admins delete merch images" on storage.objects;
create policy "Admins delete merch images"
  on storage.objects for delete to authenticated
  using (bucket_id = 'merch-images' and public.is_admin());

-- ---------- REALTIME ----------
-- So an admin sitting on the Orders tab sees a new order land without a
-- manual refresh, same treatment notifications got in schema-update-9.
do $$
begin
  perform 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'merch_orders';
  if not found then alter publication supabase_realtime add table public.merch_orders; end if;
end $$;
