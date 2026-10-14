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
                out.put("lastAutoBackupAt", prefs().getLong("last-auto-backup", 0));
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
        String kind = call.getString("kind", "backup");
        intent.putExtra(Intent.EXTRA_MIME_TYPES, kind.equals("backup")
            ? new String[]{"application/json", "application/zip", "application/octet-stream", "text/plain"}
            : new String[]{"text/csv","application/vnd.ms-excel","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","application/octet-stream"});
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
        return write(name, mime, bytes, "export");
    }
    private JSObject write(String name, String mime, byte[] bytes, String purpose) throws Exception {
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
            JSObject out = new JSObject(); out.put("uri", destination.toString()); out.put("name", savedName);
            out.put("bytes", back.length); out.put("sha256", digest(back)); out.put("purpose", purpose);
            rememberDocument(out, mime); success = true; return out;
        } finally { if (!success) DocumentsContract.deleteDocument(getContext().getContentResolver(), destination); }
    }
    @PluginMethod public void writeArchive(PluginCall call) {
        execute(() -> {
            try { call.resolve(write(call.getString("name", ""), call.getString("mime", "application/octet-stream"), Base64.decode(call.getString("base64", ""), Base64.DEFAULT), call.getString("purpose", "export"))); }
            catch (Exception error) { call.reject("保存失败：" + error.getMessage(), error); }
        });
    }
    private synchronized void rememberDocument(JSObject file, String mime) throws Exception {
        JSONArray documents = new JSONArray(prefs().getString("created-documents", "[]"));
        JSONObject entry = new JSONObject(file.toString()); entry.put("mime", mime);
        documents.put(entry);
        if (!prefs().edit().putString("created-documents", documents.toString()).commit())
            throw new IllegalStateException("文件已写入，但登记失败。");
    }
    private JSONObject knownDocument(String uri) throws Exception {
        JSONArray documents = new JSONArray(prefs().getString("created-documents", "[]"));
        for (int i = documents.length() - 1; i >= 0; i--) {
            JSONObject item = documents.getJSONObject(i);
            if (uri.equals(item.getString("uri"))) {
                if (!digest(read(Uri.parse(uri))).equals(item.getString("sha256")))
                    throw new IllegalStateException("文件已改变或无法读取，请重新导出。");
                return item;
            }
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
        try {
            JSONArray all = new JSONArray(prefs().getString("created-documents", "[]"));
            JSONArray latest = new JSONArray();
            int limit = Boolean.TRUE.equals(call.getBoolean("all", false)) ? all.length() : 30;
            for (int i = all.length() - 1; i >= Math.max(0, all.length() - limit); i--) {
                JSONObject item = all.getJSONObject(i);
                try (Cursor row = getContext().getContentResolver().query(Uri.parse(item.getString("uri")), new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
                    if (row != null && row.moveToFirst()) latest.put(item);
                } catch (Exception ignored) { }
            }
            JSObject result = new JSObject(); result.put("documents", latest); call.resolve(result);
        } catch (Exception error) { call.reject("读取归档登记失败。", error); }
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
        execute(() -> {
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
                                    if (output.size() + count > MAX_BYTES) throw new IllegalStateException("日志超过 64 MB。");
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
            } catch (Exception error) { call.reject("日志网络请求失败。", error); }
        });
    }
    @PluginMethod public void automaticBackup(PluginCall call) {
        execute(() -> {
            try {
                Long expected = call.getData().has("expectedRevision") ? call.getData().getLong("expectedRevision") : null;
                if (expected == null || expected != database.revision()) throw new IllegalStateException("数据已变化，请稍后备份。");
                String current = database.snapshot();
                if (current == null) throw new IllegalStateException("尚无已保存数据。");
                JSONObject envelope = new JSONObject(); envelope.put("format", "coc.logbook.android"); envelope.put("formatVersion", 1);
                envelope.put("exportedAt", java.time.Instant.now().toString()); envelope.put("restoreScope", new JSONArray(Arrays.asList("modules","records","characters")));
                envelope.put("snapshot", new JSONObject(current));
                long savedAt = System.currentTimeMillis();
                JSObject saved = write("auto-backup-" + savedAt + ".json", "application/json", envelope.toString().getBytes(StandardCharsets.UTF_8), "auto");
                JSONObject owned = new JSONObject(saved.toString()); owned.put("tree", prefs().getString("tree", "")); owned.put("createdAt", savedAt);
                JSONArray registry = new JSONArray(prefs().getString("automatic-documents", "[]")); registry.put(owned);
                if (!prefs().edit().putString("automatic-documents", registry.toString()).putLong("last-auto-backup", savedAt).commit())
                    throw new IllegalStateException("自动备份已写入，但轮换登记失败。");
                JSONArray retained = new JSONArray(); String warning = "";
                for (int i = 0; i < registry.length(); i++) {
                    JSONObject item = registry.getJSONObject(i);
                    if (i >= registry.length() - 10 || !item.getString("tree").equals(prefs().getString("tree", ""))) { retained.put(item); continue; }
                    try {
                        Uri uri = Uri.parse(item.getString("uri"));
                        if (!digest(read(uri)).equals(item.getString("sha256"))) { warning = "部分旧备份被修改，已保留。"; continue; }
                        if (!DocumentsContract.deleteDocument(getContext().getContentResolver(), uri)) { retained.put(item); warning = "部分旧备份无法删除，已保留。"; }
                    } catch (Exception error) { retained.put(item); warning = "部分旧备份不可访问，已保留。"; }
                }
                prefs().edit().putString("automatic-documents", retained.toString()).commit();
                JSObject reply = new JSObject(); reply.put("document", saved); reply.put("savedAt", savedAt); reply.put("warning", warning); call.resolve(reply);
            } catch (Exception error) { call.reject("自动备份未完成：" + error.getMessage(), error); }
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
                if (settings == null || settings.toString().getBytes(StandardCharsets.UTF_8).length > 16384)
                    throw new IllegalArgumentException("设置缺失或超过大小限制。");
                validateSettings(settings);
                requireArchivePermission(prefs().getString("tree", ""));
                String current = database.snapshot();
                if (current != null) validateJsonText(current);
                JSONObject next = current == null ? emptySnapshot() : new JSONObject(current);
                validateSnapshot(next);
                String exportedAt = java.time.Instant.now().toString();
                next.put("settings", settings); next.put("exportedAt", exportedAt);
                long revision = database.replace(next.toString(), expected);
                JSObject out = new JSObject(); out.put("revision", revision); out.put("exportedAt", exportedAt);
                call.resolve(out);
            } catch (Exception error) { call.reject("设置未保存：" + error.getMessage(), error); }
        });
    }
    /** Structural equality avoids serializing the entire message cache twice just to detect a settings edit. */
    private boolean sameJson(Object left, Object right) throws Exception {
        if (left == right) return true;
        if (left instanceof JSONObject && right instanceof JSONObject) {
            JSONObject a = (JSONObject)left, b = (JSONObject)right;
            if (a.length() != b.length()) return false;
            java.util.Iterator<String> keys = a.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                if (!b.has(key) || !sameJson(a.get(key), b.get(key))) return false;
            }
            return true;
        }
        if (left instanceof JSONArray && right instanceof JSONArray) {
            JSONArray a = (JSONArray)left, b = (JSONArray)right;
            if (a.length() != b.length()) return false;
            for (int i = 0; i < a.length(); i++) if (!sameJson(a.get(i), b.get(i))) return false;
            return true;
        }
        return left != null && left.equals(right);
    }
    /** Android's JSONObject parser is lenient. Raw text may be persisted only after a strict JSON syntax check. */
    private void validateJsonText(String json) throws Exception {
        try (android.util.JsonReader reader = new android.util.JsonReader(new java.io.StringReader(json))) {
            reader.setLenient(false);
            reader.beginObject();
            while (reader.hasNext()) { reader.nextName(); reader.skipValue(); }
            reader.endObject();
            if (reader.peek() != android.util.JsonToken.END_DOCUMENT) throw new IllegalArgumentException("JSON 包含多余内容。");
        }
    }
    /** 0=settings, 1=ordinary checkpoint, 2=destructive; decided from stored entities, never caller flags. */
    private int protectionLevel(JSONObject before, JSONObject next) throws Exception {
        String[] groups = {"modules", "records", "characters"};
        if (before == null) {
            for (String group : groups) if (next.getJSONArray(group).length() > 0) return 1;
            return 0;
        }
        boolean settingsOnly = true;
        for (String group : groups) {
            JSONArray oldRows = before.getJSONArray(group), rows = next.getJSONArray(group);
            if (settingsOnly && !sameJson(oldRows, rows)) settingsOnly = false;
            Set<String> ids = entityIds(rows);
            for (int i = 0; i < oldRows.length(); i++) if (!ids.contains(oldRows.getJSONObject(i).getString("id"))) return 2;
        }
        if (settingsOnly) return 0;
        java.util.Map<String, JSONObject> records = new java.util.HashMap<>();
        JSONArray rows = next.getJSONArray("records");
        for (int i = 0; i < rows.length(); i++) records.put(rows.getJSONObject(i).getString("id"), rows.getJSONObject(i));
        JSONArray oldRows = before.getJSONArray("records");
        for (int i = 0; i < oldRows.length(); i++) {
            JSONObject old = oldRows.getJSONObject(i), row = records.get(old.getString("id"));
            if (row == null || !old.optString("sourceType", "").equals(row.optString("sourceType", "")) ||
                !old.optString("link", "").equals(row.optString("link", ""))) return 2;
        }
        return 1;
    }
    /** Even settings/windowed saves must fail after a SAF grant is revoked. */
    private void requireArchivePermission(String tree) {
        boolean authorized = false;
        for (android.content.UriPermission permission : getContext().getContentResolver().getPersistedUriPermissions()) {
            if (permission.getUri().toString().equals(tree) && permission.isReadPermission() && permission.isWritePermission()) authorized = true;
        }
        if (!authorized) throw new IllegalStateException("保存位置授权已失效，请重新选择。");
    }
    /** Only validated reorders skip the dedicated safety copy; all actions retain CAS and transactions. */
    @PluginMethod public void commitAction(PluginCall call) {
        commitSnapshot(call, false, true);
    }
    private void commitSnapshot(PluginCall call, boolean restoring) {
        commitSnapshot(call, restoring, false);
    }
    private void commitSnapshot(PluginCall call, boolean restoring, boolean actionOnly) {
        execute(() -> {
            java.util.List<Uri> imported = new java.util.ArrayList<>();
            boolean committed = false;
            try {
                if (restoring && !Boolean.TRUE.equals(call.getBoolean("confirmed", false))) throw new IllegalStateException("需要用户明确确认覆盖。");
                Long expected = call.getData().has("expectedRevision") ? call.getData().getLong("expectedRevision") : null;
                if (expected == null || expected != database.revision()) throw new IllegalStateException("数据已变化，请重新预览。");
                String current = database.snapshot();
                if (actionOnly && current == null) throw new IllegalStateException("尚无已保存数据。");
                String json = actionOnly ? current : call.getString("json", "");
                if (json.getBytes(StandardCharsets.UTF_8).length > MAX_BYTES) throw new IllegalArgumentException("数据超过首阶段大小上限。");
                if (!actionOnly) validateJsonText(json);
                JSONObject next = new JSONObject(json); validateSnapshot(next);
                boolean sorting = false;
                if (actionOnly) {
                    JSONObject action = call.getObject("action");
                    if (action == null) throw new IllegalArgumentException("列表操作缺失。");
                    LogbookActions.apply(next, action); validateSnapshot(next);
                    sorting = "reorder".equals(action.getString("type"));
                }
                int protection = restoring || (actionOnly && !sorting) ? 2 : sorting ? 0 : protectionLevel(current == null ? null : new JSONObject(current), next);
                String tree = prefs().getString("tree", "");
                requireArchivePermission(tree);
                long now = System.currentTimeMillis(), lastSafety = prefs().getLong("ordinary-safety-at", 0);
                boolean windowValid = tree.equals(prefs().getString("ordinary-safety-tree", "")) && lastSafety > 0 && now >= lastSafety && now - lastSafety < 10L * 60 * 1000;
                JSObject safety = null;
                if (protection == 2 || (protection == 1 && !windowValid)) {
                    JSONObject envelope = new JSONObject(); envelope.put("format", "coc.logbook.android"); envelope.put("formatVersion", 1);
                    envelope.put("exportedAt", java.time.Instant.now().toString()); envelope.put("restoreScope", new JSONArray(Arrays.asList("modules", "records", "characters")));
                    // Embed the original JSON unchanged: parsing it again adds cost and can lose raw number precision.
                    String metadata = envelope.toString();
                    String safetyJson = metadata.substring(0, metadata.length() - 1) + ",\"snapshot\":" + (current == null ? emptySnapshot().toString() : current) + "}";
                    // Only a fully read-back, user-visible safety copy permits the database transaction.
                    safety = write((restoring ? "before-restore-" : "before-edit-") + System.currentTimeMillis() + ".json", "application/json", safetyJson.getBytes(StandardCharsets.UTF_8), "safety");
                }
                JSONArray files = restoring ? call.getArray("attachments") : null;
                if (files != null) {
                    if (files.length() > 2000) throw new IllegalArgumentException("归档文件数量过多。");
                    long total = 0;
                    for (int i = 0; i < files.length(); i++) {
                        JSONObject file = files.getJSONObject(i);
                        byte[] bytes = Base64.decode(file.getString("base64"), Base64.DEFAULT);
                        total += bytes.length;
                        if (total > 128L * 1024 * 1024) throw new IllegalArgumentException("归档文件总大小超过 128 MB。");
                        JSObject saved = write(file.getString("name"), file.getString("mime"), bytes, "import");
                        imported.add(Uri.parse(saved.getString("uri")));
                    }
                }
                // Full snapshot requests have already been parsed and validated; keep their original text and numeric precision.
                // Only native list actions mutate the parsed candidate and therefore require serialization here.
                long revision = database.replace(actionOnly ? next.toString() : json, expected);
                committed = true;
                // Only successful commits advance a checkpoint. Destructive commits begin a new protection window.
                if (protection == 1 && safety != null) prefs().edit().putLong("ordinary-safety-at", now).putString("ordinary-safety-tree", tree).apply();
                else if (protection == 2) prefs().edit().remove("ordinary-safety-at").remove("ordinary-safety-tree").apply();
                JSObject out = new JSObject(); out.put("revision", revision);
                if (safety != null) out.put("safetyBackup", safety);
                if (actionOnly) out.put("exportedAt", next.getString("exportedAt"));
                call.resolve(out);
            } catch (Exception error) {
                if (!committed) for (Uri uri : imported) try { DocumentsContract.deleteDocument(getContext().getContentResolver(), uri); } catch (Exception ignored) { }
                call.reject((restoring ? "恢复未完成：" : "编辑未保存：") + error.getMessage(), error);
            }
        });
    }
}
