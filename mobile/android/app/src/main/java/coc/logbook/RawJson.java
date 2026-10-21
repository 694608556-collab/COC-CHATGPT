package coc.logbook;

import java.io.*;
import org.json.JSONArray;

/** Raw-token transport for already strictly validated JSON. Never converts body numbers. */
final class RawJson {
    private static final Writer DISCARD=new Writer(){public void write(char[] b,int o,int n){}public void write(int c){}public void flush(){}public void close(){}};
    private final Reader input;
    private final char[] buffer=new char[32768];
    private final char[] copyBuffer=new char[8192];
    private int position,limit,pushed=-1;
    RawJson(Reader reader) { input=reader; }
    /** One cursor owns this reader. Refill in blocks, avoiding two synchronized reads per UTF-16 unit. */
    private int read() throws IOException {
        if(pushed>=0){int value=pushed;pushed=-1;return value;}
        while(position==limit){limit=input.read(buffer,0,buffer.length);position=0;if(limit<0){limit=0;return -1;}}
        return buffer[position++];
    }
    private void unread(int value) throws IOException {if(value<0||pushed>=0)throw new IOException("JSON回读状态无效。");pushed=value;}
    interface Field { void accept(String name, RawJson cursor) throws Exception; }
    interface Element { void accept(RawJson cursor) throws Exception; }
    private int next() throws IOException { int c; do{c=read();}while(c>=0 && Character.isWhitespace(c)); return c; }
    private void expect(int expected) throws IOException { if(next()!=expected)throw new IOException("JSON结构不完整。"); }
    void object(Field visitor) throws Exception {
        expect('{'); int c=next(); if(c=='}')return; if(c<0)throw new EOFException();unread(c);
        while(true){String raw=take();String name=new JSONArray("["+raw+"]").getString(0);expect(':');visitor.accept(name,this);c=next();if(c=='}')return;if(c!=',')throw new IOException("JSON字段分隔无效。");}
    }
    void array(Element visitor) throws Exception {
        expect('[');int c=next();if(c==']')return;if(c<0)throw new EOFException();unread(c);
        while(true){visitor.accept(this);c=next();if(c==']')return;if(c!=',')throw new IOException("JSON数组分隔无效。");}
    }
    String take() throws Exception {StringWriter out=new StringWriter();copy(out);return out.toString();}
    void skip() throws Exception {copy(DISCARD);}
    void copy(Writer out) throws Exception {
        int c=next();if(c<0)throw new EOFException(); boolean string=false,escape=false; int depth=0;
        boolean scalar=c!='{' && c!='[' && c!='"';
        // Bounded raw-token blocks preserve every code unit, including escapes and large number spellings.
        char[] block=copyBuffer;int used=0;
        while(true){
            if(scalar && (c==',' || c=='}' || c==']' || Character.isWhitespace(c))){unread(c);if(used>0)out.write(block,0,used);return;}
            block[used++]=(char)c;if(used==block.length){out.write(block,0,used);used=0;}
            boolean done=false;
            if(string){if(escape)escape=false;else if(c=='\\')escape=true;else if(c=='"'){string=false;if(depth==0)done=true;}}
            else if(c=='"')string=true;
            else if(c=='{' || c=='[')depth++;
            else if(c=='}' || c==']'){if(--depth==0)done=true;}
            if(done){if(used>0)out.write(block,0,used);return;}
            c=read();if(c<0){if(scalar){if(used>0)out.write(block,0,used);return;}throw new EOFException();}
        }
    }
    void end() throws IOException {if(next()!=-1)throw new IOException("JSON包含多余内容。");}
}
