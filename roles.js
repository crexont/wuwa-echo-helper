// roles.js — 명조 에코파고 v4.0: 공명자 선택
// 캐릭터를 고르면 그 캐릭터의 유효옵으로 체크박스를 바꾸고, 오른쪽에 일러스트 카드를 띄운다.
// app.js는 건드리지 않는다: 유효옵 체크박스를 대신 눌러서(change 이벤트) 기존 저장·계산 흐름을 그대로 탄다.
// 메인 화면에는 고른 캐릭터 + 최근 고른 캐릭터만 보이고, 나머지는 [전체 공명자] 창에서 검색·속성별로 고른다.
import { STAT_DATABASE } from './data.js';
import { PRESETS } from './presets.js';

const ROLE_KEY = 'echopago.role.v1';
const RECENT_KEY = 'echopago.roleRecent.v1';
const RECENT_MAX = 5;

// icon: icons/elements/<icon>.png (게임 속성 아이콘, 흰색 → CSS로 속성 색을 입힌다)
export const ELEMENTS = [
  { id: '용융', color: '#f0744e', icon: 'fusion' },
  { id: '응결', color: '#41aefb', icon: 'glacio' },
  { id: '전도', color: '#b46bff', icon: 'electro' },
  { id: '기류', color: '#55ffb5', icon: 'aero' },
  { id: '회절', color: '#f8e56c', icon: 'spectro' },
  { id: '인멸', color: '#e649a6', icon: 'havoc' },
];
const elementOf = (id) => ELEMENTS.find((e) => e.id === id);
const elementColor = (id) => elementOf(id)?.color ?? '#74767e';
const elementIcon = (id) => `<i class="el-icon" style="--el:${elementColor(id)};--icon:url('./icons/elements/${elementOf(id)?.icon}.png')" title="${id}" aria-label="${id}"></i>`;
const elementIcons = (role) => role.elements.map(elementIcon).join('');

// presets.js에 없는 캐릭터는 이 기본값을 쓴다
const FALLBACK_TARGETS = ['크확', '크피', '공%'];

