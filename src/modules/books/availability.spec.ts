import { Availability } from '@prisma/client';
import { deriveAvailability } from './availability';

describe('deriveAvailability', () => {
  it('derives stock states and preserves the manual pre-order state', () => {
    expect(deriveAvailability(0, 5)).toBe(Availability.OUT_OF_STOCK);
    expect(deriveAvailability(5, 5)).toBe(Availability.LOW_STOCK);
    expect(deriveAvailability(6, 5)).toBe(Availability.IN_STOCK);
    expect(deriveAvailability(0, 5, Availability.PRE_ORDER)).toBe(
      Availability.PRE_ORDER,
    );
  });
});
