// app.js — 명조 에코파고 v3.0: 화면 공유, 인식 영역 조정, 결과 표시, 수동 수정
// (한 줄 읽기는 ocr.js, 어느 줄을 언제 읽을지는 scan.js, 확률 계산은 math.js)
import {
  STAT_DATABASE, DEFAULT_TARGETS, GOAL_PRESETS, CUT_SCORE,
  evaluateStepTier, tierPassProb, nearestStep, makeSlot,
} from './data.js';
import { goalSuccessProb, isGoalSatisfied } from './math.js';
import { SLOT_COUNT, SPLIT_X, clamp } from './config.js';
import { initOcr, clearNameCache } from './ocr.js';
import { initScanner, scanOnce, invalidateScan, forgetRow } from './scan.js';
import { canUseOverlay, openOverlay, closeOverlay, getOverlayWindow, updateOverlay } from './overlay.js';

// ───────── 상수 ─────────
const OCR_INTERVAL_MS = 80;
const MIN_BOX = 0.04;
const VIEW_PAD = 1.8;          // 확대 보기: 큰 화면에 보이는 영역 = 인식 박스의 1.8배
const MIN_VIEW = 0.2;          // 확대 보기가 화면 대비 이 비율보다 작아지지 않게
const STORAGE_KEY = 'echopago.settings.v1';
const DEFAULT_BOX = { x: 0.129, y: 0.312, w: 0.218, h: 0.198 };   // 옵션 5줄만 딱 맞게 (왼쪽 아이콘 열 제외)
// 모바일 브라우저 등 화면 공유(getDisplayMedia)를 못 쓰는 환경 → 직접 입력 모드
let CAN_SHARE = typeof navigator.mediaDevices?.getDisplayMedia === 'function';

// ───────── 상태 ─────────
let currentStream = null;
let ocrReady = false;
let isOcrBusy = false;
let loopToken = 0;
let lastOcrTime = 0;
let lockedSlots = Array(SLOT_COUNT).fill(null);
let pinned = Array(SLOT_COUNT).fill(false);                       // 수동 수정한 슬롯은 OCR이 덮어쓰지 않음
let lastRenderSig = '';
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

// 스탯 아이콘: PNG 모양만 따서(mask) 글자색으로 칠한다 → 유효옵은 청록, 나머지는 회색
const iconUrl = (key) => `./icons/${STAT_DATABASE[key].icon}.png`;
const statIcon = (key) => `<i class="stat-icon" style="--icon:url('./icons/${STAT_DATABASE[key].icon}.png')" aria-hidden="true"></i>`;

// ───────── 설정 저장/복원 ─────────
function loadSettings() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch { return {}; }
}
function saveSettings() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      v: 3,
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
  // v3.0부터 GO 기준 기본값 5% → 4% (크크+1 최적 판단 기준). 예전 기본값 그대로인 사람만 새 기본값으로 바꾼다
  if (Number.isFinite(saved.goThreshold)) goThresholdInput.value = saved.v === undefined && saved.goThreshold === 5 ? 4 : saved.goThreshold;
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
const goalResults = {};   // 오버레이에 보낼 목표별 결과
function setGoalResult(id, html, status, prob = null) {
  goalResults[id] = {
    status,
    prob: status === 'DONE' ? 1 : prob ?? 0,
    probText: status === 'WAIT' ? '—' : status === 'DONE' ? '달성' : `${((prob ?? 0) * 100).toFixed(2)}%`,
  };
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
  if (openedCount === 0 && !currentStream) {
    const msg = CAN_SHARE ? '화면을 공유하거나, 아래 빈칸에 직접 추가해주세요.'
      : '아래 [+ 직접 추가]를 눌러 열린 옵션을 입력해주세요.';
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
  // 아직 안 연 칸은 "빈칸"으로 보여준다. 바로 다음 칸만 직접 추가 가능 (옵션은 위에서부터 차례로 열리므로)
  for (let idx = openedCount; idx < SLOT_COUNT; idx++) {
    const row = document.createElement('div');
    row.className = 'stat-item stat-item-blank';
    row.innerHTML = `<div class="stat-name"><span class="blank-no">슬롯 ${idx + 1}</span><span class="blank-label">빈칸</span></div>`;
    if (idx === openedCount) {
      row.classList.add('stat-item-add');
      row.insertAdjacentHTML('beforeend', '<span class="stat-edit-hint">+ 직접 추가</span>');
      row.addEventListener('click', () => openEditModal(idx));
    }
    statList.appendChild(row);
  }
}

function runEvaluation() {
  const ctx = evaluate();
  syncOverlay(ctx);
}

// 오버레이 창에 보낼 내용: 5칸(빈칸 포함) + 목표별 확률
function syncOverlay({ openedCount, isValid }) {
  updateOverlay({
    sharing: Boolean(currentStream),
    openedCount,
    goThreshold: getGoThreshold(),
    slots: lockedSlots.map((s) => (s ? {
      key: s.key, val: s.val, name: s.name, icon: iconUrl(s.key),
      valText: `+${s.val}${s.isPercent ? '%' : ''}`,
      tierLabel: s.tier.label, tierClass: s.tier.class, valid: isValid(s),
    } : null)),
    goals: GOAL_PRESETS.map((g) => ({ title: g.title, ...(goalResults[g.id] || { status: 'WAIT', prob: 0, probText: '—' }) })),
  });
}

function evaluate() {
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
    return { openedCount, isValid };
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
  return { openedCount, isValid };
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
    await scanOnce(ocrSnap, now);
    updateScanStatus();
  } catch (err) {
    console.error('OCR Error:', err);
  } finally {
    isOcrBusy = false;
  }
}

