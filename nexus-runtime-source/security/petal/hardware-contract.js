'use strict';

const contract = Object.freeze({
  id: 'nexus.petal.hardware-provider.v1',
  status: 'unavailable',
  requiredOperations: Object.freeze([
    'createProtectedKeyHandle', 'signChallenge', 'verifySignature',
    'authorizeOperation', 'revokeDevice', 'restoreWithRecovery'
  ]),
  requirements: Object.freeze([
    'Não exportar chaves privadas do hardware.',
    'Autenticar o dispositivo e proteger a comunicação contra replay.',
    'Vincular autorizações a operação, proposta, conteúdo e validade.',
    'Permitir revogação e recuperação auditadas.',
    'Não armazenar credenciais em configuração comum.'
  ]),
  validateProvider(provider) {
    return Boolean(provider && typeof provider === 'object' &&
      this.requiredOperations.every(operation => typeof provider[operation] === 'function'));
  }
});

module.exports = contract;
