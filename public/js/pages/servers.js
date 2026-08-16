import { api } from '../api.js';
import { loading, esc, timeAgo, toast } from '../utils.js';
import { bindCardClicks } from '../components.js';
import { icon } from '../icons.js';

export function renderServers() {
  const page = document.getElementById('page');

  async function load() {
    page.innerHTML = loading();
    let servers = [];
    try { servers = await api.get('/api/servers'); } catch { /* vazio */ }

    const jobs = await api.get('/api/jobs').catch(() => []);
    const activeJobs = jobs.filter((j) => j.status === 'running').slice(-4);

    const jobHtml = activeJobs.length ? `
      <div class="section">
        <div class="section-title" style="margin-bottom:12px">Sincronizações em andamento</div>
        ${activeJobs.map(jobRow).join('')}
      </div>` : '';

    if (!servers.length) {
      page.innerHTML = `
        <h1 class="page-title">Servidores e Pastas</h1>
        <div class="page-sub">Encontre servidores DLNA na sua rede ou adicione pastas locais do computador.</div>
        <div class="discovery-box">
          <div class="big">Nenhuma fonte conectada ainda</div>
          <div class="sub">A aplicação procura servidores DLNA automaticamente (multicast, broadcast e varredura da sub-rede). Você também pode adicionar uma pasta do computador como fonte de mídia.</div>
          <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
            <button class="btn btn-primary" id="discover-btn">${icon('search', 15)} Buscar servidores DLNA</button>
            <button class="btn btn-secondary" id="manual-btn">${icon('plus', 15)} Adicionar manualmente</button>
            <button class="btn btn-secondary" id="local-btn">${icon('folder', 15)} Adicionar pasta local</button>
          </div>
          <div id="manual-form" class="hidden" style="margin-top:16px;text-align:left;background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:14px;max-width:520px;margin-left:auto;margin-right:auto">
            <div style="font-weight:600;margin-bottom:8px">Adicionar servidor por IP</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <input id="manual-host" type="text" placeholder="IP do servidor, ex: 192.168.2.50" style="flex:1;min-width:200px;background:var(--bg-elev);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:9px 12px">
              <input id="manual-port" type="text" placeholder="Porta (opcional)" style="width:90px;background:var(--bg-elev);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:9px 12px">
              <button class="btn btn-primary" id="manual-add">Adicionar</button>
            </div>
            <div id="manual-result" style="margin-top:8px;font-size:13px;color:var(--text-dim)"></div>
          </div>
          <div id="local-form" class="hidden" style="margin-top:16px;text-align:left;background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:14px;max-width:520px;margin-left:auto;margin-right:auto">
            <div style="font-weight:600;margin-bottom:8px">Adicionar pasta local</div>
            ${localForm()}
          </div>
        </div>
        ${jobHtml}`;
      bindCommonActions(page, () => renderServers());
      return;
    }

    const cards = servers.map((s) => `
      <div class="server-card" data-server="${s.id}">
        <div class="server-head">
          <div class="server-status-dot ${statusDot(s)}"></div>
          <div style="flex:1;min-width:0">
            <div class="server-name">${esc(s.name)}</div>
            <div class="server-sub">${s.isLocal
              ? `${icon('folder', 12)} Pasta local · ${esc(s.path || '')}`
              : `${esc([s.manufacturer, s.model].filter(Boolean).join(' · ')) || 'Servidor DLNA'} · ${esc(s.ip || '')}`}</div>
          </div>
          <button class="icon-btn" data-act="refresh" title="Atualizar">${icon('refresh-cw', 16)}</button>
          <button class="icon-btn" data-act="delete" title="Remover">${icon('trash-2', 16)}</button>
        </div>
        <div class="server-stats">
          <div class="server-stat"><div class="val">${s.media_count ?? '–'}</div><div class="lbl">mídias</div></div>
          <div class="server-stat"><div class="val">${s.online ? 'Online' : 'Offline'}</div><div class="lbl">status</div></div>
          <div class="server-stat"><div class="val">${timeAgo(s.last_sync_at)}</div><div class="lbl">última sincronização</div></div>
        </div>
        <div class="server-actions">
          <button class="btn btn-primary btn-sm" data-act="scan">${icon('play', 14)} Sincronizar agora</button>
          <button class="btn btn-secondary btn-sm" data-act="check">${icon('check', 14)} Verificar conexão</button>
          <button class="btn btn-secondary btn-sm" data-act="pause">${s.paused ? `${icon('play', 14)} Retomar` : `${icon('pause', 14)} Pausar`}</button>
        </div>
        ${s.error ? `<div class="server-error">${icon('alert-triangle', 14)} ${esc(s.error)}</div>` : ''}
      </div>`).join('');

    page.innerHTML = `
      <h1 class="page-title">Servidores e Pastas</h1>
      <div class="page-sub">Servidores DLNA na rede e pastas locais do computador.</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:18px">
        <button class="btn btn-primary" id="discover-btn">${icon('search', 15)} Buscar servidores DLNA</button>
        <button class="btn btn-secondary" id="manual-btn">${icon('plus', 15)} Adicionar manualmente</button>
        <button class="btn btn-secondary" id="local-btn">${icon('folder', 15)} Adicionar pasta local</button>
      </div>
      <div id="manual-form" class="hidden" style="background:var(--bg-elev);border:1px solid var(--border);border-radius:12px;padding:16px;margin-bottom:18px;max-width:520px">
        <div style="font-weight:600;margin-bottom:8px">Adicionar servidor por IP</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <input id="manual-host" type="text" placeholder="IP do servidor, ex: 192.168.2.50" style="flex:1;min-width:200px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:9px 12px">
          <input id="manual-port" type="text" placeholder="Porta (opcional)" style="width:90px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:9px 12px">
          <button class="btn btn-primary" id="manual-add">Adicionar</button>
        </div>
        <div id="manual-result" style="margin-top:8px;font-size:13px;color:var(--text-dim)"></div>
      </div>
      <div id="local-form" class="hidden" style="background:var(--bg-elev);border:1px solid var(--border);border-radius:12px;padding:16px;margin-bottom:18px;max-width:520px">
        ${localForm()}
      </div>
      ${jobHtml}
      ${cards}`;

    bindCommonActions(page, load);
    page.querySelectorAll('.server-card').forEach((card) => {
      const id = parseInt(card.dataset.server, 10);
      card.querySelectorAll('[data-act]').forEach((btn) => {
        btn.onclick = async () => {
          const act = btn.dataset.act;
          if (act === 'scan') {
            toast('Sincronização iniciada', 'info');
            api.post(`/api/servers/${id}/scan`).then((r) => {
              if (r.jobId) toast('Varredura da biblioteca em andamento…', 'info');
            }).catch((e) => toast(e.message, 'error'));
          } else if (act === 'delete') {
            if (confirm(`Remover "${card.querySelector('.server-name').textContent}"? A biblioteca local será preservada.`)) {
              await api.del(`/api/servers/${id}`);
              load();
            }
          } else if (act === 'refresh') {
            load();
          } else if (act === 'check') {
            toast('Verificando conectividade…', 'info');
            const r = await api.post(`/api/servers/${id}/check`);
            toast(r.online ? 'Fonte disponível' : 'Fonte indisponível', r.online ? 'success' : 'error');
            load();
          } else if (act === 'pause') {
            await api.post(`/api/servers/${id}/pause`);
            load();
          }
        };
      });
    });
  }

  load();
}

