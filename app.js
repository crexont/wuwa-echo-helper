// js/app.js
import { STAT_DATABASE, DEFAULT_TARGETS, GOAL_PRESETS } from './data.js';
import { combinations, calcSuccessProb, calcExactCritProb } from './math.js';

let currentStream = null;
let ocrWorker = null;
let isOcrBusy = false;
let lockedSlots = [null, null, null, null, null];
let autoBox = { xRatio: 0.110, yRatio: 0.320, wRatio: 0.245, hRatio: 0.200 };
let isDragging = false, dragStartX = 0, dragStartY = 0;
let editingIndex = -1;

let snapHistory = [];
let mismatchCount = 0;
const STABLE_THRESHOLD = 3;
const MISMATCH_THRESHOLD = 3;

// DOM 요소 선택
const startShareBtn = document.getElementById('startShareBtn');
const resetScanBtn = document.getElementById('resetScanBtn');
const ocrStatus = document.getElementById('ocrStatus');
const filterContainer = document.getElementById('filterContainer');
const minTierCutSelect = document.getElementById('minTierCut');
const dragWrapper = document.getElementById('dragWrapper');
const canvasPlaceholder = document.getElementById('canvasPlaceholder');
const zoomCanvas = document.getElementById('zoomCanvas');
const gameVideo = document.getElementById('gameVideo');
const statList = document.getElementById('statList');
const dashboardList = document.getElementById('dashboardList');
const stableBufferText = document.getElementById('stableBufferText');
const editModal = document.getElementById('editModal');
const editStatKey = document.getElementById('editStatKey');
const editStatValue = document.getElementById('editStatValue');
const modalCancelBtn = document.getElementById('modalCancelBtn');
const modalSaveBtn = document.getElementById('modalSaveBtn');
const toggleTableBtn = document.getElementById('toggleTableBtn');
const probTableBox = document.getElementById('probTableBox');
const tableArrow = document.getElementById('tableArrow');

// UI 초기화 함수
function initUI() {
  Object.keys(STAT_DATABASE).forEach(key => {
    const isChecked = DEFAULT_TARGETS.includes(key);
    const label = document.createElement('label');
    label.className = 'filter-chip';
    label.innerHTML = `<input type="checkbox" value="${key}" ${isChecked ? 'checked' : ''}> ${STAT_DATABASE[key].name}`;
    label.querySelector('input').addEventListener('change', runEvaluation);
    filterContainer.appendChild(label);
  });

  dashboardList.innerHTML = '';
  GOAL_PRESETS.forEach(goal => {
    const card = document.createElement('div');
    card.className = 'goal-card';
    card.id = `goal-card-${goal.id}`;
    card.innerHTML = `
      <div class="goal-title">${goal.title}</div>
      <div class="goal-info">
        <div class="goal-prob" id="prob-${goal.id}">대기 중...</div>
        <div class="decision-badge badge-wait" id="badge-${goal.id}">-</div>
      </div>
    `;
    dashboardList.appendChild(card);
  });

  Object.keys(STAT_DATABASE).forEach(key => {
    const opt = document.createElement('option');
    opt.value = key; opt.textContent = STAT_DATABASE[key].name;
    editStatKey.appendChild(opt);
  });
  editStatKey.addEventListener('change', () => populateValueDropdown(editStatKey.value));
  runEvaluation();
}