// 최신 출시순. 이름·속성은 게임 텍스트(3.1)와 출시 이후 캐릭터 목록에서 가져왔다. 방랑자는 속성마다 따로 두고 같은 그림(img)을 쓴다.
// 캐릭터별 유효옵은 presets.js에 따로 있다.
export const ROLES = [
  { id: 'suoming',    name: '쇄명', elements: ['전도'] },
  { id: 'xin',        name: '여우의 별자리', elements: ['전도'] },
  { id: 'jingran',    name: '경연', elements: ['용융'] },
  { id: 'qingxiao',   name: '청초', elements: ['기류'] },
  { id: 'suisui',     name: '수수', elements: ['응결'] },
  { id: 'rover-electro', name: '방랑자 · 전도', elements: ['전도'], img: 'rover' },
  { id: 'xuanling',   name: '양양 · 현령', elements: ['인멸'] },
  { id: 'luosela',    name: '루실라', elements: ['응결'] },
  { id: 'luxi',       name: '루시', elements: ['회절'] },
  { id: 'libeika',    name: '레베카', elements: ['전도'] },
  { id: 'daniya',     name: '데니아', elements: ['용융'] },
  { id: 'feixue',     name: '히유키', elements: ['응결'] },
  { id: 'xigelika',   name: '시그리카', elements: ['기류'] },
  { id: 'luhesi',     name: '루크 · 헤르센', elements: ['회절'] },
  { id: 'aimisi',     name: '에이메스', elements: ['용융'] },
  { id: 'moning',     name: '모니에', elements: ['용융'] },
  { id: 'linnai',     name: '린네', elements: ['회절'] },
  { id: 'buling',     name: '복링', elements: ['전도'] },
  { id: 'qianxiao',   name: '치사', elements: ['인멸'] },
  { id: 'qiuyuan',    name: '구원', elements: ['기류'] },
  { id: 'jiabeilina', name: '갈브레나', elements: ['용융'] },
  { id: 'younuo',     name: '유노', elements: ['기류'] },
  { id: 'aogusita',   name: '아우구스타', elements: ['전도'] },
  { id: 'fuluoluo',   name: '플로로', elements: ['인멸'] },
  { id: 'lupa',       name: '루파', elements: ['용융'] },
  { id: 'rover-aero', name: '방랑자 · 기류', elements: ['기류'], img: 'rover' },
  { id: 'katixiya',   name: '카르티시아', elements: ['기류'] },
  { id: 'xiakong',    name: '샤콘', elements: ['기류'] },
  { id: 'zanni',      name: '젠니', elements: ['회절'] },
  { id: 'kanteleila', name: '칸타렐라', elements: ['인멸'] },
  { id: 'bulante',    name: '브렌트', elements: ['용융'] },
  { id: 'feibi',      name: '페비', elements: ['회절'] },
  { id: 'luokeke',    name: '로코코', elements: ['인멸'] },
  { id: 'kelaita',    name: '카를로타', elements: ['응결'] },
  { id: 'dengdeng',   name: '루미', elements: ['전도'] },
  { id: 'chun',       name: '카멜리아', elements: ['인멸'] },
  { id: 'youhu',      name: '유호', elements: ['응결'] },
  { id: 'shouanren',  name: '파수인', elements: ['회절'] },
  { id: 'xiangliyao', name: '상리요', elements: ['전도'] },
  { id: 'zhezhi',     name: '절지', elements: ['응결'] },
  { id: 'changli',    name: '장리', elements: ['용융'] },
  { id: 'jinxi',      name: '금희', elements: ['회절'] },
  { id: 'yinlin',     name: '음림', elements: ['전도'] },
  { id: 'jiyan',      name: '기염', elements: ['기류'] },
  { id: 'yuanwu',     name: '연무', elements: ['전도'] },
  { id: 'kakaluo',    name: '카카루', elements: ['전도'] },
  { id: 'lingyang',   name: '능양', elements: ['응결'] },
  { id: 'danjin',     name: '단근', elements: ['인멸'] },
  { id: 'sanhua',     name: '산화', elements: ['응결'] },
  { id: 'jianxin',    name: '감심', elements: ['기류'] },
  { id: 'jueyuan',    name: '벨리나', elements: ['회절'] },
  { id: 'mofeite',    name: '모르테피', elements: ['용융'] },
  { id: 'anke',       name: '앙코', elements: ['용융'] },
  { id: 'taoqi',      name: '도기', elements: ['인멸'] },
  { id: 'qiushui',    name: '알토', elements: ['기류'] },
  { id: 'baizhi',     name: '설지', elements: ['응결'] },
  { id: 'yangyang',   name: '양양', elements: ['기류'] },
  { id: 'zhixia',     name: '치샤', elements: ['용융'] },
  { id: 'rover-havoc', name: '방랑자 · 인멸', elements: ['인멸'], img: 'rover' },
  { id: 'rover-spectro', name: '방랑자 · 회절', elements: ['회절'], img: 'rover' },
];
const findRole = (id) => ROLES.find((r) => r.id === id) || null;
const targetsOf = (role) => PRESETS[role.id] ?? FALLBACK_TARGETS;

const faceUrl = (role) => `./img/roles/face/${role.img ?? role.id}.jpg`;  // 얼굴 타일용 (게임 얼굴 아이콘)

const $ = (id) => document.getElementById(id);
const section = $('roleSection');
const strip = $('roleStrip');
const roleNote = $('roleNote');
const filterContainer = $('filterContainer');
const modal = $('roleModal');
const modalGrid = $('roleModalGrid');
const modalTabs = $('roleModalTabs');
const searchInput = $('roleSearch');
const roleTargets = $('roleTargets');

let currentId = null;
let applying = false;   // 우리가 체크박스를 바꾸는 중에는 "직접 수정" 표시를 하지 않는다
let elementFilter = '';

// ───────── 저장 ─────────
const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, v) { try { v == null ? localStorage.removeItem(key) : localStorage.setItem(key, v); } catch { /* 무시 */ } },
};
function loadRecent() {
  try { const a = JSON.parse(store.get(RECENT_KEY)); return Array.isArray(a) ? a.filter(findRole) : []; } catch { return []; }
}
function pushRecent(id) {
  const list = [id, ...loadRecent().filter((x) => x !== id)].slice(0, RECENT_MAX);
  store.set(RECENT_KEY, JSON.stringify(list));
}

