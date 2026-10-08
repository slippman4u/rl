# Shop the Look Block

A two-panel "How To Wear It" section: a lifestyle/model image on the left, and a
2x2 grid of product thumbnails on the right. Thumbnails are populated live from
the ACO Catalog Service based on authored SKUs — hovering (desktop) or tapping
(mobile) a thumbnail opens a popup with the product name, price, and a link to
the product page.

## Authoring format

Insert a table with 1 column:

- Row 1: **shop-the-look**
- Row 2: the lifestyle/model image (paste an image, or a link to one)
- Row 3+: one product SKU per row, plain text (e.g. `ms-ss-lin-020`)

Example:

- Row 1: **shop-the-look**
- Row 2: *(lifestyle image)*
- Row 3: `ms-ss-lin-020`
- Row 4: `mp-cpr-wst-004`

Publish the page. No code changes are needed to update the products shown —
just edit the SKU rows and republish.

## Notes

- Product name, price, and thumbnail are fetched live from the ACO Catalog
  Service GraphQL API via `commerce-endpoint` (configured in `config.json`),
  so authors only need SKUs, not full product details.
- If a SKU isn't found (or the lookup fails), that tile shows a
  "Product unavailable" state instead of breaking the rest of the block.
- The block is fully responsive: desktop shows the lifestyle image and grid
  side by side with a hover popup; mobile stacks them vertically with a
  tap-to-open bottom-sheet popup.
