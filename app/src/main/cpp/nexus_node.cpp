#include <jni.h>
#include <node.h>

#include <string>
#include <vector>

extern "C" JNIEXPORT jint JNICALL
Java_com_s20os_app_NexusRuntime_startNodeWithArguments(
    JNIEnv* env, jclass, jobjectArray arguments) {
    const jsize count = env->GetArrayLength(arguments);
    std::vector<std::string> storage;
    std::vector<char*> argv;
    storage.reserve(static_cast<size_t>(count));
    argv.reserve(static_cast<size_t>(count));

    for (jsize index = 0; index < count; ++index) {
        auto value = static_cast<jstring>(env->GetObjectArrayElement(arguments, index));
        if (value == nullptr) return 2;
        const char* chars = env->GetStringUTFChars(value, nullptr);
        if (chars == nullptr) return 2;
        storage.emplace_back(chars);
        env->ReleaseStringUTFChars(value, chars);
        env->DeleteLocalRef(value);
    }

    for (auto& value : storage) argv.push_back(value.data());
    return static_cast<jint>(node::Start(count, argv.data()));
}
