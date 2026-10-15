// ocr.js — 명조 에코파고 v2.0: 한 줄(옵션명 + 수치)을 읽는 부분
// 이미지 전처리 → 글자 그림 기억(지문) 확인 → 필요한 쪽만 Tesseract OCR → 옵션/수치 판정
import { SLOT_COUNT, SPLIT_X, DEBUG, clamp } from './config.js';
import { STAT_DATABASE, matchStat, isLockedRow, nameSimilarity } from './data.js';

const TARGET_SLOT_PX = 90;     // 전처리 후 슬롯 높이 목표(px)
let nameWorker = null, valueWorker = null;

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
export async function initOcr() {
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
export function clearNameCache() { nameMemory.clear(); valueMemory.clear(); }   // 인식 영역이 바뀌면 글자 모양도 바뀌므로 비운다
let blankCount = Array(SLOT_COUNT).fill(0);
export function resetBlankCounts() { blankCount = Array(SLOT_COUNT).fill(0); }

export async function readSlot(src, s) {
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
