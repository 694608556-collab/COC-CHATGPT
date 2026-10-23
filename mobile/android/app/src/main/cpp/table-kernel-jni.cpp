#include "../../../../../native/table-kernel/table-kernel.h"
#include "../../../../../native/table-kernel/search-json.h"
#include <cstdlib>
#include <cstring>
#include <jni.h>
#include <limits>
#include <fcntl.h>
#include <sys/syscall.h>
#include <unistd.h>
#include <cerrno>

// Derived search data only. Kernel seals make even another writable descriptor
// unable to modify or resize the complete bytes. Unsupported kernels request
// the existing complete disk path; no input-size quota is introduced.
extern "C" JNIEXPORT jint JNICALL
Java_coc_logbook_NativeSearchKernel_sealedFile(JNIEnv *env,jclass,jbyteArray input,jlong available){
  if(!input||available<1)return -1;
  const jsize count=env->GetArrayLength(input);
  if(count<1||uint64_t(count)>uint64_t(available))return -1;
  const int fd=int(syscall(__NR_memfd_create,"coc-readonly-search",3U));
  if(fd<0)return -1;
  auto bytes=env->GetByteArrayElements(input,nullptr);
  if(!bytes){close(fd);return -1;}
  size_t done=0;bool valid=true;
  while(done<size_t(count)){
    const ssize_t wrote=write(fd,reinterpret_cast<const uint8_t*>(bytes)+done,size_t(count)-done);
    if(wrote<0&&errno==EINTR)continue;
    if(wrote<=0){valid=false;break;}done+=size_t(wrote);
  }
  env->ReleaseByteArrayElements(input,bytes,JNI_ABORT);
  // F_ADD_SEALS / SEAL_SEAL | SHRINK | GROW | WRITE, stable Linux ABI values.
  if(!valid||fcntl(fd,1033,15)<0||fcntl(fd,1034)!=15||lseek(fd,0,SEEK_SET)<0){close(fd);return -1;}
  return fd;
}

extern "C" JNIEXPORT jboolean JNICALL
Java_coc_logbook_NativeSearchKernel_check(JNIEnv *env, jclass, jbyteArray input,
                                         jlong available, jboolean metadata) {
  if (!input || available < 1) return JNI_FALSE;
  const auto count = env->GetArrayLength(input);
  if (count < 1) return JNI_FALSE;
  auto source = env->GetByteArrayElements(input, nullptr);
  if (!source) return JNI_FALSE;
  const auto valid = coc_search_json_check(reinterpret_cast<const uint8_t *>(source),
      size_t(count), uint64_t(available), metadata == JNI_TRUE);
  env->ReleaseByteArrayElements(input, source, JNI_ABORT);
  return valid ? JNI_TRUE : JNI_FALSE;
}
static jbyteArray search_projection(JNIEnv *env,jbyteArray input,jlong available,int version) {
  if (!input || available < 1) return nullptr;
  const auto count = env->GetArrayLength(input);
  if (count < 1) return nullptr;
  auto source = env->GetByteArrayElements(input, nullptr);
  if (!source) return nullptr;
  size_t length = 0;
  auto operation=version==3?coc_search_json_searchable:version==2?coc_search_json_compact:coc_search_json_project;
  auto result = operation(reinterpret_cast<const uint8_t *>(source),
      size_t(count), uint64_t(available), &length);
  env->ReleaseByteArrayElements(input, source, JNI_ABORT);
  if (!result) return nullptr;
  if (length > size_t(std::numeric_limits<jsize>::max())) { std::free(result); return nullptr; }
  auto bytes = env->NewByteArray(jsize(length));
  if (bytes) env->SetByteArrayRegion(bytes, 0, jsize(length), reinterpret_cast<const jbyte *>(result));
  std::free(result); return bytes;
}
extern "C" JNIEXPORT jbyteArray JNICALL
Java_coc_logbook_NativeSearchKernel_project(JNIEnv *env,jclass,jbyteArray input,jlong available){return search_projection(env,input,available,1);}
extern "C" JNIEXPORT jbyteArray JNICALL
Java_coc_logbook_NativeSearchKernel_compact(JNIEnv *env,jclass,jbyteArray input,jlong available){return search_projection(env,input,available,2);}
extern "C" JNIEXPORT jbyteArray JNICALL
Java_coc_logbook_NativeSearchKernel_searchable(JNIEnv *env,jclass,jbyteArray input,jlong available){return search_projection(env,input,available,3);}
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
