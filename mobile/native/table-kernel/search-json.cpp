#include "search-json.h"
#include <cstdlib>
#include <cstring>
#include <limits>
#include <string>
#include <unordered_set>
#include <vector>
#include <array>
#include <utility>
#include <cmath>
#include <memory>

namespace {
struct Unavailable {};
enum class Context { record_body, other, raw_content, messages, message, images, image };
constexpr uint64_t ascii_hash(const char *text) {
  uint64_t hash=1469598103934665603ULL;
  while(*text){hash^=static_cast<unsigned char>(*text++);hash*=1099511628211ULL;}
  return hash;
}

// RFC 3629 in full, independently of JSON escape decoding. Escaped unpaired
// UTF-16 units remain valid JSON strings, matching the existing JS parser.
void utf8(const uint8_t *s, size_t n) {
  for (size_t i = 0; i < n;) {
    while(n-i>=8){uint64_t word;std::memcpy(&word,s+i,8);if(word&0x8080808080808080ULL)break;i+=8;}
    if(i==n)break;
    const unsigned a = s[i++];
    if (a < 0x80) continue;
    unsigned count, low = 0x80, high = 0xbf;
    if (a >= 0xc2 && a <= 0xdf) count = 1;
    else if (a >= 0xe0 && a <= 0xef) {
      count = 2; if (a == 0xe0) low = 0xa0; if (a == 0xed) high = 0x9f;
    } else if (a >= 0xf0 && a <= 0xf4) {
      count = 3; if (a == 0xf0) low = 0x90; if (a == 0xf4) high = 0x8f;
    } else throw Unavailable{};
    if (count > n - i || s[i] < low || s[i] > high) throw Unavailable{};
    ++i;
    while (--count) { if (s[i] < 0x80 || s[i] > 0xbf) throw Unavailable{}; ++i; }
  }
}

class Parser {
  const uint8_t *s;
  const size_t n, budget;
  size_t p = 0, copied = 0, key_memory = 0;
  const bool metadata, projection;
  const bool compact;
  const bool semantic;
  const bool body_projection;
  const bool ascii_keys;
  std::vector<uint8_t> output;
  struct Key {size_t start, bytes; bool escaped; uint64_t hash;};
  static bool space(unsigned c) { return c == 32 || c == 9 || c == 10 || c == 13; }
  static bool digit(unsigned c) { return c >= '0' && c <= '9'; }
  void skip() { while (p < n && space(s[p])) ++p; }
  unsigned take() { if (p == n) throw Unavailable{}; return s[p++]; }
  void expect(unsigned c) { skip(); if (take() != c) throw Unavailable{}; }
  static unsigned hex(unsigned c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    throw Unavailable{};
  }
  void key_unit(std::u16string *key, unsigned c) {
    if (!key) return;
    if (key->size() >= (budget - n) / 2) throw Unavailable{};
    key->push_back(char16_t(c));
  }
  void string(std::u16string *key = nullptr, bool *escaped = nullptr) {
    if (take() != '"') throw Unavailable{};
    if(!key){
      for(;;){
        while(n-p>=8){
          uint64_t word;std::memcpy(&word,s+p,8);
          const uint64_t quote=word^0x2222222222222222ULL,slash=word^0x5c5c5c5c5c5c5c5cULL;
          const uint64_t quotes=(quote-0x0101010101010101ULL)&~quote;
          const uint64_t slashes=(slash-0x0101010101010101ULL)&~slash;
          const uint64_t controls=(word-0x2020202020202020ULL)&~word;
          if((quotes|slashes|controls)&0x8080808080808080ULL)break;
          p+=8;
        }
        const unsigned c=take();if(c=='"')return;if(c<32)throw Unavailable{};
        if(c!='\\')continue;
        if(escaped)*escaped=true;
        const unsigned escape=take();
        if(escape=='u'){for(int i=0;i<4;++i)hex(take());}
        else if(escape!='"'&&escape!='\\'&&escape!='/'&&escape!='b'&&escape!='f'&&escape!='n'&&escape!='r'&&escape!='t')throw Unavailable{};
      }
    }
    for (;;) {
      unsigned c = take();
      if (c == '"') return;
      if (c < 32) throw Unavailable{};
      if (c == '\\') {
        if (escaped) *escaped = true;
        c = take();
        switch (c) {
          case '"': case '\\': case '/': break;
          case 'b': c = 8; break; case 'f': c = 12; break;
          case 'n': c = 10; break; case 'r': c = 13; break; case 't': c = 9; break;
          case 'u': c = 0; for (int i = 0; i < 4; ++i) c = c * 16 + hex(take()); break;
          default: throw Unavailable{};
        }
        key_unit(key, c);
      } else if (key && c >= 0x80) {
        unsigned count = c < 0xe0 ? 1 : c < 0xf0 ? 2 : 3;
        unsigned value = c & (count == 1 ? 0x1f : count == 2 ? 0x0f : 7);
        while (count--) value = (value << 6) | (take() & 63);
        if (value >= 0x10000) { value -= 0x10000; key_unit(key, 0xd800 + (value >> 10)); key_unit(key, 0xdc00 + (value & 1023)); }
        else key_unit(key, value);
      } else key_unit(key, c);
    }
  }
  std::u16string decoded(const Key &key) {
    const size_t saved=p;p=key.start;std::u16string result;string(&result);p=saved;return result;
  }
  bool equal(const Key &a,const Key &b) {
    if(a.hash!=b.hash)return false;
    if(!a.escaped&&!b.escaped)return a.bytes==b.bytes&&!std::memcmp(s+a.start,s+b.start,a.bytes);
    return decoded(a)==decoded(b);
  }
  uint64_t key_hash(const Key &key){
    // Ordinary schema keys recur in every message. Exact original ASCII
    // equality reuses the same hash; escaped/unknown/colliding keys still use
    // the complete original decoder and duplicate-key equality below.
    if(!key.escaped){
      switch(key.bytes){
        case 4:
          if(!std::memcmp(s+key.start+1,"id",2))return ascii_hash("id");
          break;
        case 5:
          if(!std::memcmp(s+key.start+1,"raw",3))return ascii_hash("raw");
          if(!std::memcmp(s+key.start+1,"url",3))return ascii_hash("url");
          if(!std::memcmp(s+key.start+1,"alt",3))return ascii_hash("alt");
          break;
        case 6:
          if(!std::memcmp(s+key.start+1,"text",4))return ascii_hash("text");
          if(!std::memcmp(s+key.start+1,"type",4))return ascii_hash("type");
          break;
        case 7:
          if(!std::memcmp(s+key.start+1,"order",5))return ascii_hash("order");
          if(!std::memcmp(s+key.start+1,"title",5))return ascii_hash("title");
          break;
        case 8:
          if(!std::memcmp(s+key.start+1,"images",6))return ascii_hash("images");
          break;
        case 10:
          if(!std::memcmp(s+key.start+1,"messages",8))return ascii_hash("messages");
          break;
        case 11:
          if(!std::memcmp(s+key.start+1,"timestamp",9))return ascii_hash("timestamp");
          if(!std::memcmp(s+key.start+1,"sourceUrl",9))return ascii_hash("sourceUrl");
          break;
        case 12:
          if(!std::memcmp(s+key.start+1,"isOffTopic",10))return ascii_hash("isOffTopic");
          break;
        case 13:
          if(!std::memcmp(s+key.start+1,"displayName",11))return ascii_hash("displayName");
          break;
        case 14:
          if(!std::memcmp(s+key.start+1,"responseHash",12))return ascii_hash("responseHash");
          break;
        case 15:
          if(!std::memcmp(s+key.start+1,"isDiceCommand",13))return ascii_hash("isDiceCommand");
          if(!std::memcmp(s+key.start+1,"parserVersion",13))return ascii_hash("parserVersion");
          break;
        case 17:
          if(!std::memcmp(s+key.start+1,"platformAccount",15))return ascii_hash("platformAccount");
          break;
      }
    }
    uint64_t hash=1469598103934665603ULL;bool simple=!key.escaped;
    if(simple)for(size_t i=1;i+1<key.bytes;++i){
      const unsigned byte=s[key.start+i];if(byte>=128){simple=false;break;}
      hash^=byte;hash*=1099511628211ULL;
    }
    if(!simple){hash=1469598103934665603ULL;for(char16_t unit:decoded(key)){hash^=unit;hash*=1099511628211ULL;}}
    return hash;
  }
  bool named(const Key &key,const char *ascii) {
    const size_t length=std::strlen(ascii);
    if(!key.escaped)return key.bytes==length+2&&!std::memcmp(s+key.start+1,ascii,length);
    const auto text=decoded(key);if(text.size()!=length)return false;
    for(size_t i=0;i<length;++i)if(text[i]!=static_cast<unsigned char>(ascii[i]))return false;
    return true;
  }
  int message_field(const Key &key) {
    // The already-computed hash selects one candidate, never grants identity:
    // even an actual 64-bit hash collision still needs exact decoded equality.
    switch(key.hash){
      case ascii_hash("id"):return named(key,"id")?0:-1;
      case ascii_hash("order"):return named(key,"order")?1:-1;
      case ascii_hash("timestamp"):return named(key,"timestamp")?2:-1;
      case ascii_hash("displayName"):return named(key,"displayName")?3:-1;
      case ascii_hash("platformAccount"):return named(key,"platformAccount")?4:-1;
      case ascii_hash("text"):return named(key,"text")?5:-1;
      case ascii_hash("type"):return named(key,"type")?6:-1;
      case ascii_hash("isDiceCommand"):return named(key,"isDiceCommand")?7:-1;
      case ascii_hash("isOffTopic"):return named(key,"isOffTopic")?8:-1;
      case ascii_hash("images"):return named(key,"images")?9:-1;
      default:return -1;
    }
  }
  void literal(const char *value) {
    const size_t count = std::strlen(value);
    if (count > n - p || std::memcmp(s + p, value, count)) throw Unavailable{};
    p += count;
  }
  void number() {
    if (p < n && s[p] == '-') ++p;
    if (p == n) throw Unavailable{};
    if (s[p] == '0') ++p;
    else { if (s[p] < '1' || s[p] > '9') throw Unavailable{}; do { ++p; } while (p < n && digit(s[p])); }
    if (p < n && s[p] == '.') { ++p; if (p == n || !digit(s[p])) throw Unavailable{}; do { ++p; } while (p < n && digit(s[p])); }
    if (p < n && (s[p] == 'e' || s[p] == 'E')) {
      ++p; if (p < n && (s[p] == '+' || s[p] == '-')) ++p;
      if (p == n || !digit(s[p])) throw Unavailable{};
      do { ++p; } while (p < n && digit(s[p]));
    }
  }
  void append(const uint8_t *bytes, size_t count) {
    if (count > budget - n || output.size() > budget - n - count || key_memory > budget - n - count - output.size()) throw Unavailable{};
    output.insert(output.end(), bytes, bytes + count);
  }
  void replace(size_t begin, size_t end) {
    append(s + copied, begin - copied);
    static const uint8_t null_value[] = {'n','u','l','l'};
    append(null_value, 4); copied = end;
  }
  void tuple(size_t begin,unsigned present,const std::array<std::pair<size_t,size_t>,10> &fields){
    append(s+copied,begin-copied);
    if(semantic){
      const unsigned required=(1<<0)|(1<<1)|(1<<3)|(1<<5)|(1<<6)|(1<<7)|(1<<8)|(1<<9);
      if((present&required)!=required)throw Unavailable{};
      for(size_t i:{0U,2U,3U,4U,5U,6U})if((present&(1U<<i))&&s[fields[i].first]!='"')throw Unavailable{};
      finite_number(fields[1].first,fields[1].second);
      for(size_t i:{7U,8U})if(s[fields[i].first]!='t'&&s[fields[i].first]!='f')throw Unavailable{};
      if(s[fields[9].first]!='[')throw Unavailable{};
      const uint8_t comma=',',opening='[',closing=']';static const uint8_t null_value[]={'n','u','l','l'};
      append(&opening,1);
      for(size_t i:{2U,3U,4U,5U,7U,8U}){if(i!=2)append(&comma,1);if(present&(1U<<i))append(s+fields[i].first,fields[i].second-fields[i].first);else append(null_value,4);}
      append(&comma,1);size_t at=fields[9].first+1;while(at<fields[9].second&&space(s[at]))++at;
      const char* has=s[at]==']'?"false":"true";append(reinterpret_cast<const uint8_t*>(has),std::strlen(has));append(&closing,1);copied=p;return;
    }
    const std::string head="["+std::to_string(present);append(reinterpret_cast<const uint8_t*>(head.data()),head.size());
    static const uint8_t comma[]={','},null_value[]={'n','u','l','l'},end[]={']'};
    for(size_t i=0;i<fields.size();++i){append(comma,1);if(present&(1U<<i))append(s+fields[i].first,fields[i].second-fields[i].first);else append(null_value,4);}
    append(end,1);copied=p;
  }
  void finite_number(size_t begin,size_t end){
    if(s[begin]!='-'&&!digit(s[begin]))throw Unavailable{};
    // Complete JSON number grammar was already checked. A short decimal
    // without an exponent cannot overflow a JS double; avoid libc conversion
    // and locale work for every ordinary message ordinal. Other numbers still
    // take the exact finite conversion, including all exponent/overflow cases.
    if(end-begin<=32){bool exponent=false;for(size_t i=begin;i<end;++i)if(s[i]=='e'||s[i]=='E'){exponent=true;break;}if(!exponent)return;}
    std::string token(reinterpret_cast<const char*>(s+begin),end-begin);char *tail=nullptr;
    const double number=std::strtod(token.c_str(),&tail);
    if(tail!=token.c_str()+token.size()||!std::isfinite(number))throw Unavailable{};
  }
  void object(Context context, unsigned depth) {
    const size_t object_begin=p;
    expect('{');
    std::array<std::pair<size_t,size_t>,10> fields;unsigned present=0;
    unsigned log_fields=0,image_fields=0;
    // Ordinary message objects borrow their original key spans. The spill set
    // preserves unbounded object shapes without allocating a key/node for every
    // field of every ordinary log message. Escaped aliases are still decoded.
    // Only the 64-byte index needs clearing. A nonzero slot references a Key
    // already written below; borrowed keys never need whole-array initialization.
    // Half occupancy bounds probing, while the spill set handles wider objects.
    std::array<Key,32> small;std::array<uint8_t,64> slots{};size_t small_count=0;
    std::unique_ptr<std::unordered_set<std::u16string>> spill;
    size_t owned = 0;
    skip();
    if (p < n && s[p] == '}') { ++p;if(semantic&&(context==Context::raw_content||context==Context::image))throw Unavailable{};if(compact&&context==Context::message)tuple(object_begin,present,fields);return; }
    for (;;) {
      skip(); const size_t start=p;bool escaped=false;string(nullptr,&escaped);
      Key key{start,p-start,escaped,0};
      // Swift String key sets also compare canonical Unicode equivalents.
      // Admit only ASCII keys for upload acceleration; any other key asks the
      // unchanged Swift reader to perform its complete original validation.
      if(ascii_keys){
        if(escaped){for(auto unit:decoded(key))if(unit>127)throw Unavailable{};}
        else {for(size_t at=start+1;at<p-1;++at)if(s[at]>127)throw Unavailable{};}
      }
      key.hash=key_hash(key);const size_t units=key.bytes;
      if (units > (budget - n) / 2 || key_memory > budget - n - units * 2 || budget - n - units * 2 - key_memory < 96) throw Unavailable{};
      const size_t cost = units * 2 + 96;
      if(small_count<small.size()){
        size_t slot=key.hash&(slots.size()-1);
        while(slots[slot]){
          if(equal(small[slots[slot]-1],key))throw Unavailable{};
          slot=(slot+1)&(slots.size()-1);
        }
        small[small_count]=key;slots[slot]=static_cast<uint8_t>(++small_count);
      }else{
        if(!spill){spill=std::make_unique<std::unordered_set<std::u16string>>();for(size_t i=0;i<small_count;++i)spill->insert(decoded(small[i]));}
        if(!spill->insert(decoded(key)).second)throw Unavailable{};
      }
      key_memory += cost; owned += cost;
      if (metadata && depth == 0 && (named(key,"rawContent") || named(key,"manualContent"))) throw Unavailable{};
      expect(':'); skip();
      const size_t begin = p;
      const int field=compact&&context==Context::message?message_field(key):-1;
      Context next = Context::other;
      if(context==Context::record_body&&named(key,"rawContent"))next=Context::raw_content;
      if (context == Context::raw_content && named(key,"messages")) next = Context::messages;
      if(semantic&&field==9)next=Context::images;
      if (projection && !compact && context == Context::message && named(key,"raw")) {
        value(Context::other, depth + 2); replace(begin, p);
      } else value(next, depth + 2);
      if(field>=0){fields[field]={begin,p};present|=1U<<field;}
      if(semantic&&context==Context::raw_content){
        if(named(key,"parserVersion")){finite_number(begin,p);log_fields|=1;}
        else if(named(key,"messages"))log_fields|=2;
        else if((named(key,"title")||named(key,"sourceUrl")||named(key,"responseHash"))&&s[begin]!='"')throw Unavailable{};
      }
      if(semantic&&context==Context::image){
        if(named(key,"url")){if(s[begin]!='"')throw Unavailable{};image_fields|=1;}
        else if(named(key,"alt")&&s[begin]!='"')throw Unavailable{};
      }
      skip();
      if (p < n && s[p] == '}') { ++p; break; }
      if (take() != ',') throw Unavailable{};
    }
    key_memory -= owned;
    if(semantic&&((context==Context::raw_content&&log_fields!=3)||(context==Context::image&&image_fields!=1)))throw Unavailable{};
    if(compact&&context==Context::message)tuple(object_begin,present,fields);
  }
  void array(Context context, unsigned depth) {
    expect('['); skip();
    if (p < n && s[p] == ']') { ++p; return; }
    for (;;) {
      value(context == Context::messages ? Context::message : context==Context::images?Context::image:Context::other, depth + 1);
      skip(); if (p < n && s[p] == ']') { ++p; return; }
      if (take() != ',') throw Unavailable{};
    }
  }
  void value(Context context, unsigned depth) {
    skip(); if (p == n || depth > 256 || (s[p] == '{' && depth + 1 > 256)) throw Unavailable{};
    if(compact&&context==Context::message&&s[p]!='{')throw Unavailable{};
    if(semantic&&((context==Context::record_body||context==Context::raw_content||context==Context::image)&&s[p]!='{'))throw Unavailable{};
    if(semantic&&(context==Context::messages||context==Context::images)&&s[p]!='[')throw Unavailable{};
    switch (s[p]) {
      case '{': object(context, depth); break;
      case '[': array(context, depth); break;
      case '"': string(); break;
      case 't': literal("true"); break;
      case 'f': literal("false"); break;
      case 'n': literal("null"); break;
      default: number();
    }
  }
public:
  Parser(const uint8_t *source, size_t bytes, uint64_t available, bool is_metadata, bool project,bool is_compact=false,bool is_semantic=false,bool is_body=false,bool is_ascii_keys=false)
      : s(source), n(bytes), budget(size_t(available > std::numeric_limits<size_t>::max() ? std::numeric_limits<size_t>::max() : available)), metadata(is_metadata), projection(project),compact(is_compact),semantic(is_semantic),body_projection(is_body),ascii_keys(is_ascii_keys) {
    if (!s || !n || n > budget / 3) throw Unavailable{};
  }
  std::vector<uint8_t> run() {
    utf8(s, n); skip();
    if (metadata && (p == n || s[p] != '{')) throw Unavailable{};
    value(body_projection ? Context::record_body : projection ? Context::raw_content : Context::other, 0);
    skip(); if (p != n) throw Unavailable{};
    if (projection) append(s + copied, n - copied);
    return std::move(output);
  }
};
}

