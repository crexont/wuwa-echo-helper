// data.js — 스탯 DB, 단계별 출현 확률, 목표 프리셋, OCR 결과 매칭 헬퍼

// ───────── 단계별 출현 확률 (index.html 확률표와 동일, 합계로 정규화해서 사용) ─────────
const CRIT_PROBS     = [23.33, 23.33, 23.33, 8, 8, 8, 3, 3];
const NORMAL_PROBS   = [6.80, 7.77, 20.39, 24.27, 17.48, 14.56, 5.83, 2.91];
const ATK_FLAT_PROBS = [6.80, 52.43, 37.86, 2.91];
const DEF_FLAT_PROBS = [14.56, 44.66, 32.04, 8.74];

const norm = (arr) => {
  const sum = arr.reduce((a, b) => a + b, 0);
  return arr.map((v) => v / sum);
};

// icon: icons/<이름>.png (게임 UI 아이콘)
export const STAT_DATABASE = {
  "크피":  { name: "크리티컬 피해",   icon: "crit-dmg", label: "크리티컬피해", isPercent: true,  matchRegex: /크.*피|피해|크리|티컬/,               notRegex: /일반|강공|스킬|해방/,   values: [12.6, 13.8, 15.0, 16.2, 17.4, 18.6, 19.8, 21.0], probs: norm(CRIT_PROBS) },
  "크확":  { name: "크리티컬 확률",   icon: "crit-rate", label: "크리티컬", isPercent: true,  matchRegex: /크리|리티|티컬|크.*확|확률/,               notRegex: /피해/,                      values: [6.3, 6.9, 7.5, 8.1, 8.7, 9.3, 9.9, 10.5],        probs: norm(CRIT_PROBS) },
  "공효":  { name: "공명 효율",       icon: "energy", label: "공명효율", isPercent: true,  matchRegex: /효율|요율|공효/,           notRegex: /스킬|해방|피해/,                        values: [6.8, 7.6, 8.4, 9.2, 10.0, 10.8, 11.6, 12.4],     probs: norm(NORMAL_PROBS) },
  "일공피": { name: "일반 공격 피해",  icon: "basic", label: "일반공격피해", isPercent: true,  matchRegex: /일반/,                      notRegex: null,                        values: [6.4, 7.1, 7.9, 8.6, 9.4, 10.1, 10.9, 11.6],      probs: norm(NORMAL_PROBS) },
  "강공피": { name: "강공격 피해",     icon: "heavy", label: "강공격피해", isPercent: true,  matchRegex: /강공/,                      notRegex: null,                        values: [6.4, 7.1, 7.9, 8.6, 9.4, 10.1, 10.9, 11.6],      probs: norm(NORMAL_PROBS) },
  "스킬피": { name: "공명 스킬 피해",  icon: "skill", label: "공명스킬피해", isPercent: true,  matchRegex: /스킬/,                      notRegex: null,                        values: [6.4, 7.1, 7.9, 8.6, 9.4, 10.1, 10.9, 11.6],      probs: norm(NORMAL_PROBS) },
  "해방피": { name: "공명 해방 피해",  icon: "liberation", label: "공명해방피해", isPercent: true,  matchRegex: /해방|공명해방/,             notRegex: null,                        values: [6.4, 7.1, 7.9, 8.6, 9.4, 10.1, 10.9, 11.6],      probs: norm(NORMAL_PROBS) },
  "공%":   { name: "공격력%",         icon: "atk", label: "공격력", isPercent: true,  matchRegex: /공격|공력|공극|0격/,        notRegex: /일반|강공/,                 values: [6.4, 7.1, 7.9, 8.6, 9.4, 10.1, 10.9, 11.6],      probs: norm(NORMAL_PROBS) },
  "체%":   { name: "HP%",             icon: "hp", label: "HP", isPercent: true,  matchRegex: /HP|생명|체력/,              notRegex: null,                        values: [6.4, 7.1, 7.9, 8.6, 9.4, 10.1, 10.9, 11.6],      probs: norm(NORMAL_PROBS) },
  "방%":   { name: "방어력%",         icon: "def", label: "방어력", isPercent: true,  matchRegex: /방어|방력/,                 notRegex: null,                        values: [8.1, 9.0, 10.0, 10.9, 11.8, 12.8, 13.8, 14.7],   probs: norm(NORMAL_PROBS) },
  "깡공":  { name: "공격력 (고정)",   icon: "atk", label: "공격력", isPercent: false, matchRegex: /공격|공력|공극|0격/,        notRegex: /일반|강공/,                 values: [30, 40, 50, 60],                                 probs: norm(ATK_FLAT_PROBS) },
  "깡체":  { name: "HP (고정)",       icon: "hp", label: "HP", isPercent: false, matchRegex: /HP|생명|체력/,              notRegex: null,                        values: [320, 360, 390, 430, 470, 510, 540, 580],         probs: norm(NORMAL_PROBS) },
  "깡방":  { name: "방어력 (고정)",   icon: "def", label: "방어력", isPercent: false, matchRegex: /방어|방력/,                 notRegex: null,                        values: [40, 50, 60, 70],                                 probs: norm(DEF_FLAT_PROBS) },
};

