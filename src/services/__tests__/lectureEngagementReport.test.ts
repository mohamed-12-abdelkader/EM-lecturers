import { describe, expect, it } from 'vitest';
import { resolveLectureEngagementStatus } from '../lectureEngagementStatus';

describe('resolveLectureEngagementStatus', () => {
  it('marks full watch as COMPLETED', () => {
    expect(
      resolveLectureEngagementStatus({
        totalVideos: 10,
        watchedVideos: 10,
        hasOpenedLecture: true,
      }),
    ).toBe('COMPLETED');
  });

  it('marks mid progress as PARTIALLY_COMPLETED', () => {
    expect(
      resolveLectureEngagementStatus({
        totalVideos: 10,
        watchedVideos: 4,
        hasOpenedLecture: true,
      }),
    ).toBe('PARTIALLY_COMPLETED');
  });

  it('marks one-of-many as STARTED', () => {
    expect(
      resolveLectureEngagementStatus({
        totalVideos: 10,
        watchedVideos: 1,
        hasOpenedLecture: true,
      }),
    ).toBe('STARTED');
  });

  it('marks opened without videos as STARTED', () => {
    expect(
      resolveLectureEngagementStatus({
        totalVideos: 10,
        watchedVideos: 0,
        hasOpenedLecture: true,
      }),
    ).toBe('STARTED');
  });

  it('marks never opened as NOT_STARTED', () => {
    expect(
      resolveLectureEngagementStatus({
        totalVideos: 10,
        watchedVideos: 0,
        hasOpenedLecture: false,
      }),
    ).toBe('NOT_STARTED');
  });
});
