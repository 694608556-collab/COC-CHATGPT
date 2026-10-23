#include "search-json.h"
#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>
#include <fstream>

static int cases=0;
static void require(bool passed){++cases;if(!passed){std::fprintf(stderr,"Public search JSON case %d failed\n",cases);std::exit(1);}}
static bool check(const std::string &text,bool metadata=false,uint64_t budget=64*1024*1024){return coc_search_json_check(reinterpret_cast<const uint8_t*>(text.data()),text.size(),budget,metadata)!=0;}
static bool project(const std::string &text,std::string *output=nullptr,uint64_t budget=64*1024*1024){size_t n=0;auto p=coc_search_json_project(reinterpret_cast<const uint8_t*>(text.data()),text.size(),budget,&n);if(!p)return false;if(output)output->assign(reinterpret_cast<char*>(p),n);std::free(p);return true;}
static bool searchable(const std::string &text,std::string *output=nullptr,uint64_t budget=64*1024*1024){size_t n=0;auto p=coc_search_json_searchable(reinterpret_cast<const uint8_t*>(text.data()),text.size(),budget,&n);if(!p)return false;if(output)output->assign(reinterpret_cast<char*>(p),n);std::free(p);return true;}
int main(int argc,char **argv){
  // Public JSONL only: the host compares every result with the real backup
  // schema and independently constructs the seven searchable tuple fields.
  if(argc==3&&std::string(argv[1])=="--corpus"){
    std::ifstream input(argv[2]);if(!input)return 3;
    std::string line,result;while(std::getline(input,line)){
      if(searchable(line,&result))std::printf("%s\n",result.c_str());else std::puts("null");
    }
    return input.bad()?4:0;
  }
  if(argc!=1)return 5;
  for(const auto &text:std::vector<std::string>{"null","true","false","0","-1.25e+30","1e999","900719925474099312345","\"\\ud800\"","{\"\\ud800\":true}","[[],{},null,{\"x\":1},{\"x\":2}]"})require(check(text)&&project(text));
  for(const auto &text:std::vector<std::string>{"","{","[] true","{\"x\":1,}","[true,]","{\"x\":01}","{\"x\":NaN}","{\"x\":+1}","{\"x\":1e}","{\"x\":false true}","{\"x\":\"\\x41\"}","{\"x\":\"\\u00xz\"}","{\"x\":\"raw\nline\"}","{\"x\":1,\"\\u0078\":2}","{\"😀\":1,\"\\ud83d\\ude00\":2}","{\"__proto__\":1,\"__proto__\":2}"})require(!check(text)&&!project(text));
  for(const auto &bad:std::vector<std::string>{std::string("\xc0\xaf",2),std::string("\xed\xa0\x80",3),std::string("\xf4\x90\x80\x80",4),std::string("\"\xe4\"",3)})require(!check(bad)&&!project(bad));
  const std::string original="{\"messages\":[{\"text\":\"完整😀END\",\"raw\":{\"n\":9007199254740993,\"tail\":\"END\"}}],\"outside\":{\"raw\":\"keep\"}}";
  const std::string saved=original;std::string result;
  require(project(original,&result)&&result=="{\"messages\":[{\"text\":\"完整😀END\",\"raw\":null}],\"outside\":{\"raw\":\"keep\"}}");
  require(original==saved);
  require(!project("{\"messages\":[{\"raw\":{\"tail\":1,\"\\u0074ail\":2}}]}"));
  require(!project(original,nullptr,original.size()));
  std::string wide="{";for(int i=0;i<80;++i)wide+=(i?",":"")+std::string("\"k")+std::to_string(i)+"\":1";
  require(check(wide+"}"));require(!check(wide+",\"\\u006b79\":2}"));
  for(const auto &text:std::vector<std::string>{"{}","{\"id\":\"public\"}"})require(check(text,true));
  for(const auto &text:std::vector<std::string>{"[]","{\"rawContent\":null}","{\"manualContent\":\"full\"}","{\"\\u0072awContent\":{}}"})require(!check(text,true));
  require(check(std::string(128,'[')+"0"+std::string(128,']')));
  require(!check(std::string(258,'[')+"0"+std::string(258,']')));
  size_t length=0;auto compact=coc_search_json_compact(reinterpret_cast<const uint8_t*>(original.data()),original.size(),64*1024*1024,&length);
  require(compact!=nullptr);require(compact&&std::string(reinterpret_cast<char*>(compact),length)=="{\"messages\":[[32,null,null,null,null,null,\"完整😀END\",null,null,null,null]],\"outside\":{\"raw\":\"keep\"}}");std::free(compact);
  for(const auto &bad:std::vector<std::string>{"{\"messages\":[[1023,1,2,3,4,5,6,7,8,9,10]]}","{\"messages\":[null]}","{\"messages\":[{\"raw\":{\"x\":1,\"\\u0078\":2}}]}"}){auto invalid=coc_search_json_compact(reinterpret_cast<const uint8_t*>(bad.data()),bad.size(),64*1024*1024,&length);require(invalid==nullptr);std::free(invalid);}
  if(cases!=49)return 2;
  const int original_cases=cases;
  const std::string message="{\"id\":\"public\",\"order\":1,\"displayName\":\"Reader\",\"text\":\"完整😀END\",\"type\":\"message\",\"isDiceCommand\":false,\"isOffTopic\":true,\"images\":[],\"raw\":{\"tail\":\"END\"}}";
  const std::string log="{\"parserVersion\":1,\"messages\":["+message+"]}";
  const std::string saved_log=log;
  require(searchable(log,&result)&&result=="{\"parserVersion\":1,\"messages\":[[null,\"Reader\",null,\"完整😀END\",false,true,false]]}");
  require(log==saved_log);
  require(!searchable(log,nullptr,log.size()));
  require(searchable("{\"parserVersion\":1,\"messages\":[]}"));
  for(const auto &bad:std::vector<std::string>{"null","[]","{}","{\"parserVersion\":1}","{\"messages\":[]}","{\"parserVersion\":1e999,\"messages\":[]}","{\"parserVersion\":1,\"messages\":{}}","{\"parserVersion\":1,\"messages\":[[]]}","{\"parserVersion\":1,\"messages\":[null]}","{\"parserVersion\":1,\"messages\":[{}]}","{\"parserVersion\":1,\"messages\":[],\"title\":null}","{\"parserVersion\":1,\"messages\":[],\"raw\":{\"tail\":1,\"\\u0074ail\":2}}"})require(!searchable(bad));
  const int semantic_cases=cases-original_cases;
  for(int offset=0;offset<32;++offset){
    const std::string prefix="\""+std::string(offset,'a');
    for(const auto &bad:std::vector<std::string>{std::string("\xc0\xaf",2),std::string("\xed\xa0\x80",3),std::string("\xf4\x90\x80\x80",4),std::string("\xe4",1)})require(!check(prefix+bad+"END\"")&&!project(prefix+bad+"END\""));
    for(int control:{0,1,31})require(!check(prefix+std::string(1,char(control))+"END\"")&&!project(prefix+std::string(1,char(control))+"END\""));
    for(const auto &escape:std::vector<std::string>{"\\\"","\\\\","\\u0000","\\ud800"})require(check(prefix+escape+"END\"")&&project(prefix+escape+"END\""));
    require(check(prefix+"完整😀END\"")&&project(prefix+"完整😀END\""));
  }
  std::printf("{\"passed\":true,\"searchJsonCases\":%d,\"searchableCases\":%d,\"searchScanCases\":%d}\n",original_cases,semantic_cases,cases-original_cases-semantic_cases);
}
