package com.s20os.app

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

data class BleDeviceRow(val label: String, val address: String, val rssi: Int, val device: BluetoothDevice) {
    val possibleLs7076: Boolean get() = BluetoothCentral.looksLikeLs7076(label)
}
data class BleCharacteristicRow(val serviceUuid: String, val characteristicUuid: String, val properties: String, val readable: Boolean)
data class BleSnapshot(
    val adapterState: String = "Desconhecido", val connectionState: String = "Desconectado",
    val deviceName: String = "", val scanState: String = "Pronto", val devices: List<BleDeviceRow> = emptyList(),
    val services: List<String> = emptyList(), val characteristics: List<BleCharacteristicRow> = emptyList(),
    val lastRead: String = "", val lastError: String = ""
)

/** BLE GATT explorer. It only reads characteristics after an explicit user tap; it never writes. */
class BluetoothCentral(context: Context) {
    private val appContext = context.applicationContext
    private val manager = appContext.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
    private val adapter: BluetoothAdapter? get() = manager.adapter
    private val main = Handler(Looper.getMainLooper())
    private var scanCallback: ScanCallback? = null
    private var gatt: BluetoothGatt? = null
    private val readQueue = ArrayDeque<BluetoothGattCharacteristic>()
    private var readInFlight = false
    private val charByUuid = mutableMapOf<String, BluetoothGattCharacteristic>()
    var state by mutableStateOf(BleSnapshot())
        private set

    fun refreshAdapterState() {
        val a = adapter
        state = state.copy(adapterState = when {
            a == null -> "Indisponível"
            !a.isEnabled -> "Desativado"
            else -> "Ativado"
        })
    }

    fun reportPermissionDenied() { error("Permissões negadas; operação Bluetooth não iniciada") }

    fun scan() {
        refreshAdapterState()
        val a = adapter ?: return error("Bluetooth não disponível neste telefone")
        if (!a.isEnabled) return error("Ative o Bluetooth do telefone")
        stopScan()
        try {
            val scanner = a.bluetoothLeScanner ?: return error("Scanner BLE indisponível")
            state = state.copy(devices = emptyList(), scanState = "Buscando dispositivos próximos", lastError = "")
            BleDiagnosticLog.record(appContext, "scan_started")
            val callback = object : ScanCallback() {
                override fun onScanResult(callbackType: Int, result: ScanResult) {
                    val device = result.device
                    val name = try { device.name ?: result.scanRecord?.deviceName ?: "Dispositivo sem nome" }
                    catch (_: SecurityException) { result.scanRecord?.deviceName ?: "Dispositivo sem nome" }
                    val row = BleDeviceRow(name, device.address, result.rssi, device)
                    main.post { state = state.copy(devices = (state.devices.filterNot { it.address == row.address } + row).sortedByDescending { it.possibleLs7076 }) }
                }
                override fun onScanFailed(errorCode: Int) { main.post { error("Busca BLE falhou (código $errorCode)") } }
            }
            scanCallback = callback
            scanner.startScan(callback)
            main.postDelayed({ stopScan(); if (state.scanState == "Buscando dispositivos próximos") state = state.copy(scanState = "Busca concluída") }, 15_000)
        } catch (e: SecurityException) { error("Permissão de busca Bluetooth negada") }
        catch (e: RuntimeException) { error("Falha ao iniciar busca BLE: ${e.message ?: "erro do sistema"}") }
    }

    fun stopScan() {
        val callback = scanCallback ?: return
        try { adapter?.bluetoothLeScanner?.stopScan(callback) } catch (_: SecurityException) { error("Permissão Bluetooth revogada") }
        scanCallback = null
    }

    fun connect(device: BluetoothDevice) {
        stopScan(); closeGatt()
        val label = try { device.name ?: "Dispositivo selecionado" } catch (_: SecurityException) { "Dispositivo selecionado" }
        state = state.copy(deviceName = label, connectionState = "Conectando", services = emptyList(), characteristics = emptyList(), lastRead = "", lastError = "")
        try {
            gatt = if (Build.VERSION.SDK_INT >= 23) device.connectGatt(appContext, false, callback, BluetoothDevice.TRANSPORT_LE)
            else device.connectGatt(appContext, false, callback)
            if (gatt == null) error("Android não iniciou a conexão GATT")
            BleDiagnosticLog.record(appContext, "connection_requested", mapOf("deviceName" to label))
        } catch (e: SecurityException) { error("Permissão para conectar Bluetooth negada") }
        catch (e: RuntimeException) { error("Falha ao conectar: ${e.message ?: "erro do sistema"}") }
    }

    fun disconnect() {
        stopScan()
        try { gatt?.disconnect() } catch (e: SecurityException) { error("Permissão para desconectar Bluetooth negada") }
        catch (e: RuntimeException) { error("Falha ao desconectar: ${e.message ?: "erro do sistema"}"); closeGatt() }
    }

    fun read(characteristicUuid: String) {
        val characteristic = charByUuid[characteristicUuid] ?: return error("Característica não está mais disponível")
        if (characteristic.properties and BluetoothGattCharacteristic.PROPERTY_READ == 0) return error("Esta característica não anuncia leitura")
        readQueue.addLast(characteristic)
        readNext()
    }

