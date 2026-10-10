// app.js — 명조 에코파고 v2.5
import {
  STAT_DATABASE, DEFAULT_TARGETS, GOAL_PRESETS, CUT_SCORE,
  evaluateStepTier, tierPassProb, nearestStep, makeSlot, matchStat,
} from './data.js';
import { goalSuccessProb, isGoalSatisfied } from './math.js';

// ───────── 상수 ─────────
const SLOT_COUNT = 5;
const SPLIT_X = 0.65;          // 슬롯 폭 중 옵션명 / 수치 경계
const HISTORY_SIZE = 4;        // 슬롯별 최근 N회 인식 결과로 다수결
const MIN_VOTES = 2;           // 같은 결과가 N회 이상이어야 확정
const OCR_INTERVAL_MS = 250;
const FRAME_DIFF_SKIP = 2.0;   // 화면이 거의 안 변했으면 OCR 재실행 생략
const TARGET_SLOT_PX = 90;     // 전처리 후 슬롯 높이 목표(px)
const MIN_BOX = 0.04;
const STORAGE_KEY = 'echopago.settings.v1';
const DEFAULT_BOX = { x: 0.110, y: 0.320, w: 0.245, h: 0.200 };
const DEBUG = new URLSearchParams(location.search).has('debug');   // ?debug 로 열면 OCR 원문을 콘솔에 출력

// ───────── 상태 ─────────
let currentStream = null;
let nameWorker = null, valueWorker = null;
let ocrReady = false;
let isOcrBusy = false;
let loopToken = 0;
let lastOcrTime = 0;
let lockedSlots = Array(SLOT_COUNT).fill(null);
let pinned = Array(SLOT_COUNT).fill(false);                       // 수동 수정한 슬롯은 OCR이 덮어쓰지 않음
let history = Array.from({ length: SLOT_COUNT }, () => []);
let lastRaw = null, lastSig = null, lastRenderSig = '';
let box = { ...DEFAULT_BOX };
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
const canvasPlaceholder = $('canvasPlaceholder');
const zoomCanvas = $('zoomCanvas');
const frameCanvas = $('frameCanvas');
const frameWrapper = $('frameWrapper');
const cropWrapper = $('cropWrapper');
const framePlaceholder = $('framePlaceholder');
const resetRegionBtn = $('resetRegionBtn');
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

const zoomCtx = zoomCanvas.getContext('2d');
const frameCtx = frameCanvas.getContext('2d');
const cropCanvas = document.createElement('canvas');
const cropCtx = cropCanvas.getContext('2d', { willReadFrequently: true });
const ocrSnap = document.createElement('canvas');
const ocrSnapCtx = ocrSnap.getContext('2d', { willReadFrequently: true });
const sigCanvas = document.createElement('canvas');
sigCanvas.width = 48; sigCanvas.height = 24;
const sigCtx = sigCanvas.getContext('2d', { willReadFrequently: true });

const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

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

