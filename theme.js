// 명조 에코파고 v4.0 — 테마 고르기 (기본 / 에이메스). 화면 전용, 확률·인식 로직과 무관.
// <html data-theme="...">만 바꾸고, 오버레이는 overlay.js가 이 값을 따라간다.

const KEY = 'echopago.theme.v1';
const root = document.documentElement;
const box = document.getElementById('themeSwitch');

// 에이메스 일러스트 주소 (절대 주소라서 오버레이 창에 복사해도 그대로 보임)
const art = (file) => `url("${new URL(`img/theme/${file}`, location.href).href}")`;
root.style.setProperty('--art-full', art('aemeath.png'));
root.style.setProperty('--art-head', art('aemeath-head.png'));

function apply(theme) {
  if (theme) root.dataset.theme = theme;
  else delete root.dataset.theme;
  for (const b of box.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.theme === theme));
}

box.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  apply(b.dataset.theme);
  try { b.dataset.theme ? localStorage.setItem(KEY, b.dataset.theme) : localStorage.removeItem(KEY); } catch {}
});

apply(root.dataset.theme || '');
