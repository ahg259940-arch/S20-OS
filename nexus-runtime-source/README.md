# N.E.X.U.S. runtime integrado

Este diretório contém o runtime JavaScript real do repositório N.E.X.U.S., fixado no commit `0413a88ea2a0637f53989f2427b37c012f97bd6b` (2026-11-09). A origem é `https://github.com/ahg259940-arch/NEXUS`.

O Gradle sincroniza `app/`, `core/`, `memory/`, `personality/`, `security/` e `minecraft/` como assets privados do APK. O aplicativo executa `app/server.js` no Node Mobile e abre `app/web/` em uma WebView restrita a `127.0.0.1:4318`. Dados persistentes são criados no armazenamento privado do aplicativo, fora dos assets. Não copie dados operacionais do repositório de origem.

Os arquivos de lógica foram importados sem reescrita; a única adaptação local é a rota `/api/minecraft/agent/observations` retornar `503` explícito. O servidor original referencia `minecraft/agent-gateway.js`, mas esse arquivo não existe no commit de origem. Status de servidores Minecraft e configuração local permanecem disponíveis; o gateway de agente não.

Para atualizar o runtime, revise um novo commit do repositório original, importe apenas os diretórios necessários, preserve esta nota e execute os testes de núcleo e Android. Não faça a atualização por download flutuante no build: o commit precisa continuar fixado e revisável.
