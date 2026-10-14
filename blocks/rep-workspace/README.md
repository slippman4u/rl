# rep-workspace

Sales-rep line-planning workspace (prototype), authored on the `/showroom` page as a single
`rep-workspace` block. It currently has the shared data layer, the app shell and router, sign-in,
presentation mode, the rep home screen, Account 360, the plan review, appointment booking, the Picture and Data Wedge with its detail drawer and collaboration tools, the order builder, and the commit and confirmation screens.

```
blocks/rep-workspace/
├── README.md
├── rep-workspace.js    block entry: shell, rail, context bar, hash router, presentation mode
├── rep-workspace.css   design tokens, full-bleed overrides, shell and sign-in styles
├── lib/
│   ├── data.js         sheet loading, merge, roll-ups, mutations, subscribe
│   ├── commerce.js     live Catalog Service fetch + localStorage fallback
│   ├── format.js       date, time, count, signed, percent, greeting, initials, image and .ics helpers
│   ├── order-calc.js   the order's arithmetic: carts, grids, currency split, discounts, credit
│   ├── commit-state.js exception handling, the committed snapshot, Reset demo
│   ├── wedge-utils.js  shared wedge helpers (tones, roll-ups, image fallback)
│   ├── overlay.js      body-level layers (drawer, modal, toast) and the focus trap
│   ├── csv.js          quoted, injection-safe CSV and Blob downloads
│   ├── dom.js          el() builder (createElement/textContent only) and inline SVG icons
│   └── session.js      sessionStorage shell state (persona, done stages, presentation)
└── views/              one module per route, exporting render(container, model, ctx)
    ├── signin.js  home.js  account.js  plan.js  appointment.js  wedge.js
    ├── product-drawer.js  share-modal.js   (opened from the wedge)
    └── order.js  commit.js  confirmation.js
```


Every view reads data through `lib/data.js` only: `import { getModel } from './lib/data.js'`. The shell
resolves the model once and passes it to each view.

## Data flow

```
/showroom-data/showroom-data.json ──► loadSheets()  (parsed once, cached in a module variable)
Catalog Service (ACCS)            ──► fetchProducts() ──► localStorage "rep-workspace-products"
sessionStorage "rep-workspace-state" (rep's edits) ─┐
                                                    ▼
                                    getModel()  ──►  model  ──► views
                                         ▲                        │
                                         └── mutations ◄──────────┘  (then subscribers are called)
```

1. **Sheet.** `showroom-data.json` is a multi-sheet workbook (`{ "tab": { data: [...] } }`). Each tab
   becomes an array of plain objects. Header names are matched ignoring case and punctuation, so
   `wholesale-ratio`, `wholesaleRatio` and `Wholesale Ratio` are the same column.
2. **Catalog.** `commerce.js` reuses the storefront's `CS_FETCH_GRAPHQL` client from
   `scripts/commerce.js`, which `initializeCommerce()` points at the endpoint and `cs` headers
   (`Magento-Store-Code`, `Magento-Store-View-Code`, `Magento-Website-Code`) in `config.json`.
   Nothing is hard-coded here. One POST fetches `products(skus: [...])` plus an aliased
   `variants(sku:, pageSize: 100)` per parent. Parents with more than 100 variants (e.g. `polo`,
   `scp`) get follow-up cursor requests, batched together.
3. **Cache.** Every successful fetch is written to `localStorage["rep-workspace-products"]`. If the
   live call errors or exceeds 4 s, the stored copy is used and `isCachedData()` /
   `model.source.cached` is `true` so the UI can show a "cached data" indicator. With no stored copy
   the error is thrown. All storage access is wrapped in try/catch.
