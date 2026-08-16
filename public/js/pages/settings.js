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
