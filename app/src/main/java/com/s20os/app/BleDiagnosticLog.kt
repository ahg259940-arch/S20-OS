package com.s20os.app

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** App-private, authenticated-encryption log for BLE investigation data. */
object BleDiagnosticLog {
    private const val KEY_ALIAS = "s20_ble_diagnostics_v1"
    private const val FILE_NAME = "ble-diagnostics.enc"

    @Synchronized fun record(context: Context, event: String, details: Map<String, String> = emptyMap()) {
        try {
            val key = getOrCreateKey()
            val payload = JSONObject().put("timestamp", System.currentTimeMillis()).put("event", event)
            details.forEach { (name, value) -> payload.put(name, value.take(2048)) }
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, key)
            val encrypted = cipher.doFinal(payload.toString().toByteArray(Charsets.UTF_8))
            val row = Base64.encodeToString(cipher.iv, Base64.NO_WRAP) + "." + Base64.encodeToString(encrypted, Base64.NO_WRAP) + "\n"
            File(context.filesDir, FILE_NAME).appendText(row, Charsets.UTF_8)
        } catch (_: Exception) {
            // Diagnostic logging must never interrupt Bluetooth operations.
        }
    }

    private fun getOrCreateKey(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true).build())
        return generator.generateKey()
    }
}