4. **Merge.** One tile per parent SKU, each with `colors[]`. The parent's last-year, target and
   planned units are split across its colors by a stable weight derived from the color name (FNV-1a
   hash, no randomness) using largest-remainder rounding, so the colors always sum exactly to the
   parent totals, and tile totals are the sums of their colors. A color's `retail` is the lowest
   price among its variants (the parent's own price is 0 in the admin); `wholesale = retail ×
   account wholesale-ratio`; a tile's `retail` is its lowest color retail (show it with
   `fromPrice(tile)` → "from $118"). `model.colorRows` flattens the colors into one row per
   style-color with the parent info repeated.
5. **Overlay.** Mutations are stored in `sessionStorage["rep-workspace-state-v2"]` and re-applied on
   top of the sheet values on every rebuild.

## Model

`const model = await getModel()` — a stable object. After a mutation `model.tiles`,
`model.slots` and `model.appointments` are replaced, so re-read them inside a `subscribe` callback.

| Field | Description |
| --- | --- |
| `tiles[]` | One per parent SKU (10). `id` (= `parentSku`), `parentSku`, `name`, `shortName` (`styles.name-short`), `imageUrl` (parent image), `cluster`, `tier`, `status` (`carryover`\|`add`\|`drop`), `retail` (lowest color), `wholesale`, `plannedUnits`, `targetUnits`, `lastYearUnits` (sums of colors), `doors` (count of doors carrying it, derived from the `doors` tab entitlements), `notes[]` (`text`, `author`, `date`, `source`), `sizes[]`, `colors[]` |
| `tiles[].colors[]` | `id` (`parentSku:color-slug`), `color`, `swatch`, `imageUrl` (empty for now), `retail`, `wholesale`, `plannedUnits`, `targetUnits`, `lastYearUnits`, `status` (follows the tile), `variants[]` (`sku`, `color`, `size`, `price`) |
| `colorRows[]` | Flat style-color rows (about 60) for the Data Wedge, order builder and CSV: every color field plus `tileId`, `parentSku`, `name`, `cluster`, `tier`, `doors`, `tileImageUrl` |
| `sizeCurve[]` | `{ size, share }`, shares normalised to sum to 1 |
| `doors[]` | `{ id, name, city, share, entitlement, currency }`, `share` a fraction of 1 |
| `account`, `rep` | see the `account` tab |
| `slots[]` | `{ id, date, time, showroom, status, booked }`. `booked` is true when the sheet says `booked` (and the slot has not been released) or an active appointment holds it |
| `appointments[]` | `{ id, date, time, account, showroom, type, status, slotId, source }`: sheet rows plus any booked this session. Visits booked in the app also carry `durationMinutes`, `attendees[]` (names) and `preRead[]` (item keys). A superseded visit stays in the list with `status: "cancelled"` |
| `accounts[]`, `terms[]` | `{ id, name, status, nextStep }` and `{ key, value, number }` |
| `source` | `{ cached, fetchedAt }` |

**Roll-ups** (derived on every call, never stored). Dropped tiles and all their colors contribute zero
planned units (`effectiveUnits(tileOrColor)`); their target still counts, so dropping a tile shows as a negative variance.

- `totalsFor(filterFn?)` (the filter receives a tile) → `{ units, wholesaleCost, extendedRetail, targetUnits, lastYearUnits, varianceUnits, variancePct }` (`variancePct` is in percent, e.g. `-7.2`).
- `byCluster(filterFn?)`, `byTier(filterFn?)` → `[{ key, tileCount, ...totals }]` in first-seen order.

**Mutations** (in-memory + sessionStorage, then subscribers run): `setStatus(tileId, status)` (applies
to the tile and all its colors), `addNote(tileId, text)`, `setPlannedUnits(tileOrColorId, n)` (a tile id
re-splits `n` across its colors with the same deterministic weights; a color row id sets that row only), `bookAppointment({ slotId, accountId?, type?, status?, durationMinutes?, attendees?, preRead? })` (copies date, time and showroom from the slot; defaults to `tentative`, 60 minutes, no attendees or pre-read). Booking for the current account **supersedes** its active (`tentative` or `confirmed`) appointment: the old one is cancelled in the overlay (`cancelled` ids) and its slot is released (`released` slot ids), so only the new visit shows as active. Sheet rows are never edited; the overlay lives in `sessionStorage` and subscribers fire as for any mutation.
`subscribe(fn)` calls `fn(model)` after each mutation and returns an unsubscribe function.

## Sheet tabs and columns

These are the headers published in `showroom-data.json`, and `parseSheets()` in `lib/data.js` reads
exactly these names (matched ignoring case and punctuation, no aliases). On load the layer
`console.warn`s once for every expected tab, column or key that is missing (`EXPECTED` in
`data.js`).

| Tab | Columns | Notes |
| --- | --- | --- |
| `styles` | `sku`, `name-short`, `cluster`, `tier`, `status`, `last-year-units`, `target-units`, `planned-units` | One row per parent SKU, exact case (`polo`, `scp`, `mlp`, `cfp`, `cfh`, `cfm`, `cmp`, `dnp`, `cfk`, `RFK`). Units are parent totals. `status` is `carryover`, `add` or `drop`. |
| `account` | key/value rows. Keys: `account-id`, `account-name`, `account-number`, `ytd-spend`, `open-orders`, `units-shipped-fall-2026`, `credit-limit`, `credit-available`, `gold-threshold`, `gold-gap`, `tier`, `showroom-contact`, `showroom-contact-email`, `showroom-contact-phone`, `buyer-name`, `preferred-day`, `season`, `wholesale-ratio`, `cad-rate`, `rep-name`, `rep-title` | Becomes `model.account` (camel-cased, numbers converted, showroom contact grouped) and `model.rep` (`name`, `title`). |
| `doors` | `door-id`, `name`, `city`, `share`, `entitlement`, `currency` | `share` is a weight (percent); the model normalises it to a fraction of 1. `entitlement` is `all` or `not:<sku>[,<sku>]`; `model.doorsCarrying(sku)` applies it. `currency` is `USD` or `CAD` (see `account.cadRate`). |
| `size-curve` | `size`, `pct` | Normalised to `{ size, share }` summing to 1. |
| `slots` | `date`, `time`, `showroom`, `status` | `status` is `open`, `limited` or `booked`. There is no id column, so `id` is derived as `date`T`time`-`showroom-slug`. `booked` is true when the status is `booked` or an appointment holds the slot. |
| `appointments` | `id`, `date`, `time`, `account`, `showroom`, `type`, `status` | `status` is `tentative` or `confirmed`. `slotId` is derived the same way as for slots. |
| `accounts` | `account-id`, `name`, `status`, `next-step` | |
| `terms` | key/value rows. Keys: `early-booking-discount`, `gold-preview-discount`, `minimum-units-per-color`, `delivery-window-early`, `delivery-window-core` | `model.terms` is `[{ key, value, number }]`; `model.term(key)` returns the number when numeric, else the string. |
| `notes` | `sku`, `note` | Parent-level; shown on the tile. Rep notes add `author` and `date`. |

A sheet `doors` column on `styles`, if one is added back, is ignored: `tile.doors` always equals
`model.doorsCarrying(sku).length`.

## Catalog fields used

Per parent: `sku`, `name`, `images`, `options` (the color option is matched by `/colou?r/` on its id
or title, the size option by `/size/`), `priceRange.minimum`. Per variant: `selections` (option
value ids, resolved to titles via the parent's options), `product.sku`, `product.price.final`.
Currency codes on variants are inconsistent in the catalog (`USD` or `NONE`), so only the amount
is used.

## Swatches and images

`color.swatch` is a CSS color string. It uses the ACCS swatch value when the option provides a color
(`#hex` or `rgb()`); otherwise the fallback map in `data.js` (`SWATCH_FALLBACK`, keyed by lower-case
catalog color name; two-tone names use the body color); otherwise neutral grey `rgb(158 163 168)`.
At the time of writing the catalog returns no swatch values for these parents, so all 29 color names
use the fallback map. Variants have no images, so `color.imageUrl` is `''`; consumers should use
`color.imageUrl || tile.imageUrl` so per-color images can be added later without changing them.

