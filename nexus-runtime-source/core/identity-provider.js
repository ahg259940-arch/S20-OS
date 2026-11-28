'use strict';

const baseIdentity = require('../personality/identity.js');

function getIdentity() {
  return structuredClone(baseIdentity);
}

module.exports = { getIdentity };
