# DESIGN.md — Visual Design System

> Documents the actual design tokens, components, and conventions found in `src/styles.css`.
> All values come from the codebase — nothing is invented.

---

## 1. Brand Palette

| Token | Value | Role |
|-------|-------|------|
| `--orange` | `#6EC3E8` | SACS baby blue — primary accent |
| `--orange-dark` | `#3E9DC9` | Hover/active accent |
| `--orange-soft` | `#E6F6FC` | Pale blue background wash |
| `--maroon` | `#002F5F` | SACS navy — primary brand |
| `--maroon-dark` | `#001B37` | Deeper navy for headers |
| `--maroon-soft` | `#33547F` | Softer navy for accents |
| `--paper` | `#FAF7F2` | Page background (cream) |
| `--card` | `#FFFFFF` | Card/panel surface |
| `--ink` | `#1A1A1A` | Primary text |
| `--ink-soft` | `#5C5C5C` | Secondary/muted text |
| `--line` | `#E8E1D5` | Borders, dividers |
| `--line-strong` | `#C9BFAE` | Emphasized borders |
| `--danger` | `#A33327` | Destructive actions, errors |
| `--ok` | `#2C6E49` | Success states |

**RGB channels** (for `rgba()` washes/shadows):

| Token | Channels | Source |
|-------|----------|--------|
| `--accent-rgb` | `110, 195, 232` | `--orange` |
| `--accent-dark-rgb` | `62, 157, 201` | `--orange-dark` |
| `--primary-rgb` | `0, 47, 95` | `--maroon` |

> **Naming note:** `--orange` and `--maroon` are legacy names from an earlier color scheme. They now hold blue/navy values. A future refactor may rename to `--accent`/`--primary`. All new code should use the existing names for consistency.

---

## 2. Typography

### Font Families

| Token | Value | Usage |
|-------|-------|-------|
| `--display` | `Georgia, 'Times New Roman', serif` | Headings, display text |
| `--body` | `'Inter', sans-serif` | Body text, UI elements |

### Type Scale

| Token | Size | Usage |
|-------|------|-------|
| `--fs-2xs` | `10.5px` | Overlines, eyebrows |
| `--fs-xs` | `12px` | Meta text, badges, timestamps |
| `--fs-sm` | `13px` | Secondary text, captions |
| `--fs-base` | `14px` | Body/UI default |
| `--fs-md` | `15px` | Emphasized body (also the `<body>` font-size) |
| `--fs-lg` | `17px` | Card titles |
| `--fs-xl` | `20px` | Section titles |
| `--fs-2xl` | `24px` | Modal/sub-page titles |
| `--fs-3xl` | `30px` | Page titles |

### Line Height

Body line-height: `1.55`

### Mobile Input Font Fix

On touch devices (`hover: none` + `pointer: coarse`), inputs/textareas/selects are forced to `--fs-lg` (17px) to prevent iOS Safari auto-zoom on inputs with computed font-size below 16px.

---

## 3. Spacing Scale

| Token | Value | Semantic |
|-------|-------|----------|
| `--sp-1` | `4px` | Minimal (icon gaps) |
| `--sp-2` | `8px` | Tight (between related items) |
| `--sp-3` | `12px` | Small (list item padding) |
| `--sp-4` | `16px` | Medium (standard padding) |
| `--sp-5` | `20px` | Comfortable (card padding) |
| `--sp-6` | `24px` | Spacious (section gaps) |
| `--sp-7` | `32px` | Large (section separators) |
| `--sp-8` | `48px` | Extra large (page-level spacing) |

Use these tokens for padding, margin, and gap. Avoid ad-hoc pixel values.

---

## 4. Border Radius Scale

| Token | Value | Usage |
|-------|-------|-------|
| `--radius-xs` | `4px` | Tiny controls (checkbox-sized) |
| `--radius-sm` | `8px` | Inputs, menu items |
| `--radius` | `12px` | Buttons, inputs, cards (default) |
| `--radius-lg` | `20px` | Big cards, panels |
| `--radius-xl` | `24px` | Page heroes, sidebar shell |
| `--radius-pill` | `999px` | Chips, badges, avatars, pills |

---

## 5. Shadows

| Token | Value | Usage |
|-------|-------|-------|
| `--shadow-card` | `0 1px 2px rgba(26,26,26,0.05), 0 2px 8px rgba(26,26,26,0.05)` | Card resting state |
| `--shadow-lift` | `0 16px 36px rgba(26,26,26,0.14)` | Hover lift, modals |

