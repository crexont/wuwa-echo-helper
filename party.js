// party.js — 명조 에코파고 v4.0: 파티 메이커 탭
// 가진 캐릭터를 체크하고, 그 안에서 파티(3명)를 직접 짜고, 한 장짜리 카드로 캡처(PNG 저장 · 이미지 복사)한다.
// 에코파고 화면(app.js · roles.js)과는 따로 돈다. 공명자 목록 · 얼굴 · 속성 색은 roles.js, 무기 목록은 weapons.js.
// 카드는 canvas 하나로 그려서, 화면에 보이는 그대로 저장된다. 색은 지금 테마(CSS 변수)를 따른다.
import { ROLES, ELEMENTS, faceUrl } from './roles.js';
import { WEAPONS, ROLE_WEAPON } from './weapons.js';

const KEY = 'echopago.party.v1';
const PARTY_SIZE = 3;
const PARTY_MAX = 20;   // 역경의 탑 · 홀로그램 등 한 번에 10파티 넘게 짜는 경우도 있어서 넉넉히
const NAME_MAX = 20;

const $ = (id) => document.getElementById(id);
const elementOf = (id) => ELEMENTS.find((e) => e.id === id);
const colorOf = (role) => elementOf(role.elements[0])?.color ?? '#74767e';
const findRole = (id) => ROLES.find((r) => r.id === id) || null;
const findWeapon = (id) => WEAPONS.find((w) => w.id === id) || null;
const weaponIcon = (w) => `./img/weapons/${w.id}.webp`;
// 그 공명자가 들 수 있는 무기 (같은 종류)
const weaponsFor = (roleId) => WEAPONS.filter((w) => w.type === ROLE_WEAPON[roleId]);
// 속성 순서(용융 → … → 인멸)로 묶고, 속성 안에서는 roles.js 순서(최신 출시순)
const ORDERED = ELEMENTS.flatMap((e) => ROLES.filter((r) => r.elements[0] === e.id));

// ───────── 저장 ─────────
const emptyParty = (n) => ({ name: `파티 ${n}`, ids: Array(PARTY_SIZE).fill(null) });
function load() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(KEY)); } catch { /* 무시 */ }
  const owned = Array.isArray(s?.owned) ? s.owned.filter(findRole) : [];
  const parties = (Array.isArray(s?.parties) ? s.parties : []).slice(0, PARTY_MAX).map((p, i) => ({
    name: typeof p?.name === 'string' ? p.name.slice(0, NAME_MAX) : `파티 ${i + 1}`,
    ids: Array.from({ length: PARTY_SIZE }, (_, k) => (owned.includes(p?.ids?.[k]) ? p.ids[k] : null)),
  }));
  // 사용 횟수: 서포터 등 두 파티에 넣을 수 있는 캐릭터만 2를 적어 둔다 (없으면 1회)
  const uses = {};
  for (const id of owned) if (s?.uses?.[id] === 2) uses[id] = 2;
  // 돌파(0~6) · 무기 재련(1~5) · 무기(id). 기본값(0돌 · R1 · 무기 안 정함)이면 적지 않는다
  const build = {};
  for (const id of owned) {
    const b = s?.build?.[id];
    const seq = Number.isInteger(b?.s) && b.s >= 0 && b.s <= 6 ? b.s : 0;
    const ref = Number.isInteger(b?.r) && b.r >= 1 && b.r <= 5 ? b.r : 1;
    const w = findWeapon(b?.w)?.type === ROLE_WEAPON[id] ? b.w : null;
    if (seq || ref > 1 || w) build[id] = { s: seq, r: ref, w };
  }
  return { owned, uses, build, parties: parties.length ? parties : [emptyParty(1)] };
}
const state = load();
function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* 무시 */ } }

