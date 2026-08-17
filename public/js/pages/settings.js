import { api } from '../api.js';
import { loading, esc, toast } from '../utils.js';
import { icon } from '../icons.js';

export async function renderSettings() {
  const page = document.getElementById('page');
  page.innerHTML = loading();
  const s = await api.get('/api/settings');

  const card = (title, desc, rows) => `
    <div class="setting-card">
      <h4>${title}</h4>
      <div class="desc">${desc}</div>
      ${rows.map((r) => `<div class="setting-row"><span class="k">${r.k}</span><span class="v">${r.v}</span></div>`).join('')}
    </div>`;

  const cards = [
    card('Servidor', 'Endereço e porta de acesso.', [
      { k: 'Host', v: s.host },
      { k: 'Porta', v: s.port },
    ]),
    card('Sincronização', 'Intervalo de varredura automática dos servidores.', [
      { k: 'Intervalo', v: s.scanInterval },
      { k: 'Diretório de dados', v: s.dataDir },
    ]),
    card('Metadados', 'Provedores de metadados externos.', [
      { k: 'Metadados habilitados', v: s.enableMetadata ? 'Sim' : 'Não' },
      { k: 'TMDB', v: s.tmdbConfigured ? (s.tmdbEnabled ? `Configurado ${icon('check', 14)}` : 'Desabilitado') : 'Sem chave' },
      { k: 'TVMaze', v: s.tvMazeEnabled ? 'Habilitado' : 'Desabilitado' },
      { k: 'AniList', v: s.anilistEnabled ? 'Habilitado' : 'Desabilitado' },
    ]),
    `
    <div class="setting-card">
      <h4>TMDB — chave da API</h4>
      <div class="desc">Necessária para casar filmes e séries com títulos em pt-BR (pôster, sinopse, avaliações). Obtenha gratuitamente em <code>themoviedb.org/settings/api</code>. A chave é salva no <code>.env</code> e ativada imediatamente.</div>
      <div class="setting-row" style="flex-direction:column;align-items:stretch;gap:10px">
        <input id="tmdb-key-input" type="password" placeholder="${s.tmdbConfigured ? 'Chave já configurada — cole a nova para substituir' : 'Cole sua chave TMDB aqui'}" autocomplete="off" style="width:100%;background:var(--bg-elev-2);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:9px 12px;box-sizing:border-box">
        <div style="display:flex;gap:8px">
          <button class="btn btn-primary" id="save-tmdb">Salvar</button>
          ${s.tmdbConfigured ? '<button class="btn btn-secondary" id="remove-tmdb">Remover</button>' : ''}
        </div>
      </div>
      <div id="tmdb-msg" style="font-size:12.5px;color:var(--text-faint);margin-top:8px"></div>
    </div>`,
    card('Reprodução', 'Player e transcodificação.', [
      { k: 'Transcodificação (FFmpeg)', v: s.enableTranscode ? 'Habilitado' : 'Desabilitado' },
      { k: 'Caminho do FFmpeg', v: s.ffmpegPath },
    ]),
    card('Logs', 'Nível de log.', [
      { k: 'Nível', v: s.logLevel },
    ]),
  ];

  page.innerHTML = `
    <h1 class="page-title">Configurações</h1>
    <div class="page-sub">As configurações são lidas do arquivo <code>.env</code>. Reinicie o serviço após alterar.</div>
    <div class="settings-grid">
      ${cards.join('')}
    </div>
    <div class="section" style="margin-top:26px">
      <div class="section-title" style="margin-bottom:12px">Diagnóstico do FFmpeg</div>
      <button class="btn btn-secondary" id="test-ffmpeg">Testar FFmpeg</button>
      <div id="ffmpeg-result" style="margin-top:10px;font-size:13px"></div>
    </div>
    <div class="section" style="margin-top:26px">
      <div class="section-title" style="margin-bottom:12px">Gatilhos</div>
      <button class="btn btn-primary" id="scan-metadata">${icon('refresh-cw', 15)} Buscar metadados para toda a biblioteca</button>
    </div>
    <div class="section" style="margin-top:26px">
      <div class="section-title" style="margin-bottom:12px">Logs recentes</div>
      <div class="logs-box" id="logs-box">Carregando…</div>
    </div>`;

  page.querySelector('#test-ffmpeg').onclick = async () => {
    const el = page.querySelector('#ffmpeg-result');
    el.textContent = 'Testando…';
    const r = await api.post('/api/settings/test-transcode');
    el.innerHTML = r.ok ? `${icon('check', 14)} ${esc(r.version)}` : `${icon('x', 14)} ${esc(r.error)}`;
  };

  const keyInput = page.querySelector('#tmdb-key-input');
  const saveBtn = page.querySelector('#save-tmdb');
  const msgEl = page.querySelector('#tmdb-msg');
  const tmdbRow = [...page.querySelectorAll('.setting-card .setting-row')]
    .map((row) => row.querySelector('.k'))
    .filter((k) => k && k.textContent === 'TMDB')
    .map((k) => k.parentElement)[0];

  const submitKey = async (clear) => {
    const key = clear ? '' : keyInput.value.trim();
    if (!clear && !key) { msgEl.innerHTML = `${icon('x', 13)} Informe a chave da API.`; return; }
    saveBtn.disabled = true;
    try {
      const r = await api.put('/api/settings', { tmdbApiKey: key });
      msgEl.innerHTML = `${icon('check', 13)} ${r.tmdbConfigured ? 'Chave salva e ativa. Use "Buscar metadados para toda a biblioteca" para re-casar as mídias já existentes.' : 'Chave removida. Os metadados usarão apenas os provedores sem chave.'}`;
      keyInput.value = '';
      toast(r.tmdbConfigured ? 'Chave TMDB salva' : 'Chave TMDB removida', 'info');
      if (tmdbRow) tmdbRow.querySelector('.v').innerHTML = r.tmdbConfigured ? `Configurado ${icon('check', 14)}` : 'Sem chave';
    } catch (e) {
      msgEl.innerHTML = `${icon('x', 13)} ${esc(e.message)}`;
    } finally {
      saveBtn.disabled = false;
    }
  };

  saveBtn.onclick = () => submitKey(false);
  page.querySelector('#remove-tmdb')?.addEventListener('click', () => submitKey(true));

  page.querySelector('#scan-metadata').onclick = async () => {
    const r = await api.post('/api/metadata/scan').catch((e) => ({ error: e.message }));
    if (r.error) toast(r.error, 'error');
    else toast('Busca de metadados iniciada', 'info');
  };

  page.querySelector('#logs-box').onclick = async () => {
    const r = await fetch('/api/system/logs').catch(() => null);
    if (r && r.ok) page.querySelector('#logs-box').textContent = await r.text();
  };

  try {
    const r = await fetch('/api/system/logs');
    if (r.ok) page.querySelector('#logs-box').textContent = await r.text();
    else page.querySelector('#logs-box').textContent = 'Logs indisponíveis (verifique o diretório de dados).';
  } catch {
    page.querySelector('#logs-box').textContent = 'Logs indisponíveis.';
  }
}
