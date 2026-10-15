// app.js — 명조 에코파고 v2.0
import {
  STAT_DATABASE, DEFAULT_TARGETS, GOAL_PRESETS, CUT_SCORE,
  evaluateStepTier, tierPassProb, nearestStep, makeSlot, matchStat, isLockedRow, nameSimilarity,
} from './data.js';
import { goalSuccessProb, isGoalSatisfied } from './math.js';

// ───────── 상수 ─────────
const SLOT_COUNT = 5;
const SPLIT_X = 0.65;          // 슬롯 폭 중 옵션명 / 수치 경계
const OCR_INTERVAL_MS = 80;
const PIXEL_CHANGE = 40;       // 지문 픽셀 밝기가 이만큼 이상 바뀌어야 "바뀐 픽셀"
const ROW_CHANGE = 0.06;       // 줄의 6% 이상 픽셀이 바뀌어야 "화면이 바뀐 줄" (배경 파티클 정도는 무시)
const SETTLE_MAX_MS = 600;
const DIM_RATIO = 0.75;        // 옵션창 전체 밝기가 평소의 75% 아래로 떨어지면 "강화 연출로 어두워진 상태"
const DIM_MAX_MS = 2500;       // 이 시간보다 오래 어두우면 연출이 아니라 원래 화면이 바뀐 것으로 본다     // 줄이 계속 움직여도(반짝임 등) 이 시간이 지나면 그냥 읽는다
const TARGET_SLOT_PX = 90;     // 전처리 후 슬롯 높이 목표(px)
const MIN_BOX = 0.04;
const VIEW_PAD = 1.8;          // 확대 보기: 큰 화면에 보이는 영역 = 인식 박스의 1.8배
const MIN_VIEW = 0.2;          // 확대 보기가 화면 대비 이 비율보다 작아지지 않게
const STORAGE_KEY = 'echopago.settings.v1';
const DEFAULT_BOX = { x: 0.129, y: 0.312, w: 0.218, h: 0.198 };   // 옵션 5줄만 딱 맞게 (왼쪽 아이콘 열 제외)
const DEBUG = new URLSearchParams(location.search).has('debug');   // ?debug 로 열면 OCR 원문을 콘솔에 출력
// 모바일 브라우저 등 화면 공유(getDisplayMedia)를 못 쓰는 환경 → 직접 입력 모드
let CAN_SHARE = typeof navigator.mediaDevices?.getDisplayMedia === 'function';

// ───────── 상태 ─────────
let currentStream = null;
let nameWorker = null, valueWorker = null;
let ocrReady = false;
let isOcrBusy = false;
let loopToken = 0;
let lastOcrTime = 0;
let lockedSlots = Array(SLOT_COUNT).fill(null);
let pinned = Array(SLOT_COUNT).fill(false);                       // 수동 수정한 슬롯은 OCR이 덮어쓰지 않음
let lastRenderSig = '';
let readSig = Array(SLOT_COUNT).fill(null);     // 줄별: 마지막으로 OCR한 순간의 화면 지문
let prevSig = Array(SLOT_COUNT).fill(null);     // 줄별: 직전 사이클의 화면 지문 (애니메이션이 멈췄는지 판단)
let prevSig2 = Array(SLOT_COUNT).fill(null);    // 줄별: 두 사이클 전 화면 지문 (천천히 나타나는 연출도 멈춘 뒤에 읽도록)
let changedAt = Array(SLOT_COUNT).fill(0);      // 줄별: 변화가 처음 감지된 시각
let pending = Array(SLOT_COUNT).fill(null);
let stableLum = 0;             // 평소 옵션창 밝기 (어두워짐 감지 기준)
let dimSince = 0;              // 어두워지기 시작한 시각     // 줄별: 확정값과 다른 결과가 한 번 나왔을 때 그 결과 (한 번 더 나오면 교체)
let box = { ...DEFAULT_BOX };
let viewMode = 'zoom';                                           // 'zoom' = 옵션 주변만 확대 / 'full' = 전체 화면
let adjusting = false;                                           // true = 영역 조정 중(드래그 가능) / false = 캡처 화면(OCR이 보는 그대로)
let view = { x: 0, y: 0, w: 1, h: 1 };                          // 큰 화면에 실제로 보이는 영역 (영상 비율 좌표)
let editingIndex = -1;

// ───────── DOM ─────────
const $ = (id) => document.getElementById(id);
const startShareBtn = $('startShareBtn');
const startBtnHTML = startShareBtn.innerHTML;
const resetScanBtn = $('resetScanBtn');
const ocrStatus = $('ocrStatus');
const filterContainer = $('filterContainer');
const minTierCutSelect = $('minTierCut');
const goThresholdInput = $('goThreshold');
const frameCanvas = $('frameCanvas');
const frameWrapper = $('frameWrapper');
const framePlaceholder = $('framePlaceholder');
const resetRegionBtn = $('resetRegionBtn');
const viewToggleBtn = $('viewToggleBtn');
const adjustToggleBtn = $('adjustToggleBtn');
const regionHint = $('regionHint');
const gameVideo = $('gameVideo');
const statList = $('statList');
const dashboardList = $('dashboardList');
const stableBufferText = $('stableBufferText');
const editModal = $('editModal');
const editModalTitle = $('editModalTitle');
const editStatKey = $('editStatKey');
const editStatValue = $('editStatValue');
const modalCancelBtn = $('modalCancelBtn');
const modalClearBtn = $('modalClearBtn');
const modalSaveBtn = $('modalSaveBtn');
const toggleTableBtn = $('toggleTableBtn');
const probTableBox = $('probTableBox');
const tableArrow = $('tableArrow');

const frameCtx = frameCanvas.getContext('2d');
const cropCanvas = document.createElement('canvas');
const cropCtx = cropCanvas.getContext('2d', { willReadFrequently: true });
const ocrSnap = document.createElement('canvas');
const ocrSnapCtx = ocrSnap.getContext('2d', { willReadFrequently: true });
const SIG_ROWS = 8;                // 줄당 지문 높이(px)
const sigCanvas = document.createElement('canvas');
sigCanvas.width = 48; sigCanvas.height = SIG_ROWS * SLOT_COUNT;
const sigCtx = sigCanvas.getContext('2d', { willReadFrequently: true });
sigCtx.imageSmoothingEnabled = true;
sigCtx.imageSmoothingQuality = 'high';   // 축소하면서 작은 파티클은 평균에 묻히게

const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
// 스탯 아이콘: PNG 모양만 따서(mask) 글자색으로 칠한다 → 유효옵은 청록, 나머지는 회색
const statIcon = (key) => `<i class="stat-icon" style="--icon:url('./icons/${STAT_DATABASE[key].icon}.png')" aria-hidden="true"></i>`;

// ───────── 설정 저장/복원 ─────────
function loadSettings() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch { return {}; }
}
function saveSettings() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      targets: getSelectedTargets(),
      cut: minTierCutSelect.value,
      goThreshold: getGoThreshold(),
      box,
      viewMode,
    }));
  } catch { /* 저장 실패는 무시 */ }
}
function sanitizeBox(b) {
  const w = clamp(b.w, MIN_BOX, 1), h = clamp(b.h, MIN_BOX, 1);
  return { x: clamp(b.x, 0, 1 - w), y: clamp(b.y, 0, 1 - h), w, h };
}

