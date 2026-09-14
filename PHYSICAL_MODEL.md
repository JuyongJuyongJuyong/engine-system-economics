# Calibration and first physical model

## Layout calibration

Synthetic fixtures use 1×2 m modules, 400 W rated power, zero requested clearance,
and geographic coordinates derived from the local WGS84 metric at 37°N, 127°E.
They are analytic fixtures, not surveyed roof validation. Tests independently
sample placement edges against roof boundaries and check repeated results.

| Fixture | Count | Selected rotation |
|---|---:|---:|
| Exact 10×10 m | 50 | 0° |
| Near-fit 10.001×10.001 m | 50 | 0° |
| Undersized 9.999×10 m | 45 | 0° |
| Narrow 0.8×10 m | 0 | — |
| Exact 2×1 m | 1 | 90° |
| Convex trapezoid, 80 m² | 34 | 0° |
| Concave notch, 75 m² | 35 | 0° |
| Central 2×2 m keep-out in 10×10 m | 48 | 0° |
| Near-edge keep-out, 3.8 m² | 48 | 0° |

The prior artificial millimeter offsets could lose entire rows in exact fits.
Clipping now uses micrometer integer coordinates, rounds panel pitch upward,
and accepts contact at the quantized boundary. No artificial setback is added.
This precision is numerical, not measurement accuracy: callers must specify
real installation clearance. Grid count/order/20,000-candidate budget remain
unchanged. Arbitrary angle and mixed-orientation optimum packing are not claimed.
Geographic footprint area remains isolated in footprintArea.ts for replacement
with ellipsoidal geodesics; physical generation uses rated layout capacity.

## Calling the physical model

With `layout`, getSystemEconomics now resolves elevation and returns
`status: 'physical-estimate'`, numeric `kWh`, and separate `physical` / `elevation`
details. Without layout it retains the foundation-only result. `physical` options
without layout reject before network requests. Radiation still receives exactly
one canonical location/tier call without tilt or azimuth. As of 0.5.0, optional
explicit economics/emissions inputs enable savings and CO2; see ECONOMICS_MODEL.md.
The reserved final savings confidence interval remains null and all physical
uncertainty labels are preserved.

Optional `physical` inputs include ambientTemperatureC, representativePoaWm2,
noctC (or nmotC plus required moduleToCellDeltaC), temperatureCoefficientPerC,
inverterEfficiency, wiringFactor, mismatchFactor, availabilityFactor,
soilingFactor, shadingFactor and source. Retained factors are fractions [0,1],
not loss percentages. Gamma uses fractional change per °C (e.g. -0.004, not -0.4).
Shading tap categories are not mapped to invented factors. Aridity is not
inferred; the explicit soiling retained factor represents cleaning/aridity effects.

## Equations and disclosed reference assumptions

The simplified NOCT relation uses reference conditions 20°C ambient and 800 W/m²:

`Tcell = Tambient + elevationTemperatureAdjustment + (TnominalCell - 20) × G / 800`

`temperatureFactor = max(0, 1 + gamma × (Tcell - 25))`

`baseline = inverter × wiring × mismatch × availability`

`PR = baseline × temperatureFactor × soiling × shading`

`annualElectricalKwh = annualPOA / (1 kW/m²) × installedDcCapacityKw × PR`

The rated DC capacity already includes module conversion efficiency. It must not
be multiplied by module efficiency a second time. Module-covered area is exposed
for inspection but does not independently scale energy. NMOT is module rather
than cell temperature, so an explicit module-to-cell increment is required.

If missing, the reference scenario uses ambient 20°C, operating POA 800 W/m²,
NOCT 45°C, gamma -0.004/°C, inverter 0.96, wiring 0.98, mismatch 0.98,
availability 0.99, and neutral soiling/shading 1. These are engineering assumptions,
not observed local climate or manufacturer specifications. Every default is
returned as an assumption. There is no climate fetch or implied regional aridity.
The annual POA total cannot establish energy-weighted operating temperature;
this first model is a representative-condition approximation, not hourly PVWatts.

Formula references:
- https://pvpmc.sandia.gov/modeling-guide/2-dc-module-iv/point-value-models/pvwatts/
- https://pvpmc.sandia.gov/app/uploads/sites/243/2022/10/2010_PVMC-Workshop-Report_SAND2011-3419.pdf

## Elevation and failure behavior

Order: AWS/Mapzen Terrarium → OpenTopoData SRTM30m → Open-Elevation → eligible
USGS EPQS → explicitly configured Google. Terrain, OpenTopoData, Open-Elevation
apply in every radiation tier, independently of dataTier. EPQS is only eligible
when physical.elevation.countryCode is US and radiationTier is 1. Google is
disabled unless apiKey and quotaCapConfirmed:true are supplied; the actual low
Cloud Console cap is the caller's responsibility. Browser CORS may still cause
any provider to fail. No paid provider is part of the default path.

Round both coordinates to three decimal places for deterministic lookup/cache.
Cache keys include provider eligibility/configuration. Success TTL: 24 hours;
failure TTL: 60 seconds; maximum 256 entries; matching concurrent calls coalesce.
Each provider times out and aborts after 2.5 seconds. OpenTopoData has a local
one-attempt-per-second gate; a busy gate skips to the next provider. Remote
429/quota errors also fall through. No retries. Provider URLs/keys are not
serialized into errors or results. Missing/invalid values reject; Open-Elevation
zero is ambiguous under its API and conservatively falls through.

