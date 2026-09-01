import { api } from './api.js';
import { toast } from './utils.js';
import { icon } from './icons.js';
import { renderHome } from './pages/home.js';
import { renderBrowse } from './pages/browse.js';
import { renderSearch } from './pages/search.js';
import { renderDetails } from './pages/details.js';
import { renderServers } from './pages/servers.js';
import { renderSettings } from './pages/settings.js';
import { renderHidden } from './pages/hidden.js';
import { player } from './components/player.js';
import { moveFocus, focusFirst, isTypingTarget } from './nav.js';

const routes = {
  '': renderHome,
  home: renderHome,
  movies: () => renderBrowse({ type: 'movies', title: 'Filmes', subtitle: 'Todos os filmes da sua biblioteca.' }),
  series: () => renderBrowse({ type: 'series', title: 'Séries', subtitle: 'Todas as séries da sua biblioteca.' }),
  anime: () => renderBrowse({ type: 'anime', title: 'Animes', subtitle: 'Animações e animes da sua biblioteca.' }),
  search: (q) => renderSearch(q),
  media: (id) => renderDetails(id),
  servers: renderServers,
  settings: renderSettings,
  hidden: renderHidden,
};

function parseHash() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [route, ...rest] = hash.split('/');
  return { route: route || 'home', param: rest.join('/'), params: rest };
}

async function router() {
  const { route, param, params } = parseHash();
  const page = document.getElementById('page');
  page.scrollTop = 0;
  window.scrollTo(0, 0);

  document.querySelectorAll('.nav a').forEach((a) => {
    a.classList.toggle('active', a.dataset.nav === route || (route === '' && a.dataset.nav === 'home'));
  });
  document.getElementById('sidebar').classList.remove('open');

  const handler = routes[route];
  if (!handler) {
    page.innerHTML = `<div class="empty"><div class="empty-title">Página não encontrada</div><a href="#/" class="btn btn-primary">Voltar para Home</a></div>`;
    return;
  }
  try {
    await handler(param);
  } catch (err) {
    console.error(err);
    page.innerHTML = `<div class="empty"><div class="empty-icon">${icon('alert-triangle', 44)}</div><div class="empty-title">Erro ao carregar a página</div><div>${err.message}</div></div>`;
  }
}

function bindGlobal() {
  const search = document.getElementById('global-search');
  let timer;
  search.addEventListener('input', () => {
    clearTimeout(timer);
    const q = search.value.trim();
    if (!q) { if (location.hash.startsWith('#/search')) location.hash = '#/'; return; }
    timer = setTimeout(() => {
      location.hash = `#/search/${encodeURIComponent(q)}`;
    }, 400);
  });

  const menu = document.getElementById('menu-toggle');
  menu.onclick = () => document.getElementById('sidebar').classList.toggle('open');

  window.addEventListener('hashchange', router);

  // Poll de jobs em execução (para feedback de sincronização)
  setInterval(async () => {
    if (player.overlay && !player.overlay.classList.contains('hidden')) return;
    try {
      const jobs = await api.get('/api/jobs');
      const running = jobs.filter((j) => j.status === 'running');
      const seen = new Set(running.map((j) => j.id));
      if (running.length && !window._jobToastShown) {
        const names = running.map((j) => {
          const labels = { 'library-scan': 'Varredura da biblioteca', discovery: 'Descoberta DLNA', 'metadata-fetch': 'Metadados' };
          return labels[j.type] || j.type;
        }).join(', ');
        toast(`Sincronizando: ${names}…`, 'info', 6000);
        window._jobToastShown = true;
      }
      if (!running.length && window._jobToastShown) {
        window._jobToastShown = false;
        toast('Sincronização concluída', 'success');
      }
    } catch { /* ignore */ }
  }, 5000);

  let keyboardNav = false;
  document.addEventListener('keydown', (e) => {
    if (e.key.startsWith('Arrow') || e.key === 'Enter' || e.key === ' ') keyboardNav = true;
    // Navegação do player tem prioridade
    if (player.isOpen()) return;

    // '/' foca a busca global
    if (e.key === '/' && !isTypingTarget(document.activeElement)) {
      e.preventDefault();
      search.focus();
      return;
    }

    // Escape fecha modais / volta para a página anterior
    if (e.key === 'Escape') {
      const modal = document.querySelector('.cover-modal');
      if (modal) { modal.remove(); return; }
      const active = document.activeElement;
      if (isTypingTarget(active)) {
        if (active.value) active.value = '';
        active.blur();
        return;
      }
      e.preventDefault();
      history.back();
      return;
    }

    // Setas movem o foco entre cards/botões; Enter ativa
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      if (isTypingTarget(document.activeElement)) return;

      // No hero da home, esquerda/direita trocam o slide
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.shiftKey) {
        const hero = document.activeElement?.closest?.('.hero-carousel');
        const btn = hero?.querySelector(e.key === 'ArrowLeft' ? '.hero-arrow.prev' : '.hero-arrow.next');
        if (btn && !btn.classList.contains('disabled')) {
          e.preventDefault();
          btn.click();
          return;
        }
      }

      e.preventDefault();
      if (e.shiftKey) {
        // Shift+seta move entre as seções/linhas (scroll)
        const main = document.getElementById('main');
        const delta = e.key === 'ArrowDown' ? 400 : e.key === 'ArrowUp' ? -400 : 0;
        if (delta) { main.scrollBy({ top: delta, behavior: 'smooth' }); return; }
      }
      moveFocus(e.key.replace('Arrow', '').toLowerCase());
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      const a = document.activeElement;
      if (!a || a === document.body) return;
      const tag = a.tagName;
      // Controles nativos já respondem a Enter/Espaço — não interfere
      if (tag === 'BUTTON' || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'OPTION') return;
      if (isTypingTarget(a)) return;
      e.preventDefault();
      a.click();
    }
  });

  // Ao trocar de página, mantém a navegação por teclado disponível
  window.addEventListener('hashchange', () => {
    if (player.isOpen()) return;
    if (!keyboardNav) return;
    let tries = 0;
    const attempt = () => {
      if (document.activeElement !== document.body) return;
      if (tries++ > 8) return;
      if (focusFirst()) return;
      setTimeout(attempt, 80);
    };
    setTimeout(attempt, 80);
  });
}

async function init() {
  bindGlobal();
  router();

  // stats no sidebar
  try {
    const info = await api.get('/api/system/info');
    document.getElementById('sidebar-stats').innerHTML = `
      <div>${icon('film', 14)} ${info.videos || 0} vídeos</div>
      <div>${icon('server', 14)} ${info.servers || 0} servidores</div>`;
  } catch { /* ignore */ }
}

init();
