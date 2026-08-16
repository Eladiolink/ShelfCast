export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function formatDuration(seconds) {
  if (!seconds && seconds !== 0) return '';
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

export function formatTimePos(seconds) {
  if (!seconds && seconds !== 0) return '0:00';
  return formatDuration(seconds);
}

export function formatSize(bytes) {
  if (!bytes) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function timeAgo(iso) {
  if (!iso) return 'nunca';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'agora';
  if (mins < 60) return `há ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `há ${hrs} h`;
  const days = Math.floor(hrs / 24);
  return `há ${days} d`;
}

export function badgeFor(media) {
  if (media.resolution) return esc(media.resolution);
  if (media.video_codec) return esc(media.video_codec.replace('H.', 'H.'));
  return '';
}

export function posterFor(media) {
  if (media.poster) return `/data/${media.poster}`;
  if (media.thumbnail && media.thumbnail.startsWith('http')) return media.thumbnail;
  return '/placeholder.svg';
}

export function toast(message, type = 'info', duration = 3200) {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity .3s';
    setTimeout(() => el.remove(), 320);
  }, duration);
}

export function loading() {
  return `<div class="loading"><div class="spinner"></div><span>Carregando…</span></div>`;
}

export function emptyState(icon, title, sub = '') {
  return `
    <div class="empty">
      <div class="empty-icon">${icon}</div>
      <div class="empty-title">${esc(title)}</div>
      ${sub ? `<div>${esc(sub)}</div>` : ''}
    </div>`;
}