Terrarium reads zoom-12 256-pixel PNGs using createImageBitmap with color conversion
disabled and OffscreenCanvas. Height is R*256 + G + B/256 - 32768. Unsupported
browser APIs, decoding errors, transparent pixels and CORS failure all fall through.
The rounded lookup is terrain height, not a building roof survey.

Browser verification in this implementation session: the local
scripts/terrain-smoke.html page fetched the S3 tile cross-origin through the
actual compiled elevation resolver and read its pixel using browser image/canvas
APIs. At 37.5°N, 127°E, result was resolved/terrarium, 23 meters. This validates
that browser's CORS/decode path for that tile; it is not global provider uptime
or a surveyed elevation accuracy check. Re-run after browser/runtime changes.

No automatic irradiation elevation multiplier is applied: the all-sky Radiation
source may already include terrain effects, so a generic uplift risks double
counting. Temperature is adjusted only when caller climate has ambient temperature,
climateReferenceElevationM and lapseRateCPerM. The correction is
`(resolvedElevation - climateReferenceElevationM) × lapseRateCPerM`.
Without those inputs or elevation, correction is zero with a warning.

Provider contracts: https://github.com/tilezen/joerd/blob/master/docs/use-service.md,
https://www.opentopodata.org/api/,
https://github.com/Jorl17/open-elevation/blob/master/docs/api.md,
https://apps.nationalmap.gov/epqs/.

## Uncertainty limits

Raw Radiation p5/p95 stays observable. Orientation allowance remains 25% because
the new thermal model supplies no roof-orientation evidence. The electrical
scenario envelope multiplies radiation endpoints by capacity and PR, then expands
by orientation 25%, physical 30% when any input defaults (10% otherwise), and
elevation 10% unavailable (2% resolved). These are disclosed provisional scenario
allowances, not independent sigmas, guaranteed bounds, or a calibrated 90% CI.
Neither the Tier-1 ±11% nor Tier-3 ±24% savings target is claimed achieved.

Remaining work: regional energy-weighted climate and source errors, roof tilt,
row shading, hardware-specific thermal data, wind/mounting, inverter clipping,
storage/dispatch, calibrated system uncertainty and ellipsoidal footprint area.
No tariff, lifetime degradation, savings, ROI or carbon calculations are included.

## Physical uncertainty validation pass (0.4.1)

Synthetic scenarios at fixed 4 kW DC and 1500 kWh/m²/year POA:

| Scenario label | Ambient °C | Operating POA W/m² | NOCT °C | Gamma /°C | Soiling retained | Cell °C | PR | Annual kWh |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Hot/humid reference | 32 | 700 | 45 | -0.004 | 0.98 | 53.875 | 0.7754 | 4652.2 |
| Hot/dry reference | 40 | 900 | 48 | -0.0035 | 0.90 | 71.500 | 0.6740 | 4044.2 |
| Temperate reference | 20 | 700 | 42 | -0.003 | 0.97 | 39.250 | 0.8306 | 4983.5 |
| Cooler reference | 5 | 600 | 40 | -0.004 | 0.99 | 20.000 | 0.9033 | 5419.7 |

All use explicit inverter/wiring/mismatch/availability/shading retained factors
0.96/0.98/0.98/0.99/0.98. Labels are scenario descriptions, not automatic regional
presets. Humidity is not independently modeled. None are observations or module
datasheet validations. Different scenario results combine several effects;
isolated parameter sweeps separately test monotonicity.

Tests sweep ambient temperature, NOCT, negative/zero gamma, soiling/shading and
baseline retained factors, plus capacity. They compare equivalent NOCT and
NMOT-plus-cell-delta configurations. Hotter cells never increase modeled output;
greater losses reduce output; capacity and envelope scale proportionally.
When a real mocked elevation provider chain fails, temperature correction is
skipped, energy remains finite and relative scenario width grows. When altitude
changes the central estimate, absolute interval endpoints need not contain those
from a different central scenario; the test checks normalized width.

The output now separates `radiationOnlyConditionalIntervalKwh` from the wider
`energyScenarioEnvelopeKwh`. The conditional interval propagates Radiation's
p5/p95 while all downstream inputs remain fixed. It is not a full-system CI,
and the upstream model itself is not proof of empirical coverage.
`uncertainty.components` identifies one upstream-model component and three
provisional allowances. `calibrationStatus` explicitly remains
`not-empirically-calibrated`. No allowance has been narrowed to fit a target.

`inputProvenance` records each used numeric physical input, its value, whether
it came from the caller or a reference fallback, and its source status. Every
fallback remains independently disclosed even if a caller supplies a citation.
A supplied value (even one matching a default) reduces the completeness-based
allowance from 30% to 10% only under the existing provisional policy; it does
not establish lower measurement error or a statistical coverage guarantee.

Readiness: deterministic mechanics and monotonic relationships are stable enough
to begin an economics layer consuming scenario estimates. They are not validated
for site-specific accuracy, financial guarantees, or Tier-1/Tier-3 target widths.
Economics must carry the conditional/provisional distinction through monetary
outputs. Empirical coverage calibration needs independent site measurements,
climate and module provenance, and actual orientation information.