function getSelectedTargets() {
  return Array.from(filterContainer.querySelectorAll('input:checked')).map((cb) => cb.value);
}
function getGoThreshold() {
  return clamp(parseFloat(goThresholdInput.value) || 0, 0, 100);
}
function onSettingsChanged() { runEvaluation(); saveSettings(); }

// 화면 공유 없이 직접 입력으로만 쓰는 모드
function enterManualMode() {
  CAN_SHARE = false;
  document.body.classList.add('no-share');
  $('manualNotice').hidden = false;
  if (filterContainer.children.length) runEvaluation();   // 빈 목록 안내 문구 갱신
}

// ───────── UI 초기화 ─────────
function initUI() {
  if (!CAN_SHARE) enterManualMode();
  const saved = loadSettings();
  const savedTargets = Array.isArray(saved.targets) ? saved.targets.filter((k) => k in STAT_DATABASE) : null;
  const targets = savedTargets ?? DEFAULT_TARGETS;
  if (['low', 'mid', 'high'].includes(saved.cut)) minTierCutSelect.value = saved.cut;
  if (Number.isFinite(saved.goThreshold)) goThresholdInput.value = saved.goThreshold;
  const hasBox = Boolean(saved.box) && ['x', 'y', 'w', 'h'].every((k) => Number.isFinite(saved.box[k]));
  if (hasBox) box = sanitizeBox(saved.box);
  else adjusting = true;   // 처음 실행이면 영역부터 맞추도록 조정 화면으로 시작
  if (saved.viewMode === 'full') viewMode = 'full';
  updateView();
  applyModeUI();

  Object.keys(STAT_DATABASE).forEach((key) => {
    const label = document.createElement('label');
    label.className = 'filter-chip';
    label.innerHTML = `<input type="checkbox" value="${key}" ${targets.includes(key) ? 'checked' : ''}> ${statIcon(key)}${STAT_DATABASE[key].name}`;
    label.querySelector('input').addEventListener('change', onSettingsChanged);
    filterContainer.appendChild(label);
  });

  dashboardList.innerHTML = '';
  GOAL_PRESETS.forEach((goal) => {
    const card = document.createElement('div');
    card.className = 'goal-card';
    card.id = `goal-card-${goal.id}`;
    card.innerHTML = `
      <div class="goal-title">${goal.title}</div>
      <div class="goal-main">
        <div class="goal-prob" id="prob-${goal.id}">대기 중</div>
        <div class="goal-bar"><span id="bar-${goal.id}"></span><i class="goal-th"></i></div>
      </div>
      <div class="decision-badge badge-wait" id="badge-${goal.id}">대기</div>`;
    dashboardList.appendChild(card);
  });

  Object.keys(STAT_DATABASE).forEach((key) => {
    const opt = document.createElement('option');
    opt.value = key; opt.textContent = STAT_DATABASE[key].name;
    editStatKey.appendChild(opt);
  });
  editStatKey.addEventListener('change', () => populateValueDropdown(editStatKey.value));
  runEvaluation();
}

// ───────── 확률 평가 / 렌더 ─────────
function slotsSignature() {
  return lockedSlots.map((s, i) => (s ? `${s.key}|${s.val}${pinned[i] ? '*' : ''}` : '-')).join(',');
}

function buildBase(goal, validKeys) {
  const cap = goal.req;
  if (goal.type === 'crit') {
    const others = validKeys.filter((k) => k !== '크확' && k !== '크피').length;
    return [validKeys.includes('크확') ? 1 : 0, validKeys.includes('크피') ? 1 : 0, Math.min(others, cap)];
  }
  return [0, 0, Math.min(validKeys.length, cap)];
}

// prob: 0~1 (막대 길이). 숫자가 없는 상태(대기/달성)는 null
function setGoalResult(id, html, status, prob = null) {
  $(`prob-${id}`).innerHTML = html;
  const badge = $(`badge-${id}`);
  badge.className = `decision-badge badge-${status.toLowerCase()}`;
  badge.innerText = { WAIT: '대기', DONE: '성공', GO: 'GO', STOP: 'STOP' }[status];
  const card = $(`goal-card-${id}`);
  card.className = `goal-card is-${status.toLowerCase()}`;
  const width = status === 'DONE' ? 1 : prob ?? 0;
  $(`bar-${id}`).style.width = `${(clamp(width) * 100).toFixed(1)}%`;
}

function renderStatList(slots, isValid, keyCount, openedCount) {
  statList.innerHTML = '';
  if (openedCount === 0) {
    const msg = currentStream ? '0강 상태 (강화 후 데이터 대기 중)'
      : CAN_SHARE ? '에코 데이터가 없습니다. 화면을 공유하거나 아래에서 직접 추가해주세요.'
      : '아래 [+ 슬롯 1 직접 추가]를 눌러 열린 옵션을 입력해주세요.';
    statList.insertAdjacentHTML('beforeend', `<div class="stat-empty">${msg}</div>`);
  }
  slots.forEach((stat, idx) => {
    const row = document.createElement('div');
    row.className = 'stat-item';
    if (!stat) {
      row.classList.add('stat-item-missing');
      row.innerHTML = `
        <div><span>슬롯 ${idx + 1}</span><span class="stat-warn">인식 실패</span></div>
        <span class="stat-edit-hint">직접 입력</span>`;
    } else {
      const valid = isValid(stat);
      if (valid) row.classList.add('is-valid');
      row.innerHTML = `
        <div class="stat-name">
          ${statIcon(stat.key)}<span>${pinned[idx] ? '📌 ' : ''}${stat.name}</span>
          <span class="stat-val">+${stat.val}${stat.isPercent ? '%' : ''}</span>
          ${valid ? '<span class="valid-mark">유효</span>' : ''}
          ${keyCount[stat.key] > 1 ? '<span class="stat-warn">⚠ 중복</span>' : ''}
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          <span class="tier-badge ${stat.tier.class}">${stat.tier.label}</span>
          <span class="stat-edit-hint">수정</span>
        </div>`;
    }
    row.addEventListener('click', () => openEditModal(idx));
    statList.appendChild(row);
  });
  if (openedCount < SLOT_COUNT) {
    const add = document.createElement('div');
    add.className = 'stat-item stat-item-add';
    add.textContent = `+ 슬롯 ${openedCount + 1} 직접 추가`;
    add.addEventListener('click', () => openEditModal(openedCount));
    statList.appendChild(add);
  }
}

