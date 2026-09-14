# Deterministic economics and emissions (0.5.0)

The app still calls asynchronous `getSystemEconomics` only. There remains exactly
one canonical Radiation v0.1.2 request. No tariff/emissions network integration
was added. A future provider should return the same normalized, source-tagged
input objects; provider fetching does not belong in the pure calculation.

## Inputs and units

Optional `economics` accepts `tariff`, `systemCost`, `compensatedFraction`,
`netMetering`, `lifetimeYears`, `degradation` and `tariffEscalation`.
Optional `emissions` accepts `gridFactor`. All numeric assumptions except horizon
use `{ value, source, range?: [low, high] }`. Source must be nonempty; bounds
must be finite and contain the central value. Tariff uses unit `currency/kWh`
and an uppercase three-letter currency code; cost uses `currency` and the same
code. No conversion between currencies occurs. Grid factor uses `kgCO2e/kWh`;
do not relabel a CO2-only factor as CO2e without a justified conversion.

Illustrative input fragment (synthetic numbers, NOT regional recommendations):

```ts
economics: {
  tariff: { value: 0.20, currency: 'USD', unit: 'currency/kWh', source: 'Synthetic example' },
  systemCost: { value: 5000, currency: 'USD', unit: 'currency', source: 'Synthetic example' },
  lifetimeYears: 25,
  degradation: { value: 0.0065, range: [0.005, 0.008], source: 'Project reference assumption' },
  tariffEscalation: { value: 0, source: 'Flat nominal tariff scenario' },
},
emissions: {
  gridFactor: { value: 0.4, unit: 'kgCO2e/kWh', source: 'Synthetic example' },
}
```

With a tariff, supply an explicit compensated fraction, a self-consumption
category, or verified net metering. Missing compensation is NOT silently set to
mixed. Provisional category mappings: mostly-out=0.30, mixed=0.50,
mostly-home=0.70, each with an illustrative ±0.10 scenario range. These are
engineering placeholders, not measured household behavior. An explicit fraction
overrides categories. `{kind:'true-one-to-one', verified:true, source:'…'}`
overrides both with 1.0 and is valid only for grid-tied input. The caller must
verify that annual caps, credit expiry and export restrictions do not invalidate
full compensation. This is an attestation, not automatic policy verification.

## Formulas and defaults

For year y starting at 1:

- Energy: `E_y = E_1 × (1 - degradation)^(y - 1)`.
- Tariff: `T_y = T_1 × (1 + escalation)^(y - 1)`.
- Savings: `S_y = E_y × compensatedFraction × T_y`.
- Avoided emissions: `C_y = E_y × gridFactor` (all generation, not only self-consumption).
- Lifetime totals: sum each annual row, not a flat multiplier.
- Simple horizon ROI (%): `100 × (sum(S_y) - cost) / cost`.
- Payback: first cumulative crossing of cost, interpolated linearly within that
  year. No crossing within the horizon gives `{years:null,status:'not-within-horizon'}`,
  not Infinity and not a claim that payback can never occur. Scenario years are
  `[optimistic, pessimistic]`, each nullable. Zero cost pays back at year 0;
  ROI is null if cost or its scenario lower bound is zero.

Defaults: 25-year horizon (integer 1–100), degradation 0.65%/year with project
0.5–0.8% range, flat nominal escalation 0% held fixed unless a range is supplied.
These are disclosed assumptions, not local forecasts or warranties. Escalation
is a fractional annual rate in [-1,1]; degradation is in [0,1]. First-year
generation is not degraded again. There are no default tariffs, costs or grid
factors. A currency code is syntactically checked, not verified against a registry.

No financing, discount rate, O&M, replacements, inflation conversion, tax,
incentives, demand charges, time-of-use pricing, export tariff schedule, storage,
curtailment, hourly matching or lifecycle embodied-carbon model is included.
Grid displacement of all generation is explicitly an assumption; generator/no-power
cases carry a warning and require a justified counterfactual before presentation.

## Output and uncertainty

Top-level `savings` and `co2` are first-year metric objects or null, not bare
numbers. Read `.value`, `.unit`, `.scenarioEnvelope` and conditional intervals.
`economics` contains annual rows, totals, ROI, payback, sources and assumptions.
This public shape change requires app coordination; package version is 0.5.0.
Without layout/physical energy, economics is null. With energy but no economic
inputs, annual energy is available and unavailable monetary/emissions metrics
remain null. Status becomes `economics-estimate` when either savings or CO2 exists;
that status does not certify data quality or completeness.

Each energy/savings/emissions metric separates the Radiation-only interval
conditional on central downstream inputs, the physical envelope conditional on
central economic inputs, and the combined scenario envelope. Full physical
uncertainty metadata (including orientation, elevation and calibration status)
is preserved under `economics.uncertainty.physical`. Economic input assumptions
and their ranges are independently exposed. Lower outcomes combine lower energy,
tariff, compensation, escalation/emissions with higher degradation; upper
outcomes reverse those endpoints. ROI additionally reverses the cost endpoints.
Annual scenarios remain coherent across years: the same endpoint rate is used
throughout each trajectory, not independent annual resampling.

These are conservative endpoint *scenarios*, not guaranteed bounds or joint
probability estimates. No independence, calibrated distribution or Monte Carlo
coverage is claimed. Omitted ranges mean fixed in this scenario, not certain.
Top-level `uncertainty_ci_90` remains null. No Tier accuracy target is enforced
by narrowing intervals. Existing physical provisional labels are unchanged.

The engine is ready for app integration testing with explicit sourced inputs,
not for claims of validated financial accuracy. The app owns data entry,
attestation, display of units/unknowns/scenarios, maps, i18n and reporting.
