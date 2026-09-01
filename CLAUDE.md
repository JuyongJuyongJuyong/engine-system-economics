# engine-system-economics

Part of the Global Rooftop Solar Potential Calculator (3-repo split — see `ARCHITECTURE.md` in the project's docs). This repo is a published JS/TS **package** that depends on `engine-radiation-uncertainty` as a package dependency (in-process function call, not a network request) and is itself depended on by `app-rooftop-solar`. See ARCHITECTURE.md's "Important: these are packages, not services" section.

Owner: B (sole owner — see repo's CODEOWNERS).

## Non-negotiable constraints (shared across all three repos)
- Zero-cost stack only: no paid APIs in the default path, no backend server.
- Never claim precision the data doesn't support — every exported result carries an uncertainty range and a comment citing its data source.

## Scope — physics AND math, not one or the other
- **Physics**: performance ratio modeled from local temperature + aridity (thermal, not hardcoded at 0.75), elevation correction, roof-polygon geometry — panel-layout optimization (2D bin-packing: fit standard panel rectangles into the roof polygon minus keep-out zones for vents/chimneys, replacing the naive `area × packing_factor` assumption) and geodesic area/azimuth (Leaflet is Web Mercator, not equal-area — use a geodesic area function on the raw lat/lng polygon, not projected coordinates; derive azimuth from the polygon's longest-edge bearing; correct self-intersecting polygons first).
- **Math**: ROI (amortization with panel degradation ~0.5–0.8%/yr + local tariff escalation — both required for an honest lifetime number), savings/self-consumption modeling (`savings = E × self_consumption × tariff`, `self_consumption = 1.0` under net metering), CO2 impact, tariff data integration.

## Data-source implementation notes
- **Elevation — primary source + fallback pool**:
  - Primary: AWS/Mapzen Terrain Tiles (`elevation-tiles-prod` S3 bucket) — Terrarium-encoded PNG tiles (`elevation = R*256 + G + B/256 - 32768`), static file hosting, no API key, no rate limit at all. Try this first — it has zero quota risk. Verify CORS with a real browser fetch before committing.
  - Fallback pool if the primary has an issue: (1) Open Topo Data (free, SRTM 30m, 1,000 calls/day, 1/sec, CORS unconfirmed), (2) Open-Elevation public demo (no documented hard limit, best-effort only, least reliable), (3) USGS EPQS (US-only, Tier-1-US cross-check only), (4) Google Elevation API as absolute last resort with a Cloud Console Quota cap set low (e.g. 4,500/month) so it fails closed instead of billing.
  - Quota-exhaustion strategy — do NOT gate by tier (Tier 1 is exactly where static tiles land first; gating Tier 2/3 out would cut off the original target users). Cache lookups by rounded coordinate (~3 decimal places); when every source is exhausted, skip elevation correction and widen the returned uncertainty range instead of failing the request.
- **Building footprints (Tier 2)**: Overture Maps Foundation's unified dataset (already merges Google Open Buildings + Microsoft Footprints + OSM). Their official data is S3-hosted GeoParquet with no lightweight per-building REST endpoint — one-time offline extract of the footprint subset per supported region → host as a static Parquet/PMTiles file → query with DuckDB-WASM or a vector-tile library at runtime.
- **LiDAR-derived roof geometry (Tier 1 — USGS 3DEP / AHN / IGN LiDAR HD)**: same offline-tile pattern as building footprints. Point-cloud processing at request time is not viable in a browser.
- **Tariff data (Tier 1 US)**: OpenEI Utility Rate Database.

## Architecture: tiered by what free data exists at the user's location
- **Tier 1** (US/NL/FR): measured roof geometry from LiDAR (pre-tiled), real tariffs from OpenEI. If the region has 1:1 net metering, self-consumption ratio is irrelevant to annual $ — don't ask for it.
- **Tier 2**: Overture Maps building footprints.
- **Tier 3**: minimal-tap fallback, widest stated uncertainty range, manual overrides available.
- Elevation correction applies in ALL tiers via the pool above — don't gate behind Tier 1.

## Accuracy target (already validated by Monte Carlo — don't re-derive, just hit it)
- Tier 1: ~±11% savings (90% CI)
- Tier 3: ~±24% savings (90% CI)
- If a change measurably worsens these, treat it as a regression.

## Interface
- **Consumes** (`engine-radiation-uncertainty`): `{ kWh_per_m2_per_year, uncertainty_ci_90, ...intermediates }`.
- **Exports** (consumed by `app-rooftop-solar`): a function taking the roof polygon (`[lat, lng][]`), roof metadata (shape, material, shading tap), power-access/self-consumption taps, and location, returning `{ kWh, savings, co2, uncertainty_ci_90 }`.
- Any change to either shape needs a version bump and a coordinated PR on the affected side.

## Before merging any PR
- Run `/code-review` on the diff.
- Check: does every displayed/exported number carry a source and an uncertainty range? Does any new assumption have a comment citing where it came from?
