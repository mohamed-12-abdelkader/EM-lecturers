export type LectureEngagementStatus =
  | 'COMPLETED'
  | 'PARTIALLY_COMPLETED'
  | 'STARTED'
  | 'NOT_STARTED';

/** عتبة نسبة المشاهدة الفاصلة بين STARTED و PARTIALLY_COMPLETED (نفس منطق المنصة ≈ 33%). */
export const PARTIAL_THRESHOLD_PERCENT = 33.33;

export function resolveLectureEngagementStatus(input: {
  totalVideos: number;
  watchedVideos: number;
  hasOpenedLecture: boolean;
}): LectureEngagementStatus {
  const { totalVideos, watchedVideos, hasOpenedLecture } = input;

  if (totalVideos <= 0) {
    return hasOpenedLecture ? 'COMPLETED' : 'NOT_STARTED';
  }
  if (watchedVideos >= totalVideos) return 'COMPLETED';
  if (watchedVideos <= 0) {
    return hasOpenedLecture ? 'STARTED' : 'NOT_STARTED';
  }

  const pct = (watchedVideos / totalVideos) * 100;
  if (pct >= PARTIAL_THRESHOLD_PERCENT) return 'PARTIALLY_COMPLETED';
  return 'STARTED';
}
