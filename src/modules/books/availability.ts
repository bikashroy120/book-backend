import { Availability } from '@prisma/client';

export function deriveAvailability(
  stock: number,
  alertLimit: number,
  current?: Availability,
): Availability {
  if (current === Availability.PRE_ORDER) return Availability.PRE_ORDER;
  if (stock <= 0) return Availability.OUT_OF_STOCK;
  if (stock <= alertLimit) return Availability.LOW_STOCK;
  return Availability.IN_STOCK;
}
