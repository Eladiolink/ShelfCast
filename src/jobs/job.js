'use strict';

const { EventEmitter } = require('node:events');
const logger = require('../config/logger.js');
const { jobRepo } = require('../database/repositories.js');

const log = logger.child({ module: 'jobs' });

class Job extends EventEmitter {
  constructor({ id, type, serverId, total = 0 }) {
    super();
    this.id = id;
    this.type = type;
    this.serverId = serverId ?? null;
    this.status = 'running';
    this.current = 0;
    this.total = total;
    this.progress = 0;
    this.error = null;
    this.cancelled = false;
    this._listeners = [];
  }

  cancel() {
    this.cancelled = true;
    this.status = 'cancelled';
  }

  isCancelled() {
    return this.cancelled;
  }

  setTotal(total) {
    this.total = total;
    jobRepo.progress(this.id, this.current, total);
  }

  advance(n = 1) {
    this.current += n;
    this.progress = this.total > 0 ? Math.floor((this.current / this.total) * 100) : 0;
    jobRepo.progress(this.id, this.current, this.total);
    this.emit('progress', { current: this.current, total: this.total, progress: this.progress });
  }

  message(msg) {
    jobRepo.message(this.id, msg);
    this.emit('message', msg);
  }

  finish(status, error = null) {
    this.status = status;
    this.error = error;
    jobRepo.finish(this.id, status, error);
    this.emit('finish', { status, error });
  }

  run(fn) {
    return Promise.resolve()
      .then(() => fn(this))
      .then(() => { if (this.status === 'running') this.finish('success'); })
      .catch((err) => {
        if (this.cancelled || err.message === 'Cancelado pelo usuário') {
          this.finish('cancelled');
        } else {
          log.error('job falhou', { id: this.id, type: this.type, err: err.message });
          this.finish('error', err.message);
        }
      });
  }
}

class JobManager {
  constructor({ maxConcurrent = 2 } = {}) {
    this.maxConcurrent = maxConcurrent;
    this.running = new Map();
    this.queue = [];
    this.events = new EventEmitter();
  }

  get runningCount() {
    return this.running.size;
  }

  create({ type, serverId, total = 0 }) {
    const id = jobRepo.create({ type, server_id: serverId, total });
    const job = new Job({ id, type, serverId, total });
    job.on('progress', () => this.events.emit('job-update', job));
    this.queue.push(job);
    this._drain();
    return job;
  }

  _drain() {
    while (this.running.size < this.maxConcurrent && this.queue.length > 0) {
      const job = this.queue.shift();
      this.running.set(job.id, job);
      this.events.emit('job-start', job);
    }
  }

  finishJob(job) {
    this.running.delete(job.id);
    this.events.emit('job-done', job);
    this._drain();
  }

  get(id) {
    return this.running.get(id) || null;
  }

  list() {
    return jobRepo.list();
  }

  cancel(id) {
    const job = this.running.get(id);
    if (job) {
      job.cancel();
      job.finish('cancelled');
      this.finishJob(job);
      return true;
    }
    const q = this.queue.find((j) => j.id === id);
    if (q) {
      q.cancel();
      q.finish('cancelled');
      this.queue = this.queue.filter((j) => j.id !== id);
      return true;
    }
    // Job não está em memória (ex: processo reiniciado deixou o status
    // 'running' no banco). Marca como cancelado para sumir da lista.
    const row = jobRepo.get(id);
    if (row && row.status === 'running') {
      jobRepo.finish(id, 'cancelled', 'Cancelado');
      return true;
    }
    return false;
  }
}

module.exports = { JobManager, Job };
