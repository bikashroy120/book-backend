export function numberInput({ value }: { value: unknown }): unknown {
  if (value === undefined || value === null || typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    return Number(value);
  }
  return value;
}
