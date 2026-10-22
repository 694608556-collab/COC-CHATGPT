package coc.logbook;

import java.util.*;
import org.json.JSONArray;

/** Strict JSON grammar and decoded duplicate-key checks before org.json, whose
 * Android implementation otherwise accepts several non-JSON spellings.
 * Receives only one bounded native candidate line, never the complete library.
 */
final class StrictBackupJson {
    private final String text;
    private int offset;
    private StrictBackupJson(String text) { this.text=text; }
    static void validate(String text) throws Exception {
        StrictBackupJson input=new StrictBackupJson(text);input.value(0);input.space();
        if(input.offset!=text.length())input.fail();
    }
    private void fail(){throw new IllegalArgumentException("备份JSON不完整、含重复字段或类型拼写无效。");}
    private char peek(){return offset<text.length()?text.charAt(offset):'\0';}
    private void space(){while(offset<text.length()&&" \t\r\n".indexOf(text.charAt(offset))>=0)offset++;}
    private void expect(char c){space();if(peek()!=c)fail();offset++;}
    private String string(boolean key) throws Exception {
        int start=offset;expect('"');
        boolean ended=false;
        while(offset<text.length()){
            char c=text.charAt(offset++);
            if(c=='"'){ended=true;break;}
            if(c<32)fail();
            if(c=='\\'){
                if(offset>=text.length())fail();char escape=text.charAt(offset++);
                if(escape=='u'){
                    for(int i=0;i<4;i++){if(offset>=text.length())fail();char hex=text.charAt(offset++);if(Character.digit(hex,16)<0||hex>127)fail();}
                }else if("\"\\/bfnrt".indexOf(escape)<0)fail();
            }
        }
        if(!ended)fail();
        return key?new JSONArray("["+text.substring(start,offset)+"]").getString(0):null;
    }
    private void value(int depth) throws Exception {
        if(depth>256)fail();space();char c=peek();
        if(c=='"'){string(false);return;}
        if(c=='{'){
            offset++;space();Set<String> keys=new HashSet<>();
            if(peek()!='}')for(;;){space();String key=string(true);if(keys.size()>=100000||!keys.add(key))fail();expect(':');value(depth+1);space();if(peek()!=',')break;offset++;}
            expect('}');return;
        }
        if(c=='['){offset++;space();if(peek()!=']')for(;;){value(depth+1);space();if(peek()!=',')break;offset++;}expect(']');return;}
        int start=offset;
        while(offset<text.length()&&",]} \t\r\n".indexOf(text.charAt(offset))<0)offset++;
        String token=text.substring(start,offset);
        if(!token.matches("(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)"))fail();
    }
}
