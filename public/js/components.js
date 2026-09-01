import { api } from './api.js';
import { esc, badgeFor, posterFor, formatDuration, formatSize, toast } from './utils.js';
import { icon } from './icons.js';

export function mediaCard(item, opts = {}) {
  const poster = posterFor(item);
  const badge = badgeFor(item);
  const rating = item.rating ? `<div class="media-card-rating">${icon('star', 12)} ${Number(item.rating).toFixed(1)}</div>` : '';
  const res = item.resolution ? `<div class="media-card-res">${esc(item.resolution)}</div>` : '';
  const progress = item.progress ? `
    <div class="media-card-progress"><div class="fill" style="width:${item.progress}%"></div></div>` : '';
  const cls = opts.landscape ? 'media-card media-card-landscape' : 'media-card';
  const sub = item.sub || opts.subtitle || (item.year ? esc(item.year) : '');
  const hideable = opts.hideable !== false && item.hideable !== false;
  const hideBtn = hideable ? `<button class="card-hide" data-hide="${item.id}" title="Ocultar">${icon('eye-off', 14)}</button>` : '';
  return `
    <div class="${cls}" data-card data-id="${item.id}" tabindex="-1">
      <div class="media-card-poster">
        ${poster ? `<img loading="lazy" src="${esc(poster)}" alt="${esc(item.title)}" onerror="this.style.display='none';this.nextElementSibling.style.display='grid'">` : ''}
        <div class="no-poster" ${poster ? 'style="display:none"' : ''}>▶</div>
        ${badge ? `<div class="media-card-badge">${badge}</div>` : ''}
        ${rating}${res}
        ${progress}
        ${hideBtn}
      </div>
      <div class="media-card-info">
        <div class="media-card-title" title="${esc(item.title)}">${esc(item.title)}</div>
        <div class="media-card-meta"><span>${sub}</span></div>
      </div>
    </div>`;
}

export function mediaGrid(items, opts = {}) {
  if (!items || !items.length) return '';
  return `<div class="media-grid">${items.map((i) => mediaCard(i, opts)).join('')}</div>`;
}

export function bindCardClicks(container, onOpen) {
  if (!container) return;
  container.querySelectorAll('[data-card]').forEach((card) => {
    card.addEventListener('click', () => {
      const id = card.dataset.id;
      if (id) onOpen(id);
    });
  });
  container.querySelectorAll('[data-hide]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.hide;
      btn.disabled = true;
      try {
        await api.post(`/api/media/${id}/hide`, { hidden: true });
        toast('Vídeo ocultado', 'success');
        const card = btn.closest('[data-card]');
        if (card) card.remove();
      } catch (err) {
        toast(err.message, 'error');
        btn.disabled = false;
      }
    });
  });
}

export function pagination(page, total, perPage, onChange) {
  const pages = Math.max(1, Math.ceil(total / perPage));
  if (pages <= 1) return '';
  const wrap = document.createElement('div');
  wrap.className = 'pagination';
  wrap.innerHTML = `
    <button class="btn btn-secondary btn-sm" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>‹ Anterior</button>
    <span class="info">Página ${page} de ${pages} · ${total} itens</span>
    <button class="btn btn-secondary btn-sm" data-page="${page + 1}" ${page >= pages ? 'disabled' : ''}>Próxima ›</button>`;
  wrap.querySelectorAll('button[data-page]').forEach((b) => {
    b.addEventListener('click', () => {
      const p = parseInt(b.dataset.page, 10);
      if (p >= 1 && p <= pages) onChange(p);
    });
  });
  return wrap;
}

export function sourceRow(source, onWatch) {
  return `
    <div class="source-row">
      <div class="source-info">
        <div class="source-name">${icon('monitor', 15)} ${esc(source.server_name || 'Servidor')}</div>
        <div class="source-meta">
          ${[source.resolution, source.format && source.format.toUpperCase(), source.video_codec, formatSize(source.size)].filter(Boolean).join(' · ')}
        </div>
      </div>
      <button class="btn btn-primary btn-sm watch-btn" data-watch="${source.id}">▶ Assistir</button>
    </div>`;
}

export function chip(text, cls = '') {
  return `<span class="chip ${cls}">${esc(text)}</span>`;
}
