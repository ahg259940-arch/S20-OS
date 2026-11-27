# S20 OS 1.0

Aplicativo Android nativo em Kotlin e Jetpack Compose, criado como companheiro experimental para o smartwatch S20 Ultra LS7076. O app fornece navegação entre nove módulos, ferramentas locais e descoberta Bluetooth LE real. A comunicação proprietária com o relógio ainda depende da identificação do protocolo.

## Requisitos e compilação

- JDK 17 ou 21 e Gradle 8.11 ou compatível com o Android Gradle Plugin 8.9.2.
- Android SDK Platform 35 e Build Tools 35.0.0.
- Android 8.0 (API 26) ou superior para instalar o app.

Compile localmente com `gradle assembleDebug`. O APK de depuração será gerado em `app/build/outputs/apk/debug/app-debug.apk`. O workflow `.github/workflows/android.yml` compila o APK no GitHub Actions em push para `main`, pull request ou execução manual e publica o arquivo como artefato da execução.

## Módulos

- **S20 Home:** estado atual, informação de versão e atalhos.
- **S20 AI:** respostas locais básicas para ajuda, Bluetooth/conexão e hora. Não chama serviços online.
- **S20 Connect:** busca BLE com as APIs Android e permissões solicitadas em tempo de execução. Resultados são dispositivos detectados; não representam vínculo ou conexão.
- **S20 Bridge:** estrutura visual de estado; não envia mensagens até o protocolo LS7076 ser conhecido.
- **Remote Screen:** apresenta os requisitos para uma futura implementação com MediaProjection e receptor compatível; espelhamento não implementado.
- **Air Mouse:** superfície e controles visuais; envio depende de receptor compatível.
- **Air Keyboard:** campo de texto e teclado visual; comandos não são enviados remotamente.
- **Apps:** lista navegável dos módulos.
- **Settings:** versão, tema, dados Android e estado informativo dos serviços.

## Bluetooth e protocolo LS7076

No Android 12 ou posterior o app pede `BLUETOOTH_SCAN` e `BLUETOOTH_CONNECT`; em versões anteriores pede localização precisa para descoberta. A busca usa Bluetooth LE e termina após 12 segundos. O sistema pode exigir Bluetooth ligado e autorização do usuário.

Ainda não há documentação verificada do protocolo de aplicação do LS7076, UUIDs de serviço/características, formato de mensagens ou fluxo de pareamento. Portanto, a versão 1.0 não tenta emparelhar ou enviar comandos, nem apresenta conexão simulada. Para completar o Bridge é necessário capturar/obter a especificação de comunicação do relógio e validar o fluxo em hardware real.

## Estrutura

```text
app/src/main/AndroidManifest.xml
app/src/main/java/com/s20os/app/MainActivity.kt
app/src/main/res/drawable/ic_launcher.xml
app/build.gradle.kts
.github/workflows/android.yml
```

## Validação

O fluxo automatizado compila o APK de debug com Android SDK 35. Teste a descoberta em um telefone Android físico com Bluetooth LE e valide qualquer integração com o LS7076 real; emuladores podem não oferecer Bluetooth utilizável. Não há ainda teste instrumentado que valide o protocolo do relógio.