const maxUses = (id) => (state.uses[id] === 2 ? 2 : 1);
const usedCount = (id) => state.parties.reduce((n, p) => n + p.ids.filter((x) => x === id).length, 0);
const unused = () => ORDERED.filter((r) => state.owned.includes(r.id) && !usedCount(r.id));
const seqOf = (id) => state.build[id]?.s ?? 0;
const refOf = (id) => state.build[id]?.r ?? 1;
const weaponOf = (id) => findWeapon(state.build[id]?.w);
const buildText = (id) => `${seqOf(id)}돌 · R${refOf(id)}`;
function setBuild(id, key, value) {
  const b = { s: seqOf(id), r: refOf(id), w: weaponOf(id)?.id ?? null, [key]: value };
  if (b.s || b.r > 1 || b.w) state.build[id] = b;
  else delete state.build[id];
  changed();
}

// 지금 고르는 칸 { p: 파티 번호, k: 칸 번호 }
let active = null;
// 보유 캐릭터 체크 화면(60명 전부)을 펼쳤는지. 처음 쓰는 사람만 펼친 채로 시작
let editingOwned = !state.owned.length;
// 돌파 · 재련 · 사용 횟수를 고치는 중인 캐릭터
let editingRole = null;

// ───────── 탭 (에코파고 / 파티 메이커) ─────────
const tabs = $('appTabs');
function showTab() {
  const tab = location.hash === '#party' ? 'party' : 'echo';
  document.body.dataset.tab = tab;
  for (const a of tabs.querySelectorAll('[data-tab]')) a.setAttribute('aria-current', a.dataset.tab === tab ? 'page' : 'false');
  if (tab === 'party') renderCard();   // 에코파고에서 공명자(테마)를 바꿨을 수 있으니 카드 색을 다시 맞춘다
}
tabs.addEventListener('click', (e) => {
  const a = e.target.closest('[data-tab]');
  if (!a) return;
  e.preventDefault();
  history.pushState(null, '', a.dataset.tab === 'party' ? '#party' : location.pathname + location.search);
  showTab();
  window.scrollTo(0, 0);
});
window.addEventListener('popstate', showTab);
window.addEventListener('hashchange', showTab);

// ───────── 얼굴 타일 ─────────
const elementIcon = (role) => {
  const e = elementOf(role.elements[0]);
  return `<i class="el-icon" style="--el:${e.color};--icon:url('./icons/elements/${e.icon}.png')"></i>`;
};
function tile(role, cls, onClick, note = '') {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `pm-tile ${cls}`;
  b.style.setProperty('--el', colorOf(role));
  b.title = role.name + (note ? ` (${note})` : '');
  b.innerHTML = `<span class="role-face"><img src="${faceUrl(role)}" alt="" loading="lazy" decoding="async">${elementIcon(role)}</span>
    <span class="role-label">${role.name}</span>${note ? `<span class="pm-note">${note}</span>` : ''}`;
  b.addEventListener('click', onClick);
  return b;
}

