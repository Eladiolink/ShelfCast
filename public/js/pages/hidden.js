import { api } from '../api.js';
import { loading, emptyState, esc, toast } from '../utils.js';
import { icon } from '../icons.js';

export async function renderHidden() {
  const page = document.getElementById('page');
  page.innerHTML = loading();

  let data;
  try {
    data = await api.get('/api/media?hidden=only&perPage=100&page=1');
  } catch (err) {
    page.innerHTML = emptyState(icon('alert-triangle', 44), 'Erro ao carregar', err.message);
    return;
  }

  const items = data.items || [];
  if (!items.length) {
    page.innerHTML = emptyState(icon('eye-off', 44), 'Nada oculto', 'Nenhum vídeo foi ocultado.');
    return;
  }

  const rows = items.map((m) => `
    <div class="hidden-row">
      <div class="hidden-title">${esc(m.title)}</div>
      <div class="hidden-meta">${[m.year, m.format && m.format.toUpperCase(), m.resolution].filter(Boolean).map(esc).join(' · ')}</div>
      <button class="btn btn-secondary btn-sm" data-unhide="${m.id}">${icon('eye', 15)} Mostrar</button>
    </div>`).join('');

  page.innerHTML = `
    <h1 class="page-title">${icon('eye-off', 22)} Ocultos</h1>
    <div class="page-sub">Vídeos que você ocultou.</div>
    <div class="hidden-list">${rows}</div>`;

  page.querySelectorAll('[data-unhide]').forEach((b) => {
    b.onclick = async () => {
      b.disabled = true;
      try {
        await api.post(`/api/media/${b.dataset.unhide}/hide`, { hidden: false });
        toast('Vídeo visível novamente', 'success');
        b.closest('.hidden-row')?.remove();
      } catch (err) {
        toast(err.message, 'error');
        b.disabled = false;
      }
    };
  });
}
