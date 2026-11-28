'use strict';

const identity = require('./identity-provider.js');
const capabilities = require('./capabilities.js');
const petal = require('../security/petal/index.js');
const contextManager = require('./context-manager.js');
const intelligence = require('./intelligence.js');

function getSystemProfile({ sessionActive = false } = {}) {
  const context = contextManager.getCurrentContext();
  return {
    identity: identity.getIdentity(),
    operationalState: {
      status: sessionActive ? 'available' : 'unavailable',
      currentActivity: { status: 'not_observed', reason: 'Não há rastreador de atividade concorrente no core.' },
      generative: { ...intelligence.getProviderStatus(), invoked: false },
      cancellation: { available: false, reason: 'O núcleo não oferece cancelamento seguro após iniciar o processamento.' }
    },
    context: context ? {
      userId: context.userId,
      displayName: context.displayName,
      universeId: context.universeId,
      universeName: context.universeName,
      game: context.game
    } : null,
    permissions: {
      contextAuthenticated: sessionActive,
      sensitiveOperationsRequireHumanApproval: true,
      trustedHumanApprovalAvailable: false,
      sensitiveOperationsEnabled: false
    },
    capabilities: capabilities.getCapabilities(),
    petal: petal.getStatus({ sessionActive })
  };
}

module.exports = { getSystemProfile };
