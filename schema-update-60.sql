-- ============================================================
-- Update 60: two small follow-ups to the merch shop (schema-update-59.sql),
-- both from running the Supabase security/performance advisors straight
-- after applying it. Safe to re-run.
-- ============================================================

-- Trigger functions aren't meant to be called directly via RPC (Postgres
-- refuses anyway — "trigger functions can only be called as triggers" — but
-- the security advisor flags the dangling EXECUTE grant regardless). Revoke
-- it explicitly, the same defensive move already applied to
-- log_admin_action itself.
revoke all on function public.log_merch_product_delete() from public, anon, authenticated;
revoke all on function public.log_merch_order_status_change() from public, anon, authenticated;
revoke all on function public.restore_stock_on_merch_cancel() from public, anon, authenticated;

-- Covering indexes for FKs the performance advisor flagged as unindexed.
create index if not exists merch_order_items_product_idx on public.merch_order_items (product_id);
create index if not exists merch_order_items_variant_idx on public.merch_order_items (variant_id);
create index if not exists merch_products_created_by_idx on public.merch_products (created_by);

-- "Buyers can cancel own pending order"'s WITH CHECK only constrains the
-- resulting buyer_id/status — Postgres RLS has no way to say "and no other
-- column changed" in a plain USING/WITH CHECK expression. Without this, a
-- buyer's PATCH that sets status: 'cancelled' could smuggle a changed
-- total_amount or admin_note into the same request and it would pass RLS.
-- Low severity today (no real payment moves through this table yet — see
-- Checkout.jsx), but cheap to close properly with a trigger rather than
-- lean on that.
create or replace function public.guard_merch_order_buyer_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    if new.total_amount <> old.total_amount
       or new.buyer_note <> old.buyer_note
       or new.admin_note <> old.admin_note
       or new.buyer_id <> old.buyer_id then
      raise exception 'Only the order status can be changed here.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_merch_order_buyer_update on public.merch_orders;
create trigger trg_guard_merch_order_buyer_update
  before update on public.merch_orders
  for each row execute function public.guard_merch_order_buyer_update();

revoke all on function public.guard_merch_order_buyer_update() from public, anon, authenticated;