function runEvaluation() {
  const selectedTargets = getSelectedTargets();
  const cutScore = CUT_SCORE[minTierCutSelect.value];
  const goThreshold = getGoThreshold() / 100;
  dashboardList.style.setProperty('--go-th', `${getGoThreshold()}%`);   // 막대 위 GO 기준선

  // 슬롯 위치를 유지한 채로 "열린 칸 수"를 센다 (중간 슬롯 인식 실패가 개수를 줄이지 않도록)
  let lastIdx = -1;
  lockedSlots.forEach((s, i) => { if (s) lastIdx = i; });
  const openedCount = lastIdx + 1;
  const slots = lockedSlots.slice(0, openedCount);

  const gapIdx = slots.map((s, i) => (s ? -1 : i)).filter((i) => i >= 0);
  const keyCount = {};
  slots.forEach((s) => { if (s) keyCount[s.key] = (keyCount[s.key] || 0) + 1; });
  const hasDup = Object.values(keyCount).some((c) => c > 1);
  const isValid = (s) => selectedTargets.includes(s.key) && s.tier.score >= cutScore;

  renderStatList(slots, isValid, keyCount, openedCount);
  stableBufferText.textContent = `${lockedSlots.filter(Boolean).length}/${SLOT_COUNT}`;
  lastRenderSig = slotsSignature();

  let blocked = null;
  if (openedCount === 0) blocked = '강화 전 시뮬레이션 대기 중';
  else if (gapIdx.length) blocked = `슬롯 ${gapIdx.map((i) => i + 1).join(', ')} 인식 실패 — 클릭해서 직접 입력해주세요`;
  else if (hasDup) blocked = '같은 옵션이 중복 인식됐어요 — 수정해주세요';
  if (blocked) {
    GOAL_PRESETS.forEach((g) => setGoalResult(g.id, blocked, 'WAIT'));
    return;
  }

  const validKeys = slots.filter(isValid).map((s) => s.key);
  const opened = new Set(slots.map((s) => s.key));
  const pool = Object.keys(STAT_DATABASE)
    .filter((k) => !opened.has(k))                       // 열린 옵션은 유효 여부와 상관없이 풀에서 제외
    .map((k) => ({
      key: k,
      kind: k === '크확' ? 'critRate' : k === '크피' ? 'critDmg' : 'other',
      p: selectedTargets.includes(k) ? tierPassProb(k, cutScore) : 0,   // 스탯별 실제 확률표 기반
    }));
  const picks = SLOT_COUNT - openedCount;
  const critSelected = selectedTargets.includes('크확') && selectedTargets.includes('크피');

  GOAL_PRESETS.forEach((goal) => {
    if (goal.type === 'crit' && !critSelected) {
      setGoalResult(goal.id, '크확·크피를 유효옵으로 선택해야 계산돼요', 'WAIT');
      return;
    }
    const base = buildBase(goal, validKeys);
    if (isGoalSatisfied(base, goal)) { setGoalResult(goal.id, '<span class="prob-num">달성</span><span class="prob-label">목표 스펙 완성</span>', 'DONE'); return; }
    const prob = goalSuccessProb(goal, pool, picks, base);
    if (prob === 0) { setGoalResult(goal.id, '<span class="prob-num">0%</span><span class="prob-label">수학적 달성 불가</span>', 'STOP', 0); return; }
    setGoalResult(goal.id, `<span class="prob-num">${(prob * 100).toFixed(2)}%</span><span class="prob-label">최종 완성 확률</span>`, prob >= goThreshold ? 'GO' : 'STOP', prob);
  });
}

// ───────── OCR 전처리 (Otsu 적응형 이진화) ─────────
function otsuThreshold(hist, total) {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, bestT = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; bestT = t; }
  }
  return bestT;
}

// 캔버스를 재사용하는 전처리기 (왼쪽/오른쪽을 동시에 처리하려고 인스턴스를 따로 만든다)
function createPreprocessor() {
  const work = document.createElement('canvas');
  const workCtx = work.getContext('2d', { willReadFrequently: true });
  const padded = document.createElement('canvas');
  const paddedCtx = padded.getContext('2d');
  const pad = 12;

  return function preprocess(src, sx, sy, sw, sh) {
    const scale = clamp(TARGET_SLOT_PX / sh, 1.5, 4);
    const w = Math.max(8, Math.round(sw * scale)), h = Math.max(8, Math.round(sh * scale));
    work.width = w; work.height = h;
    workCtx.imageSmoothingEnabled = true;
    workCtx.imageSmoothingQuality = 'high';
    workCtx.drawImage(src, sx, sy, sw, sh, 0, 0, w, h);

    const img = workCtx.getImageData(0, 0, w, h);
    const d = img.data;
    const n = w * h;
    const gray = new Uint8Array(n);
    const hist = new Uint32Array(256);
    for (let i = 0, p = 0; p < n; i += 4, p++) {
      const l = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) | 0;
      gray[p] = l; hist[l]++;
    }
    const t = otsuThreshold(hist, n);
    let bright = 0;
    for (let p = 0; p < n; p++) if (gray[p] > t) bright++;
    const darkBg = bright < n / 2;                     // 배경이 어두우면 밝은 픽셀이 글자
    for (let i = 0, p = 0; p < n; i += 4, p++) {
      const isText = darkBg ? gray[p] > t : gray[p] <= t;
      const v = isText ? 0 : 255;                      // Tesseract용: 흰 배경 + 검은 글자
      d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
    }
    workCtx.putImageData(img, 0, 0);

    padded.width = w + pad * 2; padded.height = h + pad * 2;
    paddedCtx.fillStyle = '#FFFFFF';
    paddedCtx.fillRect(0, 0, padded.width, padded.height);
    paddedCtx.drawImage(work, pad, pad);
    return padded;
  };
}
const preLeft = createPreprocessor();
const preRight = createPreprocessor();

// ───────── OCR 엔진 (옵션명용 / 수치용 워커 분리) ─────────
async function initOcr() {
  if (nameWorker && valueWorker) return;
  [nameWorker, valueWorker] = await Promise.all([
    Tesseract.createWorker('kor+eng'),
    Tesseract.createWorker('eng'),
  ]);
  await Promise.all([
    nameWorker.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.SINGLE_LINE }),
    valueWorker.setParameters({
      tessedit_pageseg_mode: Tesseract.PSM.SINGLE_LINE,
      tessedit_char_whitelist: '0123456789.,%',
    }),
  ]);
}

function parseSlot(nameText, valText, slotNo) {
  const nameStr = nameText.replace(/[^가-힣a-zA-Z]/g, '');
  const valStr = valText.replace(/\s+/g, '').replace(/,/g, '.');
  const m = valStr.match(/(\d+)(?:\.(\d))?/);             // 소수 첫째 자리까지만 사용 ('%'가 '96'처럼 붙어 읽히는 경우 대비)
  if (DEBUG) console.log(`[슬롯 ${slotNo}] 옵션명: "${nameText.trim()}" → ${nameStr} / 수치: "${valText.trim()}"`);
  if (isLockedRow(nameStr)) return { kind: 'empty', nameStr };      // 아직 안 열린 줄 (확실히 비어 있음)
  if (!m || nameStr.length < 1) return { kind: 'garbage', nameStr };
  const val = parseFloat(`${m[1]}.${m[2] ?? 0}`);
  const sawPercent = valStr.includes('%');
  const slot = matchStat(nameStr, val, sawPercent);
  return slot ? { kind: 'stat', slot, nameStr, rawVal: val, sawPercent } : { kind: 'garbage', nameStr };
}

// ───────── 글자 그림 기억 (OCR 생략용) ─────────
// 옵션명은 10여 종, 수치도 단계값 몇십 종뿐이고, 같은 글자는 화면에 늘 똑같은 모양으로 그려진다.
// 한 번 OCR로 확실히 읽은 글자는 "글자 모양 지문"으로 기억해두고, 같은 모양이 다시 나오면 OCR(줄당 약 1초) 없이 바로 쓴다.
const FP_SIZE_TOL = 4;               // 글자 영역 가로·세로 크기 차이 허용(px) — 파티클이 글자에 붙으면 몇 px 커질 수 있음
const FP_SHIFT = 3;                  // 비교할 때 맞춰보는 최대 어긋남(px)
const FP_SPECK_NAME = 0.18;          // 옵션명: 칸 높이의 18%보다 작은 덩어리는 파티클로 보고 지움
const FP_SPECK_VALUE = 0.18;         // 수치도 같은 기준으로 점을 지우되, 소수점 자리의 점은 되살린다 (keepDots)
const FP_CLEAN_READ = 0.85;          // OCR이 옵션명을 이 정도로 정확히 읽었으면 한 번에 확정
const LOCKED_WIDTH = 0.85;           // 옵션명 칸을 85% 넘게 채우며 오른쪽 끝까지 이어지는 글자 = "+20까지 강화 및…" 안내 줄
const BLANK_SKIP_MAX = 3;            // 글자가 안 보이는 줄은 이 횟수까지는 OCR 없이 넘김 (그 뒤엔 확인차 OCR)

