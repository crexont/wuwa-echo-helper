// math.js — 명조 툴즈 v5.0: 정확 열거 방식 확률 계산
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

// ───────── 손익분기 (튜너 아끼기) ─────────
// 5성 에코: 레벨 5·10·15·20·25에서 부옵션 칸이 하나씩 열리고, 칸마다 튜너 10개가 든다 (게임 데이터 PhantomQuality).
// 칸을 열기 전에 올려야 하는 경험치는 PhantomLevel 5성 그룹. 재료로 쓰면 튜너 30%, 경험치 75%를 돌려받는다.
export const ECHO_COST = {
  tunerPerSlot: 10,
  tunerRefund: 0.3,
  expPerSlot: [4400, 12100, 23100, 39500, 63500],
  expRefund: 0.75,
};
const SLOTS_TOTAL = 5;
// 버리면 칸당 70%만 잃는다. 완성품은 환급을 못 받으므로 완성 시점에 그 30%(칸 5개분)를 비용으로 더한다.
const SLOT_NET = ECHO_COST.tunerPerSlot * (1 - ECHO_COST.tunerRefund);
const SUCCESS_EXTRA = ECHO_COST.tunerPerSlot * ECHO_COST.tunerRefund * SLOTS_TOTAL;

// 같은 종류·같은 유효 확률인 옵션은 서로 바꿔도 결과가 같으므로 묶어서 센다 → 상태 수가 크게 줄어든다
function groupPool(pool) {
  const map = new Map();
  for (const it of pool) {
    const key = `${it.kind}|${it.p}`;
    const g = map.get(key);
    if (g) g.count++; else map.set(key, { kind: it.kind, p: it.p, count: 1 });
  }
  return [...map.values()];
}

// λ = 완성품 1개의 가치(튜너). W = 지금 상태에서 "더 강화할 수 있는 권리"의 가치. 버리면 0.
function makeSolver(goal, groups, lambda) {
  const memo = new Map();
  function W(counts, state, left) {
    if (left === 0) return isGoalSatisfied(state, goal) ? lambda - SUCCESS_EXTRA : 0;
    const key = `${counts.join(',')}|${state.join(',')}|${left}`;
    let v = memo.get(key);
    if (v === undefined) { v = Math.max(0, cont(counts, state, left)); memo.set(key, v); }
    return v;
  }
  // 다음 칸을 열었을 때의 기대 손익 (튜너): 이번 칸 비용 + 다음 상태의 가치
  function cont(counts, state, left) {
    const total = counts.reduce((a, b) => a + b, 0);
    let ev = 0;
    groups.forEach((g, i) => {
      if (!counts[i]) return;
      const next = counts.slice(); next[i]--;
      const hit = g.p > 0 ? W(next, applyHit(state, g.kind, goal.type, goal.req), left - 1) : 0;
      const miss = g.p < 1 ? W(next, state, left - 1) : 0;
      ev += (counts[i] / total) * (g.p * hit + (1 - g.p) * miss);
    });
    return -SLOT_NET + ev;
  }
  return { W, cont };
}

/**
 * 완성 1개당 기대 튜너 (새 에코를 처음부터 최적으로 판단하며 강화할 때). 완성 불가능하면 Infinity.
 * @param fullPool 13종 전체 [{ key, kind, p }]
 */
export function breakEvenTuners(goal, fullPool) {
  const groups = groupPool(fullPool);
  const counts = groups.map((g) => g.count);
  const start = (lambda) => makeSolver(goal, groups, lambda).cont(counts, [0, 0, 0], SLOTS_TOTAL);
  let hi = 1000;
  while (start(hi) <= 0) { hi *= 4; if (hi > 1e9) return Infinity; }
  let lo = 0;
  for (let it = 0; it < 40; it++) {
    const mid = (lo + hi) / 2;
    if (start(mid) > 0) hi = mid; else lo = mid;
  }
  return hi;
}

/**
 * 지금 상태에서 다음 칸을 열 때의 기대 손익 (튜너). 0보다 크면 계속하는 게 이득 → GO.
 * @param pool 남은 풀 [{ key, kind, p }], picks 남은 칸 수, base 지금 상태 [c1, c2, n], lambda breakEvenTuners 결과
 */
export function continueValue(goal, pool, picks, base, lambda) {
  if (picks <= 0 || !Number.isFinite(lambda)) return -Infinity;
  const groups = groupPool(pool);
  return makeSolver(goal, groups, lambda).cont(groups.map((g) => g.count), base, picks);
}

// 지금 버리면 잃는 양 (환급 후): 열린 칸 수 기준
export function discardLoss(openedCount) {
  const n = Math.max(0, Math.min(SLOTS_TOTAL, openedCount));
  const exp = ECHO_COST.expPerSlot.slice(0, n).reduce((a, b) => a + b, 0);
  return { tuners: n * SLOT_NET, exp: Math.round(exp * (1 - ECHO_COST.expRefund)) };
}