// 확률 평가 및 UI 업데이트 로직
function runEvaluation() {
  const selectedTargets = Array.from(filterContainer.querySelectorAll('input:checked')).map(cb => cb.value);
  const minTierCut = minTierCutSelect.value;
  const cutScore = { "low": 1, "mid": 2, "high": 3 }[minTierCut];
  const activeStats = lockedSlots.filter(s => s !== null);
  
  statList.innerHTML = '';
  let validList = [];
  
  if (activeStats.length === 0) {
    statList.innerHTML = '<div style="color: #475569; font-size: 13px; text-align: center; margin-top: 16px; padding-bottom: 8px;">0강 상태 (강화 후 데이터 대기 중)</div>';
  } else {
    activeStats.forEach((stat, idx) => {
      const isValid = selectedTargets.includes(stat.key) && stat.tier.score >= cutScore;
      if (isValid) validList.push(stat.key);
      const row = document.createElement('div');
      row.className = 'stat-item';
      row.innerHTML = `
        <div>
          <span>${stat.name}</span> 
          <span style="color:#94a3b8; font-size:12px; margin-left:6px;">+${stat.val}${stat.isPercent ? '%' : ''}</span>
          ${isValid ? '<span class="valid-mark">★ 유효</span>' : ''}
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          <span class="tier-badge ${stat.tier.class}">${stat.tier.label}</span>
          <span style="font-size:12px; color:#64748b; margin-left:4px;">✏️ 수정</span>
        </div>
      `;
      row.addEventListener('click', () => openEditModal(idx));
      statList.appendChild(row);
    });
  }

  const openedCount = activeStats.length;
  const remainingSlots = 5 - openedCount;
  const poolLeft = Math.max(1, 13 - openedCount);
  const critCount = (validList.includes("크확") ? 1 : 0) + (validList.includes("크피") ? 1 : 0);
  const otherValidCount = validList.filter(k => k !== "크확" && k !== "크피").length;
  const qualityMultiplier = minTierCut === "high" ? 0.06 : (minTierCut === "mid" ? 0.55 : 1.0);

  GOAL_PRESETS.forEach(goal => {
    let prob = 0, status = 'WAIT', probText = '';
    if (openedCount === 0) {
      probText = '강화 전 시뮬레이션 대기 중';
    } else {
      if (goal.type === 'crit') {
        const neededCrit = Math.max(0, 2 - critCount);
        const neededSub = Math.max(0, goal.req - otherValidCount);
        if (neededCrit === 0 && neededSub === 0) { status = 'DONE'; probText = '목표 스펙 달성 완료!'; }
        else if (neededCrit > remainingSlots || neededCrit + neededSub > remainingSlots) { status = 'STOP'; probText = '수학적 달성 불가'; }
        else {
          const subPoolLeft = selectedTargets.filter(t => t !== "크확" && t !== "크피").filter(t => !activeStats.some(s => s.key === t)).length;
          prob = calcExactCritProb(poolLeft, neededCrit, subPoolLeft, neededSub, remainingSlots) * Math.pow(qualityMultiplier, neededCrit + neededSub);
        }
      } else {
        const totalNeeded = goal.req - validList.length;
        if (totalNeeded <= 0) { status = 'DONE'; probText = '목표 스펙 달성 완료!'; }
        else if (totalNeeded > remainingSlots) { status = 'STOP'; probText = '수학적 달성 불가'; }
        else {
          const validLeft = selectedTargets.filter(t => !activeStats.some(s => s.key === t)).length;
          prob = calcSuccessProb(poolLeft, validLeft, remainingSlots, totalNeeded) * Math.pow(qualityMultiplier, totalNeeded);
        }
      }
      if (status !== 'DONE' && status !== 'STOP') {
        probText = `최종 완성 확률: <strong>${(prob * 100).toFixed(2)}%</strong>`;
        status = (openedCount === 1 && prob === 0) || prob < 0.05 ? 'STOP' : 'GO';
      }
    }
    document.getElementById(`prob-${goal.id}`).innerHTML = probText;
    document.getElementById(`badge-${goal.id}`).className = `decision-badge badge-${status.toLowerCase()}`;
    document.getElementById(`badge-${goal.id}`).innerText = status === 'WAIT' ? '대기 중' : status === 'DONE' ? '성공 (완주)' : status === 'GO' ? 'GO (강화 추천)' : 'STOP (즉시 손절)';
  });
}

