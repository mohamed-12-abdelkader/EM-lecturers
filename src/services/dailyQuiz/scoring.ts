import type { DailyQuizRow } from '../../db/types/dailyQuiz';

export type ScoredAnswer = {
  question_id: number;
  selected_answer: 'A' | 'B' | 'C' | 'D' | null;
  is_correct: boolean;
  points_awarded: number;
};

/**
 * احتساب نقاط المسابقة اليومية على السيرفر فقط.
 * - الإجابة الصحيحة = نقاط السؤال
 * - الخاطئة / الفارغة = 0
 * - speed bonus: حسب الترتيب أو نسبة الزمن المتبقي
 */
export class DailyQuizScoring {
  static scoreAnswers(
    questions: Array<{ id: number; correct_answer: string; points: number }>,
    answers: Array<{ question_id: number; selected_answer?: string | null }>,
  ): {
    scored: ScoredAnswer[];
    correct_count: number;
    wrong_count: number;
    unanswered_count: number;
    base_points: number;
    max_base_points: number;
  } {
    const byQ = new Map(answers.map((a) => [a.question_id, a.selected_answer ?? null]));
    const scored: ScoredAnswer[] = [];
    let correct = 0;
    let wrong = 0;
    let unanswered = 0;
    let base = 0;
    let maxBase = 0;

    for (const q of questions) {
      maxBase += q.points;
      const selected = byQ.get(q.id) ?? null;
      const normalized =
        selected && ['A', 'B', 'C', 'D'].includes(String(selected).toUpperCase())
          ? (String(selected).toUpperCase() as 'A' | 'B' | 'C' | 'D')
          : null;

      if (!normalized) {
        unanswered += 1;
        scored.push({
          question_id: q.id,
          selected_answer: null,
          is_correct: false,
          points_awarded: 0,
        });
        continue;
      }

      const isCorrect = normalized === q.correct_answer;
      const points = isCorrect ? q.points : 0;
      if (isCorrect) correct += 1;
      else wrong += 1;
      base += points;
      scored.push({
        question_id: q.id,
        selected_answer: normalized,
        is_correct: isCorrect,
        points_awarded: points,
      });
    }

    return {
      scored,
      correct_count: correct,
      wrong_count: wrong,
      unanswered_count: unanswered,
      base_points: base,
      max_base_points: maxBase,
    };
  }

  static computeRankBonus(
    quiz: Pick<DailyQuizRow, 'rank_bonus_start' | 'rank_bonus_step' | 'rank_bonus_min'>,
    finishRank: number,
  ): number {
    if (finishRank < 1) return 0;
    const bonus = quiz.rank_bonus_start - (finishRank - 1) * quiz.rank_bonus_step;
    return Math.max(quiz.rank_bonus_min, bonus);
  }

  static computeTimeRatioBonus(
    quiz: Pick<DailyQuizRow, 'time_ratio_max_bonus' | 'duration_seconds'>,
    durationMs: number,
  ): number {
    const durationMsMax = Math.max(1, quiz.duration_seconds * 1000);
    const remainingRatio = Math.max(0, 1 - durationMs / durationMsMax);
    return Math.round(remainingRatio * quiz.time_ratio_max_bonus);
  }

  static computeSpeedBonus(
    quiz: Pick<
      DailyQuizRow,
      | 'scoring_mode'
      | 'rank_bonus_start'
      | 'rank_bonus_step'
      | 'rank_bonus_min'
      | 'time_ratio_max_bonus'
      | 'duration_seconds'
    >,
    finishRank: number,
    durationMs: number,
    hasAnyCorrect: boolean,
  ): number {
    if (!hasAnyCorrect) return 0;
    if (quiz.scoring_mode === 'time_ratio') {
      return this.computeTimeRatioBonus(quiz, durationMs);
    }
    return this.computeRankBonus(quiz, finishRank);
  }

  /** XP: نقاط الأساس + نصف البونص (تقريب) */
  static computeXp(basePoints: number, speedBonus: number): number {
    return Math.max(0, Math.round(basePoints + speedBonus * 0.5));
  }

  /** Coins: 1 لكل 10 نقاط إجمالية */
  static computeCoins(totalPoints: number): number {
    return Math.max(0, Math.floor(totalPoints / 10));
  }

  /** Level من XP — منحنى بسيط قابل للتوسع حتى Level 100 */
  static levelFromXp(xp: number): number {
    // كل مستوى يحتاج ~100 * level XP تراكمي تقريبي
    let level = 1;
    let need = 100;
    let remaining = Math.max(0, xp);
    while (level < 100 && remaining >= need) {
      remaining -= need;
      level += 1;
      need = 100 + (level - 1) * 25;
    }
    return level;
  }

  static xpProgress(xp: number): { level: number; xp_into_level: number; xp_for_next: number; progress: number } {
    let level = 1;
    let need = 100;
    let remaining = Math.max(0, xp);
    while (level < 100 && remaining >= need) {
      remaining -= need;
      level += 1;
      need = 100 + (level - 1) * 25;
    }
    const xpForNext = level >= 100 ? 0 : need;
    const progress = xpForNext === 0 ? 1 : Math.min(1, remaining / xpForNext);
    return { level, xp_into_level: remaining, xp_for_next: xpForNext, progress };
  }
}
