package coc.logbook;

import java.io.*;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.*;
import org.json.JSONArray;
import org.json.JSONObject;

/** Durable ownership of an unregistered new archive; recovery never scans shared directories. */
final class ArchivePublication {
    interface Store {
        JSONArray pending() throws Exception;
        void put(JSONObject value) throws Exception;
        void remove(String id) throws Exception;
    }
    interface Documents {
        boolean registered(String uri) throws Exception;
        boolean exists(JSONObject value) throws Exception;
        InputStream open(String uri) throws Exception;
        boolean delete(String uri) throws Exception;
    }
    private final File directory;
    private final Store store;
    private final Documents documents;
    private final Set<String> active;
    ArchivePublication(File directory, Store store, Documents documents) throws Exception {
        this(directory,store,documents,new HashSet<>());
    }
    /** Production owners share process-active IDs across Activity recreation; a restarted process starts empty. */
    ArchivePublication(File directory, Store store, Documents documents, Set<String> active) throws Exception {
        this.directory = directory; this.store = store; this.documents = documents; this.active = active;
        if (!directory.isDirectory() && !directory.mkdirs() && !directory.isDirectory()) throw new IOException("无法创建发布恢复目录。");
    }
    /** Pin the sealed source before any destination bytes are written, then durably record its exact URI. */
    JSONObject begin(File source, String uri, String location, long bytes, String hash) throws Exception {
        return begin(source,uri,location,bytes,hash,"export");
    }
    /** Backup purpose is persisted explicitly for restart recovery;
     * all complete files use actual device resources. */
    JSONObject begin(File source, String uri, String location, long bytes, String hash,String purpose) throws Exception {
        synchronized (active) {
            if (store.pending().length() >= 4) throw new IOException("请先处理未完成的归档发布，再重新导出。");
            boolean largeBackup=purpose.equals("backup")||purpose.equals("auto");
            if (bytes < 0 || bytes > StorageBudget.JS_SAFE_INTEGER || source.length() != bytes || !hash.matches("[a-f0-9]{64}"))
                throw new IOException("发布文件证明不完整。");
            if (documents.registered(uri)) throw new IOException("文件已登记，拒绝覆盖。");
            String id = UUID.randomUUID().toString(); File proof = proof(id);
            active.add(id);
            try {
                try { Files.createLink(proof.toPath(), source.toPath()); }
                catch (IOException | UnsupportedOperationException error) { StorageBudget.require(StorageBudget.volume(directory),bytes);Files.copy(source.toPath(), proof.toPath()); }
                try (FileOutputStream sync = new FileOutputStream(proof, true)) { sync.getFD().sync(); }
                JSONObject value = new JSONObject().put("id", id).put("uri", uri).put("location", location)
                    .put("bytes", bytes).put("sha256", hash);
                if(largeBackup)value.put("version",2).put("purpose",purpose);
                store.put(value); return value;
            } catch (Exception error) { active.remove(id); if (proof.exists() && !proof.delete() && proof.exists()) error.addSuppressed(new IOException("发布证明清理失败。")); throw error; }
        }
    }
    /** Registration is durable first; a stale pending record can never delete a registered document. */
    void committed(JSONObject value) throws Exception {
        synchronized (active) { try { forget(value); } finally { active.remove(value.getString("id")); } }
    }
    /** Failed cleanup keeps both the proof and record, even when the caller deletes its spool. */
    void abort(JSONObject value) throws Exception {
        synchronized (active) { active.remove(value.getString("id")); recoverOne(value); }
    }
    /** Recover only exact recorded URIs; active automatic backups and exports are excluded. */
    void recover() throws Exception {
        recoverFor(null);
    }
    /** Unavailable old locations retain their proof without blocking a different authorized destination. */
    void recoverFor(String location) throws Exception {
        // One process-wide ownership gate also protects proof collection across different Activity owners.
        synchronized (active) {
            JSONArray pending = store.pending(); Set<String> retained = new HashSet<>(active);
            for (int i = 0; i < pending.length(); i++) {
                JSONObject value = pending.getJSONObject(i); String id = value.getString("id");
                retained.add(id);
                if (!active.contains(id) && (location == null || location.equals(value.getString("location")))) { recoverOne(value); retained.remove(id); }
            }
            File[] files = directory.listFiles();
            if (files == null) throw new IOException("无法读取发布恢复目录。");
            for (File file : files) if (file.getName().matches("coc-publication-[a-f0-9-]+\\.part")) {
                String id = file.getName().substring(16, file.getName().length() - 5);
                if (!retained.contains(id) && !file.delete() && file.exists()) throw new IOException("发布证明清理失败。");
            }
        }
    }
    private File proof(String id) throws IOException {
        if (!id.matches("[a-f0-9-]{36}")) throw new IOException("发布恢复标识不合法。");
        return new File(directory, "coc-publication-" + id + ".part");
    }
    private void recoverOne(JSONObject value) throws Exception {
        String uri = value.getString("uri");
        if (documents.registered(uri)) { forget(value); return; }
        if (!documents.exists(value)) { forget(value); return; }
        File proof = proof(value.getString("id")); long bytes = value.getLong("bytes");
        if (bytes < 0 || bytes > StorageBudget.JS_SAFE_INTEGER || !proof.isFile() || proof.length() != bytes || !hash(proof).equals(value.getString("sha256")))
            throw new IOException("上次未完成的文件暂时无法核对，已保留；请检查归档目录后重试。");
        try (InputStream expected = new FileInputStream(proof); InputStream actual = documents.open(uri)) {
            if (actual == null) throw new IOException("无法核对上次未完成文件。");
            byte[] chunk = new byte[32768], reference = new byte[32768]; int count;
            while ((count = actual.read(chunk)) != -1) {
                int offset = 0;
                while (offset < count) {
                    int read = expected.read(reference,offset,count-offset);
                    if (read == -1) throw new IOException("上次未完成文件已被修改，已保留；请检查归档目录后重试。");
                    offset += read;
                }
                for (int i = 0; i < count; i++) if (reference[i] != chunk[i])
                    throw new IOException("上次未完成文件已被修改，已保留；请检查归档目录后重试。");
            }
        }
        if (!documents.delete(uri)) throw new IOException("上次未完成文件清理失败，已保留恢复记录；请恢复目录权限后重试。");
        forget(value);
    }
    private void forget(JSONObject value) throws Exception {
        String id = value.getString("id"); store.remove(id); active.remove(id);
        File proof = proof(id); if (proof.exists() && !proof.delete() && proof.exists()) throw new IOException("发布证明清理失败。");
    }
    private static String hash(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream input = new FileInputStream(file)) { byte[] b = new byte[32768]; int n; while ((n = input.read(b)) != -1) digest.update(b, 0, n); }
        StringBuilder out = new StringBuilder(); for (byte b : digest.digest()) out.append(String.format("%02x", b & 255)); return out.toString();
    }
}
