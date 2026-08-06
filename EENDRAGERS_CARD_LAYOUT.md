# Eendragers Card Layout Update

## Changes Made

Converted the Eendragers directory from a horizontal row list layout to a responsive card grid layout with **3 columns on desktop**.

### Files Updated

#### 1. `src/components/Directory.jsx`
- **Replaced `PersonRow` component with `PersonCard` component**
  - PersonRow: Horizontal list item with small avatar, name, role, location, and action buttons
  - PersonCard: Vertical card with large photo, name/role/location info, and action buttons below
  
- **Changed list class from `person-row-list` to `card-grid`**
  - Switched rendering from horizontal rows to card grid

### 2. `src/styles.css`

#### Updated `.card-grid` layout
**Before**: Used `auto-fill` with `minmax()` for responsive sizing
**After**: Fixed 3-column grid on desktop

```css
.card-grid {
  grid-template-columns: 1fr;           /* 1 column on mobile */
}
@media (min-width: 640px) {
  .card-grid { grid-template-columns: repeat(2, 1fr); }  /* 2 columns on tablet */
}
@media (min-width: 1024px) {
  .card-grid { grid-template-columns: repeat(3, 1fr); }  /* 3 columns on desktop */
}
```

#### Added new CSS classes for PersonCard
- `.person-card-photo` — Large photo block (3:4 aspect ratio)
- `.person-card-overlay` — Container for online dot
- `.person-card-footer` — Info + actions section
- `.person-card-info` — Name, role, location text
- `.person-card-name` — Person's full name
- `.person-card-you` — "You" badge
- `.person-card-meta` — Affiliation + grad year
- `.person-card-role` — Occupation @ company
- `.person-card-location` — City, country
- `.person-card-actions` — Message & LinkedIn buttons
- `.person-card-ribbon` — "Willing to help!" badge (positioned absolutely)

## Layout Details

### Desktop (1024px+)
- 3 cards per row
- Card dimensions: equal width, variable height based on content
- Gap: 32px between cards

### Tablet (640px - 1023px)
- 2 cards per row
- Gap: 20px between cards

### Mobile (< 640px)
- 1 card per row (full width)
- Gap: 24px between cards

## Card Structure

Each card displays:
1. **Photo block** (3:4 aspect ratio)
   - Large profile photo (or initials fallback)
   - Online indicator in bottom-right
   - "Willing to help!" ribbon in top-left
   - Orange border at bottom
   
2. **Footer section**
   - Name (with "You" badge if current user)
   - Affiliation (In house / Alum) + graduation year
   - Occupation @ Company (single line, truncated)
   - City, Country (single line, truncated)
   - Message & LinkedIn action buttons

## Features Preserved

✅ Sort options (Alphabetically, Recently joined, Recently online)
✅ Result count display
✅ Profile modal on card click
✅ Message functionality with icebreaker
✅ LinkedIn link (if available)
✅ Online indicator
✅ "Willing to help" indicator
✅ Load more pagination
✅ Empty/loading states

## Responsive Behavior

- Cards maintain equal height within each row
- Photos are consistently proportioned (3:4)
- Text truncation prevents card height variation
- Actions always visible at bottom
- Layout adapts from 1 → 2 → 3 columns as screen grows
