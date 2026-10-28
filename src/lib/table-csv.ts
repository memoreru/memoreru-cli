export function formatPulledTableCell(value: unknown, columnType: string): string {
  if (value == null) return '';
  if (columnType === 'url' && typeof value === 'object' && 'url' in value) {
    return String((value as { url?: unknown }).url ?? '');
  }
  return String(value);
}
