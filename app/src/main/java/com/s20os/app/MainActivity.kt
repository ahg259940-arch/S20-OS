package com.s20os.app

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import kotlinx.coroutines.launch

private val Ink = Color(0xFF0C0D12)
private val Panel = Color(0xFF171922)
private val Accent = Color(0xFFA78BFA)
private val Muted = Color(0xFF9A9BAC)
private data class Module(val route: String, val title: String, val icon: String, val detail: String)
private val modules = listOf(
    Module("home", "S20 Home", "⌂", "Painel do dispositivo"), Module("ai", "S20 AI", "✦", "Assistente local"),
    Module("connect", "S20 Connect", "ᛒ", "Bluetooth e dispositivos"), Module("bridge", "S20 Bridge", "⇄", "Camada de comunicação"),
    Module("screen", "Remote Screen", "▣", "Tela remota"), Module("mouse", "Air Mouse", "⌖", "Controle por gestos"),
    Module("keyboard", "Air Keyboard", "⌨", "Teclado de controle"), Module("apps", "Apps", "▦", "Módulos instalados"),
    Module("settings", "Settings", "⚙", "Preferências e diagnóstico"),
    Module("nexus", "N.E.X.U.S.", "◉", "Núcleo inteligente integrado")
)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { S20App() }
    }
}

@Composable private fun S20App() {
    val nav = rememberNavController()
    val entry by nav.currentBackStackEntryAsState()
    val drawerState = rememberDrawerState(DrawerValue.Closed)
    val scope = rememberCoroutineScope()
    MaterialTheme(colorScheme = darkColorScheme(primary = Accent, background = Ink, surface = Panel, onBackground = Color.White, onSurface = Color.White)) {
        ModalNavigationDrawer(
            drawerState = drawerState,
            drawerContent = {
                ModalDrawerSheet(drawerContainerColor = Color(0xFF111219)) {
                    Text("S20 OS", color = Accent, fontSize = 21.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(horizontal = 24.dp, vertical = 22.dp))
                    HorizontalDivider(color = Panel)
                    LazyColumn(Modifier.weight(1f).padding(vertical = 10.dp)) {
                        items(modules, key = { it.route }) { module ->
                            NavigationDrawerItem(
                                label = { Text(module.title) },
                                icon = { Text(module.icon, color = Accent, fontSize = 18.sp) },
                                selected = entry?.destination?.route == module.route,
                                onClick = {
                                    nav.navigate(module.route) { launchSingleTop = true }
                                    scope.launch { drawerState.close() }
                                },
                                modifier = Modifier.padding(horizontal = 12.dp)
                            )
                        }
                    }
                }
            }
        ) {
            NavHost(navController = nav, startDestination = "home", modifier = Modifier.fillMaxSize().background(Ink)) {
                modules.forEach { module -> composable(module.route) { ModuleScreen(module, nav) { scope.launch { drawerState.open() } } } }
            }
        }
    }
}

