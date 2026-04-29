/**
 * Single-quote detail (table + optional source breakdown).
 */

'use strict';

import { Component } from 'react';

import { Table } from 'semantic-ui-react';

import { formatFiatPrice, formatLocaleNumber, locale } from './localeNumber';
import TlsQuoteTrust from './feedMonitor/TlsQuoteTrust';
import { lookupProviderTls } from './feedMonitor/utils';

const AGE_TICK_MS = 32;

export default class Quote extends Component {
  constructor (props = {}) {
    super(props);

    this.state = {
      age: 0
    };
  }

  componentDidMount () {
    const tick = () => {
      const created = this.props.created;
      const t = typeof created === 'string' ? Date.parse(created) : NaN;
      this.setState({
        age: Number.isFinite(t) ? Math.max(0, Date.now() - t) : 0
      });
    };
    tick();
    this._timekeeper = setInterval(tick, AGE_TICK_MS);
  }

  componentWillUnmount () {
    if (this._timekeeper) clearInterval(this._timekeeper);
  }

  _formatLogAge (ln) {
    if (typeof ln !== 'number' || !Number.isFinite(ln)) return '—';
    return ln.toLocaleString(locale(), { maximumFractionDigits: 4 });
  }

  _abbrSources (sources) {
    if (!Array.isArray(sources) || !sources.length) return '';
    const parts = sources.map((s) => (s.label || s.provider)).filter(Boolean);
    return parts.join(' · ') || '';
  }

  render () {
    const symbol = this.props.symbol ?? '';
    const currency = this.props.currency ?? '';
    const rate = typeof this.props.rate === 'number' ? this.props.rate : 0;
    const src = this.props.sourceCount;
    /** @type {{ label?: string, provider?: string }[]|undefined} */
    const sources = Array.isArray(this.props.sources) ? this.props.sources : undefined;
    const compact = !!this.props.compactSourceList;
    const expanded = !!this.props.showAllSources;
    const tlsByProvider = this.props.tlsByProvider;

    return (
      <Table
        definition
        unstackable
      >
        <Table.Body>
          <Table.Row>
            <Table.Cell>Rate</Table.Cell>
            <Table.Cell><strong>{formatFiatPrice(rate, currency)}</strong></Table.Cell>
          </Table.Row>
          <Table.Row>
            <Table.Cell>Sources</Table.Cell>
            <Table.Cell>
              {(typeof src === 'number' && Number.isFinite(src)) ? String(src) : '—'}
            </Table.Cell>
          </Table.Row>
          {compact && sources && sources.length ? (
            <Table.Row>
              <Table.Cell colSpan={2}>
                <span
                  style={{
                    fontSize: '0.92em',
                    color: 'rgba(0,0,0,.6)',
                    lineHeight: 1.45,
                    wordBreak: 'break-word'
                  }}
                >
                  {this._abbrSources(sources)}
                </span>
              </Table.Cell>
            </Table.Row>
          ) : null}
          <Table.Row>
            <Table.Cell>Age</Table.Cell>
            <Table.Cell>{this.state.age} ms</Table.Cell>
          </Table.Row>
          {expanded && sources && sources.length ? (
              <>
                <Table.Row>
                  <Table.Cell colSpan={2}>
                    <strong style={{ fontSize: '0.92em' }}>Contributors</strong>
                  </Table.Cell>
                </Table.Row>
                {sources.map((s) => {
                  const lbl = String(s.label || s.provider || '—');
                  const key =
                    lbl + ':' + String(s.price) + ':' + String((s.age));
                  const cacheLbl =
                    s.fromCache
                      ? (typeof s.cacheAgeMs === 'number'
                        ? `cache · ${Math.round(s.cacheAgeMs)} ms ago`
                        : 'cache')
                      : 'live';

                  return (
                    <Table.Row key={key}>
                      <Table.Cell>{lbl}</Table.Cell>
                      <Table.Cell>
                        <strong>{formatFiatPrice(Number(s.price), currency)}</strong>
                        <div style={{ fontSize: '0.82em', color: 'rgba(0,0,0,.6)' }}>
                          ln-age {this._formatLogAge(Number(s.age))} ·{' '}
                          <span>{cacheLbl}</span>
                        </div>
                        {tlsByProvider ? (
                          <div style={{ marginTop: '0.4rem' }}>
                            <TlsQuoteTrust
                              tls={lookupProviderTls(tlsByProvider, s.provider)}
                              compact={false}
                            />
                          </div>
                        ) : null}
                      </Table.Cell>
                    </Table.Row>
                  );
                })}
              </>
            ) : null}
        </Table.Body>
      </Table>
    );
  }
}
