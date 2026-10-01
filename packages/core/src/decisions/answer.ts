export interface AnswerMeta {
  provider: string;
  model: string | null;
  calibrated: boolean;
  latencyMs: number;
  cached: boolean;
}

export type Answer =
  | {
      kind: "choice";
      value: string;
      probabilities: Record<string, number>;
      confidence: number;
      meta: AnswerMeta;
    }
  | {
      kind: "score";
      expected: number;
      probabilities: Record<number, number>;
      confidence: number;
      meta: AnswerMeta;
    }
  | { kind: "noul"; p: number; meta: AnswerMeta };

export type Answers = Record<string, Answer>;
export type ChoiceAnswer = Extract<Answer, { kind: "choice" }>;
export type ScoreAnswer = Extract<Answer, { kind: "score" }>;
export type NoulAnswer = Extract<Answer, { kind: "noul" }>;

export function choiceAnswer(answers: Answers, id: string): ChoiceAnswer | undefined {
  const a = answers[id];
  return a?.kind === "choice" ? a : undefined;
}

export function scoreAnswer(answers: Answers, id: string): ScoreAnswer | undefined {
  const a = answers[id];
  return a?.kind === "score" ? a : undefined;
}

export function noulAnswer(answers: Answers, id: string): NoulAnswer | undefined {
  const a = answers[id];
  return a?.kind === "noul" ? a : undefined;
}
