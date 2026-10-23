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
            if(value!=null&&value.matches("public-io-(card\\.(xlsx|xls)|card-spill\\.xlsx|table\\.(csv|xlsx|xls))")){name.set(value);return;}
            Uri uri=Uri.parse(value==null?"":value);
            if("com.android.externalstorage.documents".equals(uri.getAuthority())&&DocumentsContract.isDocumentUri(InstrumentationRegistry.getInstrumentation().getTargetContext(),uri)&&DocumentsContract.getDocumentId(uri).startsWith(outputId+"/")&&DocumentsContract.getTreeDocumentId(uri).equals(outputId)){name.set(value);return;}
            throw new IllegalArgumentException("Refuse private fixture");
        }
    }
    private boolean selectPublicFolder(android.view.accessibility.AccessibilityNodeInfo node){
        if(node==null)return false;
        String id=node.getViewIdResourceName(),text=String.valueOf(node.getText());
        if(node.isEnabled()&&PublicFolderAction.matches(id,text))return node.performAction(android.view.accessibility.AccessibilityNodeInfo.ACTION_CLICK);
        for(int i=0;i<node.getChildCount();i++)if(selectPublicFolder(node.getChild(i)))return true;
        return false;
    }
    private boolean containsPublicFolder(android.view.accessibility.AccessibilityNodeInfo node,String name){if(node==null)return false;if(String.valueOf(node.getText()).contains(name)||String.valueOf(node.getContentDescription()).contains(name))return true;for(int i=0;i<node.getChildCount();i++)if(containsPublicFolder(node.getChild(i),name))return true;return false;}
    /** Fresh emulator contains fictional fixtures only; never dump a phone's document UI. */
    private void publicPickerState(android.view.accessibility.AccessibilityNodeInfo node,StringBuilder output){
        if(node==null||output.length()>8000)return;
        output.append('[').append(node.getViewIdResourceName()).append('|').append(node.getClassName()).append('|').append(node.getText()).append('|').append(node.getContentDescription()).append('|').append(node.isEnabled()).append(']');
        for(int i=0;i<node.getChildCount();i++)publicPickerState(node.getChild(i),output);
    }
    private String asset(Context tests,String name)throws Exception{try(InputStream input=tests.getAssets().open(name);ByteArrayOutputStream output=new ByteArrayOutputStream()){byte[] buffer=new byte[65536];int count;while((count=input.read(buffer))!=-1)output.write(buffer,0,count);return output.toString("UTF-8");}}
    private String evaluate(ActivityScenario<MainActivity> scenario,String script)throws Exception{CountDownLatch done=new CountDownLatch(1);AtomicReference<String> result=new AtomicReference<>();scenario.onActivity(activity->activity.getBridge().getWebView().evaluateJavascript(script,value->{result.set(value);done.countDown();}));assertTrue("Public UI evaluation timeout",done.await(15,TimeUnit.SECONDS));return result.get();}
    private void sameJson(Object expected,Object actual)throws Exception{
        if(expected instanceof JSONObject){assertTrue(actual instanceof JSONObject);JSONObject left=(JSONObject)expected,right=(JSONObject)actual;assertEquals(left.length(),right.length());java.util.Iterator<String> keys=left.keys();while(keys.hasNext()){String key=keys.next();assertTrue(right.has(key));sameJson(left.get(key),right.get(key));}}
        else if(expected instanceof org.json.JSONArray){assertTrue(actual instanceof org.json.JSONArray);org.json.JSONArray left=(org.json.JSONArray)expected,right=(org.json.JSONArray)actual;assertEquals(left.length(),right.length());for(int i=0;i<left.length();i++)sameJson(left.get(i),right.get(i));}
        else assertEquals(expected,actual);
    }
    private void checkOriginalBodies(Context target,Context tests,JSONObject result)throws Exception{
        try(LogbookDatabase database=new LogbookDatabase(target)){
            org.json.JSONArray original=new JSONObject(asset(tests,"public-io-library.json")).getJSONArray("records");
            for(int i=0;i<original.length();i++){
                JSONObject row=original.getJSONObject(i);StringWriter output=new StringWriter();database.writeSnapshot(output,java.util.Collections.singleton(row.getString("id")));
                JSONObject saved=new JSONObject(output.toString()).getJSONArray("records").getJSONObject(0);
                assertEquals(row.getString("id"),saved.getString("id"));sameJson(row.getJSONObject("rawContent"),saved.getJSONObject("rawContent"));
            }
        }
        result.put("completeOriginalBodiesVerified",78);
    }
    private void checkComplete(Context target,Context tests,JSONObject result,Uri tree)throws Exception{
        checkOriginalBodies(target,tests,result);
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
        boolean localPrivateCard="true".equals(InstrumentationRegistry.getArguments().getString("localPrivateCard"));
        boolean localPrivateTable="true".equals(InstrumentationRegistry.getArguments().getString("localPrivateTable"));
        boolean capturePrivateSearch="true".equals(InstrumentationRegistry.getArguments().getString("capturePrivateSearch"));
        String searchReferenceText=InstrumentationRegistry.getArguments().getString("privateSearchReferenceBase64","");
        JSONObject searchReference=searchReferenceText.isEmpty()?null:new JSONObject(new String(java.util.Base64.getDecoder().decode(searchReferenceText),StandardCharsets.UTF_8));
        String searchInput=searchReference==null?null:"private-search-input-"+searchReference.getJSONObject("snapshot").getString("sha256")+".json";
        assertTrue("Private search input must carry a complete source proof",searchInput==null||searchInput.matches("private-search-input-[a-f0-9]{64}\\.json")&&searchReference.has("reference"));
        assertTrue("Private search requires the proven runtime private table",!capturePrivateSearch||localPrivateTable);
        String publicIoTableFirst=InstrumentationRegistry.getArguments().getString("publicIoTableFirst","csv");
        assertTrue("publicIoTableFirst must be exactly csv, xlsx or xls",publicIoTableFirst.equals("csv")||publicIoTableFirst.equals("xlsx")||publicIoTableFirst.equals("xls"));
        assertFalse("Private card and table modes must be separate",localPrivateCard&&localPrivateTable);
        String privateTableProof=InstrumentationRegistry.getArguments().getString("expectedTableProofBase64","");
        JSONObject expectedTableProof=localPrivateTable?new JSONObject(new String(java.util.Base64.getDecoder().decode(privateTableProof),StandardCharsets.UTF_8)):null;
        assertTrue("Runtime private table complete proof is required",!localPrivateTable||expectedTableProof!=null&&expectedTableProof.optInt("version")==1&&expectedTableProof.has("source")&&expectedTableProof.has("candidate")&&expectedTableProof.has("valuesSha256"));
        Uri tree=DocumentsContract.buildTreeDocumentUri(PublicIoProvider.AUTHORITY,id);int modes=Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION;
        String outputId="primary:Download/COC-PublicIO-"+id;
        Uri outputTree=DocumentsContract.buildTreeDocumentUri("com.android.externalstorage.documents",outputId);
        Choice choice=new Choice(outputId);Instrumentation.ActivityMonitor monitor=null;boolean granted=false,outputGranted=false;
        String originalDocuments=prefs.getString("created-documents",null);
        File registryEvidence=new File(target.getCacheDir(),"public-io-registry-"+id);assertTrue(registryEvidence.mkdir());
        java.util.Map<File,File> preservedRegistry=new java.util.LinkedHashMap<>();
        for(String suffix:new String[]{"","-journal","-wal","-shm"}){File original=target.getDatabasePath("archive-index.db"+suffix);if(original.exists()){File saved=new File(registryEvidence,"before-archive-index.db"+suffix);assertTrue(original.renameTo(saved));preservedRegistry.put(original,saved);}}
        try{
            Intent grant=new Intent().setComponent(new android.content.ComponentName(tests.getPackageName(),PublicIoGrantActivity.class.getName())).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra("publicTarget",target.getPackageName()).putExtra("publicUri",tree.toString()).putExtra("localPrivateCard",localPrivateCard).putExtra("localPrivateTable",localPrivateTable).putExtra("privateSearchInput",searchInput);tests.startActivity(grant);
            long deadline=System.currentTimeMillis()+20000;
            while(!granted){try{target.getContentResolver().takePersistableUriPermission(tree,modes);granted=true;}catch(SecurityException pending){assertTrue("Public I/O grant timeout",System.currentTimeMillis()<deadline);Thread.sleep(100);}}
            assertTrue(prefs.edit().putString("tree",tree.toString()).putString("label","公开计时测试目录").commit());
            if(searchReference!=null){
                Uri reference=DocumentsContract.buildDocumentUriUsingTree(tree,id+"/private-search-reference.json");
                BackupSession.Proof referenceProof;try(InputStream input=target.getContentResolver().openInputStream(reference)){referenceProof=BackupSession.streamProof(input,StorageBudget.JS_SAFE_INTEGER);}
                assertEquals(searchReference.getJSONObject("reference").getLong("bytes"),referenceProof.bytes);assertEquals(searchReference.getJSONObject("reference").getString("sha256"),referenceProof.sha256);
                JSONObject originalProof=searchReference.getJSONObject("snapshot");
                try(InputStream input=target.getContentResolver().openInputStream(reference);ByteArrayOutputStream output=new ByteArrayOutputStream()){byte[] buffer=new byte[65536];int count;while((count=input.read(buffer))!=-1)output.write(buffer,0,count);searchReference=new JSONObject(output.toString("UTF-8"));}
                assertEquals(originalProof.getLong("bytes"),searchReference.getJSONObject("snapshot").getLong("bytes"));assertEquals(originalProof.getString("sha256"),searchReference.getJSONObject("snapshot").getString("sha256"));assertEquals(114,searchReference.getJSONArray("responses").length());
            }
            try(LogbookDatabase database=new LogbookDatabase(target)){
                if(searchReference==null)assertEquals(1,database.replace(asset(tests,"public-io-library.json"),0));
                else{
                    Uri source=DocumentsContract.buildDocumentUriUsingTree(tree,id+"/private-search-resume.json");
                    BackupSession.Proof proof;try(InputStream input=target.getContentResolver().openInputStream(source)){proof=BackupSession.streamProof(input,StorageBudget.JS_SAFE_INTEGER);}
                    assertEquals(searchReference.getJSONObject("snapshot").getLong("bytes"),proof.bytes);assertEquals(searchReference.getJSONObject("snapshot").getString("sha256"),proof.sha256);
                    try(Reader reader=new BufferedReader(new InputStreamReader(target.getContentResolver().openInputStream(source),StandardCharsets.UTF_8))){assertEquals(1,database.replace(reader,0));}
                    assertEquals("Require the complete captured private corpus and all originals",196,database.recordCount());
                }
            }
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
                while(!"true".equals(evaluate(scenario,"!!window.Capacitor && typeof window.Capacitor.nativePromise==='function' && !!document.querySelector('"+(searchReference==null?".module-body-search input":".records-create-actions")+"') && typeof PublicIoChoice !== 'undefined'"))){assertTrue("Public UI readiness timeout",System.currentTimeMillis()<deadline);Thread.sleep(100);}
                if(searchReference!=null){
                    evaluate(scenario,"window.__privateSearchReference="+searchReference+";window.__privateSearchResume=true;");
                    evaluate(scenario,asset(tests,"public-io-private-search.js"));
                    deadline=System.currentTimeMillis()+21*60*1000;String value;
                    while("null".equals(value=evaluate(scenario,"window.__privateSearchResult || null"))){assertTrue("Resumed private search timeout",System.currentTimeMillis()<deadline);Thread.sleep(250);}
                    JSONObject search=new JSONObject(value);
                    Uri saved=DocumentsContract.createDocument(target.getContentResolver(),DocumentsContract.buildDocumentUriUsingTree(tree,id),"application/json","private-search-snapshot.json");assertNotNull(saved);
                    try(LogbookDatabase database=new LogbookDatabase(target);Writer writer=new BufferedWriter(new OutputStreamWriter(target.getContentResolver().openOutputStream(saved,"w"),StandardCharsets.UTF_8))){database.writeSnapshot(writer,null);}
                    BackupSession.Proof proof;try(InputStream input=target.getContentResolver().openInputStream(saved)){proof=BackupSession.streamProof(input,StorageBudget.JS_SAFE_INTEGER);}
                    search.put("localSnapshot","public-io/"+id+"/private-search-snapshot.json");search.put("snapshotBytes",proof.bytes);search.put("snapshotSha256",proof.sha256);
                    android.os.Bundle evidence=new android.os.Bundle();evidence.putString("private_search_result",search.toString());instrumentation.sendStatus(0,evidence);
                    checkOriginalBodies(target,tests,search);
                    assertTrue("All full-content and private search timings must pass",search.getBoolean("passed"));return;
                }
                String mode=InstrumentationRegistry.getArguments().getString("publicIoMode","baseline");assertTrue(mode.equals("baseline")||mode.equals("complete")||mode.equals("imports")||mode.equals("cards")||mode.equals("matrix")||mode.equals("tables")||mode.equals("private-table"));
                assertEquals("Private table mode must have runtime input and complete proof",mode.equals("private-table"),localPrivateTable);
                if(mode.equals("complete")||mode.equals("matrix")){
                    try(android.os.ParcelFileDescriptor shell=instrumentation.getUiAutomation().executeShellCommand("mkdir -p /sdcard/Download/COC-PublicIO-"+id);InputStream input=new android.os.ParcelFileDescriptor.AutoCloseInputStream(shell);ByteArrayOutputStream output=new ByteArrayOutputStream()){byte[] bytes=new byte[1024];int count;while((count=input.read(bytes))!=-1)output.write(bytes,0,count);assertEquals("Public output folder creation must succeed","",output.toString("UTF-8").trim());}
                    assertTrue(prefs.edit().putString("created-documents","[]").commit());
                    evaluate(scenario,"window.__publicArchiveResult=null;window.Capacitor.nativePromise('Logbook','selectArchive',{}).then(function(value){window.__publicArchiveResult=value;document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('focus'));},function(error){window.__publicArchiveResult={error:String(error)}});");
                    deadline=System.currentTimeMillis()+45000;
                    // AOSP DocumentsUI ellipsizes long UUID folder labels in its
                    // breadcrumb. The unique public prefix admits the UI click;
                    // the persisted grant below must still equal this exact UUID.
                    while("null".equals(evaluate(scenario,"window.__publicArchiveResult"))){android.view.accessibility.AccessibilityNodeInfo root=instrumentation.getUiAutomation().getRootInActiveWindow();if(containsPublicFolder(root,"COC-PublicIO-"))selectPublicFolder(root);if(System.currentTimeMillis()>=deadline){String model=android.os.Build.MODEL.toLowerCase(java.util.Locale.ROOT);if(model.contains("sdk")||model.contains("gphone")||android.os.Build.FINGERPRINT.startsWith("generic")){StringBuilder description=new StringBuilder();publicPickerState(root,description);System.out.println("PUBLIC_PICKER_STATE "+description);}fail("Public system folder authorization timeout");}Thread.sleep(250);}
                    assertEquals(outputTree.toString(),prefs.getString("tree",""));outputGranted=true;
                    Thread.sleep(300);
                }
                assertTrue("Private local card must only run imports",!localPrivateCard||mode.equals("imports"));
                String expectedName=localPrivateCard?new String(java.util.Base64.getDecoder().decode(InstrumentationRegistry.getArguments().getString("expectedCardNameBase64","")),StandardCharsets.UTF_8):"公开七版调查员";
                assertTrue("Complete expected card name is required",expectedName!=null&&!expectedName.trim().isEmpty());
                String expectedProof=InstrumentationRegistry.getArguments().getString("expectedCardProof","");
                assertTrue("Full local draft proof is required",!localPrivateCard||expectedProof.matches("[a-f0-9]{64}"));
                evaluate(scenario,"window.__publicIoConfig={mode:"+JSONObject.quote(mode)+",publicIoTableFirst:"+JSONObject.quote(publicIoTableFirst)+",localPrivateCard:"+localPrivateCard+",expectedCardName:"+JSONObject.quote(expectedName)+",expectedCardProof:"+JSONObject.quote(expectedProof)+",localPrivateTable:"+localPrivateTable+",expectedTableProof:"+(expectedTableProof==null?"null":expectedTableProof.toString())+"};");
                long explicitActionsStarted=android.os.SystemClock.elapsedRealtime();evaluate(scenario,asset(tests,"public-io-webview.js"));
                deadline=System.currentTimeMillis()+15*60*1000;String result;
                while("null".equals(result=evaluate(scenario,"window.__publicIoResult || null"))){assertTrue("Public complete I/O timeout at "+evaluate(scenario,"window.__publicIoStage || ''"),System.currentTimeMillis()<deadline);Thread.sleep(250);}
                JSONObject checked=new JSONObject(result);checked.put("deviceModel",android.os.Build.MODEL);checked.put("androidApi",android.os.Build.VERSION.SDK_INT);checked.put("webViewVersion",android.webkit.WebView.getCurrentWebViewPackage().versionName);checked.put("physicalPhone",!android.os.Build.MODEL.toLowerCase(java.util.Locale.ROOT).contains("sdk"));
                if(checked.getBoolean("passed")&&(mode.equals("complete")||mode.equals("matrix")))checkComplete(target,tests,checked,outputTree);
                if(checked.getBoolean("passed")&&(mode.equals("tables")||mode.equals("private-table")))checkOriginalBodies(target,tests,checked);
                android.os.Bundle evidence=new android.os.Bundle();evidence.putString("public_io_result",checked.toString());instrumentation.sendStatus(0,evidence);
                System.out.println("PUBLIC_IO_TIMING "+checked);assertTrue(checked.toString(),checked.getBoolean("passed"));
                // Query AFTER all measurements so the assertion itself cannot
                // warm a provider. Startup must open no input contents, and
                // all three private-card attempts must freshly read the file.
                try(android.database.Cursor access=target.getContentResolver().query(DocumentsContract.buildDocumentUriUsingTree(tree,id),new String[]{"public_first_open_elapsed"},null,null,null)){
                    assertNotNull(access);assertTrue(access.moveToFirst());long first=access.getLong(0);assertTrue("Warmup must not open input contents",first==0||first>=explicitActionsStarted);
                }
                if(localPrivateCard&&mode.equals("imports"))try(android.database.Cursor access=target.getContentResolver().query(DocumentsContract.buildDocumentUriUsingTree(tree,id+"/public-io-card.xlsx"),new String[]{"public_document_opens"},null,null,null)){
                    assertNotNull(access);assertTrue(access.moveToFirst());assertEquals("Every attempt must read the actual private input",3,access.getInt(0));
                }
                if(mode.equals("tables"))for(String extension:new String[]{"csv","xlsx","xls"})try(android.database.Cursor access=target.getContentResolver().query(DocumentsContract.buildDocumentUriUsingTree(tree,id+"/public-io-table."+extension),new String[]{"public_document_opens"},null,null,null)){
                    assertNotNull(access);assertTrue(access.moveToFirst());assertEquals("Every table attempt must read the actual full input",3,access.getInt(0));
                }
                if(localPrivateTable)try(android.database.Cursor access=target.getContentResolver().query(DocumentsContract.buildDocumentUriUsingTree(tree,id+"/public-io-table.xlsx"),new String[]{"public_document_opens"},null,null,null)){
                    assertNotNull(access);assertTrue(access.moveToFirst());assertEquals("Every private table preview must freshly read the complete selected file",3,access.getInt(0));
                }
                org.json.JSONArray measurements=checked.getJSONArray("results");int characterSamples=0,tableSamples=0;
                for(int i=0;i<measurements.length();i++){
                    JSONObject sample=measurements.getJSONObject(i);
                    if(sample.getString("operation").startsWith("character-import-xlsx-")){
                        characterSamples++;
                        assertTrue("Character import must visibly respond within 100ms: "+sample,sample.getDouble("responseMs")<=100);
                        assertTrue("Complete ~700KB character draft must be ready within 600ms: "+sample,sample.getDouble("totalMs")<=600);
                    }
                    if((mode.equals("tables")||mode.equals("private-table"))&&sample.getString("operation").startsWith("record-table-import-preview-")){
                        tableSamples++;
                        assertTrue("Table import must visibly respond within 100ms: "+sample,sample.getDouble("responseMs")<=100);
                        assertTrue("Complete table preview must be ready within 600ms: "+sample,sample.getDouble("totalMs")<=600);
                    }
                }
                if(!mode.equals("matrix")&&!mode.equals("tables")&&!mode.equals("private-table"))assertEquals("All three character runs are required",3,characterSamples);
                if(mode.equals("tables"))assertEquals("All formats need their first and two subsequent previews",9,tableSamples);
                if(mode.equals("private-table"))assertEquals("Private table requires its first and two subsequent complete previews",3,tableSamples);
                if(capturePrivateSearch){
                    assertEquals("Private search starts only after complete table verification","private-table",mode);
                    evaluate(scenario,asset(tests,"public-io-private-search.js"));
                    deadline=System.currentTimeMillis()+21*60*1000;
                    String searchResult;
                    while("null".equals(searchResult=evaluate(scenario,"window.__privateSearchResult || null"))){assertTrue("Private search timeout at "+evaluate(scenario,"window.__publicIoStage || ''"),System.currentTimeMillis()<deadline);Thread.sleep(250);}
                    JSONObject search=new JSONObject(searchResult);
                    android.os.Bundle progress=new android.os.Bundle();progress.putString("private_search_progress",search.toString());instrumentation.sendStatus(0,progress);
                    Uri saved=DocumentsContract.createDocument(target.getContentResolver(),DocumentsContract.buildDocumentUriUsingTree(tree,id),"application/json","private-search-snapshot.json");
                    assertNotNull("Private search snapshot must be created in its own granted test directory",saved);
                    try(LogbookDatabase database=new LogbookDatabase(target);Writer writer=new BufferedWriter(new OutputStreamWriter(target.getContentResolver().openOutputStream(saved,"w"),StandardCharsets.UTF_8))){database.writeSnapshot(writer,null);}
                    BackupSession.Proof proof;try(InputStream input=target.getContentResolver().openInputStream(saved)){proof=BackupSession.streamProof(input,StorageBudget.JS_SAFE_INTEGER);}
                    search.put("localSnapshot","public-io/"+id+"/private-search-snapshot.json");search.put("snapshotBytes",proof.bytes);search.put("snapshotSha256",proof.sha256);
                    android.os.Bundle searchEvidence=new android.os.Bundle();searchEvidence.putString("private_search_result",search.toString());instrumentation.sendStatus(0,searchEvidence);
                    assertTrue("Private full-text search must pass every complete-content and timing gate",search.getBoolean("passed"));
                    checkOriginalBodies(target,tests,checked);
                }
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
