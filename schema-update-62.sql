-- ============================================================
-- Update 62: merch shop hardening, from a full review of the flow built in
-- schema-update-59/60. Two things:
--
-- 1. place_merch_order() — two robustness fixes at the trust boundary:
--    a. Duplicate variant lines are now merged server-side. The client cart
--       merges them already (see CartContext.jsx), but the old function
--       *trusted* that: the same variant sent twice was validated against
--       the same starting stock each time, leaning on the stock_quantity >= 0
--       check constraint to abort instead of failing with a clear message.
--    b. Variants are locked in ascending id order. Two concurrent checkouts
--       whose carts overlapped in *different* orders could previously
--       deadlock (A locks v1 then wants v2; B locks v2 then wants v1) —
--       Postgres resolves it by killing one with an opaque "deadlock
--       detected". Sorted locking makes that impossible; the loser now just
--       waits and then gets the normal out-of-stock path if the winner took
--       the last unit.
--
-- 2. merch_orders.updated_at was never written — the column existed from
--    update 59 but nothing maintained it, so admin status changes left no
--    timestamp. A touch trigger now keeps it honest, same shape as the
--    existing updated_at handling elsewhere.
--
-- Run this in Supabase SQL Editor. Safe to re-run.
-- ============================================================

-- ---------- PLACE ORDER (dedupe + ordered locking) ----------
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
  v_item record;
  v_variant record;
  v_total numeric(10,2) := 0;
  v_line_total numeric(10,2);
begin
  if not public.is_approved() then
    raise exception 'Only approved members can place orders.';
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Your cart is empty.';
  end if;

  -- Reject any bad line before aggregating — summing first could let a
  -- negative line hide behind a positive one for the same variant.
  if exists (
    select 1 from jsonb_array_elements(p_items) e
    where (e->>'variant_id') is null
       or coalesce((e->>'quantity')::integer, 0) <= 0
  ) then
    raise exception 'Invalid quantity.';
  end if;

  -- Pass 1: aggregate duplicates, lock every variant row involved in
  -- ascending id order (deadlock-free), validate stock/availability, and
  -- compute the trusted total before any row is written.
  for v_item in
    select (e->>'variant_id')::bigint as variant_id,
           sum((e->>'quantity')::integer)::integer as quantity
      from jsonb_array_elements(p_items) e
     group by 1
     order by 1
  loop
    select v.id, v.stock_quantity, v.active, v.price_delta,
           p.id as product_id, p.name as product_name, p.base_price, p.active as product_active
      into v_variant
      from public.merch_variants v
      join public.merch_products p on p.id = v.product_id
      where v.id = v_item.variant_id
      for update of v;

    if v_variant.id is null or not v_variant.active or not v_variant.product_active then
      raise exception 'One of the items in your cart is no longer available.';
    end if;
    if v_variant.stock_quantity < v_item.quantity then
      raise exception '% is out of stock — only % left.', v_variant.product_name, v_variant.stock_quantity;
    end if;

    v_total := v_total + (v_variant.base_price + v_variant.price_delta) * v_item.quantity;
  end loop;

  insert into public.merch_orders (buyer_id, status, total_amount, buyer_note)
  values (auth.uid(), 'pending', v_total, coalesce(p_buyer_note, ''))
  returning id into v_order_id;

  -- Pass 2: write the order items and decrement stock now that the order
  -- row exists to hang them off. Same aggregation and order as pass 1; the
  -- rows are already locked by this transaction.
  for v_item in
    select (e->>'variant_id')::bigint as variant_id,
           sum((e->>'quantity')::integer)::integer as quantity
      from jsonb_array_elements(p_items) e
     group by 1
     order by 1
  loop
    select v.id, v.price_delta, v.size, v.color,
           p.id as product_id, p.name as product_name, p.base_price
      into v_variant
      from public.merch_variants v
      join public.merch_products p on p.id = v.product_id
      where v.id = v_item.variant_id;

    v_line_total := (v_variant.base_price + v_variant.price_delta) * v_item.quantity;

    insert into public.merch_order_items
      (order_id, product_id, variant_id, product_name, variant_label, unit_price, quantity, line_total)
    values (
      v_order_id, v_variant.product_id, v_variant.id, v_variant.product_name,
      coalesce(nullif(concat_ws(' / ', nullif(v_variant.size, ''), nullif(v_variant.color, '')), ''), ''),
      v_variant.base_price + v_variant.price_delta, v_item.quantity, v_line_total
    );

    update public.merch_variants
      set stock_quantity = stock_quantity - v_item.quantity
      where id = v_variant.id;
  end loop;

  -- Same notification pattern as notify_admins_new_signup — every admin
  -- except the buyer themselves.
  insert into public.notifications (user_id, actor_id, type, entity_type, entity_id, message)
  select a.id, auth.uid(), 'merch_order', 'merch_order', v_order_id,
         coalesce(nullif(btrim((select full_name from public.profiles where id = auth.uid())), ''), 'Someone')
           || ' placed a merch order.'
    from public.profiles a
   where a.is_admin and a.id <> auth.uid();

  return v_order_id;
end;
$$;

-- create or replace preserves existing grants (authenticated EXECUTE from
-- update 59), so no re-grant needed.

-- ---------- KEEP merch_orders.updated_at HONEST ----------
create or replace function public.touch_merch_order_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_touch_merch_order_updated_at on public.merch_orders;
create trigger trg_touch_merch_order_updated_at
  before update on public.merch_orders
  for each row execute function public.touch_merch_order_updated_at();

-- Same defensive revoke as update 60's trigger functions.
revoke all on function public.touch_merch_order_updated_at() from public, anon, authenticated;