// ───────── 보유 캐릭터 ─────────
// 평소: 가진 캐릭터만 작게 + 캐릭터마다 사용 횟수(1회/2회)
// [캐릭터 체크하기]: 60명 전부 펼쳐서 켜고 끄기
function renderOwned() {
  const grid = $('pmOwnedGrid');
  grid.textContent = '';
  grid.classList.toggle('is-editing', editingOwned);
  $('pmOwnEdit').textContent = editingOwned ? '완료' : '캐릭터 체크하기';
  $('pmOwnAll').hidden = $('pmOwnNone').hidden = !editingOwned;
  $('pmOwnedHint').textContent = editingOwned
    ? '가지고 있는 캐릭터를 눌러서 켜 주세요. 다 했으면 [완료].'
    : '얼굴을 누르면 돌파 · 무기 재련 · 사용 횟수를 정할 수 있어요. 서포터처럼 두 파티에 같이 넣는 캐릭터는 [2회]로.';
  if (!editingOwned && editingRole && state.owned.includes(editingRole)) grid.append(buildEditor(findRole(editingRole)));
  for (const e of ELEMENTS) {
    const all = ORDERED.filter((r) => r.elements[0] === e.id);
    const owned = all.filter((r) => state.owned.includes(r.id));
    if (!editingOwned && !owned.length) continue;
    const head = document.createElement('div');
    head.className = 'role-group-head';
    head.innerHTML = `<i class="el-icon" style="--el:${e.color};--icon:url('./icons/elements/${e.icon}.png')"></i>${e.id} <span>${owned.length}/${all.length}</span>`;
    const row = document.createElement('div');
    row.className = 'pm-tiles';
    if (editingOwned) {
      for (const r of all) row.append(tile(r, state.owned.includes(r.id) ? 'is-owned' : '', () => toggleOwned(r.id)));
    } else {
      for (const r of owned) row.append(ownedTile(r));
    }
    grid.append(head, row);
  }
  if (!editingOwned && !state.owned.length) {
    grid.insertAdjacentHTML('beforeend', '<p class="pm-empty">아직 체크한 캐릭터가 없어요. [캐릭터 체크하기]를 눌러 주세요.</p>');
  }
  $('pmOwnedCount').textContent = `${state.owned.length}/${ROLES.length}`;
}
// 가진 캐릭터 타일: 얼굴 + 이름 + 돌파 · 재련 (2회면 표시). 누르면 설정 상자가 열린다
function ownedTile(role) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'pm-tile is-owned pm-owned-tile' + (editingRole === role.id ? ' is-editing' : '');
  b.style.setProperty('--el', colorOf(role));
  const two = maxUses(role.id) === 2;
  const w = weaponOf(role.id);
  b.title = `${role.name} ${buildText(role.id)}${w ? ` · ${w.name}` : ""} · 파티 ${maxUses(role.id)}회 — 누르면 설정`;
  b.innerHTML = `<span class="role-face"><img src="${faceUrl(role)}" alt="" loading="lazy" decoding="async">${elementIcon(role)}${w ? `<img class="pm-wicon" src="${weaponIcon(w)}" alt="">` : ""}</span>
    <span class="role-label">${role.name}</span>
    <span class="pm-build">${seqOf(role.id)}돌 R${refOf(role.id)}</span>${two ? '<span class="pm-note pm-two">2회</span>' : ''}`;
  b.addEventListener('click', () => { editingRole = editingRole === role.id ? null : role.id; renderOwned(); });
  return b;
}
// 설정 상자: 돌파 0~6 · 재련 R1~R5 · 파티 사용 1회/2회
function buildEditor(role) {
  const box = document.createElement('div');
  box.className = 'pm-editor';
  box.style.setProperty('--el', colorOf(role));
  const head = document.createElement('div');
  head.className = 'pm-editor-head';
  head.innerHTML = `<span class="role-face"><img src="${faceUrl(role)}" alt="" decoding="async"></span><strong>${role.name}</strong>`;
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'pm-btn';
  close.textContent = '닫기';
  close.addEventListener('click', () => { editingRole = null; renderOwned(); });
  head.append(close);
  box.append(head);
  const seg = (label, values, current, text, onPick) => {
    const row = document.createElement('div');
    row.className = 'pm-seg-row';
    row.innerHTML = `<span class="pm-seg-label">${label}</span>`;
    const seg = document.createElement('div');
    seg.className = 'pm-seg';
    for (const v of values) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = text(v);
      b.setAttribute('aria-pressed', String(v === current));
      b.addEventListener('click', () => onPick(v));
      seg.append(b);
    }
    row.append(seg);
    return row;
  };
  box.append(
    seg('돌파', [0, 1, 2, 3, 4, 5, 6], seqOf(role.id), (v) => `${v}돌`, (v) => setBuild(role.id, 's', v)),
    seg('무기 재련', [1, 2, 3, 4, 5], refOf(role.id), (v) => `R${v}`, (v) => setBuild(role.id, 'r', v)),
    seg('파티 사용', [1, 2], maxUses(role.id), (v) => `${v}회`, (v) => setUses(role.id, v)),
    weaponPicker(role),
  );
  return box;
}
// 무기 고르기: 그 공명자 무기 종류만, 5성 → 4성 → 3성
function weaponPicker(role) {
  const row = document.createElement('div');
  row.className = 'pm-seg-row pm-weapon-row';
  const current = weaponOf(role.id);
  row.innerHTML = `<span class="pm-seg-label">무기 <small>${ROLE_WEAPON[role.id]}</small></span>`;
  const list = document.createElement('div');
  list.className = 'pm-weapons';
  const none = document.createElement('button');
  none.type = 'button';
  none.className = 'pm-weapon pm-weapon-none';
  none.setAttribute('aria-pressed', String(!current));
  none.innerHTML = '<span class="pm-weapon-img">－</span><span class="pm-weapon-name">안 정함</span>';
  none.addEventListener('click', () => setBuild(role.id, 'w', null));
  list.append(none);
  for (const w of weaponsFor(role.id)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `pm-weapon q${w.q}`;
    b.title = `${w.name} (${w.q}성)`;
    b.setAttribute('aria-pressed', String(current?.id === w.id));
    b.innerHTML = `<span class="pm-weapon-img"><img src="${weaponIcon(w)}" alt="" loading="lazy"></span><span class="pm-weapon-name">${w.name}</span>`;
    b.addEventListener('click', () => setBuild(role.id, 'w', w.id));
    list.append(b);
  }
  row.append(list);
  return row;
}
function setUses(id, n) {
  if (n === 2) {
    state.uses[id] = 2;
  } else {
    delete state.uses[id];
    // 1회로 줄이면 뒤쪽 파티에 들어간 두 번째 자리는 비운다
    let seen = 0;
    for (const p of state.parties) p.ids = p.ids.map((x) => (x === id && ++seen > 1 ? null : x));
  }
  changed();
}
function toggleOwned(id) {
  if (state.owned.includes(id)) {
    state.owned = state.owned.filter((x) => x !== id);
    delete state.uses[id];
    delete state.build[id];
    for (const p of state.parties) p.ids = p.ids.map((x) => (x === id ? null : x));   // 안 가진 캐릭터는 파티에서도 뺀다
  } else {
    state.owned.push(id);
  }
  changed();
}
$('pmOwnEdit').addEventListener('click', () => { editingOwned = !editingOwned; renderOwned(); });

