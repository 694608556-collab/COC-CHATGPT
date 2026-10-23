package coc.logbook;

import java.nio.charset.StandardCharsets;
import java.nio.charset.CodingErrorAction;
import java.nio.ByteBuffer;
import org.json.JSONObject;

/** Read-only parser. Never owns an archive grant, production database or write. */
final class NativeTableKernel {
    private static final boolean AVAILABLE;
    static { boolean loaded=false;try{System.loadLibrary("coc_table_native");loaded=true;}catch(UnsatisfiedLinkError unsupported){}AVAILABLE=loaded; }
    private static native byte[] preview(byte[] source,long available);
    private static native byte[] records(byte[] source,long available);
    private static native void warm();
    static void warmCode(){if(AVAILABLE)warm();}
    /** Keep the complete bounded payload encoded until the worker parses it.
     * Its caller still seals/proves the actual input and verifies the lease. */
    static String inspectRecords(byte[] source,long available,JSONObject timing)throws Exception{
        if(!AVAILABLE)return null;
        long started=System.nanoTime();byte[] result=records(source,available);
        if(timing!=null)timing.put("recordsKernelMs",(System.nanoTime()-started)/1000000.0);
        if(result==null)return null;
        started=System.nanoTime();String json=StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(result)).toString();
        if(timing!=null)timing.put("recordsPayloadDecodeMs",(System.nanoTime()-started)/1000000.0);
        return json;
    }
    static JSONObject inspect(byte[] source,long available)throws Exception{
        return inspect(source,available,null);
    }
    static JSONObject inspect(byte[] source,long available,JSONObject timing)throws Exception{
        if(!AVAILABLE)return null;
        long started=System.nanoTime();
        byte[] result=preview(source,available);
        if(timing!=null)timing.put("kernelMs",(System.nanoTime()-started)/1000000.0);
        if(result==null)return null;
        started=System.nanoTime();
        JSONObject parsed=new JSONObject(StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(result)).toString());
        if(timing!=null)timing.put("nativeJsonMs",(System.nanoTime()-started)/1000000.0);
        if(parsed.optInt("version")!=1||!parsed.optBoolean("supported"))return null;
        return parsed;
    }
}
