// scan.js — 명조 에코파고 v3.0: 어느 줄을 언제 읽을지 정하는 부분
// 줄별 화면 변화 감지, 강화 연출(어두워짐) 대기, 읽는 순서(새로 열린 줄 우선), 오인식 보정
import { SLOT_COUNT, DEBUG } from './config.js';
import { readSlot, resetBlankCounts } from './ocr.js';

const PIXEL_CHANGE = 40;       // 지문 픽셀 밝기가 이만큼 이상 바뀌어야 "바뀐 픽셀"
const ROW_CHANGE = 0.06;       // 줄의 6% 이상 픽셀이 바뀌어야 "화면이 바뀐 줄" (배경 파티클 정도는 무시)
const SETTLE_MAX_MS = 600;     // 줄이 계속 움직여도(반짝임 등) 이 시간이 지나면 그냥 읽는다
const DIM_RATIO = 0.75;        // 옵션창 전체 밝기가 평소의 75% 아래로 떨어지면 "강화 연출로 어두워진 상태"
const DIM_MAX_MS = 2500;       // 이 시간보다 오래 어두우면 연출이 아니라 원래 화면이 바뀐 것으로 본다
const SIG_ROWS = 8;            // 줄당 지문 높이(px)

const sigCanvas = document.createElement('canvas');
sigCanvas.width = 48; sigCanvas.height = SIG_ROWS * SLOT_COUNT;
const sigCtx = sigCanvas.getContext('2d', { willReadFrequently: true });
sigCtx.imageSmoothingEnabled = true;
sigCtx.imageSmoothingQuality = 'high';   // 축소하면서 작은 파티클은 평균에 묻히게

let readSig = Array(SLOT_COUNT).fill(null);     // 줄별: 마지막으로 OCR한 순간의 화면 지문
let prevSig = Array(SLOT_COUNT).fill(null);     // 줄별: 직전 사이클의 화면 지문 (애니메이션이 멈췄는지 판단)
let prevSig2 = Array(SLOT_COUNT).fill(null);    // 줄별: 두 사이클 전 화면 지문 (천천히 나타나는 연출도 멈춘 뒤에 읽도록)
let changedAt = Array(SLOT_COUNT).fill(0);      // 줄별: 변화가 처음 감지된 시각
let pending = Array(SLOT_COUNT).fill(null);     // 줄별: 확정값과 다른 결과가 한 번 나왔을 때 그 결과 (한 번 더 나오면 교체)
let stableLum = 0;                              // 평소 옵션창 밝기 (어두워짐 감지 기준)
let dimSince = 0;                               // 어두워지기 시작한 시각

// app.js와 연결: 슬롯 배열·고정 여부는 app.js가 들고 있으므로 꺼내 쓰는 함수를 받는다
let getSlots = () => [], getPinned = () => [], isActive = () => false, onRowRead = () => {};
export function initScanner(opts) { ({ getSlots, getPinned, isActive, onRowRead } = opts); }

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
  const lockedSlots = getSlots();
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

// 한 사이클: 화면 스냅샷(src)을 보고 읽을 줄을 하나 골라 읽는다
export async function scanOnce(src, now) {
  const lockedSlots = getSlots(), pinned = getPinned();
  const sigs = slotSignatures(src);

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
    const result = await readSlot(src, i);
    if (!getPinned()[i] && isActive()) {                // 읽는 동안 수동 고정/공유 중지된 경우 무시
      readSig[i] = sigs[i];
      changedAt[i] = 0;
      applyRead(i, result);
      // 아직 안 열린 줄이 확인되면 그 아래 줄도 전부 안 열린 상태 → 읽지 않고 바로 비운다 (에코 바꿀 때 빨라짐)
      const slots = getSlots();
      if (result.kind === 'empty' && !slots[i]) {
        for (let j = i + 1; j < SLOT_COUNT; j++) {
          if (getPinned()[j]) continue;
          slots[j] = null; pending[j] = null; readSig[j] = sigs[j]; changedAt[j] = 0;
        }
      }
      onRowRead();
    }
  }
}

// 모든 줄을 다시 읽게 한다 (새 에코, 인식 영역 변경 등)
export function invalidateScan() {
  readSig = Array(SLOT_COUNT).fill(null);
  prevSig = Array(SLOT_COUNT).fill(null);
  prevSig2 = Array(SLOT_COUNT).fill(null);
  changedAt = Array(SLOT_COUNT).fill(0);
  pending = Array(SLOT_COUNT).fill(null);
  stableLum = 0;
  dimSince = 0;
  resetBlankCounts();
}

// 한 줄만 즉시 다시 읽게 한다 (수정 창에서 슬롯 비울 때)
export function forgetRow(i) { readSig[i] = null; pending[i] = null; }
