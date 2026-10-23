#include "table-kernel.h"
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <iterator>
#include <vector>

// Test runner supplies fictional corpus files only. No app or device authority.
int main(int argc, char **argv) {
  if (argc != 2 && !(argc == 3 && !std::strcmp(argv[2], "records")))
    return 2;
  std::ifstream input(argv[1], std::ios::binary);
  if (!input)
    return 3;
  std::vector<uint8_t> bytes((std::istreambuf_iterator<char>(input)), {});
  if (input.bad())
    return 4;
  char *result = argc == 3
      ? coc_table_kernel_records(bytes.data(), bytes.size(), 1024ULL * 1024 * 1024)
      : coc_table_kernel_preview(bytes.data(), bytes.size(), 1024ULL * 1024 * 1024);
  if (!result)
    return 5;
  std::fputs(result, stdout);
  std::free(result);
  return 0;
}
