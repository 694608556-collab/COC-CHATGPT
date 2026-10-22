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
        assertTrue("Never run against production",context.getPackageName().matches("coc\\.logbook\\.debug[0-9]+"));
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
    @Test public void nativeWebViewImportsTableThroughActualWorkerAndBridge()throws Exception{
        Context context=InstrumentationRegistry.getInstrumentation().getTargetContext(),tests=InstrumentationRegistry.getInstrumentation().getContext();
        assertTrue("Never run against production",context.getPackageName().matches("coc\\.logbook\\.debug[0-9]+"));
        assertFalse("Never replace an existing debug database",context.getDatabasePath("coc-logbook.sqlite").exists());
        android.content.SharedPreferences preferences=context.getSharedPreferences("archive-location",0);assertFalse("Never replace an existing directory",preferences.contains("tree"));
        android.net.Uri uri=android.net.Uri.parse("content://coc.logbook.public.tabletest/tree/public-"+java.util.UUID.randomUUID());
        int modes=android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION|android.content.Intent.FLAG_GRANT_WRITE_URI_PERMISSION;
        AtomicReference<TableSession> owned=new AtomicReference<>();boolean granted=false;
        try{
            android.content.Intent grant=new android.content.Intent().setComponent(new android.content.ComponentName(tests.getPackageName(),PublicTableGrantActivity.class.getName())).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK).putExtra("publicTarget",context.getPackageName()).putExtra("publicUri",uri.toString());tests.startActivity(grant);
            long deadline=System.currentTimeMillis()+20000;
            while(!granted){try{context.getContentResolver().takePersistableUriPermission(uri,modes);granted=true;}catch(SecurityException pending){assertTrue("Public test grant timeout",System.currentTimeMillis()<deadline);Thread.sleep(100);}}
            assertTrue(preferences.edit().putString("tree",uri.toString()).putString("label","公开测试目录").commit());
            try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)){
                deadline=System.currentTimeMillis()+90000;
                while(!"true".equals(evaluate(scenario,"!!window.Capacitor && typeof window.Capacitor.nativePromise==='function'"))){assertTrue("Native bridge readiness timeout",System.currentTimeMillis()<deadline);Thread.sleep(250);}
                CountDownLatch ready=new CountDownLatch(1);AtomicReference<JSONObject> source=new AtomicReference<>();AtomicReference<Exception> failure=new AtomicReference<>();
                scenario.onActivity(activity->{LogbookPlugin plugin=(LogbookPlugin)activity.getBridge().getPlugin("Logbook").getInstance();plugin.execute(()->{
                    try{
                        java.lang.reflect.Field field=LogbookPlugin.class.getDeclaredField("tableSession");field.setAccessible(true);if(field.get(plugin)!=null)throw new IllegalStateException("Refuse occupied native table session");
                        TableSession owner=new TableSession(new File(context.getCacheDir(),"table-stream-staging"),uri.toString(),0,"record-table","public-bridge.csv",null);owned.set(owner);
                        String csv="模组名,场次名,海豹链接,手动保存内容\n公开桥接,手动,,公开初版\n公开桥接,在线,https://log.weizaima.com/?key=public-native-table,\n公开桥接,重复,https://log.weizaima.com/?key=public-native-table,\n公开桥接,手动,,\"公开更新😀\n完整正文\"\n";
                        BackupSession.Proof proof=owner.capture(new ByteArrayInputStream(csv.getBytes(StandardCharsets.UTF_8)));field.set(plugin,owner);
                        source.set(new JSONObject().put("id",owner.id).put("revision",0).put("fileUri",android.net.Uri.fromFile(owner.source).toString()).put("bytes",proof.bytes).put("sha256",proof.sha256).put("name",owner.name).put("format",owner.format).put("maximumStageBytes",owner.maximumStageBytes));
                    }catch(Exception error){failure.set(error);}finally{ready.countDown();}
                });});
                assertTrue("Native table source setup timeout",ready.await(20,TimeUnit.SECONDS));if(failure.get()!=null)throw failure.get();assertNotNull(source.get());
                evaluate(scenario,"window.__publicNativeTableSource="+source.get()+";");evaluate(scenario,asset("public-table-webview.js"));deadline=System.currentTimeMillis()+90000;String result;
                while("null".equals(result=evaluate(scenario,"window.__publicNativeTableResult || null"))){assertTrue("Native table Worker/bridge timeout",System.currentTimeMillis()<deadline);Thread.sleep(250);}
                JSONObject checked=new JSONObject(result);assertTrue(checked.toString(),checked.getBoolean("passed"));assertEquals(1,checked.getInt("revision"));assertFalse(owned.get().directory.exists());
                System.out.println("PUBLIC_ANDROID_WEBVIEW_TABLE "+checked);
            }
        }finally{
            if(owned.get()!=null)owned.get().close();context.deleteDatabase("coc-logbook.sqlite");
            if(uri.toString().equals(preferences.getString("tree","")))assertTrue(preferences.edit().remove("tree").remove("label").commit());
            if(granted)context.getContentResolver().releasePersistableUriPermission(uri,modes);
        }
    }
}
