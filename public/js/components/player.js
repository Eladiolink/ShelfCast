import { api, streamUrl, tracksUrl, subtitleUrl } from '../api.js';
import { formatDuration, toast, esc } from '../utils.js';
import { icon } from '../icons.js';

const SKIP_THRESHOLD = 10;

const LANG = {
  eng: 'Inglês', por: 'Português', pt: 'Português', spa: 'Espanhol', es: 'Espanhol',
  jpn: 'Japonês', ja: 'Japonês', fre: 'Francês', fr: 'Francês', ger: 'Alemão', de: 'Alemão',
  ita: 'Italiano', it: 'Italiano', kor: 'Coreano', ko: 'Coreano', zho: 'Chinês', chi: 'Chinês',
  zh: 'Chinês', rus: 'Russo', ru: 'Russo', ara: 'Árabe', ar: 'Árabe', tur: 'Turco', tr: 'Turco',
};

function langLabel(code) {
  if (!code) return '';
  const k = String(code).toLowerCase();
  return LANG[k] || k.toUpperCase();
}

class VideoPlayer {
  constructor() {
    this.overlay = document.getElementById('player-overlay');
    this.media = null;
    this.video = null;
    this.ui = null;
    this.hidden = false;
    this.hideTimer = null;
    this.saveTimer = null;
    this.played = false;
    this.onClose = null;
    this.resume = null;
    this._mpvCloseCb = null;
    this._wasMpv = false;
    this.tracks = { audio: [], subtitles: [] };
    this.currentAudio = null;
    this._loadedTracks = false;
    this.startOffset = 0;
    this.volume = 1;
    this.muted = false;
    this._audioCtx = null;
    this._gainNode = null;
    this._fsBound = false;
    this._pendingClose = false;
    this._fsActive = false;
    if (window.electronAPI && window.electronAPI.onMpvClosed) {
      window.electronAPI.onMpvClosed((data) => {
        if (this._mpvCloseCb) this._mpvCloseCb(data);
      });
    }
  }

  open({ media, title, resume = null, onClose = null }) {
    this.media = media;
    this.resume = resume;
    this.onClose = onClose;
    this.title = title;
    // O player web roda DENTRO da janela do app. MKV é convertido via remux
    // pelo servidor (rápido, sem re-encode pesado). mpv fica como opção.
    this._openWebPlayer();
  }