// ───────── 화면 공유 ─────────
startShareBtn.addEventListener('click', () => toggleShare());
async function toggleShare() {
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

  restartLoop();                                          // 미리보기는 OCR 로딩과 상관없이 바로 시작
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
}

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
  invalidateScan();
  runEvaluation();
  if (currentStream) setStatus('info', '새 에코 인식 대기 중');
}

// ───────── 렌더 루프 ─────────
function nextFrame(cb) { return (getOverlayWindow() || globalThis).requestAnimationFrame(cb); }
function renderLoop(timestamp, token) {
  if (token !== loopToken || !currentStream) return;
  if (gameVideo.videoWidth) drawFrame(timestamp);
  nextFrame((ts) => renderLoop(ts, token));
}
// 루프를 새로 건다 (오버레이를 열고 닫을 때: 어느 창의 화면 갱신에 맞출지 바뀜)
function restartLoop() {
  if (!currentStream) return;
  const token = ++loopToken;
  nextFrame((ts) => renderLoop(ts, token));
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
  invalidateScan();
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
  invalidateScan();
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
// 슬롯 직접 입력/수정 (수정 창과 오버레이가 같이 쓴다)
function setSlotManual(i, key, val) {
  if (i < 0 || i >= SLOT_COUNT || !STAT_DATABASE[key]) return;
  const { step } = nearestStep(parseFloat(val), STAT_DATABASE[key].values);
  lockedSlots[i] = makeSlot(key, step);
  pinned[i] = true;                                       // 수동 수정은 OCR이 덮어쓰지 않음 (새 에코는 '수동 초기화')
  runEvaluation();
}
function deleteSlot(i) {
  if (i < 0 || i >= SLOT_COUNT) return;
  if (currentStream) {
    lockedSlots[i] = null;
    pinned[i] = false;
    forgetRow(i);
  } else {
    lockedSlots.splice(i, 1); lockedSlots.push(null);
    pinned.splice(i, 1); pinned.push(false);
  }
  runEvaluation();
}
modalClearBtn.addEventListener('click', () => { deleteSlot(editingIndex); closeModal(); });
modalSaveBtn.addEventListener('click', () => { setSlotManual(editingIndex, editStatKey.value, editStatValue.value); closeModal(); });

// ───────── 오버레이 창 (게임 위에 뜨는 작은 판정 창) ─────────
const overlayBtn = $('overlayBtn');
function updateOverlayBtn() { overlayBtn.textContent = getOverlayWindow() ? '오버레이 닫기' : '⧉ 오버레이'; }
if (canUseOverlay() && CAN_SHARE) overlayBtn.hidden = false;
overlayBtn.addEventListener('click', async () => {
  if (getOverlayWindow()) { closeOverlay(); return; }
  try {
    await openOverlay({
      onClose: () => { updateOverlayBtn(); restartLoop(); },
      actions: { toggleShare, reset: resetCurrentEcho, setSlot: setSlotManual, deleteSlot },
      statOptions: Object.keys(STAT_DATABASE).map((key) => {
        const d = STAT_DATABASE[key];
        return { key, name: d.name, values: d.values.map((v, i) => ({ val: v, label: `+${v}${d.isPercent ? '%' : ''} [${evaluateStepTier(i + 1, d.values.length).label}]` })) };
      }),
    });
    runEvaluation();                                      // 열자마자 현재 결과를 채운다
    restartLoop();
  } catch (err) {
    console.error('오버레이 열기 실패:', err);
  }
  updateOverlayBtn();
});

// ───────── 시작 ─────────
initScanner({
  getSlots: () => lockedSlots,
  getPinned: () => pinned,
  isActive: () => Boolean(currentStream),
  onRowRead: () => { if (slotsSignature() !== lastRenderSig) runEvaluation(); },   // 한 줄 읽을 때마다 즉시 반영
});
initUI();
