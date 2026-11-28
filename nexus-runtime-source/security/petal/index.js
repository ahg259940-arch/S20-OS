'use strict';

const hardwareContract = require('./hardware-contract.js');

const definitions = [
  {
    id: 'identity-authentication', name: 'Identidade e autenticação', status: 'experimental',
    implementation: ['core/context-manager.js', 'app/auth-session.js'],
    evidence: ['tests/context-isolation.test.js', 'tests/auth-session.test.js'],
    limits: ['Credencial do contexto e sessão local não comprovam identidade humana; biometria e passkeys não estão conectadas.']
  },
  {
    id: 'authorization-permissions', name: 'Autorização e permissões', status: 'available',
    implementation: ['core/authorization.js', 'core/ethics.js', 'core/decision.js'],
    evidence: ['tests/campaign-integration.test.js'],
    limits: ['Não há provedor confiável de aprovação humana; operações sensíveis permanecem bloqueadas.']
  },
  {
    id: 'session-protection', name: 'Proteção de sessões', status: 'available',
    implementation: ['app/auth-session.js', 'app/server.js'], evidence: ['tests/auth-session.test.js', 'tests/app-preview.test.js'],
    limits: ['Sessões são mantidas em memória, expiradas em 30 minutos e dependem de acesso local ao processo.']
  },
  {
    id: 'credentials-secrets', name: 'Credenciais e segredos', status: 'experimental',
    implementation: ['core/context-manager.js', 'app/auth-session.js'], evidence: ['tests/context-isolation.test.js', 'tests/auth-session.test.js'],
    limits: ['Credenciais de usuário são armazenadas como hash; chave administrativa vem do ambiente. Não existe cofre de segredos nem proteção geral de tokens em repouso.']
  },
  {
    id: 'cryptography', name: 'Criptografia', status: 'experimental',
    implementation: ['app/web/backup-crypto.js'], evidence: ['tests/backup-crypto.test.js'],
    limits: ['Somente arquivos de exportação são cifrados; os dados operacionais em repouso permanecem JSON.']
  },
  {
    id: 'data-integrity', name: 'Integridade dos dados', status: 'available',
    implementation: ['core/storage.js', 'core/backup.js'], evidence: ['tests/campaign-integration.test.js', 'tests/backup-crypto.test.js'],
    limits: ['Gravações são atômicas; não há assinatura criptográfica contínua de todos os arquivos.']
  },
  {
    id: 'audit', name: 'Auditoria', status: 'available',
    implementation: ['core/audit.js', 'app/server.js'], evidence: ['tests/campaign-integration.test.js', 'tests/app-preview.test.js'],
    limits: ['Falhas impedem confirmar operação; auditoria local não é um log remoto inviolável.']
  },
  {
    id: 'suspicious-operations', name: 'Detecção de operações suspeitas', status: 'experimental',
    implementation: ['app/server.js'], evidence: ['tests/app-preview.test.js'],
    limits: ['Há limitação de tentativas de autenticação da prévia; não existe detector geral de intrusão ou análise comportamental.']
  },
  {
    id: 'recovery-restoration', name: 'Recuperação e restauração segura', status: 'experimental',
    implementation: ['core/backup.js'], evidence: ['tests/backup-crypto.test.js'],
    limits: ['A rotina validada restaura somente em diretório temporário; não restaura dados reais automaticamente.']
  },
  {
    id: 'hardware-security', name: 'Preparação para hardware de segurança', status: 'unavailable',
    implementation: ['security/petal/hardware-contract.js'], evidence: ['tests/petal.test.js'],
    limits: ['Contrato de adaptador documentado; nenhum hardware, chave ou operação criptográfica de dispositivo está conectado.']
  }
];

function getStatus({ sessionActive = false } = {}) {
  const permissionMap = {
    'identity-authentication': ['session.activate'], 'authorization-permissions': ['operation-specific approval'],
    'session-protection': ['session.activate', 'session.revoke'], 'credentials-secrets': ['secret.read'],
    cryptography: ['backup.encrypt'], 'data-integrity': ['data.read', 'atomic.write'], audit: ['audit.append', 'audit.read'],
    'suspicious-operations': ['authentication.rate-limit'], 'recovery-restoration': ['temporary.restore'],
    'hardware-security': ['hardware.key-operation']
  };
  return {
    name: 'N.E.X.U.S. PETAL',
    subtitle: 'Segurança e proteção',
    state: 'partial',
    session: { active: sessionActive, transport: 'local-http', humanAuthenticated: false },
    modules: definitions.map(module => ({ ...structuredClone(module), permissions: permissionMap[module.id] || [] }))
  };
}

module.exports = { getStatus, hardwareContract };