extern "C" int coc_search_json_check(const uint8_t *source, size_t bytes, uint64_t available, int metadata) {
  try { Parser(source, bytes, available, metadata != 0, false).run(); return 1; }
  catch (...) { return 0; }
}
extern "C" int coc_upload_json_check(const uint8_t *source, size_t bytes, uint64_t available) {
  try { Parser(source, bytes, available, false, false, false, false, false, true).run(); return 1; }
  catch (...) { return 0; }
}
extern "C" uint8_t *coc_search_json_project(const uint8_t *source, size_t bytes, uint64_t available, size_t *length) {
  if (!length) return nullptr;
  *length = 0;
  try {
    auto value = Parser(source, bytes, available, false, true).run();
    auto result = static_cast<uint8_t *>(std::malloc(value.size()));
    if (!result) return nullptr;
    std::memcpy(result, value.data(), value.size()); *length = value.size(); return result;
  } catch (...) { return nullptr; }
}
extern "C" uint8_t *coc_search_json_compact(const uint8_t *source,size_t bytes,uint64_t available,size_t *length){
  if(!length)return nullptr;*length=0;
  try{auto value=Parser(source,bytes,available,false,true,true).run();auto result=static_cast<uint8_t*>(std::malloc(value.size()));if(!result)return nullptr;std::memcpy(result,value.data(),value.size());*length=value.size();return result;}catch(...){return nullptr;}
}
extern "C" uint8_t *coc_search_json_searchable(const uint8_t *source,size_t bytes,uint64_t available,size_t *length){
  if(!length)return nullptr;*length=0;
  try{auto value=Parser(source,bytes,available,false,true,true,true).run();auto result=static_cast<uint8_t*>(std::malloc(value.size()));if(!result)return nullptr;std::memcpy(result,value.data(),value.size());*length=value.size();return result;}catch(...){return nullptr;}
}

extern "C" uint8_t *coc_search_json_body(const uint8_t *source,size_t bytes,uint64_t available,size_t *length){
  if(!length)return nullptr;*length=0;
  try{auto value=Parser(source,bytes,available,false,true,true,true,true).run();auto result=static_cast<uint8_t*>(std::malloc(value.size()));if(!result)return nullptr;std::memcpy(result,value.data(),value.size());*length=value.size();return result;}catch(...){return nullptr;}
}