@Composable private fun ModuleScreen(module: Module, nav: androidx.navigation.NavHostController, onOpenMenu: () -> Unit) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    var query by remember { mutableStateOf("") }
    var answer by remember { mutableStateOf("Sou o assistente local do S20 OS. Posso ajudar com informações disponíveis neste aplicativo.") }
    val permissions = remember { if (android.os.Build.VERSION.SDK_INT >= 31) arrayOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT) else arrayOf(Manifest.permission.ACCESS_FINE_LOCATION) }
    val central = remember(context) { BluetoothCentral(context) }
    var pendingBluetoothAction by remember { mutableStateOf<(() -> Unit)?>(null) }
    val permissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
        val action = pendingBluetoothAction
        pendingBluetoothAction = null
        if (result.values.all { it }) action?.invoke() else central.reportPermissionDenied()
    }
    fun withBluetoothPermission(action: () -> Unit) {
        if (permissions.all { ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED }) action()
        else { pendingBluetoothAction = action; permissionLauncher.launch(permissions) }
    }
    DisposableEffect(central, lifecycleOwner) {
        central.refreshAdapterState()
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_RESUME -> central.refreshAdapterState()
                Lifecycle.Event.ON_STOP -> central.disconnect()
                else -> Unit
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer); central.close() }
    }

    Column(Modifier.fillMaxSize().padding(horizontal = 22.dp, vertical = 18.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onOpenMenu) { Text("☰", color = Accent, fontSize = 21.sp) }
            Column(Modifier.weight(1f)) {
                Text("S20 OS  /  ${module.title.uppercase()}", color = Muted, fontSize = 10.sp, letterSpacing = 1.4.sp)
                Spacer(Modifier.height(4.dp)); Text(module.title, color = Color.White, fontSize = 25.sp, fontWeight = FontWeight.Bold)
            }
            Text("1.0", color = Accent, fontSize = 12.sp)
        }
        Spacer(Modifier.height(18.dp))
        when (module.route) {
            "home" -> {
                Box(Modifier.fillMaxWidth().height(150.dp).background(Panel, RoundedCornerShape(22.dp)).padding(18.dp)) {
                    Column {
                        Text("Bom dia", color = Muted, fontSize = 13.sp)
                        Text("Seu espaço conectado.", color = Color.White, fontSize = 23.sp, fontWeight = FontWeight.Bold)
                        Spacer(Modifier.height(12.dp)); Text("Bluetooth disponível em S20 Connect", color = Accent, fontSize = 13.sp)
                    }
                }
                Spacer(Modifier.height(15.dp)); Text("MÓDULOS", color = Muted, fontSize = 10.sp, letterSpacing = 1.3.sp)
                LazyColumn(verticalArrangement = Arrangement.spacedBy(9.dp), contentPadding = PaddingValues(top = 9.dp, bottom = 24.dp)) {
                    items(modules.filter { it.route != "home" }) { m -> ModuleCard(m) { nav.navigate(m.route) } }
                }
            }
            "connect" -> {
                val state = central.state
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Bluetooth: ${state.adapterState} · ${state.connectionState}", color = Muted, modifier = Modifier.weight(1f), fontSize = 12.sp)
                    Button(onClick = { withBluetoothPermission { central.scan() } }, colors = ButtonDefaults.buttonColors(containerColor = Accent)) { Text("Procurar", color = Ink) }
                    Spacer(Modifier.width(6.dp)); OutlinedButton(onClick = { central.disconnect() }, enabled = state.connectionState != "Desconectado") { Text("Desconectar") }
                }
                Spacer(Modifier.height(8.dp)); Text("${state.scanState} · ${state.deviceName}", color = Muted, fontSize = 12.sp)
                state.lastError.takeIf { it.isNotBlank() }?.let { Spacer(Modifier.height(6.dp)); CardPanel("Último erro", it) }
                Spacer(Modifier.height(8.dp)); Text("DISPOSITIVOS PRÓXIMOS", color = Muted, fontSize = 10.sp, letterSpacing = 1.2.sp)
                LazyColumn(Modifier.weight(1f, fill = false), verticalArrangement = Arrangement.spacedBy(7.dp), contentPadding = PaddingValues(vertical = 8.dp)) {
                    items(state.devices, key = { it.address }) { device ->
                        Row(Modifier.fillMaxWidth().background(Panel, RoundedCornerShape(12.dp)).padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(device.label + if (device.possibleLs7076) " · possível alvo" else "", color = Color.White, fontSize = 13.sp)
                                Text("${device.address} · ${device.rssi} dBm", color = Muted, fontSize = 10.sp)
                            }
                            Button(onClick = { withBluetoothPermission { central.connect(device.device) } }, colors = ButtonDefaults.buttonColors(containerColor = Accent)) { Text("Conectar", color = Ink) }
                        }
                    }
                }
                Text("A sugestão LS7076/S20 usa somente o nome anunciado; confirme o relógio. Nenhum dado é enviado. Leituras são iniciadas apenas ao tocar em Ler.", color = Muted, fontSize = 10.sp)
                Spacer(Modifier.height(8.dp)); Text("SERVIÇOS GATT (${state.services.size})", color = Muted, fontSize = 10.sp, letterSpacing = 1.2.sp)
                state.services.forEach { Text(it, color = Color.White, fontSize = 11.sp) }
                Text("CARACTERÍSTICAS (${state.characteristics.size})", color = Muted, fontSize = 10.sp, letterSpacing = 1.2.sp)
                LazyColumn(Modifier.weight(1f, fill = false), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    items(state.characteristics, key = { it.characteristicUuid }) { characteristic ->
                        Row(Modifier.fillMaxWidth().background(Panel, RoundedCornerShape(10.dp)).padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(characteristic.characteristicUuid, color = Color.White, fontSize = 10.sp)
                                Text("Serviço ${characteristic.serviceUuid} · ${characteristic.properties}", color = Muted, fontSize = 9.sp)
                            }
                            if (characteristic.readable) TextButton(onClick = { withBluetoothPermission { central.read(characteristic.characteristicUuid) } }) { Text("Ler") }
                        }
                    }
                }
                state.lastRead.takeIf { it.isNotBlank() }?.let { CardPanel("Última leitura (hex bruto)", it) }
            }
            "ai" -> {
                CardPanel("Assistente local", "Funciona sem internet. Não há uma IA online configurada.")
                Spacer(Modifier.height(12.dp)); CardPanel("S20 AI", answer)
                Spacer(Modifier.height(12.dp)); Row(verticalAlignment = Alignment.CenterVertically) {
                    BasicTextField(query, { query = it }, Modifier.weight(1f).background(Panel, RoundedCornerShape(12.dp)).padding(14.dp), textStyle = androidx.compose.ui.text.TextStyle(color = Color.White, fontSize = 14.sp), decorationBox = { inner -> if (query.isEmpty()) Text("Escreva uma mensagem…", color = Muted); inner() })
                    Text("Enviar", color = Accent, modifier = Modifier.clickable { answer = localAnswer(query); query = "" }.padding(12.dp))
                }
            }
            "bridge" -> { CardPanel("S20 Bridge", "Camada local preparada para mensagens e estado. Protocolo do LS7076 ainda não documentado; nenhuma mensagem é enviada ao relógio."); Spacer(Modifier.height(10.dp)); CardPanel("Estado", "Sem dispositivo conectado · fila vazia") }
            "screen" -> CardPanel("Remote Screen", "A transmissão de tela ainda não está implementada. Android MediaProjection e protocolo receptor serão necessários para espelhamento real.")
            "mouse" -> {
                CardPanel("Air Mouse · pendente", "A superfície de controle será ativada quando houver um receptor compatível e um protocolo de comandos documentado. Nenhum comando é enviado nesta versão.")
                Spacer(Modifier.height(14.dp))
                Box(Modifier.fillMaxWidth().weight(1f).background(Panel, RoundedCornerShape(22.dp)).padding(20.dp), contentAlignment = Alignment.Center) {
                    Text("Controle remoto indisponível\nAguardando receptor compatível", color = Muted)
                }
                Spacer(Modifier.height(10.dp))
                Text("Os controles direcionais serão habilitados após a integração do receptor.", color = Muted, fontSize = 12.sp)
            }
            "keyboard" -> {
                CardPanel("Air Keyboard · envio pendente", "Você pode digitar neste campo localmente. O texto não é enviado ao relógio nem a outro dispositivo nesta versão.")
                Spacer(Modifier.height(10.dp))
                var typed by remember { mutableStateOf("") }
                BasicTextField(typed, { typed = it }, Modifier.fillMaxWidth().background(Panel, RoundedCornerShape(12.dp)).padding(14.dp), textStyle = androidx.compose.ui.text.TextStyle(color = Color.White, fontSize = 16.sp), decorationBox = { inner -> if (typed.isEmpty()) Text("Rascunho local…", color = Muted); inner() })
            }
            "apps" -> LazyColumn(verticalArrangement = Arrangement.spacedBy(9.dp)) { items(modules) { ModuleCard(it) { nav.navigate(it.route) } } }
            "settings" -> { CardPanel("Aparência", "Tema escuro ativo · versão 1.0"); Spacer(Modifier.height(10.dp)); CardPanel("Serviços", "Bluetooth: disponível conforme hardware e permissões · Bridge: inativo"); Spacer(Modifier.height(10.dp)); CardPanel("Diagnóstico", "Android ${android.os.Build.VERSION.RELEASE} (API ${android.os.Build.VERSION.SDK_INT}) · ${android.os.Build.MODEL}"); Spacer(Modifier.height(10.dp)); CardPanel("Sobre", "S20 OS 1.0 · com.s20os.app\nCompanheiro experimental para S20 Ultra LS7076") }
            "nexus" -> NexusEmbeddedScreen()
        }
    }
}

