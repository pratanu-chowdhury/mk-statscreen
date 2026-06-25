// Logistic regression for StatScreen.
//
// Two ways to get weights:
//   1. learn() — fit from past hires with IRLS + ridge (Newton's method on the
//      penalized log-likelihood). Operates on standardized features.
//   2. manual weights — the caller supplies a weight per predictor and a bias;
//      we still standardize so the numbers stay comparable across predictors.
//
// Everything works on standardized features z = (x - mean) / std, so a weight's
// magnitude is directly an "importance". Standardization stats come from
// whatever data exists (training rows, else the candidate pool).

export function sigmoid(z) {
  if (z >= 0) return 1 / (1 + Math.exp(-z));
  const e = Math.exp(z);
  return e / (1 + e);
}

// Column-wise mean / std (population std, guarded against 0).
export function standardizer(rows) {
  const n = rows.length;
  const k = n ? rows[0].length : 0;
  const mean = new Array(k).fill(0);
  const std = new Array(k).fill(1);
  if (!n) return { mean, std };
  for (let j = 0; j < k; j++) {
    let m = 0;
    for (let i = 0; i < n; i++) m += rows[i][j];
    m /= n;
    let v = 0;
    for (let i = 0; i < n; i++) v += (rows[i][j] - m) ** 2;
    v = Math.sqrt(v / n);
    mean[j] = m;
    std[j] = v < 1e-9 ? 1 : v;
  }
  return { mean, std };
}

export function standardizeRow(x, stats) {
  return x.map((v, j) => (v - stats.mean[j]) / stats.std[j]);
}

// Solve A b = y for b (Gaussian elimination with partial pivoting).
function solve(A, y) {
  const n = A.length;
  const M = A.map((row, i) => [...row, y[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const piv = M[c][c] || 1e-9;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / piv;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / (row[i] || 1e-9));
}

// Fit logistic regression. X = array of raw feature rows, y = 0/1 labels.
// Returns { beta, bias, stats, names } where contributions use standardized z.
export function learn(X, y, { lambda = 1.0, iters = 25 } = {}) {
  const stats = standardizer(X);
  const Z = X.map((x) => standardizeRow(x, stats));
  const n = Z.length;
  const k = n ? Z[0].length : 0;
  // Design matrix with intercept column first.
  const D = Z.map((z) => [1, ...z]);
  const p = k + 1;
  let beta = new Array(p).fill(0);

  for (let it = 0; it < iters; it++) {
    // Build penalized normal equations: (D' W D + Λ) β = D' W zAdj
    const A = Array.from({ length: p }, () => new Array(p).fill(0));
    const rhs = new Array(p).fill(0);
    for (let i = 0; i < n; i++) {
      const eta = D[i].reduce((s, v, j) => s + v * beta[j], 0);
      const mu = sigmoid(eta);
      const w = Math.max(mu * (1 - mu), 1e-6);
      const z = eta + (y[i] - mu) / w; // working response
      for (let a = 0; a < p; a++) {
        rhs[a] += D[i][a] * w * z;
        for (let b = 0; b < p; b++) A[a][b] += D[i][a] * w * D[i][b];
      }
    }
    for (let a = 1; a < p; a++) A[a][a] += lambda; // ridge, intercept unpenalized
    const next = solve(A, rhs);
    let delta = 0;
    for (let a = 0; a < p; a++) delta += Math.abs(next[a] - beta[a]);
    beta = next;
    if (delta < 1e-7) break;
  }

  return { bias: beta[0], beta: beta.slice(1), stats };
}

// Score one raw feature vector. Returns probability + per-predictor contribution.
export function score(model, x) {
  const z = standardizeRow(x, model.stats);
  const contributions = model.beta.map((b, j) => b * z[j]);
  const eta = model.bias + contributions.reduce((s, v) => s + v, 0);
  return { prob: sigmoid(eta), eta, contributions, z };
}

// Simple training-set metrics for the "Model" panel.
export function metrics(model, X, y, threshold = 0.5) {
  if (!X.length) return { acc: null, auc: null, n: 0 };
  const probs = X.map((x) => score(model, x).prob);
  let correct = 0;
  for (let i = 0; i < X.length; i++) if ((probs[i] >= threshold ? 1 : 0) === y[i]) correct++;
  // AUC via rank statistic (Mann–Whitney).
  const pos = [], neg = [];
  probs.forEach((p, i) => (y[i] ? pos : neg).push(p));
  let auc = null;
  if (pos.length && neg.length) {
    let wins = 0;
    for (const a of pos) for (const b of neg) wins += a > b ? 1 : a === b ? 0.5 : 0;
    auc = wins / (pos.length * neg.length);
  }
  return { acc: correct / X.length, auc, n: X.length };
}
