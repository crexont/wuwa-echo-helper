// overlay.js — 명조 에코파고 v3.0: 게임 위에 항상 떠 있는 작은 판정 창 (크롬·엣지 PC 전용)
// "문서 화면 속 화면(Document Picture-in-Picture)" 기능으로 작은 창을 띄운다.
// 창 안에서: 화면 공유 시작/중지, 초기화, 부옵션 5칸(직접 추가·수정·삭제), 목표별 확률

let pipWin = null;
let lastModel = null;
let onCloseCb = () => {};
let actions = {};           // app.js가 넘겨주는 동작들 { toggleShare, reset, setSlot, deleteSlot }
let statOptions = [];       // [{ key, name, values: [{ val, label }] }]
let editing = null;         // 편집 중인 칸 { idx, key, val } (없으면 null)

export const canUseOverlay = () => typeof window !== 'undefined' && 'documentPictureInPicture' in window;
export const getOverlayWindow = () => (pipWin && !pipWin.closed ? pipWin : null);

// 반드시 버튼 클릭 같은 사용자 동작 안에서 불러야 열린다
export async function openOverlay({ onClose, actions: acts = {}, statOptions: opts = [] } = {}) {
  if (getOverlayWindow()) { pipWin.focus(); return pipWin; }
  pipWin = await window.documentPictureInPicture.requestWindow({ width: 300, height: 540 });
  onCloseCb = onClose || (() => {});
  actions = acts;
  statOptions = opts;
  editing = null;

  // 본 페이지의 스타일(폰트·색)을 그대로 가져온다: 같은 사이트 CSS는 내용을 복사, 외부 폰트 CSS는 링크로
  for (const sheet of document.styleSheets) {
    try {
      const style = pipWin.document.createElement('style');
      style.textContent = [...sheet.cssRules].map((r) => r.cssText).join('\n');
      pipWin.document.head.appendChild(style);
    } catch {
      if (!sheet.href) continue;
      const link = pipWin.document.createElement('link');
      link.rel = 'stylesheet'; link.href = sheet.href;
      pipWin.document.head.appendChild(link);
    }
  }
  pipWin.document.title = '에코파고';
  pipWin.document.body.className = 'ov-body';
  // 칸마다 따로 그려서, 결과가 바뀌어도 편집 중인 입력칸은 그대로 둔다
  pipWin.document.body.innerHTML = `
    <div id="ov-controls" class="ov-controls"></div>
    <div id="ov-slots" class="ov-section"></div>
    <div id="ov-editor"></div>
    <div id="ov-goals" class="ov-section"></div>`;
  pipWin.document.body.addEventListener('click', onClick);
  pipWin.document.body.addEventListener('change', onChange);
  pipWin.addEventListener('pagehide', () => { pipWin = null; editing = null; onCloseCb(); });
  if (lastModel) renderOverlay(lastModel);
  renderEditor();
  return pipWin;
}

export function closeOverlay() { if (getOverlayWindow()) pipWin.close(); }

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const $ = (id) => pipWin.document.getElementById(id);

/**
 * @param model {
 *   sharing, openedCount,
 *   slots: [{ key, val, name, icon(상대 경로), valText, tierLabel, tierClass, valid } | null] (5칸, null = 빈칸),
 *   goals: [{ title, status, probText, prob }]
 * }
 */
export function updateOverlay(model) {
  lastModel = model;
  if (getOverlayWindow()) renderOverlay(model);
}