  async _openInMpv() {
    const available = await window.electronAPI.mpvAvailable().catch(() => false);
    if (!available) {
      toast('mpv não está instalado. Usando o player web…', 'warn');
      this._openWebPlayer();
      return;
    }
    this.played = false;
    this._wasMpv = true;
    this.overlay.classList.remove('hidden');
    this.overlay.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:18px;background:#000;color:#fff;font-family:system-ui;padding:24px">
        <div style="color:#fff">${icon('play', 48)}</div>
        <div style="font-size:19px;font-weight:600">Reproduzindo no mpv</div>
        <div style="color:#9aa3b2;font-size:14px;max-width:480px;text-align:center">${esc(this.title || this.media.title || '')}</div>
        <div style="color:#6b7280;font-size:12.5px">Busque, pause, legendas e volume na janela do mpv.</div>
        <button class="btn btn-secondary" id="mpv-cancel">Cancelar reprodução</button>
      </div>`;
    this.overlay.querySelector('#mpv-cancel').onclick = () => this.close();

    this._mpvCloseCb = (data) => {
      if (data && data.error) toast(`mpv: ${data.error}`, 'warn');
      this.close();
    };

    window.electronAPI.playInMpv({
      id: this.media.id,
      url: this.media.url,
      title: this.title || this.media.title || '',
    }).then((r) => {
      if (r && r.ok === false) {
        // mpv indisponível ou falhou → cai no player web (remux/transcode)
        toast(`mpv não disponível (${r.error || 'erro'}). Usando player web…`, 'warn');
        this._openWebPlayer();
      }
    });
  }

  _bindEvents() {
    const progress = this.overlay.querySelector('.player-progress');
    const playPause = this.overlay.querySelector('.play-pause');
    const volume = this.overlay.querySelector('.volume');
    const volumeSlider = this.overlay.querySelector('.volume-slider');
    const volumeValue = this.overlay.querySelector('.volume-value');
    const fullscreen = this.overlay.querySelector('.fullscreen');
    const back = this.overlay.querySelector('.player-back');
    const time = this.overlay.querySelector('.player-time');
    const transcodeBtn = this.overlay.querySelector('.transcode-btn');
    const subtitleSelect = this.overlay.querySelector('.player-subtitle-select');
    const audioSelect = this.overlay.querySelector('.player-audio-select');
    this.audioSelect = audioSelect;
    this.subtitleSelect = subtitleSelect;

    playPause.onclick = () => {
      if (this.video.paused) this.video.play();
      else this.video.pause();
    };
    volume.onclick = () => {
      this._setupAudio();
      this.muted = !this.muted;
      this._applyVolume();
      volume.innerHTML = this.muted ? icon('volume-x', 20) : icon('volume-2', 20);
    };
    volumeSlider.oninput = () => {
      this._setupAudio();
      this.volume = parseInt(volumeSlider.value, 10) / 100;
      this.muted = false;
      this._applyVolume();
      volume.innerHTML = icon('volume-2', 20);
      volumeValue.textContent = `${volumeSlider.value}%`;
    };
    fullscreen.onclick = () => this._toggleFullscreen();
    back.onclick = () => this.close();
    transcodeBtn.onclick = () => this._reloadWithTranscode();

    this._bindFullscreen();

    progress.onclick = (e) => {
      const rect = progress.getBoundingClientRect();
      const ratio = (e.clientX - rect.left) / rect.width;
      const total = (!this._directOk() && this.media.duration) ? this.media.duration : (this.video.duration || 0);
      if (total) this._seekTo(ratio * total);
    };

    this.video.addEventListener('timeupdate', () => {
      const c = (this.video.currentTime || 0) + (this.startOffset || 0);
      let d = this.video.duration;
      // Streams remux/transcode não têm duração confiável no container:
      // usa a duração conhecida do DLNA quando disponível.
      const known = this.media.duration || 0;
      if (this._needsTranscode() || !d || !isFinite(d) || d === Infinity) {
        d = known;
      }
      const fill = progress.querySelector('.fill');
      const bfill = progress.querySelector('.buffered');
      if (d) {
        fill.style.width = `${(c / d) * 100}%`;
        if (this.video.buffered.length) {
          const end = this.video.buffered.end(this.video.buffered.length - 1);
          bfill.style.width = `${(end / d) * 100}%`;
        }
      }
      time.textContent = `${formatDuration(c)} / ${formatDuration(d)}`;
      this._scheduleSave();
    });

    this.video.addEventListener('play', () => {
      playPause.innerHTML = icon('pause', 22);
      this._setupAudio();
      this._applyVolume();
      this._showUi();
    });
    this.video.addEventListener('pause', () => { playPause.innerHTML = icon('play', 22); this._showUi(); });
    this.video.addEventListener('ended', () => {
      this._save(true);
      this._onEnded();
    });

    const buffer = this.overlay.querySelector('.player-buffer');
    const showBuffer = (on) => {
      if (buffer) buffer.classList.toggle('hidden', !on);
    };
    this.video.addEventListener('waiting', () => showBuffer(true));
    this.video.addEventListener('playing', () => showBuffer(false));
    this.video.addEventListener('canplay', () => showBuffer(false));
    this.video.addEventListener('pause', () => showBuffer(false));
    this.video.addEventListener('error', () => {
      const directOk = this.media && this._directOk();
      if (!this.played && !directOk && !this._remuxTried) {
        // Formato não reproduzível (ex: MKV): tenta remux rápido primeiro
        this._remuxTried = true;
        toast('Convertendo vídeo (remux)…', 'info', 2000);
        this._reloadWithTranscode('remux');
      } else if (!this.played && !this._transcodeTried) {
        // Remux falhou (ex: HEVC/AC3): re-encoda de verdade
        this._transcodeTried = true;
        toast('Codec incompatível, re-codificando…', 'info', 2000);
        this._reloadWithTranscode('full');
      } else {
        toast('Erro na reprodução. O formato não é suportado.', 'error');
      }
    });

    this.video.addEventListener('dblclick', () => this._toggleFullscreen());
    this.overlay.addEventListener('mousemove', () => this._showUi());
    this.overlay.addEventListener('mouseleave', () => this._hideUi());

    document.addEventListener('keydown', this._onKey = (e) => {
      if (e.key === 'Escape') {
        if (this._isFullscreen()) {
          e.preventDefault();
          this._exitFullscreen();
        } else {
          this.close();
        }
      }
      else if (e.key === ' ' || e.key === 'k') { e.preventDefault(); playPause.onclick(); }
      else if (e.key === 'ArrowRight') this._seekTo((this.video.currentTime || 0) + (this.startOffset || 0) + 10);
      else if (e.key === 'ArrowLeft') this._seekTo((this.video.currentTime || 0) + (this.startOffset || 0) - 10);
      else if (e.key === 'ArrowUp') { e.preventDefault(); this._changeVolume(0.05); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); this._changeVolume(-0.05); }
      else if (e.key === 'm') volume.onclick();
      else if (e.key === 'f') fullscreen.onclick();
    });

    audioSelect.onchange = () => {
      const v = audioSelect.value;
      const idx = v === '' ? null : parseInt(v, 10);
      if (idx === this.currentAudio) return;
      this._switchAudio(idx);
    };

    subtitleSelect.onchange = () => {
      this._setSubtitle(subtitleSelect.value);
    };

    const canTranscode = this.media && !this._directOk();
    if (canTranscode) transcodeBtn.classList.remove('hidden');
    transcodeBtn.title = 'Transcodificar com FFmpeg';
  }

  _isFullscreen() {
    if (window.electronAPI && window.electronAPI.isElectron) return !!this._fsActive;
    return !!document.fullscreenElement;
  }

  _requestFullscreen() {
    if (this._wasMpv || this._isFullscreen()) return;
    if (window.electronAPI && window.electronAPI.isElectron && window.electronAPI.setFullScreen) {
      // No Electron/Linux a tela cheia HTML por elemento é instável;
      // coloca a JANELA em tela cheia (mais confiável).
      this._fsActive = true;
      window.electronAPI.setFullScreen(true);
    } else if (this.overlay && this.overlay.requestFullscreen) {
      this.overlay.requestFullscreen().catch(() => {
        // Tela cheia pode ser negada pelo navegador; segue em janela normal
      });
    }
  }

  _toggleFullscreen() {
    if (this._isFullscreen()) this._exitFullscreen();
    else this._requestFullscreen();
  }

  _exitFullscreen() {
    if (window.electronAPI && window.electronAPI.isElectron && window.electronAPI.setFullScreen) {
      window.electronAPI.setFullScreen(false);
    } else if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
  }

  _bindFullscreen() {
    if (this._fsBound) return;
    this._fsBound = true;
    document.addEventListener('fullscreenchange', () => {
      if (!document.fullscreenElement) {
        // Ao sair da tela cheia, garante que a UI volta a aparecer
        this._showUi();
        if (this._pendingClose) {
          this._pendingClose = false;
          this.close();
        }
      }
    });
    if (window.electronAPI && window.electronAPI.onFullscreenChanged) {
      window.electronAPI.onFullscreenChanged((fs) => {
        this._fsActive = !!fs;
        if (!fs) {
          this._showUi();
          if (this._pendingClose) {
            this._pendingClose = false;
            this.close();
          }
        }
      });
    }
  }

  _directOk() {
    const f = (this.media.format || '').toLowerCase();
    const bad = ['mkv', 'x-matroska', 'avi', 'wmv', 'mpeg', 'mpg', 'vob', 'm2ts', 'flv'];
    if (bad.includes(f)) return false;
    const mime = (this.media.mime_type || '').toLowerCase();
    if (mime.includes('matroska')) return false;
    return true;
  }

  _setupAudio() {
    if (this._gainNode || !this.video) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    try {
      this._audioCtx = new Ctx();
      const src = this._audioCtx.createMediaElementSource(this.video);
      this._gainNode = this._audioCtx.createGain();
      src.connect(this._gainNode);
      this._gainNode.connect(this._audioCtx.destination);
      if (this._audioCtx.state === 'suspended') this._audioCtx.resume();
    } catch {
      this._audioCtx = null;
      this._gainNode = null;
    }
  }

  _applyVolume() {
    if (!this.video) return;
    const v = this.muted ? 0 : this.volume;
    if (this._gainNode) {
      this._gainNode.gain.value = v;
      this.video.volume = 1;
    } else {
      this.video.volume = Math.min(1, v);
      this.video.muted = this.muted;
    }
  }

  _changeVolume(delta) {
    this._setupAudio();
    this.volume = Math.max(0, Math.min(1.5, this.volume + delta));
    this.muted = false;
    this._applyVolume();
    const slider = this.overlay.querySelector('.volume-slider');
    const value = this.overlay.querySelector('.volume-value');
    const btn = this.overlay.querySelector('.volume');
    if (slider) slider.value = String(Math.round(this.volume * 100));
    if (value) value.textContent = `${Math.round(this.volume * 100)}%`;
    if (btn) btn.innerHTML = icon('volume-2', 20);
  }

  _openWebPlayer() {
    this.played = false;
    this._remuxTried = false;
    this._transcodeTried = false;
    this.tracks = { audio: [], subtitles: [] };
    this.currentAudio = null;
    this._loadedTracks = false;
    this.startOffset = 0;
    this.overlay.innerHTML = `
      <video class="video-player" playsinline></video>
      <div class="player-buffer hidden"><div class="spinner spinner-lg"></div></div>
      <div class="player-ui">
        <div class="player-top">
          <button class="player-back" title="Voltar">${icon('arrow-left', 18)}</button>
          <div class="player-title">${esc(this.title || this.media.title || '')}</div>
        </div>
        <div class="player-controls">
          <div class="player-bar-row">
            <div class="player-progress">
              <div class="buffered"></div>
              <div class="fill"></div>
            </div>
            <div class="player-time">0:00 / 0:00</div>
          </div>
          <div class="player-buttons">
            <button class="play-pause" title="Play/Pause">${icon('play', 22)}</button>
            <button class="volume" title="Mudo">${icon('volume-2', 20)}</button>
            <div class="volume-group">
              <input type="range" class="volume-slider" min="0" max="150" step="1" value="100" title="Volume">
              <span class="volume-value">100%</span>
            </div>
            <div class="right">
              <button class="mpv-btn hidden" title="Abrir no mpv (player nativo)">${icon('monitor', 15)} mpv</button>
              <select class="player-audio-select hidden" title="Faixa de áudio"></select>
              <select class="player-subtitle-select hidden" title="Legenda"></select>
              <button class="transcode-btn hidden" title="Transcodificar">${icon('zap', 17)}</button>
              <button class="fullscreen" title="Tela cheia">${icon('maximize', 17)}</button>
            </div>
          </div>
        </div>
      </div>`;

    this.overlay.classList.remove('hidden');
    this.video = this.overlay.querySelector('video');
    this.ui = this.overlay.querySelector('.player-ui');
    this._bindEvents();
    this._start();
    this._loadTracks();
    this._requestFullscreen();

    // No Electron, oferece "Abrir no mpv" para formatos não-suportados pelo Chromium
    const mpvBtn = this.overlay.querySelector('.mpv-btn');
    if (mpvBtn && window.electronAPI && window.electronAPI.isElectron && !this._directOk()) {
      mpvBtn.classList.remove('hidden');
      mpvBtn.onclick = () => this._openInMpv();
    }
  }

  _reloadWithTranscode(mode) {
    if (!this.media) return;
    this.played = false;
    const p = mode === 'full' ? '2' : '1';
    this.video.src = streamUrl(this.media.id, { transcode: p });
    this.video.load();
    this.video.play().catch(() => {});
  }

  async _loadTracks() {
    if (this._loadedTracks || !this.media) return;
    this._loadedTracks = true;
    const audioSelect = this.audioSelect;
    const subtitleSelect = this.subtitleSelect;
    if (!audioSelect || !subtitleSelect || !this.media.id) return;

    const external = [];
    if (this.media.subtitles) {
      try { external.push(...JSON.parse(this.media.subtitles)); } catch { /* sem legendas */ }
    }

    let data = { audio: [], subtitles: [] };
    try {
      data = (await api.get(tracksUrl(this.media.id))) || { audio: [], subtitles: [] };
    } catch { /* sem ffprobe */ }
    this.tracks = data;

    if (data.audio && data.audio.length > 1) {
      const opts = ['<option value="">Padrão</option>'];
      data.audio.forEach((a, i) => {
        const lbl = langLabel(a.language) || a.codec || 'Faixa';
        opts.push(`<option value="${a.index}">Áudio ${i + 1}: ${esc(lbl)}${a.channels ? ` (${a.channels}ch)` : ''}</option>`);
      });
      audioSelect.innerHTML = opts.join('');
      audioSelect.classList.remove('hidden');
    } else {
      audioSelect.classList.add('hidden');
    }

    const hasEmbedded = data.subtitles && data.subtitles.length > 0;
    if (!hasEmbedded && !external.length) {
      subtitleSelect.classList.add('hidden');
      return;
    }
    const opts = ['<option value="">Legendas: desativadas</option>'];
    external.forEach((s, i) => {
      opts.push(`<option value="ext:${i}">Legenda externa ${i + 1}</option>`);
    });
    let n = external.length;
    data.subtitles.forEach((s) => {
      n += 1;
      const lbl = langLabel(s.language) || s.codec || 'Faixa';
      if (s.kind === 'text') {
        opts.push(`<option value="stream:${s.index}">Legenda ${n}: ${esc(lbl)}</option>`);
      } else {
        opts.push(`<option value="stream:${s.index}" disabled>Legenda ${n}: ${esc(lbl)} (imagem)</option>`);
      }
    });
    subtitleSelect.innerHTML = opts.join('');
    subtitleSelect.classList.remove('hidden');
  }

  _needsTranscode() {
    return !this._directOk() || this.currentAudio != null;
  }

  _transcodeOpts() {
    const opts = { transcode: '1' };
    if (this.currentAudio != null) opts.audio = this.currentAudio;
    return opts;
  }

  _seekTo(seconds) {
    if (!this.media || !this.video) return;
    const s = Math.max(0, Math.floor(seconds));
    if (this._needsTranscode()) {
      this.startOffset = s;
      const opts = this._transcodeOpts();
      if (s > 0) opts.start = s;
      this.video.src = streamUrl(this.media.id, opts);
      this.video.play().catch(() => {});
    } else {
      this.startOffset = 0;
      try { this.video.currentTime = s; } catch { /* ok */ }
    }
  }

  _switchAudio(idx) {
    if (!this.media) return;
    const pos = Math.floor((this.video ? this.video.currentTime : 0) + (this.startOffset || 0));
    this.currentAudio = idx;
    if (this._needsTranscode()) {
      this.startOffset = pos;
      const opts = this._transcodeOpts();
      if (pos > 1) opts.start = pos;
      this.video.src = streamUrl(this.media.id, opts);
    } else {
      this.startOffset = 0;
      this.video.src = streamUrl(this.media.id);
      const resume = () => {
        if (pos > 1) { try { this.video.currentTime = pos; } catch { /* ok */ } }
      };
      this.video.addEventListener('loadedmetadata', resume, { once: true });
    }
    this.video.play().catch(() => {});
    this._showUi();
  }

  _setSubtitle(value) {
    if (!this.video) return;
    this.video.querySelectorAll('track').forEach((t) => t.remove());
    if (!value) return;
    let m = null;
    if (value.startsWith('ext:')) m = { ext: parseInt(value.slice(4), 10) };
    else if (value.startsWith('stream:')) m = { stream: parseInt(value.slice(7), 10) };
    if (!m) return;
    const track = document.createElement('track');
    track.kind = 'subtitles';
    track.label = this.subtitleSelect ? this.subtitleSelect.selectedOptions[0].textContent : '';
    track.src = subtitleUrl(this.media.id, m);
    track.default = true;
    this.video.appendChild(track);
    const tt = this.video.textTracks;
    if (tt && tt.length) {
      for (let i = 0; i < tt.length; i++) tt[i].mode = i === tt.length - 1 ? 'showing' : 'disabled';
    }
  }

  _start() {
    const url = streamUrl(this.media.id);
    this.video.src = url;
    const resumePrompt = () => {
      const pos = this.resume || (this.media.history && this.media.history.position) || 0;
      const total = this.media.duration || this.video.duration || 0;
      if (pos > SKIP_THRESHOLD && pos < total - 15) {
        if (confirm(`Continuar de ${formatDuration(pos)}?`)) {
          this._seekTo(pos);
        }
      }
    };
    this.video.addEventListener('loadedmetadata', resumePrompt, { once: true });
    this.video.play().catch(() => {
      toast('Erro ao iniciar reprodução', 'error');
    });
    this._showUi();
  }

  _scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this._save(false);
    }, 5000);
  }

  _save(finished) {
    const v = this.video;
    let d = v && v.duration ? v.duration : 0;
    if (this._needsTranscode() && this.media.duration) d = this.media.duration;
    const c = ((v && v.currentTime ? v.currentTime : 0) + (this.startOffset || 0));
    api.post(`/api/media/${this.media.id}/progress`, {
      position: Math.floor(c),
      duration: Math.floor(d),
      finished,
    }).catch(() => {});
  }

  _onEnded() {
    const next = this.media.series && this.media.series.episodes
      ? null : null;
    const msg = this.media.series ? 'Episódio concluído.' : 'Fim da reprodução.';
    if (confirm(`${msg} Voltar à página da mídia?`)) {
      this.close();
      location.hash = `#/media/${this.media.id}`;
    } else {
      this.close();
    }
  }

  _showUi() {
    if (!this.ui) return;
    this.hidden = false;
    this.ui.style.opacity = '1';
    this.overlay.style.cursor = 'default';
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => {
      if (this.video && !this.video.paused) this._hideUi();
    }, 3000);
  }

  _hideUi() {
    if (this.hidden || !this.ui) return;
    this.hidden = true;
    this.ui.style.opacity = '0';
    this.overlay.style.cursor = 'none';
  }

  close() {
    if (this._isFullscreen()) {
      // Fecha primeiro a tela cheia para não esconder o elemento fullscreen
      // (o que travaria a janela no Chromium/Electron). O fechamento real
      // acontece no handler de fullscreenchange / onFullscreenChanged.
      this._pendingClose = true;
      this._exitFullscreen();
      setTimeout(() => {
        if (this._pendingClose) {
          this._pendingClose = false;
          this.close();
        }
      }, 500);
      return;
    }
    this._save(false);
    document.removeEventListener('keydown', this._onKey);
    this.overlay.classList.add('hidden');
    this.overlay.innerHTML = '';
    this.video = null;
    if (this._audioCtx) { try { this._audioCtx.close(); } catch { /* ok */ } }
    this._audioCtx = null;
    this._gainNode = null;
    this._mpvCloseCb = null;
    if (window.electronAPI && window.electronAPI.isElectron && this._wasMpv) {
      this._wasMpv = false;
      window.electronAPI.stopMpv();
    }
    if (this.onClose) this.onClose();
  }
}

export const player = new VideoPlayer();
