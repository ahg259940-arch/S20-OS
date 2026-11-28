'use strict';

const futureCapabilities = [
  {
    id: 'minecraft.bedrock', name: 'Minecraft Bedrock',
    description: 'Conexão com mundo Bedrock, eventos e ações autorizadas.', status: 'disabled', group: 'future',
    dependencies: ['adaptador Bedrock', 'conexão e autorização explícitas'], permissions: ['game.read', 'game.action'],
    contexts: ['minecraft-universe'], evidence: ['Nenhum adaptador conectado ou executado.']
  },
  {
    id: 'microsoft.identity', name: 'Conta Microsoft',
    description: 'Autenticação interativa oficial para integrações que a exigirem.', status: 'disabled', group: 'future',
    dependencies: ['MSAL oficial', 'registro de aplicativo', 'PKCE e redirect URI validados'], permissions: ['scopes mínimos solicitados pelo usuário'],
    contexts: ['android', 'web'], evidence: ['Sem OAuth, conta, credencial ou token configurado.']
  },
  {
    id: 'creation.games', name: 'Criação de jogos',
    description: 'Desenvolvimento e teste supervisionados de jogos.', status: 'unavailable', group: 'future',
    dependencies: ['ferramentas de desenvolvimento', 'sandbox de execução'], permissions: ['workspace.write', 'code.execute'],
    contexts: ['project'], evidence: ['Não há motor de jogo integrado.']
  },
  {
    id: 'creation.tools', name: 'Criação de ferramentas',
    description: 'Preparar propostas de ferramentas sem executar código gerado.', status: 'experimental', group: 'implemented',
    dependencies: ['core/development.js', 'auditoria'], permissions: ['project.propose'],
    contexts: ['main', 'authenticated-context'], evidence: ['core/development.js', 'tests/campaign-integration.test.js'],
    limits: ['Propostas não são gravadas nem executadas pela interface.']
  },
  {
    id: 'security.hardware', name: 'Hardware PETAL',
    description: 'Chaves e operações críticas apoiadas por dispositivo físico.', status: 'unavailable', group: 'future',
    dependencies: ['adaptador de hardware auditado', 'canal autenticado'], permissions: ['hardware.key-operation'],
    contexts: ['android', 'desktop'], evidence: ['Contrato documentado; nenhum dispositivo está conectado.']
  },
  {
    id: 'integrations.external', name: 'Integrações externas',
    description: 'Serviços externos ativados somente por configuração e ação explícitas.', status: 'disabled', group: 'future',
    dependencies: ['adaptador específico', 'credenciais protegidas', 'revisão de permissões'], permissions: ['external.request'],
    contexts: ['main', 'authenticated-context'], evidence: ['Nenhuma integração externa é chamada pela PWA.']
  }
];

