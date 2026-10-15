// math.js — 명조 에코파고 v3.0: 정확 열거 방식 확률 계산
//
// 모델: 에코 부옵션은 13개 풀에서 비복원으로 5개가 열린다.
// 이미 열린 슬롯의 옵션은 (유효 여부와 무관하게) 풀에서 빠지고,
// 남은 칸은 남은 풀에서 균등하게 뽑히며, 뽑힌 옵션마다 단계(등급)가 독립적으로 굴려진다.
// → 남은 풀의 모든 부분집합을 열거하고, 각 부분집합마다 DP로 "유효 판정 + 목표 달성" 확률을 구해 평균낸다.
// (13C5 = 1287가지가 최대라 실시간 계산으로 충분히 빠르다.)

export function combinations(n, r) {
  n = Math.floor(n); r = Math.floor(r);
  if (r < 0 || r > n || n < 0) return 0;
  if (r === 0 || r === n) return 1;
  if (r > n / 2) r = n - r;
  let c = 1;
  for (let i = 1; i <= r; i++) c = (c * (n - (r - i))) / i;
  return c;
}

// arr에서 k개를 고르는 모든 조합
export function* choose(arr, k) {
  const n = arr.length;
  if (k < 0 || k > n) return;
  const idx = Array.from({ length: k }, (_, i) => i);
  while (true) {
    yield idx.map((i) => arr[i]);
    let i = k - 1;
    while (i >= 0 && idx[i] === n - k + i) i--;
    if (i < 0) return;
    idx[i]++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
  }
}

// 상태 = [크확 유효 여부, 크피 유효 여부, 기타 유효 개수(목표 req로 상한)]
// free 목표는 크확/크피도 "기타"와 똑같이 개수로만 센다.
function applyHit(state, kind, goalType, cap) {
  let [c1, c2, n] = state;
  if (goalType === 'crit' && kind === 'critRate') c1 = 1;
  else if (goalType === 'crit' && kind === 'critDmg') c2 = 1;
  else n = Math.min(n + 1, cap);
  return [c1, c2, n];
}

export function isGoalSatisfied(state, goal) {
  const [c1, c2, n] = state;
  return goal.type === 'crit' ? Boolean(c1 && c2 && n >= goal.req) : n >= goal.req;
}

function subsetProb(subset, goal, base) {
  let dist = new Map([[base.join('|'), { s: base, q: 1 }]]);
  for (const item of subset) {
    const next = new Map();
    const add = (s, q) => {
      if (q === 0) return;
      const k = s.join('|');
      const e = next.get(k);
      if (e) e.q += q; else next.set(k, { s, q });
    };
    for (const { s, q } of dist.values()) {
      add(s, q * (1 - item.p));
      add(applyHit(s, item.kind, goal.type, goal.req), q * item.p);
    }
    dist = next;
  }
  let total = 0;
  for (const { s, q } of dist.values()) if (isGoalSatisfied(s, goal)) total += q;
  return total;
}

/**
 * @param goal  { type: 'crit'|'free', req: number }
 * @param pool  남은 풀 [{ key, kind: 'critRate'|'critDmg'|'other', p }]  (p = 뽑혔을 때 유효일 확률, 비유효 옵션은 0)
 * @param picks 앞으로 열릴 슬롯 수
 * @param base  이미 열린 슬롯으로 만들어진 상태 [c1, c2, n]
 */
export function goalSuccessProb(goal, pool, picks, base) {
  let sum = 0, count = 0;
  for (const subset of choose(pool, picks)) {
    sum += subsetProb(subset, goal, base);
    count++;
  }
  return count ? sum / count : 0;
}
