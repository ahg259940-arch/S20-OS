# S20 OS 1.0

Aplicativo Android nativo em Kotlin e Jetpack Compose, criado como companheiro experimental para o smartwatch S20 Ultra LS7076. O app mantém os módulos S20 e incorpora o runtime real do projeto N.E.X.U.S. para identidade, análise local, memória, objetivos, tarefas e proteção PETAL. A comunicação proprietária com o relógio ainda depende da identificação do protocolo.

## Requisitos e compilação

- JDK 17 e Gradle 8.11.1, compatíveis com o Android Gradle Plugin 8.9.2.
- Android SDK Platform 35, Build Tools 35.0.0, NDK 28.2.13676358 e CMake 3.22.1.
- Android 8.0 (API 26) ou superior para instalar o app.
- A compilação baixa o Node Mobile 24.22.1-0 de uma URL fixa e verifica o SHA-256 antes de compilar as bibliotecas nativas.

Compile localmente com `gradle assembleDebug`. A compilação requer acesso de rede para obter o runtime Node Mobile fixado; o APK de depuração será gerado em `app/build/outputs/apk/debug/app-debug.apk`. O workflow `.github/workflows/android.yml` testa os módulos integrados, compila o APK e executa o teste instrumentado em emulador. A publicação de um Release permanece em workflow separado, acionado manualmente.

## Módulos

- **S20 Home:** estado atual, informação de versão e atalhos.
- **S20 AI:** respostas locais básicas para ajuda, Bluetooth/conexão e hora. Não chama serviços online.
- **S20 Connect:** busca BLE com as APIs Android e permissões solicitadas em tempo de execução. Resultados são dispositivos detectados; não representam vínculo ou conexão.
- **S20 Bridge:** estrutura visual de estado; não envia mensagens até o protocolo LS7076 ser conhecido.
- **Remote Screen:** apresenta os requisitos para uma futura implementação com MediaProjection e receptor compatível; espelhamento não implementado.
- **Air Mouse:** controles remotos identificados como pendentes até existir receptor compatível e protocolo documentado; nenhum comando simulado é enviado.
- **Air Keyboard:** rascunho de texto local; envio remoto ainda pendente.
- **Apps:** lista navegável dos módulos.
- **Settings:** versão, tema, dados Android e estado informativo dos serviços.
- **N.E.X.U.S.:** abre a PWA real do N.E.X.U.S. em uma WebView local; o núcleo CommonJS roda no processo Android via Node Mobile.

## Integração do N.E.X.U.S.

O código integrado em `nexus-runtime-source/` vem do repositório N.E.X.U.S. no commit `0413a88ea2a0637f53989f2427b37c012f97bd6b`. O Gradle copia o core JavaScript, a interface e os módulos de identidade, memória, objetivos/tarefas, PETAL e Minecraft para os assets do APK. A identidade N.E.X.U.S. e suas APIs permanecem separadas dos composables do S20 OS.

O runtime abre somente em `127.0.0.1:4318`. O app gera um token aleatório por instalação para proteger a API local. Dados são gravados em JSON no armazenamento privado do app, escopados por usuário/universo; eles não são cifrados em repouso. O app desativa backup Android padrão. A WebView bloqueia acesso a arquivos e navegação fora da origem local.

O gateway `/api/minecraft/agent/observations` permanece indisponível: o servidor do commit de origem referencia `minecraft/agent-gateway.js`, mas o arquivo não existe. A cópia integrada responde explicitamente com HTTP 503 para essa rota. O módulo Minecraft disponível consulta status Java/Bedrock e salva configurações; ele não controla mundos. A varredura BLE do S20 também continua separada: o N.E.X.U.S. ainda não recebe dispositivos, executa comandos do relógio nem sincroniza memória com relógio ou outros aparelhos.

PETAL informa o estado parcial documentado pelo próprio projeto. Não há biometria, Keystore integrado, hardware PETAL, aprovação humana confiável, criptografia dos dados operacionais ou execução de ações sensíveis. Os SDKs OpenAI/Gemini também não são empacotados no APK nesta etapa; o processamento local funciona e não chama provedores externos por padrão.

Valide o núcleo copiado sem tocar nos dados do app com `node --test tests/nexus-runtime.integration.test.js`. O teste usa uma cópia temporária e verifica identidade, memória, objetivos, tarefas e limites PETAL. O teste Android instrumentado exercita a inicialização do runtime e a proteção por token.

## Bluetooth e protocolo LS7076

No Android 12 ou posterior o app pede `BLUETOOTH_SCAN` e `BLUETOOTH_CONNECT`; em versões anteriores pede localização precisa para descoberta. A busca usa Bluetooth LE e termina após 15 segundos. O sistema pode exigir Bluetooth ligado e autorização do usuário. O log diagnóstico BLE é opcional para o fluxo e fica cifrado com AES-GCM usando uma chave Android Keystore; valores brutos lidos de características também podem ser registrados nesse log local.

Ainda não há documentação verificada do protocolo de aplicação do LS7076, UUIDs de serviço/características, formato de mensagens ou fluxo de pareamento. Portanto, a versão 1.0 não tenta emparelhar ou enviar comandos, nem apresenta conexão simulada. Para completar o Bridge é necessário capturar/obter a especificação de comunicação do relógio e validar o fluxo em hardware real.

## Estrutura

```text
app/src/main/AndroidManifest.xml
app/src/main/java/com/s20os/app/MainActivity.kt
app/src/main/java/com/s20os/app/NexusRuntime.kt
app/src/main/cpp/nexus_node.cpp
nexus-runtime-source/
app/src/main/res/drawable/ic_launcher.xml
app/build.gradle.kts
.github/workflows/android.yml
```

## Validação

O fluxo automatizado compila o APK de debug com Android SDK 35. Teste a descoberta em um telefone Android físico com Bluetooth LE e valide qualquer integração com o LS7076 real; emuladores podem não oferecer Bluetooth utilizável. Não há ainda teste instrumentado que valide o protocolo do relógio.

Para instalar em um telefone conectado com depuração USB autorizada, use `adb install -r app/build/outputs/apk/debug/app-debug.apk`. Abra **S20 OS** e use **S20 Connect → Procurar** para descobrir dispositivos próximos; confirme o nome e o endereço antes de conectar. Conectar só permite explorar serviços e características GATT. O app não pareia nem envia comandos proprietários ao LS7076 nesta versão.