// ───────── 파티 ─────────
// 10파티 넘게 짜도 한눈에 보이게 한 파티 = 한 줄 (이름 | 3칸 | 삭제). 고르는 칸이 있으면 그 줄 바로 아래에 캐릭터 고르기
const picker = $('pmPicker');
const pickerTitle = $('pmPickerTitle');
const pickerGrid = $('pmPickerGrid');
function slotHtml(role) {
  const w = weaponOf(role.id);
  return `<span class="role-face"><img src="${faceUrl(role)}" alt="" decoding="async">${elementIcon(role)}</span>
    <span class="pm-slot-text"><span class="role-label">${role.name}</span><span class="pm-build">${buildText(role.id)}</span>
    ${w ? `<span class="pm-slot-weapon"><img src="${weaponIcon(w)}" alt="">${w.name}</span>` : '<span class="pm-slot-weapon is-none">무기 안 정함</span>'}</span>`;
}
function renderParties() {
  const list = $('pmPartyList');
  picker.remove();   // 다시 그릴 때 고르기 상자는 떼어 두었다가 고르는 줄 아래에 다시 붙인다
  list.textContent = '';
  state.parties.forEach((party, p) => {
    const row = document.createElement('div');
    row.className = 'pm-party' + (active?.p === p ? ' is-active' : '');

    const name = document.createElement('input');
    name.className = 'pm-party-name';
    name.value = party.name;
    name.maxLength = NAME_MAX;
    name.placeholder = `파티 ${p + 1}`;
    name.setAttribute('aria-label', '파티 이름');
    name.addEventListener('input', () => { party.name = name.value; save(); renderCardSoon(); });

    const slots = document.createElement('div');
    slots.className = 'pm-slots';
    party.ids.forEach((id, k) => {
      const role = findRole(id);
      const isActive = active?.p === p && active?.k === k;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pm-slot' + (role ? ' is-filled' : '') + (isActive ? ' is-active' : '');
      if (role) {
        b.style.setProperty('--el', colorOf(role));
        b.innerHTML = slotHtml(role);
        b.title = `${role.name} ${buildText(role.id)} — 누르면 빼거나 바꿀 수 있어요`;
      } else {
        b.innerHTML = '<span class="role-face"><span class="role-more-mark">＋</span></span><span class="pm-slot-text"><span class="role-label">빈칸</span></span>';
        b.title = '캐릭터 넣기';
      }
      b.addEventListener('click', () => { active = isActive ? null : { p, k }; renderParties(); });
      slots.append(b);
    });

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'pm-party-del';
    del.textContent = '삭제';
    del.title = '이 파티 삭제';
    del.addEventListener('click', () => {
      if (party.ids.some(Boolean) && !confirm(`${party.name || `파티 ${p + 1}`}를 삭제할까요?`)) return;
      state.parties.splice(p, 1);
      if (!state.parties.length) state.parties.push(emptyParty(1));
      active = null;
      changed();
    });

    row.append(name, slots, del);
    list.append(row);
    if (active?.p === p) { picker.hidden = false; list.append(picker); renderPicker(); }
  });
  $('pmAddParty').disabled = state.parties.length >= PARTY_MAX;
  $('pmPartyCount').textContent = `${state.parties.length}/${PARTY_MAX}`;
}

