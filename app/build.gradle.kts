import java.io.File
import java.net.URI
import java.security.MessageDigest
import java.util.zip.ZipFile
import org.gradle.api.tasks.Sync

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

val nodeMobileVersion = "24.22.1-0"
val nodeMobileName = "nodejs-mobile-android-$nodeMobileVersion.zip"
// SHA-256 published for the pinned Node Mobile release asset.
val nodeMobileSha256 = "d6fd9f610fe5d81fede8f0d400c5a62723247725a19831835f15abf4f0604250"
val nodeMobileDirectory = layout.buildDirectory.dir("nodejs-mobile/$nodeMobileVersion")
val generatedNexusAssets = layout.buildDirectory.dir("generated/nexusRuntimeAssets")
val generatedJniLibraries = nodeMobileDirectory.map { it.dir("bin") }

fun downloadPinnedArtifact(url: String, destination: File) {
    destination.parentFile.mkdirs()
    URI(url).toURL().openConnection().apply {
        connectTimeout = 30_000
        readTimeout = 180_000
    }.getInputStream().use { input -> destination.outputStream().use { output -> input.copyTo(output) } }
}

val prepareNodeMobileRuntime = tasks.register("prepareNodeMobileRuntime") {
    val outputDirectory = nodeMobileDirectory.get().asFile
    outputs.dir(outputDirectory)
    doLast {
        val releaseRoot = "https://github.com/fogtape/nodejs-mobile/releases/download/v$nodeMobileVersion"
        val archive = outputDirectory.resolve(nodeMobileName)
        downloadPinnedArtifact("$releaseRoot/$nodeMobileName", archive)
        val actualDigest = MessageDigest.getInstance("SHA-256").digest(archive.readBytes())
            .joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) }
        check(actualDigest.equals(nodeMobileSha256, ignoreCase = true)) {
            "Checksum inválido para $nodeMobileName"
        }

        val binDirectory = outputDirectory.resolve("bin")
        val includeDirectory = outputDirectory.resolve("include")
        binDirectory.deleteRecursively()
        includeDirectory.deleteRecursively()
        val requiredAbis = setOf("arm64-v8a", "armeabi-v7a", "x86_64")
        val foundAbis = mutableSetOf<String>()
        ZipFile(archive).use { zip ->
            val entries = zip.entries().asSequence().toList()
            val headerEntry = entries.firstOrNull { it.name.endsWith("include/node/node.h") }
                ?: error("O pacote Node Mobile não inclui include/node/node.h")
            val includePrefix = headerEntry.name.removeSuffix("node/node.h")

            entries.filterNot { it.isDirectory }.forEach { entry ->
                val abiMatch = Regex("(?:^|/)bin/(arm64-v8a|armeabi-v7a|x86_64)/libnode\\.so$").find(entry.name)
                if (abiMatch != null) {
                    val abi = abiMatch.groupValues[1]
                    val destination = binDirectory.resolve("$abi/libnode.so")
                    destination.parentFile.mkdirs()
                    zip.getInputStream(entry).use { input -> destination.outputStream().use { output -> input.copyTo(output) } }
                    foundAbis += abi
                }
            }
            entries.filter { !it.isDirectory && it.name.startsWith(includePrefix) }.forEach { entry ->
                val relative = entry.name.removePrefix(includePrefix)
                check(!relative.startsWith("/") && relative.split('/').none { it == ".." }) {
                    "Caminho inseguro no pacote Node Mobile"
                }
                val destination = includeDirectory.resolve(relative)
                destination.parentFile.mkdirs()
                zip.getInputStream(entry).use { input -> destination.outputStream().use { output -> input.copyTo(output) } }
            }
        }
        check(foundAbis == requiredAbis) { "ABIs Node Mobile esperadas $requiredAbis; encontradas $foundAbis" }
        check(includeDirectory.resolve("node/node.h").isFile) { "Cabeçalhos Node Mobile incompletos" }
    }
}

val syncNexusRuntime = tasks.register<Sync>("syncNexusRuntime") {
    into(generatedNexusAssets.map { it.dir("nexus-runtime") })
    from(rootProject.layout.projectDirectory.dir("nexus-runtime-source"))
    exclude("README.md")
}

android {
    namespace = "com.s20os.app"
    compileSdk = 35
    ndkVersion = "28.2.13676358"
    defaultConfig {
        applicationId = "com.s20os.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        ndk { abiFilters += setOf("arm64-v8a", "armeabi-v7a", "x86_64") }
        externalNativeBuild {
            cmake {
                arguments += "-DNEXUS_NODE_MOBILE_ROOT=${nodeMobileDirectory.get().asFile.absolutePath}"
                arguments += "-DANDROID_STL=c++_shared"
                cppFlags += listOf("-std=c++20", "-fexceptions")
            }
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures { compose = true }
    sourceSets {
        getByName("main") {
            assets.srcDir(generatedNexusAssets)
            jniLibs.srcDir(generatedJniLibraries)
        }
    }
    externalNativeBuild {
        cmake { path = file("src/main/cpp/CMakeLists.txt"); version = "3.22.1" }
    }
}

tasks.named("preBuild") {
    dependsOn(prepareNodeMobileRuntime, syncNexusRuntime)
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    implementation(platform("androidx.compose:compose-bom:2025.02.00"))
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.navigation:navigation-compose:2.8.9")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    debugImplementation("androidx.compose.ui:ui-tooling")
    androidTestImplementation("androidx.test:core:1.6.1")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
}
