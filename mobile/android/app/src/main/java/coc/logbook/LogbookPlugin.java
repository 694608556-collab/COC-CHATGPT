package coc.logbook;

import android.app.Activity;
import android.content.Intent;
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
import org.json.JSONArray;
import org.json.JSONObject;

/** Local app bridge. Uses SAF grants and private SQLite, never root or broad storage permissions. */
@CapacitorPlugin(name = "Logbook")
public final class LogbookPlugin extends Plugin {
    private static final int MAX_BYTES = 64 * 1024 * 1024;
    private LogbookDatabase database;
    @Override public void load() { database = new LogbookDatabase(getContext()); }
    @Override protected void handleOnDestroy() { if (database != null) database.close(); }
    private SharedPreferences prefs() { return getContext().getSharedPreferences("archive-location", 0); }
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
                if (output.size() + count > MAX_BYTES) throw new IllegalStateException("首阶段文件上限为 64 MB。");
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
    @PluginMethod public void getState(PluginCall call) {
        execute(() -> {
            try {
                JSObject out = new JSObject(); String json = database.snapshot();
                out.put("json", json == null ? JSONObject.NULL : json); out.put("revision", database.revision());
                ConnectivityManager connectivity = (ConnectivityManager)getContext().getSystemService(android.content.Context.CONNECTIVITY_SERVICE);
                out.put("networkConnected", connectivity.getActiveNetwork() != null);
                out.put("archive", location(true)); call.resolve(out);
            } catch (Exception error) { call.reject("读取失败；未清空数据。", error); }
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
    @PluginMethod public void openBackup(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("*/*").addCategory(Intent.CATEGORY_OPENABLE);
        intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"application/json", "application/zip", "application/octet-stream", "text/plain"});
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        startActivityForResult(call, intent, "backupChosen");
    }
    @ActivityCallback private void backupChosen(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            JSObject out = new JSObject(); out.put("cancelled", true); call.resolve(out); return;
        }
        execute(() -> {
            try {
                Uri document = result.getData().getData(); byte[] bytes = read(document);
                JSObject out = new JSObject(); out.put("cancelled", false); out.put("name", displayName(document));
                out.put("base64", Base64.encodeToString(bytes, Base64.NO_WRAP)); call.resolve(out);
            } catch (Exception error) { call.reject("备份读取失败；未写入数据。", error); }
        });
    }
    private JSObject write(String name, String mime, byte[] bytes) throws Exception {
        if (bytes.length > MAX_BYTES || name.length() > 120 || name.isEmpty() || name.contains("..") || name.matches(".*[/\\\\\u0000-\u001f].*")) throw new IllegalArgumentException("文件名或文件大小不合法。");
        String location = prefs().getString("tree", "");
        if (location.isEmpty()) throw new IllegalStateException("请先选择并确认归档文件夹。");
        Uri tree = Uri.parse(location); validateTree(tree);
        Uri parent = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
        // Unique suffix means an existing user document is never opened for overwrite.
        int dot = name.lastIndexOf('.');
        String savedName = (dot > 0 ? name.substring(0, dot) : name) + "-" + UUID.randomUUID().toString().substring(0, 8) + (dot > 0 ? name.substring(dot) : "");
        Uri destination = DocumentsContract.createDocument(getContext().getContentResolver(), parent, mime, savedName);
        if (destination == null) throw new IllegalStateException("无法在所选目录创建文件。");
        boolean success = false;
        try {
            try (OutputStream output = getContext().getContentResolver().openOutputStream(destination, "w")) {
                if (output == null) throw new IllegalStateException("目录不可写，请重新选择。");
                output.write(bytes);
            }
            byte[] back = read(destination);
            if (!Arrays.equals(bytes, back)) throw new IllegalStateException("保存回读校验失败。");
            success = true;
            JSObject out = new JSObject(); out.put("uri", destination.toString()); out.put("name", savedName);
            out.put("bytes", back.length); out.put("sha256", digest(back)); return out;
        } finally { if (!success) DocumentsContract.deleteDocument(getContext().getContentResolver(), destination); }
    }
    @PluginMethod public void writeArchive(PluginCall call) {
        execute(() -> {
            try { call.resolve(write(call.getString("name", ""), call.getString("mime", "application/octet-stream"), Base64.decode(call.getString("base64", ""), Base64.DEFAULT))); }
            catch (Exception error) { call.reject("保存失败：" + error.getMessage(), error); }
        });
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
    @PluginMethod public void commitEdit(PluginCall call) {
        commitSnapshot(call, false);
    }
    private void commitSnapshot(PluginCall call, boolean restoring) {
        execute(() -> {
            try {
                if (restoring && !Boolean.TRUE.equals(call.getBoolean("confirmed", false))) throw new IllegalStateException("需要用户明确确认覆盖。");
                String json = call.getString("json", "");
                if (json.getBytes(StandardCharsets.UTF_8).length > MAX_BYTES) throw new IllegalArgumentException("数据超过首阶段大小上限。");
                JSONObject next = new JSONObject(json); validateSnapshot(next);
                Long expected = call.getData().has("expectedRevision") ? call.getData().getLong("expectedRevision") : null;
                if (expected == null || expected != database.revision()) throw new IllegalStateException("数据已变化，请重新预览。");
                JSONObject envelope = new JSONObject(); envelope.put("format", "coc.logbook.android"); envelope.put("formatVersion", 1);
                envelope.put("exportedAt", java.time.Instant.now().toString()); envelope.put("restoreScope", new JSONArray(Arrays.asList("modules", "records", "characters")));
                String current = database.snapshot(); envelope.put("snapshot", current == null ? emptySnapshot() : new JSONObject(current));
                // Only a fully read-back, user-visible safety copy permits the database transaction.
                JSObject safety = write((restoring ? "before-restore-" : "before-edit-") + System.currentTimeMillis() + ".json", "application/json", envelope.toString().getBytes(StandardCharsets.UTF_8));
                long revision = database.replace(next.toString(), expected);
                JSObject out = new JSObject(); out.put("revision", revision); out.put("safetyBackup", safety); call.resolve(out);
            } catch (Exception error) { call.reject((restoring ? "恢复未完成：" : "编辑未保存：") + error.getMessage(), error); }
        });
    }
}