// ───────── 추천 유효옵 줄 (얼굴 줄 바로 아래) ─────────
function showTargets(role) {
  roleTargets.hidden = !role;
  if (!role) return;
  const names = targetsOf(role).map((k) => STAT_DATABASE[k]?.name ?? k);
  roleTargets.innerHTML = `${elementIcons(role)}<strong>${role.name}</strong> 추천 유효옵${PRESETS[role.id] ? '' : '(기본값)'}: <span>${names.join(' · ')}</span>`;
  roleTargets.style.setProperty('--el', elementColor(role.elements[0]));
}

function setNote(text) { roleNote.textContent = text; }

// 유효옵에 크확·크피가 있으면 딜러(크크 목표), 없으면 서포터(서포터 목표)를 강조한다.
// app.js가 목표 카드의 class를 매번 덮어쓰므로 카드가 아니라 목록(#dashboardList)에 표시를 단다.
const isSupport = (role) => !targetsOf(role).some((k) => k === '크확' || k === '크피');
function setGoalFocus(role) {
  const list = $('dashboardList');
  if (!list) return;
  if (role) list.dataset.focus = isSupport(role) ? 'free' : 'crit';
  else delete list.dataset.focus;
}

// 공명자 테마: 고른 공명자를 <html data-role>에 달면 style.css가 색을 바꾼다.
// 일러스트(img/theme/<id>.png)가 있는 공명자만 --art-full을 넣는다 (오버레이에서도 보이게 절대 주소)
const THEMED = new Set(['aimisi']);
function setTheme(role) {
  const root = document.documentElement;
  if (role) root.dataset.role = role.id;
  else delete root.dataset.role;
  if (role && THEMED.has(role.id)) root.style.setProperty('--art-full', `url("${new URL(`img/theme/${role.id}.png`, location.href).href}")`);
  else root.style.removeProperty('--art-full');
}

// 얼굴 타일: 정사각형 얼굴 + 아래 이름. 속성은 얼굴 오른쪽 아래 작은 아이콘과 밑줄 색으로 보여준다
function buildTile(role) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'role-tile';
  btn.dataset.id = role.id;
  btn.style.setProperty('--el', elementColor(role.elements[0]));
  btn.title = `${role.name} (${role.elements.join(' · ')})`;
  btn.setAttribute('aria-pressed', String(role.id === currentId));
  if (role.id === currentId) btn.classList.add('is-on');
  btn.innerHTML = `
    <span class="role-face"><img src="${faceUrl(role)}" alt="" loading="lazy" decoding="async">${elementIcons(role)}</span>
    <span class="role-label">${role.name}</span>`;
  btn.addEventListener('click', () => { selectRole(role.id); closeModal(); });
  return btn;
}

// 메인 화면: 고른 캐릭터 → 최근 고른 캐릭터 → (모자라면 최신 캐릭터) → [전체] 타일
function renderStrip() {
  const ids = [];
  if (currentId) ids.push(currentId);
  loadRecent().forEach((id) => { if (!ids.includes(id)) ids.push(id); });
  ROLES.forEach((r) => { if (ids.length < RECENT_MAX && !ids.includes(r.id)) ids.push(r.id); });
  strip.replaceChildren(...ids.slice(0, RECENT_MAX).map((id) => buildTile(findRole(id))));

  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'role-tile role-more';
  more.innerHTML = `<span class="role-face"><span class="role-more-mark">＋</span></span><span class="role-label">전체 ${ROLES.length}</span>`;
  more.addEventListener('click', openModal);
  strip.appendChild(more);
}

// ───────── 전체 공명자 창 ─────────
function renderTabs() {
  const tabs = [{ id: '', label: '전체', n: ROLES.length },
    ...ELEMENTS.map((e) => ({ id: e.id, label: e.id, n: ROLES.filter((r) => r.elements.includes(e.id)).length, color: e.color }))];
  modalTabs.replaceChildren(...tabs.map((t) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'role-tab' + (t.id === elementFilter ? ' is-on' : '');
    b.disabled = t.n === 0;
    if (t.color) b.style.setProperty('--el', t.color);
    b.innerHTML = `${t.color ? elementIcon(t.id) : ''}${t.label}<span>${t.n}</span>`;
    b.addEventListener('click', () => { elementFilter = t.id; renderTabs(); renderModalGrid(); });
    return b;
  }));
}

