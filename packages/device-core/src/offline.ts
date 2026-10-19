/** Owner decision 1 (ADR-0112): warnings at 24 h and 48 h, selling stops at the company limit. */
export const OFFLINE_YELLOW_HOURS = 24;
export const OFFLINE_RED_HOURS = 48;

export type OfflineLevel = 'ok' | 'yellow' | 'red' | 'stopped';

export interface OfflineState {
  level: OfflineLevel;
  /** Hours since the last successful sync (download or upload); null when never synced. */
  hoursSinceSync: number | null;
  limitHours: number;
  /** Selling is allowed. */
  canSell: boolean;
}

export function offlineState(
  lastSuccessfulSyncAt: string | Date | null,
  limitHours: number,
  now: Date = new Date(),
): OfflineState {
  if (!lastSuccessfulSyncAt)
    return { level: 'stopped', hoursSinceSync: null, limitHours, canSell: false };
  const hours = Math.max(0, (now.getTime() - new Date(lastSuccessfulSyncAt).getTime()) / 3_600_000);
  const level: OfflineLevel =
    hours >= limitHours
      ? 'stopped'
      : hours >= OFFLINE_RED_HOURS
        ? 'red'
        : hours >= OFFLINE_YELLOW_HOURS
          ? 'yellow'
          : 'ok';
  return { level, hoursSinceSync: hours, limitHours, canSell: level !== 'stopped' };
}
