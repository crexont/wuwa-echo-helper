// js/math.js
export function combinations(n, r) {
  n = Math.floor(n); r = Math.floor(r);
  if (r < 0 || r > n || n < 0) return 0;
  if (r === 0 || r === n) return 1;
  if (r > n / 2) r = n - r;
  let c = 1;
  for (let i = 1; i <= r; i++) c = (c * (n - (r - i))) / i;
  return c;
}

export function calcSuccessProb(N, K, n, m) {
  if (n <= 0 || N <= 0 || m > n || m > K) return 0;
  let totalProb = 0;
  const totalComb = combinations(N, n);
  for (let k = m; k <= Math.min(n, K); k++) totalProb += (combinations(K, k) * combinations(N - K, n - k)) / totalComb;
  return totalProb;
}

export function calcExactCritProb(poolLeft, neededCrit, subPoolLeft, neededSub, remainingSlots) {
  if (remainingSlots <= 0 || poolLeft <= 0 || neededCrit > remainingSlots) return 0;
  const totalComb = combinations(poolLeft, remainingSlots);
  let successComb = 0;
  const junkPool = Math.max(0, poolLeft - neededCrit - subPoolLeft);
  for (let s = neededSub; s <= Math.min(remainingSlots - neededCrit, subPoolLeft); s++) {
    const r = remainingSlots - neededCrit - s;
    if (r >= 0 && r <= junkPool) successComb += combinations(neededCrit, neededCrit) * combinations(subPoolLeft, s) * combinations(junkPool, r);
  }
  return successComb / totalComb;
}