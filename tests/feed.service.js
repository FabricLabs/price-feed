'use strict';

const assert = require('assert');
const Feed = require('../services/feed');

describe('@portal/feed', function () {
  describe('Feed', function () {
    it('is an instance of a function', function () {
      assert.equal(Feed instanceof Function, true);
    });
  });
});