// OCR 전처리 로직
function preprocessForOCR(sourceCanvas) {
  const scale = 2.5; 
  const pad = 12;
  const targetW = Math.round(sourceCanvas.width * scale) + pad * 2;
  const targetH = Math.round(sourceCanvas.height * scale) + pad * 2;

  const pCanvas = document.createElement('canvas');
  pCanvas.width = targetW;
  pCanvas.height = targetH;
  const pCtx = pCanvas.getContext('2d', { willReadFrequently: true });

  pCtx.fillStyle = '#FFFFFF';
  pCtx.fillRect(0, 0, targetW, targetH);
  pCtx.imageSmoothingEnabled = true;
  pCtx.imageSmoothingQuality = 'high';
  pCtx.drawImage(sourceCanvas, pad, pad, sourceCanvas.width * scale, sourceCanvas.height * scale);

  const imgData = pCtx.getImageData(0, 0, targetW, targetH);
  const d = imgData.data;

  for (let i = 0; i < d.length; i += 4) {
    const luma = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
    const color = luma > 140 ? 0 : 255;
    d[i] = color; 
    d[i+1] = color; 
    d[i+2] = color;
  }
  pCtx.putImageData(imgData, 0, 0);
  return pCanvas;
}

// 부옵션 단계 및 수치 평가
function evaluateStepTier(step, totalSteps) {
  if (totalSteps === 8) return step >= 7 ? { label: `상옵`, class: "tier-high", score: 3 } : step >= 4 ? { label: `중옵`, class: "tier-mid", score: 2 } : { label: `하옵`, class: "tier-low", score: 1 };
  return step === 4 ? { label: `상옵`, class: "tier-high", score: 3 } : step >= 2 ? { label: `중옵`, class: "tier-mid", score: 2 } : { label: `하옵`, class: "tier-low", score: 1 };
}

function matchExactStep(val, values) {
  let closestIdx = 0, minDiff = Math.abs(val - values[0]);
  for (let i = 1; i < values.length; i++) {
    if (Math.abs(val - values[i]) < minDiff) { minDiff = Math.abs(val - values[i]); closestIdx = i; }
  }
  return { step: closestIdx + 1, totalSteps: values.length, exactVal: values[closestIdx] };
}

// OCR 인식 로직
async function processSlots(cleanCanvas) {
  if (!ocrWorker) return;
  isOcrBusy = true;
  const slotH = cleanCanvas.height / 5;
  const splitX = cleanCanvas.width * 0.80;
  const currentRawResults = [];

  try {
    for (let s = 0; s < 5; s++) {
      if (lockedSlots[s] !== null && s > 0) { currentRawResults.push(lockedSlots[s]); continue; }

      const rawLeft = document.createElement('canvas');
      rawLeft.width = splitX; rawLeft.height = slotH;
      rawLeft.getContext('2d').drawImage(cleanCanvas, 0, s * slotH, splitX, slotH, 0, 0, splitX, slotH);

      const rawRight = document.createElement('canvas');
      rawRight.width = cleanCanvas.width - splitX; rawRight.height = slotH;
      rawRight.getContext('2d').drawImage(cleanCanvas, splitX, s * slotH, rawRight.width, slotH, 0, 0, rawRight.width, slotH);

      const leftProcessed = preprocessForOCR(rawLeft);
      const rightProcessed = preprocessForOCR(rawRight);

      const [leftRet, rightRet] = await Promise.all([ ocrWorker.recognize(leftProcessed), ocrWorker.recognize(rightProcessed) ]);

      const nameStr = leftRet.data.text.replace(/[^가-힣a-zA-Z]/g, ''); 
      const valStr = rightRet.data.text.replace(/\s+/g, '').replace(/,/g, '.');
      const numMatch = valStr.match(/(\d+(\.\d+)?)/);

      if (!numMatch || nameStr.length < 1) { currentRawResults.push(null); continue; }

      const val = parseFloat(numMatch[1]);
      let isFlat = false;
      if (valStr.includes('%')) isFlat = false;
      else if (val >= 25.0 && val <= 75.0) isFlat = true;
      else if (val >= 250.0) isFlat = true;

      const hasPercent = !isFlat;
      let matched = null;

      for (const [key, data] of Object.entries(STAT_DATABASE)) {
        if (data.isPercent !== hasPercent) continue;
        if (data.notRegex && data.notRegex.test(nameStr)) continue;

        if (data.matchRegex.test(nameStr)) {
          const stepInfo = matchExactStep(val, data.values);
          const tier = evaluateStepTier(stepInfo.step, stepInfo.totalSteps);
          matched = { key, name: data.name, val: stepInfo.exactVal, isPercent: data.isPercent, tier };
          break;
        }
      }
      currentRawResults.push(matched);
    }

    if (lockedSlots[0] && (!currentRawResults[0] || lockedSlots[0].key !== currentRawResults[0].key || lockedSlots[0].val !== currentRawResults[0].val)) {
      if (++mismatchCount >= MISMATCH_THRESHOLD) return resetCurrentEcho();
    } else mismatchCount = 0;

    snapHistory.push({ snap: JSON.stringify(currentRawResults.map(r => r ? r.key + r.val : '')), results: currentRawResults, count: currentRawResults.filter(Boolean).length });
    if (snapHistory.length > 5) snapHistory.shift(); 

    let bestSnap = null, maxCount = 0;
    const counts = {};
    snapHistory.forEach(item => {
      if (item.count > 0) {
        counts[item.snap] = (counts[item.snap] || 0) + 1;
        if (counts[item.snap] > maxCount) { maxCount = counts[item.snap]; bestSnap = item; }
      }
    });

    stableBufferText.innerText = `${maxCount}/${STABLE_THRESHOLD}`;

    if (maxCount >= STABLE_THRESHOLD && bestSnap) {
      lockedSlots = [...bestSnap.results];
      runEvaluation();
      ocrStatus.innerHTML = `<span style="color:#4ade80;">🔒 ${lockedSlots.filter(Boolean).length}개 부옵션 인식 완료</span>`;
    }
  } catch (err) { console.error("OCR Error:", err); } finally { isOcrBusy = false; }
}

