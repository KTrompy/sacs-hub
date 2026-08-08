# Prompt: Full audit and completion pass on the Merch (Shop) feature

Copy everything below into a new Claude Code / Cowork session in the sacs-hub repo.

---

Do a full, end-to-end audit of the Merch/Shop feature in this repo and bring it to a genuinely complete, production-ready state. Don't just skim — read every file involved and actually exercise the flows. Treat this as a real feature review, not a lint pass.

**Scope — every file/layer connected to Merch:**

Frontend:
- `src/components/Shop.jsx` (product listing / storefront)
- `src/components/ShopProduct.jsx` (product detail, size/colour variant picker)
- `src/components/Cart.jsx` + `src/components/CartContext.jsx` (cart state)
- `src/components/Checkout.jsx` (order placement — no live payment gateway, ends in a placeholder "Pay Now" that calls `place_merch_order()`; verify this stub is intentional and clearly labeled, not broken)
- `src/components/MyOrders.jsx` (member order history)
- `src/components/MerchAdmin.jsx` (admin product/variant/order management, mounted as the "merch" subtab inside `src/components/Admin.jsx`)
- Routing and nav in `src/App.jsx` (`/shop`, `/shop/cart`, `/shop/checkout`, `/shop/orders`, `/shop/:productId`, the "Merch" nav tab, `CartHeaderButton`/`CartProvider` wiring)
- Any shared bits it touches: `CartContext`, toast/notification usage, image handling, currency formatting

Backend (Supabase):
- Schema: `schema-update-59.sql` and any later updates that touch `merch_products`, `merch_variants`, `merch_orders`, `merch_order_items` (grep all `schema-update-*.sql` for `merch_` to get the full history) plus `schema-all.sql`/`schema.sql` for the current consolidated state
- RLS policies on all merch_* tables — confirm they match actual UI access patterns (approved-alumni-only storefront, admin-only writes, members only seeing their own orders)
- The `place_merch_order()` RPC (or equivalent) — stock decrement logic, race conditions on concurrent checkout, validation of variant/stock before insert
- Any Supabase edge functions touched by merch flows (check `supabase/functions/`) — likely none currently, confirm that's still true
- Live database: use the Supabase MCP tools (`list_tables`, `execute_sql`, `get_advisors`) to check actual current schema/RLS/indexes against what's in the .sql files — the files and the live DB can drift

**What "100% as it should be" means — check each of these explicitly:**

1. **Correctness of the full user flow**: browse → filter/search (if any) → product detail → pick variant → add to cart → view cart → checkout → order placed → view in "My Orders". Walk through this as a normal approved member would, and separately as an unapproved/pending member (should be blocked per RLS).
2. **Stock integrity**: variant stock can't go negative, two people can't buy the last unit simultaneously without one failing gracefully, out-of-stock variants are disabled/hidden correctly in the UI.
3. **Admin side**: MerchAdmin can create/edit/deactivate products and variants, see and manage orders (status transitions e.g. pending → confirmed/fulfilled), and the admin dashboard stat card (`Merch orders` count in `Admin.jsx`) reflects reality.
4. **Cart correctness**: cart persists appropriately (check whether it's meant to survive refresh/login state changes), quantities update correctly, removing items works, cart badge count in the header matches actual cart contents, cart clears after a successful order.
5. **Edge cases**: empty cart at checkout, deactivated/deleted product still in someone's cart, price_delta math on variants displaying correctly, currency formatting consistent across Shop/Cart/Checkout/MyOrders/MerchAdmin, image_url fallbacks when missing.
6. **Error handling & loading states**: network failures, RLS-denied requests, malformed input — confirm consistent use of the app's existing Toast/LoadingState/EmptyState patterns rather than ad hoc handling.
7. **Mobile/responsive rendering** of Shop, ShopProduct, Cart, Checkout, MyOrders, and the MerchAdmin panel.
8. **Accessibility**: form labels, focus management in modals/pickers, alt text on product images.
9. **Consistency with the rest of the app**: does Merch follow the same component/styling/naming conventions as other features (e.g. Jobs, Events) or has it drifted?
10. **Dead code / TODOs**: grep the whole merch surface for `TODO`, `FIXME`, `console.log`, commented-out code, and unused props/imports.
11. **The payment stub**: confirm this is a deliberate, clearly-communicated "pay offline, admin reconciles" flow (per the comment in `Checkout.jsx` and `schema-update-59.sql`) rather than something half-implemented. Don't try to wire a real payment gateway unless asked — just make sure the current stub behaves correctly and is honest with the user about what happens next.

**Process:**

1. Read every file listed above in full before making changes.
2. Query the live Supabase project (tables, RLS, advisors) to compare against the SQL files — flag any drift.
3. Build a punch list of every issue found, categorized as: bug (breaks a flow), inconsistency (works but doesn't match app conventions), gap (missing expected behavior), polish (minor UX/visual).
4. Fix everything in the bug and gap categories. Ask before making large inconsistency/polish changes if they're subjective calls rather than clear defects.
5. After fixing, re-walk the full user + admin flow described above to verify nothing regressed.
6. Run `get_advisors` again if any schema/RLS changes were made.
7. Summarize: what was broken, what you fixed, and anything you deliberately left alone with reasoning.

Do not touch unrelated features. If a fix requires a schema change, add it as a new `schema-update-N.sql` file following this repo's existing numbering convention rather than editing old ones in place.