@Composable private fun ModuleCard(module: Module, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().background(Panel, RoundedCornerShape(15.dp)).clickable(onClick = onClick).padding(13.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(module.icon, color = Accent, fontSize = 19.sp, modifier = Modifier.width(34.dp)); Column { Text(module.title, color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.SemiBold); Text(module.detail, color = Muted, fontSize = 11.sp) }; Spacer(Modifier.weight(1f)); Text("›", color = Muted, fontSize = 21.sp)
    }
}

@Composable private fun CardPanel(title: String, description: String) {
    Column(Modifier.fillMaxWidth().background(Panel, RoundedCornerShape(15.dp)).padding(15.dp)) {
        Text(title, color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
        Spacer(Modifier.height(5.dp)); Text(description, color = Muted, fontSize = 12.sp, lineHeight = 17.sp)
    }
}

private fun localAnswer(input: String): String {
    val text = input.trim().lowercase()
    if (text.isEmpty()) return "Escreva uma pergunta para conversar comigo."
    return when {
        "conect" in text || "bluetooth" in text -> "Abra S20 Connect para buscar dispositivos Bluetooth próximos. A busca não confirma conexão com o LS7076."
        "hora" in text -> "Agora são ${java.text.SimpleDateFormat("HH:mm", java.util.Locale.getDefault()).format(java.util.Date())}."
        "ajuda" in text || "módulo" in text -> "Posso orientar sobre Connect, Bridge, Remote Screen, Air Mouse, Air Keyboard e as configurações disponíveis."
        else -> "Ainda sou um assistente local básico. Posso informar a hora e orientar sobre os módulos deste app; não há IA online conectada."
    }
}