// 고르는 칸에 넣을 캐릭터: 가진 캐릭터 중 이 파티에 아직 없고, 사용 횟수가 남은 캐릭터 (다 쓴 캐릭터는 숨김)
function renderPicker() {
  const party = state.parties[active.p];
  const current = findRole(party.ids[active.k]);
  pickerTitle.textContent = `${party.name || `파티 ${active.p + 1}`} · ${active.k + 1}번 칸에 넣을 캐릭터`;
  pickerGrid.textContent = '';
  if (current) {
    const out = document.createElement('button');
    out.type = 'button';
    out.className = 'pm-btn pm-out';
    out.textContent = `${current.name} 빼기`;
    out.addEventListener('click', () => { party.ids[active.k] = null; changed(); });
    pickerGrid.append(out);
  }
  const free = ORDERED.filter((r) => state.owned.includes(r.id) && !party.ids.includes(r.id));
  const choices = free.filter((r) => usedCount(r.id) < maxUses(r.id));
  const spent = free.length - choices.length;
  if (!state.owned.length) {
    pickerGrid.insertAdjacentHTML('beforeend', '<p class="pm-empty">먼저 보유 캐릭터에서 가진 캐릭터를 켜 주세요.</p>');
  } else if (!choices.length) {
    pickerGrid.insertAdjacentHTML('beforeend', '<p class="pm-empty">넣을 수 있는 캐릭터가 없어요.</p>');
  }
  const tiles = document.createElement('div');
  tiles.className = 'pm-tiles';
  for (const r of choices) {
    const used = usedCount(r.id);   // 2회 캐릭터가 다른 파티에 한 번 들어가 있으면 표시
    tiles.append(tile(r, used ? 'is-elsewhere' : '', () => pick(r.id), used ? `${used}/${maxUses(r.id)}` : ''));
  }
  pickerGrid.append(tiles);
  if (spent) pickerGrid.insertAdjacentHTML('beforeend', `<p class="pm-empty">다른 파티에 다 쓴 캐릭터 ${spent}명은 숨겼어요. 두 번 쓰려면 보유 캐릭터에서 [2회]로 바꾸세요.</p>`);
}
function pick(id) {
  const party = state.parties[active.p];
  party.ids[active.k] = id;
  // 같은 파티의 다음 빈칸으로 넘어가고, 다 찼으면 닫는다
  const next = party.ids.findIndex((x) => !x);
  active = next >= 0 ? { p: active.p, k: next } : null;
  changed();
}

