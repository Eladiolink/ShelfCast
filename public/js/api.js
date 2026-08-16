export const api = {
  async request(path, opts = {}) {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      ...opts,
    });
    if (res.status === 204) return null;
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(body?.error || `Erro HTTP ${res.status}`);
    }
    return body;
  },
  get: (p) => api.request(p),
  post: (p, body) => api.request(p, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  del: (p) => api.request(p, { method: 'DELETE' }),
};

export function streamUrl(id, opts = {}) {
  const q = new URLSearchParams();
  if (opts.transcode) q.set('transcode', String(opts.transcode));
  if (opts.audio != null) q.set('audio', String(opts.audio));
  if (opts.start != null && opts.start > 0) q.set('start', String(opts.start));
  const s = q.toString();
  return `/api/media/${id}/stream${s ? '?' + s : ''}`;
}

export function tracksUrl(id) {
  return `/api/media/${id}/tracks`;
}

export function subtitleUrl(id, opts = {}) {
  const q = new URLSearchParams();
  if (opts.stream != null) q.set('stream', String(opts.stream));
  if (opts.ext != null) q.set('ext', String(opts.ext));
  const s = q.toString();
  return `/api/media/${id}/subtitle${s ? '?' + s : ''}`;
}

export function thumbnailUrl(id) {
  return `/api/media/${id}/thumbnail`;
}