function localForm() {
  const usesPicker = !!(window.electronAPI && window.electronAPI.pickFolder);
  return `
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <input id="local-path" type="text" placeholder="/media/Filmes ou C:\\Media" style="flex:1;min-width:200px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:9px 12px" ${usesPicker ? 'readonly placeholder="Clique em Selecionar…"' : ''}>
      ${usesPicker ? `<button class="btn btn-secondary" id="local-pick">${icon('folder', 14)} Selecionar…</button>` : ''}
      <button class="btn btn-primary" id="local-add">Adicionar</button>
    </div>
    <div id="local-result" style="margin-top:8px;font-size:13px;color:var(--text-dim)"></div>
    ${usesPicker ? '' : '<div style="margin-top:6px;font-size:12px;color:var(--text-dim)">Digite o caminho absoluto da pasta no computador.</div>'}`;
}

function bindCommonActions(page, reload) {
  page.querySelector('#discover-btn').onclick = () => discover(page);
  page.querySelector('#manual-btn').onclick = () => page.querySelector('#manual-form').classList.toggle('hidden');
  page.querySelector('#manual-add').onclick = async () => {
    const host = page.querySelector('#manual-host').value.trim();
    const port = page.querySelector('#manual-port').value.trim();
    const result = page.querySelector('#manual-result');
    if (!host) { result.textContent = 'Informe o IP.'; return; }
    result.textContent = 'Procurando dispositivo UPnP…';
    try {
      const r = await api.post('/api/servers/manual', { host, port: port || undefined });
      result.innerHTML = `${icon('check', 14)} ${esc(r.server.name)} adicionado!`;
      toast(`Servidor ${r.server.name} adicionado`, 'success');
      reload();
    } catch (e) {
      result.innerHTML = `${icon('x', 14)} ${esc(e.message)}`;
      toast(e.message, 'error');
    }
  };

  const localBtn = page.querySelector('#local-btn');
  const localFormEl = page.querySelector('#local-form');
  if (localBtn && localFormEl) {
    localBtn.onclick = () => {
      localFormEl.classList.toggle('hidden');
      if (!localFormEl.classList.contains('hidden') && window.electronAPI && window.electronAPI.pickFolder) {
        pickLocalFolder(page, reload);
      }
    };
  }
  const pickBtn = page.querySelector('#local-pick');
  if (pickBtn) pickBtn.onclick = () => pickLocalFolder(page, reload);
  page.querySelector('#local-add').onclick = () => addLocalFolder(page, reload);

  page.querySelectorAll('[data-cancel]').forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.dataset.cancel;
      btn.disabled = true;
      btn.textContent = 'Cancelando…';
      try {
        const r = await api.post(`/api/jobs/${id}/cancel`);
        toast(r.ok ? 'Sincronização cancelada' : 'Não foi possível cancelar', r.ok ? 'success' : 'error');
      } catch (e) {
        toast(`Erro ao cancelar: ${e.message}`, 'error');
      }
      reload();
    };
  });
}

