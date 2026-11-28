package com.s20os.app

import android.content.Context
import android.util.Base64
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.SecureRandom
import java.util.concurrent.Executors

object NexusRuntime {
    private const val PORT = 4318
    private const val HOST = "127.0.0.1"
    private const val ASSET_ROOT = "nexus-runtime"
    private val lock = Any()
    private val setupExecutor = Executors.newSingleThreadExecutor { task -> Thread(task, "NexusRuntimeSetup") }
    private val callbacks = mutableListOf<(Result<String>) -> Unit>()
    private var initializing = false
    private var nativeThreadActive = false
    private var nodeLibraryLoaded = false
    private var bridgeLibraryLoaded = false
    @Volatile private var token: String? = null
    @Volatile private var readyToken: String? = null
    private var lastFailure: String? = null

    @JvmStatic private external fun startNodeWithArguments(arguments: Array<String>): Int

    fun initialize(context: Context) {
        synchronized(lock) {
            if (initializing || readyToken != null) return
            initializing = true
            lastFailure = null
            setupExecutor.execute { prepareAndStart(context.applicationContext) }
        }
    }

    fun whenReady(context: Context, callback: (Result<String>) -> Unit) {
        initialize(context)
        synchronized(lock) {
            val currentToken = readyToken
            if (currentToken != null) {
                callback(Result.success(currentToken))
                return
            }
            lastFailure?.let {
                callback(Result.failure(IllegalStateException(it)))
                return
            }
            callbacks += callback
        }
    }

    internal fun tokenForInstrumentation(): String =
        token ?: error("N.E.X.U.S. runtime ainda não foi iniciado")

    private fun prepareAndStart(context: Context) {
        try {
            ensureNativeLibrariesLoaded()
            val runtimeDirectory = File(context.filesDir, "nexus-runtime")
            val nativeAlreadyActive = synchronized(lock) { nativeThreadActive }
            val nodeToken = synchronized(lock) { createToken().also { token = it } }
            if (!nativeAlreadyActive) copyAssetTree(context, ASSET_ROOT, runtimeDirectory)

            val entryPoint = File(runtimeDirectory, "mobile-entry.js").absolutePath
            val canStartNativeNode = synchronized(lock) {
                if (nativeThreadActive) false else {
                    nativeThreadActive = true
                    true
                }
            }
            if (canStartNativeNode) {
                try {
                    Thread({
                        try {
                            startNodeWithArguments(arrayOf("node", entryPoint, PORT.toString(), nodeToken))
                            fail("O processo Node Mobile encerrou antes de manter o servidor ativo.")
                        } catch (_error: LinkageError) {
                            fail("Não foi possível executar a ponte nativa do núcleo local.")
                        } finally {
                            synchronized(lock) { nativeThreadActive = false }
                        }
                    }, "NexusNodeRuntime").apply { isDaemon = false }.start()
                } catch (error: Exception) {
                    synchronized(lock) { nativeThreadActive = false }
                    throw error
                }
            }

            repeat(120) {
                if (isServerReady(nodeToken)) {
                    publishReady(nodeToken)
                    return
                }
                Thread.sleep(250)
            }
            fail("O núcleo local não iniciou em 30 segundos. Tente novamente.")
        } catch (_error: Exception) {
            fail("Não foi possível preparar o armazenamento privado ou iniciar o núcleo local.")
        } catch (_error: LinkageError) {
            fail("Não foi possível preparar o armazenamento privado ou iniciar o núcleo local.")
        }
    }

    private fun ensureNativeLibrariesLoaded() {
        synchronized(lock) {
            if (!nodeLibraryLoaded) {
                System.loadLibrary("node")
                nodeLibraryLoaded = true
            }
            if (!bridgeLibraryLoaded) {
                System.loadLibrary("nexus_node")
                bridgeLibraryLoaded = true
            }
        }
    }

    private fun copyAssetTree(context: Context, assetPath: String, destination: File) {
        val children = context.assets.list(assetPath).orEmpty()
        if (children.isNotEmpty()) {
            if (destination.exists() && !destination.isDirectory) destination.delete()
            if (!destination.exists() && !destination.mkdirs()) {
                throw IllegalStateException("Não foi possível criar o diretório privado do núcleo.")
            }
            children.sorted().forEach { child ->
                require(child != "." && child != ".." && !child.contains('/')) { "Nome de ativo inválido." }
                copyAssetTree(context, "$assetPath/$child", File(destination, child))
            }
            return
        }

        val parent = destination.parentFile ?: throw IllegalStateException("Diretório de ativo inválido.")
        if (!parent.exists() && !parent.mkdirs()) throw IllegalStateException("Não foi possível criar o diretório privado do núcleo.")
        context.assets.open(assetPath).use { input -> destination.outputStream().use { output -> input.copyTo(output) } }
        destination.setReadable(true, true)
        destination.setWritable(true, true)
    }

    private fun isServerReady(deviceToken: String): Boolean = try {
        val connection = URL("http://$HOST:$PORT/api/health").openConnection() as HttpURLConnection
        connection.connectTimeout = 500
        connection.readTimeout = 500
        connection.setRequestProperty("X-Nexus-Device-Token", deviceToken)
        val ready = connection.responseCode == 200
        connection.disconnect()
        ready
    } catch (_error: Exception) {
        false
    }

    private fun createToken(): String = Base64.encodeToString(
        ByteArray(32).also(SecureRandom()::nextBytes),
        Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING
    )

    private fun publishReady(deviceToken: String) {
        val pending: List<(Result<String>) -> Unit>
        synchronized(lock) {
            readyToken = deviceToken
            initializing = false
            lastFailure = null
            pending = callbacks.toList()
            callbacks.clear()
        }
        pending.forEach { callback -> callback(Result.success(deviceToken)) }
    }

    private fun fail(message: String) {
        val pending: List<(Result<String>) -> Unit>
        synchronized(lock) {
            readyToken = null
            initializing = false
            lastFailure = message
            pending = callbacks.toList()
            callbacks.clear()
        }
        pending.forEach { callback -> callback(Result.failure(IllegalStateException(message))) }
    }
}
