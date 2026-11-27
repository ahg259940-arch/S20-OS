package com.s20os.app

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController

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
    Module("settings", "Settings", "⚙", "Preferências e diagnóstico")
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
    MaterialTheme(colorScheme = darkColorScheme(primary = Accent, background = Ink, surface = Panel, onBackground = Color.White, onSurface = Color.White)) {
        Row(Modifier.fillMaxSize().background(Ink)) {
            Column(Modifier.width(76.dp).fillMaxHeight().background(Color(0xFF111219)).padding(vertical = 18.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Text("S", color = Accent, fontSize = 25.sp, fontWeight = FontWeight.Black, modifier = Modifier.padding(bottom = 20.dp))
                modules.forEach { m ->
                    val active = entry?.destination?.route == m.route
                    Column(Modifier.fillMaxWidth().clickable { nav.navigate(m.route) { launchSingleTop = true } }.padding(vertical = 9.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(m.icon, color = if (active) Accent else Muted, fontSize = 21.sp)
                        Text(m.title.substringBefore(' '), color = if (active) Color.White else Muted, fontSize = 9.sp)
                    }
                }
            }
            NavHost(navController = nav, startDestination = "home", modifier = Modifier.fillMaxSize()) {
                modules.forEach { module -> composable(module.route) { ModuleScreen(module, nav) } }
            }
        }
    }
}

@Composable private fun ModuleScreen(module: Module, nav: androidx.navigation.NavHostController) {
    val context = LocalContext.current
    var query by remember { mutableStateOf("") }
    var answer by remember { mutableStateOf("Sou o assistente local do S20 OS. Posso ajudar com informações disponíveis neste aplicativo.") }
    var scanStatus by remember { mutableStateOf("Bluetooth ainda não verificado") }
    var devices by remember { mutableStateOf(emptyList<String>()) }
    var scanCallback by remember { mutableStateOf<ScanCallback?>(null) }
    val permissions = remember { if (Build.VERSION.SDK_INT >= 31) arrayOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT) else arrayOf(Manifest.permission.ACCESS_FINE_LOCATION) }
    fun scan() {
        val manager = context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
        val adapter = manager.adapter
        if (adapter == null) { scanStatus = "Bluetooth não disponível neste telefone"; return }
        if (!adapter.isEnabled) { scanStatus = "Ative o Bluetooth do telefone e tente novamente"; return }
        try {
            val scanner = adapter.bluetoothLeScanner
            if (scanner == null) { scanStatus = "Scanner Bluetooth LE indisponível"; return }
            devices = emptyList(); scanStatus = "Procurando dispositivos próximos…"
            val cb = object : ScanCallback() {
                override fun onScanResult(callbackType: Int, result: ScanResult) {
                    val label = try { result.device.name ?: "Dispositivo ${result.device.address}" } catch (_: SecurityException) { "Dispositivo encontrado" }
                    devices = (devices + "$label · ${result.rssi} dBm").distinct()
                }
                override fun onScanFailed(errorCode: Int) { scanStatus = "Falha na busca Bluetooth (código $errorCode)" }
            }
            scanCallback = cb
            scanner.startScan(cb)
            android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({ try { scanner.stopScan(cb); if (scanStatus.startsWith("Procurando")) scanStatus = "Busca concluída" } catch (_: SecurityException) { scanStatus = "Permissão Bluetooth revogada" } }, 12_000)
        } catch (_: SecurityException) { scanStatus = "Permissão Bluetooth necessária" }
    }
    val permissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result -> if (result.values.all { it }) scan() else scanStatus = "Permissões negadas; busca não iniciada" }

    Column(Modifier.fillMaxSize().padding(horizontal = 22.dp, vertical = 18.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
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
                        Spacer(Modifier.height(12.dp)); Text("LS7076  ·  Não conectado", color = Accent, fontSize = 13.sp)
                    }
                }
                Spacer(Modifier.height(15.dp)); Text("MÓDULOS", color = Muted, fontSize = 10.sp, letterSpacing = 1.3.sp)
                LazyColumn(verticalArrangement = Arrangement.spacedBy(9.dp), contentPadding = PaddingValues(top = 9.dp, bottom = 24.dp)) {
                    items(modules.filter { it.route != "home" }) { m -> ModuleCard(m) { nav.navigate(m.route) } }
                }
            }
            "connect" -> {
                CardPanel("Bluetooth", "Busca BLE pelo adaptador deste telefone. Encontrar um dispositivo não significa que ele está conectado.")
                Spacer(Modifier.height(12.dp)); Text(scanStatus, color = Muted, fontSize = 13.sp)
                Spacer(Modifier.height(10.dp)); Button(onClick = { if (permissions.all { ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED }) scan() else permissionLauncher.launch(permissions) }, colors = ButtonDefaults.buttonColors(containerColor = Accent)) { Text("Buscar dispositivos", color = Ink) }
                Spacer(Modifier.height(10.dp)); if (devices.isEmpty()) Text("Nenhum dispositivo encontrado ainda.", color = Muted, fontSize = 13.sp) else LazyColumn { items(devices) { CardPanel(it, "Detectado via Bluetooth LE · não conectado") } }
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
            "mouse" -> { CardPanel("Air Mouse", "Painel de gestos local. Comandos só poderão ser enviados quando houver um receptor compatível."); Spacer(Modifier.height(14.dp)); Box(Modifier.fillMaxWidth().weight(1f).background(Panel, RoundedCornerShape(22.dp)).clickable { }.padding(20.dp), contentAlignment = Alignment.Center) { Text("Deslize aqui para controlar\nReceptor não conectado", color = Muted) }; Row { listOf("←", "↑", "↓", "→", "OK").forEach { Text(it, color = Accent, modifier = Modifier.weight(1f).clickable { }.padding(12.dp)) } } }
            "keyboard" -> { CardPanel("Air Keyboard", "Teclado visual local. Envio remoto indisponível enquanto não houver um receptor conectado."); Spacer(Modifier.height(10.dp)); var typed by remember { mutableStateOf("") }; BasicTextField(typed, { typed = it }, Modifier.fillMaxWidth().background(Panel, RoundedCornerShape(12.dp)).padding(14.dp), textStyle = androidx.compose.ui.text.TextStyle(color = Color.White, fontSize = 16.sp), decorationBox = { inner -> if (typed.isEmpty()) Text("Digite aqui…", color = Muted); inner() }); Spacer(Modifier.height(12.dp)); (listOf("Q W E R T Y U I O P", "A S D F G H J K L", "⇧ Z X C V B N M ⌫", "123       Espaço       ↵")).forEach { Text(it, color = Color.White, modifier = Modifier.fillMaxWidth().background(Panel, RoundedCornerShape(12.dp)).padding(14.dp)) } }
            "apps" -> LazyColumn(verticalArrangement = Arrangement.spacedBy(9.dp)) { items(modules) { ModuleCard(it) { nav.navigate(it.route) } } }
            "settings" -> { CardPanel("Aparência", "Tema escuro ativo · versão 1.0"); Spacer(Modifier.height(10.dp)); CardPanel("Serviços", "Bluetooth: disponível conforme hardware e permissões · Bridge: inativo"); Spacer(Modifier.height(10.dp)); CardPanel("Diagnóstico", "Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT}) · ${Build.MODEL}"); Spacer(Modifier.height(10.dp)); CardPanel("Sobre", "S20 OS 1.0 · com.s20os.app\nCompanheiro experimental para S20 Ultra LS7076") }
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
