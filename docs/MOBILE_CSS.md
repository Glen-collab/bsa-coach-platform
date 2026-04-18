# Mobile-First CSS Pattern

The React frontend uses **inline styles** (not Tailwind, not CSS modules). To keep those responsive without breaking the pattern, we use a tiny `useMediaQuery` hook + `buildStyles(isMobile)` factory.

## The hook

`src/hooks/useMediaQuery.js`:

```js
import { useEffect, useState } from 'react';

export default function useMediaQuery(query) {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false
  );
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = (e) => setMatches(e.matches);
    mql.addEventListener('change', onChange);
    setMatches(mql.matches);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}
```

## The buildStyles pattern

Replace `const s = { ... }` at the top of a page with:

```js
const buildStyles = (isMobile) => ({
  page: { padding: isMobile ? '16px 12px' : '32px 24px' },
  title: { fontSize: isMobile ? '20px' : '24px', fontWeight: '700' },
  // ...
});

export default function MyPage() {
  const isMobile = useMediaQuery('(max-width: 640px)');
  const s = buildStyles(isMobile);
  // use s.page, s.title like before
}
```

Mobile breakpoint is 640px (fits most phones including the iPhone SE at 375 CSS px).

## Conversions done (2026-04-18)

- `Navbar.jsx` — brand shrinks to "BSA" on mobile; nav items hide first-name
- `AdminDashboard.jsx` — tabs horizontal-scroll, tables in `overflow-x: auto` wrappers with `min-width` on inner `<table>`, stat cards 2-col
- `CoachDashboard.jsx` — tools grid 2-col, tables wrapped
- `MediaLibrary.jsx` — exercise rows stack vertically on mobile (name row, then button+dropzone row)
- `MemberDashboard.jsx` — big primary CTA card at top, tier buttons 1-col

## Rules of thumb

1. **Page padding**: 16/12 on mobile, 32/24 on desktop
2. **Card padding**: 14/16 on mobile, 24 on desktop
3. **Tables**: wrap in `<div style={{ overflowX: 'auto' }}>`, give `<table>` a `minWidth` so it scrolls instead of compressing columns
4. **Flex-based toolbars**: use `flexWrap: 'wrap'` and `flex: '1 1 200px'` so inputs reflow, not overflow
5. **Buttons in a row**: use `display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(auto-fit, minmax(160px, 1fr))'` for uniform heights
6. **Tap targets**: `minHeight: 44px` on any phone button (Apple HIG minimum)
7. **Tab bars**: `overflowX: 'auto'; whiteSpace: 'nowrap'; flex: '0 0 auto'` on each tab so they scroll horizontally when there are too many

## If a shared component uses the styles

`MediaLibrary.jsx`'s `DropZone` is defined outside the main component. When `s` moved inside, `DropZone` lost access. Solution: pass `styles` as a prop.

```js
<DropZone styles={s} exercise={ex} ... />

function DropZone({ styles: s, exercise, ... }) { ... }
```
