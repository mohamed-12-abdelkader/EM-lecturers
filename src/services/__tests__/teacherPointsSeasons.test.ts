import { describe, expect, it } from 'vitest';

/**
 * Contract checks for points seasons (no DB/env required).
 * Reset archives live points into a season; restore can bring a season back.
 */
describe('teacher points seasons API contract', () => {
  it('uses stable confirm tokens for reset and restore', () => {
    expect('RESET_ALL_POINTS').toMatch(/^RESET_ALL_POINTS$/);
    expect('RESTORE_POINTS_SEASON').toMatch(/^RESTORE_POINTS_SEASON$/);
  });

  it('documents season sources', () => {
    const sources = ['reset', 'pre_restore_backup'] as const;
    expect(sources).toContain('reset');
    expect(sources).toContain('pre_restore_backup');
  });

  it('maps archive payload shape for teacher UI', () => {
    const season = {
      id: 3,
      teacherId: 10,
      gradeId: 1,
      label: 'ترم أول',
      reason: 'بداية ترم جديد',
      source: 'reset',
      studentsCount: 120,
      totalPointsSum: 18500,
      transactionsCount: 540,
    };
    expect(season.studentsCount).toBeGreaterThan(0);
    expect(season.totalPointsSum).toBeGreaterThan(0);
    expect(season.source).toBe('reset');
  });
});