// 화면 공유 시작 이벤트
startShareBtn.addEventListener('click', async () => {
  if (currentStream) return stopScreenShare();
  try {
    currentStream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15, max: 15 } }, audio: false });
    currentStream.getVideoTracks()[0].onended = stopScreenShare;
    gameVideo.srcObject = currentStream;
    startShareBtn.innerHTML = '⏹ 공유 중지'; startShareBtn.classList.add('btn-stop'); canvasPlaceholder.style.display = 'none';
    ocrStatus.innerHTML = '<span style="color:#fde047;">⏳ OCR 엔진 로드 중...</span>';
    if (!ocrWorker) { ocrWorker = await Tesseract.createWorker('kor+eng'); await ocrWorker.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.SINGLE_LINE }); }
    ocrStatus.innerHTML = '<span style="color:#4ade80;">🟢 실시간 감시 중</span>';
    requestAnimationFrame(renderLoop);
  } catch (err) { stopScreenShare(); }
});

// 화면 공유 중지 로직
function stopScreenShare() {
  if (currentStream) { currentStream.getTracks().forEach(t => t.stop()); currentStream = null; }
  gameVideo.srcObject = null; startShareBtn.innerHTML = '화면 공유 시작'; startShareBtn.classList.remove('btn-stop');
  canvasPlaceholder.style.display = 'block'; ocrStatus.innerHTML = '<span>⚙️</span> 화면 공유 중지됨';
  resetCurrentEcho();
}

function resetCurrentEcho() {
  lockedSlots = [null, null, null, null, null]; snapHistory = []; mismatchCount = 0; runEvaluation();
  ocrStatus.innerHTML = '<span style="color:#38bdf8;">🔄 새 에코 인식 대기중</span>'; stableBufferText.innerText = `0/3`;
}

// 드래그 앤 드롭 로직
dragWrapper.addEventListener('mousedown', (e) => { isDragging = true; dragStartX = e.clientX; dragStartY = e.clientY; });
window.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  autoBox.xRatio = Math.max(0, Math.min(1 - autoBox.wRatio, autoBox.xRatio + (e.clientX - dragStartX) / 800));
  autoBox.yRatio = Math.max(0, Math.min(1 - autoBox.hRatio, autoBox.yRatio + (e.clientY - dragStartY) / 450));
  dragStartX = e.clientX; dragStartY = e.clientY;
});
window.addEventListener('mouseup', () => { isDragging = false; });

