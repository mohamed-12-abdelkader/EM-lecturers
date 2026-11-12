import { describe, expect, it } from 'vitest';
import { decideEssayOutcome, extractJsonObject } from '../essayEvaluation';

describe('decideEssayOutcome', () => {
  it('accepts a complete correct answer', () => {
    const result = decideEssayOutcome(
      {
        status: 'correct',
        awarded_score: 5,
        max_score: 5,
        reason: 'الإجابة كاملة',
        matched_points: ['التعريف', 'التفسير'],
        missing_points: [],
        errors: [],
        review_required: false,
      },
      5,
      { hasContent: true, readable: true },
    );
    expect(result.status).toBe('correct');
    expect(result.finalScore).toBe(5);
  });

  it('accepts a clearly incorrect answer as zero', () => {
    const result = decideEssayOutcome(
      {
        status: 'incorrect',
        awarded_score: 0,
        reason: 'خطأ علمي',
        matched_points: [],
        missing_points: ['التعريف'],
        errors: ['عكس العلاقة'],
        review_required: false,
      },
      5,
      { hasContent: true, readable: true },
    );
    expect(result.status).toBe('incorrect');
    expect(result.finalScore).toBe(0);
  });

  it('sends a partial score to the teacher', () => {
    const result = decideEssayOutcome(
      {
        status: 'correct',
        awarded_score: 3,
        reason: 'ناقص مثال',
        matched_points: ['التعريف'],
        missing_points: ['المثال'],
        errors: [],
        review_required: false,
      },
      5,
      { hasContent: true, readable: true },
    );
    expect(result.status).toBe('needs_review');
    expect(result.finalScore).toBeNull();
    expect(result.awardedScore).toBe(3);
  });

  it('does not mark an unreadable image as wrong', () => {
    const result = decideEssayOutcome(null, 5, { hasContent: true, readable: false });
    expect(result.status).toBe('needs_review');
    expect(result.finalScore).toBeNull();
  });

  it('gives zero when the student submitted nothing', () => {
    const result = decideEssayOutcome(null, 5, { hasContent: false, readable: false });
    expect(result.status).toBe('incorrect');
    expect(result.finalScore).toBe(0);
  });

  it('keeps review when the model asks for it', () => {
    const result = decideEssayOutcome(
      {
        status: 'correct',
        awarded_score: 5,
        matched_points: ['النقطة'],
        errors: [],
        review_required: true,
      },
      5,
      { hasContent: true, readable: true },
    );
    expect(result.status).toBe('needs_review');
    expect(result.finalScore).toBeNull();
  });
});

describe('extractJsonObject', () => {
  it('reads fenced JSON', () => {
    const parsed = extractJsonObject('```json\n{"status":"incorrect","awarded_score":0}\n```');
    expect(parsed?.status).toBe('incorrect');
  });
});
