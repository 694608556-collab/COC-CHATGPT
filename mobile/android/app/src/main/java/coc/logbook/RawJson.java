package coc.logbook;

import java.io.*;
import org.json.JSONArray;

/** Raw-token transport for already strictly validated JSON. Never converts body numbers. */
final class RawJson {
    private static final Writer DISCARD=new Writer(){public void write(char[] b,int o,int n){}public void write(int c){}public void flush(){}public void close(){}};
    private final PushbackReader input;
    RawJson(Reader reader) { input=new PushbackReader(new BufferedReader(reader,32768),1); }
    interface Field { void accept(String name, RawJson cursor) throws Exception; }
    interface Element { void accept(RawJson cursor) throws Exception; }
    private int next() throws IOException { int c; do{c=input.read();}while(c>=0 && Character.isWhitespace(c)); return c; }
    private void expect(int expected) throws IOException { if(next()!=expected)throw new IOException("JSON结构不完整。"); }
    void object(Field visitor) throws Exception {
        expect('{'); int c=next(); if(c=='}')return; if(c<0)throw new EOFException();input.unread(c);
        while(true){String raw=take();String name=new JSONArray("["+raw+"]").getString(0);expect(':');visitor.accept(name,this);c=next();if(c=='}')return;if(c!=',')throw new IOException("JSON字段分隔无效。");}
    }
    void array(Element visitor) throws Exception {
        expect('[');int c=next();if(c==']')return;if(c<0)throw new EOFException();input.unread(c);
        while(true){visitor.accept(this);c=next();if(c==']')return;if(c!=',')throw new IOException("JSON数组分隔无效。");}
    }
    String take() throws Exception {StringWriter out=new StringWriter();copy(out);return out.toString();}
    void skip() throws Exception {copy(DISCARD);}
    void copy(Writer out) throws Exception {
        int c=next();if(c<0)throw new EOFException(); boolean string=false,escape=false; int depth=0;
        boolean scalar=c!='{' && c!='[' && c!='"';
        while(true){
            if(scalar && (c==',' || c=='}' || c==']' || Character.isWhitespace(c))){input.unread(c);return;}
            out.write(c);
            if(string){if(escape)escape=false;else if(c=='\\')escape=true;else if(c=='"'){string=false;if(depth==0)return;}}
            else if(c=='"')string=true;
            else if(c=='{' || c=='[')depth++;
            else if(c=='}' || c==']'){if(--depth==0)return;}
            c=input.read();if(c<0){if(scalar)return;throw new EOFException();}
        }
    }
    void end() throws IOException {if(next()!=-1)throw new IOException("JSON包含多余内容。");}
}