export const DEFAULT_TARGETS = ["크확", "크피", "공%", "공효"];

export const GOAL_PRESETS = [
  { id: 'crit_0', title: '쌍크 (크크)',   type: 'crit', req: 0 },
  { id: 'crit_1', title: '크크 + 1유효',  type: 'crit', req: 1 },
  { id: 'crit_2', title: '크크 + 2유효',  type: 'crit', req: 2 },
  { id: 'crit_3', title: '크크 + 3유효',  type: 'crit', req: 3 },
  { id: 'free_2', title: '서포터 2유효',  type: 'free', req: 2 },
  { id: 'free_3', title: '서포터 3유효',  type: 'free', req: 3 },
];

export const CUT_SCORE = { low: 1, mid: 2, high: 3 };

// OCR 수치가 가장 가까운 단계 값에서 이 비율 이상 벗어나면 오인식(쓰레기 값)으로 본다
const MAX_REL_ERROR = 0.12;

// 아직 열리지 않은 줄("+20까지 강화 및 부옵션 속성 활성화")은 옵션이 아니다
const LOCKED_ROW = /강화|활성|속성|까지/;
export const isLockedRow = (nameStr) => LOCKED_ROW.test(nameStr);

// 옵션명 퍼지 매칭: 글자가 1~2개 틀려도(공명 요율, 공격력CC …) 게임 표기와 얼마나 닮았는지로 판단
const NAME_SIM_MIN = 0.55;      // 이 이상 닮아야 후보
const REGEX_SIM = 0.75;         // 정규식에 걸리면 최소 이 정도로 닮은 것으로 본다
function lcsLength(a, b) {
  const dp = Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let prev = 0;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev + 1 : Math.max(dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[b.length];
}
export function nameSimilarity(text, label) {
  const a = text.toUpperCase(), b = label.toUpperCase();
  if (!a.length || !b.length) return 0;
  return (2 * lcsLength(a, b)) / (a.length + b.length);
}

// ───────── 단계/등급 ─────────
export function evaluateStepTier(step, totalSteps) {
  if (totalSteps === 8) {
    if (step >= 7) return { label: '상옵', class: 'tier-high', score: 3 };
    if (step >= 4) return { label: '중옵', class: 'tier-mid',  score: 2 };
    return { label: '하옵', class: 'tier-low', score: 1 };
  }
  if (step === 4) return { label: '상옵', class: 'tier-high', score: 3 };
  if (step >= 2)  return { label: '중옵', class: 'tier-mid',  score: 2 };
  return { label: '하옵', class: 'tier-low', score: 1 };
}

// 컷오프(cutScore) 이상 단계가 나올 확률 — 스탯별 실제 확률표 기반
export function tierPassProb(key, cutScore) {
  const { values, probs } = STAT_DATABASE[key];
  return probs.reduce(
    (sum, p, i) => sum + (evaluateStepTier(i + 1, values.length).score >= cutScore ? p : 0),
    0
  );
}

export function nearestStep(val, values) {
  let idx = 0, min = Math.abs(val - values[0]);
  for (let i = 1; i < values.length; i++) {
    const d = Math.abs(val - values[i]);
    if (d < min) { min = d; idx = i; }
  }
  return { step: idx + 1, exactVal: values[idx] };
}

export function makeSlot(key, step) {
  const data = STAT_DATABASE[key];
  return {
    key,
    name: data.name,
    val: data.values[step - 1],
    isPercent: data.isPercent,
    step,
    tier: evaluateStepTier(step, data.values.length),
  };
}

// 옵션명 텍스트 + 수치 → 슬롯 객체 (실패 시 null)
// 후보 = 이름이 닮은 스탯(정규식 또는 퍼지) 중 수치가 실제 단계 값 근처인 것.
// 점수 = 이름 유사도 - 수치 오차 × 2 → 이름이 확실히 다르면 이름으로, 비슷하면(크확/크피, 공%/깡공) 수치로 가른다.
// '%' 기호가 보이면 % 계열만 본다.
export function matchStat(nameStr, val, sawPercent) {
  if (LOCKED_ROW.test(nameStr)) return null;
  let best = null;
  for (const [key, data] of Object.entries(STAT_DATABASE)) {
    if (sawPercent && !data.isPercent) continue;
    if (data.notRegex && data.notRegex.test(nameStr)) continue;
    let sim = nameSimilarity(nameStr, data.label);
    if (data.matchRegex.test(nameStr)) sim = Math.max(sim, REGEX_SIM);
    if (sim < NAME_SIM_MIN) continue;
    const { step, exactVal } = nearestStep(val, data.values);
    const err = Math.abs(val - exactVal) / exactVal;
    if (err > MAX_REL_ERROR) continue;
    const score = sim - err * 2;
    if (!best || score > best.score + 1e-9) best = { key, step, score };
  }
  return best ? makeSlot(best.key, best.step) : null;
}
