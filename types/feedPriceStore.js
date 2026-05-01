'use strict';

// Constants
/** Initial single-blob layout (no `schemaVersion`). */
const LEGACY_LEVEL_KEY = 'fabric.feed.persist.v1';
/** Versioned snapshot envelope. */
const SNAPSHOT_KEY = 'fabric.feed.snapshot.v2';

const CURRENT_SCHEMA = 2;

// Fabric Types
const Store = require('@fabric/core/types/store');
const Collection = require('@fabric/core/types/collection');
const Entity = require('@fabric/core/types/entity');

/**
 * Level-backed price feed snapshots extending {@link Store}.
 * Forward-compatible envelope and {@link Collection} hydration for aggregate history.
 */
class FeedPriceStore extends Store {
  constructor (settings = {}) {
    super(
      Object.assign(
        {
          persistent: true,
          name: '@fabric/feed-persistence',
          path: './stores/feed-price',
          verbosity: 0,
          snapshotKey: SNAPSHOT_KEY
        },
        settings
      )
    );

    this.historyColl = new Collection({
      type: Entity,
      name: 'FeedAggregatesHistory'
    });

    /** @private */
    this._feedOpened = false;
  }

  _primaryKey () {
    return this.settings.snapshotKey || SNAPSHOT_KEY;
  }

  async open () {
    if (this._feedOpened) return this;
    await super.open();
    this._feedOpened = true;
    return this;
  }

  /**
   * Normalize any stored blob (legacy or current) into a single shape.
   * @param {Record<string, unknown>} blob
   * @returns {{
   *   schemaVersion: number,
   *   values: Record<string, unknown>,
   *   brokerCache: Record<string, unknown>,
   *   historyRows: unknown[],
   *   meta: Record<string, unknown>
   * }}
   */
  static normalizeEnvelope (blob) {
    if (!blob || typeof blob !== 'object') {
      return {
        schemaVersion: CURRENT_SCHEMA,
        values: {},
        brokerCache: {},
        historyRows: [],
        meta: {}
      };
    }

    if (blob.schemaVersion == null && blob.values !== undefined) {
      return {
        schemaVersion: 1,
        values:
          blob.values && typeof blob.values === 'object' ? blob.values : {},
        brokerCache:
          blob.brokerCache && typeof blob.brokerCache === 'object'
            ? blob.brokerCache
            : {},
        historyRows: Array.isArray(blob.historyRows) ? blob.historyRows : [],
        meta:
          blob.meta && typeof blob.meta === 'object' ? blob.meta : {}
      };
    }

    return {
      schemaVersion:
        typeof blob.schemaVersion === 'number'
          ? blob.schemaVersion
          : CURRENT_SCHEMA,
      values:
        blob.snapshot &&
        blob.snapshot.values &&
        typeof blob.snapshot.values === 'object'
          ? blob.snapshot.values
          : (blob.values && typeof blob.values === 'object')
            ? blob.values
            : {},
      brokerCache:
        blob.snapshot &&
        blob.snapshot.brokerCache &&
        typeof blob.snapshot.brokerCache === 'object'
          ? blob.snapshot.brokerCache
          : (blob.brokerCache && typeof blob.brokerCache === 'object')
            ? blob.brokerCache
            : {},
      historyRows:
        blob.snapshot &&
        Array.isArray(blob.snapshot.historyRows)
          ? blob.snapshot.historyRows
          : Array.isArray(blob.historyRows)
            ? blob.historyRows
            : [],
      meta:
        blob.snapshot &&
        blob.snapshot.meta &&
        typeof blob.snapshot.meta === 'object'
          ? blob.snapshot.meta
          : blob.meta && typeof blob.meta === 'object'
            ? blob.meta
            : {}
    };
  }

  /** @private */
  async _hydrateHistoryCollection (historyRows) {
    this.historyColl = new Collection({
      type: Entity,
      name: 'FeedAggregatesHistory'
    });

    const rows = Array.isArray(historyRows) ? historyRows : [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (row && typeof row === 'object') {
        try {
          await this.historyColl.push(new Entity(row), false);
        } catch {
          await this.historyColl.push(row, false);
        }
      }
    }
  }

  /**
   * @returns {Promise<{
   *   schemaVersion: number,
   *   values: Record<string, unknown>,
   *   brokerCache: Record<string, unknown>|null,
   *   historyRows: unknown[],
   *   meta: Record<string, unknown>
   * }|null>}
   */
  async loadSnapshot () {
    await this.open();
    const db = this.db;

    if (!db) return null;

    /** @type {unknown} */
    let raw = null;
    const primary = this._primaryKey();

    try {
      const bufPrimary = await db.get(primary).catch(() => null);
      if (bufPrimary) {
        raw = JSON.parse(
          typeof bufPrimary === 'string'
            ? bufPrimary
            : bufPrimary.toString('utf8')
        );
      }
    } catch {
      raw = null;
    }

    if (raw == null) {
      try {
        const bufLegacy = await db.get(LEGACY_LEVEL_KEY).catch(() => null);
        if (bufLegacy) {
          raw = JSON.parse(
            typeof bufLegacy === 'string'
              ? bufLegacy
              : bufLegacy.toString('utf8')
          );
        }
      } catch {
        raw = null;
      }
    }

    if (raw == null) return null;

    const envelope = FeedPriceStore.normalizeEnvelope(
      raw
    );

    await this._hydrateHistoryCollection(envelope.historyRows);

    return {
      schemaVersion: envelope.schemaVersion,
      values: envelope.values || {},
      brokerCache: envelope.brokerCache || {},
      historyRows: envelope.historyRows || [],
      meta: envelope.meta || {}
    };
  }

  /** Alias for {@link loadSnapshot} — matches {@link Store} read pattern. */
  async load () {
    return this.loadSnapshot();
  }

  /**
   * @param {{
   *   values?: Record<string, unknown>,
   *   brokerCache?: Record<string, unknown>|null,
   *   historyRows?: unknown[],
   *   meta?: Record<string, unknown>
   * }} snap
   */
  async saveSnapshot (snap) {
    await this.open();
    const db = this.db;

    const payload = {
      schemaVersion: CURRENT_SCHEMA,
      savedAt: Date.now(),
      snapshot: {
        values:
          snap.values && typeof snap.values === 'object' ? snap.values : {},
        brokerCache:
          snap.brokerCache && typeof snap.brokerCache === 'object'
            ? snap.brokerCache
            : {},
        historyRows: Array.isArray(snap.historyRows) ? snap.historyRows : [],
        meta:
          snap.meta && typeof snap.meta === 'object' ? snap.meta : {}
      }
    };

    if (!db) return;

    try {
      await db.put(
        this._primaryKey(),
        Buffer.from(JSON.stringify(payload), 'utf8')
      );
    } catch (e) {
      console.error('[FEED:PERSIST]', e?.message || e);
    }
  }

  /** Alias for {@link saveSnapshot}. */
  async save (snap) {
    return this.saveSnapshot(snap);
  }

  async stop () {
    try {
      await super.stop();
    } catch {
      /* noop */
    }
    this._feedOpened = false;
    return this;
  }
}

module.exports = FeedPriceStore;
module.exports.SNAPSHOT_SCHEMA_VERSION = CURRENT_SCHEMA;
module.exports.LEGACY_LEVEL_KEY = LEGACY_LEVEL_KEY;
module.exports.SNAPSHOT_KEY = SNAPSHOT_KEY;