Helpers exported from `data.js`: `getModel`, `loadSheets`, `isCachedData`, `STATUSES`,
`effectiveUnits`, `formatMoney`, `fromPrice`.

## Shell, routing and session state

On decorate the block adds `showroom` to `document.body`; the CSS then hides the site header and footer,
removes the section margins and padding so the workspace is full-bleed, and hides the other sections on
the page. A skeleton loader shows while `getModel()` resolves; if it fails, an error panel with a retry
button replaces it.

**Layout.** A left rail of five stages, a top context bar (rep avatar and name from `model.rep`, the
account chip from `model.account.name`, the season chip from `model.account.season`, a sync indicator,
Present and Sign out), and the view area. The sync indicator reads "Live data" or "Cached data"
(`model.source.cached`) and flashes "Saved" after a model mutation.

**Routes** (hash router; unknown routes go to `#/home`):

| Route | Stage (rail) | View |
| --- | --- | --- |
| `#/signin` | none | `views/signin.js` |
| `#/home` | Home | `views/home.js` |
| `#/account/acme` | Prepare | `views/account.js` |
| `#/plan` | Prepare | `views/plan.js` |
| `#/appointment` | Visit | `views/appointment.js` |
| `#/wedge` | Present | `views/wedge.js` |
| `#/order` | Present | `views/order.js` |
| `#/commit` | Commit | `views/commit.js` |
| `#/confirmation` | Commit | `views/confirmation.js` |

