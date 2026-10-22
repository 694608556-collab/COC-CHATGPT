package coc.logbook;

import android.app.Activity;
import android.content.Intent;
import android.content.ClipData;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.net.ConnectivityManager;
import android.provider.DocumentsContract;
import android.provider.OpenableColumns;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import java.net.URL;
import java.net.HttpURLConnection;
import org.json.JSONArray;
import org.json.JSONObject;

/** Local app bridge. Uses SAF grants and private SQLite, never root or broad storage permissions. */
@CapacitorPlugin(name = "Logbook")
public final class LogbookPlugin extends Plugin {
    private static final Set<String> ACTIVE_PUBLICATIONS = java.util.concurrent.ConcurrentHashMap.newKeySet();
    private LogbookDatabase database;
    private ArchiveRegistry archives;
    private PdfSpool pdfSpool;
    private SnapshotUpload snapshotUpload;
    private FetchBatch fetchBatch;
    private volatile TextPdfJobs textPdfJobs;
    private ReadLease readLease;
    private BackupSession backupSession;
    private TableSession tableSession;
    private boolean importPickerPending;
    private ArchivePublication publication;
    private java.io.File directInputDirectory;
    // Burst-local naming snapshot only; document creation, never an existing URI, remains the publication primitive.
    private String namingLocation;
    private Set<String> namingNames;
    private long namingReadAt;
    private final Object namingLock = new Object();
    private final NetworkQueue networkQueue = new NetworkQueue();
    private final java.util.concurrent.ExecutorService backupWriter = java.util.concurrent.Executors.newSingleThreadExecutor();
    private static final java.util.concurrent.atomic.AtomicBoolean backupRunning = new java.util.concurrent.atomic.AtomicBoolean();
    @Override public void load() { database = new LogbookDatabase(getContext()); archives = new ArchiveRegistry(getContext()); }
    @Override protected void handleOnDestroy() {
        networkQueue.close(); backupWriter.shutdown();
        execute(() -> { try { if (tableSession != null) tableSession.close(); if (backupSession != null) backupSession.close(); if (fetchBatch != null) fetchBatch.close(); if (snapshotUpload != null) snapshotUpload.close(); if (readLease != null) readLease.close(); if (textPdfJobs != null) textPdfJobs.close(); if (pdfSpool != null) pdfSpool.close(); } catch (Exception ignored) { } finally { if (archives != null) archives.close(); } });
        if (database != null) database.close();
    }
    private SharedPreferences prefs() { return getContext().getSharedPreferences("archive-location", 0); }
    /** Only recorded, unregistered URIs with unchanged source prefixes may be removed after interruption. */
    private synchronized ArchivePublication publications() throws Exception {
        if (publication == null) publication = new ArchivePublication(new java.io.File(getContext().getFilesDir(), "archive-publications"),
            new ArchivePublication.Store() {
                public JSONArray pending() throws Exception { return archives.pendingPublications(); }
                public void put(JSONObject value) throws Exception { archives.putPublication(value); }
                public void remove(String id) { archives.removePublication(id); }
            }, new ArchivePublication.Documents() {
                public boolean registered(String uri) throws Exception { return knownPublication(uri); }
                public boolean exists(JSONObject value) throws Exception {
                    String location = value.getString("location"); boolean readable = false;
                    for (android.content.UriPermission grant : getContext().getContentResolver().getPersistedUriPermissions())
                        if (grant.getUri().toString().equals(location) && grant.isReadPermission()) readable = true;
                    if (!readable) throw new IllegalStateException("上次未完成文件缺少读取授权，已保留；请重新选择归档目录。");
                    Uri tree = Uri.parse(location); validateTree(tree);
                    Uri parent = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
                    try (Cursor folder = getContext().getContentResolver().query(parent, new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID}, null, null, null)) {
                        if (folder == null || !folder.moveToFirst()) throw new IllegalStateException("上次发布目录暂不可用，请恢复目录权限后重试。");
                    }
                    try (Cursor row = getContext().getContentResolver().query(Uri.parse(value.getString("uri")), new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID}, null, null, null)) {
                        if (row == null) throw new IllegalStateException("无法核对上次未完成文件。");
                        return row.moveToFirst();
                    } catch (SecurityException error) { throw error; }
                    catch (RuntimeException missingOrUnavailable) {
                        // Android 9 rejects an already-removed tree child before queryDocument can return an empty cursor.
                        // Confirm absence by exact ID in this authorized parent; never treat a provider failure as deletion.
                        String target = DocumentsContract.getDocumentId(Uri.parse(value.getString("uri")));
                        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
                        try (Cursor rows = getContext().getContentResolver().query(children, new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID}, null, null, null)) {
                            if (rows == null) throw missingOrUnavailable;
                            while (rows.moveToNext()) if (target.equals(rows.getString(0))) throw missingOrUnavailable;
                            return false;
                        }
                    }
                }
                public InputStream open(String uri) throws Exception { return getContext().getContentResolver().openInputStream(Uri.parse(uri)); }
                public boolean delete(String uri) throws Exception { return DocumentsContract.deleteDocument(getContext().getContentResolver(), Uri.parse(uri)); }
            }, ACTIVE_PUBLICATIONS);
        return publication;
    }
    private boolean knownPublication(String uri) throws Exception { return archives.find(uri, prefs().getString("created-documents", "[]")) != null; }
    /** Small archive inputs have their own private directory; startup cleanup never touches shared documents. */
    private synchronized java.io.File directInputs() throws Exception {
        if (directInputDirectory == null) {
            java.io.File directory = new java.io.File(getContext().getCacheDir(), "archive-direct-inputs");
            if (!directory.isDirectory() && !directory.mkdirs()) throw new IllegalStateException("无法创建归档暂存目录。");
            java.io.File[] stale = directory.listFiles((dir, name) -> name.matches("coc-direct-[0-9]+\\.part"));
            if (stale == null) throw new IllegalStateException("无法读取归档暂存目录。");
            for (java.io.File file : stale) if (!file.delete()) throw new IllegalStateException("归档暂存清理失败。");
            directInputDirectory = directory;
        }
        return directInputDirectory;
    }
    /** No arguments. Persist before granting one welcome display; business restore/clear never touches this file. */
    @PluginMethod public synchronized void claimFirstLaunchIntro(PluginCall call) {
        try {
            SharedPreferences presentation = getContext().getSharedPreferences("app-presentation", 0);
            boolean show = !presentation.getBoolean("first-welcome-shown", false);
            if (show && !presentation.edit().putBoolean("first-welcome-shown", true).commit())
                throw new IllegalStateException("Unable to persist welcome display marker.");
            JSObject out = new JSObject(); out.put("show", show); call.resolve(out);
        } catch (Exception error) { call.reject("Unable to claim welcome display.", error); }
    }
    private String digest(byte[] bytes) throws Exception {
        StringBuilder result = new StringBuilder();
        for (byte b : MessageDigest.getInstance("SHA-256").digest(bytes)) result.append(String.format("%02x", b & 255));
        return result.toString();
    }
    private byte[] read(Uri uri) throws Exception {
        try (InputStream input = getContext().getContentResolver().openInputStream(uri);
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            if (input == null) throw new IllegalStateException("无法读取文件。");
            byte[] chunk = new byte[8192]; int count;
            while ((count = input.read(chunk)) != -1) {
                output.write(chunk, 0, count);
            }
            return output.toByteArray();
        }
    }
    private String displayName(Uri document) {
        try (Cursor cursor = getContext().getContentResolver().query(document, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) return cursor.getString(0);
        } catch (Exception ignored) { }
        return "已选择的文件夹";
    }
    /** Only local shared storage is allowed; deny roots and app-private Android/data or obb. */
    private void validateTree(Uri tree) {
        String authority = tree.getAuthority();
        String id = DocumentsContract.getTreeDocumentId(tree);
        if (!"com.android.externalstorage.documents".equals(authority) && !"com.android.providers.downloads.documents".equals(authority))
            throw new IllegalArgumentException("请选择本机或存储卡的共享文件夹，不使用云端目录。");
        if ("com.android.externalstorage.documents".equals(authority)) {
            int colon = id.indexOf(':');
            String path = colon < 0 ? "" : id.substring(colon + 1);
            if (path.isEmpty() || path.matches("(?i)Android/(data|obb)(/.*)?"))
                throw new IllegalArgumentException("请选择普通共享子文件夹，不选择存储根目录或 Android/data、obb。");
        }
    }
    /** Newly created probe is deleted after verification; never touches an existing document. */
    private void verifyWritable(Uri tree) throws Exception {
        validateTree(tree);
        Uri parent = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
        Uri probe = DocumentsContract.createDocument(getContext().getContentResolver(), parent, "text/plain", "coc-write-check-" + UUID.randomUUID() + ".txt");
        if (probe == null) throw new IllegalStateException("文件夹无法创建文件。");
        try {
            byte[] bytes = "COC archive write check".getBytes(StandardCharsets.UTF_8);
            try (OutputStream output = getContext().getContentResolver().openOutputStream(probe, "w")) {
                if (output == null) throw new IllegalStateException("文件夹不可写。");
                output.write(bytes);
            }
            if (!Arrays.equals(bytes, read(probe))) throw new IllegalStateException("文件夹回读校验失败。");
        } finally { DocumentsContract.deleteDocument(getContext().getContentResolver(), probe); }
    }
    private JSObject location(boolean verify) {
        JSObject out = new JSObject(); String uri = prefs().getString("tree", "");
        boolean valid = !uri.isEmpty();
        if (valid && verify) try { verifyWritable(Uri.parse(uri)); } catch (Exception error) { valid = false; }
        out.put("uri", uri); out.put("label", prefs().getString("label", "尚未选择")); out.put("valid", valid);
        return out;
    }
    private JSObject storageUsage() {
        JSObject result=new JSObject();java.io.File db=getContext().getDatabasePath("coc-logbook.sqlite");long physical=0;
        for(String suffix:new String[]{"","-wal","-shm"})physical+=new java.io.File(db.getPath()+suffix).length();
        result.put("logicalBytes",database.logicalBytes());result.put("databaseBytes",physical);
        try{result.put("availableBytes",StorageBudget.volume(db.getParentFile()).bytes());}catch(Exception unavailable){/* Read access remains available. */}
        return result;
    }
    @PluginMethod public void getState(PluginCall call) {
        execute(() -> {
            try {
                JSObject out = new JSObject(); String json = database.snapshot();
                out.put("bodySearchStreamVersion",1);out.put("backupStreamVersion",1);out.put("tableStreamVersion",1);out.put("json", json == null ? JSONObject.NULL : json); out.put("revision", database.revision());
                ConnectivityManager connectivity = (ConnectivityManager)getContext().getSystemService(android.content.Context.CONNECTIVITY_SERVICE);
                out.put("networkConnected", connectivity.getActiveNetwork() != null);
                out.put("lastAutoBackupAt", prefs().getLong("last-auto-backup", 0));
                if (prefs().contains("last-auto-backup-revision")) out.put("lastAutoBackupRevision",prefs().getLong("last-auto-backup-revision",-1));
                out.put("archive", location(true)); call.resolve(out);
            } catch (OutOfMemoryError error) { call.reject("读取内存不足；原数据未改变，请按场次读取。"); }
              catch (Exception error) { call.reject("读取失败；未清空数据。", error); }
        });
    }
    /** Cold-start overview: no log bodies cross the bridge and no archive probe file is created. */
    @PluginMethod public void getOverview(PluginCall call) {
        execute(() -> {
            try {
                long revision = database.revision();
                java.util.Map<String,String> fields = database.fields();
                JSObject out = new JSObject();
                if (fields == null) { out.put("json",JSONObject.NULL); out.put("deferredRecordIds",new JSONArray()); }
                else {
                    out.put("json",JsonFields.join(fields)); out.put("deferredRecordIds",database.deferred());
                }
                if (database.revision() != revision) throw new IllegalStateException("数据已变化，请重新读取。");
                out.put("revision",revision);
                ConnectivityManager connectivity = (ConnectivityManager)getContext().getSystemService(android.content.Context.CONNECTIVITY_SERVICE);
                out.put("networkConnected",connectivity.getActiveNetwork() != null);
                out.put("bodySearchStreamVersion",1);out.put("backupStreamVersion",1);out.put("tableDeltaVersion",1);out.put("tableStreamVersion",1);out.put("storageUsage",storageUsage());
                out.put("lastAutoBackupAt",prefs().getLong("last-auto-backup",0));
                if (prefs().contains("last-auto-backup-revision")) out.put("lastAutoBackupRevision",prefs().getLong("last-auto-backup-revision",-1));
                JSObject archive = location(false);
                try { requireArchivePermission(prefs().getString("tree","")); }
                catch (Exception error) { archive.put("valid",false); }
                out.put("archive",archive); call.resolve(out);
                if (archive.optBoolean("valid")) warmArchiveNames();
            } catch (OutOfMemoryError error) { call.reject("列表所需内存不足；原数据未改变，请关闭其他应用后重试。"); }
              catch (Exception error) { call.reject("读取列表失败；原数据未清空。",error); }
        });
    }
    /** Read selected committed bodies at an exact revision; no writes or external file access. */
    @PluginMethod public void getRecordContent(PluginCall call) {
        execute(() -> {
            try {
                JSONObject view = selectedContent(call);
                JSObject out = new JSObject(); out.put("json",view.getString("json")); out.put("revision",view.getLong("revision")); call.resolve(out);
            } catch (OutOfMemoryError error) { call.reject("所选正文内存不足；原数据未改变，请减少读取场次。"); }
              catch (Exception error) { call.reject("正文读取失败；原数据未改变。",error); }
        });
    }
    /** The same exact-revision projection backs both reader responses and immutable export sources. */
    private JSONObject selectedContent(PluginCall call) throws Exception {
                // Small JS revisions arrive as Integer; PluginCall.getLong only accepts boxed Long.
                Long expected = call.getData().has("expectedRevision") ? call.getData().getLong("expectedRevision") : null;
                if (expected == null || database.revision() != expected) throw new IllegalStateException("数据已变化，请重新读取。");
                JSONArray ids = call.getArray("ids"); java.util.Set<String> selected = new java.util.HashSet<>();
                if (ids == null || ids.length() == 0) throw new IllegalArgumentException("请选择场次。");
                for (int i=0;i<ids.length();i++) if (!selected.add(ids.getString(i))) throw new IllegalArgumentException("场次选择重复。");
                java.util.Map<String,String> fields = database.fields();
                if (fields == null) throw new IllegalStateException("尚无已保存数据。");
                java.io.StringWriter writer=new java.io.StringWriter();database.writeSnapshot(writer,selected);
                JSONObject view = new JSONObject().put("json",writer.toString());
                if (database.revision() != expected) throw new IllegalStateException("数据已变化，请重新读取。");
                view.put("revision",expected); return view;
    }
    /** No large JSON string crosses the UI bridge; only this app's own immutable cache URI is returned. */
    @PluginMethod public void createExportSource(PluginCall call) {
        execute(() -> {
            try {
                Long expected = call.getData().has("expectedRevision") ? call.getData().getLong("expectedRevision") : null;
                if (expected == null || database.revision() != expected) throw new IllegalStateException("数据已变化，请重新读取。");
                JSONArray ids = call.getArray("ids"); java.util.Set<String> selected = new java.util.HashSet<>();
                if (ids == null || ids.length() == 0) throw new IllegalArgumentException("请选择场次。");
                for (int i=0;i<ids.length();i++) if(!selected.add(ids.getString(i))) throw new IllegalArgumentException("场次选择重复。");
                java.util.Map<String,String> fields = database.fields();
                if (fields == null) throw new IllegalStateException("尚无已保存数据。");
                if (readLease == null) readLease = new ReadLease(new java.io.File(getContext().getCacheDir(), "export-read-sources"));
                ReadLease.Value value = readLease.create(writer -> database.writeSnapshot(writer,selected),expected);
                if(database.revision()!=expected){readLease.release(value.id);throw new IllegalStateException("数据已变化，请重新读取。");}
                database.releaseReadCache();
                JSObject result = new JSObject(); result.put("id",value.id); result.put("fileUri",Uri.fromFile(value.file).toString());
                result.put("bytes",value.bytes); result.put("sha256",value.sha256); result.put("revision",value.revision); call.resolve(result);
            } catch (OutOfMemoryError error) { database.releaseReadCache(); call.reject("正文读取内存不足；原数据未改变，请重试。"); }
            catch (Exception error) { call.reject("导出正文读取失败；原数据未改变：" + error.getMessage(),error); }
        });
    }
    @PluginMethod public void releaseExportSource(PluginCall call) {
        execute(() -> {
            try { if (readLease != null) readLease.release(call.getString("id","")); call.resolve(); }
            catch (Exception error) { call.reject(error.getMessage(),error); }
        });
    }
    /** Resume checks metadata/grants without transferring or validating all log bodies again. */
    @PluginMethod public void getStatus(PluginCall call) {
        execute(() -> {
            try {
                JSObject out = new JSObject(); out.put("revision", database.revision());out.put("storageUsage",storageUsage());out.put("bodySearchStreamVersion",1);out.put("backupStreamVersion",1);
                JSObject archive = location(false);
                try { requireArchivePermission(prefs().getString("tree", "")); }
                catch (Exception error) { archive.put("valid", false); }
                out.put("archive", archive); out.put("lastAutoBackupAt", prefs().getLong("last-auto-backup", 0));
                if (prefs().contains("last-auto-backup-revision")) out.put("lastAutoBackupRevision",prefs().getLong("last-auto-backup-revision",-1));
                call.resolve(out);
                if (archive.optBoolean("valid")) warmArchiveNames();
            } catch (Exception error) { call.reject("状态检查失败；未清空数据。", error); }
        });
    }
    @PluginMethod public void selectArchive(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, intent, "archiveChosen");
    }
    @ActivityCallback private void archiveChosen(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            JSObject out = new JSObject(); out.put("cancelled", true); call.resolve(out); return;
        }
        execute(() -> {
            try {
                Uri tree = result.getData().getData(); validateTree(tree);
                int flags = result.getData().getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                if (flags != (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION)) throw new IllegalStateException("需要文件夹读写授权。");
                getContext().getContentResolver().takePersistableUriPermission(tree, flags);
                verifyWritable(tree);
                Uri document = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
                if (!prefs().edit().putString("tree", tree.toString()).putString("label", displayName(document)).commit()) throw new IllegalStateException("保存目录授权失败。");
                JSObject out = new JSObject(); out.put("cancelled", false); out.put("archive", location(false)); call.resolve(out);
            } catch (Exception error) { call.reject("目录未配置成功：" + error.getMessage(), error); }
        });
    }
    /** Build the system picker contract; Android 9 reports CSV as text/comma-separated-values. */
    static Intent importDocumentIntent(String kind) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("*/*").addCategory(Intent.CATEGORY_OPENABLE);
        intent.putExtra(Intent.EXTRA_MIME_TYPES, kind.equals("backup")
            ? new String[]{"application/json", "application/zip", "application/octet-stream", "text/plain"}
            : new String[]{"text/csv","text/comma-separated-values","application/vnd.ms-excel","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","application/octet-stream"});
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        return intent;
    }
    @PluginMethod public void openBackup(PluginCall call) {
        if(importPickerPending||backupSession!=null||tableSession!=null||fetchBatch!=null||snapshotUpload!=null&&snapshotUpload.active()){call.reject("已有文件或批量任务，请先结束当前任务。");return;}
        importPickerPending=true;
        try{startActivityForResult(call, importDocumentIntent(call.getString("kind", "backup")), "backupChosen");}
        catch(RuntimeException error){importPickerPending=false;call.reject("无法打开文件选择器。",error);}
    }
    @ActivityCallback private void backupChosen(PluginCall call, ActivityResult result) {
        importPickerPending=false;
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            JSObject out = new JSObject(); out.put("cancelled", true); call.resolve(out); return;
        }
        execute(() -> {
            try {
                Uri document = result.getData().getData();
                if(Boolean.TRUE.equals(call.getBoolean("stream",false))&&"backup".equals(call.getString("kind","backup"))){
                    openRestoreStream(call,document);return;
                }
                if(Boolean.TRUE.equals(call.getBoolean("stream",false))&&Arrays.asList("record-table","character-table").contains(call.getString("kind",""))){
                    openTableStream(call,document);return;
                }
                byte[] bytes = read(document);
                JSObject out = new JSObject(); out.put("cancelled", false); out.put("name", displayName(document));
                out.put("base64", Base64.encodeToString(bytes, Base64.NO_WRAP)); call.resolve(out);
            } catch (OutOfMemoryError error) { call.reject("手机可用内存不足以读取此文件；未写入数据。"); }
              catch (Exception error) { call.reject("备份读取失败；未写入数据。", error); }
        });
    }
    private TableSession tableOwner(PluginCall call)throws Exception{
        TableSession owner=tableSession;if(owner==null)throw new IllegalStateException("表格预览已失效，请重新选择。");owner.require(call.getString("id",""));return owner;
    }
    private void checkTableLocation(TableSession owner)throws Exception{
        if(!owner.tree.equals(prefs().getString("tree","")))throw new IllegalStateException("保存位置已变化，请重新选择表格。");
        requireArchivePermission(owner.tree);
        if(database.revision()!=owner.revision)throw new IllegalStateException("数据已变化，请重新预览；原数据保留。");
    }
    private void rejectTable(PluginCall call,TableSession owner,Throwable error){
        String cleanup="";
        if(owner!=null&&tableSession==owner)try{owner.close();tableSession=null;}catch(Exception failure){error.addSuppressed(failure);cleanup=" 私有暂存清理失败，请重开应用后重试。";}
        call.reject("表格操作未完成："+(error instanceof OutOfMemoryError?"手机可用内存不足；原数据未改变。":error.getMessage())+cleanup,error instanceof Exception?(Exception)error:new IllegalStateException("表格处理内存不足。",error));
    }
    private void openTableStream(PluginCall call,Uri document){
        TableSession owner=null;try{
            if(tableSession!=null||backupSession!=null||fetchBatch!=null||snapshotUpload!=null&&snapshotUpload.active())throw new IllegalStateException("已有文件或批量任务，请先结束当前任务。");
            long revision=backupExpected(call);if(revision!=database.revision())throw new IllegalStateException("数据已变化，请重新选择。");
            String tree=prefs().getString("tree","");requireArchivePermission(tree);
            owner=new TableSession(new java.io.File(getContext().getCacheDir(),"table-stream-staging"),tree,revision,call.getString("kind",""),displayName(document),null);tableSession=owner;
            BackupSession.Proof proof;try(InputStream input=getContext().getContentResolver().openInputStream(document)){proof=owner.capture(input);}
            checkTableLocation(owner);JSObject source=new JSObject();source.put("id",owner.id);source.put("revision",revision);source.put("fileUri",Uri.fromFile(owner.source).toString());source.put("name",owner.name);source.put("format",owner.format);source.put("bytes",proof.bytes);source.put("sha256",proof.sha256);source.put("maximumStageBytes",owner.maximumStageBytes);
            JSObject out=new JSObject();out.put("cancelled",false);out.put("tableSource",source);call.resolve(out);
        }catch(Exception|OutOfMemoryError error){rejectTable(call,owner,error);}
    }
    @PluginMethod public void appendTableStage(PluginCall call){
        execute(()->{TableSession owner=null;try{
            owner=tableOwner(call);checkTableLocation(owner);String encoded=call.getString("base64","");
            if(encoded.length()>349528)throw new IllegalArgumentException("表格分段参数无效。");
            owner.append(call.getString("key",""),TableSession.integer(call.getData().opt("index")),Base64.decode(encoded,Base64.DEFAULT));call.resolve();
        }catch(Exception|OutOfMemoryError error){rejectTable(call,owner,error);}});
    }
    @PluginMethod public void readTableString(PluginCall call){
        execute(()->{TableSession owner=null;try{
            owner=tableOwner(call);checkTableLocation(owner);call.resolve(new JSObject(owner.string(TableSession.integer(call.getData().opt("stringIndex")),TableSession.integer(call.getData().opt("offset"))).toString()));
        }catch(Exception|OutOfMemoryError error){rejectTable(call,owner,error);}});
    }
    @PluginMethod public void finishTablePreview(PluginCall call){
        execute(()->{TableSession owner=null;try{
            owner=tableOwner(call);checkTableLocation(owner);JSONObject proof=call.getObject("candidate");if(proof==null)throw new IllegalArgumentException("表格候选证明缺失。");
            JSONObject preview=owner.preview(database,BackupSession.requestProof(proof),emptySnapshot().getJSONObject("settings"));checkTableLocation(owner);call.resolve(new JSObject(preview.toString()));
        }catch(Exception|OutOfMemoryError error){rejectTable(call,owner,error);}});
    }
    @PluginMethod public void readTablePreview(PluginCall call){
        execute(()->{TableSession owner=null;try{
            owner=tableOwner(call);checkTableLocation(owner);long limit=TableSession.integer(call.getData().opt("limit"));
            call.resolve(new JSObject(owner.page(call.getString("kind",""),TableSession.integer(call.getData().opt("offset")),(int)Math.min(limit,100)).toString()));
        }catch(Exception|OutOfMemoryError error){rejectTable(call,owner,error);}});
    }
    @PluginMethod public void commitTableStream(PluginCall call){
        execute(()->{TableSession owner=null;boolean committed=false;try{
            owner=tableOwner(call);if(!Boolean.TRUE.equals(call.getBoolean("confirmed",false)))throw new IllegalStateException("请确认表格导入预览。");
            checkTableLocation(owner);owner.prepareCommit();checkTableLocation(owner);final TableSession candidate=owner;
            long revision=database.edit(owner.revision,store->{checkTableLocation(candidate);candidate.apply(store);checkTableLocation(candidate);});committed=true;
            JSObject out=new JSObject();out.put("revision",revision);
            try{owner.close();tableSession=null;}catch(Exception cleanup){out.put("warning","表格已导入，但私有暂存关闭失败；请重开应用，勿重复导入。");}
            call.resolve(out);
        }catch(Exception|OutOfMemoryError error){if(committed)call.reject("表格已导入，但返回确认失败；请重新读取数据，勿重复导入。");else rejectTable(call,owner,error);}});
    }
    @PluginMethod public void cancelTableStage(PluginCall call){
        execute(()->{try{if(tableSession!=null&&tableSession.id.equals(call.getString("id",""))){tableSession.close();tableSession=null;}call.resolve();}
        catch(Exception|OutOfMemoryError error){call.reject("表格私有暂存清理失败；原数据未改变。",error instanceof Exception?(Exception)error:new IllegalStateException(error));}});
    }
    private long backupExpected(PluginCall call)throws Exception{
        Object raw=call.getData().opt("expectedRevision");
        if(!(raw instanceof Number))throw new IllegalArgumentException("备份版本参数无效。");
        double value=((Number)raw).doubleValue();
        if(!Double.isFinite(value)||value<0||value>=StorageBudget.JS_SAFE_INTEGER||value!=Math.floor(value))throw new IllegalArgumentException("备份版本参数无效。");
        return (long)value;
    }
    private BackupSession backupOwner(PluginCall call)throws Exception{
        BackupSession owner=backupSession;if(owner==null)throw new IllegalStateException("备份租约已失效，请重新选择。");owner.require(call.getString("id",""));return owner;
    }
    private void checkBackupLocation(BackupSession owner,boolean revision)throws Exception{
        if(!owner.tree.equals(prefs().getString("tree","")))throw new IllegalStateException("保存位置已变化，请重新选择备份。");
        requireArchivePermission(owner.tree);
        if(revision&&owner.revision!=database.revision())throw new IllegalStateException("数据已变化，请重新预览；原数据保留。");
    }
    private void rejectBackup(PluginCall call,BackupSession owner,Throwable error){
        String cleanup="";
        if(owner!=null&&backupSession==owner)try{owner.close();backupSession=null;}catch(Exception failure){error.addSuppressed(failure);cleanup=" 私有暂存清理失败，请重开后重试。";}
        call.reject("备份操作未完成："+(error instanceof OutOfMemoryError?"处理本场正文内存不足；原数据未改变。":error.getMessage())+cleanup,error instanceof Exception?(Exception)error:new IllegalStateException("处理本场正文内存不足。",error));
    }
    private JSObject backupFileReply(BackupSession owner,String key)throws Exception{
        BackupSession.Proof proof=owner.proof(key);JSObject result=new JSObject();
        result.put("fileUri",Uri.fromFile(owner.file(key)).toString());result.put("bytes",proof.bytes);result.put("sha256",proof.sha256);return result;
    }
    private void openRestoreStream(PluginCall call,Uri document)throws Exception{
        BackupSession owner=null;
        try{
            if(backupSession!=null||tableSession!=null||importPickerPending)throw new IllegalStateException("已有文件任务，请先关闭预览。");
            long revision=backupExpected(call);if(revision!=database.revision())throw new IllegalStateException("数据已变化，请重新选择。");
            String tree=prefs().getString("tree","");requireArchivePermission(tree);
            owner=new BackupSession(new java.io.File(getContext().getCacheDir(),"backup-stream-staging"),tree,revision,true,false);
            backupSession=owner;
            try(InputStream input=getContext().getContentResolver().openInputStream(document)){
                if(input==null)throw new IllegalStateException("无法读取所选备份。");owner.capture("source",input,-1,null);
            }
            checkBackupLocation(owner,true);
            JSObject source=backupFileReply(owner,"source");source.put("id",owner.id);source.put("revision",revision);source.put("maximumStageBytes",owner.beginOutput());
            try(InputStream input=new java.io.FileInputStream(owner.file("source"))){source.put("format",input.read()==0x50&&input.read()==0x4b?"zip":"json");}
            JSObject out=new JSObject();out.put("cancelled",false);out.put("name",displayName(document));out.put("source",source);call.resolve(out);
        }catch(Exception|OutOfMemoryError error){rejectBackup(call,owner,error);}
    }
    @PluginMethod public void appendBackupStage(PluginCall call){
        execute(()->{BackupSession owner=null;try{
            owner=backupOwner(call);checkBackupLocation(owner,owner.restoring);
            String encoded=call.getString("base64","");Integer index=call.getInt("index");
            if(index==null||encoded.length()>349528)throw new IllegalArgumentException("备份分段参数无效。");
            owner.append(call.getString("key",""),index,Base64.decode(encoded,Base64.DEFAULT));call.resolve();
        }catch(Exception|OutOfMemoryError error){rejectBackup(call,owner,error);}});
    }
    @PluginMethod public void finishBackupPreview(PluginCall call){
        execute(()->{BackupSession owner=null;try{
            owner=backupOwner(call);checkBackupLocation(owner,true);
            JSObject candidate=call.getObject("candidate");JSONArray selected=call.getArray("attachments");
            if(candidate==null||selected==null)throw new IllegalArgumentException("恢复候选证明缺失。");
            BackupSession.Proof source=owner.proof("source");owner.verify("source",source.bytes,source.sha256);
            owner.previewRestore(BackupSession.requestProof(candidate),selected);
            JSObject out=new JSObject();out.put("id",owner.id);out.put("revision",owner.revision);out.put("offlineRecords",owner.restorePreview.offlineRecords);call.resolve(out);
        }catch(Exception|OutOfMemoryError error){rejectBackup(call,owner,error);}});
    }
    @PluginMethod public void cancelBackupStage(PluginCall call){
        execute(()->{try{
            if(backupSession!=null&&backupSession.id.equals(call.getString("id",""))){backupSession.close();backupSession=null;}
            call.resolve();
        }catch(Exception|OutOfMemoryError error){call.reject("私有备份暂存清理失败；原数据未改变。",error instanceof Exception?(Exception)error:new IllegalStateException("私有暂存清理内存不足。",error));}});
    }
    private void removeNewImport(JSObject saved)throws Exception{
        String uri=saved.getString("uri"),hash=saved.getString("sha256");long bytes=saved.getLong("bytes");
        JSONObject registered=archives.find(uri,prefs().getString("created-documents","[]"));
        if(registered==null||!"import".equals(registered.optString("purpose"))||!hash.equals(registered.optString("sha256")))throw new IllegalStateException("本次新附件登记已变化，已保留。");
        try(InputStream input=getContext().getContentResolver().openInputStream(Uri.parse(uri))){BackupSession.streamProof(input,bytes).matches(bytes,hash);}
        if(!DocumentsContract.deleteDocument(getContext().getContentResolver(),Uri.parse(uri)))throw new IllegalStateException("本次新附件无法清理，已保留。");
        archives.forgetImported(uri,hash,prefs().getString("created-documents","[]"));
    }
    @PluginMethod public void commitBackupRestore(PluginCall call){
        execute(()->{BackupSession owner=null;java.util.List<JSObject> imported=new java.util.ArrayList<>();boolean committed=false;try{
            owner=backupOwner(call);owner.requireReady();
            if(!owner.restoring||owner.restorePreview==null||!Boolean.TRUE.equals(call.getBoolean("confirmed",false)))throw new IllegalStateException("需要明确确认完整覆盖。");
            checkBackupLocation(owner,true);
            long required=Math.addExact(StorageBudget.estimate(owner.restorePreview.bytes,6),StorageBudget.estimate(database.logicalBytes(),2));
            StorageBudget.require(owner.available,required);
            BackupSession.Proof source=owner.proof("source");owner.verify("source",source.bytes,source.sha256);
            for(BackupSession.Attachment file:owner.attachments){
                owner.verify(file.key,file.proof.bytes,file.proof.sha256);
                imported.add(publishArchive(owner.file(file.key),owner.tree,file.name,file.mime,"import",file.proof.bytes,file.proof.sha256));
            }
            checkBackupLocation(owner,true);
            RestoreCandidate.Preview preview=owner.restorePreview;
            try(java.io.FileInputStream input=new java.io.FileInputStream(owner.file("candidate"))){
                RestoreCandidate.inspect(input,preview.bytes,preview.sha256,null);input.getChannel().position(0);
                final BackupSession authorizationOwner=owner;
                owner.close();backupSession=null;
                long revision=database.restoreCandidate(input,preview,owner.revision,Boolean.TRUE.equals(call.getBoolean("restoreSettings",false)),emptySnapshot().getJSONObject("settings").toString(),()->checkBackupLocation(authorizationOwner,true));
                committed=true;JSObject out=new JSObject();out.put("revision",revision);call.resolve(out);
            }
        }catch(Exception|OutOfMemoryError error){
            if(committed){call.reject("完整恢复已提交，但返回确认失败；请重新读取数据，勿重复导入。");return;}
            String cleanup="";
            if(!committed)for(JSObject file:imported)try{removeNewImport(file);}catch(Exception failure){error.addSuppressed(failure);cleanup=" 部分本次新附件无法清理或已变化，已保留；原业务库未覆盖。";}
            Throwable failure=cleanup.isEmpty()?error:new IllegalStateException(error.getMessage()+cleanup,error);
            rejectBackup(call,owner,failure);
        }});
    }
    @PluginMethod public void createSearchSource(PluginCall call){
        execute(()->{BackupSession owner=null;try{
            if(backupSession!=null||tableSession!=null||importPickerPending)throw new IllegalStateException("已有文件读取任务，请稍候。");
            long revision=backupExpected(call);if(revision!=database.revision())throw new IllegalStateException("数据已变化，请重新读取。");
            JSONArray requested=call.getArray("ids");Set<String> ids=new java.util.LinkedHashSet<>();
            if(requested==null||requested.length()==0)throw new IllegalArgumentException("搜索场次无效。");
            for(int index=0;index<requested.length();index++){Object id=requested.get(index);if(!(id instanceof String)||!ids.add((String)id))throw new IllegalArgumentException("搜索场次重复或类型无效。");}
            database.projectedBytes(ids);
            owner=new BackupSession(new java.io.File(getContext().getCacheDir(),"backup-stream-staging"),"",revision,false,false,true,null);backupSession=owner;
            owner.captureJson(writer->{
                writer.write("{\"format\":\"coc.logbook.android\",\"formatVersion\":1,\"exportedAt\":"+JSONObject.quote(java.time.Instant.now().toString())+",\"restoreScope\":[\"modules\",\"records\",\"characters\"],\"snapshot\":");
                database.writeSnapshot(writer,ids);writer.write('}');
            });
            android.app.ActivityManager.MemoryInfo memory=new android.app.ActivityManager.MemoryInfo();((android.app.ActivityManager)getContext().getSystemService(android.content.Context.ACTIVITY_SERVICE)).getMemoryInfo(memory);
            long cacheMemory=memory.lowMemory?0:Math.max(0,Math.min(memory.availMem/8,Runtime.getRuntime().maxMemory()/4));
            long maximumRead=memory.lowMemory?0:Math.max(0,Math.min(memory.availMem/16,Runtime.getRuntime().maxMemory()/8));
            // The immutable search source is not an export or restore candidate.
            // The Worker validates every record, graph, duplicate key and complete
            // source proof before publishing hits; avoid doing that semantic pass twice.
            if(database.revision()!=revision)throw new IllegalStateException("搜索来源版本已变化。");
            JSObject result=new JSObject();result.put("id",owner.id);result.put("revision",revision);result.put("source",backupFileReply(owner,"source"));result.put("cacheMemoryBytes",cacheMemory);result.put("maximumReadBytes",maximumRead);call.resolve(result);
        }catch(Exception|OutOfMemoryError error){rejectBackup(call,owner,error);}});
    }
    @PluginMethod public void createBackupStream(PluginCall call){
        execute(()->{BackupSession owner=null;try{
            if(backupSession!=null||tableSession!=null||importPickerPending)throw new IllegalStateException("已有文件任务，请先关闭预览。");
            long revision=backupExpected(call);if(revision!=database.revision())throw new IllegalStateException("数据已变化，请重新读取。");
            String tree=prefs().getString("tree","");requireArchivePermission(tree);
            boolean include=Boolean.TRUE.equals(call.getBoolean("includeArchives",false));
            owner=new BackupSession(new java.io.File(getContext().getCacheDir(),"backup-stream-staging"),tree,revision,false,include);backupSession=owner;
            owner.captureJson(writer->{
                writer.write("{\"format\":\"coc.logbook.android\",\"formatVersion\":1,\"exportedAt\":"+JSONObject.quote(java.time.Instant.now().toString())+",\"restoreScope\":[\"modules\",\"records\",\"characters\"],\"snapshot\":");
                if(database.fields()==null)writer.write(emptySnapshot().toString());else database.writeSnapshot(writer,null);writer.write('}');
            });
            if(SnapshotBackupStream.validate(owner.file("source"))!=database.recordCount())throw new IllegalStateException("完整备份场次未取齐。");
            JSONArray files=new JSONArray();long total=0;
            if(include){JSONArray all=archives.list(true,prefs().getString("created-documents","[]"));
                for(int i=all.length()-1;i>=0;i--){JSONObject file=all.getJSONObject(i);String purpose=file.optString("purpose"),name=file.getString("name");
                    if(!purpose.equals("export")&&!purpose.equals("import")&&(!purpose.isEmpty()||name.matches("^(before-|auto-backup-|coc-android-backup-).*")))continue;
                    BackupSession.Proof proof=BackupSession.requestProof(file);total=Math.addExact(total,proof.bytes);
                    StorageBudget.require(owner.available,StorageBudget.estimate(proof.bytes,3));
                    String key="archive:"+files.length();
                    try(InputStream input=getContext().getContentResolver().openInputStream(Uri.parse(file.getString("uri")))){
                        if(input==null)throw new IllegalStateException("已登记归档附件缺失，不能省略。");owner.capture(key,input,proof.bytes,proof.sha256);
                    }
                    JSObject reference=backupFileReply(owner,key);reference.put("name",name);files.put(reference);
                }
            }
            checkBackupLocation(owner,true);JSObject source=backupFileReply(owner,"source");source.put("canonicalVersion",1);JSObject out=new JSObject();out.put("id",owner.id);out.put("revision",revision);out.put("source",source);out.put("files",files);out.put("maximumBytes",owner.beginOutput());call.resolve(out);
        }catch(Exception|OutOfMemoryError error){rejectBackup(call,owner,error);}});
    }
    @PluginMethod public void finishBackupExport(PluginCall call){
        execute(()->{BackupSession owner=null;try{
            owner=backupOwner(call);if(owner.restoring||owner.searching)throw new IllegalStateException("备份任务用途不符。");checkBackupLocation(owner,false);
            String key=owner.includeArchives?"output":"source";
            if(owner.includeArchives){JSObject value=call.getObject("proof");if(value==null)throw new IllegalArgumentException("完整ZIP证明缺失。");BackupSession.Proof proof=BackupSession.requestProof(value);owner.verify(key,proof.bytes,proof.sha256);}
            BackupSession.Proof proof=owner.proof(key);owner.verify(key,proof.bytes,proof.sha256);
            owner.verifySources();
            JSObject saved=publishArchive(owner.file(key),owner.tree,call.getString("name",""),owner.includeArchives?"application/zip":"application/json","backup",proof.bytes,proof.sha256);
            try{owner.close();backupSession=null;}catch(Exception cleanup){saved.put("warning","备份已完整保存，但私有暂存清理失败，请重开应用后重试。");}
            call.resolve(saved);
        }catch(Exception|OutOfMemoryError error){rejectBackup(call,owner,error);}});
    }
    private JSObject write(String name, String mime, byte[] bytes) throws Exception {
        return write(name, mime, bytes, "export");
    }
    private JSObject write(String name, String mime, byte[] bytes, String purpose) throws Exception {
        return write(name,mime,bytes,purpose,prefs().getString("tree", ""));
    }
    private JSObject write(String name, String mime, byte[] bytes, String purpose, String location) throws Exception {
        if (name.length() > 255 || name.isEmpty() || name.equals(".") || name.equals("..") || name.matches(".*[/\\\\\u0000-\u001f].*")) throw new IllegalArgumentException("文件名不合法。");
        if (location.isEmpty()) throw new IllegalStateException("请先选择并确认归档文件夹。");
        publications().recoverFor(location);
        java.io.File source = java.io.File.createTempFile("coc-direct-", ".part", directInputs());
        try {
            try (OutputStream output = new java.io.FileOutputStream(source)) { output.write(bytes); }
            return publishArchive(source,location,name,mime,purpose,bytes.length,digest(bytes));
        } finally { if (source.exists() && !source.delete()) throw new IllegalStateException("归档输入暂存清理失败。"); }
    }
    /** Shared publication boundary for direct writes, text/PDF streams and automatic backups. */
    private java.io.File archiveVolume(Uri tree)throws Exception{
        String authority=tree.getAuthority();
        if("com.android.providers.downloads.documents".equals(authority))return android.os.Environment.getExternalStorageDirectory();
        if(!"com.android.externalstorage.documents".equals(authority))throw new IllegalStateException("无法确认所选保存卷空间。");
        String document=DocumentsContract.getTreeDocumentId(tree);int colon=document.indexOf(':');
        String volume=colon<0?"":document.substring(0,colon);
        if("primary".equalsIgnoreCase(volume))return android.os.Environment.getExternalStorageDirectory();
        android.os.storage.StorageManager manager=(android.os.storage.StorageManager)getContext().getSystemService(android.content.Context.STORAGE_SERVICE);
        for(java.io.File directory:getContext().getExternalFilesDirs(null))if(directory!=null){
            android.os.storage.StorageVolume mounted=manager.getStorageVolume(directory);
            if(mounted!=null&&mounted.getUuid()!=null&&mounted.getUuid().equalsIgnoreCase(volume))return directory;
        }
        throw new IllegalStateException("所选存储卷不可用或无法核对空间，请重新选择本机位置。");
    }
    private JSObject publishArchive(java.io.File source, String location, String name, String mime, String purpose, long size, String hash) throws Exception {
        boolean backup=purpose.equals("backup")||purpose.equals("auto");
        if(name==null||name.isEmpty()||name.equals(".")||name.equals("..")||name.length()>255||name.matches(".*[/\\\\\u0000-\u001f].*")||size<0||size>StorageBudget.JS_SAFE_INTEGER)throw new IllegalArgumentException("归档名称或文件计量无效。");
        if (!location.equals(prefs().getString("tree", ""))) throw new IllegalStateException("归档位置已变化，请重新导出。");
        requireArchivePermission(location); Uri tree = Uri.parse(location); validateTree(tree);
        java.io.File targetVolume=archiveVolume(tree),privateVolume=getContext().getFilesDir();
        android.os.storage.StorageManager manager=(android.os.storage.StorageManager)getContext().getSystemService(android.content.Context.STORAGE_SERVICE);
        boolean sameVolume=manager.getUuidForPath(targetVolume).equals(manager.getUuidForPath(privateVolume));
        StorageBudget.require(StorageBudget.volume(targetVolume),StorageBudget.estimate(size,1));
        StorageBudget.require(StorageBudget.volume(privateVolume),StorageBudget.estimate(size,sameVolume?2:1));
        ArchivePublication recovery = publications(); recovery.recoverFor(location);
        Uri destination = createNamedDocument(tree,mime,name);
        if (destination == null) throw new IllegalStateException("无法创建归档文件。");
        JSONObject ticket = null; boolean success = false;
        try {
            ticket = recovery.begin(source,destination.toString(),location,size,hash,purpose);
            String savedName = displayName(destination);
            if (savedName.isEmpty() || savedName.equals("已选择的文件夹")) throw new IllegalStateException("无法确认新文件名称。");
            try (InputStream input = new java.io.FileInputStream(source); OutputStream output = getContext().getContentResolver().openOutputStream(destination,"w")) {
                if (output == null) throw new IllegalStateException("文件夹不可写。");
                byte[] chunk = new byte[32768]; int n;long written=0,checkedAt=0;
                while ((n = input.read(chunk)) != -1){
                    if(written+n>size)throw new IllegalStateException("归档来源长度已变化。");
                    if(written-checkedAt>=4L*1024*1024){StorageBudget.require(StorageBudget.volume(targetVolume),Math.min(4L*1024*1024,size-written));checkedAt=written;}
                    output.write(chunk,0,n);written+=n;
                }
                if(written!=size)throw new IllegalStateException("归档来源不完整。");
            }
            MessageDigest digest = MessageDigest.getInstance("SHA-256"); long readSize = 0;
            try (InputStream input = getContext().getContentResolver().openInputStream(destination)) {
                if (input == null) throw new IllegalStateException("无法回读归档。");
                byte[] chunk = new byte[32768]; int n;
                while ((n = input.read(chunk)) != -1) { readSize += n; if (readSize > size) throw new IllegalStateException("归档回读长度已变化。"); digest.update(chunk,0,n); }
            }
            StringBuilder backHash = new StringBuilder(); for (byte b : digest.digest()) backHash.append(String.format("%02x",b&255));
            if (readSize != size || !hash.equals(backHash.toString())) throw new IllegalStateException("归档保存回读校验失败。");
            if (!location.equals(prefs().getString("tree", ""))) throw new IllegalStateException("归档位置已变化，未登记当前文件。");
            requireArchivePermission(location);
            StorageBudget.require(StorageBudget.volume(targetVolume),0);StorageBudget.require(StorageBudget.volume(privateVolume),0);
            JSObject result = new JSObject(); result.put("uri",destination.toString()); result.put("name",savedName);
            result.put("bytes",readSize); result.put("sha256",hash); result.put("purpose",purpose);
            rememberDocument(result,mime,ticket.getString("id")); success = true;
            try{recovery.committed(ticket);}catch(Exception cleanup){result.put("warning","文件已完整保存，但发布暂存清理未完成；下次打开将重试清理。");}
            return result;
        } finally {
            if (!success) {
                if (ticket != null) recovery.abort(ticket);
                else if (!knownPublication(destination.toString()) && !DocumentsContract.deleteDocument(getContext().getContentResolver(),destination))
                    throw new IllegalStateException("新文件清理失败，请检查所选目录；已有文件未覆盖。");
            }
        }
    }
    /** Read-only prefetch after the overview/status reply; never blocks readiness, edits or welcome claims. */
    private void warmArchiveNames() {
        String location = prefs().getString("tree", "");
        if (!"com.android.externalstorage.documents".equals(Uri.parse(location).getAuthority())) return;
        try { backupWriter.execute(() -> {
            try {
                requireArchivePermission(location); Uri tree = Uri.parse(location); validateTree(tree);
                synchronized (namingLock) {
                    if (location.equals(prefs().getString("tree", ""))) readArchiveNames(tree,android.os.SystemClock.elapsedRealtime());
                }
            } catch (Exception ignored) { /* A real publication still verifies grants and retries the directory query. */ }
        }); } catch (java.util.concurrent.RejectedExecutionException ignored) { /* Owner is already leaving. */ }
    }
    /** Called only under namingLock; the original thirty-second lifetime is never extended by prefetch hits. */
    private void readArchiveNames(Uri tree, long now) throws Exception {
        boolean reusable = "com.android.externalstorage.documents".equals(tree.getAuthority());
        if (reusable && namingNames != null && tree.toString().equals(namingLocation) && now - namingReadAt < 30000) return;
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree,DocumentsContract.getTreeDocumentId(tree));
        Set<String> names = new HashSet<>();
        try (Cursor cursor = getContext().getContentResolver().query(children,new String[]{DocumentsContract.Document.COLUMN_DISPLAY_NAME},null,null,null)) {
            if (cursor == null) throw new IllegalStateException("无法检查已有文件，未覆盖任何文件。");
            while (cursor.moveToNext()) if (!cursor.isNull(0)) names.add(cursor.getString(0));
        }
        namingNames = names; namingLocation = tree.toString(); namingReadAt = now;
    }
    /** Reserve a NEW document under the naming lock; publication/copy stays outside it. */
    private Uri createNamedDocument(Uri tree, String mime, String requested) throws Exception {
        synchronized (namingLock) {
            try {
                readArchiveNames(tree,android.os.SystemClock.elapsedRealtime());
                String name = DocumentNames.available(namingNames,requested);
                Uri parent = DocumentsContract.buildDocumentUriUsingTree(tree,DocumentsContract.getTreeDocumentId(tree));
                Uri created = DocumentsContract.createDocument(getContext().getContentResolver(),parent,mime,name);
                if (created == null) namingNames = null;
                else namingNames.add(name);
                return created;
            } catch (Exception error) { namingNames = null; throw error; }
        }
    }
    @PluginMethod public void writeArchive(PluginCall call) {
        execute(() -> {
            try { call.resolve(write(call.getString("name", ""), call.getString("mime", "application/octet-stream"), Base64.decode(call.getString("base64", ""), Base64.DEFAULT), call.getString("purpose", "export"))); }
            catch (OutOfMemoryError error) { call.reject("手机可用内存不足，归档处理未完成，请检查归档列表。"); }
            catch (Exception error) { call.reject("保存失败：" + error.getMessage(), error); }
        });
    }
    /** PDF chunks stay in private cache; no entire PDF/Base64 crosses the bridge at once. */
    @PluginMethod public void beginPdfArchive(PluginCall call) {
        execute(() -> {
            try {
                String tree = prefs().getString("tree", ""); requireArchivePermission(tree); validateTree(Uri.parse(tree));
                publications().recoverFor(tree);
                if (pdfSpool == null) pdfSpool = new PdfSpool(new java.io.File(getContext().getCacheDir(), "pdf-exports"));
                if (textPdfJobs != null && textPdfJobId != null) throw new IllegalStateException("已有 PDF 正在导出。");
                JSObject result = new JSObject(); result.put("id", pdfSpool.begin(tree)); call.resolve(result);
            } catch (Exception error) { call.reject("PDF 暂存失败：" + error.getMessage(), error); }
        });
    }
    @PluginMethod public void appendPdfArchive(PluginCall call) {
        execute(() -> {
            try {
                String base64 = call.getString("base64", "");
                if (pdfSpool == null || base64.length() > 349528) throw new IllegalArgumentException("PDF 分段不合法。");
                pdfSpool.append(call.getString("id", ""), Base64.decode(base64, Base64.NO_WRAP)); call.resolve();
            } catch (Exception error) { call.reject("PDF 写入失败：" + error.getMessage(), error); }
        });
    }
    @PluginMethod public void cancelPdfArchive(PluginCall call) {
        String token = call.getString("id", "");
        if (textPdfJobs != null) textPdfJobs.requestCancel(token);
        execute(() -> {
            try { if (textPdfJobs != null) textPdfJobs.cancel(token); if (token.equals(textPdfJobId)) textPdfJobId = null; if (pdfSpool != null) pdfSpool.cancel(token); call.resolve(); }
            catch (Exception error) { call.reject("PDF 清理失败：" + error.getMessage(), error); }
        });
    }
    private String textPdfJobId;
    /** Starts native original-font rendering from the caller's sealed private UTF-8 spool. */
    @PluginMethod public void renderTextPdf(PluginCall call) {
        execute(() -> {
            try {
                if (pdfSpool == null) throw new IllegalStateException("PDF 正文暂存已失效。");
                if (textPdfJobs == null) textPdfJobs = new TextPdfJobs(new java.io.File(getContext().getCacheDir(), "text-pdf-exports"), new NativeTextPdf(getContext()));
                String id = call.getString("id", "");
                textPdfJobs.start(pdfSpool.take(id)); textPdfJobId = id; call.resolve();
            } catch (Exception error) { call.reject("PDF 排版启动失败：" + error.getMessage(), error); }
        });
    }
    /** A thread-safe snapshot, deliberately not queued behind rendering or file publication. */
    @PluginMethod public void getTextPdfProgress(PluginCall call) {
        try {
            if (textPdfJobs == null) throw new IllegalStateException("PDF 任务已失效。");
            TextPdfJobs.Status state = textPdfJobs.status(call.getString("id", ""));
            JSObject result = new JSObject(); result.put("stage", state.stage); result.put("pages", state.pages);
            result.put("total", state.total); result.put("error", state.error); call.resolve(result);
        } catch (Exception error) { call.reject(error.getMessage(), error); }
    }
    /** Publication is the commit point: unique new name, streaming copy/readback and registration. */
    @PluginMethod public void finishPdfArchive(PluginCall call) {
        finishExport(call, "application/pdf", true);
    }
    /** Text exports use the same bounded private spool, never a whole large Base64 bridge message. */
    @PluginMethod public void finishExportArchive(PluginCall call) {
        String mime = call.getString("mime", "");
        if (!Arrays.asList("application/json", "application/zip", "text/plain", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document").contains(mime)) {
            call.reject("不支持此导出类型。"); return;
        }
        finishExport(call, mime, false);
    }
    private void finishExport(PluginCall call, String mime, boolean pdf) {
        String purpose = pdf ? "export" : call.getString("purpose", "export");
        if (!Arrays.asList("export", "backup").contains(purpose)) { call.reject("文件用途不合法。"); return; }
        execute(() -> {
            try {
                if (pdfSpool == null) throw new IllegalStateException("PDF 暂存已失效。");
                PdfSpool.Publisher<JSObject> publisher = (source, location, name, size, hash) ->
                    publishArchive(source,location,name,mime,purpose,size,hash);
                String id = call.getString("id", ""), name = call.getString("name", "");
                if (pdf && textPdfJobs != null && textPdfJobs.owns(id)) {
                    try { call.resolve(textPdfJobs.finish(id, name, publisher)); }
                    finally { textPdfJobId = null; }
                } else call.resolve(pdfSpool.finish(id, name, pdf, publisher));
            } catch (Exception error) { call.reject("PDF 保存失败：" + error.getMessage(), error); }
        });
    }
    private synchronized void rememberDocument(JSObject file, String mime, String publicationId) throws Exception {
        JSONObject entry = new JSONObject(file.toString()); entry.put("mime", mime);
        archives.add(entry, prefs().getString("created-documents", "[]"), publicationId);
    }
    private JSONObject knownDocument(String uri) throws Exception {
        JSONObject item = archives.find(uri, prefs().getString("created-documents", "[]"));
        if (item != null) {
            long bytes=item.getLong("bytes");
            try(InputStream input=getContext().getContentResolver().openInputStream(Uri.parse(uri))){BackupSession.streamProof(input,bytes).matches(bytes,item.getString("sha256"));}
            return item;
        }
        throw new IllegalArgumentException("仅打开或分享本应用创建并校验的文件。");
    }
    @PluginMethod public void openDocument(PluginCall call) { launchDocument(call, false); }
    @PluginMethod public void readDocument(PluginCall call) {
        execute(() -> {
            try {
                String uri = call.getString("uri", ""); JSONObject file = knownDocument(uri);
                JSObject result = new JSObject(); result.put("name", file.getString("name")); result.put("mime", file.getString("mime"));
                result.put("base64", Base64.encodeToString(read(Uri.parse(uri)), Base64.NO_WRAP)); call.resolve(result);
            } catch (Exception error) { call.reject("读取归档文件失败。", error); }
        });
    }
    @PluginMethod public void listDocuments(PluginCall call) {
        execute(() -> {
        try {
            JSONArray all = archives.list(Boolean.TRUE.equals(call.getBoolean("all", false)), prefs().getString("created-documents", "[]"));
            JSONArray latest = new JSONArray();
            int limit = Boolean.TRUE.equals(call.getBoolean("all", false)) ? all.length() : 30;
            boolean metadataOnly = Boolean.TRUE.equals(call.getBoolean("all", false)) && Boolean.TRUE.equals(call.getBoolean("metadataOnly", false));
            for (int i = all.length() - 1; i >= Math.max(0, all.length() - limit); i--) {
                JSONObject item = all.getJSONObject(i);
                // Complete backup preflight is metadata-only. Its reader must reject missing/changed files, never omit them.
                if (metadataOnly) { latest.put(item); continue; }
                try (Cursor row = getContext().getContentResolver().query(Uri.parse(item.getString("uri")), new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
                    if (row != null && row.moveToFirst()) latest.put(item);
                } catch (Exception ignored) { }
            }
            JSObject result = new JSObject(); result.put("documents", latest); call.resolve(result);
        } catch (Exception error) { call.reject("读取归档登记失败。", error); }
        });
    }
    @PluginMethod public void shareDocument(PluginCall call) { launchDocument(call, true); }
    private void launchDocument(PluginCall call, boolean share) {
        execute(() -> {
            try {
                String uri = call.getString("uri", ""); JSONObject file = knownDocument(uri);
                Uri document = Uri.parse(uri);
                Intent intent = new Intent(share ? Intent.ACTION_SEND : Intent.ACTION_VIEW);
                if (share) { intent.setType(file.getString("mime")); intent.putExtra(Intent.EXTRA_STREAM, document); }
                else intent.setDataAndType(document, file.getString("mime"));
                intent.setClipData(ClipData.newRawUri(file.getString("name"), document));
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                getActivity().runOnUiThread(() -> {
                    try { getActivity().startActivity(Intent.createChooser(intent, share ? "分享文件" : "打开文件")); call.resolve(); }
                    catch (Exception error) { call.reject("没有可处理此文件的应用。", error); }
                });
            } catch (Exception error) { call.reject("文件操作失败：" + error.getMessage(), error); }
        });
    }
    @PluginMethod public void fetchLog(PluginCall call) {
        networkQueue.execute(() -> {
            try {
                URL url = new URL(call.getString("url", ""));
                if (!"https".equals(url.getProtocol()) || !"dice-api.weizaima.com".equals(url.getHost()) ||
                    !"/dice/api/load_data".equals(url.getPath()) || url.getUserInfo() != null || url.getPort() != -1)
                    throw new IllegalArgumentException("不支持此日志请求。");
                for (int redirect = 0; redirect < 4; redirect++) {
                    if (!"https".equals(url.getProtocol()) || !Arrays.asList("dice-api.weizaima.com","log.weizaima.com").contains(url.getHost()) ||
                        url.getUserInfo() != null || url.getPort() != -1) throw new IllegalArgumentException("拒绝不受信任的跳转。");
                    HttpURLConnection connection = (HttpURLConnection)url.openConnection();
                    connection.setConnectTimeout(15000); connection.setReadTimeout(15000); connection.setInstanceFollowRedirects(false);
                    connection.setRequestProperty("Accept", "application/json");
                    try {
                        int status = connection.getResponseCode();
                        if (Arrays.asList(301,302,303,307,308).contains(status)) {
                            String location = connection.getHeaderField("Location");
                            if (location == null) throw new IllegalStateException("日志跳转无效。");
                            url = new URL(url, location); continue;
                        }
                        InputStream stream = status < 400 ? connection.getInputStream() : connection.getErrorStream();
                        byte[] bytes;
                        try (InputStream input = stream; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                            if (input != null) {
                                byte[] chunk = new byte[8192]; int count;
                                while ((count = input.read(chunk)) != -1) {
                                    output.write(chunk, 0, count);
                                }
                            }
                            bytes = output.toByteArray();
                        }
                        JSObject reply = new JSObject(); reply.put("status", status); reply.put("url", url.toString());
                        reply.put("text", new String(bytes, StandardCharsets.UTF_8)); call.resolve(reply); return;
                    } finally { connection.disconnect(); }
                }
                throw new IllegalStateException("日志跳转次数过多。");
            } catch (OutOfMemoryError error) { call.reject("手机可用内存不足，无法读取本场完整联网正文；原数据未改变。"); }
              catch (Exception error) { call.reject("日志网络请求失败。", error); }
        }, () -> call.reject("日志请求队列已满或已关闭，请稍后重试。"));
    }
    @PluginMethod public void automaticBackup(PluginCall call) {
        if (!backupRunning.compareAndSet(false,true)) { call.reject("自动备份正在进行，请稍候。"); return; }
        execute(() -> {
            try {
                Long expected = call.getData().has("expectedRevision") ? call.getData().getLong("expectedRevision") : null;
                if (expected == null || expected != database.revision()) throw new IllegalStateException("数据已变化，请稍后备份。");
                String tree = prefs().getString("tree", ""); requireArchivePermission(tree);
                java.io.File automaticDirectory=new java.io.File(getContext().getCacheDir(),"automatic-read-sources");
                if(!automaticDirectory.isDirectory()&&!automaticDirectory.mkdirs())throw new IllegalStateException("无法创建自动备份私有目录。");
                long maximum=StorageBudget.maximum(StorageBudget.volume(automaticDirectory),3);
                ReadLease lease=new ReadLease(automaticDirectory,maximum);
                ReadLease.Value current;
                try {current=lease.create(writer->{
                    writer.write("{\"format\":\"coc.logbook.android\",\"formatVersion\":1,\"exportedAt\":"+JSONObject.quote(java.time.Instant.now().toString())+",\"restoreScope\":[\"modules\",\"records\",\"characters\"],\"snapshot\":");
                    database.writeSnapshot(writer,null);writer.write('}');
                },expected);
                if(SnapshotBackupStream.validate(current.file)!=database.recordCount()||expected!=database.revision())throw new IllegalStateException("自动备份版本或场次未取齐。");
                }catch(Exception|OutOfMemoryError error){lease.close();throw error;}
                // Capture the exact immutable version, then release the storage queue before card I/O.
                try {backupWriter.execute(() -> finishAutomaticBackup(call,lease,current,expected,tree));}
                catch(Exception error){lease.close();throw error;}
            } catch (OutOfMemoryError error) { backupRunning.set(false); call.reject("自动备份内存不足；原数据未改变。"); }
              catch (Exception error) { backupRunning.set(false); call.reject("自动备份未完成：" + error.getMessage(), error); }
        });
    }
    private void finishAutomaticBackup(PluginCall call, ReadLease lease, ReadLease.Value current, long expected, String tree) {
        try {
            requireArchivePermission(tree);
            JSObject saved = publishArchive(current.file,tree,DocumentNames.backup(java.time.LocalDate.now(),"json"),"application/json","auto",current.bytes,current.sha256);
            if (!tree.equals(prefs().getString("tree", ""))) throw new IllegalStateException("保存位置已变化；旧位置文件保留，本次未标记为已备份。");
            long savedAt = System.currentTimeMillis();
            JSONObject owned = new JSONObject(saved.toString()); owned.put("tree", tree); owned.put("createdAt", savedAt);
            JSONArray registry = new JSONArray(prefs().getString("automatic-documents", "[]")); registry.put(owned);
            if (!prefs().edit().putString("automatic-documents", registry.toString()).putLong("last-auto-backup", savedAt).putLong("last-auto-backup-revision",expected).commit())
                throw new IllegalStateException("自动备份已写入，但轮换登记失败。");
            JSONArray retained = new JSONArray(); String warning = "";
            Set<Integer> obsolete=AutomaticRetention.candidates(registry,tree,10);
            for (int i = 0; i < registry.length(); i++) {
                JSONObject item = registry.getJSONObject(i);
                if (!obsolete.contains(i)) { retained.put(item); continue; }
                try {
                    Uri uri = Uri.parse(item.getString("uri"));
                    long maximumOld=item.has("bytes")?item.getLong("bytes"):StorageBudget.JS_SAFE_INTEGER;
                    BackupSession.Proof proof;
                    try(InputStream input=getContext().getContentResolver().openInputStream(uri)){proof=BackupSession.streamProof(input,maximumOld);}
                    if ((item.has("bytes")&&proof.bytes!=maximumOld)||!proof.sha256.equals(item.getString("sha256"))) { retained.put(item); warning = "部分旧备份被修改，已保留。"; continue; }
                    if (!DocumentsContract.deleteDocument(getContext().getContentResolver(), uri)) { retained.put(item); warning = "部分旧备份无法删除，已保留。"; }
                } catch (Exception error) { retained.put(item); warning = "部分旧备份不可访问，已保留。"; }
            }
            if (!prefs().edit().putString("automatic-documents", retained.toString()).commit()) warning = "自动备份已保存，但轮换登记未更新。";
            try{lease.close();}catch(Exception cleanup){warning += " 自动备份已完整保存，但私有暂存清理失败，请重开后重试。";}
            JSObject reply = new JSObject(); reply.put("document", saved); reply.put("savedAt", savedAt); reply.put("revision",expected); reply.put("warning", warning); call.resolve(reply);
        } catch (Exception error) {
            String cleanup="";try{lease.close();}catch(Exception failure){error.addSuppressed(failure);cleanup=" 私有暂存清理失败，请重开后重试。";}
            call.reject("自动备份未完成：" + error.getMessage()+cleanup, error);
        } finally { backupRunning.set(false); }
    }
    private Set<String> entityIds(JSONArray rows) throws Exception {
        Set<String> ids = new HashSet<>();
        for (int i = 0; i < rows.length(); i++) {
            String id = rows.getJSONObject(i).getString("id");
            if (id.isEmpty() || !ids.add(id)) throw new IllegalArgumentException("备份实体标识无效或重复。");
        }
        return ids;
    }
    private void validateSnapshot(JSONObject data) throws Exception {
        Set<String> allowed = new HashSet<>(Arrays.asList("schemaVersion", "exportedAt", "modules", "records", "characters", "settings"));
        java.util.Iterator<String> keys = data.keys();
        while (keys.hasNext()) if (!allowed.contains(keys.next())) throw new IllegalArgumentException("备份包含不属于安卓范围的数据。");
        if (data.getInt("schemaVersion") != 2) throw new IllegalArgumentException("备份版本不兼容。");
        data.getString("exportedAt"); data.getJSONObject("settings");
        JSONArray modules = data.getJSONArray("modules"), records = data.getJSONArray("records"), characters = data.getJSONArray("characters");
        Set<String> moduleIds = entityIds(modules); entityIds(records); entityIds(characters);
        for (int i = 0; i < records.length(); i++) if (!moduleIds.contains(records.getJSONObject(i).getString("moduleId"))) throw new IllegalArgumentException("场次关联失效。");
    }
    private JSONObject emptySnapshot() throws Exception {
        JSONObject data = new JSONObject(); data.put("schemaVersion", 2); data.put("exportedAt", java.time.Instant.now().toString());
        data.put("modules", new JSONArray()); data.put("records", new JSONArray()); data.put("characters", new JSONArray());
        JSONObject filters = new JSONObject();
        for (String key : new String[]{"hideDiceCommands", "hideImages", "hideOffTopic", "hideTime", "hidePlatformAccount", "hideYearMonthDay", "indentFirstLine", "darkDisplay"}) filters.put(key, key.equals("hidePlatformAccount") || key.equals("hideYearMonthDay"));
        JSONObject settings = new JSONObject(); settings.put("theme", "light"); settings.put("filterPreset", filters); data.put("settings", settings); return data;
    }
    @PluginMethod public void commitRestore(PluginCall call) {
        commitSnapshot(call, true);
    }
    /** Snapshot chunks share no state or cleanup with export files. Begin never writes business data. */
    @PluginMethod public void beginSnapshotEdit(PluginCall call) {
        execute(() -> { try {
            if(tableSession!=null||importPickerPending)throw new IllegalStateException("已有表格或文件选择任务。");
            Long expected=call.getData().has("expectedRevision")?call.getData().getLong("expectedRevision"):null;
            if(expected==null||expected!=database.revision())throw new IllegalStateException("数据已变化，请重新读取。");
            String tree=prefs().getString("tree","");requireArchivePermission(tree);
            Long bytes=call.getData().has("bytes")?call.getData().getLong("bytes"):null;
            if(bytes==null)throw new IllegalArgumentException("缺少快照长度。");
            if(snapshotUpload==null)snapshotUpload=new SnapshotUpload(new java.io.File(getContext().getCacheDir(),"snapshot-uploads"));
            JSObject out=new JSObject();out.put("id",snapshotUpload.begin(tree,expected,bytes,call.getString("sha256","")));call.resolve(out);
        } catch(Exception error){call.reject("数据暂存失败："+error.getMessage(),error);} });
    }
    @PluginMethod public void appendSnapshotEdit(PluginCall call) {
        execute(() -> { try {
            String base64=call.getString("base64","");
            if(snapshotUpload==null||base64.length()>349528)throw new IllegalArgumentException("快照分段不合法。");
            Integer index=call.getInt("index");if(index==null)throw new IllegalArgumentException("缺少分段序号。");
            snapshotUpload.append(call.getString("id",""),index,Base64.decode(base64,Base64.NO_WRAP));call.resolve();
        } catch(Exception error){call.reject("数据暂存失败："+error.getMessage(),error);} });
    }
    @PluginMethod public void cancelSnapshotEdit(PluginCall call) {
        execute(() -> {try {if(snapshotUpload!=null)snapshotUpload.cancel(call.getString("id",""));call.resolve();}
        catch(Exception error){call.reject("数据暂存清理失败："+error.getMessage(),error);} });
    }
    /** Exact length/hash, strict UTF-8/JSON and existing structure checks precede the original CAS transaction. */
    @PluginMethod public void finishSnapshotEdit(PluginCall call) {
        execute(() -> {try {
            if(snapshotUpload==null)throw new IllegalStateException("快照上传已失效。");
            JSObject out=snapshotUpload.finish(call.getString("id",""),(file,tree,expected)->{
                if(expected!=database.revision()||!tree.equals(prefs().getString("tree","")))throw new IllegalStateException("数据或保存位置已变化，未保存。");
                requireArchivePermission(tree);
                database.releaseReadCache();
                SnapshotStream.validate(java.nio.file.Files.newBufferedReader(file.toPath(),StandardCharsets.UTF_8));
                requireArchivePermission(tree);
                try(java.io.Reader reader=java.nio.file.Files.newBufferedReader(file.toPath(),StandardCharsets.UTF_8)) {
                    if(!file.delete())throw new IllegalStateException("数据暂存清理失败，未保存。");
                    long revision=database.replace(reader,expected);JSObject result=new JSObject();result.put("revision",revision);return result;
                }
            });call.resolve(out);
        } catch(OutOfMemoryError error){database.releaseReadCache();call.reject("保存内存不足；原数据未改变，请重试。");}
          catch(Exception error){call.reject("编辑未保存："+error.getMessage(),error);} });
    }
    @PluginMethod public void beginFetchBatch(PluginCall call) {
        execute(()->{try{
            if(fetchBatch!=null||tableSession!=null||importPickerPending)throw new IllegalStateException("已有批量检测或文件任务正在进行。");
            long expected=call.getData().getLong("expectedRevision");
            if(database.revision()!=expected)throw new IllegalStateException("数据已变化，请重新读取。");
            String tree=prefs().getString("tree","");requireArchivePermission(tree);
            JSONArray input=call.getArray("ids");java.util.Set<String> ids=new java.util.LinkedHashSet<>();
            if(input==null)throw new IllegalArgumentException("缺少检测目标。");
            for(int i=0;i<input.length();i++)if(!ids.add(input.getString(i)))throw new IllegalArgumentException("检测目标重复。");
            fetchBatch=new FetchBatch(new java.io.File(getContext().getCacheDir(),"fetch-batches"),tree,expected,ids,database.fields());
            JSObject out=new JSObject();out.put("id",fetchBatch.id);call.resolve(out);
        }catch(Exception error){call.reject("检测暂存未开始："+error.getMessage(),error);}});
    }
    @PluginMethod public void stageFetchResult(PluginCall call) {
        execute(()->{try{
            if(fetchBatch==null||snapshotUpload==null)throw new IllegalStateException("检测暂存已失效。");
            fetchBatch.require(call.getString("batchId",""));
            snapshotUpload.finish(call.getString("id",""),(file,tree,expected)->{
                if(expected!=fetchBatch.revision||database.revision()!=expected||!tree.equals(fetchBatch.tree)||!tree.equals(prefs().getString("tree","")))throw new IllegalStateException("数据或保存位置已变化，未保存。");
                requireArchivePermission(tree);fetchBatch.stage(file);return null;
            });call.resolve();
        }catch(OutOfMemoryError error){call.reject("本场正文内存不足；整批未保存。");}
         catch(Exception error){call.reject("检测结果未暂存："+error.getMessage(),error);}});
    }
    @PluginMethod public void finishFetchBatch(PluginCall call) {
        execute(()->{try{
            if(fetchBatch==null)throw new IllegalStateException("检测批次已失效。");
            fetchBatch.require(call.getString("id",""));
            if(database.revision()!=fetchBatch.revision||!fetchBatch.tree.equals(prefs().getString("tree","")))throw new IllegalStateException("数据或保存位置已变化，整批未保存。");
            requireArchivePermission(fetchBatch.tree);
            String now=java.time.Instant.now().toString();long revision=fetchBatch.finish(database,now);
            JSObject out=new JSObject();out.put("revision",revision);out.put("exportedAt",now);call.resolve(out);
        }catch(OutOfMemoryError error){call.reject("保存内存不足；整批未保存。");}
         catch(Exception error){call.reject("检测结果未保存："+error.getMessage(),error);}
         finally{if(fetchBatch!=null)try{fetchBatch.close();}catch(Exception ignored){}fetchBatch=null;}});
    }
    @PluginMethod public void cancelFetchBatch(PluginCall call) {
        execute(()->{try{if(fetchBatch!=null){fetchBatch.require(call.getString("id",""));fetchBatch.close();fetchBatch=null;}call.resolve();}
        catch(Exception error){call.reject("检测暂存清理失败："+error.getMessage(),error);}});
    }
    /** Table confirmation transmits no old bodies and uses the existing CAS/size transaction. */
    @PluginMethod public void commitTableDelta(PluginCall call) {
        final TableTiming timing=Boolean.TRUE.equals(call.getBoolean("measure",false))?new TableTiming():null;
        execute(() -> {try {
            TableTiming.mark(timing,"queueAndResources");
            Long expected=call.getData().has("expectedRevision")?call.getData().getLong("expectedRevision"):null;
            if(expected==null||expected!=database.revision())throw new IllegalStateException("数据已变化，请重新选择表格。");
            String tree=prefs().getString("tree","");requireArchivePermission(tree);
            TableTiming.mark(timing,"authorization");
            String json=call.getString("json");
            if(json==null)throw new IllegalArgumentException("表格差量缺失。");
            TableTiming.mark(timing,"inputSize");
            JSONObject delta=new JSONObject(json);
            TableTiming.mark(timing,"candidateParse");
            String now=java.time.Instant.now().toString();
            long revision=database.edit(expected,store->{
                if(!tree.equals(prefs().getString("tree","")))throw new IllegalStateException("保存位置已变化，未保存。");
                requireArchivePermission(tree);store.importTableDelta(delta,now,timing);
            },timing);
            JSObject result=new JSObject();result.put("revision",revision);result.put("exportedAt",now);if(timing!=null)result.put("timing",timing.result());call.resolve(result);
        } catch(OutOfMemoryError error){call.reject("手机可用内存不足，表格处理未完成，请重新读取当前数据。");}
          catch(Exception error){call.reject("表格未保存："+error.getMessage(),error);} });
    }
    @PluginMethod public void commitTable(PluginCall call) {
        final TableTiming timing=Boolean.TRUE.equals(call.getBoolean("measure",false))?new TableTiming():null;
        execute(() -> {try {
            TableTiming.mark(timing,"queueAndResources");
            Long expected=call.getData().has("expectedRevision")?call.getData().getLong("expectedRevision"):null;
            if(expected==null||expected!=database.revision())throw new IllegalStateException("数据已变化，请重新选择表格。");
            String tree=prefs().getString("tree","");requireArchivePermission(tree);
            TableTiming.mark(timing,"authorization");
            String json=call.getString("json");
            if(json==null)throw new IllegalArgumentException("表格数据缺失。");
            TableTiming.mark(timing,"inputSize");
            SnapshotStream.validate(new java.io.StringReader(json));
            TableTiming.mark(timing,"candidateValidation");
            JSONObject candidate=new JSONObject(json);
            TableTiming.mark(timing,"candidateParse");
            String now=java.time.Instant.now().toString();candidate.put("exportedAt",now);
            long revision=database.edit(expected,store->{
                if(!tree.equals(prefs().getString("tree","")))throw new IllegalStateException("保存位置已变化，未保存。");
                requireArchivePermission(tree);store.importTable(candidate,timing);
            },timing);
            JSObject result=new JSObject();result.put("revision",revision);result.put("exportedAt",now);if(timing!=null)result.put("timing",timing.result());call.resolve(result);
        } catch(OutOfMemoryError error){call.reject("手机可用内存不足，表格处理未完成，请重新读取当前数据。");}
          catch(Exception error){call.reject("表格未保存："+error.getMessage(),error);} });
    }
    @PluginMethod public void commitEdit(PluginCall call) {
        commitSnapshot(call, false);
    }
    /** Settings requests cannot carry entities or a caller-controlled safety bypass. */
    private void validateSettings(JSONObject settings) throws Exception {
        Set<String> allowed = new HashSet<>(Arrays.asList("theme", "filterPreset", "autoBackup"));
        java.util.Iterator<String> keys = settings.keys();
        while (keys.hasNext()) if (!allowed.contains(keys.next())) throw new IllegalArgumentException("设置字段不合法。");
        Object theme = settings.get("theme");
        if (!"light".equals(theme) && !"dark".equals(theme)) throw new IllegalArgumentException("主题不合法。");
        JSONObject filters = settings.getJSONObject("filterPreset");
        Set<String> filterKeys = new HashSet<>(Arrays.asList("hideDiceCommands", "hideImages", "hideOffTopic", "hideTime", "hidePlatformAccount", "hideYearMonthDay", "indentFirstLine", "darkDisplay"));
        if (filters.length() != filterKeys.size()) throw new IllegalArgumentException("阅读设置不完整。");
        for (String key : filterKeys) if (!(filters.get(key) instanceof Boolean)) throw new IllegalArgumentException("阅读设置类型不合法。");
        if (settings.has("autoBackup")) {
            JSONObject backup = settings.getJSONObject("autoBackup");
            if (backup.length() != 3 || !(backup.get("enabled") instanceof Boolean) ||
                !Arrays.asList("idle", "daily", "weekly").contains(backup.get("interval")) ||
                !(backup.get("retention") instanceof Number) || ((Number)backup.get("retention")).doubleValue() != 10)
                throw new IllegalArgumentException("自动备份设置不合法。");
        }
    }
    /** Small bridge request; unchanged entities remain native-owned, CAS and authorization are never skipped. */
    @PluginMethod public void commitSettings(PluginCall call) {
        execute(() -> {
            try {
                Long expected = call.getData().has("expectedRevision") ? call.getData().getLong("expectedRevision") : null;
                if (expected == null || expected != database.revision()) throw new IllegalStateException("数据已变化，请重新读取。");
                JSONObject settings = call.getObject("settings");
                if (settings == null)
                    throw new IllegalArgumentException("设置缺失。");
                validateSettings(settings);
                requireArchivePermission(prefs().getString("tree", ""));
                String exportedAt = java.time.Instant.now().toString();
                java.util.Map<String,String> fields = database.fields();
                long revision;
                if (fields == null) {
                    JSONObject next = emptySnapshot(); next.put("settings", settings); next.put("exportedAt", exportedAt);
                    revision = database.replace(next.toString(), expected);
                } else {
                    java.util.Map<String,String> changes = new java.util.LinkedHashMap<>();
                    changes.put("settings", settings.toString()); changes.put("exportedAt", JSONObject.quote(exportedAt));
                    revision = database.replaceFields(changes, expected);
                }
                JSObject out = new JSObject(); out.put("revision", revision); out.put("exportedAt", exportedAt);
                call.resolve(out);
            } catch (Exception error) { call.reject("设置未保存：" + error.getMessage(), error); }
        });
    }
    /** Validated module metadata cannot carry record bodies, settings or a safety bypass. */
    @PluginMethod public void commitModule(PluginCall call) {
        execute(() -> {
            try {
                Long expected = call.getData().has("expectedRevision") ? call.getData().getLong("expectedRevision") : null;
                if (expected == null || expected != database.revision()) throw new IllegalStateException("数据已变化，请重新读取。");
                JSONObject value = call.getObject("value");
                if (value == null) throw new IllegalArgumentException("模组数据缺失。");
                Set<String> allowed = new HashSet<>(Arrays.asList("id","name","playStatus","kps","pairs","order","collapsed","createdAt","updatedAt"));
                if (value.length() != allowed.size()) throw new IllegalArgumentException("模组字段不完整。");
                java.util.Iterator<String> keys = value.keys();
                while (keys.hasNext()) if (!allowed.contains(keys.next())) throw new IllegalArgumentException("模组字段不合法。");
                for (String key : new String[]{"id","name","playStatus","createdAt","updatedAt"})
                    if (!(value.get(key) instanceof String)) throw new IllegalArgumentException("模组文本类型不合法。");
                String id = value.getString("id"), name = value.getString("name").trim();
                if (id.isEmpty() || name.isEmpty() || !Arrays.asList("running","finished","not_started").contains(value.getString("playStatus")) ||
                    !(value.get("collapsed") instanceof Boolean) || !(value.get("order") instanceof Number) ||
                    !Double.isFinite(((Number)value.get("order")).doubleValue())) throw new IllegalArgumentException("模组内容不合法。");
                value.getString("createdAt"); value.getString("updatedAt");
                requireArchivePermission(prefs().getString("tree", ""));
                java.util.Map<String,String> fields = database.fields();
                JSONObject empty = fields == null ? emptySnapshot() : null;
                JSONArray modules = fields == null ? new JSONArray() : new JSONArray(fields.get("modules"));
                JSONArray characters = fields == null ? new JSONArray() : new JSONArray(fields.get("characters"));
                Set<String> characterIds = entityIds(characters), linked = new HashSet<>();
                JSONArray pairs = value.getJSONArray("pairs"), kps = value.getJSONArray("kps"), trimmed = new JSONArray();
                for (int i = 0; i < kps.length(); i++) {
                    if (!(kps.get(i) instanceof String)) throw new IllegalArgumentException("KP 名称不合法。");
                    String kp = kps.getString(i).trim(); if (!kp.isEmpty()) trimmed.put(kp);
                }
                for (int i = 0; i < pairs.length(); i++) {
                    JSONObject pair = pairs.getJSONObject(i);
                    java.util.Iterator<String> pairKeys = pair.keys();
                    while (pairKeys.hasNext()) if (!Arrays.asList("pc","pl","characterId").contains(pairKeys.next())) throw new IllegalArgumentException("参与者字段不合法。");
                    if (!(pair.get("pc") instanceof String) || !(pair.get("pl") instanceof String)) throw new IllegalArgumentException("参与者不合法。");
                    if (pair.has("characterId")) {
                        if (!(pair.get("characterId") instanceof String)) throw new IllegalArgumentException("角色标识不合法。");
                        String cid = pair.getString("characterId");
                        if (!characterIds.contains(cid)) throw new IllegalArgumentException("角色关联失效。");
                        linked.add(cid);
                    }
                }
                String exportedAt = java.time.Instant.now().toString();
                value.put("name", name); value.put("kps", trimmed); value.put("updatedAt", exportedAt);
                boolean found = false;
                for (int i = 0; i < modules.length(); i++) if (id.equals(modules.getJSONObject(i).getString("id"))) {
                    value.put("createdAt", modules.getJSONObject(i).getString("createdAt")); modules.put(i, value); found = true; break;
                }
                if (!found) modules.put(value);
                boolean linkedChanged = false;
                for (int i = 0; i < characters.length(); i++) {
                    JSONObject character = characters.getJSONObject(i);
                    if (!linked.contains(character.getString("id"))) continue;
                    JSONArray ids = character.getJSONArray("moduleIds"); boolean exists = false;
                    for (int j = 0; j < ids.length(); j++) if (id.equals(ids.getString(j))) exists = true;
                    if (!exists) { ids.put(id); linkedChanged = true; }
                    if (!character.has("moduleId")) { character.put("moduleId", id); linkedChanged = true; }
                }
                long revision;
                if (fields == null) {
                    empty.put("modules", modules); empty.put("characters", characters); empty.put("exportedAt", exportedAt);
                    revision = database.replace(empty.toString(), expected);
                } else {
                    java.util.Map<String,String> changes = new java.util.LinkedHashMap<>();
                    changes.put("modules", modules.toString()); changes.put("exportedAt", JSONObject.quote(exportedAt));
                    if (linkedChanged) changes.put("characters", characters.toString());
                    revision = database.replaceFields(changes, expected);
                }
                JSObject result = new JSObject(); result.put("revision", revision); result.put("exportedAt", exportedAt); call.resolve(result);
            } catch (OutOfMemoryError error) { call.reject("手机可用内存不足，模组处理未完成，请重新读取当前数据。"); }
              catch (Exception error) { call.reject("模组未保存：" + error.getMessage(), error); }
        });
    }
    /** One validated entity and associated metadata, without serializing unrelated log bodies. */
    @PluginMethod public void commitEntity(PluginCall call) {
        execute(() -> {
            try {
                Long expected = call.getData().has("expectedRevision") ? call.getData().getLong("expectedRevision") : null;
                if (expected == null || expected != database.revision()) throw new IllegalStateException("数据已变化，请重新读取。");
                requireArchivePermission(prefs().getString("tree", ""));
                JSONObject edit = call.getObject("edit");
                if (edit == null || edit.length() != 2) throw new IllegalArgumentException("实体请求不完整。");
                String kind = edit.getString("kind"); JSONObject value = edit.getJSONObject("value");
                java.util.Map<String,String> fields = database.fields(); boolean empty = fields == null;
                if (empty) fields = JsonFields.split(emptySnapshot().toString());
                JSONArray modules = new JSONArray(fields.get("modules")), characters = new JSONArray(fields.get("characters"));
                String now = java.time.Instant.now().toString();
                java.util.Map<String,String> changes = new java.util.LinkedHashMap<>();
                if ("character".equals(kind)) {
                    EntityEdits.character(value, modules, characters, now);
                    changes.put("characters",characters.toString());
                } else if ("record".equals(kind)) {
                    java.util.Map<String,java.util.Map<String,String>> rows = RecordOverlay.rows(fields);
                    String id = value.getString("id");
                    JSONObject entry = EntityEdits.record(value, rows.get(id), modules, rows, now);
                    JSONObject values = new JSONObject(fields.containsKey("recordValues") ? fields.get("recordValues") : "{}"); values.put(id,entry);
                    JSONArray deleted = new JSONArray(fields.containsKey("recordDeleted") ? fields.get("recordDeleted") : "[]"), retained = new JSONArray();
                    for (int i = 0; i < deleted.length(); i++) if (!id.equals(deleted.getString(i))) retained.put(deleted.getString(i));
                    changes.put("recordValues",values.toString()); changes.put("recordDeleted",retained.toString());
                } else throw new IllegalArgumentException("不支持此实体类型。");
                changes.put("exportedAt",JSONObject.quote(now));
                long revision;
                if (empty) { fields.putAll(changes); RecordOverlay.compose(fields); revision = database.replace(JsonFields.join(fields),expected); }
                else revision = database.replaceFields(changes,expected);
                JSObject result = new JSObject(); result.put("revision",revision); result.put("exportedAt",now); call.resolve(result);
            } catch (OutOfMemoryError error) { call.reject("手机可用内存不足，编辑处理未完成，请重新读取当前数据。"); }
              catch (Exception error) { call.reject("编辑未保存：" + error.getMessage(),error); }
        });
    }
    /** Android's JSONObject parser is lenient. Raw text may be persisted only after a strict JSON syntax check. */
    private void validateJsonText(String json) throws Exception {
        try (SnapshotJson reader = new SnapshotJson(new java.io.StringReader(json))) {
            reader.object(name -> reader.skip());
            reader.end();
        }
    }
    /** All writes must fail after a SAF grant is revoked. */
    private void requireArchivePermission(String tree) {
        boolean authorized = false;
        for (android.content.UriPermission permission : getContext().getContentResolver().getPersistedUriPermissions()) {
            if (permission.getUri().toString().equals(tree) && permission.isReadPermission() && permission.isWritePermission()) authorized = true;
        }
        if (!authorized) throw new IllegalStateException("保存位置授权已失效，请重新选择。");
    }
    /** All list operations retain CAS and transactions without processing complete body objects. */
    @PluginMethod public void commitAction(PluginCall call) {
        JSONObject action = call.getObject("action");
        if (action != null && "reorder".equals(action.optString("type"))) {
            commitReorder(call, action); return;
        }
        commitListMetadata(call, action);
    }
    private void commitListMetadata(PluginCall call, JSONObject action) {
        execute(() -> {
            try {
                Long expected = call.getData().has("expectedRevision") ? call.getData().getLong("expectedRevision") : null;
                if (expected == null || expected != database.revision()) throw new IllegalStateException("数据已变化，请重新读取。");
                requireArchivePermission(prefs().getString("tree", ""));
                java.util.Map<String,String> fields = database.fields();
                if (fields == null || action == null) throw new IllegalArgumentException("列表操作或已保存数据缺失。");
                java.util.Map<String,java.util.Map<String,String>> rows = RecordOverlay.rows(fields);
                JSONObject data = new JSONObject(); JSONArray records = new JSONArray();
                for (java.util.Map<String,String> row : rows.values()) records.put(RecordOverlay.metadata(row));
                data.put("modules",new JSONArray(fields.get("modules"))); data.put("characters",new JSONArray(fields.get("characters"))); data.put("records",records);
                LogbookActions.apply(data,action);
                java.util.Map<String,String> changes = new java.util.LinkedHashMap<>();
                changes.put("modules",data.getJSONArray("modules").toString()); changes.put("characters",data.getJSONArray("characters").toString());
                if ("clear".equals(action.getString("type"))) {
                    changes.put("records","[]"); changes.put("recordValues","{}"); changes.put("recordOrders","{}"); changes.put("recordDeleted","[]");
                } else {
                    Set<String> remaining = entityIds(data.getJSONArray("records"));
                    JSONArray deleted = new JSONArray(fields.containsKey("recordDeleted") ? fields.get("recordDeleted") : "[]");
                    JSONObject values = new JSONObject(fields.containsKey("recordValues") ? fields.get("recordValues") : "{}");
                    JSONObject orders = new JSONObject(fields.containsKey("recordOrders") ? fields.get("recordOrders") : "{}");
                    for (String id : rows.keySet()) if (!remaining.contains(id)) { deleted.put(id); values.remove(id); orders.remove(id); }
                    if ("reset".equals(action.getString("type"))) {
                        String id = action.getString("id"); java.util.Map<String,String> original = rows.get(id);
                        JSONObject metadata = RecordOverlay.metadata(original);
                        if ("online".equals(metadata.getString("sourceType"))) {
                            java.util.Map<String,String> value = new java.util.LinkedHashMap<>(original); value.remove("rawContent"); value.remove("cacheSourceUrl"); value.remove("fetchedAt");
                            value.put("previousStatus",value.get("status")); value.put("status",JSONObject.quote("pending")); value.remove("lastError");
                            JSONObject entry = new JSONObject(); entry.put("value",new JSONObject(JsonFields.join(value))); entry.put("keepBody",true); values.put(id,entry);
                        }
                    }
                    changes.put("recordDeleted",deleted.toString()); changes.put("recordValues",values.toString()); changes.put("recordOrders",orders.toString());
                }
                String now = data.getString("exportedAt"); changes.put("exportedAt",JSONObject.quote(now));
                long revision = database.replaceFields(changes,expected);
                JSObject result = new JSObject(); result.put("revision",revision); result.put("exportedAt",now); call.resolve(result);
            } catch (Exception error) { call.reject("操作未保存：" + error.getMessage(),error); }
        });
    }
    /** Sorting stores only small order values. Bodies are reconstructed exactly at read/export boundaries. */
    private void commitReorder(PluginCall call, JSONObject action) {
        execute(() -> {
            try {
                Long expected = call.getData().has("expectedRevision") ? call.getData().getLong("expectedRevision") : null;
                if (expected == null || expected != database.revision()) throw new IllegalStateException("数据已变化，请重新读取。");
                requireArchivePermission(prefs().getString("tree", ""));
                java.util.Map<String,String> fields = database.fields();
                if (fields == null) throw new IllegalStateException("尚无已保存数据。");
                JSONObject data = new JSONObject();
                data.put("modules", new JSONArray(fields.get("modules"))); data.put("characters", new JSONArray());
                JSONArray records = new JSONArray();
                JSONObject orders = new JSONObject(fields.containsKey("recordOrders") ? fields.get("recordOrders") : "{}");
                String kind = action.getString("kind");
                if ("record".equals(kind)) for (java.util.Map<String,String> row : RecordOverlay.rows(fields).values()) {
                    JSONObject metadata = new JSONObject("{\"id\":" + row.get("id") + ",\"moduleId\":" + row.get("moduleId") + ",\"order\":" + row.get("order") + "}");
                    String id = metadata.getString("id"); if (orders.has(id)) metadata.put("order", orders.get(id));
                    records.put(metadata);
                }
                data.put("records", records); LogbookActions.apply(data, action);
                java.util.Map<String,String> changes = new java.util.LinkedHashMap<>();
                if ("module".equals(kind)) changes.put("modules", data.getJSONArray("modules").toString());
                else {
                    for (int i = 0; i < records.length(); i++) {
                        JSONObject row = records.getJSONObject(i); orders.put(row.getString("id"), row.get("order"));
                    }
                    changes.put("recordOrders", orders.toString());
                }
                String exportedAt = data.getString("exportedAt"); changes.put("exportedAt", JSONObject.quote(exportedAt));
                long revision = database.replaceFields(changes, expected);
                JSObject result = new JSObject(); result.put("revision", revision); result.put("exportedAt", exportedAt); call.resolve(result);
            } catch (Exception error) { call.reject("排序未保存：" + error.getMessage(), error); }
        });
    }
    private void commitSnapshot(PluginCall call, boolean restoring) {
        execute(() -> {
            java.util.List<Uri> imported = new java.util.ArrayList<>();
            boolean committed = false;
            try {
                if (restoring && !Boolean.TRUE.equals(call.getBoolean("confirmed", false))) throw new IllegalStateException("需要用户明确确认覆盖。");
                Long expected = call.getData().has("expectedRevision") ? call.getData().getLong("expectedRevision") : null;
                if (expected == null || expected != database.revision()) throw new IllegalStateException("数据已变化，请重新预览。");
                String json = call.getString("json", "");
                validateJsonText(json);
                SnapshotStream.validate(new java.io.StringReader(json));
                String tree = prefs().getString("tree", "");
                requireArchivePermission(tree);
                JSONArray files = restoring ? call.getArray("attachments") : null;
                if (files != null) {
                    for (int i = 0; i < files.length(); i++) {
                        JSONObject file = files.getJSONObject(i);
                        byte[] bytes = Base64.decode(file.getString("base64"), Base64.DEFAULT);
                        StorageBudget.require(StorageBudget.volume(getContext().getFilesDir()),StorageBudget.estimate(bytes.length,3));
                        JSObject saved = write(file.getString("name"), file.getString("mime"), bytes, "import");
                        imported.add(Uri.parse(saved.getString("uri")));
                    }
                }
                // Full snapshot requests have already been parsed and validated; keep their original text and numeric precision.
                long revision = database.replace(json, expected);
                committed = true;
                JSObject out = new JSObject(); out.put("revision", revision);

                call.resolve(out);
            } catch (OutOfMemoryError error) {
                if (!committed) for (Uri uri : imported) try { DocumentsContract.deleteDocument(getContext().getContentResolver(), uri); } catch (Exception ignored) { }
                call.reject(committed ? "数据已保存，但手机内存不足以返回结果，请重新读取。" : "手机可用内存不足；原数据未改变。");
            } catch (Exception error) {
                if (!committed) for (Uri uri : imported) try { DocumentsContract.deleteDocument(getContext().getContentResolver(), uri); } catch (Exception ignored) { }
                call.reject((restoring ? "恢复未完成：" : "编辑未保存：") + error.getMessage(), error);
            }
        });
    }
}
