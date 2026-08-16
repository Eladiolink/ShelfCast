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

  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !/input|textarea|select/.test(document.activeElement?.tagName || '')) {
      e.preventDefault();
      search.focus();
    }
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
