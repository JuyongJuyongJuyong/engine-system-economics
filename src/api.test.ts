import { expectTypeOf, it } from 'vitest';
import { getSystemEconomics, type SystemEconomicsInput, type SystemEconomicsOutput } from './index';

it('keeps the finalized input closed to public surface and radiation fields', () => {
  expectTypeOf<keyof SystemEconomicsInput>().toEqualTypeOf<
    'roofPolygon' | 'roofMetadata' | 'location' | 'radiationTier' | 'dataTier' | 'powerAccess' | 'selfConsumption' | 'layout' | 'physical' | 'economics' | 'emissions'
  >();
  expectTypeOf<ReturnType<typeof getSystemEconomics>>().toEqualTypeOf<Promise<SystemEconomicsOutput>>();
});