// 렌더링 루프
let lastOcrTime = 0;
function renderLoop(timestamp) {
  if (!currentStream || !gameVideo.videoWidth) return requestAnimationFrame(renderLoop);
  const ctx = zoomCanvas.getContext('2d', { willReadFrequently: true });
  const vw = gameVideo.videoWidth, vh = gameVideo.videoHeight;
  ctx.drawImage(gameVideo, autoBox.xRatio * vw, autoBox.yRatio * vh, autoBox.wRatio * vw, autoBox.hRatio * vh, 0, 0, zoomCanvas.width, zoomCanvas.height);
  
  if (!isOcrBusy && (timestamp - lastOcrTime > 250)) {
    lastOcrTime = timestamp;
    const cleanCanvas = document.createElement('canvas');
    cleanCanvas.width = zoomCanvas.width; cleanCanvas.height = zoomCanvas.height;
    cleanCanvas.getContext('2d').drawImage(zoomCanvas, 0, 0);
    processSlots(cleanCanvas);
  }
  
  const splitX = zoomCanvas.width * 0.80, slotH = zoomCanvas.height / 5;
  ctx.lineWidth = 2;
  for (let s = 0; s < 5; s++) {
    ctx.strokeStyle = lockedSlots[s] !== null ? 'rgba(34, 197, 94, 0.85)' : 'rgba(239, 68, 68, 0.85)';
    ctx.strokeRect(2, s * slotH + 2, splitX - 4, slotH - 4);
    ctx.strokeStyle = lockedSlots[s] !== null ? 'rgba(34, 197, 94, 0.85)' : 'rgba(234, 179, 8, 0.85)';
    ctx.strokeRect(splitX + 2, s * slotH + 2, zoomCanvas.width - splitX - 4, slotH - 4);
  }
  requestAnimationFrame(renderLoop);
}

// 이벤트 리스너 등록
minTierCutSelect.addEventListener('change', runEvaluation);
resetScanBtn.addEventListener('click', resetCurrentEcho);

toggleTableBtn.addEventListener('click', () => {
  probTableBox.style.display = probTableBox.style.display === 'block' ? 'none' : 'block';
  tableArrow.textContent = probTableBox.style.display === 'block' ? '▲ 닫기' : '▼ 열기';
});

// 수정 모달 관련 로직
function populateValueDropdown(statKey, selectedVal = null) {
  editStatValue.innerHTML = '';
  STAT_DATABASE[statKey].values.forEach((v, idx) => {
    const opt = document.createElement('option'); opt.value = v;
    opt.textContent = `+${v}${STAT_DATABASE[statKey].isPercent ? '%' : ''} [${evaluateStepTier(idx + 1, STAT_DATABASE[statKey].values.length).label}]`;
    if (v === selectedVal) opt.selected = true;
    editStatValue.appendChild(opt);
  });
}

function openEditModal(activeIdx) {
  editingIndex = activeIdx;
  const target = lockedSlots.filter(s => s !== null)[activeIdx];
  editStatKey.value = target.key; populateValueDropdown(target.key, target.val);
  editModal.style.display = 'flex';
}

modalCancelBtn.addEventListener('click', () => { editModal.style.display = 'none'; });
modalSaveBtn.addEventListener('click', () => {
  let activeIndices = [];
  lockedSlots.forEach((s, idx) => { if (s !== null) activeIndices.push(idx); });
  if (editingIndex >= 0 && editingIndex < activeIndices.length) {
    const key = editStatKey.value, val = parseFloat(editStatValue.value), data = STAT_DATABASE[key];
    const stepInfo = matchExactStep(val, data.values);
    lockedSlots[activeIndices[editingIndex]] = { key: key, name: data.name, val: stepInfo.exactVal, isPercent: data.isPercent, tier: evaluateStepTier(stepInfo.step, stepInfo.totalSteps) };
    runEvaluation();
  }
  editModal.style.display = 'none';
});

// 초기화 실행
initUI();