$('pmAddParty').addEventListener('click', () => {
  if (state.parties.length >= PARTY_MAX) return;
  state.parties.push(emptyParty(state.parties.length + 1));
  active = { p: state.parties.length - 1, k: 0 };
  changed();
});
$('pmPickerClose').addEventListener('click', () => { active = null; renderParties(); });
$('pmOwnAll').addEventListener('click', () => { state.owned = ORDERED.map((r) => r.id); changed(); });
$('pmOwnNone').addEventListener('click', () => {
  if (state.owned.length && !confirm('가진 캐릭터 체크를 모두 끌까요? 파티도 비워져요.')) return;
  state.owned = [];
  state.uses = {};
  state.build = {};
  editingRole = null;
  for (const p of state.parties) p.ids = Array(PARTY_SIZE).fill(null);
  active = null;
  changed();
});

// ───────── 캡처용 카드 (canvas) ─────────
const images = new Map();
function loadImage(src) {
  if (!images.has(src)) {
    images.set(src, new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    }));
  }
  return images.get(src);
}
// 흰색 속성 아이콘에 속성 색을 입힌다
const tinted = new Map();
async function elementBadge(role) {
  const e = elementOf(role.elements[0]);
  if (!tinted.has(e.id)) {
    const img = await loadImage(`./icons/elements/${e.icon}.png`);
    const c = document.createElement('canvas');
    c.width = c.height = 48;
    const g = c.getContext('2d');
    if (img) {
      g.drawImage(img, 0, 0, 48, 48);
      g.globalCompositeOperation = 'source-in';
      g.fillStyle = e.color;
      g.fillRect(0, 0, 48, 48);
    }
    tinted.set(e.id, c);
  }
  return tinted.get(e.id);
}
function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
function fitText(g, text, max) {
  if (g.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && g.measureText(t + '…').width > max) t = t.slice(0, -1);
  return t + '…';
}
async function drawFace(g, role, x, y, size, css) {
  roundRect(g, x, y, size, size, size * 0.14);
  g.fillStyle = css.raised;
  g.fill();
  const img = await loadImage(faceUrl(role));
  g.save();
  roundRect(g, x, y, size, size, size * 0.14);
  g.clip();
  if (img) g.drawImage(img, x, y, size, size);
  g.fillStyle = colorOf(role);
  g.fillRect(x, y + size - Math.max(3, size * 0.045), size, Math.max(3, size * 0.045));   // 아래 속성 색 줄
  g.restore();
  roundRect(g, x + 0.5, y + 0.5, size - 1, size - 1, size * 0.14);
  g.strokeStyle = css.line;
  g.lineWidth = 1;
  g.stroke();
  const badge = await elementBadge(role);
  const b = Math.round(size * 0.2);
  g.drawImage(badge, x + size - b - 4, y + size - b - 6, b, b);
}

