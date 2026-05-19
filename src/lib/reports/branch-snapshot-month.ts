import { MONTHS, MONTHS_SHORT } from '@/lib/types';

export function parseBranchSnapshotMonth(month?: string | number | null): number {
  if (typeof month === 'number') {
    return Number.isInteger(month) && month >= 1 && month <= 12 ? month : 0;
  }

  const raw = String(month || '').trim();
  if (!raw) return 0;

  const numeric = Number(raw);
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 12) {
    return numeric;
  }

  const normalized = raw.toLowerCase();
  const fullMonthIndex = MONTHS.findIndex((name) => name.toLowerCase() === normalized);
  if (fullMonthIndex >= 0) {
    return fullMonthIndex + 1;
  }

  const shortMonthIndex = MONTHS_SHORT.findIndex((name) => name.toLowerCase() === normalized);
  if (shortMonthIndex >= 0) {
    return shortMonthIndex + 1;
  }

  return 0;
}
