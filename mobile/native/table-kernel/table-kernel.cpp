// Read-only resident accelerator. The host must prove its
// private immutable input snapshot before using a supported result. Every
// unsupported spelling/resource budget falls back to the complete old reader.
#include "table-kernel.h"
#include "zip-envelope.hpp"
#include <cctype>
#include <cstdlib>
#include <exception>
#include <locale.h>
#ifdef __APPLE__
#include <xlocale.h>
#endif
#include <atomic>
#include <memory>
#include <sstream>
#include <thread>
#include <utility>

namespace {
constexpr uint64_t safe = 9007199254740991ULL;
static std::string attr(const char **attrs, const char *key) {
  for (; *attrs; attrs += 2)
    if (!std::strcmp(*attrs, key))
      return attrs[1];
  return {};
}
static bool present(const char **attrs, const char *key) {
  for (; *attrs; attrs += 2)
    if (!std::strcmp(*attrs, key))
      return true;
  return false;
}
static const char *leaf(const char *name) {
  const char *colon = std::strrchr(name, ':');
  return colon ? colon + 1 : name;
}
static uint64_t integer(const std::string &text, uint64_t maximum = safe) {
  check(!text.empty(), "missing integer");
  uint64_t result = 0;
  for (unsigned char c : text) {
    check(c >= '0' && c <= '9' && result <= (maximum - (c - '0')) / 10,
          "unsupported integer");
    result = result * 10 + c - '0';
  }
  return result;
}
struct Address {
  uint64_t row;
  int column;
};
static Address address(const std::string &value) {
  size_t at = 0;
  uint64_t col = 0;
  while (at < value.size() && value[at] >= 'A' && value[at] <= 'Z') {
    col = col * 26 + value[at++] - 'A' + 1;
    check(col <= 16384, "invalid column");
  }
  check(col && at < value.size() && value[at] >= '1' && value[at] <= '9',
        "invalid cell coordinate");
  auto row = integer(value.substr(at), safe + 1);
  check(row, "invalid cell row");
  return {row - 1, int(col - 1)};
}
static std::string encodeAddress(uint64_t row, int column) {
  std::string result;
  do {
    result.insert(result.begin(), char('A' + column % 26));
    column = column / 26 - 1;
  } while (column >= 0);
  return result + std::to_string(row + 1);
}
static void merge(const std::string &range) {
  check(!range.empty(), "missing merged range");
  auto split = range.find(':');
  address(range.substr(0, split));
  if (split != std::string::npos) {
    auto next = range.find(':', split + 1);
    auto last = range.substr(
        split + 1, next == std::string::npos ? next : next - split - 1);
    if (!last.empty())
      address(last);
  }
}
static std::string jsonQuoted(const std::string &text) {
  std::string result = "\"";
  const char *digits = "0123456789abcdef";
  for (unsigned char c : text) {
    if (c == '"' || c == '\\') {
      result += '\\';
      result += char(c);
    } else if (c < 32) {
      result += "\\u00";
      result += digits[c >> 4];
      result += digits[c & 15];
    } else
      result += char(c);
  }
  return result + '"';
}
static void utf8(std::string &output, unsigned value) {
  if (value < 128)
    output += char(value);
  else if (value < 2048) {
    output += char(0xc0 | (value >> 6));
    output += char(0x80 | (value & 63));
  } else if (value < 65536) {
    output += char(0xe0 | (value >> 12));
    output += char(0x80 | ((value >> 6) & 63));
    output += char(0x80 | (value & 63));
  } else {
    output += char(0xf0 | (value >> 18));
    output += char(0x80 | ((value >> 12) & 63));
    output += char(0x80 | ((value >> 6) & 63));
    output += char(0x80 | (value & 63));
  }
}
static std::string entities(const std::string &text) {
  std::string output;
  for (size_t at = 0; at < text.size();) {
    if (text[at] != '&') {
      output += text[at++];
      continue;
    }
    auto end = text.find(';', at + 1);
    check(end != std::string::npos, "invalid XML entity");
    auto token = text.substr(at + 1, end - at - 1);
    if (token == "amp")
      output += '&';
    else if (token == "lt")
      output += '<';
    else if (token == "gt")
      output += '>';
    else if (token == "quot")
      output += '"';
    else if (token == "apos")
      output += '\'';
    else {
      check(token.size() > 1 && token[0] == '#', "unsupported XML entity");
      bool hex = token.size() > 2 && (token[1] == 'x' || token[1] == 'X');
      unsigned value = 0;
      for (size_t i = hex ? 2 : 1; i < token.size(); i++) {
        unsigned char c = token[i];
        int digit = c >= '0' && c <= '9'          ? c - '0'
                    : hex && c >= 'a' && c <= 'f' ? c - 'a' + 10
                    : hex && c >= 'A' && c <= 'F' ? c - 'A' + 10
                                                  : -1;
        check(digit >= 0 && value <= 0x10ffff / (hex ? 16 : 10),
              "invalid XML codepoint");
        value = value * (hex ? 16 : 10) + digit;
      }
      check(value && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff),
            "invalid XML codepoint");
      utf8(output, value);
    }
    at = end + 1;
  }
  return output;
}
class Xml {
  XML_Parser parser = nullptr;
  const Bytes *input = nullptr;
  unsigned depth = 0;
  bool cdata = false;
  std::exception_ptr fault;
  template <class F> void invoke(F fn) {
    if (fault)
      return;
    try {
      fn();
    } catch (...) {
      fault = std::current_exception();
      XML_StopParser(parser, XML_FALSE);
    }
  }
  static void XMLCALL begin(void *p, const char *n, const char **a) {
    auto &x = *static_cast<Xml *>(p);
    x.invoke([&] {
      check(++x.depth <= 256, "XML depth budget");
      x.start(leaf(n), a);
    });
  }
  static void XMLCALL finish(void *p, const char *n) {
    auto &x = *static_cast<Xml *>(p);
    x.invoke([&] {
      x.end(leaf(n));
      check(x.depth > 0, "invalid XML depth");
      --x.depth;
    });
  }
  static void XMLCALL characters(void *p, const char *value, int length) {
    auto &x = *static_cast<Xml *>(p);
    x.invoke([&] {
      auto at = XML_GetCurrentByteIndex64(x.parser);
      auto count = XML_GetCurrentByteCount64(x.parser);
      std::string decoded(value, length);
      // Expat's normalized newline callback is mapped back to the exact
      // original character event. Preserve old-reader CR/CRLF, including
      // literal CDATA.
      if (at >= 0 && size_t(at) <= x.input->size() &&
          count <= x.input->size() - size_t(at)) {
        auto begin = x.input->begin() + at, end = begin + count;
        if (std::find(begin, end, '\r') != end) {
          std::string raw(begin, end);
          decoded = x.cdata ? raw : entities(raw);
        }
      }
      x.text(decoded);
    });
  }
  static void XMLCALL startCdata(void *p) {
    static_cast<Xml *>(p)->cdata = true;
  }
  static void XMLCALL endCdata(void *p) {
    static_cast<Xml *>(p)->cdata = false;
  }
  static void XMLCALL dtd(void *p, const char *, const char *, const char *,
                          int) {
    auto &x = *static_cast<Xml *>(p);
    x.invoke([] { throw std::runtime_error("DTD forbidden"); });
  }
  static int XMLCALL external(XML_Parser, const char *, const char *,
                              const char *, const char *) {
    return XML_STATUS_ERROR;
  }
  static void XMLCALL declaration(void *p, const char *, const char *encoding,
                                  int) {
    auto &x = *static_cast<Xml *>(p);
    x.invoke([&] {
      if (encoding) {
        std::string name = encoding;
        for (char &c : name)
          c = char(std::toupper(static_cast<unsigned char>(c)));
        check(name == "UTF-8" || name == "UTF8",
              "non-UTF8 uses compatibility reader");
      }
    });
  }

protected:
  virtual void start(const char *, const char **) {}
  virtual void text(const std::string &) {}
  virtual void end(const char *) {}
  void requireRawMetadataAttributes() {
    auto at = XML_GetCurrentByteIndex64(parser);
    auto count = XML_GetCurrentByteCount64(parser);
    check(at >= 0 && size_t(at) <= input->size() &&
              count <= input->size() - size_t(at),
          "missing XML event");
    char quote = 0;
    for (size_t i = at; i < size_t(at) + count; i++) {
      char c = char((*input)[i]);
      if (quote) {
        check(c != '\r' && c != '\n' && c != '\t',
              "normalized metadata uses compatibility reader");
        if (c == quote)
          quote = 0;
      } else if (c == '\'' || c == '"')
        quote = c;
    }
  }

public:
  virtual ~Xml() {
    if (parser)
      XML_ParserFree(parser);
  }
  void parse(const Bytes &bytes) {
    check(bytes.size() < INT32_MAX, "XML parser window");
    check(bytes.size() < 2 || !((bytes[0] == 255 && bytes[1] == 254) ||
                                (bytes[0] == 254 && bytes[1] == 255)),
          "UTF16 uses compatibility reader");
    input = &bytes;
    parser = XML_ParserCreate(nullptr);
    check(parser, "XML allocation failure");
    XML_SetUserData(parser, this);
    XML_SetElementHandler(parser, begin, finish);
    XML_SetCharacterDataHandler(parser, characters);
    XML_SetCdataSectionHandler(parser, startCdata, endCdata);
    XML_SetStartDoctypeDeclHandler(parser, dtd);
    XML_SetExternalEntityRefHandler(parser, external);
    XML_SetParamEntityParsing(parser, XML_PARAM_ENTITY_PARSING_NEVER);
    XML_SetXmlDeclHandler(parser, declaration);
    auto result =
        XML_Parse(parser, reinterpret_cast<const char *>(bytes.data()),
                  bytes.size(), XML_TRUE);
    if (fault)
      std::rethrow_exception(fault);
    check(result == XML_STATUS_OK && depth == 0, "invalid XML");
  }
};
static bool ends(const std::string &text, const char *suffix) {
  size_t count = std::strlen(suffix);
  return text.size() >= count &&
         text.compare(text.size() - count, count, suffix) == 0;
}
static std::string resolve(const std::string &parent,
                           const std::string &target) {
  check(target.find_first_of("\\?#%") == std::string::npos &&
            target.find('\0') == std::string::npos,
        "unsupported relationship target");
  auto colon = target.find(':');
  check(colon == std::string::npos, "unsupported relationship scheme");
  std::vector<std::string> parts;
  auto add = [&](const std::string &value) {
    if (value.empty() || value == ".")
      return;
    if (value == "..") {
      check(!parts.empty(), "relationship outside archive");
      parts.pop_back();
    } else
      parts.push_back(value);
  };
  if (target.empty() || target[0] != '/') {
    size_t at = 0, end = 0;
    while ((end = parent.find('/', at)) != std::string::npos) {
      add(parent.substr(at, end - at));
      at = end + 1;
    }
  }
  size_t at = 0;
  for (;;) {
    auto end = target.find('/', at);
    add(target.substr(at, end == std::string::npos ? end : end - at));
    if (end == std::string::npos)
      break;
    at = end + 1;
  }
  std::string result;
  for (const auto &part : parts) {
    if (!result.empty())
      result += '/';
    result += part;
  }
  return result;
}
struct Rel {
  std::string target, type;
};
class Relations : public Xml {
  std::string parent;
  void start(const char *name, const char **attrs) override {
    if (std::strcmp(name, "Relationship"))
      return;
    requireRawMetadataAttributes();
    auto id = attr(attrs, "Id"), target = attr(attrs, "Target"),
         type = attr(attrs, "Type");
    check(!id.empty() && !target.empty() && !type.empty() && !values.count(id),
          "invalid relationship");
    if (attr(attrs, "TargetMode") == "External")
      return;
    values[id] = {resolve(parent, target), type};
  }

public:
  std::map<std::string, Rel> values;
  explicit Relations(std::string parent) : parent(std::move(parent)) {}
};
struct SheetRef {
  std::string name, id;
};
class Workbook : public Xml {
  void start(const char *name, const char **attrs) override {
    if (std::strcmp(name, "sheet"))
      return;
    requireRawMetadataAttributes();
    auto sheet = attr(attrs, "name"), id = attr(attrs, "r:id");
    if (!present(attrs, "r:id"))
      for (auto a = attrs; *a; a += 2)
        if (ends(a[0], ":id")) {
          id = a[1];
          break;
        }
    check(!sheet.empty() && !id.empty(), "invalid sheet reference");
    sheets.push_back({sheet, id});
  }

public:
  std::vector<SheetRef> sheets;
};
class Strings : public Xml {
  bool active = false;
  int inside = 0, phonetic = 0;
  std::string current;
  size_t weight = 0;
  void start(const char *name, const char **) override {
    if (!std::strcmp(name, "si")) {
      check(!active, "nested shared string");
      active = true;
      current.clear();
    }
    if (!std::strcmp(name, "t"))
      inside++;
    if (!std::strcmp(name, "rPh"))
      phonetic++;
  }
  void text(const std::string &value) override {
    if (active && inside && !phonetic) {
      check(current.size() + value.size() <= 2 * 1024 * 1024,
            "shared string resident budget");
      current += value;
    }
  }
  void end(const char *name) override {
    if (!std::strcmp(name, "t"))
      inside--;
    if (!std::strcmp(name, "rPh"))
      phonetic--;
    if (!std::strcmp(name, "si")) {
      weight += current.size() * 2 + 64;
      check(weight <= 2 * 1024 * 1024, "shared string cache budget");
      values.push_back(std::move(current));
      active = false;
    }
  }

public:
  std::vector<std::string> values;
};
struct Token {
  std::string address, type, raw, inlineText, formula;
  bool hasFormula = false;
};
struct Row {
  uint64_t index;
  std::vector<Token> cells;
};
// One resident optimization budget shared by every record worksheet task.
// A miss discards the whole projection and invokes the complete old reader.
struct ProjectionBudget {
  std::atomic<size_t> bytes{0};
  void claim(size_t count) {
    constexpr size_t limit = 2 * 1024 * 1024;
    check(count <= limit, "record projection resident budget");
    auto previous = bytes.load(std::memory_order_relaxed);
    for (;;) {
      check(previous <= limit - count, "record projection resident budget");
      if (bytes.compare_exchange_weak(previous, previous + count,
                                      std::memory_order_relaxed)) break;
    }
  }
};
static bool decimal(const std::string &text) {
  size_t at = 0;
  auto space = [](char c) {
    return c == ' ' || c == '\t' || c == '\r' || c == '\n';
  };
  while (at < text.size() && space(text[at]))
    at++;
  if (at < text.size() && (text[at] == '+' || text[at] == '-'))
    at++;
  size_t digits = 0;
  while (at < text.size() && text[at] >= '0' && text[at] <= '9') {
    at++;
    digits++;
  }
  if (at < text.size() && text[at] == '.') {
    at++;
    while (at < text.size() && text[at] >= '0' && text[at] <= '9') {
      at++;
      digits++;
    }
  }
  if (!digits)
    return false;
  if (at < text.size() && (text[at] == 'e' || text[at] == 'E')) {
    at++;
    if (at < text.size() && (text[at] == '+' || text[at] == '-'))
      at++;
    size_t first = at;
    while (at < text.size() && text[at] >= '0' && text[at] <= '9')
      at++;
    if (at == first)
      return false;
  }
  while (at < text.size() && space(text[at]))
    at++;
  return at == text.size();
}
class Cells : public Xml {
  const std::vector<std::string> &strings;
  bool selected, completeRows, active = false, inValue = false, inText = false,
                 inFormula = false;
  ProjectionBudget *budget;
  int phonetic = 0, column = -1;
  int64_t row = -1;
  uint64_t rowBytes = 0;
  Token cell;
  Row *output = nullptr;
  size_t detailBytes = 0;
  void start(const char *name, const char **attrs) override {
    if (!std::strcmp(name, "mergeCell")) {
      auto range = attr(attrs, "ref");
      merge(range);
      if (completeRows) {
        budget->claim(range.size() * 2 + 64);
        mergedRanges.push_back(std::move(range));
      }
    }
    if (!std::strcmp(name, "row")) {
      auto number = attr(attrs, "r");
      if (present(attrs, "r")) {
        auto value = integer(number, safe + 1);
        check(value > 0, "invalid row");
        row = value - 1;
      } else {
        check(row < int64_t(safe), "invalid implicit row");
        row++;
      }
      column = -1;
      rowBytes = 0;
      output = nullptr;
      if (selected && (completeRows || row < 95)) {
        if (completeRows) budget->claim(sizeof(Row) + 64);
        rows.push_back({uint64_t(row), {}});
        output = &rows.back();
      }
    } else if (!std::strcmp(name, "c")) {
      check(!active && row >= 0, "cell outside row");
      auto coordinate = attr(attrs, "r");
      if (!coordinate.empty()) {
        auto parsed = address(coordinate);
        check(parsed.row == uint64_t(row) && parsed.column > column,
              "cell row or order mismatch");
        column = parsed.column;
      } else {
        check(column < 16383, "implicit wide row uses compatibility reader");
        column++;
      }
      active = true;
      cell = {};
      cell.type = attr(attrs, "t");
      check(!present(attrs, "t") || !cell.type.empty(),
            "explicit empty cell type uses compatibility reader");
      if (output)
        cell.address =
            coordinate.empty() ? encodeAddress(row, column) : coordinate;
    } else if (active && !std::strcmp(name, "v"))
      inValue = true;
    else if (active && !std::strcmp(name, "t"))
      inText = true;
    else if (active && !std::strcmp(name, "f")) {
      inFormula = true;
      cell.hasFormula = true;
    } else if (!std::strcmp(name, "rPh"))
      phonetic++;
  }
  void append(std::string &target, const std::string &value) {
    check(target.size() + value.size() <= 2 * 1024 * 1024,
          "cell transient memory budget");
    target += value;
  }
  void text(const std::string &value) override {
    if (!active)
      return;
    if (inValue)
      append(cell.raw, value);
    if (inText && !phonetic)
      append(cell.inlineText, value);
    if (inFormula && output)
      append(cell.formula, value);
  }
  void end(const char *name) override {
    if (!std::strcmp(name, "v"))
      inValue = false;
    if (!std::strcmp(name, "t"))
      inText = false;
    if (!std::strcmp(name, "f"))
      inFormula = false;
    if (!std::strcmp(name, "rPh"))
      phonetic--;
    if (!std::strcmp(name, "c")) {
      check(active, "unstarted cell");
      uint64_t valueBytes = 16;
      if (cell.type == "s" && !cell.raw.empty()) {
        auto index = integer(cell.raw);
        check(index < strings.size(), "invalid shared string reference");
        valueBytes = strings[index].size();
        if (output && !completeRows)
          usedStrings[index] = strings[index];
      } else if (cell.type == "inlineStr")
        valueBytes = cell.inlineText.size();
      else if (cell.type == "str")
        valueBytes = cell.raw.size();
      else if (cell.type.empty() || cell.type == "n") {
        if (!cell.raw.empty()) {
          check(decimal(cell.raw),
                "noncanonical numeric value uses compatibility reader");
          static locale_t numeric = newlocale(LC_NUMERIC_MASK, "C", nullptr);
          check(numeric, "numeric locale unavailable");
          char *end = nullptr;
          double value = strtod_l(cell.raw.c_str(), &end, numeric);
          check(std::isfinite(value) && end && end != cell.raw.c_str(),
                "invalid finite number");
        }
      } else
        check(cell.type == "b" || cell.type == "e" || cell.type == "s",
              "unsupported cell type");
      check(valueBytes <= safe - rowBytes, "row byte accounting overflow");
      rowBytes += valueBytes;
      // A validated numeric blank without a formula has exactly the same
      // template semantics as an absent cell (SheetJS also omits this stub).
      // Keep every value, error and formula, including missing formula caches.
      const bool numericBlank = (cell.type.empty() || cell.type == "n") &&
                                cell.raw.empty() && !cell.hasFormula;
      if (output && (completeRows || !numericBlank)) {
        if (completeRows)
          budget->claim((cell.address.size() + cell.type.size() +
                         cell.raw.size() + cell.inlineText.size() +
                         cell.formula.size()) * 2 + sizeof(Token) + 64);
        detailBytes += cell.address.size() + cell.type.size() +
                       cell.raw.size() + cell.inlineText.size() +
                       cell.formula.size() + 96;
        check(detailBytes <= 2 * 1024 * 1024, "selected-cell resident budget");
        output->cells.push_back(std::move(cell));
      }
      active = false;
      count++;
    } else if (!std::strcmp(name, "row"))
      check(!active, "unfinished cell at row end");
  }

public:
  std::vector<Row> rows;
  std::vector<std::string> mergedRanges;
  std::map<uint64_t, std::string> usedStrings;
  size_t count = 0;
  Cells(const std::vector<std::string> &strings, bool selected,
        bool completeRows = false, ProjectionBudget *budget = nullptr)
      : strings(strings), selected(selected), completeRows(completeRows),
        budget(budget) {}
};
class OtherSheet : public Xml {
  ProjectionBudget *budget;
  void start(const char *name, const char **attrs) override {
    if (!std::strcmp(name, "mergeCell")) {
      auto range = attr(attrs, "ref");
      merge(range);
      if (budget) {
        budget->claim(range.size() * 2 + 64);
        mergedRanges.push_back(std::move(range));
      }
    }
  }
public:
  std::vector<std::string> mergedRanges;
  explicit OtherSheet(ProjectionBudget *budget = nullptr) : budget(budget) {}
};
static const Bytes &part(const std::map<std::string, Bytes> &parts,
                         const std::string &name) {
  auto found = parts.find(name);
  check(found != parts.end(), "missing workbook part");
  return found->second;
}
static std::string relPath(const std::string &path) {
  auto slash = path.rfind('/');
  return slash == std::string::npos ? "_rels/" + path + ".rels"
                                    : path.substr(0, slash + 1) + "_rels/" +
                                          path.substr(slash + 1) + ".rels";
}
static std::string supportedPreview(const Bytes &source, size_t available,
                                    bool records = false) {
  check(source.size() <= 2 * 1024 * 1024, "source resident budget");
  auto parts = unpack(source, available);
  Relations root("");
  root.parse(part(parts, "_rels/.rels"));
  std::vector<Rel> offices;
  for (const auto &item : root.values)
    if (ends(item.second.type, "/officeDocument"))
      offices.push_back(item.second);
  check(offices.size() == 1, "invalid office document relationship");
  auto workbook = offices.front().target;
  Workbook book;
  book.parse(part(parts, workbook));
  check(!book.sheets.empty(), "missing worksheets");
  Relations relations(workbook);
  relations.parse(part(parts, relPath(workbook)));
  std::vector<std::string> sst;
  for (const auto &item : relations.values)
    if (ends(item.second.type, "/sharedStrings"))
      sst.push_back(item.second.target);
  check(sst.size() <= 1, "duplicate shared strings");
  Strings strings;
  if (!sst.empty())
    strings.parse(part(parts, sst.front()));
  ProjectionBudget budget;
  if (records)
    for (const auto &value : strings.values) budget.claim(value.size() * 2 + 64);
  std::set<std::string> names, targets;
  std::unique_ptr<Cells> selected;
  size_t allCells = 0;
  struct Work {
    std::string target, name;
    bool cells, selected;
  };
  std::vector<Work> work;
  for (const auto &sheet : book.sheets) {
    auto found = relations.values.find(sheet.id);
    check(found != relations.values.end(), "missing worksheet relationship");
    const auto &rel = found->second;
    check(ends(rel.type, "/worksheet") || ends(rel.type, "/chartsheet") ||
              ends(rel.type, "/dialogsheet") ||
              ends(rel.type, "/xlMacrosheet") ||
              ends(rel.type, "/xlIntlMacrosheet"),
          "unsupported worksheet relationship");
    check(names.insert(sheet.name).second && targets.insert(rel.target).second,
          "duplicate worksheet");
    part(parts, rel.target);
    if (records) budget.claim(sheet.name.size() * 2 + 128);
    work.push_back({rel.target, sheet.name, ends(rel.type, "/worksheet"),
                    records || sheet.name == "人物卡"});
  }
  // Bound concurrency, not content. Every worksheet completes validation and
  // joins before any projected draft is returned, including auxiliary errors.
  struct Result {
    std::unique_ptr<Cells> selected;
    size_t count = 0;
    std::exception_ptr failure;
  };
  std::vector<Result> results(work.size());
  std::atomic<size_t> next{0};
  auto scan = [&] {
    for (;;) {
      size_t index = next.fetch_add(1, std::memory_order_relaxed);
      if (index >= work.size())
        return;
      try {
        const auto &item = work[index];
        if (item.cells) {
          auto cells = std::make_unique<Cells>(strings.values, item.selected,
                                               records, records ? &budget : nullptr);
          cells->parse(part(parts, item.target));
          results[index].count = cells->count;
          if (item.selected)
            results[index].selected = std::move(cells);
        } else {
          OtherSheet other(records ? &budget : nullptr);
          other.parse(part(parts, item.target));
          if (item.selected) {
            results[index].selected =
                std::make_unique<Cells>(strings.values, true, records,
                                        records ? &budget : nullptr);
            results[index].selected->mergedRanges = std::move(other.mergedRanges);
          }
        }
      } catch (...) {
        results[index].failure = std::current_exception();
      }
    }
  };
  std::vector<std::thread> threads;
  struct Join {
    std::vector<std::thread> &threads;
    ~Join() {
      for (auto &thread : threads)
        if (thread.joinable())
          thread.join();
    }
  } join{threads};
  for (size_t thread = 1; thread < std::min<size_t>(4, work.size()); thread++)
    threads.emplace_back(scan);
  scan();
  for (auto &thread : threads)
    thread.join();
  for (auto &result : results) {
    if (result.failure)
      std::rethrow_exception(result.failure);
    allCells += result.count;
    if (result.selected && !records)
      selected = std::move(result.selected);
  }
  if (records) {
    std::string output =
        "{\"version\":1,\"supported\":true,\"projection\":\"records\",\"compact\":true,\"stringCount\":" +
        std::to_string(strings.values.size()) + ",\"validatedCells\":" +
        std::to_string(allCells) + ",\"strings\":{";
    for (size_t index = 0; index < strings.values.size(); index++) {
      if (index) output += ',';
      output += jsonQuoted(std::to_string(index)) + ':' + jsonQuoted(strings.values[index]);
      check(output.size() <= 2 * 1024 * 1024, "record bridge resident budget");
    }
    output += "},\"sheets\":[";
    for (size_t index = 0; index < work.size(); index++) {
      check(bool(results[index].selected), "missing complete worksheet result");
      const auto &sheet = *results[index].selected;
      if (index) output += ',';
      output += "{\"name\":" + jsonQuoted(work[index].name) + ",\"order\":" +
                std::to_string(index) + ",\"mergedRanges\":[";
      for (size_t range = 0; range < sheet.mergedRanges.size(); range++) {
        if (range) output += ',';
        output += jsonQuoted(sheet.mergedRanges[range]);
      }
      output += "],\"rows\":[";
      for (size_t rowIndex = 0; rowIndex < sheet.rows.size(); rowIndex++) {
        if (rowIndex) output += ',';
        const auto &row = sheet.rows[rowIndex];
        output += "{\"index\":" + std::to_string(row.index) + ",\"cells\":[";
        for (size_t cellIndex = 0; cellIndex < row.cells.size(); cellIndex++) {
          if (cellIndex) output += ',';
          const auto &cell = row.cells[cellIndex];
          output += '[' + jsonQuoted(cell.address) + ',' + jsonQuoted(cell.type) + ',' +
                    jsonQuoted(cell.raw) + ',' + jsonQuoted(cell.inlineText) + ',' +
                    jsonQuoted(cell.formula) + ',' +
                    (cell.hasFormula ? "true" : "false") + ']';
          check(output.size() <= 2 * 1024 * 1024, "record bridge resident budget");
        }
        output += "]}";
      }
      output += "]}";
      check(output.size() <= 2 * 1024 * 1024, "record bridge resident budget");
    }
    output += "]}";
    check(output.size() <= 2 * 1024 * 1024, "record bridge resident budget");
    return output;
  }
  check(bool(selected), "fixed character sheet absent");
  std::string output =
      "{\"version\":1,\"supported\":true,\"compact\":true,\"stringCount\":" +
      std::to_string(strings.values.size()) +
      ",\"validatedCells\":" + std::to_string(allCells) + ",\"strings\":{";
  bool comma = false;
  for (const auto &item : selected->usedStrings) {
    if (comma)
      output += ',';
    comma = true;
    output += jsonQuoted(std::to_string(item.first)) + ':' + jsonQuoted(item.second);
  }
  output += "},\"rows\":[";
  comma = false;
  for (const auto &row : selected->rows) {
    if (comma)
      output += ',';
    comma = true;
    output += "{\"index\":" + std::to_string(row.index) + ",\"cells\":[";
    bool next = false;
    for (const auto &cell : row.cells) {
      if (next)
        output += ',';
      next = true;
      output += '[' + jsonQuoted(cell.address) + ',' + jsonQuoted(cell.type) + ',' +
                jsonQuoted(cell.raw) + ',' + jsonQuoted(cell.inlineText) + ',' +
                jsonQuoted(cell.formula) + ',' +
                (cell.hasFormula ? "true" : "false") + ']';
    }
    output += "]}";
  }
  output += "]}";
  check(output.size() <= 2 * 1024 * 1024, "bridge output resident budget");
  return output;
}
} // namespace
std::string tableKernelPreview(const Bytes &source, size_t available) {
  try {
    return supportedPreview(source, available);
  } catch (...) {
    return "{\"version\":1,\"supported\":false}";
  }
}