async function pickLocalFolder(page, reload) {
  try {
    const folderPath = await window.electronAPI.pickFolder();
    if (folderPath) {
      page.querySelector('#local-path').value = folderPath;
      addLocalFolder(page, reload);
    }
  } catch (e) {
    toast(`Erro ao selecionar pasta: ${e.message}`, 'error');
  }
}

async function addLocalFolder(page, reload) {
  const folderPath = page.querySelector('#local-path').value.trim();
  const result = page.querySelector('#local-result');
  if (!folderPath) { result.textContent = 'Informe o caminho da pasta.'; return; }
  result.textContent = 'Adicionando pasta local…';
  try {
    const r = await api.post('/api/servers/local', { path: folderPath });
    result.innerHTML = `${icon('check', 14)} Pasta "${esc(r.server.name)}" adicionada!`;
    toast(`Pasta ${r.server.name} adicionada`, 'success');
    if (r.jobId) toast('Varredura da pasta em andamento…', 'info');
    reload();
  } catch (e) {
    result.innerHTML = `${icon('x', 14)} ${esc(e.message)}`;
    toast(e.message, 'error');
  }
}

function statusDot(s) {
  if (s.paused) return 'dot-paused';
  return s.online ? 'dot-online' : 'dot-offline';
}

function jobRow(j) {
  return `
    <div class="job-row" data-job="${j.id}">
      <div class="job-top">
        <div class="job-type">${esc(jobTypeLabel(j.type))}${j.server_id ? ` · servidor ${j.server_id}` : ''}</div>
        <span class="job-status status-${j.status}">${esc(j.status)}</span>
      </div>
      <div class="job-progress"><div class="fill" style="width:${j.progress}%"></div></div>
      <div class="job-message">${esc(j.message || `${j.current} / ${j.total}`)}</div>
      ${j.status === 'running' ? `<button class="btn btn-secondary btn-sm" style="margin-top:8px" data-cancel="${j.id}">Cancelar</button>` : ''}
    </div>`;
}

function jobTypeLabel(t) {
  return { 'library-scan': 'Varredura da biblioteca', 'library-rescan': 'Re-varredura', discovery: 'Descoberta DLNA', 'metadata-fetch': 'Busca de metadados' }[t] || t;
}

async function discover(page) {
  const btn = page.querySelector('#discover-btn');
  btn.disabled = true;
  btn.textContent = 'Buscando…';
  try {
    const r = await api.post('/api/servers/discover');
    toast(`${r.added} servidor(es) encontrado(s)`, r.added ? 'success' : 'info');
  } catch (e) {
    toast(`Erro: ${e.message}`, 'error');
  }
  btn.disabled = false;
  btn.innerHTML = `${icon('search', 15)} Buscar servidores DLNA`;
  renderServers();
}