function renderModalGrid() {
  const q = searchInput.value.replace(/\s/g, '');
  const list = ROLES.filter((r) => (!elementFilter || r.elements.includes(elementFilter)) && (!q || r.name.replace(/[\s·]/g, '').includes(q)));
  if (!list.length) {
    const empty = document.createElement('div');
    empty.className = 'role-empty';
    empty.textContent = '찾는 공명자가 없어요.';
    modalGrid.replaceChildren(empty);
    return;
  }
  // 속성별로 묶어서 보여준다 (속성 탭을 고르면 그 묶음 하나만)
  const groups = ELEMENTS.filter((e) => !elementFilter || e.id === elementFilter).map((e) => {
    const members = list.filter((r) => r.elements.includes(e.id));
    if (!members.length) return null;
    const sec = document.createElement('section');
    sec.className = 'role-group';
    sec.style.setProperty('--el', e.color);
    sec.innerHTML = `<h4 class="role-group-head">${elementIcon(e.id)}${e.id}<span>${members.length}</span></h4>`;
    const grid = document.createElement('div');
    grid.className = 'role-group-grid';
    grid.append(...members.map(buildTile));
    sec.appendChild(grid);
    return sec;
  }).filter(Boolean);
  modalGrid.replaceChildren(...groups);
}

function openModal() {
  searchInput.value = '';
  elementFilter = '';
  renderTabs();
  renderModalGrid();
  modal.classList.add('is-open');
  document.body.classList.add('modal-lock');
  setTimeout(() => searchInput.focus(), 0);
}
function closeModal() {
  modal.classList.remove('is-open');
  document.body.classList.remove('modal-lock');
}

// ───────── 선택 ─────────
// 유효옵 체크박스를 캐릭터 프리셋대로 바꾸고, change 이벤트 한 번으로 app.js에 알린다
// 유효옵은 그대로 두고 app.js에 다시 계산만 시킨다 (오버레이의 목표 강조도 같이 갱신된다)
function notifyApp() {
  const first = filterContainer.querySelector('input[type="checkbox"]');
  if (!first) return;
  applying = true;
  first.dispatchEvent(new Event('change', { bubbles: true }));
  applying = false;
}

function applyTargets(targets) {
  const inputs = [...filterContainer.querySelectorAll('input[type="checkbox"]')];
  if (!inputs.length) return;
  applying = true;
  inputs.forEach((cb) => { cb.checked = targets.includes(cb.value); });
  inputs[0].dispatchEvent(new Event('change', { bubbles: true }));
  applying = false;
}

function selectRole(id) {
  const role = findRole(id);
  currentId = role ? role.id : null;
  store.set(ROLE_KEY, currentId);
  if (role) pushRecent(role.id);
  showTargets(role);
  setGoalFocus(role);
  setTheme(role);
  renderStrip();
  if (role) {
    applyTargets(targetsOf(role));
    setNote(`${role.name} 추천 유효옵으로 바꿨어요. 아래에서 더 고칠 수 있어요.`);
  } else {
    setNote('캐릭터를 고르면 유효옵이 자동으로 맞춰져요.');
    notifyApp();
  }
}

function init() {
  if (!section || !strip || !filterContainer || !modal || !roleTargets) return;

  // 새로고침했을 때는 화면만 복원한다 (유효옵은 app.js가 저장해 둔 값을 그대로 쓴다)
  const saved = findRole(store.get(ROLE_KEY));
  currentId = saved ? saved.id : null;
  showTargets(saved);
  setGoalFocus(saved);
  setTheme(saved);
  if (saved) notifyApp();   // app.js는 roles.js보다 먼저 계산하므로, 강조 상태를 오버레이에도 알려준다
  renderStrip();
  setNote(saved ? `${saved.name} 선택 중` : '캐릭터를 고르면 유효옵이 자동으로 맞춰져요.');

  // 사용자가 유효옵을 직접 바꾸면 알려준다
  filterContainer.addEventListener('change', () => {
    if (applying || !currentId) return;
    setNote(`${findRole(currentId).name} 선택 중 · 유효옵 직접 수정함`);
  });

  searchInput.addEventListener('input', renderModalGrid);
  $('roleModalClose').addEventListener('click', closeModal);
  $('roleClearBtn').addEventListener('click', () => { selectRole(null); closeModal(); });
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modal.classList.contains('is-open')) closeModal(); });
}

init();
