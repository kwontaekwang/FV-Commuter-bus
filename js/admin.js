(() => {
  'use strict';

  const DATA_KEY = 'commuterBusDataOverride';
  const PASSWORD_KEY = 'commuterBusAdminPasswordHash';
  const SESSION_KEY = 'commuterBusAdminUnlocked';
  const defaultData = window.COMMUTER_BUS_DATA;
  const $ = id => document.getElementById(id);
  let data = loadData();
  let currentRouteId = data.routes[0]?.id || '';
  let attempts = 0;
  let lockedUntil = 0;
  let toastTimer;

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function loadData() {
    try {
      const saved = JSON.parse(localStorage.getItem(DATA_KEY));
      if (saved && Array.isArray(saved.routes)) return saved;
    } catch {}
    return clone(defaultData);
  }
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
  }
  async function sha256(text) {
    const bytes = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }
  function passwordHash() { return localStorage.getItem(PASSWORD_KEY) || window.COMMUTER_BUS_CONFIG.adminPasswordHash; }

  function init() {
    bindLogin();
    if (sessionStorage.getItem(SESSION_KEY) === '1') unlock();
  }

  function bindLogin() {
    $('loginForm').addEventListener('submit', async event => {
      event.preventDefault();
      const now = Date.now();
      if (now < lockedUntil) {
        $('loginError').textContent = `잠시 후 다시 시도하세요. (${Math.ceil((lockedUntil - now) / 1000)}초)`;
        return;
      }
      const input = $('passwordInput').value;
      if (!input) return;
      try {
        if (await sha256(input) === passwordHash()) {
          attempts = 0;
          sessionStorage.setItem(SESSION_KEY, '1');
          $('passwordInput').value = '';
          $('loginError').textContent = '';
          unlock();
        } else {
          attempts += 1;
          if (attempts >= 5) { lockedUntil = Date.now() + 30000; attempts = 0; }
          $('loginError').textContent = '비밀번호가 맞지 않습니다.';
        }
      } catch {
        $('loginError').textContent = '보안 기능을 사용할 수 없습니다. GitHub Pages 주소로 접속하세요.';
      }
    });
  }

  function unlock() {
    $('loginPanel').hidden = true;
    $('adminPanel').hidden = false;
    buildRouteSelect();
    updateStats();
    renderEditor();
    bindAdminEvents();
  }

  let eventsBound = false;
  function bindAdminEvents() {
    if (eventsBound) return;
    eventsBound = true;
    $('logoutButton').addEventListener('click', () => {
      sessionStorage.removeItem(SESSION_KEY);
      location.reload();
    });
    $('routeSelect').addEventListener('change', () => {
      collectCurrentRoute();
      currentRouteId = $('routeSelect').value;
      renderEditor();
    });
    $('saveRoute').addEventListener('click', saveRoute);
    $('addStop').addEventListener('click', () => {
      const route = collectCurrentRoute();
      route.stops.push({order: route.stops.length + 1, time: '', name: '', boarding: '', note: ''});
      renderStops(route);
      requestAnimationFrame(() => $('stopEditor').lastElementChild?.querySelector('[data-field="name"]')?.focus());
    });
    $('stopEditor').addEventListener('click', event => {
      const button = event.target.closest('[data-action]');
      if (!button) return;
      const row = button.closest('.stop-row');
      const index = Number(row.dataset.index);
      const route = collectCurrentRoute();
      if (button.dataset.action === 'delete') {
        if (confirm('이 정류장을 삭제할까요?')) route.stops.splice(index, 1);
      } else if (button.dataset.action === 'up' && index > 0) {
        [route.stops[index - 1], route.stops[index]] = [route.stops[index], route.stops[index - 1]];
      } else if (button.dataset.action === 'down' && index < route.stops.length - 1) {
        [route.stops[index + 1], route.stops[index]] = [route.stops[index], route.stops[index + 1]];
      }
      route.stops.forEach((stop, i) => stop.order = i + 1);
      renderStops(route);
    });
    $('exportJs').addEventListener('click', () => {
      collectCurrentRoute();
      download('app-data.js', `window.COMMUTER_BUS_DATA = ${JSON.stringify(data)};\n`, 'text/javascript;charset=utf-8');
      showToast('배포용 app-data.js를 내보냈습니다.');
    });
    $('exportJson').addEventListener('click', () => {
      collectCurrentRoute();
      download(`commuter-bus-backup-${dateStamp()}.json`, JSON.stringify(data, null, 2), 'application/json');
    });
    $('importJson').addEventListener('change', importJson);
    $('resetData').addEventListener('click', resetData);
    $('passwordForm').addEventListener('submit', changePassword);
  }

  function buildRouteSelect() {
    const select = $('routeSelect');
    select.innerHTML = data.routes.map(route => `<option value="${escapeHtml(route.id)}">${escapeHtml(route.id)} · ${escapeHtml(route.category)} · ${escapeHtml(route.name)}</option>`).join('');
    select.value = currentRouteId;
  }

  function currentRoute() { return data.routes.find(route => route.id === currentRouteId); }

  function renderEditor() {
    const route = currentRoute();
    if (!route) return;
    $('editId').value = route.id;
    $('editCategory').value = route.category;
    $('editServiceType').value = route.serviceType;
    $('editName').value = route.name;
    $('editTimeBand').value = route.timeBand;
    $('editNote').value = route.note || '';
    renderStops(route);
  }

  function renderStops(route) {
    $('editorStopCount').textContent = `${route.stops.length}개 기록`;
    $('stopEditor').innerHTML = route.stops.map((stop, index) => `<div class="stop-row" data-index="${index}">
      <div class="stop-row__order">${index + 1}</div>
      <input data-field="time" value="${escapeHtml(stop.time)}" placeholder="시간" aria-label="${index + 1}번 시간">
      <input data-field="name" value="${escapeHtml(stop.name)}" placeholder="정류장명" aria-label="${index + 1}번 정류장명">
      <input class="stop-boarding" data-field="boarding" value="${escapeHtml(stop.boarding || '')}" placeholder="탑승 위치" aria-label="${index + 1}번 탑승 위치">
      <div class="stop-row__actions">
        <button class="mini-button" type="button" data-action="up" title="위로" aria-label="위로 이동">↑</button>
        <button class="mini-button" type="button" data-action="down" title="아래로" aria-label="아래로 이동">↓</button>
        <button class="mini-button mini-button--delete" type="button" data-action="delete" title="삭제" aria-label="정류장 삭제">×</button>
      </div>
    </div>`).join('');
  }

  function collectCurrentRoute() {
    const route = currentRoute();
    if (!route) return null;
    route.category = $('editCategory').value.trim();
    route.serviceType = $('editServiceType').value.trim();
    route.name = $('editName').value.trim();
    route.timeBand = $('editTimeBand').value.trim();
    route.note = $('editNote').value.trim();
    route.stops = [...$('stopEditor').querySelectorAll('.stop-row')].map((row, index) => ({
      order: index + 1,
      time: row.querySelector('[data-field="time"]').value.trim(),
      name: row.querySelector('[data-field="name"]').value.trim(),
      boarding: row.querySelector('[data-field="boarding"]').value.trim(),
      note: ''
    }));
    return route;
  }

  function saveRoute() {
    const route = collectCurrentRoute();
    if (!route.name || route.stops.some(stop => !stop.name)) {
      showToast('노선명과 모든 정류장명을 입력하세요.');
      return;
    }
    data.version = new Date().toISOString().slice(0, 10);
    localStorage.setItem(DATA_KEY, JSON.stringify(data));
    buildRouteSelect();
    $('routeSelect').value = currentRouteId;
    updateStats(true);
    showToast(`${route.id} 노선을 이 브라우저에 저장했습니다.`);
  }

  function updateStats(saved = false) {
    $('adminRouteCount').textContent = data.routes.length.toLocaleString('ko-KR');
    $('adminStopCount').textContent = data.routes.reduce((sum, route) => sum + route.stops.length, 0).toLocaleString('ko-KR');
    $('saveState').textContent = localStorage.getItem(DATA_KEY) ? (saved ? '방금 저장' : '수정본') : '원본';
  }

  async function importJson(event) {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    try {
      const imported = JSON.parse(await file.text());
      if (!imported || !Array.isArray(imported.routes) || imported.routes.some(route => !route.id || !Array.isArray(route.stops))) throw new Error();
      data = imported;
      currentRouteId = data.routes[0]?.id || '';
      localStorage.setItem(DATA_KEY, JSON.stringify(data));
      buildRouteSelect();
      updateStats();
      renderEditor();
      showToast('JSON 데이터를 가져왔습니다.');
    } catch {
      showToast('올바른 통근버스 JSON 파일이 아닙니다.');
    }
  }

  function resetData() {
    if (!confirm('브라우저에 저장한 모든 수정 내용을 지우고 원본으로 돌아갈까요?')) return;
    localStorage.removeItem(DATA_KEY);
    data = clone(defaultData);
    currentRouteId = data.routes[0]?.id || '';
    buildRouteSelect();
    updateStats();
    renderEditor();
    showToast('원본 데이터로 초기화했습니다.');
  }

  async function changePassword(event) {
    event.preventDefault();
    const first = $('newPassword').value;
    const second = $('confirmPassword').value;
    const error = $('passwordError');
    if (first.length < 6) { error.textContent = '6자 이상 입력하세요.'; return; }
    if (first !== second) { error.textContent = '비밀번호가 서로 다릅니다.'; return; }
    try {
      localStorage.setItem(PASSWORD_KEY, await sha256(first));
      event.target.reset();
      error.textContent = '';
      showToast('이 브라우저의 관리자 비밀번호를 변경했습니다.');
    } catch { error.textContent = '비밀번호를 변경할 수 없습니다.'; }
  }

  function download(name, content, type) {
    const url = URL.createObjectURL(new Blob([content], {type}));
    const link = document.createElement('a');
    link.href = url; link.download = name; document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function dateStamp() { return new Date().toISOString().slice(0,10).replaceAll('-',''); }
  function showToast(message) {
    clearTimeout(toastTimer);
    $('toast').textContent = message;
    $('toast').classList.add('show');
    toastTimer = setTimeout(() => $('toast').classList.remove('show'), 2300);
  }

  init();
})();