const FONT = "'IBM Plex Sans KR', 'Pretendard', sans-serif";
// 카드: 한 파티 = 한 줄 (이름 | 공명자 3명: 얼굴 + 이름 · 돌파 재련 · 무기). 10파티 넘어도 한 장에 들어가게
async function drawCard() {
  if (document.fonts?.ready) await document.fonts.ready;
  const cs = getComputedStyle(document.documentElement);
  const v = (name) => cs.getPropertyValue(name).trim();
  const css = { bg: v('--bg'), panel: v('--panel'), surface: v('--surface'), raised: v('--raised'), line: v('--line'), text: v('--text'), muted: v('--muted'), dim: v('--dim'), accent: v('--cyan') };

  const W = 1000, PAD = 28;
  const NAME_W = 150, ROW_H = 92, ROW_GAP = 10, FACE = 64;
  const MEMBER_W = (W - PAD * 2 - NAME_W - 12) / PARTY_SIZE;
  const parties = state.parties.filter((p) => p.ids.some(Boolean));
  const rest = unused();
  const SMALL = 48, PER_ROW = 15, CELL = (W - PAD * 2) / PER_ROW, REST_ROW = SMALL + 24;
  const restRows = Math.ceil(rest.length / PER_ROW);
  const partiesH = parties.length ? parties.length * (ROW_H + ROW_GAP) - ROW_GAP : 60;
  const H = PAD + 52 + partiesH + (rest.length ? 46 + restRows * REST_ROW : 0) + 40 + PAD - 12;

  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = W * scale;
  canvas.height = H * scale;
  const g = canvas.getContext('2d');
  g.scale(scale, scale);

  // 바탕
  g.fillStyle = css.bg;
  g.fillRect(0, 0, W, H);
  const glow = g.createRadialGradient(W * 0.85, 0, 0, W * 0.85, 0, W * 0.7);
  glow.addColorStop(0, `rgba(${v('--cyan-rgb')}, 0.14)`);
  glow.addColorStop(1, `rgba(${v('--cyan-rgb')}, 0)`);
  g.fillStyle = glow;
  g.fillRect(0, 0, W, H);

  // 제목
  let y = PAD + 26;
  g.fillStyle = css.text;
  g.font = `700 24px ${FONT}`;
  g.fillText('명조 파티', PAD, y);
  g.fillStyle = css.accent;
  g.fillRect(PAD, y + 12, 44, 3);
  g.fillStyle = css.muted;
  g.font = `500 13px ${FONT}`;
  const d = new Date();
  g.textAlign = 'right';
  g.fillText(`파티 ${parties.length}개 · 가진 캐릭터 ${state.owned.length}명 · ${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`, W - PAD, y);
  g.textAlign = 'left';
  y += 26;

  if (!parties.length) {
    g.fillStyle = css.dim;
    g.font = `500 14px ${FONT}`;
    g.fillText('아직 짠 파티가 없어요. 위에서 파티 칸을 채워 주세요.', PAD, y + 36);
  }
  for (let i = 0; i < parties.length; i++) {
    const party = parties[i];
    const y0 = y + i * (ROW_H + ROW_GAP);
    roundRect(g, PAD, y0, W - PAD * 2, ROW_H, 12);
    g.fillStyle = css.panel;
    g.fill();
    g.strokeStyle = css.line;
    g.lineWidth = 1;
    g.stroke();
    // 파티 이름 (길면 두 줄)
    g.fillStyle = css.accent;
    g.font = `700 15px ${FONT}`;
    const title = party.name || `파티 ${state.parties.indexOf(party) + 1}`;
    const maxW = NAME_W - 26;
    if (g.measureText(title).width <= maxW) {
      g.fillText(title, PAD + 18, y0 + ROW_H / 2 + 5);
    } else {
      let cut = title.length;
      while (cut > 1 && g.measureText(title.slice(0, cut)).width > maxW) cut--;
      g.fillText(title.slice(0, cut), PAD + 18, y0 + ROW_H / 2 - 5);
      g.fillText(fitText(g, title.slice(cut).trim(), maxW), PAD + 18, y0 + ROW_H / 2 + 15);
    }
    g.fillStyle = css.line;
    g.fillRect(PAD + NAME_W, y0 + 14, 1, ROW_H - 28);

    for (let k = 0; k < PARTY_SIZE; k++) {
      const role = findRole(party.ids[k]);
      const mx = PAD + NAME_W + 12 + k * MEMBER_W;
      const fy = y0 + (ROW_H - FACE) / 2;
      if (!role) {
        g.save();
        g.setLineDash([5, 5]);
        roundRect(g, mx + 0.5, fy + 0.5, FACE - 1, FACE - 1, FACE * 0.14);
        g.strokeStyle = css.line;
        g.stroke();
        g.restore();
        g.fillStyle = css.dim;
        g.font = `500 12px ${FONT}`;
        g.fillText('빈칸', mx + FACE + 12, fy + FACE / 2 + 4);
        continue;
      }
      await drawFace(g, role, mx, fy, FACE, css);
      const tx = mx + FACE + 12, tw = MEMBER_W - FACE - 22;
      g.fillStyle = css.text;
      g.font = `700 14px ${FONT}`;
      g.fillText(fitText(g, role.name, tw), tx, fy + 17);
      g.fillStyle = css.muted;
      g.font = `600 12px ${FONT}`;
      g.fillText(buildText(role.id), tx, fy + 36);
      const w = weaponOf(role.id);
      if (w) {
        const icon = await loadImage(weaponIcon(w));
        if (icon) g.drawImage(icon, tx - 2, fy + 42, 22, 22);
        g.fillStyle = w.q === 5 ? '#f5c45a' : w.q === 4 ? '#c39bff' : css.muted;
        g.font = `600 12px ${FONT}`;
        g.fillText(fitText(g, w.name, tw - 24), tx + 23, fy + 58);
      } else {
        g.fillStyle = css.dim;
        g.font = `500 11.5px ${FONT}`;
        g.fillText('무기 안 정함', tx, fy + 58);
      }
    }
  }
  y += partiesH;

  // 파티에 안 넣은 캐릭터
  if (rest.length) {
    y += 30;
    g.fillStyle = css.muted;
    g.font = `700 14px ${FONT}`;
    g.fillText(`파티에 안 넣은 캐릭터 ${rest.length}명`, PAD, y);
    y += 14;
    for (let i = 0; i < rest.length; i++) {
      const role = rest[i];
      const cx = PAD + (i % PER_ROW) * CELL + (CELL - SMALL) / 2;
      const cy = y + Math.floor(i / PER_ROW) * REST_ROW;
      await drawFace(g, role, cx, cy, SMALL, css);
      g.fillStyle = css.muted;
      g.font = `500 10.5px ${FONT}`;
      g.textAlign = 'center';
      g.fillText(fitText(g, role.name, CELL - 4), cx + SMALL / 2, cy + SMALL + 15);
      g.textAlign = 'left';
    }
  }

  // 아래 출처
  g.fillStyle = css.dim;
  g.font = `500 11px ${FONT}`;
  g.textAlign = 'right';
  g.fillText('명조 에코파고 · 파티 메이커  crexont.github.io/wuwa-echo-helper', W - PAD, H - PAD + 6);
  g.textAlign = 'left';
  return canvas;
}

