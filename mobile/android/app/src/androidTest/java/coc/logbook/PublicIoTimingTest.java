package coc.logbook;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.webkit.JavascriptInterface;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Actual packaged UI/Worker/native I/O. Only the human file-picker choice is deterministic. */
@RunWith(AndroidJUnit4.class)
public final class PublicIoTimingTest {
    public static final class Choice {
        final String outputId;
        Choice(String outputId){this.outputId=outputId;}
        final AtomicReference<String> name=new AtomicReference<>("public-io-card.xlsx");
        @JavascriptInterface public void select(String value){
            if(value!=null&&value.matches("public-io-(card\\.(xlsx|xls)|table\\.(csv|xlsx|xls))")){name.set(value);return;}
            Uri uri=Uri.parse(value==null?"":value);
            if("com.android.externalstorage.documents".equals(uri.getAuthority())&&DocumentsContract.isDocumentUri(InstrumentationRegistry.getInstrumentation().getTargetContext(),uri)&&DocumentsContract.getDocumentId(uri).startsWith(outputId+"/")&&DocumentsContract.getTreeDocumentId(uri).equals(outputId)){name.set(value);return;}
            throw new IllegalArgumentException("Refuse private fixture");
        }
    }
    private boolean selectPublicFolder(android.view.accessibility.AccessibilityNodeInfo node){
        if(node==null)return false;
        String id=node.getViewIdResourceName(),text=String.valueOf(node.getText());
        if(node.isEnabled()&&((id!=null&&id.endsWith(":id/action_menu_select"))||text.equals("选择")||text.equals("SELECT")||text.equals("使用此文件夹")||text.equals("USE THIS FOLDER")||text.equals("允许")||text.equals("ALLOW")))return node.performAction(android.view.accessibility.AccessibilityNodeInfo.ACTION_CLICK);
        for(int i=0;i<node.getChildCount();i++)if(selectPublicFolder(node.getChild(i)))return true;
        return false;
    }
    private boolean containsPublicFolder(android.view.accessibility.AccessibilityNodeInfo node,String name){if(node==null)return false;if(String.valueOf(node.getText()).contains(name)||String.valueOf(node.getContentDescription()).contains(name))return true;for(int i=0;i<node.getChildCount();i++)if(containsPublicFolder(node.getChild(i),name))return true;return false;}
    private String asset(Context tests,String name)throws Exception{try(InputStream input=tests.getAssets().open(name);ByteArrayOutputStream output=new ByteArrayOutputStream()){byte[] buffer=new byte[65536];int count;while((count=input.read(buffer))!=-1)output.write(buffer,0,count);return output.toString("UTF-8");}}
    private String evaluate(ActivityScenario<MainActivity> scenario,String script)throws Exception{CountDownLatch done=new CountDownLatch(1);AtomicReference<String> result=new AtomicReference<>();scenario.onActivity(activity->activity.getBridge().getWebView().evaluateJavascript(script,value->{result.set(value);done.countDown();}));assertTrue("Public UI evaluation timeout",done.await(15,TimeUnit.SECONDS));return result.get();}
    private void sameJson(Object expected,Object actual)throws Exception{
        if(expected instanceof JSONObject){assertTrue(actual instanceof JSONObject);JSONObject left=(JSONObject)expected,right=(JSONObject)actual;assertEquals(left.length(),right.length());java.util.Iterator<String> keys=left.keys();while(keys.hasNext()){String key=keys.next();assertTrue(right.has(key));sameJson(left.get(key),right.get(key));}}
        else if(expected instanceof org.json.JSONArray){assertTrue(actual instanceof org.json.JSONArray);org.json.JSONArray left=(org.json.JSONArray)expected,right=(org.json.JSONArray)actual;assertEquals(left.length(),right.length());for(int i=0;i<left.length();i++)sameJson(left.get(i),right.get(i));}
        else assertEquals(expected,actual);
    }
    private void checkComplete(Context target,Context tests,JSONObject result,Uri tree)throws Exception{
        try(LogbookDatabase database=new LogbookDatabase(target)){
            org.json.JSONArray original=new JSONObject(asset(tests,"public-io-library.json")).getJSONArray("records");
            for(int i=0;i<original.length();i++){
                JSONObject row=original.getJSONObject(i);StringWriter output=new StringWriter();database.writeSnapshot(output,java.util.Collections.singleton(row.getString("id")));
                JSONObject saved=new JSONObject(output.toString()).getJSONArray("records").getJSONObject(0);
                assertEquals(row.getString("id"),saved.getString("id"));sameJson(row.getJSONObject("rawContent"),saved.getJSONObject("rawContent"));
            }
        }
        org.json.JSONArray documents=result.getJSONArray("documents");assertTrue("Complete output matrix",documents.length()>=31);
        for(int i=0;i<documents.length();i++){
            JSONObject file=documents.getJSONObject(i);Uri uri=Uri.parse(file.getString("uri"));assertEquals(tree.getAuthority(),uri.getAuthority());assertTrue(DocumentsContract.getDocumentId(uri).startsWith(DocumentsContract.getTreeDocumentId(tree)+"/"));
            java.security.MessageDigest hash=java.security.MessageDigest.getInstance("SHA-256");long count=0;try(InputStream input=target.getContentResolver().openInputStream(uri)){byte[] buffer=new byte[65536];int read;while((read=input.read(buffer))!=-1){count+=read;hash.update(buffer,0,read);}}
            StringBuilder hex=new StringBuilder();for(byte value:hash.digest())hex.append(String.format(java.util.Locale.ROOT,"%02x",value&255));assertEquals(file.getLong("bytes"),count);assertEquals(file.getString("sha256"),hex.toString());
        }
        result.put("independentOutputProofs",documents.length());result.put("completeOriginalBodiesVerified",78);
    }
    @Test public void publicImportsExportsAndSearchKeepFullContentAndRecordElapsedTime()throws Exception{
        Instrumentation instrumentation=InstrumentationRegistry.getInstrumentation();Context target=instrumentation.getTargetContext(),tests=instrumentation.getContext();
        assertEquals("Never run against production","coc.logbook.debug55",target.getPackageName());
        assertFalse("Never replace an existing test database",target.getDatabasePath("coc-logbook.sqlite").exists());
        android.content.SharedPreferences prefs=target.getSharedPreferences("archive-location",0);assertFalse("Never replace an existing test grant",prefs.contains("tree"));
        String id="public-"+UUID.randomUUID();
        Uri tree=DocumentsContract.buildTreeDocumentUri(PublicIoProvider.AUTHORITY,id);int modes=Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION;
        String outputId="primary:Download/COC-PublicIO-"+id;
        Uri outputTree=DocumentsContract.buildTreeDocumentUri("com.android.externalstorage.documents",outputId);
        Choice choice=new Choice(outputId);Instrumentation.ActivityMonitor monitor=null;boolean granted=false,outputGranted=false;
        String originalDocuments=prefs.getString("created-documents",null);
        File registryEvidence=new File(target.getCacheDir(),"public-io-registry-"+id);assertTrue(registryEvidence.mkdir());
        java.util.Map<File,File> preservedRegistry=new java.util.LinkedHashMap<>();
        for(String suffix:new String[]{"","-journal","-wal","-shm"}){File original=target.getDatabasePath("archive-index.db"+suffix);if(original.exists()){File saved=new File(registryEvidence,"before-archive-index.db"+suffix);assertTrue(original.renameTo(saved));preservedRegistry.put(original,saved);}}
        try{
            Intent grant=new Intent().setComponent(new android.content.ComponentName(tests.getPackageName(),PublicIoGrantActivity.class.getName())).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra("publicTarget",target.getPackageName()).putExtra("publicUri",tree.toString());tests.startActivity(grant);
            long deadline=System.currentTimeMillis()+20000;
            while(!granted){try{target.getContentResolver().takePersistableUriPermission(tree,modes);granted=true;}catch(SecurityException pending){assertTrue("Public I/O grant timeout",System.currentTimeMillis()<deadline);Thread.sleep(100);}}
            assertTrue(prefs.edit().putString("tree",tree.toString()).putString("label","公开计时测试目录").commit());
            try(LogbookDatabase database=new LogbookDatabase(target)){assertEquals(1,database.replace(asset(tests,"public-io-library.json"),0));}
            monitor=new Instrumentation.ActivityMonitor(){@Override public Instrumentation.ActivityResult onStartActivity(Intent intent){
                if(Intent.ACTION_OPEN_DOCUMENT_TREE.equals(intent.getAction())){intent.putExtra(DocumentsContract.EXTRA_INITIAL_URI,DocumentsContract.buildDocumentUri("com.android.externalstorage.documents",outputId));return null;}
                if(!Intent.ACTION_OPEN_DOCUMENT.equals(intent.getAction()))return null;
                Uri source=choice.name.get().startsWith("content:")?Uri.parse(choice.name.get()):DocumentsContract.buildDocumentUriUsingTree(tree,id+"/"+choice.name.get());
                return new Instrumentation.ActivityResult(Activity.RESULT_OK,new Intent().setData(source).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION));
            }};
            instrumentation.addMonitor(monitor);
            try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)){
                scenario.onActivity(activity->{activity.getBridge().getWebView().addJavascriptInterface(choice,"PublicIoChoice");activity.getBridge().getWebView().reload();});
                deadline=System.currentTimeMillis()+90000;
                while(!"true".equals(evaluate(scenario,"!!window.Capacitor && typeof window.Capacitor.nativePromise==='function' && !!document.querySelector('.module-body-search input') && typeof PublicIoChoice !== 'undefined'"))){assertTrue("Public UI readiness timeout",System.currentTimeMillis()<deadline);Thread.sleep(100);}
                String mode=InstrumentationRegistry.getArguments().getString("publicIoMode","baseline");assertTrue(mode.equals("baseline")||mode.equals("complete")||mode.equals("imports")||mode.equals("matrix"));
                if(mode.equals("complete")||mode.equals("matrix")){
                    try(android.os.ParcelFileDescriptor shell=instrumentation.getUiAutomation().executeShellCommand("mkdir -p /sdcard/Download/COC-PublicIO-"+id);InputStream input=new android.os.ParcelFileDescriptor.AutoCloseInputStream(shell);ByteArrayOutputStream output=new ByteArrayOutputStream()){byte[] bytes=new byte[1024];int count;while((count=input.read(bytes))!=-1)output.write(bytes,0,count);assertEquals("Public output folder creation must succeed","",output.toString("UTF-8").trim());}
                    assertTrue(prefs.edit().putString("created-documents","[]").commit());
                    evaluate(scenario,"window.__publicArchiveResult=null;window.Capacitor.nativePromise('Logbook','selectArchive',{}).then(function(value){window.__publicArchiveResult=value;document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('focus'));},function(error){window.__publicArchiveResult={error:String(error)}});");
                    deadline=System.currentTimeMillis()+45000;
                    // AOSP DocumentsUI ellipsizes long UUID folder labels in its
                    // breadcrumb. The unique public prefix admits the UI click;
                    // the persisted grant below must still equal this exact UUID.
                    while("null".equals(evaluate(scenario,"window.__publicArchiveResult"))){android.view.accessibility.AccessibilityNodeInfo root=instrumentation.getUiAutomation().getRootInActiveWindow();if(containsPublicFolder(root,"COC-PublicIO-"))selectPublicFolder(root);assertTrue("Public system folder authorization timeout",System.currentTimeMillis()<deadline);Thread.sleep(250);}
                    assertEquals(outputTree.toString(),prefs.getString("tree",""));outputGranted=true;
                    Thread.sleep(300);
                }
                evaluate(scenario,"window.__publicIoConfig={mode:"+JSONObject.quote(mode)+"};");
                evaluate(scenario,asset(tests,"public-io-webview.js"));
                deadline=System.currentTimeMillis()+15*60*1000;String result;
                while("null".equals(result=evaluate(scenario,"window.__publicIoResult || null"))){assertTrue("Public complete I/O timeout at "+evaluate(scenario,"window.__publicIoStage || ''"),System.currentTimeMillis()<deadline);Thread.sleep(250);}
                JSONObject checked=new JSONObject(result);checked.put("deviceModel",android.os.Build.MODEL);checked.put("androidApi",android.os.Build.VERSION.SDK_INT);checked.put("webViewVersion",android.webkit.WebView.getCurrentWebViewPackage().versionName);checked.put("physicalPhone",!android.os.Build.MODEL.toLowerCase(java.util.Locale.ROOT).contains("sdk"));
                if(checked.getBoolean("passed")&&(mode.equals("complete")||mode.equals("matrix")))checkComplete(target,tests,checked,outputTree);
                android.os.Bundle evidence=new android.os.Bundle();evidence.putString("public_io_result",checked.toString());instrumentation.sendStatus(0,evidence);
                System.out.println("PUBLIC_IO_TIMING "+checked);assertTrue(checked.toString(),checked.getBoolean("passed"));
            }
        }finally{
            if(monitor!=null)instrumentation.removeMonitor(monitor);
            assertTrue("Only our isolated database may be removed",target.getPackageName().equals("coc.logbook.debug55"));target.deleteDatabase("coc-logbook.sqlite");
            if(tree.toString().equals(prefs.getString("tree",""))||outputTree.toString().equals(prefs.getString("tree","")))prefs.edit().remove("tree").remove("label").commit();
            android.content.SharedPreferences.Editor editor=prefs.edit();if(originalDocuments==null)editor.remove("created-documents");else editor.putString("created-documents",originalDocuments);editor.commit();
            if(granted)target.getContentResolver().releasePersistableUriPermission(tree,modes);
            if(outputGranted)target.getContentResolver().releasePersistableUriPermission(outputTree,modes);
            Thread.sleep(250);
            for(String suffix:new String[]{"","-journal","-wal","-shm"}){File current=target.getDatabasePath("archive-index.db"+suffix);if(current.exists())assertTrue(current.renameTo(new File(registryEvidence,"result-archive-index.db"+suffix)));}
            for(java.util.Map.Entry<File,File> saved:preservedRegistry.entrySet())assertTrue(saved.getValue().renameTo(saved.getKey()));
            // Keep this UUID's fictional exports in the test APK directory for independent proof readback.
        }
    }
}
