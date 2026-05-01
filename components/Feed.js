/**
 * Headline BTC spot (aggregated).
 */

'use strict';

import { Component } from 'react';

import {
  Grid,
  Loader,
  Segment,
  Statistic
} from 'semantic-ui-react';

import { formatFiatPrice } from './localeNumber';

export default class Feed extends Component {
  render () {
    const v = this.props.spotUsd;
    const label =
      typeof this.props.label === 'string' && this.props.label.trim() !== ''
        ? this.props.label.trim()
        : 'BTC → USD';

    const trailing = this.props.trailing;
    const aside = this.props.aside;

    const spotCurrency =
      typeof this.props.spotCurrency === 'string' &&
      this.props.spotCurrency.trim() !== ''
        ? this.props.spotCurrency.trim().toUpperCase()
        : 'USD';

    const statisticOrLoader =
      typeof v === 'number' && Number.isFinite(v) ? (
        <Statistic style={{ marginBottom: 0 }}>
          <Statistic.Value>{formatFiatPrice(v, spotCurrency)}</Statistic.Value>
          <Statistic.Label>{label}</Statistic.Label>
        </Statistic>
      ) : (
        <Loader active inline="centered" size="small">
          Loading feed…
        </Loader>
      );

    const hasAside = aside != null;

    if (!trailing && !hasAside) {
      return <Segment>{statisticOrLoader}</Segment>;
    }

    if (typeof v !== 'number' || !Number.isFinite(v)) {
      return <Segment>{statisticOrLoader}</Segment>;
    }

    const leftBlock = (
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'flex-start',
          gap: '0.85rem 1.25rem'
        }}
      >
        {statisticOrLoader}
        {trailing || null}
      </div>
    );

    if (!hasAside) {
      return <Segment basic>{leftBlock}</Segment>;
    }

    return (
      <Segment basic>
        <Grid stackable verticalAlign="top">
          <Grid.Column computer={10} tablet={16} mobile={16}>
            {leftBlock}
          </Grid.Column>
          <Grid.Column computer={6} tablet={16} mobile={16}>
            {aside}
          </Grid.Column>
        </Grid>
      </Segment>
    );
  }
}