    fun close() { stopScan(); try { gatt?.disconnect() } catch (_: Exception) {}; closeGatt() }

    private fun readNext() {
        if (readInFlight) return
        val item = readQueue.removeFirstOrNull() ?: return
        val current = gatt ?: return error("Sem conexão GATT")
        try {
            readInFlight = current.readCharacteristic(item)
            if (!readInFlight) error("Android recusou iniciar leitura ${item.uuid}")
        } catch (e: SecurityException) { error("Permissão Bluetooth revogada durante leitura") }
        catch (e: RuntimeException) { error("Falha ao iniciar leitura: ${e.message ?: "erro do sistema"}") }
    }

    private val callback = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(client: BluetoothGatt, status: Int, newState: Int) {
            main.post {
                if (status != BluetoothGatt.GATT_SUCCESS) error("Falha GATT na conexão (status $status)")
                BleDiagnosticLog.record(appContext, "connection_state", mapOf("status" to status.toString(), "state" to newState.toString()))
                state = state.copy(connectionState = when (newState) {
                    BluetoothProfile.STATE_CONNECTED -> "Conectado"
                    BluetoothProfile.STATE_CONNECTING -> "Conectando"
                    BluetoothProfile.STATE_DISCONNECTING -> "Desconectando"
                    else -> "Desconectado"
                })
                if (newState == BluetoothProfile.STATE_CONNECTED && status == BluetoothGatt.GATT_SUCCESS) {
                    try { if (!client.discoverServices()) error("Android não iniciou descoberta de serviços") }
                    catch (e: SecurityException) { error("Permissão necessária para descobrir serviços GATT") }
                } else if (newState == BluetoothProfile.STATE_DISCONNECTED) closeGatt()
            }
        }
        override fun onServicesDiscovered(client: BluetoothGatt, status: Int) {
            main.post {
                if (status != BluetoothGatt.GATT_SUCCESS) return@post error("Descoberta GATT falhou (status $status)")
                val services = try { client.services.toList() } catch (e: SecurityException) { error("Permissão Bluetooth revogada"); return@post }
                charByUuid.clear()
                val rows = services.flatMap { service -> service.characteristics.map { characteristic ->
                    charByUuid[characteristic.uuid.toString()] = characteristic
                    BleCharacteristicRow(service.uuid.toString(), characteristic.uuid.toString(), propertyNames(characteristic.properties), characteristic.properties and BluetoothGattCharacteristic.PROPERTY_READ != 0)
                } }
                state = state.copy(services = services.map { it.uuid.toString() }, characteristics = rows)
                BleDiagnosticLog.record(appContext, "gatt_services_discovered", mapOf("services" to services.joinToString(",") { it.uuid.toString() }, "characteristics" to rows.joinToString(";") { "${it.serviceUuid}/${it.characteristicUuid}[${it.properties}]" }))
            }
        }
        @Suppress("DEPRECATION")
        override fun onCharacteristicRead(client: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) {
            val bytes = characteristic.value?.copyOf() ?: byteArrayOf()
            main.post { readInFlight = false; val hex = bytes.joinToString(" ") { "%02X".format(it) }; state = state.copy(lastRead = "${characteristic.uuid}: status=$status bytes=$hex"); BleDiagnosticLog.record(appContext, "characteristic_read", mapOf("uuid" to characteristic.uuid.toString(), "status" to status.toString(), "bytesHex" to hex)); if (status != BluetoothGatt.GATT_SUCCESS) error("Leitura GATT falhou (status $status)"); readNext() }
        }
        override fun onCharacteristicRead(client: BluetoothGatt, characteristic: BluetoothGattCharacteristic, value: ByteArray, status: Int) {
            val bytes = value.copyOf()
            main.post { readInFlight = false; val hex = bytes.joinToString(" ") { "%02X".format(it) }; state = state.copy(lastRead = "${characteristic.uuid}: status=$status bytes=$hex"); BleDiagnosticLog.record(appContext, "characteristic_read", mapOf("uuid" to characteristic.uuid.toString(), "status" to status.toString(), "bytesHex" to hex)); if (status != BluetoothGatt.GATT_SUCCESS) error("Leitura GATT falhou (status $status)"); readNext() }
        }
    }

    private fun closeGatt() {
        val old = gatt; gatt = null; readQueue.clear(); readInFlight = false; charByUuid.clear()
        try { old?.close() } catch (_: SecurityException) { error("Permissão Bluetooth revogada ao fechar GATT") }
    }
    private fun error(message: String) { state = state.copy(lastError = message); BleDiagnosticLog.record(appContext, "bluetooth_error", mapOf("message" to message)) }

    companion object {
        fun looksLikeLs7076(name: String): Boolean = name.contains("LS7076", true) || name.contains("S20", true)
        fun propertyNames(properties: Int): String = buildList {
            if (properties and BluetoothGattCharacteristic.PROPERTY_READ != 0) add("leitura")
            if (properties and (BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0) add("escrita")
            if (properties and (BluetoothGattCharacteristic.PROPERTY_NOTIFY or BluetoothGattCharacteristic.PROPERTY_INDICATE) != 0) add("notificações")
            if (isEmpty()) add("sem propriedades comuns")
        }.joinToString(", ")
    }
}
