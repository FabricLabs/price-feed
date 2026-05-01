'use strict';

const assert = require('assert');

const { httpsRequestCaptured } = require('../services/outboundHttps');

describe('outbound HTTPS', function () {
  it('rejects non-HTTPS URLs', async function () {
    await assert.rejects(
      () =>
        httpsRequestCaptured({
          url: 'http://example.com/path',
          method: 'GET',
          headers: {},
          tlsServiceId: 'test'
        }),
      /HTTPS required/
    );
  });
});