extern "C" char *coc_table_kernel_preview(const uint8_t *source, size_t bytes,
                                          uint64_t available) {
  try {
    std::string result = "{\"version\":1,\"supported\":false}";
    if (source && bytes && bytes <= 2 * 1024 * 1024) {
      Bytes snapshot(source, source + bytes);
      result = tableKernelPreview(
          snapshot, size_t(std::min<uint64_t>(available, 8 * 1024 * 1024)));
    }
    char *output = static_cast<char *>(std::malloc(result.size() + 1));
    if (!output)
      return nullptr;
    std::memcpy(output, result.c_str(), result.size() + 1);
    return output;
  } catch (...) {
    return nullptr;
  }
}
extern "C" char *coc_table_kernel_records(const uint8_t *source, size_t bytes,
                                          uint64_t available) {
  try {
    std::string result = "{\"version\":1,\"supported\":false}";
    if (source && bytes && bytes <= 2 * 1024 * 1024) {
      try {
        Bytes snapshot(source, source + bytes);
        result = supportedPreview(snapshot,
            size_t(std::min<uint64_t>(available, 8 * 1024 * 1024)), true);
      } catch (...) {
        // No partial worksheet or candidate can escape a failed projection.
      }
    }
    char *output = static_cast<char *>(std::malloc(result.size() + 1));
    if (!output) return nullptr;
    std::memcpy(output, result.c_str(), result.size() + 1);
    return output;
  } catch (...) {
    return nullptr;
  }
}
extern "C" void coc_table_kernel_warm(void) {
  try {
    const std::string xml =
        "<worksheet><sheetData><row r=\"1\"><c "
        "r=\"A1\"><v>0</v></c></row></sheetData></worksheet>";
    const Bytes bytes(xml.begin(), xml.end());
    const std::vector<std::string> strings;
    auto initialize = [&] {
      try {
        Cells cells(strings, false);
        cells.parse(bytes);
      } catch (...) {
      }
    };
    std::vector<std::thread> threads;
    struct Join {
      std::vector<std::thread> &threads;
      ~Join() {
        for (auto &thread : threads)
          if (thread.joinable())
            thread.join();
      }
    } join{threads};
    for (int index = 0; index < 3; index++)
      threads.emplace_back(initialize);
    initialize();
  } catch (...) {
  }
}

extern "C" int coc_upload_inflate(const uint8_t *wire, size_t wire_bytes,
                                 uint8_t *output, size_t expected_bytes) {
  if (!wire || !output || !wire_bytes || wire_bytes > 256 * 1024 ||
      !expected_bytes || expected_bytes > 2 * 1024 * 1024)
    return 0;
  z_stream stream{};
  if (inflateInit(&stream) != Z_OK) return 0;
  stream.next_in = const_cast<Bytef *>(wire);
  stream.avail_in = static_cast<uInt>(wire_bytes);
  stream.next_out = output;
  stream.avail_out = static_cast<uInt>(expected_bytes);
  const int status = inflate(&stream, Z_FINISH);
  const bool complete = status == Z_STREAM_END && stream.total_in == wire_bytes &&
                        stream.total_out == expected_bytes && stream.avail_in == 0;
  inflateEnd(&stream);
  return complete ? 1 : 0;
}
