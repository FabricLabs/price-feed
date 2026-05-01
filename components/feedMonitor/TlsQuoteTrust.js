'use strict';

import { Icon } from 'semantic-ui-react';

import {
  formatCertificateIssuer,
  tlsChainTrusted
} from './utils';

/**
 * TLS trust for a quote source: green check when chain + identity are valid, plus certificate issuer
 * (signer) from the last captured peer certificate.
 *
 * @param {{
 *   tls: Record<string, unknown>|null|undefined,
 *   compact?: boolean
 * }} props
 */
export default function TlsQuoteTrust ({ tls, compact }) {
  const peer =
    tls && typeof tls === 'object' && tls.peer && typeof tls.peer === 'object'
      ? /** @type {{ issuer?: unknown }} */ (tls.peer)
      : null;
  const signer = formatCertificateIssuer(peer?.issuer ?? null);
  const trusted = tlsChainTrusted(tls);
  const hasData = tls && typeof tls === 'object';
  const proto =
    hasData && tls.protocol != null ? String(tls.protocol) : '';

  if (!hasData) {
    return (
      <span
        style={{
          fontSize: compact ? '0.7rem' : '0.78rem',
          opacity: 0.42,
          lineHeight: 1.35
        }}
        title="No TLS metadata yet for this provider"
      >
        —
      </span>
    );
  }

  if (!trusted) {
    const why =
      tls.authorizationError != null &&
      String(tls.authorizationError).trim() !== ''
        ? String(tls.authorizationError)
        : 'TLS not verified';
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: '0.35rem',
          lineHeight: 1.35,
          maxWidth: compact ? '14rem' : 'none'
        }}
        title={why}
      >
        <Icon
          name="warning circle"
          color="orange"
          size={compact ? 'small' : 'small'}
          style={{ flexShrink: 0, margin: compact ? '0.1em 0 0 0' : '0.15em 0 0 0' }}
        />
        <span style={{ fontSize: compact ? '0.7rem' : '0.8rem', opacity: 0.88 }}>
          TLS: {why}
        </span>
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '0.4rem',
        lineHeight: 1.35,
        maxWidth: compact ? '15rem' : 'none'
      }}
      title="TLS certificate chain verified (Node.js trust store and hostname verification)"
    >
      <Icon
        name="check circle"
        color="green"
        size={compact ? 'small' : 'large'}
        style={{
          flexShrink: 0,
          margin: compact ? '0.05em 0 0 0' : '0.05em 0 0 0'
        }}
      />
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: compact ? '0.72rem' : '0.84rem',
            fontWeight: 600,
            color: 'rgba(0,0,0,.82)',
            wordBreak: 'break-word'
          }}
        >
          {signer ? (
            <>
              Signer: <span style={{ fontWeight: 650 }}>{signer}</span>
            </>
          ) : (
            <span style={{ fontWeight: 500, opacity: 0.72 }}>Certificate OK</span>
          )}
        </div>
        {!compact && proto ? (
          <div style={{ fontSize: '0.72rem', opacity: 0.52, marginTop: '0.1rem' }}>
            {proto}
          </div>
        ) : null}
      </div>
    </div>
  );
}
