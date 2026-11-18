(() => {
  'use strict';

  const STORAGE_DATA = 'commuterBusDataOverride';
  const STORAGE_FAVORITES = 'commuterBusFavorites';
  const STORAGE_THEME = 'commuterBusTheme';
  const baseData = window.COMMUTER_BUS_DATA;
  let data = loadData();
  let favorites = new Set(readJson(STORAGE_FAVORITES, []));
  let selectedCategory = '';
  let activeRouteId = '';
  let deferredInstallPrompt = null;

  const $ = id => document.getElementById(id);
  const els = {
    search: $('searchInput'), clear: $('clearSearch'), categories: $('categoryTabs'),
    type: $('typeFilter'), time: $('timeFilter'), favoriteOnly: $('favoriteOnly'),
    grid: $('routeGrid'), empty: $('emptyState'), result: $('resultSummary'),
    dialog: $('routeDialog'), timeline: $('timeline'), toast: $('toast')
  };

  function readJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  }

  function loadData() {
    const saved = readJson(STORAGE_DATA, null);
    if (saved && Array.isArray(saved.routes)) return saved;
    return JSON.parse(JSON.stringify(baseData));
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
  }

  function normalize(value) {
    return String(value ?? '').toLocaleLowerCase('ko-KR').replace(/\s+/g, '');
  }

  function routeSearchText(route) {
    return normalize([route.id, route.category, route.serviceType, route.name, route.timeBand, route.note,
      ...route.stops.flatMap(stop => [stop.name, stop.time, stop.boarding, stop.note])].join(' '));
  }

  function uniqueValues(key) {
    return [...new Set(data.routes.map(route => route[key]).filter(Boolean))].sort((a,b) => a.localeCompare(b, 'ko'));
  }

  function init() {
    const stopCount = data.routes.reduce((sum, route) => sum + route.stops.length, 0);
    $('routeCount').textContent = data.routes.length.toLocaleString('ko-KR');
    $('stopCount').textContent = stopCount.toLocaleString('ko-KR');
    $('serviceNotice').textContent = data.notice;
    $('dataSource').textContent = `${data.source} · ${data.version}`;
    initTheme();
    buildFilters();
    bindEvents();
    render();
    openRouteFromHash();
    registerServiceWorker();
  }

  function initTheme() {
    const stored = localStorage.getItem(STORAGE_THEME);
    const preferredDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = stored || (preferredDark ? 'dark' : 'light');
  }

  function buildFilters() {
    const counts = data.routes.reduce((map, route) => map.set(route.category, (map.get(route.category) || 0) + 1), new Map());
    const categories = [...counts.keys()].sort((a,b) => a.localeCompare(b, 'ko'));
    els.categories.innerHTML = [
      `<button class="category-tab" type="button" data-category="" aria-pressed="true">전체 ${data.routes.length}</button>`,
      ...categories.map(category => `<button class="category-tab" type="button" data-category="${escapeHtml(category)}" aria-pressed="false">${escapeHtml(category)} ${counts.get(category)}</button>`)
    ].join('');
    els.type.innerHTML = '<option value="">전체</option>' + uniqueValues('serviceType').map(v => `<option>${escapeHtml(v)}</option>`).join('');
    els.time.innerHTML = '<option value="">전체</option>' + uniqueValues('timeBand').map(v => `<option>${escapeHtml(v)}</option>`).join('');
  }

  function bindEvents() {
    els.search.addEventListener('input', () => { els.clear.hidden = !els.search.value; render(); });
    els.clear.addEventListener('click', () => { els.search.value = ''; els.clear.hidden = true; els.search.focus(); render(); });
    els.type.addEventListener('change', render);
    els.time.addEventListener('change', render);
    els.favoriteOnly.addEventListener('change', render);
    els.categories.addEventListener('click', event => {
      const button = event.target.closest('[data-category]');
      if (!button) return;
      selectedCategory = button.dataset.category;
      els.categories.querySelectorAll('button').forEach(el => el.setAttribute('aria-pressed', String(el === button)));
      render();
    });
    els.grid.addEventListener('click', event => {
      const favoriteButton = event.target.closest('[data-favorite]');
      if (favoriteButton) { event.stopPropagation(); toggleFavorite(favoriteButton.dataset.favorite); return; }
      const card = event.target.closest('[data-route-id]');
      if (card) openRoute(card.dataset.routeId, true);
    });
    els.grid.addEventListener('keydown', event => {
      if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('.route-card')) {
        event.preventDefault(); openRoute(event.target.dataset.routeId, true);
      }
    });
    $('resetFilters').addEventListener('click', resetFilters);
    $('closeDialog').addEventListener('click', closeRoute);
    els.dialog.addEventListener('click', event => {
      const rect = els.dialog.getBoundingClientRect();
      const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
      if (!inside) closeRoute();
    });
    els.dialog.addEventListener('close', () => {
      activeRouteId = '';
      if (location.hash.startsWith('#route=')) history.replaceState(null, '', location.pathname + location.search);
    });
    $('dialogFavorite').addEventListener('click', () => toggleFavorite(activeRouteId));
    $('shareRoute').addEventListener('click', shareRoute);
    $('themeButton').addEventListener('click', toggleTheme);
    window.addEventListener('hashchange', openRouteFromHash);
    window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); deferredInstallPrompt = event; $('installButton').hidden = false; });
    $('installButton').addEventListener('click', async () => {
      if (!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      $('installButton').hidden = true;
    });
  }

  function getFilteredRoutes() {
    const query = normalize(els.search.value);
    return data.routes.filter(route => {
      if (selectedCategory && route.category !== selectedCategory) return false;
      if (els.type.value && route.serviceType !== els.type.value) return false;
      if (els.time.value && route.timeBand !== els.time.value) return false;
      if (els.favoriteOnly.checked && !favorites.has(route.id)) return false;
      if (query && !routeSearchText(route).includes(query)) return false;
      return true;
    });
  }

  function render() {
    const routes = getFilteredRoutes();
    els.result.textContent = `${routes.length}개 노선 표시`;
    els.grid.innerHTML = routes.map(routeCard).join('');
    els.grid.hidden = routes.length === 0;
    els.empty.hidden = routes.length > 0;
  }

  function routeCard(route) {
    const first = route.stops[0]?.name || '정류장 정보 없음';
    const last = route.stops[route.stops.length - 1]?.name || first;
    const isFavorite = favorites.has(route.id);
    const missingTimes = route.stops.every(stop => !stop.time);
    return `<article class="route-card" data-route-id="${escapeHtml(route.id)}" tabindex="0" aria-label="${escapeHtml(route.name)} 상세 보기">
      <div class="route-card__top">
        <div class="route-badges"><span class="badge">${escapeHtml(route.category)}</span><span class="badge badge--muted">${escapeHtml(route.timeBand)}</span></div>
        <button class="favorite-button ${isFavorite ? 'is-favorite' : ''}" type="button" data-favorite="${escapeHtml(route.id)}" aria-label="${isFavorite ? '즐겨찾기 해제' : '즐겨찾기 추가'}">${isFavorite ? '★' : '☆'}</button>
      </div>
      <h3>${escapeHtml(route.name)}</h3>
      <p class="route-card__id">${escapeHtml(route.id)} · ${escapeHtml(route.serviceType)}</p>
      <div class="route-card__path"><span>${escapeHtml(first)}</span><i></i><span>${escapeHtml(last)}</span></div>
      <div class="route-card__footer"><p>${route.stops.length}개 기록${missingTimes ? ' · 시간 미기재' : ''}</p><button class="route-card__open" type="button">상세 보기 →</button></div>
    </article>`;
  }

  function openRoute(routeId, updateHash = false) {
    const route = data.routes.find(item => item.id === routeId);
    if (!route) return;
    activeRouteId = route.id;
    $('dialogEyebrow').textContent = `${route.category} · ${route.id}`;
    $('dialogTitle').textContent = route.name;
    $('dialogMeta').textContent = `${route.serviceType} · ${route.timeBand} · ${route.stops.length}개 기록`;
    $('dialogNote').hidden = !route.note;
    $('dialogNote').textContent = route.note;
    updateDialogFavorite();
    els.timeline.innerHTML = route.stops.map((stop, index) => `<li class="timeline__item">
      <div class="timeline__time ${stop.time ? '' : 'is-empty'}">${escapeHtml(stop.time || '시간 미기재')}</div>
      <div class="timeline__dot" aria-hidden="true"></div>
      <div class="timeline__body"><strong>${escapeHtml(stop.name)}</strong>${stop.boarding ? `<small>탑승 위치: ${escapeHtml(stop.boarding)}</small>` : ''}${stop.note && stop.note !== route.note ? `<small>${escapeHtml(stop.note)}</small>` : ''}</div>
    </li>`).join('');
    if (!els.dialog.open) els.dialog.showModal();
    if (updateHash) history.pushState(null, '', `#route=${encodeURIComponent(route.id)}`);
  }

  function closeRoute() {
    if (els.dialog.open) els.dialog.close();
  }

  function openRouteFromHash() {
    const match = location.hash.match(/^#route=([^&]+)/);
    if (match) openRoute(decodeURIComponent(match[1]), false);
    else if (els.dialog.open) els.dialog.close();
  }

  function toggleFavorite(routeId) {
    if (!routeId) return;
    if (favorites.has(routeId)) favorites.delete(routeId); else favorites.add(routeId);
    localStorage.setItem(STORAGE_FAVORITES, JSON.stringify([...favorites]));
    render();
    if (activeRouteId === routeId) updateDialogFavorite();
    showToast(favorites.has(routeId) ? '즐겨찾기에 추가했습니다.' : '즐겨찾기에서 제거했습니다.');
  }

  function updateDialogFavorite() {
    const active = favorites.has(activeRouteId);
    $('dialogFavorite').textContent = active ? '★ 즐겨찾기 해제' : '☆ 즐겨찾기';
  }

  async function shareRoute() {
    const route = data.routes.find(item => item.id === activeRouteId);
    if (!route) return;
    const url = `${location.href.split('#')[0]}#route=${encodeURIComponent(route.id)}`;
    try {
      if (navigator.share) await navigator.share({title: `${route.name} 통근버스`, text: `${route.category} · ${route.serviceType} · ${route.timeBand}`, url});
      else { await navigator.clipboard.writeText(url); showToast('노선 링크를 복사했습니다.'); }
    } catch (error) {
      if (error.name !== 'AbortError') showToast('링크를 복사하지 못했습니다.');
    }
  }

  function resetFilters() {
    selectedCategory = '';
    els.search.value = '';
    els.clear.hidden = true;
    els.type.value = '';
    els.time.value = '';
    els.favoriteOnly.checked = false;
    els.categories.querySelectorAll('button').forEach((button, i) => button.setAttribute('aria-pressed', String(i === 0)));
    render();
  }

  function toggleTheme() {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem(STORAGE_THEME, next);
  }

  let toastTimer;
  function showToast(message) {
    clearTimeout(toastTimer);
    els.toast.textContent = message;
    els.toast.classList.add('show');
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2200);
  }

  function registerServiceWorker() {
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
  }

  init();
})();