// 원본 화면(확대 전)의 칸 → 지문. 글자가 없으면 null
// 확대하면 줄마다 픽셀 위상이 달라져 모양이 미묘하게 바뀌므로, 게임이 그린 원래 픽셀 그대로 비교한다.
// 1) 흑백 + 자동 임계값으로 글자만 남김  2) 작은 점(파티클)은 덩어리 단위로 지움  3) 글자 영역만 잘라서 저장
function textFingerprint(srcCtx, sx, sy, sw, sh, speck, keepDots = false) {
  const w = sw, h = sh, n = w * h;
  const d = srcCtx.getImageData(sx, sy, sw, sh).data;
  const gray = new Uint8Array(n), hist = new Uint32Array(256);
  for (let p = 0; p < n; p++) { const l = (0.299 * d[p * 4] + 0.587 * d[p * 4 + 1] + 0.114 * d[p * 4 + 2]) | 0; gray[p] = l; hist[l]++; }
  const t = otsuThreshold(hist, n);
  let bright = 0;
  for (let p = 0; p < n; p++) if (gray[p] > t) bright++;
  const darkBg = bright < n / 2;
  const on = new Uint8Array(n);
  for (let p = 0; p < n; p++) on[p] = (darkBg ? gray[p] > t : gray[p] <= t) ? 1 : 0;

  // 연결 요소로 작은 점 제거
  const label = new Int32Array(n).fill(-1), small = [], comps = [], stack = [];
  const minSize = h * speck;
  for (let p = 0; p < n; p++) {
    if (!on[p] || label[p] !== -1) continue;
    const id = small.length;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    label[p] = id; stack.push(p);
    while (stack.length) {
      const q = stack.pop(), x = q % w, y = (q - x) / w;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && on[q - 1] && label[q - 1] === -1) { label[q - 1] = id; stack.push(q - 1); }
      if (x < w - 1 && on[q + 1] && label[q + 1] === -1) { label[q + 1] = id; stack.push(q + 1); }
      if (y > 0 && on[q - w] && label[q - w] === -1) { label[q - w] = id; stack.push(q - w); }
      if (y < h - 1 && on[q + w] && label[q + w] === -1) { label[q + w] = id; stack.push(q + w); }
    }
    comps.push({ x0, y0, x1, y1, size: (x1 - x0 + 1) * (y1 - y0 + 1) });
    small.push(Math.max(x1 - x0 + 1, y1 - y0 + 1) < minSize);
  }
  // 글자 줄 찾기: 가장 큰 덩어리에서 시작해서, 같은 높이대에 있고 가까이 붙어 있는 덩어리만 차례로 합친다
  // (글자와 떨어져 있는 파티클 덩어리는 여기서 빠진다)
  const keep = new Uint8Array(comps.length);
  let main = -1;
  comps.forEach((c, i) => { if (!small[i] && (main < 0 || c.size > comps[main].size)) main = i; });
  if (main < 0) return null;
  keep[main] = 1;
  let cx0 = comps[main].x0, cx1 = comps[main].x1, cy0 = comps[main].y0, cy1 = comps[main].y1;
  const gapMax = h * 0.6;
  for (let added = true; added;) {
    added = false;
    comps.forEach((c, i) => {
      if (keep[i] || small[i]) return;
      const bandPad = (cy1 - cy0 + 1) * 0.3;
      const vOverlap = c.y1 >= cy0 - bandPad && c.y0 <= cy1 + bandPad;
      const gap = Math.max(cx0 - c.x1, c.x0 - cx1, 0);
      if (!vOverlap || gap > gapMax) return;
      keep[i] = 1; added = true;
      cx0 = Math.min(cx0, c.x0); cx1 = Math.max(cx1, c.x1); cy0 = Math.min(cy0, c.y0); cy1 = Math.max(cy1, c.y1);
    });
  }
  // 수치의 소수점(.)은 작아서 위에서 지워진다 → 글자 줄 안쪽 아래쪽(밑줄 높이)에 있는 작은 점은 되살린다
  if (keepDots) {
    const dotTop = cy0 + (cy1 - cy0) * 0.6;
    comps.forEach((c, i) => {
      if (keep[i] || !small[i]) return;
      if (c.x0 > cx0 && c.x1 < cx1 && c.y0 >= dotTop && c.y1 <= cy1 + 1) keep[i] = 1;
    });
  }
  for (let i = 0; i < small.length; i++) small[i] = !keep[i];   // 이후엔 "남긴 덩어리"만 글자로 취급
  let bx0 = w, by0 = h, bx1 = -1, by1 = -1, ink = 0;
  for (let p = 0; p < n; p++) {
    if (label[p] < 0 || small[label[p]]) continue;
    const x = p % w, y = (p - x) / w;
    if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y;
    ink++;
  }
  if (bx1 < 0 || ink < 20) return null;
  const fw = bx1 - bx0 + 1, fh = by1 - by0 + 1;
  const bits = new Uint8Array(fw * fh);
  for (let y = 0; y < fh; y++) {
    for (let x = 0; x < fw; x++) {
      const p = (y + by0) * w + (x + bx0);
      bits[y * fw + x] = label[p] >= 0 && !small[label[p]] ? 1 : 0;
    }
  }
  return { bits, w: fw, h: fh, ink, right: bx1, regionW: w };
}
// 두 지문의 차이 = 어긋난 글자 픽셀 수 ÷ 글자 픽셀 수 (0 = 똑같음). 크기가 다르면 다른 이름.
// 파티클이 글자 위아래에 붙어 영역이 몇 px 밀릴 수 있어서 ±FP_SHIFT px 어긋남까지 맞춰본다
function fpDiff(a, b) {
  if (Math.abs(a.w - b.w) > FP_SIZE_TOL || Math.abs(a.h - b.h) > FP_SIZE_TOL) return 1;
  const W = Math.max(a.w, b.w), H = Math.max(a.h, b.h);
  const at = (f, x, y) => (x >= 0 && y >= 0 && x < f.w && y < f.h ? f.bits[y * f.w + x] : 0);
  let best = Infinity;
  for (let dy = -FP_SHIFT; dy <= FP_SHIFT; dy++) {
    for (let dx = -FP_SHIFT; dx <= FP_SHIFT; dx++) {
      let miss = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (at(a, x, y) !== at(b, x + dx, y + dy)) miss++;
      best = Math.min(best, miss / Math.max(a.ink, b.ink));
    }
  }
  return best;
}
// 지문 → 뜻 을 기억하는 저장소. 옵션명용 / 수치용 두 개를 쓴다
function createShapeMemory({ match, margin, confirm = 2, max = 60 }) {
  let items = [];                                  // { ...지문, meaning, votes }
  const sameMeaning = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  function find(fp) {
    let best = null, bestD = Infinity;
    for (const e of items) {
      const d = fpDiff(fp, e);
      if (d < bestD) { bestD = d; best = e; }
    }
    return best && bestD <= match ? { entry: best, d: bestD } : null;
  }
  return {
    // OCR을 생략해도 될 만큼 확실한 기억만 돌려준다 (비슷한 모양의 다른 뜻이 있으면 null)
    lookup(fp) {
      if (!fp) return null;
      const hit = find(fp);
      if (!hit || hit.entry.votes < confirm) return null;
      const rival = items.some((e) => e !== hit.entry && !sameMeaning(e.meaning, hit.entry.meaning) && fpDiff(fp, e) < hit.d + margin);
      return rival ? null : hit.entry.meaning;
    },
    // OCR 결과를 기억. clean(깔끔하게 읽음)이면 바로 확정, 아니면 같은 결과가 한 번 더 나와야 확정
    remember(fp, meaning, clean) {
      if (!fp || !meaning) return;
      const hit = find(fp);
      if (hit && sameMeaning(hit.entry.meaning, meaning)) { hit.entry.votes++; return; }
      if (hit) { Object.assign(hit.entry, fp, { meaning, votes: clean ? confirm : 1 }); return; }   // 같은 모양인데 다른 결과 → 다시 시작
      items.push({ ...fp, meaning, votes: clean ? confirm : 1 });
      if (items.length > max) items.shift();
    },
    clear() { items = []; },
  };
}
const nameMemory = createShapeMemory({ match: 0.12, margin: 0.08, max: 40 });
const valueMemory = createShapeMemory({ match: 0.07, margin: 0.06, max: 80 });   // 숫자 하나 차이(12.6 / 12.8)도 있어서 더 엄격하게
function clearNameCache() { nameMemory.clear(); valueMemory.clear(); }   // 인식 영역이 바뀌면 글자 모양도 바뀌므로 비운다
let blankCount = Array(SLOT_COUNT).fill(0);