A view module exports `render(container, model, ctx)` and optionally `destroy()`, which the router
calls before mounting the next view. `ctx` has `navigate(hash)`, `completeStage(stageId)`,
`isDone(stageId)`, `signIn(persona)`, `isPresentation()` and `setPresentation(on)`.

**Persona gate.** Without a persona every route redirects to `#/signin`; with one, `#/signin`
redirects to `#/home`. The sign-in form is prefilled (`sofia` and a masked password) and is not
checked: signing in stores only the persona (`Sofia`, `Sales Representative`). No credentials are
stored. Sign out clears the persona, the done stages and presentation mode.

**Done checks.** Entering a stage marks every earlier stage done, and a view can mark its own stage
with `ctx.completeStage(id)` (the confirmation view completes Commit).

**Presentation mode.** The Present button in the context bar hides the rail and the sync indicator,
raises the base font size from 16px to 18px, and shows an Exit presentation button in the same bar.

**sessionStorage keys** (all access is wrapped in try/catch): `rep-workspace-persona`,
`rep-workspace-done`, `rep-workspace-presentation`, plus `rep-workspace-state-v2` (model overlay).

## Rep home (`views/home.js`)

Everything shown comes from the model; nothing is typed into the view except UI labels.

1. **Greeting.** "Good morning/afternoon/evening" by the current hour, the rep's first name from
   `model.rep.name`, today's date, and the showroom of the featured visit (falling back to the
   earliest visit).
2. **Journey strip.** Prepare the account, Shape the visit, Tell the collection story, Commit the order,
   mapped to the `prepare`, `visit`, `present` and `commit` stages. Checks come from `ctx.isDone()`; the
   active step is the first one not done. Each step links to its stage.
3. **Featured card.** The Acme visit: the earliest non-cancelled appointment in `model.appointments`
   whose `account` is `model.account.name` (so booking an earlier slot replaces it). It shows date,
   time, showroom, type, a status chip (`tentative` reads "Tentative hold", `confirmed` reads "Confirmed"),
   and attendee chips for `model.account.showroomContact`, `model.account.buyerName` and `model.rep`.
   Open account goes to `#/account/acme`; Start visit calls `ctx.setPresentation(true)` and goes to
   `#/wedge`. With no Acme visit it offers "Book a visit".
4. **Your accounts.** `model.accounts` with a status chip and next step. The account matching
   `model.account.id` links to `#/account/acme`; the rest are `aria-disabled`, focusable, and show a
   "Not part of this demo" tooltip on hover or focus (so it also appears on tap).
5. **Upcoming visits.** The first five non-cancelled appointments sorted by date and time (not filtered
   by today, since the sample dates are in November), with the Acme visits highlighted.
6. **Source line.** Live or cached, from `model.source`.

The view subscribes to the model and repaints on any change, and unsubscribes in `destroy()`.

## Account 360 (`views/account.js`)

A briefing for the rep, top to bottom. Every figure comes from `model.account`, `model.byCluster()`,
`model.tiles` and `model.doors`; only the labels are typed in the view.

1. **Header.** Account name and number, tier chip, showroom contact (name, email and phone as
   `mailto:` and `tel:` links), the buyer (`buyerName`, preferred day) and a credit utilisation bar:
   (`creditLimit` - `creditAvailable`) / `creditLimit`, labelled with the used, available and limit dollars.
   The bar turns orange above 85% used.
2. **KPI row.** Year-to-date spend, open orders, units shipped, available credit of the limit, and progress
   to Gold (`ytdSpend` / `goldThreshold`, a conic-gradient ring, and the `goldGap` in dollars).
3. **Last year versus this season's target.** One row per cluster from `model.byCluster()`: a last-year
   bar and a target bar on a shared scale, a gold marker at the planned units, and the variance percent
   (green over, orange under). Bars and insights repaint when the plan changes.
4. **Entitlements.** The styles grouped by cluster with a count per group, as thumbnails
   (`thumbnailUrl()` requests a 240px rendition of AEM Assets images), the short name and a cluster chip.
   If an image fails the card falls back to the original URL, then to the style's initials. Beside it,
   the doors with their share bar and currency chip; a door that does not carry every style says so,
   derived from `model.doorsCarrying()`.
