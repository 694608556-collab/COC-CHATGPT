#pragma once
// Strict classic ZIP envelope, complete CRC and DEFLATE proofs. Unsupported
// formats or resident-cache overflow use the complete streaming compatibility
// path; these cache budgets never reject user content as a product quota.
#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <expat.h>
#include <fstream>
#include <iterator>
#include <map>
#include <set>
#include <stdexcept>
#include <string>
#include <vector>
#include <zlib.h>
using Bytes = std::vector<unsigned char>;
static void check(bool ok, const char *error) {
  if (!ok)
    throw std::runtime_error(error);
}
static unsigned short u16(const Bytes &b, size_t p) {
  check(p <= b.size() && b.size() - p >= 2, "truncated header");
  return b[p] | b[p + 1] << 8;
}
static unsigned u32(const Bytes &b, size_t p) {
  check(p <= b.size() && b.size() - p >= 4, "truncated header");
  return b[p] | unsigned(b[p + 1]) << 8 | unsigned(b[p + 2]) << 16 |
         unsigned(b[p + 3]) << 24;
}
struct Entry {
  std::string name;
  unsigned offset, size, compressed, crc;
  unsigned short flags, method;
};
static void extraFields(const Bytes &input, size_t at, size_t length) {
  check(at <= input.size() && length <= input.size() - at,
        "truncated ZIP extra");
  size_t end = at + length;
  while (at < end) {
    check(end - at >= 4, "truncated ZIP extra header");
    size_t count = u16(input, at + 2);
    at += 4;
    check(count <= end - at, "truncated ZIP extra data");
    at += count;
  }
}
static std::map<std::string, Bytes> unpack(const Bytes &input,
                                           size_t available = 8 * 1024 * 1024) {
  check(input.size() >= 22, "missing ZIP directory");
  size_t eocd = input.size() - 22;
  bool found = false;
  for (;;) {
    if (u32(input, eocd) == 0x06054b50 &&
        eocd + 22 + u16(input, eocd + 20) == input.size()) {
      found = true;
      break;
    }
    if (!eocd || input.size() - eocd > 65557)
      break;
    --eocd;
  }
  check(found, "missing EOCD");
  check(!u16(input, eocd + 4) && !u16(input, eocd + 6), "multi disk ZIP");
  unsigned count = u16(input, eocd + 10), central = u32(input, eocd + 16),
           length = u32(input, eocd + 12);
  check(count && count != 65535 && central != 0xffffffff &&
            length != 0xffffffff,
        "unsupported ZIP64");
  check(u16(input, eocd + 8) == count && central <= eocd &&
            length == eocd - central,
        "invalid directory range");
  std::vector<Entry> entries;
  std::set<std::string> names;
  size_t at = central, total = 0;
  for (unsigned i = 0; i < count; i++) {
    check(u32(input, at) == 0x02014b50, "bad central entry");
    Entry e;
    e.flags = u16(input, at + 8);
    e.method = u16(input, at + 10);
    e.crc = u32(input, at + 16);
    e.compressed = u32(input, at + 20);
    e.size = u32(input, at + 24);
    e.offset = u32(input, at + 42);
    check(!(e.flags & (1 | 0x40 | 0x2000)) && (e.method == 0 || e.method == 8),
          "unsupported compressed entry");
    auto nameLength = u16(input, at + 28), extra = u16(input, at + 30),
         comment = u16(input, at + 32);
    check(at + 46 + nameLength + extra + comment <= eocd &&
              !u16(input, at + 34),
          "bad central metadata");
    e.name = std::string(reinterpret_cast<const char *>(input.data() + at + 46),
                         nameLength);
    for (unsigned char letter : e.name)
      check(letter < 128, "non-ASCII ZIP names use compatibility path");
    extraFields(input, at + 46 + nameLength, extra);
    check(!e.name.empty() && e.name[0] != '/' &&
              e.name.find('\\') == std::string::npos &&
              e.name.find('\0') == std::string::npos &&
              e.name.find(':') == std::string::npos,
          "invalid ZIP path");
    size_t part = 0;
    while (part < e.name.size()) {
      auto end = e.name.find('/', part);
      if (end == std::string::npos)
        end = e.name.size();
      auto value = e.name.substr(part, end - part);
      check(value != "." && value != "..", "invalid relative path");
      part = end + 1;
    }
    check(names.insert(e.name).second && e.offset < central &&
              e.size != 0xffffffff && e.compressed != 0xffffffff,
          "duplicate or unsupported entry");
    const size_t cache = std::min<size_t>(8 * 1024 * 1024, available);
    check(total <= cache && e.size <= cache - total,
          "resident cache or available-space budget exceeded");
    total += e.size;
    entries.push_back(e);
    at += 46 + nameLength + extra + comment;
  }
  check(at == eocd, "central directory length mismatch");
  std::sort(entries.begin(), entries.end(),
            [](const Entry &a, const Entry &b) { return a.offset < b.offset; });
  check(entries.front().offset == 0, "ZIP prefix");
  std::map<std::string, Bytes> output;
  for (size_t i = 0; i < entries.size(); i++) {
    const Entry &e = entries[i];
    size_t start = e.offset,
           boundary = i + 1 < entries.size() ? entries[i + 1].offset : central;
    check(u32(input, start) == 0x04034b50 && u16(input, start + 6) == e.flags &&
              u16(input, start + 8) == e.method,
          "local header mismatch");
    unsigned nameLength = u16(input, start + 26),
             extra = u16(input, start + 28);
    size_t payload = start + 30 + nameLength + extra;
    check(payload <= boundary && boundary <= central &&
              e.compressed <= boundary - payload,
          "invalid payload range");
    check(std::string(reinterpret_cast<const char *>(input.data() + start + 30),
                      nameLength) == e.name,
          "local name mismatch");
    extraFields(input, start + 30 + nameLength, extra);
    size_t descriptor = boundary - payload - e.compressed;
    if (!(e.flags & 8))
      check(!descriptor && u32(input, start + 14) == e.crc &&
                u32(input, start + 18) == e.compressed &&
                u32(input, start + 22) == e.size,
            "local proof mismatch");
    else {
      check(descriptor == 12 || descriptor == 16, "unsupported descriptor");
      size_t proof = payload + e.compressed;
      if (descriptor == 16) {
        check(u32(input, proof) == 0x08074b50, "bad signed descriptor");
        proof += 4;
      }
      check(u32(input, proof) == e.crc &&
                u32(input, proof + 4) == e.compressed &&
                u32(input, proof + 8) == e.size,
            "descriptor mismatch");
    }
    Bytes plain(e.size + 1);
    size_t produced = 0;
    if (e.method == 0) {
      check(e.compressed == e.size, "stored entry size mismatch");
      std::copy_n(input.data() + payload, e.size, plain.data());
      produced = e.size;
    } else {
      z_stream stream{};
      check(inflateInit2(&stream, -15) == Z_OK, "inflate init failure");
      stream.next_in = const_cast<unsigned char *>(input.data() + payload);
      stream.avail_in = e.compressed;
      stream.next_out = plain.data();
      stream.avail_out = plain.size();
      int status = inflate(&stream, Z_FINISH);
      produced = stream.total_out;
      bool valid = status == Z_STREAM_END && stream.avail_in == 0;
      inflateEnd(&stream);
      check(valid, "DEFLATE truncation, oversized output or trailing suffix");
    }
    check(produced == e.size && crc32(0, plain.data(), produced) == e.crc,
          "complete size or CRC mismatch");
    plain.resize(produced);
    check(e.name.back() != '/' || plain.empty(), "nonempty directory");
    output.emplace(e.name, std::move(plain));
  }
  return output;
}