---

## 6. Motion

### Easing

| Token | Value | Usage |
|-------|-------|-------|
| `--ease` | `cubic-bezier(0.22, 1, 0.36, 1)` | All hover/entrance transitions |

### Animations

| Name | Effect | Duration | Used by |
|------|--------|----------|---------|
| `fade-in` | `opacity: 0 → 1` | 0.15–0.3s | Panels, modals, overlays |
| `rise-in` | `translateY(14px) + opacity: 0 → none + 1` | 0.2–0.25s | Profile modals, cards |
| `slide-in-right` | `translateX(100%) → 0` | 0.3s | Mobile filter drawer |
| `slide-in-left` | `translateX(-100%) → 0` | 0.3s | Mobile nav drawer |
| `toast-in` | `translateY(100%) → 0` | 0.18s | Toast notifications |
| `slideUp` | `translateY(16px) + opacity → 0` | 0.2s | Composer modal |
| `onboarding-in` | Entry animation | 0.28s | Onboarding wizard |
| `fade-out` | `opacity: 1 → 0` | 0.15s | Profile section collapse |

### Reduced Motion

`@media (prefers-reduced-motion: reduce)` disables all transitions and animations globally:
```css
* { scroll-behavior: auto !important; transition: none !important; animation: none !important; }
```

A separate rule also disables the Legends tile hover transform specifically.

---

## 7. Layout System

### Page Structure

```
.masthead          (full-width navy header bar)
  .masthead-inner  (max-width container, flex row)
.hero-banner       (optional, full-bleed hero with gradient fade)
.app-body          (max-width: 1360px, flex row, auto margins)
  .sidebar         (216px, sticky, rounded card, desktop only)
  .app-main        (flex: 1, min-height: calc(100vh - 65px))
    .content       (padding: 18px 24px 60px)
      .panel       (page-level container, fade-in animation)
```

### Sidebar

- Width: 216px, sticky (`top: 85px`), full viewport height minus header
- Background: `--card`, border: `--line`, radius: `--radius-xl`, shadow: `--shadow-card`
- Nav links: `.sidebar-link` with hover (blue wash), active (navy fill, white text)
- "More" toggle collapses secondary tabs (Mentoring, Events, Admin)
- Hidden below 720px — mobile uses bottom tab bar instead

### Content Area

- `.panel` is the standard page wrapper (fade-in on route transition)
- `.panel.narrow` limits to `max-width: 620px` (used for focused content)
- `.panel-title` uses `--display` font, navy color, orange underline accent
- Pages hug the sidebar with `margin-right: auto` (extra space goes right)

---

## 8. Responsive Breakpoints

### Max-width (mobile-first overrides)

| Breakpoint | What changes |
|------------|-------------|
| `420px` | Profile card header tightens, modal photo shrinks |
| `480px` | Filter drawers, compact card layouts |
| `560px` | Panel header row wraps to column |
| `640px` | Merch grid 2-col, notification bell compact, cart wraps |
| `680px` | Card grids shift to fewer columns |
| `720px` | **Major breakpoint**: sidebar hidden → mobile bottom nav, messaging goes full-screen, toast position adjusts for bottom nav |
| `760px` | Content padding reduction |
| `880px` | Event card grid simplification |
| `900px` | Business listing layout adjusts |
| `960px` | Wider card grid adjustments |

### Min-width (desktop features)

| Breakpoint | What activates |
|------------|---------------|
| `480px` | Wider filter layouts |
| `560px` | Panel header row goes horizontal |
| `640px` | Desktop notification panel width |
| `721px` | Desktop-specific styles (above mobile nav cutoff) |
| `900px` | Two-column event/job layouts |
| `1024px` | Full sidebar width, panel padding increase |
| `1200px` | Widest layout tier |

### Key Breakpoint: 720px

This is the primary mobile/desktop split. Below 720px:
- Sidebar is hidden; bottom tab bar appears
- Messaging becomes full-screen overlay
- Nav becomes a hamburger drawer (slide-in-left)
- Toasts shift up to avoid the bottom nav bar

The `useIsWide()` hook in `src/utils.js` uses `matchMedia('(min-width: 721px)')` to detect this breakpoint in JavaScript.

---

## 9. Button System

### Variants