async function readSlot(src, s) {
  const slotH = src.height / SLOT_COUNT;
  const splitX = Math.round(src.width * SPLIT_X);
  const y = Math.round(s * slotH), h = Math.round(slotH);
  const ctx = src.getContext('2d');
  const t0 = performance.now();
  const ms = () => `${(performance.now() - t0).toFixed(0)}ms`;
  const fpName = textFingerprint(ctx, 0, y, splitX, h, FP_SPECK_NAME);   // 확대 전 원본 픽셀로 지문

  // 1) 옵션명 칸에 글자가 없음 → 연출 중이거나 빈 화면. OCR 안 하고 넘김
  if (!fpName) {
    if (++blankCount[s] <= BLANK_SKIP_MAX) {
      if (DEBUG) console.log(`[슬롯 ${s + 1}] 글자 없음 → 건너뜀 ${ms()}`);
      return { kind: 'garbage' };
    }
  } else blankCount[s] = 0;

  // 2) 옵션명 칸을 오른쪽 끝까지 꽉 채운 긴 글자 = 아직 안 열린 줄 안내문 → OCR 없이 빈 줄
  if (fpName && fpName.right >= fpName.regionW - 4 && fpName.w >= fpName.regionW * LOCKED_WIDTH) {
    if (DEBUG) console.log(`[슬롯 ${s + 1}] 안 열린 줄 (모양) ${ms()}`);
    return { kind: 'empty' };
  }

  // 3) 기억해 둔 글자 모양 확인
  const nameHit = nameMemory.lookup(fpName);
  if (nameHit && nameHit.kind === 'empty') {
    if (DEBUG) console.log(`[슬롯 ${s + 1}] 안 열린 줄 (기억) ${ms()}`);
    return { kind: 'empty' };
  }
  const fpValue = textFingerprint(ctx, splitX, y, src.width - splitX, h, FP_SPECK_VALUE, true);
  const valueHit = valueMemory.lookup(fpValue);
  if (nameHit && valueHit) {
    const r = parseSlot(nameHit.label, valueHit.text, s + 1);
    if (DEBUG) console.log(`[슬롯 ${s + 1}] 이름·수치 모두 기억 → ${r.kind} ${ms()}`);
    if (r.kind === 'stat') return r;
  }

  // 4) 기억에 없는 쪽만 OCR (둘 다 기억이 안 맞았으면 둘 다)
  const useName = nameHit && !(valueHit && nameHit);   // 둘 다 기억인데 결과가 이상했으면 둘 다 다시 읽는다
  const useValue = valueHit && !(valueHit && nameHit);
  const [nameText, valueText] = await Promise.all([
    useName ? nameHit.label : nameWorker.recognize(preLeft(src, 0, y, splitX, h)).then((r) => r.data.text),
    useValue ? valueHit.text : valueWorker.recognize(preRight(src, splitX, y, src.width - splitX, h)).then((r) => r.data.text),
  ]);
  const r = parseSlot(nameText, valueText, s + 1);

  // 5) 이번에 OCR로 읽은 쪽을 기억
  if (r.kind === 'empty') nameMemory.remember(fpName, { kind: 'empty' }, true);
  if (r.kind === 'stat') {
    const label = STAT_DATABASE[r.slot.key].label;
    if (!useName) nameMemory.remember(fpName, { kind: 'label', label }, nameSimilarity(r.nameStr, label) >= FP_CLEAN_READ);
    if (!useValue) {
      const canonical = `${r.slot.val}${r.slot.isPercent ? '%' : ''}`;
      const clean = r.rawVal === r.slot.val && r.sawPercent === r.slot.isPercent;   // 단계값과 정확히 같게 읽었을 때만 바로 확정
      valueMemory.remember(fpValue, { text: canonical }, clean);
    }
  }
  if (DEBUG) console.log(`[슬롯 ${s + 1}] OCR(${useName ? '' : '옵션명 '}${useValue ? '' : '수치'}) → ${r.kind} ${ms()}`);
  return r;
}

// ───────── 줄별 화면 변화 감지 ─────────
// 같은 이미지를 Tesseract로 다시 읽으면 결과도 똑같다 → 여러 번 읽어 다수결할 필요가 없다.
// 대신 "바뀐 줄"만, "애니메이션이 멈춘 뒤" 딱 한 번 읽고 바로 확정한다.
function slotSignatures(src) {
  sigCtx.drawImage(src, 0, 0, sigCanvas.width, sigCanvas.height);
  const d = sigCtx.getImageData(0, 0, sigCanvas.width, sigCanvas.height).data;
  const w = sigCanvas.width;
  return Array.from({ length: SLOT_COUNT }, (_, s) => {
    const out = new Uint8Array(w * SIG_ROWS);
    for (let p = 0; p < out.length; p++) {
      const i = (s * SIG_ROWS * w + p) * 4;
      out[p] = (d[i] + d[i + 1] + d[i + 2]) / 3;
    }
    return out;
  });
}
// 크게 바뀐 픽셀의 비율 (글자가 바뀌면 크고, 배경 파티클이 반짝이는 정도면 작다)
function sigDiff(a, b) {
  let changed = 0;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) >= PIXEL_CHANGE) changed++;
  return changed / a.length;
}

