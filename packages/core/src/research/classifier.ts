// A small softmax (multinomial logistic) regression in plain TypeScript
// (docs/backlog.md#autoresearch, #distilled-classifier, ADR 0009). Deterministic: zero
// initialisation and full-batch gradient descent, so the same data always gives the same model.

export interface SoftmaxModel {
  labels: string[];
  /** weights[k][j]: label k, feature j. */
  weights: number[][];
  bias: number[];
}

export interface TrainOptions {
  /** Gradient steps over the full batch (default 300). */
  epochs?: number;
  /** Learning rate (default 0.5). */
  learningRate?: number;
  /** L2 penalty on weights (default 0.001). */
  l2?: number;
  /** Per-example weights, e.g. to down-weight uncertain labels (default 1). */
  sampleWeights?: number[];
}

function softmax(z: number[]): number[] {
  const m = Math.max(...z);
  const e = z.map((v) => Math.exp(v - m));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / s);
}

/** Probability per label, in `model.labels` order. */
export function predictProba(model: SoftmaxModel, x: number[]): number[] {
  return softmax(
    model.weights.map((w, k) => {
      let z = model.bias[k] as number;
      for (let j = 0; j < w.length; j++) z += (w[j] as number) * (x[j] ?? 0);
      return z;
    }),
  );
}

export function predictLabel(model: SoftmaxModel, x: number[]): string {
  const p = predictProba(model, x);
  let best = 0;
  for (let k = 1; k < p.length; k++) if ((p[k] as number) > (p[best] as number)) best = k;
  return model.labels[best] as string;
}

/**
 * Trains on rows `x` with string labels `y`. Labels are sorted, so label order does not depend on
 * the order of the data. With a single label the model always predicts it.
 */
export function trainSoftmax(x: number[][], y: string[], opts: TrainOptions = {}): SoftmaxModel {
  if (x.length !== y.length) throw new Error("trainSoftmax: x and y differ in length");
  if (x.length === 0) throw new Error("trainSoftmax: no examples");
  const labels = [...new Set(y)].sort();
  const dims = x[0]?.length ?? 0;
  const K = labels.length;
  const weights = labels.map(() => new Array<number>(dims).fill(0));
  const bias = new Array<number>(K).fill(0);
  const model: SoftmaxModel = { labels, weights, bias };
  if (K === 1) return model;

  const epochs = opts.epochs ?? 300;
  const lr = opts.learningRate ?? 0.5;
  const l2 = opts.l2 ?? 0.001;
  const sw = opts.sampleWeights ?? x.map(() => 1);
  const total = sw.reduce((a, b) => a + b, 0) || 1;
  const target = y.map((l) => labels.indexOf(l));

  for (let e = 0; e < epochs; e++) {
    const gw = labels.map(() => new Array<number>(dims).fill(0));
    const gb = new Array<number>(K).fill(0);
    for (let i = 0; i < x.length; i++) {
      const xi = x[i] as number[];
      const p = predictProba(model, xi);
      const wi = (sw[i] as number) / total;
      for (let k = 0; k < K; k++) {
        const d = ((p[k] as number) - (k === target[i] ? 1 : 0)) * wi;
        if (d === 0) continue;
        gb[k] = (gb[k] as number) + d;
        const row = gw[k] as number[];
        for (let j = 0; j < dims; j++) {
          const v = xi[j] as number;
          if (v !== 0) row[j] = (row[j] as number) + d * v;
        }
      }
    }
    for (let k = 0; k < K; k++) {
      const w = weights[k] as number[];
      const g = gw[k] as number[];
      for (let j = 0; j < dims; j++)
        w[j] = (w[j] as number) - lr * ((g[j] as number) + l2 * (w[j] as number));
      bias[k] = (bias[k] as number) - lr * (gb[k] as number);
    }
  }
  return model;
}

/** Share of rows whose predicted label matches. 0 for no rows. */
export function accuracy(model: SoftmaxModel, x: number[][], y: string[]): number {
  if (x.length === 0) return 0;
  let ok = 0;
  x.forEach((xi, i) => {
    if (predictLabel(model, xi) === y[i]) ok++;
  });
  return ok / x.length;
}
