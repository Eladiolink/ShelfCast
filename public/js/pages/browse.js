import { api } from '../api.js';
import { mediaGrid, bindCardClicks, pagination } from '../components.js';
import { loading, emptyState, esc } from '../utils.js';
import { icon } from '../icons.js';

const PAGE_SIZE = 48;

export function renderBrowse({ type, title, subtitle }) {
  const page = document.getElementById('page');
  const state = { page: 1, filters: { minDuration: '5' } };

  const apiPath = type === 'movies' ? '/api/movies' : type === 'series' ? '/api/series' : '/api/anime';

  async function load() {
    page.innerHTML = loading();
    const params = new URLSearchParams({ page: state.page, perPage: PAGE_SIZE });
    for (const [k, v] of Object.entries(state.filters)) {
      if (!v) continue;
      params.set(k, k === 'minDuration' ? String(parseInt(v, 10) * 60) : v);
    }
    let data;
    try {
      data = await api.get(`${apiPath}?${params.toString()}`);
    } catch {
      page.innerHTML = emptyState(icon('alert-triangle', 44), 'Erro ao carregar', 'Verifique os logs do servidor.');
      return;
    }

    let items = data.items || [];
    let cardItems = items;
    if (type === 'movies') cardItems = items.map((m) => ({ ...m, poster: m.poster, title: m.title, year: m.year, rating: m.rating }));
    if (type === 'series') cardItems = items.map((s) => ({ ...s, id: s.media_id, poster: s.poster, rating: s.rating, hideable: false, sub: `${s.episode_count} episódio${s.episode_count !== 1 ? 's' : ''}` }));
    if (type === 'anime') cardItems = items.map((i) => ({ ...i, id: i.media_id || i.id, poster: i.poster, rating: i.rating, hideable: i.kind !== 'series', sub: i.kind === 'series' ? `${i.episode_count} episódios` : (i.year || '') }));

    const filters = await api.get('/api/filters').catch(() => ({ years: [], resolutions: [], codecs: [], genres: [] }));

    const yearOpts = filters.years.map((y) => `<option value="${y}">${y}</option>`).join('');
    const resOpts = filters.resolutions.map((r) => `<option value="${r}">${r}</option>`).join('');
    const codecOpts = filters.codecs.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    const genreOpts = filters.genres.map((g) => `<option value="${esc(g)}">${esc(g)}</option>`).join('');

    const filterBar = `
      <div class="filter-bar">
        <select data-filter="sort">
          <option value="recent">Mais recentes</option>
          <option value="title">Título (A-Z)</option>
          <option value="year">Ano</option>
        </select>
        <select data-filter="genre"><option value="">Gênero</option>${genreOpts}</select>
        <select data-filter="year"><option value="">Ano</option>${yearOpts}</select>
        <select data-filter="resolution"><option value="">Resolução</option>
          <option value="4K">4K</option><option value="1080p">1080p</option>
          <option value="720p">720p</option><option value="SD">SD</option></select>
        <select data-filter="codec"><option value="">Codec</option>${codecOpts}</select>
        <select data-filter="minDuration" title="Duração mínima">
          <option value="">Qualquer duração</option>
          <option value="5">≥ 5 min</option>
          <option value="10">≥ 10 min</option>
          <option value="20">≥ 20 min</option>
          <option value="40">≥ 40 min</option>
          <option value="60">≥ 1 hora</option>
        </select>
        ${Object.keys(state.filters).some((k) => state.filters[k]) ? '<button class="btn btn-secondary btn-sm" id="clear-filters">Limpar</button>' : ''}
      </div>`;

    const grid = cardItems.length ? mediaGrid(cardItems) : emptyState(icon('folder', 44), 'Nenhum item encontrado');
    const pag = pagination(state.page, data.total, PAGE_SIZE, (p) => { state.page = p; load(); });

    page.innerHTML = `
      <h1 class="page-title">${title}</h1>
      <div class="page-sub">${subtitle}</div>
      ${filterBar}
      ${grid}
      ${pag}`;

    bindCardClicks(page, (id) => { location.hash = `#/media/${id}`; });

    page.querySelectorAll('[data-filter]').forEach((el) => {
      const key = el.dataset.filter;
      if (state.filters[key]) el.value = state.filters[key];
      el.addEventListener('change', () => {
        state.filters[key] = el.value || null;
        state.page = 1;
        load();
      });
    });
    const clear = page.querySelector('#clear-filters');
    if (clear) clear.onclick = () => { state.filters = { minDuration: '5' }; state.page = 1; load(); };
  }

  load();
}
