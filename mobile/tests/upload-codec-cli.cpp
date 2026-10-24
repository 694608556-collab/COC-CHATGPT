#include "table-kernel.h"
#include <zlib.h>
#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <vector>

static int checks = 0;
static void require(bool ok) {
  ++checks;
  if (!ok) { std::fprintf(stderr, "Upload codec check %d failed\n", checks); std::exit(1); }
}
static std::vector<uint8_t> encoded(const std::vector<uint8_t> &plain) {
  uLongf length = compressBound(plain.size());
  std::vector<uint8_t> wire(length);
  require(compress2(wire.data(), &length, plain.data(), plain.size(), 1) == Z_OK);
  wire.resize(length); return wire;
}
int main() {
  for (size_t count : {size_t(1), size_t(262144), size_t(2 * 1024 * 1024)}) {
    std::vector<uint8_t> plain(count, 65), target(count + 1);
    auto wire = encoded(plain);
    require(coc_upload_inflate(wire.data(), wire.size(), target.data(), count) == 1);
    require(std::equal(plain.begin(), plain.end(), target.begin()));
    require(coc_upload_inflate(wire.data(), wire.size() - 1, target.data(), count) == 0);
    auto corrupt = wire; corrupt.back() ^= 1;
    require(coc_upload_inflate(corrupt.data(), corrupt.size(), target.data(), count) == 0);
    auto tail = wire; tail.push_back(0);
    require(coc_upload_inflate(tail.data(), tail.size(), target.data(), count) == 0);
    auto concat = wire; concat.insert(concat.end(), wire.begin(), wire.end());
    require(coc_upload_inflate(concat.data(), concat.size(), target.data(), count) == 0);
    require(coc_upload_inflate(wire.data(), wire.size(), target.data(), count - 1) == 0);
    require(coc_upload_inflate(wire.data(), wire.size(), target.data(), count + 1) == 0);
    require(coc_upload_inflate(nullptr, wire.size(), target.data(), count) == 0);
    require(coc_upload_inflate(wire.data(), wire.size(), nullptr, count) == 0);
  }
  std::vector<uint8_t> random(256 * 1024), target(random.size());
  uint32_t seed = 12345;
  for (auto &byte : random) { seed ^= seed << 13; seed ^= seed >> 17; seed ^= seed << 5; byte = seed; }
  auto tooLarge = encoded(random);
  require(tooLarge.size() > 256 * 1024);
  require(coc_upload_inflate(tooLarge.data(), tooLarge.size(), target.data(), target.size()) == 0);
  std::printf("{\"uploadCodecChecks\":%d,\"passed\":true}\n", checks);
}
