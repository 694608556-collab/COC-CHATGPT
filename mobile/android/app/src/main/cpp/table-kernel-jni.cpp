#include "../../../../../native/table-kernel/table-kernel.h"
#include <cstdlib>
#include <cstring>
#include <jni.h>
extern "C" JNIEXPORT void JNICALL
Java_coc_logbook_NativeTableKernel_warm(JNIEnv *, jclass) {
  coc_table_kernel_warm();
}

extern "C" JNIEXPORT jbyteArray JNICALL
Java_coc_logbook_NativeTableKernel_preview(JNIEnv *env, jclass,
                                           jbyteArray input, jlong available) {
  if (!input || available < 1)
    return nullptr;
  const auto count = env->GetArrayLength(input);
  if (count < 1 || count > 2 * 1024 * 1024)
    return nullptr;
  auto source = env->GetByteArrayElements(input, nullptr);
  if (!source)
    return nullptr;
  char *result =
      coc_table_kernel_preview(reinterpret_cast<const uint8_t *>(source),
                               size_t(count), uint64_t(available));
  env->ReleaseByteArrayElements(input, source, JNI_ABORT);
  if (!result)
    return nullptr;
  auto bytes = env->NewByteArray(jsize(std::strlen(result)));
  if (bytes)
    env->SetByteArrayRegion(bytes, 0, jsize(std::strlen(result)),
                            reinterpret_cast<const jbyte *>(result));
  std::free(result);
  return bytes;
}
extern "C" JNIEXPORT jbyteArray JNICALL
Java_coc_logbook_NativeTableKernel_records(JNIEnv *env, jclass,
                                           jbyteArray input, jlong available) {
  if (!input || available < 1) return nullptr;
  const auto count = env->GetArrayLength(input);
  if (count < 1 || count > 2 * 1024 * 1024) return nullptr;
  auto source = env->GetByteArrayElements(input, nullptr);
  if (!source) return nullptr;
  char *result = coc_table_kernel_records(
      reinterpret_cast<const uint8_t *>(source), size_t(count), uint64_t(available));
  env->ReleaseByteArrayElements(input, source, JNI_ABORT);
  if (!result) return nullptr;
  auto bytes = env->NewByteArray(jsize(std::strlen(result)));
  if (bytes) env->SetByteArrayRegion(bytes, 0, jsize(std::strlen(result)),
                                      reinterpret_cast<const jbyte *>(result));
  std::free(result);
  return bytes;
}