5. **Account insights.** Three sentences built from the data: the cluster furthest under target (by
   percent), the cluster furthest over target, and the Gold gap with what Gold unlocks. Each has a
   "Review in plan" link to `#/plan`. A cluster insight is omitted if no cluster is on that side of target.
6. **Review account plan** button to `#/plan`.

The view subscribes to the model and unsubscribes in `destroy()`.

## Plan review (`views/plan.js`)

The account plan for Season x FOB x Account. Numbers come from `model.totalsFor`, `model.byCluster()`,
`model.byTier()` and `model.tiles`; the only static text is the "Polo (FOB)" chip (the model has no FOB
field) and "Plan source: Anaplan, synced this morning".

1. **Title block.** "Account plan: " plus `model.account.season`, with chips for FOB, the account name,
   the plan source and a plan-purple "Pre-commit".
2. **Summary strip.** Planned units, wholesale cost, extended retail, and units versus target (signed
   units, percent to one decimal, arrow). Totals count dropped styles as zero units.
3. **Over-plan strip.** A line naming any cluster more than 5% over target, so the problem is visible
   before anything is expanded. The cluster row is also tinted and tagged "Over plan".
4. **Plan structure table.** Cluster, tier, style and color rows with last year, target, planned,
   variance in units, a variance bar with percent, door count (`tile.doors`) and status. Only the
   clusters are shown at first; the 44px chevron buttons use `aria-expanded`, keep focus across
   repaints, and closing a cluster closes its tiers. Bars are green within +/-5% of target, orange above
   +5% and blue below -5%. Dropped styles are dimmed and count zero planned units.
5. **Cluster callouts.** One per cluster, computed from the data. Over plan (> +5%): the style with the
   highest variance percent, the units dropping it would remove, and the cluster variance afterwards
   (the dropped style keeps its target, as in `model.totalsFor`). Under plan (< -5%): the style with the
   largest shortfall in units. Otherwise: on target, with the variance. Each links to `#/wedge`.
6. **Pre-commit notes.** A textarea saved to `sessionStorage` key `rep-workspace-plan-note` (debounced,
   in try/catch), restored on load, with a "Saved" indicator.
7. **Footer.** A `position: sticky` bar inside the view: "Book the visit" (`#/appointment`, primary) and
   "Skip to assortment" (`#/wedge`).

The summary, attention strip, table and callouts repaint when the model changes (the notes box does
not, so typing is never interrupted). Expanded rows reset each time the view is opened.

## Appointment booking (`views/appointment.js`)

A two-pane booking screen, then a confirmation state.

**Calendar** (built by hand, role `grid`, Monday start). It opens on the month of the earliest bookable
slot in the selected showroom. Previous and next are disabled when no slot exists in an earlier or later
month. Each day shows a dot from that showroom's slots: an open slot counts 1, a limited slot counts a
half, a booked slot counts 0; the day is green (open) at 75% or more of its capacity, orange (limited)
when some capacity remains, and grey (booked) when none does. Days without slots are muted and not
selectable. The day named by `model.account.preferredDay` carries a small gold diamond, with a note
below the calendar. Every day has an `aria-label` with its date and availability. Arrow keys move
between days (and across months), PageUp and PageDown change month, Home and End jump to the start and
end of the week, and Enter or Space selects.

**Details.** Showroom (from the distinct slot showrooms; changing it recomputes the dots and clears the
selection if that day has no slots there), time buttons (56px, booked ones disabled and labelled, the
account's own hold shown as "Your hold" and bookable), visit type, duration, attendee chips (the showroom
contact, the buyer and the rep from the model; guests can be added, everyone but the rep can be removed)
and the "Share before the visit" switches (plan and visual assortment on by default). A line above the
form says which active visit the booking replaces.

**Confirm** calls `model.bookAppointment` with status `confirmed`, marks the Visit stage done with
`ctx.completeStage('visit')`, and swaps the form for the confirmation: a summary card, a read-only invite
email to the buyer from the rep (nothing is sent), "Add to calendar" (an `.ics` with one VEVENT in floating
local time, `DTEND` from the duration, built by `buildIcs()` and downloaded from a Blob URL that is revoked
afterwards), "Start visit" (presentation mode, then `#/wedge`) and "Back to home".

## Picture Wedge and Data Wedge (`views/wedge.js`)

