/* Local portable configuration. Upstream C/header files remain unmodified.
 * Android and iOS supported targets are little endian, POSIX, UTF-8 builds.
 * No DTD/general entities; salted hash entropy comes from /dev/urandom. */
#ifndef EXPAT_CONFIG_H
#define EXPAT_CONFIG_H 1
#define BYTEORDER 1234
#define HAVE_DLFCN_H 1
#define HAVE_FCNTL_H 1
#define HAVE_GETPAGESIZE 1
#define HAVE_INTTYPES_H 1
#define HAVE_MEMORY_H 1
#define HAVE_STDINT_H 1
#define HAVE_STDLIB_H 1
#define HAVE_STRINGS_H 1
#define HAVE_STRING_H 1
#define HAVE_SYS_STAT_H 1
#define HAVE_SYS_TYPES_H 1
#define HAVE_UNISTD_H 1
#define PACKAGE "expat"
#define PACKAGE_NAME "expat"
#define PACKAGE_VERSION "2.9.0"
#define STDC_HEADERS 1
#define XML_CONTEXT_BYTES 1024
#define XML_DEV_URANDOM 1
#define XML_GE 0
#define XML_NS 1
#endif
