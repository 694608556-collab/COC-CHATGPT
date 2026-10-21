package coc.logbook;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.io.*;
import java.util.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Public raw-token regression checks; no network, production database or user input. */
@RunWith(AndroidJUnit4.class)
public class FetchPerformanceTest {
    @Test public void rawTokenBoundariesAndFailuresRemainExact() throws Exception {
        for(int size:new int[]{0,1,8190,8191,8192,8193,32766,32767,32768,32769,65535}) {
            char[] padding=new char[size];Arrays.fill(padding,'x');
            String token="[\""+new String(padding)+"😀\\\"\\\\\\u4e2d\",900719925474099312345,-1.00e+20,true,null,{\"x\":[]}]";
            for(int chunk:new int[]{1,7,32768}) {
                Reader input=new StringReader("{\"body\":"+token+",\"tail\":false}") {
                    @Override public int read(char[] b,int o,int n)throws IOException{return super.read(b,o,Math.min(n,chunk));}
                };
                RawJson raw=new RawJson(input);Map<String,String> values=new LinkedHashMap<>();
                raw.object((name,value)->values.put(name,value.take()));raw.end();
                assertEquals(token,values.get("body"));assertEquals("false",values.get("tail"));
            }
        }
        for(String broken:new String[]{"[1,", "\"unterminated", "{\"x\":["}) {
            try{new RawJson(new StringReader(broken)).take();fail("Truncated token accepted");}catch(EOFException expected){}
        }
        RawJson trailing=new RawJson(new StringReader("[] true"));assertEquals("[]",trailing.take());
        try{trailing.end();fail("Trailing value accepted");}catch(IOException expected){}
        try{new RawJson(new StringReader("[1]")).copy(new Writer(){
            public void write(char[] b,int o,int n)throws IOException{throw new IOException("injected writer failure");}
            public void flush(){}public void close(){}
        });fail("Writer failure swallowed");}catch(IOException expected){assertEquals("injected writer failure",expected.getMessage());}
    }
    @Test public void rawTokenCopyIsExactAndBatched() throws Exception {
        StringBuilder value=new StringBuilder("{\"messages\":[");
        for(int i=0;i<20000;i++){if(i>0)value.append(',');value.append("{\"text\":\"public 中文😀 \\\" \\\\ end\",\"raw\":900719925474099312345}");}
        value.append("]}");String expected=value.toString();
        class Counter extends StringWriter {int calls;public void write(int c){calls++;super.write(c);}public void write(char[] c,int o,int n){calls++;super.write(c,o,n);}}
        Counter result=new Counter();long begin=System.nanoTime();
        RawJson raw=new RawJson(new StringReader(expected));raw.copy(result);raw.end();
        assertEquals(expected,result.toString());
        System.out.println("PUBLIC_ANDROID_RAW chars="+expected.length()+" writes="+result.calls+" ms="+(System.nanoTime()-begin)/1e6);
        assertTrue("Raw body transfer must use bounded blocks, not a writer call per character: "+result.calls,result.calls<expected.length()/100);
    }
}
