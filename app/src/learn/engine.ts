// How the DevOps teacher chooses what to ask. All pure functions of your answer
// history, so they are easy to test: today's question, a five-question quiz, the
// streak, and the summary numbers.

import { QUESTIONS, TOPICS, type Question, type Topic } from "./questions.ts";

export interface AnswerRecord { id: string; correct: boolean; choice: number; day: string; at: string; mode: "daily" | "quiz"; }

/** Calendar day (YYYY-MM-DD) in the given time zone, so "today" matches your day, not the server's. */
export function dayKey(date: Date, timeZone = "America/Chicago"): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
const dayNumber = (key: string) => Math.floor(Date.parse(key + "T00:00:00Z") / 86400000);
const keyOf = (n: number) => new Date(n * 86400000).toISOString().slice(0, 10);

/** The most recent answer for each question. */
export function lastAttempts(answers: AnswerRecord[]): Map<string, AnswerRecord> {
  const last = new Map<string, AnswerRecord>();
  for (const a of answers) last.set(a.id, a);
  return last;
}

/** Misses come back after two days; otherwise the next new question, rotating through topics; otherwise the one asked longest ago. */
export function pickDaily(answers: AnswerRecord[], day: string, bank: Question[] = QUESTIONS): Question {
  const last = lastAttempts(answers);
  const due = bank.filter(q => { const a = last.get(q.id); return a && !a.correct && dayNumber(day) - dayNumber(a.day) >= 2; })
    .sort((x, y) => last.get(x.id)!.at.localeCompare(last.get(y.id)!.at));
  if (due.length) return due[0]!;
  const unseen = bank.filter(q => !last.has(q.id));
  if (unseen.length) {
    const seen = new Map<Topic, number>();
    for (const q of bank) if (last.has(q.id)) seen.set(q.topic, (seen.get(q.topic) ?? 0) + 1);
    const topic = TOPICS.filter(t => unseen.some(q => q.topic === t))
      .sort((a, b) => ((seen.get(a) ?? 0) - (seen.get(b) ?? 0)) || TOPICS.indexOf(a) - TOPICS.indexOf(b))[0]!;
    return unseen.find(q => q.topic === topic)!;
  }
  return [...bank].sort((x, y) => last.get(x.id)!.at.localeCompare(last.get(y.id)!.at))[0]!;
}

/** Five questions with a mix of topics, favoring ones you missed, then ones you haven't seen. */
export function buildQuiz(answers: AnswerRecord[], count = 5, random: () => number = Math.random, bank: Question[] = QUESTIONS): Question[] {
  const last = lastAttempts(answers);
  const rank = (q: Question) => { const a = last.get(q.id); return !a ? 1 : a.correct ? 2 : 0; };
  const shuffled = bank.map(q => ({ q, r: random() })).sort((a, b) => a.r - b.r).map(x => x.q).sort((a, b) => rank(a) - rank(b));
  const picked: Question[] = [];
  const topics = new Set<Topic>();
  for (const q of shuffled) if (picked.length < count && !topics.has(q.topic)) { picked.push(q); topics.add(q.topic); }
  for (const q of shuffled) if (picked.length < count && !picked.includes(q)) picked.push(q);
  return picked;
}

/** Consecutive days with at least one answer, counting back from today (or from yesterday if you haven't answered yet today). */
export function streakOf(answers: AnswerRecord[], day: string): number {
  const days = new Set(answers.map(a => a.day));
  let n = dayNumber(day);
  if (!days.has(keyOf(n))) n -= 1;
  let streak = 0;
  while (days.has(keyOf(n))) { streak += 1; n -= 1; }
  return streak;
}

export function summarize(answers: AnswerRecord[], day: string, bank: Question[] = QUESTIONS) {
  const last = lastAttempts(answers);
  const byTopic = TOPICS.map(topic => {
    const ids = bank.filter(q => q.topic === topic);
    const attempted = ids.filter(q => last.has(q.id));
    return { topic, total: ids.length, attempted: attempted.length, correct: attempted.filter(q => last.get(q.id)!.correct).length };
  });
  const recent = answers.slice(-50);
  return {
    streak: streakOf(answers, day),
    answeredToday: answers.filter(a => a.day === day).length,
    answeredTotal: answers.length,
    accuracy: recent.length ? Math.round(recent.filter(a => a.correct).length / recent.length * 100) : null,
    byTopic,
  };
}
