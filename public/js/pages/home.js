import { api } from '../api.js';
import { mediaCard, bindCardClicks } from '../components.js';
import { loading, emptyState, esc, formatDuration } from '../utils.js';
import { icon } from '../icons.js';

function backdropOf(item) {
  if (item.backdrop) return `/data/${item.backdrop}`;
  if (item.poster) return `/data/${item.poster}`;
  return null;
}

function truncate(s, n) {
  if (!s) return '';
  return s.length > n ? s.slice(0, n).trimEnd() + '…' : s;
}

function metaLine(item) {
  const parts = [];
  if (item.rating) parts.push(`${icon('star', 12)} ${esc(Number(item.rating).toFixed(1))}`);
  if (item.year) parts.push(esc(String(item.year)));
  if (item.resolution) parts.push(esc(item.resolution));
  if (item.format) parts.push(esc(String(item.format).toUpperCase()));
  if (item.video_codec) parts.push(esc(item.video_codec));
  if (item.duration) parts.push(esc(formatDuration(item.duration)));
  return parts.join('  ·  ');
}

function heroSlide(item, i) {
  const bg = backdropOf(item);
  const style = bg
    ? `style="background-image:url('${esc(bg)}')"`
    : 'style="background:linear-gradient(135deg,#2a2f3d,#0f1117)"';
  const meta = metaLine(item);
  const overview = item.overview || item.description || '';
  return `
    <div class="hero-slide ${i === 0 ? 'active' : ''}" data-slide="${i}" ${style}>
      <div class="hero-overlay"></div>
      <div class="hero-content">
        ${meta ? `<div class="hero-meta">${meta}</div>` : ''}
        <div class="hero-title">${esc(item.title || 'Sem título')}</div>
        ${overview ? `<div class="hero-overview">${esc(truncate(overview, 200))}</div>` : ''}
        <div class="hero-actions">
          <button class="btn btn-primary" data-hero-watch="${item.id}">${icon('play', 15)} Assistir</button>
          <button class="btn btn-secondary" data-hero-info="${item.id}">${icon('info', 15)} Detalhes</button>
        </div>
      </div>
    </div>`;
}

function heroCarousel(items) {
  if (!items || !items.length) return '';
  const dots = items.map((_, i) => `<button class="hero-dot ${i === 0 ? 'active' : ''}" data-dot="${i}"></button>`).join('');
  return `
    <section class="hero">
      <div class="hero-carousel">
        ${items.map(heroSlide).join('')}
        <button class="hero-arrow prev" title="Anterior">${icon('chevron-left', 24)}</button>
        <button class="hero-arrow next" title="Próximo">${icon('chevron-right', 24)}</button>
        <div class="hero-dots">${dots}</div>
      </div>
    </section>`;
}

function row(cards, cls) {
  return `
    <div class="row-wrap">
      <button class="row-arrow left" title="Anterior">${icon('chevron-left', 22)}</button>
      <div class="row-scroll ${cls || ''}">${cards}</div>
      <button class="row-arrow right" title="Próximo">${icon('chevron-right', 22)}</button>
    </div>`;
}

function bindRowScrollers(container) {
  container.querySelectorAll('.row-wrap').forEach((wrap) => {
    const scroller = wrap.querySelector('.row-scroll');
    const left = wrap.querySelector('.row-arrow.left');
    const right = wrap.querySelector('.row-arrow.right');
    if (!scroller || !left || !right) return;

    const step = () => {
      const item = scroller.querySelector('.row-item');
      const gap = parseFloat(getComputedStyle(scroller).columnGap) || 14;
      return ((item ? item.offsetWidth : 150) + gap) * 2;
    };
    const update = () => {
      left.classList.toggle('disabled', scroller.scrollLeft <= 0);
      right.classList.toggle('disabled', scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 4);
    };
    left.onclick = () => scroller.scrollBy({ left: -step(), behavior: 'smooth' });
    right.onclick = () => scroller.scrollBy({ left: step(), behavior: 'smooth' });
    scroller.addEventListener('scroll', update);
    update();
  });
}