// ───────── UI 초기화 ─────────
function initUI() {
  const saved = loadSettings();
  const savedTargets = Array.isArray(saved.targets) ? saved.targets.filter((k) => k in STAT_DATABASE) : null;
  const targets = savedTargets ?? DEFAULT_TARGETS;
  if (['low', 'mid', 'high'].includes(saved.cut)) minTierCutSelect.value = saved.cut;
  if (Number.isFinite(saved.goThreshold)) goThresholdInput.value = saved.goThreshold;
  if (saved.box && ['x', 'y', 'w', 'h'].every((k) => Number.isFinite(saved.box[k]))) box = sanitizeBox(saved.box);

  Object.keys(STAT_DATABASE).forEach((key) => {
    const label = document.createElement('label');
    label.className = 'filter-chip';
    label.innerHTML = `<input type="checkbox" value="${key}" ${targets.includes(key) ? 'checked' : ''}> ${STAT_DATABASE[key].name}`;
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
      <div class="goal-info">
        <div class="goal-prob" id="prob-${goal.id}">대기 중...</div>
        <div class="decision-badge badge-wait" id="badge-${goal.id}">-</div>
      </div>`;
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

function setGoalResult(id, html, status) {
  $(`prob-${id}`).innerHTML = html;
  const badge = $(`badge-${id}`);
  badge.className = `decision-badge badge-${status.toLowerCase()}`;
  badge.innerText = { WAIT: '대기 중', DONE: '성공 (완주)', GO: 'GO (강화 추천)', STOP: 'STOP (즉시 손절)' }[status];
  $(`goal-card-${id}`).classList.toggle('active', status === 'GO' || status === 'DONE');
}

function renderStatList(slots, isValid, keyCount, openedCount) {
  statList.innerHTML = '';
  if (openedCount === 0) {
    const msg = currentStream ? '0강 상태 (강화 후 데이터 대기 중)' : '에코 데이터가 없습니다. 화면을 공유해주세요.';
    statList.insertAdjacentHTML('beforeend', `<div class="stat-empty">${msg}</div>`);
  }
  slots.forEach((stat, idx) => {
    const row = document.createElement('div');
    row.className = 'stat-item';
    if (!stat) {
      row.classList.add('stat-item-missing');
      row.innerHTML = `
        <div><span>슬롯 ${idx + 1}</span><span class="stat-warn">⚠ 인식 실패</span></div>
        <span class="stat-edit-hint">✏️ 직접 입력</span>`;
    } else {
      const valid = isValid(stat);
      row.innerHTML = `
        <div>
          <span>${pinned[idx] ? '📌 ' : ''}${stat.name}</span>
          <span style="color:#94a3b8; font-size:12px; margin-left:6px;">+${stat.val}${stat.isPercent ? '%' : ''}</span>
          ${valid ? '<span class="valid-mark">★ 유효</span>' : ''}
          ${keyCount[stat.key] > 1 ? '<span class="stat-warn">⚠ 중복</span>' : ''}
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          <span class="tier-badge ${stat.tier.class}">${stat.tier.label}</span>
          <span class="stat-edit-hint">✏️ 수정</span>
        </div>`;
    }
    row.addEventListener('click', () => openEditModal(idx));
    statList.appendChild(row);
  });
  if (openedCount < SLOT_COUNT) {
    const add = document.createElement('div');
    add.className = 'stat-item stat-item-add';
    add.textContent = `＋ 슬롯 ${openedCount + 1} 직접 추가`;
    add.addEventListener('click', () => openEditModal(openedCount));
    statList.appendChild(add);
  }
}

function runEvaluation() {
  const selectedTargets = getSelectedTargets();
  const cutScore = CUT_SCORE[minTierCutSelect.value];
  const goThreshold = getGoThreshold() / 100;

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
    if (isGoalSatisfied(base, goal)) { setGoalResult(goal.id, '목표 스펙 달성 완료!', 'DONE'); return; }
    const prob = goalSuccessProb(goal, pool, picks, base);
    if (prob === 0) { setGoalResult(goal.id, '수학적 달성 불가', 'STOP'); return; }
    setGoalResult(goal.id, `최종 완성 확률: <strong>${(prob * 100).toFixed(2)}%</strong>`, prob >= goThreshold ? 'GO' : 'STOP');
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
  if (!m || nameStr.length < 1) return null;
  const val = parseFloat(`${m[1]}.${m[2] ?? 0}`);
  return matchStat(nameStr, val, valStr.includes('%'));
}

async function readAllSlots(src) {
  const slotH = src.height / SLOT_COUNT;
  const splitX = Math.round(src.width * SPLIT_X);
  const results = [];
  for (let s = 0; s < SLOT_COUNT; s++) {
    if (pinned[s]) { results.push(undefined); continue; }  // 수동 고정 슬롯은 OCR 생략
    const y = Math.round(s * slotH), h = Math.round(slotH);
    const left = preLeft(src, 0, y, splitX, h);
    const right = preRight(src, splitX, y, src.width - splitX, h);
    const [nameRet, valRet] = await Promise.all([nameWorker.recognize(left), valueWorker.recognize(right)]);
    results.push(parseSlot(nameRet.data.text, valRet.data.text, s + 1));
  }
  return results;
}

// ───────── 슬롯별 다수결 안정화 ─────────
function pushHistory(raw) {
  raw.forEach((slot, s) => {
    if (slot === undefined) return;
    const h = history[s];
    h.push({ sig: slot ? `${slot.key}|${slot.val}` : 'null', slot });
    if (h.length > HISTORY_SIZE) h.shift();
  });
}

function applyVotes() {
  history.forEach((h, s) => {
    if (pinned[s] || !h.length) return;
    const tally = new Map();
    h.forEach((e, i) => {
      const t = tally.get(e.sig) || { n: 0, slot: e.slot, last: 0 };
      t.n++; t.slot = e.slot; t.last = i;
      tally.set(e.sig, t);
    });
    let winner = null;
    for (const t of tally.values()) {
      if (!winner || t.n > winner.n || (t.n === winner.n && t.last > winner.last)) winner = t;
    }
    if (winner && winner.n >= MIN_VOTES) lockedSlots[s] = winner.slot;
  });
}

// ───────── 화면 변화 감지 (안 변했으면 OCR 생략) ─────────
function frameSignature(src) {
  sigCtx.drawImage(src, 0, 0, sigCanvas.width, sigCanvas.height);
  const d = sigCtx.getImageData(0, 0, sigCanvas.width, sigCanvas.height).data;
  const out = new Uint8Array(d.length / 4);
  for (let i = 0, p = 0; p < out.length; i += 4, p++) out[p] = (d[i] + d[i + 1] + d[i + 2]) / 3;
  return out;
}
function frameDiff(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

function updateScanStatus() {
  if (!currentStream || !ocrReady) return;
  const n = lockedSlots.filter(Boolean).length;
  ocrStatus.innerHTML = n > 0
    ? `<span style="color:#4ade80;">🔒 ${n}개 부옵션 확정</span>`
    : '<span style="color:#fde047;">⏳ 에코 데이터 스캔 중...</span>';
}

async function runOcrCycle() {
  isOcrBusy = true;
  try {
    if (ocrSnap.width !== cropCanvas.width || ocrSnap.height !== cropCanvas.height) {
      ocrSnap.width = cropCanvas.width; ocrSnap.height = cropCanvas.height;
    }
    ocrSnapCtx.drawImage(cropCanvas, 0, 0);               // 스냅샷을 떠서 OCR 도중 프레임이 바뀌어도 일관되게
    const sig = frameSignature(ocrSnap);
    if (lastSig && lastRaw && frameDiff(sig, lastSig) < FRAME_DIFF_SKIP) {
      pushHistory(lastRaw);                               // 화면이 그대로면 직전 결과를 한 표로 인정
    } else {
      lastSig = sig;
      lastRaw = await readAllSlots(ocrSnap);
      pushHistory(lastRaw);
    }
    applyVotes();
    if (slotsSignature() !== lastRenderSig) runEvaluation();
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
    if (err.name !== 'NotAllowedError') {
      ocrStatus.innerHTML = `<span style="color:#f87171;">⚠️ 화면 공유 실패: ${err.message}</span>`;
    }
    return;
  }
  currentStream.getVideoTracks()[0].onended = stopScreenShare;
  gameVideo.srcObject = currentStream;
  gameVideo.muted = true;
  gameVideo.play().catch(() => {});
  startShareBtn.innerHTML = '⏹ 공유 중지';
  startShareBtn.classList.add('btn-stop');
  canvasPlaceholder.style.display = 'none';
  framePlaceholder.style.display = 'none';
  ocrStatus.innerHTML = '<span style="color:#fde047;">⏳ OCR 엔진 로드 중...</span>';

  const token = ++loopToken;                              // 미리보기는 OCR 로딩과 상관없이 바로 시작
  requestAnimationFrame((ts) => renderLoop(ts, token));
  runEvaluation();

  try {
    await initOcr();
  } catch (err) {
    console.error(err);
    if (currentStream) ocrStatus.innerHTML = '<span style="color:#f87171;">⚠️ OCR 엔진 로드 실패 (네트워크 확인)</span>';
    return;
  }
  if (!currentStream) return;                             // 로딩 중 공유가 중지된 경우
  ocrReady = true;
  ocrStatus.innerHTML = '<span style="color:#4ade80;">🟢 실시간 감시 중</span>';
});

function stopScreenShare() {
  loopToken++;                                            // 렌더 루프 종료 (중복 루프 방지)
  ocrReady = false;
  if (currentStream) { currentStream.getTracks().forEach((t) => t.stop()); currentStream = null; }
  gameVideo.srcObject = null;
  startShareBtn.innerHTML = startBtnHTML;
  startShareBtn.classList.remove('btn-stop');
  canvasPlaceholder.style.display = 'block';
  framePlaceholder.style.display = 'block';
  zoomCtx.clearRect(0, 0, zoomCanvas.width, zoomCanvas.height);
  frameCtx.clearRect(0, 0, frameCanvas.width, frameCanvas.height);
  resetCurrentEcho();
  ocrStatus.innerHTML = '<span>⚙️</span> 화면 공유 중지됨';
}

function resetCurrentEcho() {
  lockedSlots = Array(SLOT_COUNT).fill(null);
  pinned = Array(SLOT_COUNT).fill(false);
  history = Array.from({ length: SLOT_COUNT }, () => []);
  lastRaw = null; lastSig = null;
  runEvaluation();
  if (currentStream) ocrStatus.innerHTML = '<span style="color:#38bdf8;">🔄 새 에코 인식 대기중</span>';
}

function invalidateOcrCache() {
  history = Array.from({ length: SLOT_COUNT }, () => []);
  lastRaw = null; lastSig = null;
}

// ───────── 렌더 루프 ─────────
function renderLoop(timestamp, token) {
  if (token !== loopToken || !currentStream) return;
  if (gameVideo.videoWidth) drawFrame(timestamp);
  requestAnimationFrame((ts) => renderLoop(ts, token));
}

function drawFrame(timestamp) {
  const vw = gameVideo.videoWidth, vh = gameVideo.videoHeight;

  // 크롭은 원본 해상도 그대로 (이중 업스케일/비율 왜곡 방지)
  const sw = Math.max(8, Math.round(box.w * vw)), sh = Math.max(8, Math.round(box.h * vh));
  if (cropCanvas.width !== sw || cropCanvas.height !== sh) { cropCanvas.width = sw; cropCanvas.height = sh; }
  cropCtx.drawImage(gameVideo, Math.round(box.x * vw), Math.round(box.y * vh), sw, sh, 0, 0, sw, sh);

  // 미리보기: 크롭의 가로세로 비율을 유지
  const pw = 800, ph = Math.max(8, Math.round((pw * sh) / sw));
  if (zoomCanvas.width !== pw || zoomCanvas.height !== ph) {
    zoomCanvas.width = pw; zoomCanvas.height = ph;
    cropWrapper.style.aspectRatio = `${pw} / ${ph}`;      // 작은 미리보기 틀도 크롭 비율에 맞춘다
  }
  zoomCtx.drawImage(cropCanvas, 0, 0, pw, ph);

  if (ocrReady && !isOcrBusy && timestamp - lastOcrTime > OCR_INTERVAL_MS) {
    lastOcrTime = timestamp;
    runOcrCycle();
  }

  const splitX = pw * SPLIT_X, slotH = ph / SLOT_COUNT;
  zoomCtx.lineWidth = 2;
  for (let s = 0; s < SLOT_COUNT; s++) {
    const ok = lockedSlots[s] !== null;
    zoomCtx.strokeStyle = ok ? 'rgba(34, 197, 94, 0.85)' : 'rgba(239, 68, 68, 0.85)';
    zoomCtx.strokeRect(2, s * slotH + 2, splitX - 4, slotH - 4);
    zoomCtx.strokeStyle = ok ? 'rgba(34, 197, 94, 0.85)' : 'rgba(234, 179, 8, 0.85)';
    zoomCtx.strokeRect(splitX + 2, s * slotH + 2, pw - splitX - 4, slotH - 4);
  }

  // 큰 화면: 전체 화면 + 인식 영역 박스 (여기서 직접 드래그해서 조절)
  const fw = 960, fh = Math.round((fw * vh) / vw);
  if (frameCanvas.width !== fw || frameCanvas.height !== fh) {
    frameCanvas.width = fw; frameCanvas.height = fh;
    frameWrapper.style.aspectRatio = `${vw} / ${vh}`;
  }
  frameCtx.drawImage(gameVideo, 0, 0, fw, fh);
  const bx = box.x * fw, by = box.y * fh, bw = box.w * fw, bh = box.h * fh;
  frameCtx.fillStyle = 'rgba(0, 0, 0, 0.35)';              // 영역 밖은 어둡게
  frameCtx.beginPath();
  frameCtx.rect(0, 0, fw, fh);
  frameCtx.rect(bx, by, bw, bh);
  frameCtx.fill('evenodd');
  const fSplit = bw * SPLIT_X, fSlotH = bh / SLOT_COUNT;   // 슬롯 5칸 가이드 (인식 성공은 초록)
  frameCtx.lineWidth = 1.5;
  for (let s = 0; s < SLOT_COUNT; s++) {
    const ok = lockedSlots[s] !== null;
    frameCtx.strokeStyle = ok ? 'rgba(34, 197, 94, 0.9)' : 'rgba(239, 68, 68, 0.9)';
    frameCtx.strokeRect(bx + 1, by + s * fSlotH + 1, fSplit - 2, fSlotH - 2);
    frameCtx.strokeStyle = ok ? 'rgba(34, 197, 94, 0.9)' : 'rgba(234, 179, 8, 0.9)';
    frameCtx.strokeRect(bx + fSplit + 1, by + s * fSlotH + 1, bw - fSplit - 2, fSlotH - 2);
  }
  frameCtx.lineWidth = 2.5;
  frameCtx.strokeStyle = '#38bdf8';
  frameCtx.strokeRect(bx, by, bw, bh);
  frameCtx.fillStyle = '#38bdf8';
  frameCtx.fillRect(bx + bw - 9, by + bh - 9, 18, 18);       // 크기 조절 핸들
}

// ───────── 인식 영역 드래그 / 리사이즈 ─────────
const HANDLE = 0.03;
let dragMode = null, dragStart = null, boxStart = null;

function pointerRatio(e) {
  const r = frameCanvas.getBoundingClientRect();
  return { x: clamp((e.clientX - r.left) / r.width), y: clamp((e.clientY - r.top) / r.height) };
}
function hitMode(p) {
  if (Math.abs(p.x - (box.x + box.w)) < HANDLE && Math.abs(p.y - (box.y + box.h)) < HANDLE) return 'resize';
  if (p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h) return 'move';
  return 'draw';
}

frameCanvas.addEventListener('pointerdown', (e) => {
  if (!currentStream) return;
  const p = pointerRatio(e);
  dragMode = hitMode(p);
  dragStart = p; boxStart = { ...box };
  frameCanvas.setPointerCapture(e.pointerId);
});
frameCanvas.addEventListener('pointermove', (e) => {
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
  dragMode = null;
  invalidateOcrCache();
  saveSettings();
}));

resetRegionBtn.addEventListener('click', () => {
  box = { ...DEFAULT_BOX };
  invalidateOcrCache();
  saveSettings();
});

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
  editModalTitle.textContent = `✏️ 슬롯 ${slotIdx + 1} 부옵션 수정`;
  editStatKey.value = key;
  populateValueDropdown(key, target ? target.val : null);
  editModal.style.display = 'flex';
}

function closeModal() { editModal.style.display = 'none'; editingIndex = -1; }

modalCancelBtn.addEventListener('click', closeModal);
editModal.addEventListener('click', (e) => { if (e.target === editModal) closeModal(); });

modalClearBtn.addEventListener('click', () => {
  if (editingIndex >= 0) {
    lockedSlots[editingIndex] = null;
    pinned[editingIndex] = false;                         // 고정 해제 → 다시 OCR이 판단
    history[editingIndex] = [];
    lastRaw = null;                                       // 정지 화면에서도 즉시 재인식하도록
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