| Class | Appearance | Hover |
|-------|-----------|-------|
| `.btn.primary` | Blue background (`--orange`), white text | Darker blue, lift + blue shadow |
| `.btn.secondary` | Navy background (`--maroon`), white text | Darker navy, lift + navy shadow |
| `.btn.ghost` | Transparent, navy border/text | Navy fill, white text, lift |
| `.btn.ghost.orange` | Transparent, blue border/text | Blue fill, white text |
| `.btn.danger` | Red background (`--danger`), white text | Darker red |
| `.btn.ghost.delete-danger` | Transparent, red border | Red fill on hover |

### Modifiers

- `.btn.wide` — full width
- `.btn.small` — reduced padding (`6px 12px`), smaller font (`--fs-sm`)
- All buttons: `border-radius: var(--radius)`, `font-weight: 600`, `font-size: var(--fs-base)`
- Active state: `translateY(1px)` (press feel)
- Disabled: `opacity: 0.45`, no pointer
- Focus-visible: `2px solid var(--orange)`, `offset: 2px`

---

## 10. Card Patterns

Cards throughout the app share a consistent foundation:
- Background: `--card` (white)
- Border: `1px solid var(--line)`
- Radius: `--radius` (12px) or `--radius-lg` (20px)
- Shadow: `--shadow-card`
- Hover lift: `--shadow-lift` + `translateY(-2px)`

Used in: person cards, job cards, event cards, business cards, post cards, merch cards.

---

## 11. Status Badges & Pills

### Status Tones

| Class | Color | Used for |
|-------|-------|----------|
| `.tone-good` | Green (`--ok`) on green wash | Confirmed, approved, collected |
| `.tone-warn` | Blue (`--orange-dark`) on blue wash | Pending, awaiting |
| `.tone-bad` | Red (`--danger`) on red wash | Cancelled, declined, errors |

### Filter Pills

- `.filter-radio-row .pill-row` — horizontal scrolling pill strip
- Active pill: navy fill (`--maroon`), white text
- Inactive: transparent, muted text, hover wash

---

## 12. Form Inputs

- Border: `1px solid var(--line)`, radius: `var(--radius-sm)` or `var(--radius)`
- Focus: blue outline (`2px solid var(--orange)`, `offset: 2px`)
- Labels: `--fs-sm`, `font-weight: 600`, `color: var(--ink)`
- Helper text: `--fs-xs`, `color: var(--ink-soft)`
- Error text: `--fs-xs`, `color: var(--danger)`

---

## 13. Dark Mode

There is **no dark mode**. The design is light-only (cream/white paper background). No `prefers-color-scheme` media queries or theme toggle exist. All color values are hard-coded to the light palette.

---

## 14. Iconography

All icons are **inline SVGs** defined directly in components (App.jsx for nav icons, individual components for feature-specific icons). No icon library or font is used. Icons use `currentColor` for fill/stroke to match surrounding text.

---

## 15. Map Styling

All maps (Alumni Map, Events, Businesses) share:
- Container: `.alumni-map`, height: 560px, `border-radius: var(--radius)`, `box-shadow: var(--shadow-card)`
- `isolation: isolate` on `.leaflet-container` to prevent Leaflet's internal z-index from overlapping the header
- Custom pins: `.alumni-pin-wrap` / `.alumni-pin` — round numbered badges
- Mapbox tiles (configured in `src/mapTiles.js`)
- City-based clustering (shared pattern across all three map types)

---

## 16. Conventions for New Styles

1. **Use design tokens** — never hard-code colors, radii, spacing, or font sizes. If a value doesn't fit an existing token, check if an existing token is close enough.

2. **Add new rules to `src/styles.css`** — this is a single-file CSS architecture. Use the `/* ---------- Section Name ---------- */` comment pattern to organize.

3. **Follow the section structure** — place rules near related existing rules. Use the section comment index (visible at the top of any `grep` for `----------`) to find the right spot.

4. **Name classes descriptively** — use `.feature-element` pattern (e.g., `.merch-card-image`, `.event-rsvp-btn`). No BEM, no utility classes.

5. **Mobile-first is not enforced** — the codebase mixes max-width and min-width queries. The primary breakpoint is 720px. Use `@media (max-width: 720px)` for mobile overrides.

6. **Respect reduced motion** — the global `prefers-reduced-motion` rule disables all transitions/animations. If you add a new animation, it will be automatically covered. Feature-specific hover transforms may need an explicit reduced-motion override.

7. **No CSS modules, no preprocessors, no utility frameworks** — vanilla CSS only, in one file.