function renderOverlay({ sharing, slots, openedCount, goals }) {
  if (!$('ov-slots')) return;
  $('ov-controls').innerHTML = `
    <button type="button" data-act="share" class="ov-btn ${sharing ? 'is-stop' : 'is-primary'}">${sharing ? '공유 중지' : '화면 공유 시작'}</button>
    <button type="button" data-act="reset" class="ov-btn">초기화</button>`;

  const filled = slots.filter(Boolean).length;
  $('ov-slots').innerHTML = `<div class="ov-head"><span>부옵션</span><span class="ov-count">${filled}/${slots.length}</span></div>` + slots.map((s, i) => {
    const sel = editing && editing.idx === i ? ' is-editing' : '';
    if (!s) {
      if (i === openedCount) {
        return `<div class="ov-slot is-empty is-next${sel}" data-act="edit" data-idx="${i}"><span class="ov-no">${i + 1}</span><span>빈칸</span><span class="ov-add">+ 추가</span></div>`;
      }
      const missing = i < openedCount;
      return `<div class="ov-slot ${missing ? 'is-missing' : 'is-empty'}${sel}" ${missing ? `data-act="edit" data-idx="${i}"` : ''}><span class="ov-no">${i + 1}</span><span>${missing ? '인식 실패' : '빈칸'}</span></div>`;
    }
    const icon = new URL(s.icon, location.href).href;
    return `<div class="ov-slot ${s.valid ? 'is-valid' : ''}${sel}" data-act="edit" data-idx="${i}">
      <span class="ov-no">${i + 1}</span>
      <i class="ov-icon" style="-webkit-mask-image:url('${icon}'); mask-image:url('${icon}')"></i>
      <span class="ov-name">${esc(s.name)}</span>
      <span class="ov-val">${esc(s.valText)}</span>
      <span class="tier-badge ${s.tierClass}">${esc(s.tierLabel)}</span>
    </div>`;
  }).join('');

  $('ov-goals').innerHTML = '<div class="ov-head"><span>목표별 완성 확률</span></div>' + goals.map((g) => `
    <div class="ov-goal is-${g.status.toLowerCase()}">
      <div class="ov-goal-top">
        <span class="ov-goal-title">${esc(g.title)}</span>
        <span class="ov-goal-prob">${esc(g.probText)}</span>
        <span class="decision-badge badge-${g.status.toLowerCase()}">${{ WAIT: '대기', DONE: '성공', GO: 'GO', STOP: 'STOP' }[g.status]}</span>
      </div>
      <div class="goal-bar"><span style="width:${(Math.min(1, Math.max(0, g.prob)) * 100).toFixed(1)}%"></span></div>
    </div>`).join('');
}

// 편집 칸: 옵션 종류 / 수치 선택 + 적용·삭제·취소
function renderEditor() {
  const box = $('ov-editor');
  if (!box) return;
  if (!editing) { box.innerHTML = ''; box.className = ''; return; }
  const opt = statOptions.find((o) => o.key === editing.key) || statOptions[0];
  const hasSlot = Boolean(lastModel && lastModel.slots[editing.idx]);
  box.className = 'ov-editor';
  box.innerHTML = `
    <div class="ov-editor-title">슬롯 ${editing.idx + 1} ${hasSlot ? '수정' : '추가'}</div>
    <select data-field="key">${statOptions.map((o) => `<option value="${o.key}" ${o.key === opt.key ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select>
    <select data-field="val">${opt.values.map((v) => `<option value="${v.val}" ${Number(v.val) === Number(editing.val) ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select>
    <div class="ov-editor-btns">
      ${hasSlot ? '<button type="button" data-act="delete" class="ov-btn is-danger">삭제</button>' : ''}
      <button type="button" data-act="cancel" class="ov-btn">취소</button>
      <button type="button" data-act="save" class="ov-btn is-primary">적용</button>
    </div>`;
}

function onClick(e) {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  if (act === 'share') actions.toggleShare?.();
  else if (act === 'reset') { editing = null; renderEditor(); actions.reset?.(); }
  else if (act === 'edit') {
    const idx = Number(el.dataset.idx);
    const s = lastModel?.slots[idx];
    const key = s ? s.key : statOptions[0]?.key;
    const val = s ? s.val : statOptions.find((o) => o.key === key)?.values[0]?.val;
    editing = editing && editing.idx === idx ? null : { idx, key, val };   // 같은 칸을 다시 누르면 닫기
    renderEditor();
    if (lastModel) renderOverlay(lastModel);
  } else if (act === 'cancel') { editing = null; renderEditor(); if (lastModel) renderOverlay(lastModel); }
  else if (act === 'save' && editing) {
    const { idx, key, val } = editing;
    editing = null; renderEditor();
    actions.setSlot?.(idx, key, val);
  } else if (act === 'delete' && editing) {
    const { idx } = editing;
    editing = null; renderEditor();
    actions.deleteSlot?.(idx);
  }
}

function onChange(e) {
  if (!editing) return;
  const field = e.target.dataset.field;
  if (field === 'key') {
    editing.key = e.target.value;
    editing.val = statOptions.find((o) => o.key === editing.key)?.values[0]?.val;
    renderEditor();                                   // 수치 목록을 새 옵션에 맞게 다시 그림
  } else if (field === 'val') {
    editing.val = e.target.value;
  }
}