The planned assortment for Fall 2027, Polo, Acme, from `model.tiles` (10 styles) and `model.colorRows`
(60 style-colors). All view state (view, filters, grouping, collapsed groups, opened tiles, sort and
totals scope) is kept in a module-level object, so it survives switching view and leaving and returning
to `#/wedge`. Every change repaints in place and restores the page scroll, the table scroll and keyboard
focus.

**Header bar** (sticky under the context bar; its offset is measured at runtime). A two-button view toggle,
a group-by select (Cluster then tier, Cluster, Tier, Status, None), a search box, the cluster, tier and
status selects, and a Color button that opens a panel of the 29 distinct color names with swatch dots
(several can be picked; Escape or an outside click closes it). Active filters show as removable chips
(44px) with "Clear all", and a count reads "Showing X of 10 styles" or "Showing X of 60 colors".
A search matches the style name, the short name or a color name: a style-name match keeps all of the
style's colors, a color-name match keeps only that color.

**Picture Wedge.** Collapsible group headers (planned units and a coloured variance percent: green within
+/-5% of target, orange above, blue below), cluster headers above tier sub-headers by default. Tiles keep
the sheet order inside a group, so changing a status never reorders them. Each tile has the image
(`thumbnailUrl`, with the original-then-initials fallback), short name, status chip, colour dots with the
colour count, planned units with the variance to target, "from $X" (`fromPrice`), doors, a mini size
curve (planned units split by `model.sizeCurve`, largest-remainder so the sizes sum exactly), a note pin
when the style has notes, a **Colors** button (inline list of colors with planned units, plus the notes)
and a **Drop** button. Drop calls `model.setStatus(id, 'drop')`; on a dropped tile the button reads
**Restore** and sets the status back to the sheet's value (read with `loadSheets()`; a sheet status of
`drop` restores to `carryover`). Dropped tiles are dimmed and stay in place.
With a color filter or color search active, tiles without a matching color are hidden and the units on a
tile and in its headers count only the matching colors. The grid is `auto-fill` with a 240px minimum, which
gives 3 across at 1024 and 4 across at 1366.

**Data Wedge.** A table of the color rows: style, color, cluster, tier, status, last year, target, planned,
variance (units and percent), wholesale cost and extended retail. The same filters and grouping apply, group
rows carry subtotals, headers are 44px sort buttons with `aria-sort` (ascending, descending, off), and
sorting happens within each group. Dropped styles are dimmed with zero planned units. The table sits in its
own scroll container (so the sticky header and any horizontal scroll stay inside it); the page itself never
scrolls sideways.

**Financial bar** (`position: sticky` at the bottom of the view). Planned units, wholesale cost, extended
retail and the variance to target. "Whole plan" uses `model.totalsFor()`; "Current filter" totals the color
rows currently showing. Changed values flash briefly (not with reduced motion). Dropping Dog-and-Pheasant
moves the whole plan from 12,350 to 11,650 planned units (variance +50 to -650, -5.3%) and the Seasonal
Pattern header from +29% to +4%; restoring brings both back exactly.

Footer: "Back to plan" (`#/plan`) and "Build the order" (`#/order`).

### Detail and collaboration (wedge, part 2)

