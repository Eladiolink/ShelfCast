import { api } from '../api.js';
import { player } from '../components/player.js';
import { loading, emptyState, esc, formatDuration, formatSize, toast } from '../utils.js';
import { chip, sourceRow } from '../components.js';
import { icon } from '../icons.js';

export async function renderDetails(id) {
  const page = document.getElementById('page');
  page.innerHTML = loading();

  let data;
  try {
    data = await api.get(`/api/media/${id}`);
  } catch (err) {
    page.innerHTML = emptyState(icon('alert-triangle', 44), 'Mídia não encontrada', err.message);
    return;
  }

  const m = data;
  const movie = m.movie;
  const ep = m.episode;
  const poster = m.poster || movie?.poster_path || null;
  const backdrop = m.backdrop || movie?.backdrop_path || null;

  const backdropHtml = backdrop ? `<div class="detail-backdrop" style="background-image:url('/data/${backdrop}')"></div>` : '';
  const posterHtml = `<div class="detail-poster"><img src="${poster ? `/data/${poster}` : '/placeholder.svg'}" onerror="this.style.display='none';this.nextElementSibling.style.display='grid'"><div class="no-poster" style="display:none">${icon('play', 44)}</div></div>`;

  const starChip = (r) => `<span class="chip chip-accent">${icon('star', 12)} ${Number(r).toFixed(1)}</span>`;

  const meta = [];
  if (m.year) meta.push(chip(String(m.year)));
  if (movie?.rating) meta.push(starChip(movie.rating));
  else if (m.rating) meta.push(starChip(m.rating));
  if (m.duration) meta.push(chip(formatDuration(m.duration)));
  if (movie?.runtime) meta.push(chip(`${movie.runtime} min`));
  if (m.resolution) meta.push(chip(m.resolution));
  if (m.format) meta.push(chip(m.format.toUpperCase()));
  if (m.video_codec) meta.push(chip(m.video_codec));
  if (m.audio_codec) meta.push(chip(m.audio_codec));
  if (m.hdr) meta.push(chip('HDR', 'chip-accent'));
  if (m.server) meta.push(`<span class="chip">${icon('monitor', 13)} ${esc(m.server.name)}</span>`);
  for (const g of (m.genres || [])) meta.push(chip(g));

  const overview = m.overview || movie?.overview || m.description || '';

  const continueInfo = m.history && m.history.position > 0 && !m.history.finished
    ? ` · Continuar em ${formatDuration(m.history.position)}`
    : '';

  const watchBtn = `
    <button class="btn btn-primary watch-btn" data-watch="${m.id}">
      ${icon('play', 15)} ${m.history && m.history.position > 0 && !m.history.finished ? 'Continuar' : 'Assistir'}
    </button>`;

  // Sources - duplicate handling across servers
  let sourcesHtml = '';
  const srcList = m.sources || [];
  if (srcList.length > 1) {
    sourcesHtml = `
      <div class="detail-sources">
        <div style="font-size:14px;font-weight:700;color:var(--text-dim);margin-bottom:4px">Fontes:</div>
        ${srcList.map((s) => sourceRow(s)).join('')}
      </div>`;
  }

  // Episodes (if this is a series episode)
  let episodesHtml = '';
  if (m.season && Array.isArray(m.season) && m.season.length) {
    episodesHtml = m.season.map((season) => `
      <div class="episode-group">
        <div class="episode-group-title">
          ${esc(season.title || `Temporada ${season.season_number}`)}
          <span class="chip">${season.episodes.length} episódios</span>
        </div>
        ${season.episodes.map((e) => {
          const epTitle = e.title || '';
          const watched = e.media?.history?.finished ? ` ${icon('check', 14)}` : '';
          return `
          <div class="episode-row" data-episode="${e.id}" data-media="${e.media?.id || ''}">
            <div class="num">${e.episode_number}</div>
            <div class="ep-title">${esc(epTitle || `Episódio ${e.episode_number}`)}${watched}</div>
            ${e.media?.duration ? `<div class="ep-extra">${formatDuration(e.media.duration)}</div>` : ''}
          </div>`;
        }).join('')}
      </div>`).join('');
  }

  const peopleHtml = (m.people?.length) ? `
    <div class="info-block">
      <h4>Elenco & Equipe</h4>
      <div class="people-list">${m.people.map((p) => `<span class="person-tag" title="${esc(p.role)}">${esc(p.name)}</span>`).join('')}</div>
    </div>` : '';

  const sidebar = `
    <div class="detail-sidebar">
      <div class="info-block">
        <h4>Informações</h4>
        ${m.server ? `<div class="info-row"><span class="k">Servidor</span><span class="v">${esc(m.server.name)}</span></div>` : ''}
        ${m.year ? `<div class="info-row"><span class="k">Ano</span><span class="v">${esc(String(m.year))}</span></div>` : ''}
        ${movie?.release_date ? `<div class="info-row"><span class="k">Lançamento</span><span class="v">${esc(movie.release_date)}</span></div>` : ''}
        ${m.resolution ? `<div class="info-row"><span class="k">Resolução</span><span class="v">${esc(m.resolution)}</span></div>` : ''}
        ${m.width ? `<div class="info-row"><span class="k">Dimensões</span><span class="v">${m.width}×${m.height}</span></div>` : ''}
        ${m.video_codec ? `<div class="info-row"><span class="k">Codec de vídeo</span><span class="v">${esc(m.video_codec)}</span></div>` : ''}
        ${m.audio_codec ? `<div class="info-row"><span class="k">Codec de áudio</span><span class="v">${esc(m.audio_codec)}</span></div>` : ''}
        ${m.format ? `<div class="info-row"><span class="k">Formato</span><span class="v">${esc(m.format.toUpperCase())}</span></div>` : ''}
        ${m.size ? `<div class="info-row"><span class="k">Tamanho</span><span class="v">${formatSize(m.size)}</span></div>` : ''}
        ${movie?.tagline ? `<div class="info-row"><span class="k">Tagline</span><span class="v">${esc(movie.tagline)}</span></div>` : ''}
      </div>
      ${peopleHtml}
    </div>`;

  const body = `
    <div class="detail-hero">
      ${backdropHtml}
      <div class="detail-hero-content">
        ${posterHtml}
        <div class="detail-info">
          <div class="detail-title-row">
            <div class="detail-title" id="detail-title">${esc(m.title)}</div>
            <button class="btn btn-secondary btn-sm" id="edit-title-btn" title="Editar título">${icon('pencil', 14)}</button>
          </div>
          ${m.original_title && m.original_title !== m.title ? `<div class="detail-original">${esc(m.original_title)}</div>` : ''}
          ${m.series ? `<div class="detail-original">${esc(m.series.title)} · S${m.episode?.season_id ? seasonOf(m) : ''}E${m.episode?.episode_number || ''}</div>` : ''}
          <div class="detail-meta">${meta.join('')}</div>
          ${overview ? `<div class="detail-overview">${esc(overview)}</div>` : ''}
          <div class="detail-actions">
            ${watchBtn}
            ${continueInfo ? `<span class="chip" style="align-self:center">${esc(continueInfo)}</span>` : ''}
            <button class="btn btn-secondary" id="hide-btn">${icon('eye', 15)} ${m.hidden ? 'Mostrar' : 'Ocultar'}</button>
            <button class="btn btn-secondary" id="cover-btn" title="Definir capa personalizada">${icon('image', 15)} Capa</button>
            <button class="btn btn-secondary" id="refresh-meta-btn" title="Rebuscar metadados">${icon('refresh-cw', 15)} Metadados</button>
            <button class="btn btn-secondary" id="back-btn">${icon('arrow-left', 15)} Voltar</button>
          </div>
          ${sourcesHtml}
        </div>
      </div>
    </div>

    <div class="detail-body">
      <div>
        ${episodesHtml}
      </div>
      ${sidebar}
    </div>`;

  page.innerHTML = body;

  page.querySelectorAll('[data-watch]').forEach((btn) => {
    btn.onclick = () => openPlayer(data, parseInt(btn.dataset.watch, 10));
  });
  page.querySelectorAll('[data-episode]').forEach((row) => {
    row.onclick = () => {
      const mediaId = row.dataset.media;
      if (mediaId) openPlayerById(parseInt(mediaId, 10));
    };
  });
  page.querySelectorAll('[data-watch]').forEach((b) => b.onclick);

  const back = page.querySelector('#back-btn');
  if (back) back.onclick = () => history.back();

  const hideBtn = page.querySelector('#hide-btn');
  if (hideBtn) {
    hideBtn.onclick = async () => {
      const hidden = !m.hidden;
      try {
        await api.post(`/api/media/${id}/hide`, { hidden });
        m.hidden = hidden;
        hideBtn.innerHTML = `${icon('eye', 15)} ${hidden ? 'Mostrar' : 'Ocultar'}`;
        toast(hidden ? 'Vídeo ocultado' : 'Vídeo visível novamente', 'success');
      } catch (err) { toast(err.message, 'error'); }
    };
  }

  const editTitleBtn = page.querySelector('#edit-title-btn');
  if (editTitleBtn) editTitleBtn.onclick = () => startEditTitle();

  const refreshMetaBtn = page.querySelector('#refresh-meta-btn');
  if (refreshMetaBtn) {
    refreshMetaBtn.onclick = async () => {
      refreshMetaBtn.disabled = true;
      refreshMetaBtn.innerHTML = `${icon('refresh-cw', 15)} Buscando…`;
      try {
        await api.post(`/api/media/${id}/metadata`);
        toast('Metadados atualizados', 'success');
        renderDetails(id);
      } catch (err) {
        toast(err.message, 'error');
        refreshMetaBtn.disabled = false;
        refreshMetaBtn.innerHTML = `${icon('refresh-cw', 15)} Metadados`;
      }
    };
  }

  const coverBtn = page.querySelector('#cover-btn');
  if (coverBtn) coverBtn.onclick = () => openCoverModal();

  function openCoverModal() {
    const existing = document.getElementById('cover-modal');
    if (existing) existing.remove();

    const candidates = [];
    if (m.poster) candidates.push({ path: m.poster, label: 'Pôster atual' });
    if (m.backdrop && m.backdrop !== m.poster) candidates.push({ path: m.backdrop, label: 'Backdrop' });

    const optionsHtml = candidates.length
      ? `<div class="cover-options">${candidates.map((c) => `
          <div class="cover-opt" data-path="${esc(c.path)}" title="${esc(c.label)}">
            <img src="/data/${esc(c.path)}" alt="${esc(c.label)}" onerror="this.parentElement.style.display='none'">
            <span>${esc(c.label)}</span>
          </div>`).join('')}</div>`
      : '';

    const modal = document.createElement('div');
    modal.id = 'cover-modal';
    modal.className = 'cover-modal';
    modal.innerHTML = `
      <div class="cover-modal-box">
        <h4>Definir imagem personalizada</h4>
        <label class="cover-target-row">
          <span>Aplicar como</span>
          <select id="cover-target">
            <option value="poster">Capa (pôster)</option>
            <option value="thumbnail">Thumbnail</option>
          </select>
        </label>
        ${optionsHtml}
        <div class="cover-url-row">
          <input type="text" id="cover-url" placeholder="https://exemplo.com/imagem.jpg">
          <button class="btn btn-primary btn-sm" id="cover-url-go">Usar URL</button>
        </div>
        <div class="cover-divider">ou</div>
        <label class="btn btn-secondary btn-sm" for="cover-file">${icon('upload', 15)} Escolher arquivo local</label>
        <input type="file" id="cover-file" accept="image/*" style="display:none">
        <div class="cover-actions">
          <button class="btn btn-ghost btn-sm" id="cover-remove">Remover imagem</button>
          <button class="btn btn-ghost btn-sm" id="cover-close">Fechar</button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    const target = () => modal.querySelector('#cover-target').value || 'poster';
    const setFromPath = async (path) => {
      try {
        await api.post(`/api/media/${id}/image?target=${target()}`, { path });
        toast(target() === 'thumbnail' ? 'Thumbnail definido' : 'Capa definida', 'success');
        modal.remove();
        renderDetails(id);
      } catch (err) { toast(err.message, 'error'); }
    };

    modal.querySelectorAll('.cover-opt').forEach((opt) => {
      opt.onclick = () => setFromPath(opt.dataset.path);
    });

    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    modal.querySelector('#cover-close').onclick = () => modal.remove();

    modal.querySelector('#cover-url-go').onclick = async () => {
      const url = modal.querySelector('#cover-url').value.trim();
      if (!url) return toast('Cole uma URL de imagem', 'warn');
      const btn = modal.querySelector('#cover-url-go');
      btn.disabled = true;
      try {
        await api.post(`/api/media/${id}/image?target=${target()}`, { url });
        toast(target() === 'thumbnail' ? 'Thumbnail definido' : 'Capa definida', 'success');
        modal.remove();
        renderDetails(id);
      } catch (err) {
        toast(err.message, 'error');
        btn.disabled = false;
      }
    };

    modal.querySelector('#cover-file').onchange = async () => {
      const f = modal.querySelector('#cover-file').files[0];
      if (!f) return;
      try {
        const res = await fetch(`/api/media/${id}/image?target=${target()}`, {
          method: 'POST',
          headers: { 'Content-Type': f.type || 'image/jpeg' },
          body: f,
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
        toast(target() === 'thumbnail' ? 'Thumbnail definido' : 'Capa definida', 'success');
        modal.remove();
        renderDetails(id);
      } catch (err) {
        toast(err.message, 'error');
      }
    };

    modal.querySelector('#cover-remove').onclick = async () => {
      try {
        await api.del(`/api/media/${id}/image?target=${target()}`);
        toast('Imagem removida', 'success');
        modal.remove();
        renderDetails(id);
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  }

  function startEditTitle() {
    const titleEl = page.querySelector('#detail-title');
    const current = m.title || '';
    editTitleBtn.style.display = 'none';
    titleEl.innerHTML = `
      <input type="text" id="title-input" value="${esc(current)}" placeholder="Título manual" autocomplete="off">
      <button class="btn btn-primary btn-sm" id="save-title">Salvar</button>
      <button class="btn btn-secondary btn-sm" id="cancel-title">Cancelar</button>`;
    const input = titleEl.querySelector('#title-input');
    input.focus();
    input.select();

    titleEl.querySelector('#cancel-title').onclick = () => renderDetails(id);
    titleEl.querySelector('#save-title').onclick = async () => {
      const val = titleEl.querySelector('#title-input').value.trim();
      try {
        const r = await api.post(`/api/media/${id}/title`, { title: val });
        if (r.title) toast(`Título salvo: ${r.title}`, 'success');
        else toast('Título manual removido (voltou ao automático)', 'success');
        renderDetails(id);
      } catch (err) {
        toast(err.message, 'error');
        editTitleBtn.style.display = '';
        titleEl.textContent = current;
      }
    };
  }

  // If an episode row lacks media, open the series root instead
  async function openPlayerById(mediaId) {
    if (!mediaId) return toast('Episódio ainda não associado a um arquivo', 'warn');
    try {
      const d = await api.get(`/api/media/${mediaId}`);
      openPlayer(d, mediaId);
    } catch { toast('Falha ao abrir episódio', 'error'); }
  }
}

function seasonOf(m) {
  const s = Array.isArray(m.season) ? m.season : [];
  const ep = m.episode;
  if (!ep || typeof ep !== 'object') return '';
  const found = s.find((se) => se.episodes.some((e) => e.id === ep.id));
  return found ? String(found.season_number) : '';
}

function openPlayer(data, id) {
  const media = {
    id,
    title: data.title,
    duration: data.duration,
    format: data.format,
    url: data.url,
    mime_type: data.mime_type,
    subtitles: data.subtitles,
    history: data.history,
    series: data.series || null,
  };
  // data.episode pode ser um objeto (episódio casado) ou um número (episódio sem metadados)
  const epNum = data.episode && typeof data.episode === 'object' ? data.episode.episode_number : data.episode;
  const seasonNum = Array.isArray(data.season) ? seasonOf(data) : data.season;
  const suffix = data.episode ? ` · S${seasonNum || ''}E${epNum || ''}` : '';
  player.open({
    media,
    title: `${data.title}${suffix}`,
    resume: data.history?.position || null,
  });
}
