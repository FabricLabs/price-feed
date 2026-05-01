'use strict';

class SSEService {
  constructor (settings = {}) {
    this.settings = Object.assign(
      {
        eventName: 'message',
        heartbeatMs: 15_000,
        retryMs: 10_000,
        snapshotProvider: null
      },
      settings
    );

    /** @type {Set<import('express').Response>} */
    this.clients = new Set();
    /** @type {ReturnType<typeof setInterval>|null} */
    this.heartbeatTimer = null;
  }

  hasClients () {
    return this.clients.size > 0;
  }

  /**
   * @param {import('express').Request} req
   * @param {import('express').Response} res
   */
  handleHttp (req, res) {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders();
    }

    res.write(`retry: ${Math.max(1000, Number(this.settings.retryMs) || 10_000)}\n\n`);

    this.clients.add(res);
    this._ensureHeartbeat();
    void this.sendToClient(res);

    const detach = () => {
      this.clients.delete(res);
      if (this.clients.size === 0) {
        this._clearHeartbeat();
      }
    };

    req.on('close', detach);
    req.on('error', detach);
    res.on('close', detach);
    res.on('error', detach);
  }

  /**
   * @param {import('express').Response} res
   * @param {string} event
   * @param {unknown} payload
   */
  _writeEvent (res, event, payload) {
    let body;
    try {
      body = JSON.stringify(payload);
    } catch (_) {
      return false;
    }
    try {
      res.write(`event: ${event}\n`);
      res.write(`data: ${body}\n\n`);
      return true;
    } catch (_) {
      return false;
    }
  }

  /**
   * @param {import('express').Response} res
   */
  async sendToClient (res) {
    const provide = this.settings.snapshotProvider;
    if (typeof provide !== 'function') return;

    let payload;
    try {
      payload = await provide();
    } catch (_) {
      return;
    }
    const ok = this._writeEvent(res, this.settings.eventName, payload);
    if (!ok) this.clients.delete(res);
  }

  async broadcast () {
    if (this.clients.size === 0) return;
    const provide = this.settings.snapshotProvider;
    if (typeof provide !== 'function') return;

    let payload;
    try {
      payload = await provide();
    } catch (_) {
      return;
    }

    for (const res of this.clients) {
      const ok = this._writeEvent(res, this.settings.eventName, payload);
      if (!ok) this.clients.delete(res);
    }
    if (this.clients.size === 0) this._clearHeartbeat();
  }

  _ensureHeartbeat () {
    if (this.heartbeatTimer || this.clients.size === 0) return;
    const intervalMs = Math.max(1000, Number(this.settings.heartbeatMs) || 15_000);
    this.heartbeatTimer = setInterval(() => {
      if (this.clients.size === 0) {
        this._clearHeartbeat();
        return;
      }
      for (const res of this.clients) {
        try {
          res.write(': keepalive\n\n');
        } catch (_) {
          this.clients.delete(res);
        }
      }
      if (this.clients.size === 0) {
        this._clearHeartbeat();
      }
    }, intervalMs);
  }

  _clearHeartbeat () {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  stop () {
    this._clearHeartbeat();
    for (const res of this.clients) {
      try {
        res.end();
      } catch (_) {
        /* noop */
      }
    }
    this.clients.clear();
  }
}

module.exports = SSEService;
