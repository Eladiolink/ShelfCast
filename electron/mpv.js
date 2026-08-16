'use strict';

const { spawn } = require('node:child_process');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

/**
 * Controla o mpv via JSON IPC (unix socket).
 * mpv reproduz MKV/qualquer codec nativamente (decode por hardware),
 * com seek exato e suporte a legendas.
 */
class MpvController {
  constructor() {
    this.proc = null;
    this.sockPath = null;
    this.sock = null;
    this.buf = '';
    this.nextId = 1;
    this.pending = new Map();
    this.events = {};
    this.url = null;
  }

  get isRunning() {
    return !!this.proc && this.proc.exitCode === null;
  }

  on(event, handler) {
    (this.events[event] ||= []).push(handler);
    return this;
  }

  _emit(event, data) {
    for (const h of this.events[event] || []) {
      try { h(data); } catch { /* handler com erro */ }
    }
  }

  async start(url, { onProgress, onEnded, onClose } = {}) {
    if (!url) throw new Error('URL de vídeo vazia');
    this.url = url;
    this.sockPath = path.join(os.tmpdir(), `ml-mpv-${crypto.randomBytes(6).toString('hex')}.sock`);

    this.proc = spawn('mpv', [
      '--input-ipc-server=' + this.sockPath,
      '--idle=yes',
      '--force-window=yes',
      '--keep-open=no',
      '--osc=yes',
      '--osd-level=1',
      '--cache=yes',
      '--config=yes',
      url,
    ], { stdio: ['ignore', 'ignore', 'ignore'] });

    this.proc.on('error', (err) => {
      this._emit('error', err);
    });
    this.proc.on('close', (code) => {
      try { fs.unlinkSync(this.sockPath); } catch { /* ok */ }
      if (this.sock) { try { this.sock.destroy(); } catch { /* ok */ } this.sock = null; }
      this._emit('close', code);
      if (onClose) onClose(code);
    });

    await this._waitForSocket(8000);

    this.sock = net.createConnection(this.sockPath);
    this.buf = '';
    this.sock.on('data', (d) => this._onData(d));
    this.sock.on('error', () => { /* socket fechou junto do mpv */ });
    await new Promise((res, rej) => {
      this.sock.once('connect', res);
      this.sock.once('error', rej);
    });

    // observa propriedades para progresso/duração
    this.sendCommand(['observe_property', 1, 'time-pos']);
    this.sendCommand(['observe_property', 2, 'duration']);
    this.on('property-change', (ev) => {
      if (ev.name === 'time-pos' && typeof ev.data === 'number' && onProgress) onProgress(ev.data);
    });
    this.on('end-file', () => {
      if (onEnded) onEnded();
    });
    this.on('idle', () => {
      if (onEnded) onEnded();
    });

    // garante reprodução
    this.sendCommand(['set_property', 'pause', false]);
    return this;
  }

  sendCommand(command) {
    if (!this.sock) return null;
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.sock.write(JSON.stringify({ command, request_id: id }) + '\n');
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); resolve(null); }
      }, 4000);
    });
  }

  async getProperty(name) {
    try {
      const r = await this.sendCommand(['get_property', name]);
      return r && r.data !== undefined ? r.data : null;
    } catch {
      return null;
    }
  }

  async setPause(pause) {
    await this.sendCommand(['set_property', 'pause', !!pause]);
  }

  async seek(position) {
    await this.sendCommand(['seek', position, 'absolute']);
  }

  async getPosition() {
    return this.getProperty('time-pos');
  }

  async getDuration() {
    return this.getProperty('duration');
  }

  stop() {
    if (this.sock) {
      try { this.sendCommand(['quit']); } catch { /* ok */ }
    }
    if (this.proc) {
      const p = this.proc;
      setTimeout(() => { if (p.exitCode === null) p.kill('SIGKILL'); }, 1500);
    }
  }

  _waitForSocket(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve, reject) => {
      const check = () => {
        if (fs.existsSync(this.sockPath)) return resolve();
        if (this.proc && this.proc.exitCode !== null) return reject(new Error('mpv encerrou antes de iniciar'));
        if (Date.now() > deadline) return reject(new Error('mpv não abriu o IPC a tempo'));
        setTimeout(check, 100);
      };
      check();
    });
  }

  _onData(chunk) {
    this.buf += chunk.toString('utf8');
    let idx;
    while ((idx = this.buf.indexOf('\n')) !== -1) {
      const line = this.buf.slice(0, idx);
      this.buf = this.buf.slice(idx + 1);
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.request_id && this.pending.has(msg.request_id)) {
          const { resolve, reject } = this.pending.get(msg.request_id);
          this.pending.delete(msg.request_id);
          if (msg.error && msg.error !== 'success') reject(new Error('mpv: ' + msg.error));
          else resolve(msg);
        } else {
          this._emit('event', msg);
          this._emit(msg.event, msg);
        }
      } catch { /* linha inválida */ }
    }
  }
}

module.exports = { MpvController };
