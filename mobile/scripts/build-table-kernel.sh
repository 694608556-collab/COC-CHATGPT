#!/usr/bin/env bash
set -euo pipefail
node scripts/check-table-kernel-vendor.mjs
# Host-side macOS native checks use the exact same sources/flags as the app.
root="$(pwd)/native/table-kernel"
output="$(pwd)/ios/build/table-kernel-host"
mkdir -p "$output"
objects=()
for source in xcs xmlparse xmlrole xmltok random_dev_urandom; do
  object="$output/$source.o"
  xcrun clang -O3 -DHAVE_EXPAT_CONFIG_H=1 -DXML_STATIC=1 -I"$root/vendor/expat" -c "$root/vendor/expat/$source.c" -o "$object"
  objects+=("$object")
done
xcrun clang++ -O3 -std=c++17 -DHAVE_EXPAT_CONFIG_H=1 -DXML_STATIC=1 -I"$root/vendor/expat" -c "$root/table-kernel.cpp" -o "$output/table-kernel.o"
objects+=("$output/table-kernel.o")
xcrun clang++ -O3 -std=c++17 -c "$root/search-json.cpp" -o "$output/search-json.o"
objects+=("$output/search-json.o")
xcrun ar rcs "$output/libcoc_table_kernel.a" "${objects[@]}"
xcrun clang++ -O3 -std=c++17 -I"$root" tests/table-kernel-cli.cpp "$output/libcoc_table_kernel.a" -lz -o "$output/coc-table-kernel-probe"
xcrun clang++ -O3 -std=c++17 -I"$root" tests/search-json-cli.cpp "$output/libcoc_table_kernel.a" -lz -o "$output/coc-search-json-probe"
