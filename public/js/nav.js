const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'select:not([disabled])',
  'input:not([disabled])',
  'textarea:not([disabled])',
  '[data-card]',
  '[data-episode]',
  '.episode-row',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

function visible(el) {
  if (!el || !el.isConnected) return false;
  if (el.closest('.hidden')) return false;
  const style = getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

function candidates() {
  const list = [...document.querySelectorAll(FOCUSABLE)];
  const unique = [];
  const seen = new Set();
  for (const el of list) {
    if (seen.has(el)) continue;
    seen.add(el);
    if (visible(el)) unique.push(el);
  }
  return unique;
}

function center(el) {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function bestInDir(dir, from) {
  const els = from
    ? candidates().filter((el) => el !== from && !from.contains(el) && !el.contains(from))
    : candidates();
  const f = from ? center(from) : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  let best = null;
  let bestScore = Infinity;
  for (const el of els) {
    const c = center(el);
    let dx = c.x - f.x;
    let dy = c.y - f.y;
    if (dir === 'left' && dx >= 0) continue;
    if (dir === 'right' && dx <= 0) continue;
    if (dir === 'up' && dy >= 0) continue;
    if (dir === 'down' && dy <= 0) continue;
    const d = Math.sqrt(dx * dx + dy * dy);
    // penaliza leve desvio lateral na direção perpendicular
    let penalty = 0;
    if (dir === 'left' || dir === 'right') penalty = Math.abs(dy);
    else penalty = Math.abs(dx);
    const score = d + penalty * 1.5;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  return best;
}

export function focusFirst() {
  const els = candidates();
  if (!els.length) return false;
  els[0].focus();
  els[0].scrollIntoView({ block: 'nearest' });
  return true;
}

export function moveFocus(dir) {
  const active = document.activeElement;
  const target = bestInDir(dir, active && visible(active) ? active : null);
  if (!target) return;
  target.focus();
  target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

export function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}