// 한 줄의 OCR 결과를 반영 (오인식 보정)
//  - 빈 줄이었으면: 옵션이 읽히면 바로 확정 (새 옵션은 즉시 반영)
//  - 이미 확정된 줄이면: 쓰레기 결과는 무시하고, 다른 결과는 두 번 연속 같아야 교체
const resultSig = (r) => (r.kind === 'stat' ? `${r.slot.key}|${r.slot.val}` : r.kind);
function applyRead(i, r) {
  const cur = lockedSlots[i];
  if (r.kind === 'garbage') {
    if (!cur) readSig[i] = null;                         // 빈 줄은 다음 사이클에 다시 시도
    return;
  }
  const next = r.kind === 'stat' ? r.slot : null;
  const curSig = cur ? `${cur.key}|${cur.val}` : 'empty';
  const sig = resultSig(r);
  if (sig === curSig) { pending[i] = null; return; }
  if (!cur || pending[i] === sig) {                      // 빈 줄이거나, 같은 새 결과가 두 번째
    lockedSlots[i] = next;
    pending[i] = null;
    return;
  }
  pending[i] = sig;                                      // 처음 본 다른 결과 → 바로 한 번 더 읽어서 확인
  readSig[i] = null;
}

// 상태 표시 (kind: idle | busy | ok | info | err → CSS 점 색)
function setStatus(kind, text) {
  ocrStatus.className = `status-text st-${kind}`;
  ocrStatus.innerHTML = `<i class="st-dot"></i><span>${text}</span>`;
  document.body.classList.toggle('is-live', kind === 'ok' || kind === 'busy' || kind === 'info');
}

function updateScanStatus() {
  if (!currentStream || !ocrReady) return;
  const n = lockedSlots.filter(Boolean).length;
  if (n > 0) setStatus('ok', `${n}개 부옵션 확정`);
  else setStatus('busy', '에코 데이터 스캔 중');
}

async function runOcrCycle(now) {
  isOcrBusy = true;
  try {
    if (ocrSnap.width !== cropCanvas.width || ocrSnap.height !== cropCanvas.height) {
      ocrSnap.width = cropCanvas.width; ocrSnap.height = cropCanvas.height;
    }
    ocrSnapCtx.drawImage(cropCanvas, 0, 0);               // 스냅샷을 떠서 OCR 도중 프레임이 바뀌어도 일관되게
    const sigs = slotSignatures(ocrSnap);

    // 강화할 때 화면 전체가 잠깐 어두워졌다 돌아온다 → 어두운 동안은 아무 줄도 읽지 않고 기다린다.
    // 돌아오면 원래 줄들은 마지막으로 읽었을 때와 똑같으니 다시 읽을 필요가 없고, 새로 열린 줄만 바뀐 줄로 잡힌다.
    let lum = 0;
    for (const sg of sigs) for (const v of sg) lum += v;
    lum /= sigs.length * sigs[0].length;
    if (!stableLum) stableLum = lum;
    if (lum < stableLum * DIM_RATIO) {
      if (!dimSince) dimSince = now;
      if (now - dimSince < DIM_MAX_MS) {
        if (DEBUG && dimSince === now) console.log('[화면 어두워짐] 돌아올 때까지 대기');
        prevSig2 = prevSig; prevSig = sigs;
        return;
      }
      stableLum = lum;                                    // 오래 어두우면 이게 원래 화면 → 기준을 바꾼다
    } else {
      dimSince = 0;
      stableLum = stableLum * 0.8 + lum * 0.2;
    }

    // 줄마다 우선순위: 0 = 다음에 열릴 줄(첫 빈 줄) / 1 = 나머지 빈 줄 / 2 = 이미 확정된 줄
    const nextOpen = lockedSlots.findIndex((x, i) => !x && !pinned[i]);
    const rank = (i) => (i === nextOpen ? 0 : lockedSlots[i] ? 2 : 1);
    const ready = [], waiting = [];
    for (let i = 0; i < SLOT_COUNT; i++) {
      if (pinned[i]) continue;                            // 수동 고정 슬롯은 OCR 생략
      // 옵션은 위에서부터 차례로 열린다 → 다음에 열릴 줄보다 아래의 빈 줄은 읽을 필요가 없다
      if (nextOpen >= 0 && i > nextOpen && !lockedSlots[i]) continue;
      const changed = !readSig[i] || sigDiff(sigs[i], readSig[i]) >= ROW_CHANGE;
      if (!changed) { changedAt[i] = 0; continue; }       // 그대로인 줄은 OCR 비용 0
      if (!changedAt[i]) changedAt[i] = now;
      // 두 사이클 연속으로 거의 안 변했을 때 "연출이 끝났다"고 본다 (서서히 나타나는 글자를 반쯤 읽지 않도록)
      const settled = prevSig[i] && prevSig2[i]
        && sigDiff(sigs[i], prevSig[i]) < ROW_CHANGE && sigDiff(sigs[i], prevSig2[i]) < ROW_CHANGE;
      (settled || now - changedAt[i] > SETTLE_MAX_MS ? ready : waiting).push(i);
    }
    prevSig2 = prevSig;
    prevSig = sigs;

    // 한 사이클에 한 줄만 읽고 다음 사이클에 우선순위를 다시 매긴다
    // → 다른 줄을 읽는 중에 새 옵션이 열려도, 다음 차례에 바로 새 줄부터 읽는다
    const byRank = (a, b) => rank(a) - rank(b) || a - b;
    ready.sort(byRank);
    waiting.sort(byRank);
    const i = ready[0];
    // 더 급한 줄(새로 열리는 줄)이 아직 연출 중이면, 덜 급한 줄을 읽느라 OCR을 붙잡지 말고 기다린다
    if (i !== undefined && !(waiting.length && rank(waiting[0]) < rank(i))) {
      const result = await readSlot(ocrSnap, i);
      if (!pinned[i] && currentStream) {                  // 읽는 동안 수동 고정/공유 중지된 경우 무시
        readSig[i] = sigs[i];
        changedAt[i] = 0;
        applyRead(i, result);
        // 아직 안 열린 줄이 확인되면 그 아래 줄도 전부 안 열린 상태 → 읽지 않고 바로 비운다 (에코 바꿀 때 빨라짐)
        if (result.kind === 'empty' && !lockedSlots[i]) {
          for (let j = i + 1; j < SLOT_COUNT; j++) {
            if (pinned[j]) continue;
            lockedSlots[j] = null; pending[j] = null; readSig[j] = sigs[j]; changedAt[j] = 0;
          }
        }
        if (slotsSignature() !== lastRenderSig) runEvaluation();
      }
    }
    updateScanStatus();
  } catch (err) {
    console.error('OCR Error:', err);
  } finally {
    isOcrBusy = false;
  }
}

// ───────── 화면 공유 ─────────
startShareBtn.addEventListener('click', async () => {
  if (currentStream) return stopScreenShare();
  try {
    currentStream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15, max: 15 } }, audio: false });
  } catch (err) {
    currentStream = null;
    console.error(err);
    if (err.name === 'NotAllowedError') return;                 // 사용자가 취소
    setStatus('err', '화면 공유를 시작하지 못했어요. 다시 시도하거나 아래에서 직접 입력해주세요.');
    return;
  }
  currentStream.getVideoTracks()[0].onended = stopScreenShare;
  gameVideo.srcObject = currentStream;
  gameVideo.muted = true;
  gameVideo.play().catch(() => {});
  startShareBtn.textContent = '공유 중지';
  startShareBtn.classList.add('btn-stop');
  framePlaceholder.style.display = 'none';
  setStatus('busy', 'OCR 엔진 로드 중');

  const token = ++loopToken;                              // 미리보기는 OCR 로딩과 상관없이 바로 시작
  requestAnimationFrame((ts) => renderLoop(ts, token));
  runEvaluation();

  try {
    await initOcr();
  } catch (err) {
    console.error(err);
    if (currentStream) setStatus('err', 'OCR 엔진 로드 실패 (네트워크 확인)');
    return;
  }
  if (!currentStream) return;                             // 로딩 중 공유가 중지된 경우
  ocrReady = true;
  setStatus('ok', '실시간 감시 중');
});

