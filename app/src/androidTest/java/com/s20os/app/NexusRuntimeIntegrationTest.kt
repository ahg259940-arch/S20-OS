package com.s20os.app

import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.net.HttpURLConnection
import java.net.URL
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NexusRuntimeIntegrationTest {
    @Test
    fun embeddedCoreStartsBehindPerInstallTokenAndServesItsInterface() {
        ActivityScenario.launch(MainActivity::class.java).use {
            val token = awaitRuntime()
            assertTrue("Device token should be generated per installation", token.length >= 40)

            val denied = request("/api/health")
            assertEquals(401, denied.first)

            val (status, body) = request("/api/health", token)
            assertEquals(200, status)
            assertEquals("N.E.X.U.S.", JSONObject(body).getString("identity"))
            assertEquals("not_invoked", JSONObject(body).getString("provider"))

            val (pageStatus, page) = request("/")
            assertEquals(200, pageStatus)
            assertTrue(page.contains("N.E.X.U.S."))
        }
    }

    private fun awaitRuntime(): String {
        val deadline = System.currentTimeMillis() + 35_000
        while (System.currentTimeMillis() < deadline) {
            try {
                val token = NexusRuntime.tokenForInstrumentation()
                if (request("/api/health", token).first == 200) return token
            } catch (_error: Exception) {
                Thread.sleep(250)
            }
        }
        throw AssertionError("Embedded N.E.X.U.S. runtime did not start")
    }

    private fun request(path: String, token: String? = null): Pair<Int, String> {
        val connection = URL("http://127.0.0.1:4318$path").openConnection() as HttpURLConnection
        connection.connectTimeout = 5_000
        connection.readTimeout = 10_000
        if (token != null) connection.setRequestProperty("X-Nexus-Device-Token", token)
        val status = connection.responseCode
        val stream = if (status >= 400) connection.errorStream else connection.inputStream
        val body = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
        connection.disconnect()
        return status to body
    }
}
