package com.s20os.app

import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView

@Composable
fun NexusEmbeddedScreen() {
    val context = LocalContext.current
    var state by remember { mutableStateOf("Iniciando o núcleo N.E.X.U.S.…") }
    var deviceToken by remember { mutableStateOf<String?>(null) }
    var webView by remember { mutableStateOf<WebView?>(null) }

    DisposableEffect(context) {
        NexusRuntime.whenReady(context) { result ->
            Handler(Looper.getMainLooper()).post {
                result.onSuccess {
                    deviceToken = it
                    state = "N.E.X.U.S. disponível"
                }.onFailure {
                    state = "N.E.X.U.S. indisponível. Reabra esta tela para tentar novamente."
                }
            }
        }
        onDispose {
            webView?.stopLoading()
            webView?.destroy()
            webView = null
        }
    }

    val token = deviceToken
    if (token == null) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator()
            Text(state, modifier = Modifier.align(Alignment.BottomCenter))
        }
    } else {
        AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = { viewContext ->
                WebView(viewContext).apply {
                    settings.javaScriptEnabled = true
                    settings.domStorageEnabled = true
                    settings.allowFileAccess = false
                    settings.allowContentAccess = false
                    settings.allowFileAccessFromFileURLs = false
                    settings.allowUniversalAccessFromFileURLs = false
                    settings.mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
                    settings.javaScriptCanOpenWindowsAutomatically = false
                    settings.setSupportMultipleWindows(false)
                    webViewClient = object : WebViewClient() {
                        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                            !isProductOrigin(request.url)
                    }
                    webView = this
                    loadUrl("http://127.0.0.1:4318/?nexusDeviceToken=${Uri.encode(token)}")
                }
            }
        )
    }
}

private fun isProductOrigin(uri: Uri): Boolean =
    uri.scheme == "http" && uri.host == "127.0.0.1" && uri.port == 4318