**Product drawer** (`views/product-drawer.js`). Clicking a tile's image or name opens a 480px drawer from
the right (full width under 600px) with a dim backdrop, a 44px close button, Escape and backdrop-click to
close, a focus trap, and focus returned to the tile's name button on close. It shows the large image
(resized rendition, original, then initials), a swatch row (pick one to see that color's own units), name,
SKU, cluster, tier, "from $X", a three-button status control (`model.setStatus`), planned versus target
versus last year as bars with the variance, units by size (`apportion`, so the sizes sum exactly), every
door with its share of the planned units, and the notes with an "Add note" box (`model.addNote`). A door
that is not entitled to the style (`model.doorsCarrying`) is dimmed, says "Not entitled" and shows 0; the
units are spread over the entitled doors by their shares. The drawer subscribes to the model and repaints
after any change, keeping its scroll position, its focus and the unsent note text.

**Selection and bulk actions.** Each tile has a 44px checkbox (shown on hover or focus, and always on
touch devices). The selection is kept in the module-level UI state, so it survives filtering and switching
views; styles hidden by a filter stay selected and the bar says how many are hidden. When anything is
selected a sticky bar sits directly above the financial bar with: **Set status** (a menu applying
`setStatus` to every selected style), **Add note** (an inline form applying `addNote` to each),
**Save as focused view** (an inline name field) and **Clear selection**. A focused view stores the view,
grouping and filters in `sessionStorage` (`rep-workspace-wedge-views`, in try/catch). Saved views appear as
chips in the header (apply on click, 44px remove button).

**Export to Excel.** Downloads a CSV of the color rows currently showing: style, color, cluster, tier,
status, last year, target, planned, wholesale cost, extended retail (both for the planned units) and notes.
Every cell is quoted, and a cell starting with `=`, `+`, `-` or `@` gets a leading apostrophe. The file has
a UTF-8 byte-order mark for Excel and is built with a Blob whose URL is revoked after use.

**Share presentation link.** A modal with a made-up link (derived from the account, season and version,
with an expiry date), an expiry select (7, 14, 30 days), a Copy button (`navigator.clipboard` in
try/catch, with a visible "Copied" state and a selected-link fallback), "Version 3" and "Viewed by 1
person, last viewed today". The version and tracking lines are fixed text; nothing is sent anywhere.

**Simulate plan sync.** A quiet button in the header (no timer). It shows the toast "Anaplan sync: 2
changes received" for 8 seconds and flags the first style with status `add` and the first style more than
5% under target with an "Updated" badge and a highlight for the same time. It changes no data. With
`prefers-reduced-motion` the pulse and the toast animation are off.

**Overlays.** The drawer, the modal and the toast are `position: fixed` layers appended directly to
`document.body` (see `lib/overlay.js`). Each carries the `rep-workspace` class so the `--rw-*` tokens
resolve, and all of them are removed when the view is left (`destroy()`).

## Order builder (`views/order.js`)

The order for the plan, built from the model's non-dropped color rows (so dropping a style in the wedge
removes it here, and restoring it brings it back). Opening the screen marks the Present stage done.

**Carts.** One tab per delivery window, read from the terms tab (`delivery-window-early` and
`delivery-window-core`, with their dates), each showing its units and wholesale total. By default Core
Essentials goes to the Early window and every other cluster to the Core window. A **Move** menu on each
style row sends it to the other cart; totals update at once.

**Lines.** Cluster headers, then styles (thumbnail with the usual image fallback, units, wholesale cost, cart
badge), then colors, then a sizes-by-doors matrix. Only the first style starts open. Door chips (All doors
plus one per door) limit the lines to one door's column and totals; the summary always covers every door.

**Units.** A color's units are split by size with `model.sizeCurve` and by door with each door's share in
`model.doors`, both with the largest-remainder `apportion`, and `apportionMatrix()` (`lib/format.js`) fills the
grid so every row and column adds up exactly. All doors are included, even one that is not entitled to the
style; the commit screen is where that becomes an exception. Matrix cells are 44px number inputs
(`inputmode="numeric"`). Editing a cell recalculates the row, door and grand totals live; on commit the whole
grid is saved and, if the color's total changed, `model.setPlannedUnits(colorRowId, total)` is called so the
plan elsewhere follows. The saved grid keeps the unedited cells as they were and is used only while it still
adds up to the color's planned units; if the plan changes elsewhere the split is recalculated.

**Summary.** Subtotal at wholesale, the discounts from the terms tab (`early-booking-discount`, on by
default, and `gold-preview-discount`, off; the percentages are added and taken off the subtotal), the order
total, and the available credit with a bar showing the order total as a share of it. Over the limit it shows
"Exceeds available credit by $X" with a link to `#/commit`. A USD/CAD toggle converts every amount on the screen
with `model.account.cadRate`. Doors invoiced in CAD (shown with a CAD chip) form their own orders, so the
order splits into one order per delivery window and currency that has units: "This order will split into N
orders", with an expandable list of each order (window, currency, units, total, and the amount invoiced when
it differs from the display currency).

**Storage.** `sessionStorage["rep-workspace-order"]` (in try/catch) holds the cart assignments, the saved
matrices, the discount checkboxes and the display currency. Expanded rows and the open cart are kept in
memory.

## Shared order calculations (`lib/order-calc.js`)