function getCapabilities() {
  const generativeConfigured = require('./intelligence.js').getProviderStatus().configured;
  const existing = [
    {
      id: 'core.local-analysis', name: 'Análise local', description: 'Percepção, análise, raciocínio, ética e decisão recomendatória.',
      status: 'available', group: 'implemented', dependencies: ['core/engine.js', 'memória local'], permissions: ['context.read'],
      contexts: ['main', 'authenticated-context'], evidence: ['core/engine.js', 'tests/campaign-integration.test.js', 'tests/app-preview.test.js']
    },
    {
      id: 'projects.context-workspace', name: 'Workspace de projetos', description: 'Projetos persistentes isolados por contexto, com revisões, arquivamento e restauração.',
      status: 'available', group: 'implemented', dependencies: ['core/projects.js', 'core/storage.js', 'core/audit.js', 'core/context-scope.js'], permissions: ['project.read', 'project.write', 'project.archive', 'project.delete.confirmed'],
      contexts: ['main', 'authenticated-context'], evidence: ['tests/projects.test.js', 'tests/app-preview.test.js'],
      limits: ['Exclusão exige arquivamento prévio e confirmação explícita do nome; arquivos de projeto e código executável não são gerados pelo gerenciador.']
    },
    {
      id: 'assistant.local', name: 'Assistente local', description: 'Conversa fundamentada no processamento local e contexto ativo.',
      status: 'available', group: 'implemented', dependencies: ['core/engine.js', 'core/intelligence.js'], permissions: ['context.read', 'conversation.write'],
      contexts: ['main', 'authenticated-context'], evidence: ['tests/app-preview.test.js', 'tests/context-isolation.test.js'],
      limits: ['A PWA desativa geração externa; cancelamento do processamento do core ainda não é suportado.']
    },
    {
      id: 'memory.contextual', name: 'Memória contextual', description: 'Recuperação e persistência de experiências isoladas por contexto.',
      status: 'available', group: 'implemented', dependencies: ['memory/memory.js', 'core/context-scope.js'], permissions: ['memory.read', 'memory.write'],
      contexts: ['main', 'authenticated-context'], evidence: ['tests/memory-order.test.js', 'tests/context-isolation.test.js']
    },
    {
      id: 'planning.objectives-tasks', name: 'Objetivos e tarefas', description: 'Planejamento, acompanhamento e progresso com registros auditados.',
      status: 'available', group: 'implemented', dependencies: ['core/goals.js', 'core/tasks.js'], permissions: ['goal.write', 'task.write'],
      contexts: ['main', 'authenticated-context'], evidence: ['tests/campaign-integration.test.js', 'tests/context-isolation.test.js']
    },
    {
      id: 'contexts.isolation', name: 'Isolamento de contextos', description: 'Separação de memória, conversas, objetivos, tarefas e preferências.',
      status: 'available', group: 'implemented', dependencies: ['core/context-manager.js', 'core/context-scope.js'], permissions: ['context.select'],
      contexts: ['authenticated-context'], evidence: ['tests/context-isolation.test.js', 'tests/app-preview.test.js']
    },
    {
      id: 'preview.sessions', name: 'Sessões da prévia local', description: 'Cookie de sessão curto, HttpOnly, SameSite e escopado ao contexto.',
      status: 'available', group: 'implemented', dependencies: ['app/auth-session.js', 'app/server.js'], permissions: ['session.activate', 'session.revoke'],
      contexts: ['local-preview'], evidence: ['tests/auth-session.test.js', 'tests/app-preview.test.js'],
      limits: ['Não autentica a pessoa e não equivale a biometria Android.']
    },
    {
      id: 'backup.encrypted-export', name: 'Backup cifrado', description: 'Exportação cifrada no navegador e validação/restauração em diretório temporário.',
      status: 'experimental', group: 'implemented', dependencies: ['WebCrypto AES-256-GCM', 'PBKDF2-SHA-256'], permissions: ['context.read', 'temporary.restore'],
      contexts: ['authenticated-context'], evidence: ['tests/backup-crypto.test.js'],
      limits: ['Dados operacionais em repouso não são cifrados; não existe restauração sobre os dados reais.']
    },
    {
      id: 'intelligence.generative', name: 'Inteligência generativa', description: 'Respostas externas opcionais por OpenAI ou Gemini; nunca são tratadas como fatos verificados.',
      status: generativeConfigured ? 'experimental' : 'disabled', group: 'implemented', dependencies: ['chave de provedor configurada', 'provedor acessível'], permissions: ['external.ai'],
      contexts: ['main'], evidence: ['tests/generative-integration.test.js'],
      limits: ['Cada envio externo exige opt-in explícito na conversa; chave inserida na interface fica apenas na memória do processo.']
    }
  ];
  return structuredClone([...existing, ...futureCapabilities]);
}

function getCapability(id) {
  return getCapabilities().find(capability => capability.id === id) || null;
}

module.exports = { getCapabilities, getCapability, allowedStatuses: ['available', 'experimental', 'disabled', 'unavailable'] };
