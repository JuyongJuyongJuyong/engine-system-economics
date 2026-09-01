import { describe, expect, it } from 'vitest';
import { getSystemEconomics } from './index';

describe('getSystemEconomics', () => {
  it('is not implemented yet (placeholder so CI has something to run)', () => {
    expect(() =>
      getSystemEconomics({
        roofPolygon: [
          [37.5, 127.0],
          [37.5001, 127.0],
          [37.5001, 127.0001],
          [37.5, 127.0001],
        ],
        roofMetadata: { shape: 'flat', material: 'concrete', shadingTap: 0 },
        powerAccess: 'grid-tied',
        radiation: { kWh_per_m2_per_year: 1500, uncertainty_ci_90: [1300, 1700] },
      }),
    ).toThrow();
  });
});