function stopScreenShare() {
  loopToken++;                                            // 렌더 루프 종료 (중복 루프 방지)
  ocrReady = false;
  if (currentStream) { currentStream.getTracks().forEach((t) => t.stop()); currentStream = null; }
  gameVideo.srcObject = null;
  startShareBtn.innerHTML = startBtnHTML;
  startShareBtn.classList.remove('btn-stop');
  framePlaceholder.style.display = 'block';
  frameCtx.clearRect(0, 0, frameCanvas.width, frameCanvas.height);
  resetCurrentEcho();
  setStatus('idle', '화면 공유 중지됨');
}

function resetCurrentEcho() {
  lockedSlots = Array(SLOT_COUNT).fill(null);
  pinned = Array(SLOT_COUNT).fill(false);
  invalidateOcrCache();
  runEvaluation();
  if (currentStream) setStatus('info', '새 에코 인식 대기 중');
}

function invalidateOcrCache() {
  readSig = Array(SLOT_COUNT).fill(null);                 // 모든 줄을 다시 읽게 한다
  prevSig = Array(SLOT_COUNT).fill(null);
  prevSig2 = Array(SLOT_COUNT).fill(null);
  changedAt = Array(SLOT_COUNT).fill(0);
  pending = Array(SLOT_COUNT).fill(null);
  stableLum = 0;
  dimSince = 0;
  blankCount = Array(SLOT_COUNT).fill(0);
}

// ───────── 렌더 루프 ─────────
function renderLoop(timestamp, token) {
  if (token !== loopToken || !currentStream) return;
  if (gameVideo.videoWidth) drawFrame(timestamp);
  requestAnimationFrame((ts) => renderLoop(ts, token));
}

function drawFrame(timestamp) {
  const vw = gameVideo.videoWidth, vh = gameVideo.videoHeight;

  // OCR용 크롭은 항상 원본 해상도 그대로 (이중 업스케일/비율 왜곡 방지)
  const sw = Math.max(8, Math.round(box.w * vw)), sh = Math.max(8, Math.round(box.h * vh));
  if (cropCanvas.width !== sw || cropCanvas.height !== sh) { cropCanvas.width = sw; cropCanvas.height = sh; }
  cropCtx.drawImage(gameVideo, Math.round(box.x * vw), Math.round(box.y * vh), sw, sh, 0, 0, sw, sh);

  if (ocrReady && !isOcrBusy && timestamp - lastOcrTime > OCR_INTERVAL_MS) {
    lastOcrTime = timestamp;
    runOcrCycle(timestamp);
  }

  const fw = 960;
  if (!adjusting) {
    // 캡처 화면: OCR이 읽는 영역만 깔끔하게 (오버레이/표시 없음)
    setFrameSize(fw, Math.max(8, Math.round((fw * sh) / sw)));
    frameCtx.drawImage(cropCanvas, 0, 0, frameCanvas.width, frameCanvas.height);
    return;
  }

  // 조정 화면: 옵션 영역 주변만 확대(또는 전체 화면)해서 보여주고, 그 위에서 박스를 직접 드래그
  const viewPxW = view.w * vw, viewPxH = view.h * vh;       // 보기 영역의 실제 픽셀 크기
  setFrameSize(fw, Math.max(8, Math.round((fw * viewPxH) / viewPxW)));
  const fh = frameCanvas.height;
  frameCtx.drawImage(gameVideo, view.x * vw, view.y * vh, viewPxW, viewPxH, 0, 0, fw, fh);
  const bx = ((box.x - view.x) / view.w) * fw, by = ((box.y - view.y) / view.h) * fh;
  const bw = (box.w / view.w) * fw, bh = (box.h / view.h) * fh;
  frameCtx.fillStyle = 'rgba(0, 0, 0, 0.35)';              // 영역 밖은 어둡게
  frameCtx.beginPath();
  frameCtx.rect(0, 0, fw, fh);
  frameCtx.rect(bx, by, bw, bh);
  frameCtx.fill('evenodd');
  const fSplit = bw * SPLIT_X, fSlotH = bh / SLOT_COUNT;   // 슬롯 5칸 가이드 (인식 성공은 초록)
  frameCtx.lineWidth = 1.5;
  for (let s = 0; s < SLOT_COUNT; s++) {
    const ok = lockedSlots[s] !== null;
    frameCtx.strokeStyle = ok ? 'rgba(62, 230, 214, 0.9)' : 'rgba(255, 181, 71, 0.9)';
    frameCtx.strokeRect(bx + 1, by + s * fSlotH + 1, fSplit - 2, fSlotH - 2);
    frameCtx.strokeStyle = ok ? 'rgba(62, 230, 214, 0.9)' : 'rgba(255, 181, 71, 0.55)';
    frameCtx.strokeRect(bx + fSplit + 1, by + s * fSlotH + 1, bw - fSplit - 2, fSlotH - 2);
  }
  frameCtx.lineWidth = 2.5;
  frameCtx.strokeStyle = '#e7e8ea';
  frameCtx.strokeRect(bx, by, bw, bh);
  frameCtx.fillStyle = '#3ee6d6';
  frameCtx.fillRect(bx + bw - 9, by + bh - 9, 18, 18);       // 크기 조절 핸들
}

function setFrameSize(fw, fh) {
  if (frameCanvas.width !== fw || frameCanvas.height !== fh) {
    frameCanvas.width = fw; frameCanvas.height = fh;
    frameWrapper.style.aspectRatio = `${fw} / ${fh}`;
  }
}

// ───────── 인식 영역 드래그 / 리사이즈 ─────────
const HANDLE = 0.04;           // 핸들 판정 범위 (큰 화면에 보이는 영역 대비 비율)
let dragMode = null, dragStart = null, boxStart = null;

function pointerRatio(e) {
  const r = frameCanvas.getBoundingClientRect();
  // 큰 화면 위의 위치 → 영상 전체 기준 비율 좌표 (보기 영역 오프셋/배율 반영)
  return {
    x: clamp(view.x + clamp((e.clientX - r.left) / r.width) * view.w),
    y: clamp(view.y + clamp((e.clientY - r.top) / r.height) * view.h),
  };
}
function hitMode(p) {
  const tx = HANDLE * view.w, ty = HANDLE * view.h;
  if (Math.abs(p.x - (box.x + box.w)) < tx && Math.abs(p.y - (box.y + box.h)) < ty) return 'resize';
  if (p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h) return 'move';
  return 'draw';
}

