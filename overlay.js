// overlay.js — 명조 에코파고 v2.0: 게임 위에 항상 떠 있는 작은 판정 창 (크롬·엣지 PC 전용)
// "문서 화면 속 화면(Document Picture-in-Picture)" 기능으로 작은 창을 띄우고,
// 그 안에 인식된 부옵션 5칸과 목표별 확률만 간단히 보여준다.

let pipWin = null;
let lastModel = null;
let onCloseCb = () => {};

export const canUseOverlay = () => typeof window !== 'undefined' && 'documentPictureInPicture' in window;
export const getOverlayWindow = () => (pipWin && !pipWin.closed ? pipWin : null);

// 반드시 버튼 클릭 같은 사용자 동작 안에서 불러야 열린다
export async function openOverlay({ onClose } = {}) {
  if (getOverlayWindow()) { pipWin.focus(); return pipWin; }
  pipWin = await window.documentPictureInPicture.requestWindow({ width: 300, height: 420 });
  onCloseCb = onClose || (() => {});

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
  pipWin.document.body.innerHTML = '<div id="ov-root"></div>';
  pipWin.addEventListener('pagehide', () => { pipWin = null; onCloseCb(); });
  if (lastModel) renderOverlay(lastModel);
  return pipWin;
}

export function closeOverlay() { if (getOverlayWindow()) pipWin.close(); }

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * @param model {
 *   slots: [{ name, icon(상대 경로), valText, tierLabel, tierClass, valid } | null] (5칸, null = 빈칸),
 *   openedCount, goals: [{ title, status, probText, prob, note }], goThreshold (0~100)
 * }
 */
export function updateOverlay(model) {
  lastModel = model;
  if (getOverlayWindow()) renderOverlay(model);
}

function renderOverlay({ slots, openedCount, goals, goThreshold }) {
  const root = pipWin.document.getElementById('ov-root');
  if (!root) return;
  const rows = slots.map((s, i) => {
    if (!s) {
      const label = i < openedCount ? '인식 실패' : '빈칸';
      return `<div class="ov-slot ${i < openedCount ? 'is-missing' : 'is-empty'}"><span class="ov-no">${i + 1}</span><span>${label}</span></div>`;
    }
    return `<div class="ov-slot ${s.valid ? 'is-valid' : ''}">
      <span class="ov-no">${i + 1}</span>
      <i class="ov-icon" style="-webkit-mask-image:url('${new URL(s.icon, location.href).href}'); mask-image:url('${new URL(s.icon, location.href).href}')"></i>
      <span class="ov-name">${esc(s.name)}</span>
      <span class="ov-val">${esc(s.valText)}</span>
      <span class="tier-badge ${s.tierClass}">${esc(s.tierLabel)}</span>
    </div>`;
  }).join('');
  const goalRows = goals.map((g) => `
    <div class="ov-goal is-${g.status.toLowerCase()}">
      <div class="ov-goal-top">
        <span class="ov-goal-title">${esc(g.title)}</span>
        <span class="ov-goal-prob">${esc(g.probText)}</span>
        <span class="decision-badge badge-${g.status.toLowerCase()}">${{ WAIT: '대기', DONE: '성공', GO: 'GO', STOP: 'STOP' }[g.status]}</span>
      </div>
      <div class="goal-bar"><span style="width:${(Math.min(1, Math.max(0, g.prob)) * 100).toFixed(1)}%"></span><i class="goal-th" style="left:${goThreshold}%"></i></div>
    </div>`).join('');
  root.innerHTML = `<div class="ov-section">${rows}</div><div class="ov-section">${goalRows}</div>`;
}