function posterRow(items) {
  return row(items.map((i) => `<div class="row-item">${mediaCard(i)}</div>`).join(''));
}

function landscapeRow(items) {
  return row(items.map((i) => `<div class="row-item landscape">${mediaCard(i, { landscape: true, subtitle: '' })}</div>`).join(''));
}

function section(title, link, inner) {
  if (!inner) return '';
  return `
    <section class="section">
      <div class="section-head">
        <div class="section-title">${title}</div>
        ${link ? `<a href="${link}" class="section-link">Ver todos ${icon('chevron-right', 14)}</a>` : ''}
      </div>
      ${inner}
    </section>`;
}

export async function renderHome() {
  const page = document.getElementById('page');
  page.innerHTML = loading();

  const data = await api.get('/api/dashboard');

  const heroItems = (data.recentlyAdded && data.recentlyAdded.length ? data.recentlyAdded : data.movies || []);
  const carousel = heroCarousel(heroItems.slice(0, 6));

  const sections = [];

  if (data.continueWatching?.length) {
    sections.push(section(`${icon('play', 16)} Continuar assistindo`, '', landscapeRow(data.continueWatching)));
  }

  sections.push(section(`${icon('film', 16)} Filmes`, '#/movies', data.movies?.length ? posterRow(data.movies) : ''));
  sections.push(section(`${icon('tv', 16)} Séries`, '#/series', data.series?.length ? posterRow(data.series.map((s) => ({ ...s, id: s.media_id, hideable: false }))) : ''));

  if (data.anime?.length) {
    sections.push(section(`${icon('sparkles', 16)} Animes`, '#/anime', posterRow(data.anime.map((i) => ({ ...i, id: i.media_id || i.id })))));
  }

  page.innerHTML = carousel + sections.join('');

  bindCardClicks(page, (id) => { location.hash = `#/media/${id}`; });
  bindRowScrollers(page);

  // Hero carousel logic
  const carouselEl = page.querySelector('.hero-carousel');
  if (carouselEl) {
    const slides = [...carouselEl.querySelectorAll('.hero-slide')];
    const dots = [...carouselEl.querySelectorAll('.hero-dot')];
    let current = 0;
    let timer = null;

    const show = (i) => {
      current = (i + slides.length) % slides.length;
      slides.forEach((s, k) => s.classList.toggle('active', k === current));
      dots.forEach((d, k) => d.classList.toggle('active', k === current));
    };
    const start = () => { stop(); timer = setInterval(() => show(current + 1), 6500); };
    const stop = () => { if (timer) clearInterval(timer); timer = null; };

    carouselEl.querySelector('.hero-arrow.prev').onclick = () => { show(current - 1); start(); };
    carouselEl.querySelector('.hero-arrow.next').onclick = () => { show(current + 1); start(); };
    dots.forEach((d) => { d.onclick = () => { show(parseInt(d.dataset.dot, 10)); start(); }; });
    carouselEl.addEventListener('mouseenter', stop);
    carouselEl.addEventListener('mouseleave', start);
    start();
  }

  // Hero buttons
  page.querySelectorAll('[data-hero-watch]').forEach((b) => {
    b.onclick = () => { location.hash = `#/media/${b.dataset.heroWatch}`; };
  });
  page.querySelectorAll('[data-hero-info]').forEach((b) => {
    b.onclick = () => { location.hash = `#/media/${b.dataset.heroInfo}`; };
  });

  if (!data.stats || data.stats.total === 0) {
    page.innerHTML = emptyState(icon('clapperboard', 44), 'Sua biblioteca está vazia',
      'Descubra servidores DLNA na rede para começar.') +
      `<div style="text-align:center"><a href="#/servers" class="btn btn-primary">Descobrir servidores</a></div>`;
  }
}