The order builder, the commit screen and the confirmation all use `createOrderCalc(model)`: the delivery
windows (from the terms tab) and which window each style ships in, the sizes-by-doors grids (a manual grid
counts only while it still adds up to the color's planned units), the order split by window and currency,
the discounts and totals (`totals(data)`), and the credit check (`credit(total)`). `getState()` returns the
saved order choices (the `rep-workspace-order` key) as one shared object, updated in place.

## Commit (`views/commit.js`)

"Review and commit": a recap strip (units, order total in USD, orders, credit position) and five checks that
are re-evaluated after every model change:

| Check | Exception when | Resolution |
| --- | --- | --- |
| Credit | the order total (USD) is above `model.account.creditAvailable`; the totals per delivery window are shown beside it | **Request credit approval**: marks it "Resolved: credit approval requested" in amber. It is not a hard pass, and splitting the order cannot clear it |
| Door entitlement | a line has units on a door that `model.doorsCarrying` does not include | **Reallocate to entitled doors**: moves those units to the entitled doors by their shares, keeps every color total, and saves the grids |
| Minimum per color | a non-dropped color has fewer units than the `minimum-units-per-color` term | **Rebalance colors to minimum**: within each style, units move from its largest colors (largest first, never taking one below the minimum) to its short colors with `model.setPlannedUnits` on each color row, so the style's total is unchanged. Only if a style's total cannot cover the minimum across all of its colors does it add the shortfall, and the note says so |
| Cluster versus target | a cluster is more than 15% over target | **Drop [style]**: `model.setStatus` on the cluster's style with the highest variance percent |
| Delivery windows | a line is in no cart | (acknowledge only; every style has a window by default) |

Every exception can instead be **acknowledged** with a reason of at least 10 characters; the reason is shown
on the item and can be removed. Items flip between states with a short animation (off with
`prefers-reduced-motion`). **Commit order** stays disabled until nothing is outstanding, and a line says how
many are. Once nothing is outstanding the buyer acceptance panel appears: a summary (units, the total in USD
and CAD, the delivery windows, the number of orders), a signature canvas (pointer events for mouse, pen and
touch, `touch-action: none`, sized for the device pixel ratio, Clear button) and a typed name. **Submit order**
needs at least one stroke and a name; it stores the snapshot and goes to `#/confirmation`.

Because a rebalance keeps each style's total, it cannot create a cluster-versus-target exception. Adding units is the exception: when a style's total cannot cover the minimum (with a minimum of 120, Soft Cotton's 1,600 units across 24 colors cannot reach 2,880), the units added can push a cluster over 15%.

## Confirmation (`views/confirmation.js`)

Without a committed snapshot it redirects to `#/commit`. Otherwise it marks the Commit stage done and shows
each split order with a repeatable number (`RL-F27-NNNNNN`, from the season, the account number and the
order's index), its delivery window, currency, units and total (CAD orders also show the USD amount), and the
grand total in USD. The Gold banner compares year-to-date spend plus this order's USD total with the Gold
threshold: past it, Acme moves to Gold (priority allocation on core styles and extended payment terms);
otherwise it shows the remaining gap. The next steps name the buyer and show a three-step status (Received,
Validated, Sent to fulfilment) that animates once per commit. **Reset demo** clears every `rep-workspace-*`
sessionStorage key except the persona and reloads the page, which restores the plan to the sheet (12,350
units) and puts the demo back at `#/home`.

**Storage keys.** `rep-workspace-commit` (how each exception was handled), `rep-workspace-committed` (the
committed flag and the order snapshot, including the signature image), plus the existing
`rep-workspace-order`, `rep-workspace-state-v2` and the others listed above. All access is in try/catch with
an in-memory fallback.

## Styling

Design tokens are CSS custom properties on `.rep-workspace`: `--rw-navy`, `--rw-ivory`, `--rw-gold`,
`--rw-sales-green`, `--rw-buyer-orange`, `--rw-support-blue`, `--rw-plan-purple`, `--rw-ink`,
`--rw-muted`, plus `--rw-serif` (headings) and `--rw-sans` (the site's `--type-base-font-family`).
The layout is tablet-first, designed for 1024x768 and 1366x1024 landscape, with a wider rail and
larger padding from 1200px. Buttons, links and list rows are at least 44px tall. All block selectors are scoped to `.rep-workspace`, except the
`body.showroom` rules that turn the page into a full-bleed app. The block uses `div` elements for its
top bar rather than `header` and `footer`, because those tags are hidden site-wide in showroom mode.

## Testing locally

Start the dev server (`aem up`) and open `http://localhost:3000/showroom`. Content comes from the
published `/showroom` page, which must contain a `rep-workspace` block.
