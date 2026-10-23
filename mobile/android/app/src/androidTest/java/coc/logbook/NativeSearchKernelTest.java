package coc.logbook;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.json.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Production JNI/C++ on public original bytes, with an independent JSON oracle. */
@RunWith(AndroidJUnit4.class)
public final class NativeSearchKernelTest {
    private byte[] bytes(String text){return text.getBytes(StandardCharsets.UTF_8);}
    @Test public void searchableTuplesRequireCompleteOriginalMessageAndImageSemantics()throws Exception{
        JSONObject log=new JSONObject("{\"parserVersion\":1,\"messages\":[{\"id\":\"first\",\"order\":0,\"timestamp\":\"invalid date\",\"displayName\":\"公开😀\",\"platformAccount\":\"公开账号\",\"text\":\"FULL_END\",\"type\":\"text\",\"isDiceCommand\":false,\"isOffTopic\":true,\"images\":[{\"url\":\"https://example.com/a\",\"alt\":\"完整\"}],\"raw\":{\"large\":9007199254740993}}]}");
        byte[] original=bytes(log.toString()),copy=original.clone();
        byte[] projected=NativeSearchKernel.searchable(original,1024*1024);assertNotNull(projected);assertArrayEquals(copy,original);
        JSONArray tuple=new JSONObject(new String(projected,StandardCharsets.UTF_8)).getJSONArray("messages").getJSONArray(0);
        assertEquals(7,tuple.length());assertEquals("invalid date",tuple.getString(0));assertEquals("公开😀",tuple.getString(1));assertEquals("公开账号",tuple.getString(2));assertEquals("FULL_END",tuple.getString(3));assertFalse(tuple.getBoolean(4));assertTrue(tuple.getBoolean(5));assertTrue(tuple.getBoolean(6));
        for(String field:new String[]{"id","order","displayName","text","type","isDiceCommand","isOffTopic","images"}){
            JSONObject bad=new JSONObject(log.toString());bad.getJSONArray("messages").getJSONObject(0).remove(field);assertNull(field,NativeSearchKernel.searchable(bytes(bad.toString()),1024*1024));
        }
        for(String field:new String[]{"timestamp","platformAccount"}){JSONObject bad=new JSONObject(log.toString());bad.getJSONArray("messages").getJSONObject(0).put(field,JSONObject.NULL);assertNull(field,NativeSearchKernel.searchable(bytes(bad.toString()),1024*1024));}
        JSONObject bad=new JSONObject(log.toString());bad.getJSONArray("messages").getJSONObject(0).getJSONArray("images").getJSONObject(0).remove("url");assertNull(NativeSearchKernel.searchable(bytes(bad.toString()),1024*1024));
        assertNull(NativeSearchKernel.searchable(bytes(log.toString().replace("\"large\":9007199254740993","\"large\":1,\"\\u006carge\":2")),1024*1024));
        assertNull(NativeSearchKernel.searchable(original,1));
    }
    @Test public void strictGrammarAndEscapedDuplicateKeysNeverReceiveAFastProof()throws Exception{
        for(String broken:new String[]{"", "{", "[] true", "{\"x\":1,}","[true,]","{\"x\":01}","{\"x\":NaN}","{\"x\":+1}","{\"x\":1e}","{\"x\":false true}","{\"x\":\"\\x41\"}","{\"x\":\"\\u00xz\"}","{\"x\":\"raw\nline\"}","{\"x\":1,\"\\u0078\":2}","{\"嵌套\":[{\"😀\":1,\"\\ud83d\\ude00\":2}]}","{\"__proto__\":1,\"__proto__\":2}"}){
            assertFalse(broken,NativeSearchKernel.check(bytes(broken),16*1024*1024,false));
            assertNull(broken,NativeSearchKernel.project(bytes(broken),16*1024*1024));
        }
        for(String valid:new String[]{"null","true","false","-1.25e+30","1e999","900719925474099312345","\"\\ud800\"","{\"\\ud800\":true}","[[],{},null,{\"x\":1},{\"x\":2}]"})assertTrue(valid,NativeSearchKernel.check(bytes(valid),16*1024*1024,false));
    }
    @Test public void fullProjectionKeepsEverySearchFieldAndValidatesDiscardedRawTails()throws Exception{
        JSONObject log=new JSONObject("{\"title\":\"完整😀标题\",\"messages\":[{\"id\":\"first\",\"text\":\"完整正文\\n尾\",\"images\":[{\"url\":\"https://example.com/a.png\"}],\"raw\":{\"original\":\"未知完整字段\"}},{\"id\":\"last\",\"text\":\"PUBLIC_END\",\"raw\":[1,true,{\"unknown\":\"完整\"}]}],\"outside\":{\"raw\":\"必须保留\"}} ");
        byte[] original=bytes(log.toString()), copy=original.clone();
        byte[] result=NativeSearchKernel.project(original,16*1024*1024);assertNotNull(result);assertArrayEquals(copy,original);
        JSONObject expected=new JSONObject(log.toString());for(int i=0;i<2;i++)expected.getJSONArray("messages").getJSONObject(i).put("raw",JSONObject.NULL);
        assertTrue(BackupValidation.same(expected,new JSONObject(new String(result,StandardCharsets.UTF_8))));
        String corrupt="{\"messages\":[{\"text\":\"kept\",\"raw\":{\"tail\":1,\"\\u0074ail\":2}}]}";
        assertNull(NativeSearchKernel.project(bytes(corrupt),16*1024*1024));
    }
    @Test public void malformedUtf8DepthAndResidentExhaustionRequireTheCompleteFallback()throws Exception{
        for(byte[] bad:new byte[][]{{(byte)0xc0,(byte)0xaf},{(byte)0xed,(byte)0xa0,(byte)0x80},{(byte)0xf4,(byte)0x90,(byte)0x80,(byte)0x80},{'"',(byte)0xe4,'"'}}){assertFalse(NativeSearchKernel.check(bad,16*1024*1024,false));assertNull(NativeSearchKernel.project(bad,16*1024*1024));}
        String deep=String.join("",Collections.nCopies(258,"["))+"0"+String.join("",Collections.nCopies(258,"]"));assertFalse(NativeSearchKernel.check(bytes(deep),16*1024*1024,false));
        byte[] value=bytes("{\"messages\":[{\"text\":\"完整\",\"raw\":{\"a\":1}}]}");
        assertNull(NativeSearchKernel.project(value,value.length));assertNotNull(NativeSearchKernel.project(value,1024*1024));
        assertTrue(NativeSearchKernel.check(bytes("{\"id\":\"public\",\"order\":1}"),1024*1024,true));
        for(String invalid:new String[]{"[]","{\"rawContent\":null}","{\"manualContent\":\"private\"}"})assertFalse(NativeSearchKernel.check(bytes(invalid),1024*1024,true));
    }
    @Test public void compactMessagesKeepPresentNullAndMissingDistinctAndNeverAcceptOriginalArraysAsMessages()throws Exception{
        String original="{\"messages\":[{\"text\":\"FULL_END\",\"timestamp\":null,\"images\":[],\"raw\":{\"unknown\":\"RAW_END\"}},{\"text\":\"LAST\"}],\"outside\":{\"raw\":\"KEEP\"}}";
        byte[] result=NativeSearchKernel.compact(bytes(original),1024*1024);assertNotNull(result);
        JSONObject log=new JSONObject(new String(result,StandardCharsets.UTF_8));JSONArray first=log.getJSONArray("messages").getJSONArray(0),last=log.getJSONArray("messages").getJSONArray(1);
        assertEquals(11,first.length());assertEquals((1<<2)|(1<<5)|(1<<9),first.getInt(0));assertTrue(first.isNull(3));assertEquals("FULL_END",first.getString(6));assertEquals(0,first.getJSONArray(10).length());
        assertEquals(1<<5,last.getInt(0));assertEquals("LAST",last.getString(6));assertEquals("KEEP",log.getJSONObject("outside").getString("raw"));
        for(String bad:new String[]{"{\"messages\":[[1023,1,2,3,4,5,6,7,8,9,10]]}","{\"messages\":[null]}","{\"messages\":[{\"raw\":{\"x\":1,\"\\u0078\":2}}]}"})assertNull(NativeSearchKernel.compact(bytes(bad),1024*1024));
    }
}