frameCanvas.addEventListener('pointerdown', (e) => {
  if (!currentStream || !adjusting) return;
  const p = pointerRatio(e);
  dragMode = hitMode(p);
  dragStart = p; boxStart = { ...box };
  frameCanvas.setPointerCapture(e.pointerId);
});
frameCanvas.addEventListener('pointermove', (e) => {
  if (!adjusting) { frameCanvas.style.cursor = 'default'; return; }
  const p = pointerRatio(e);
  if (!dragMode) {
    frameCanvas.style.cursor = { resize: 'nwse-resize', move: 'move', draw: 'crosshair' }[hitMode(p)];
    return;
  }
  if (dragMode === 'move') {
    box.x = clamp(boxStart.x + p.x - dragStart.x, 0, 1 - box.w);
    box.y = clamp(boxStart.y + p.y - dragStart.y, 0, 1 - box.h);
  } else if (dragMode === 'resize') {
    box.w = clamp(p.x - box.x, MIN_BOX, 1 - box.x);
    box.h = clamp(p.y - box.y, MIN_BOX, 1 - box.y);
  } else {
    const x0 = Math.min(dragStart.x, p.x), y0 = Math.min(dragStart.y, p.y);
    box = {
      x: x0, y: y0,
      w: clamp(Math.abs(p.x - dragStart.x), MIN_BOX, 1 - x0),
      h: clamp(Math.abs(p.y - dragStart.y), MIN_BOX, 1 - y0),
    };
  }
});
['pointerup', 'pointercancel'].forEach((ev) => frameCanvas.addEventListener(ev, () => {
  if (!dragMode) return;
  const mode = dragMode;
  dragMode = null;
  if (viewMode === 'full' && mode === 'draw') {            // 전체 화면에서 새로 지정했으면 곧바로 확대 보기로
    viewMode = 'zoom';
    updateViewToggleLabel();
    updateView();
  } else if (viewMode === 'zoom' && !boxFitsView()) {      // 박스가 보기 영역을 벗어나거나 너무 작아졌으면 다시 맞춤
    updateView();
  }
  invalidateOcrCache();
  clearNameCache();
  saveSettings();
}));

// 확대 보기: 박스 주변(VIEW_PAD배)만 큰 화면에 보여준다. 드래그하는 동안에는 고정되어 화면이 흔들리지 않는다.
function updateView() {
  if (viewMode === 'full') { view = { x: 0, y: 0, w: 1, h: 1 }; return; }
  const w = clamp(box.w * VIEW_PAD, MIN_VIEW, 1), h = clamp(box.h * VIEW_PAD, MIN_VIEW, 1);
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  view = { x: clamp(cx - w / 2, 0, 1 - w), y: clamp(cy - h / 2, 0, 1 - h), w, h };
}
function boxFitsView() {
  const eps = 1e-9;
  const inside = box.x >= view.x - eps && box.y >= view.y - eps &&
                 box.x + box.w <= view.x + view.w + eps && box.y + box.h <= view.y + view.h + eps;
  return inside && box.w / view.w > 0.3 && box.h / view.h > 0.3;
}
function updateViewToggleLabel() {
  viewToggleBtn.textContent = viewMode === 'full' ? '옵션 영역 확대' : '전체 화면 보기';
}

viewToggleBtn.addEventListener('click', () => {
  viewMode = viewMode === 'full' ? 'zoom' : 'full';
  updateView();
  updateViewToggleLabel();
  saveSettings();
});

resetRegionBtn.addEventListener('click', () => {
  box = { ...DEFAULT_BOX };
  viewMode = 'zoom';
  invalidateOcrCache();
  clearNameCache();
  setAdjusting(true);                                     // 기본 위치로 돌린 뒤 바로 확인할 수 있게 조정 화면으로
  saveSettings();
});

// 캡처 화면(OCR이 보는 그대로) ↔ 영역 조정 화면 전환
function applyModeUI() {
  frameWrapper.classList.toggle('capture-mode', !adjusting);
  adjustToggleBtn.textContent = adjusting ? '조정 완료' : '영역 조정';
  viewToggleBtn.style.display = adjusting ? '' : 'none';
  regionHint.textContent = adjusting
    ? '박스 안을 끌면 이동, 모서리 ■로 크기 조절, 바깥을 끌면 새로 지정 (자동 저장)'
    : 'OCR이 읽는 화면이에요. 위치가 안 맞으면 [영역 조정]을 눌러주세요.';
  updateViewToggleLabel();
}
function setAdjusting(on) {
  adjusting = on;
  if (on) updateView();
  applyModeUI();
}
adjustToggleBtn.addEventListener('click', () => setAdjusting(!adjusting));

// ───────── 이벤트 리스너 ─────────
minTierCutSelect.addEventListener('change', onSettingsChanged);
goThresholdInput.addEventListener('input', onSettingsChanged);
resetScanBtn.addEventListener('click', resetCurrentEcho);

toggleTableBtn.addEventListener('click', () => {
  const open = probTableBox.style.display === 'block';
  probTableBox.style.display = open ? 'none' : 'block';
  tableArrow.textContent = open ? '▼ 열기' : '▲ 닫기';
});

// ───────── 수동 수정 모달 (슬롯 위치 기준) ─────────
function populateValueDropdown(statKey, selectedVal = null) {
  editStatValue.innerHTML = '';
  const data = STAT_DATABASE[statKey];
  data.values.forEach((v, idx) => {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = `+${v}${data.isPercent ? '%' : ''} [${evaluateStepTier(idx + 1, data.values.length).label}]`;
    if (v === selectedVal) opt.selected = true;
    editStatValue.appendChild(opt);
  });
}

function openEditModal(slotIdx) {
  editingIndex = slotIdx;
  const target = lockedSlots[slotIdx];
  const key = target ? target.key : Object.keys(STAT_DATABASE)[0];
  editModalTitle.textContent = target ? `슬롯 ${slotIdx + 1} 부옵션 수정` : `슬롯 ${slotIdx + 1} 부옵션 추가`;
  modalClearBtn.style.display = target ? '' : 'none';   // 빈 슬롯을 추가할 때는 삭제 버튼 없음
  editStatKey.value = key;
  populateValueDropdown(key, target ? target.val : null);
  editModal.style.display = 'flex';
}

function closeModal() { editModal.style.display = 'none'; editingIndex = -1; }

modalCancelBtn.addEventListener('click', closeModal);
editModal.addEventListener('click', (e) => { if (e.target === editModal) closeModal(); });

// 슬롯 삭제
//  - 화면 공유 중: 슬롯 위치 = 게임 화면의 줄 → 그 자리만 비우고 OCR이 다시 읽게 한다
//  - 직접 입력(공유 안 함): 아래 슬롯들을 한 칸씩 당겨서 빈칸이 안 생기게 한다
modalClearBtn.addEventListener('click', () => {
  const i = editingIndex;
  if (i >= 0) {
    if (currentStream) {
      lockedSlots[i] = null;
      pinned[i] = false;
      readSig[i] = null;
      pending[i] = null;
    } else {
      lockedSlots.splice(i, 1); lockedSlots.push(null);
      pinned.splice(i, 1); pinned.push(false);
    }
    runEvaluation();
  }
  closeModal();
});

modalSaveBtn.addEventListener('click', () => {
  if (editingIndex >= 0 && editingIndex < SLOT_COUNT) {
    const key = editStatKey.value;
    const { step } = nearestStep(parseFloat(editStatValue.value), STAT_DATABASE[key].values);
    lockedSlots[editingIndex] = makeSlot(key, step);
    pinned[editingIndex] = true;                          // 수동 수정은 OCR이 덮어쓰지 않음 (새 에코는 '수동 초기화')
    runEvaluation();
  }
  closeModal();
});

// ───────── 시작 ─────────
initUI();