let cardTimer = 0;
let cardSeq = 0;
async function renderCard() {
  const seq = ++cardSeq;
  const canvas = await drawCard();
  if (seq !== cardSeq) return;   // 그리는 사이에 또 바뀌었으면 마지막 것만
  canvas.className = 'pm-card-canvas';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', '파티 캡처 카드');
  $('pmCard').replaceChildren(canvas);
}
function renderCardSoon() {
  clearTimeout(cardTimer);
  cardTimer = setTimeout(renderCard, 150);
}

const status = document.createElement('span');
status.className = 'pm-status';
$('pmSavePng').parentElement.prepend(status);
function say(text) {
  status.textContent = text;
  clearTimeout(say.t);
  say.t = setTimeout(() => { status.textContent = ''; }, 2500);
}
const toBlob = (canvas) => new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
$('pmSavePng').addEventListener('click', async () => {
  const blob = await toBlob(await drawCard());
  const d = new Date();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `명조_파티_${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.png`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  say('저장했어요');
});
$('pmCopyPng').addEventListener('click', async () => {
  try {
    const blob = toBlob(await drawCard());
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    say('복사했어요. 붙여넣기 하면 돼요');
  } catch {
    say('이 브라우저는 복사가 안 돼요. PNG로 저장을 써 주세요');
  }
});

// ───────── 전체 ─────────
function changed() {
  save();
  renderOwned();
  renderParties();
  renderCardSoon();
}

renderOwned();
renderParties();
showTab();
if (document.body.dataset.tab !== 'party') renderCardSoon();
