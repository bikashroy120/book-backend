/** "Dhaka Model School" -> "dhaka-model-school". Non-latin names return "" (caller falls back). */
export function slugify(input: string, maxLength = 30): string {
  const length = Math.max(0, Math.floor(maxLength));
  return input
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, length)
    .replace(/-+$/g, '');
}
