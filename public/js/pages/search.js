import { api } from '../api.js';
import { mediaGrid, bindCardClicks } from '../components.js';
import { loading, emptyState, esc } from '../utils.js';
import { icon } from '../icons.js';

export function renderSearch(query) {
  const page = document.getElementById('page');
  const q = query || '';

  page.innerHTML = `
    <h1 class="page-title">Pesquisa</h1>
    <div class="page-sub">Resultados para: <strong>${esc(q)}</strong></div>
    ${loading()}`;

  api.get(`/api/search?q=${encodeURIComponent(q)}`).then((data) => {
    const html = [];
    if (data.movies?.length) {
      html.push(`<div class="search-result-group-title">${icon('film', 14)} Filmes</div>`);
      html.push(mediaGrid(data.movies.map((m) => ({ ...m, poster: m.poster, title: m.title, year: m.year, rating: m.rating }))));
    }
    if (data.series?.length) {
      html.push(`<div class="search-result-group-title">${icon('tv', 14)} Séries</div>`);
      html.push(mediaGrid(data.series.map((s) => ({ ...s, id: s.media_id, poster: s.poster, rating: s.rating }))));
    }
    if (data.items?.length) {
      html.push(`<div class="search-result-group-title">Mídias</div>`);
      html.push(mediaGrid(data.items));
    }
    page.innerHTML = html.length
      ? html.join('')
      : emptyState(icon('search', 44), 'Nenhum resultado', `Nada encontrado para "${q}"`);
    bindCardClicks(page, (id) => { location.hash = `#/media/${id}`; });
  }).catch(() => {
    page.innerHTML = emptyState(icon('alert-triangle', 44), 'Erro na busca');
  });
}
