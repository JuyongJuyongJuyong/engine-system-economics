# engine-system-economics
Browser-only foundations for the Global Rooftop Solar Calculator.

## Current API

```ts
import { getSystemEconomics } from 'engine-system-economics';

const result = await getSystemEconomics({
  roofPolygon: [[37.5, 127], [37.5001, 127], [37.5001, 127.0002], [37.5, 127.0002]],
  roofMetadata: { shape: 'flat', material: 'concrete', shadingTap: 0 },
  location: { lat: 37.50005, lng: 127.0001 },
  radiationTier: 1,
  powerAccess: 'grid-tied',
});
```

The finalized input also supports optional `dataTier: 1 | 2 | 3` and
`selfConsumption: 'mostly-out' | 'mixed' | 'mostly-home'`. dataTier stays
unspecified when omitted and never changes radiationTier. Shading taps must be
finite; no categorical numeric mapping or shading loss is invented yet.

One Radiation v0.1.2 call receives only location and radiationTier. No tilt or
azimuth overrides are passed. Roof shape is descriptive. Radiation estimates a
canonical latitude-tilted, equator-facing surface; its result is irradiation in
kWh/m²/year, not electrical output or actual roof orientation.

## Foundation result and limitations

With layout, `status` is `physical-estimate` and `kWh` is an annual electrical
estimate with separate physical inputs/factors and elevation diagnostics. Without
layout, status remains `foundations-only` and kWh is null. Optional sourced
`economics` and `emissions` inputs enable first-year `savings` and `co2` metric
objects and `economics-estimate` status. Each metric carries value, unit and
scenario ranges. The reserved final savings `uncertainty_ci_90` remains null. Raw Radiation
values and its p5/p95 interval are under `radiation`. Geometry, assumptions,
provenance, warnings and provisional uncertainty are separate fields.

Unknown orientation expands the upstream interval endpoints by a provisional
25% scenario allowance (`low * 0.75`, `high * 1.25`). This is a disclosed engineering
assumption requiring calibration, not a guaranteed bound or a system 90% CI.
It does not establish the Tier 1/Tier 3 savings accuracy targets. Those targets
cannot be enforced by clipping an interval: upstream Tier 1 uncertainty alone
can exceed the historical ±11% savings target.

Location must be inside or on the polygon boundary. Invalid inputs reject
before any Radiation call. Open and closed rings are accepted without mutation.
Exact retraced spikes and consecutive duplicate points are repaired with a warning.
Proper crossings, touching lobes, remaining repeated vertices and collinear-edge
polygons are rejected as ambiguous. At most 1000 input vertices are
accepted (quadratic intersection validation). Polar latitudes (absolute latitude
85 or above), dateline crossings and coordinate extents exceeding 0.02 degrees
from the first vertex are explicitly unsupported in this foundation.

Footprint area uses a mean-Earth-sphere geographic surface integral, not Web
Mercator. It is an approximate horizontal area; no measured uncertainty or
sloped panel area is inferred. Longest-edge bearing is a diagnostic only and
depends on traversal direction; it is never forwarded to Radiation.

Radiation failures propagate with no retries. The package cannot identify
upstream source fallback because Radiation v0.1.2 does not return that metadata.

## Development

```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

The dependency remains Git-tag pinned to Radiation v0.1.2. The package version
is bumped to 0.5.0 for the explicit-input economics API; no release is published by this
change. See [ECONOMICS_MODEL.md](ECONOMICS_MODEL.md) for input examples, category
assumptions, lifetime savings, ROI/payback, emissions, units and scenario propagation.
Provider integration, measured roof planes and full installation design remain
subsequent phases. See PHYSICAL_MODEL.md for physical formulas, defaults, calibration
results, elevation fallback policy, and limitations.

Physical uncertainty separates the propagated Radiation-only conditional interval
from provisional orientation/physical/elevation allowances. Per-input provenance
identifies caller values versus reference assumptions. Synthetic scenario and
monotonicity validation does not establish empirical confidence coverage; see the
physical uncertainty validation section in PHYSICAL_MODEL.md.

## Geometry repair and layout

Pass optional `layout` to `getSystemEconomics`, or call the pure public function
`calculatePanelLayout(roofPolygon, options)` without a Radiation request:

```ts
import { calculatePanelLayout } from 'engine-system-economics';
const layout = calculatePanelLayout(roofPolygon, {
  panel: { widthM: 1.1, lengthM: 1.8, ratedPowerW: 400 }, // illustrative caller-supplied specification
  edgeClearanceM: 0.3, // caller chooses applicable setback
  allowRotation: true,
  keepOutZones: [{ polygon: chimneyPolygon }], // same [lat, lng] convention
});
```

No panel specifications or setbacks are defaulted. Returned layout includes
panel count, DC capacity in kW, module-covered area, usable/unused area, geographic
and local-meter placement corners, and warnings/diagnostics. Omitting layout
leaves `result.layout` null and electrical energy unavailable. With layout,
optional `physical` parameters override disclosed reference assumptions.

Repair removes only exact consecutive duplicates and retraced A-B-A spikes,
which have zero enclosed area. A proper bow tie or touching/disconnected lobes
has no reliable inferred user intent; it raises an error instead of selecting a
lobe or filling the convex hull. The cleaned polygon remains geographic and
is returned with a warning for caller review. Inputs are never modified.

Layout projects around the roof's vertex-average center using local WGS84
meridian/prime-vertical curvature scales. This first-order meter projection is
appropriate only within the documented roof-scale bounds; it does not infer
slope. Physical geographic footprint area remains a spherical approximation in
`footprintArea.ts`, isolated from layout so an ellipsoidal provider can replace
it without changing the layout API. Spherical area may differ from ellipsoidal
area by roughly half a percent. Layout areas explicitly use the local metric.

Clipper integer operations (micrometer numerical resolution) inset the roof by
the supplied clearance and subtract the union of keep-outs. Calibration removed
artificial millimeter margins that lost entire rows on exact-fit fixtures.
Keep-outs must be wholly inside the roof; overlapping zones are subtracted once.
Split usable regions are allowed because they arise from explicit obstacles,
not ambiguous input repair. No module may bridge the gap. Boundary contact with
keep-outs is allowed at micrometer numerical precision; add desired obstacle clearance to
the input obstacle polygon. This is a geometric layout, not a code-compliance
setback or rack-design tool.

The heuristic searches at most eight east/north-aligned grids: 0/90-degree module
rotation and four half-cell origin offsets. Greedy inclusion follows rows then
columns; equal panel counts keep the earlier grid. Each candidate's entire
rectangle must be inside usable space (polygon difference test). Grid construction
prevents panel overlap. There is no mixed rotation within one grid. It may miss
better rotated or mixed layouts, especially on diagonal/irregular roofs.

Search stops after 20,000 candidates and reports truncation; at most 100 keep-outs
and 4000 combined vertices are accepted. Polygon validation is quadratic in ring
vertices; candidate clipping cost depends on usable polygon complexity, with a
fixed candidate budget. `NO_PANELS_FIT` means this search found none, not a proof
of global infeasibility. Numerical precision does not imply surveyed accuracy;
callers must supply actual installation clearances.
Identical inputs produce identical ordering and layouts.
