package coc.logbook;
import android.content.Context;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.core.app.ActivityScenario;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;
import org.json.*;

@RunWith(AndroidJUnit4.class)
public final class CapacityWebViewTest {
    private String asset(String name)throws Exception{
        try(InputStream input=InstrumentationRegistry.getInstrumentation().getContext().getAssets().open(name)){
            ByteArrayOutputStream output=new ByteArrayOutputStream();byte[] buffer=new byte[65536];int count;
            while((count=input.read(buffer))!=-1)output.write(buffer,0,count);return output.toString("UTF-8");
        }
    }
    private String evaluate(ActivityScenario<MainActivity> scenario,String javascript)throws Exception{
        CountDownLatch ready=new CountDownLatch(1);AtomicReference<String> result=new AtomicReference<>();
        scenario.onActivity(activity->activity.getBridge().getWebView().evaluateJavascript(javascript,value->{result.set(value);ready.countDown();}));
        assertTrue("WebView evaluation timeout",ready.await(15,TimeUnit.SECONDS));return result.get();
    }
    @Test public void nativeWebViewSearches96MiBWithoutArchivePermissionOrDatabaseWrite()throws Exception{
        Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
        assertEquals("coc.logbook.debug52",context.getPackageName());
        assertFalse("Never replace an existing debug database",context.getDatabasePath("coc-logbook.sqlite").exists());
        File candidate=File.createTempFile("public-webview-",".candidate",context.getCacheDir());
        try{
            JSONObject root=new JSONObject(asset("public-capacity.json")),sample=null;JSONArray rows=root.getJSONArray("records"),metadata=new JSONArray();
            for(int index=0;index<rows.length();index++)if(rows.getJSONObject(index).getString("sourceType").equals("manual")){sample=rows.getJSONObject(index);break;}
            assertNotNull(sample);String body="PUBLIC_CAPACITY_BEGIN😀\u0000"+String.join("",java.util.Collections.nCopies(1024*1024,"A"))+"PUBLIC_CAPACITY_END";
            try(Writer output=new BufferedWriter(new OutputStreamWriter(new FileOutputStream(candidate),StandardCharsets.UTF_8),65536)){
                for(int index=0;index<96;index++){
                    JSONObject row=new JSONObject(sample.toString());row.put("id","public-native-read-"+index);row.put("order",index);row.remove("rawContent");row.put("manualContent",body);
                    output.write('R');output.write(row.toString());output.write('\n');row.remove("manualContent");metadata.put(row);
                }
                root.put("records",metadata);output.write('M');output.write(root.toString());output.write('\n');
            }
            BackupSession.Proof proof=BackupSession.fileProof(candidate,candidate.length());RestoreCandidate.Preview preview;
            try(InputStream input=new FileInputStream(candidate)){preview=RestoreCandidate.inspect(input,proof.bytes,proof.sha256,null);}
            try(LogbookDatabase database=new LogbookDatabase(context);InputStream input=new FileInputStream(candidate)){assertEquals(1,database.restoreCandidate(input,preview,0,true,"{}"));}
            try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)){
                long deadline=System.currentTimeMillis()+90000;
                while(!"true".equals(evaluate(scenario,"!!window.Capacitor && typeof window.Capacitor.nativePromise==='function'"))){assertTrue("Native bridge readiness timeout",System.currentTimeMillis()<deadline);Thread.sleep(250);}
                evaluate(scenario,asset("public-capacity-webview.js"));
                deadline=System.currentTimeMillis()+240000;String result;
                while("null".equals(result=evaluate(scenario,"window.__publicCapacityResult || null"))){assertTrue("Native read-only search timeout",System.currentTimeMillis()<deadline);Thread.sleep(500);}
                JSONObject checked=new JSONObject(result);assertTrue(checked.toString(),checked.getBoolean("passed"));
                assertTrue(checked.getLong("logicalBytes")>96L*1024*1024);assertEquals(96,checked.getInt("hits"));
                System.out.println("PUBLIC_ANDROID_WEBVIEW_CAPACITY "+checked);
            }
        }finally{assertTrue(candidate.delete());context.deleteDatabase("coc-logbook.sqlite");}
    }
}
