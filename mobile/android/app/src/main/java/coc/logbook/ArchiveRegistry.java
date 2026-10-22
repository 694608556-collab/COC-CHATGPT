package coc.logbook;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import org.json.JSONArray;
import org.json.JSONObject;

/** Append-only archive proofs, independent of business data/revision. Legacy preferences remain recoverable. */
final class ArchiveRegistry extends SQLiteOpenHelper {
    private boolean imported;
    ArchiveRegistry(Context context) { super(context, "archive-index.db", null, 1); }
    @Override public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE documents(position INTEGER PRIMARY KEY AUTOINCREMENT,uri TEXT NOT NULL,json TEXT NOT NULL)");
        db.execSQL("CREATE INDEX document_uri ON documents(uri,position)");
        db.execSQL("CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL)");
    }
    @Override public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        throw new IllegalStateException("Unsupported archive registry upgrade");
    }
    /** Import the complete old list atomically once. Never removes original preferences or actual files. */
    private void importLegacy(String legacy) throws Exception {
        if (imported) return;
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            boolean exists;
            try (Cursor row = db.rawQuery("SELECT 1 FROM metadata WHERE key='legacy-imported'", null)) {
                exists = row.moveToFirst();
            }
            if (!exists) {
                JSONArray entries = new JSONArray(legacy);
                try (android.database.sqlite.SQLiteStatement insert = db.compileStatement("INSERT INTO documents(uri,json) VALUES(?,?)")) {
                    for (int i = 0; i < entries.length(); i++) {
                        JSONObject entry = entries.getJSONObject(i);
                        insert.bindString(1, entry.getString("uri"));
                        insert.bindString(2, entry.toString());
                        insert.executeInsert();
                    }
                }
                db.execSQL("INSERT INTO metadata VALUES('legacy-imported','1')");
            }
            db.setTransactionSuccessful();
        } finally { db.endTransaction(); }
        imported = true;
    }
    /** Durable append without serializing and rewriting every earlier proof for each exported file. */
    synchronized void add(JSONObject entry, String legacy) throws Exception {
        add(entry,legacy,null);
    }
    /** Append the verified proof and clear its pending publication in the same durable transaction. */
    synchronized void add(JSONObject entry, String legacy, String publicationId) throws Exception {
        importLegacy(legacy);
        SQLiteDatabase db = getWritableDatabase(); db.beginTransaction();
        try {
            try (android.database.sqlite.SQLiteStatement insert = db.compileStatement("INSERT INTO documents(uri,json) VALUES(?,?)")) {
                insert.bindString(1, entry.getString("uri")); insert.bindString(2, entry.toString()); insert.executeInsert();
            }
            if (publicationId != null) db.delete("metadata", "key=?", new String[]{"publication:" + publicationId});
            db.setTransactionSuccessful();
        } finally { db.endTransaction(); }
    }
    /** Retain registration order and duplicate URIs; the normal UI requests only the latest thirty. */
    synchronized JSONArray list(boolean all, String legacy) throws Exception {
        importLegacy(legacy);
        JSONArray result = new JSONArray();
        String query = all ? "SELECT json FROM documents ORDER BY position" :
            "SELECT json FROM (SELECT position,json FROM documents ORDER BY position DESC LIMIT 30) ORDER BY position";
        try (Cursor rows = getReadableDatabase().rawQuery(query, null)) {
            while (rows.moveToNext()) result.put(new JSONObject(rows.getString(0)));
        }
        return result;
    }
    /** Match the previous latest-registration lookup without a complete history scan. */
    synchronized JSONObject find(String uri, String legacy) throws Exception {
        importLegacy(legacy);
        try (Cursor row = getReadableDatabase().rawQuery("SELECT json FROM documents WHERE uri=? ORDER BY position DESC LIMIT 1", new String[]{uri})) {
            return row.moveToFirst() ? new JSONObject(row.getString(0)) : null;
        }
    }
    /** Only a newly created, independently verified import may be compensated.
     * Existing/changed documents never lose their registration. */
    synchronized void forgetImported(String uri,String expectedHash,String legacy)throws Exception{
        JSONObject value=find(uri,legacy);
        if(value==null||!"import".equals(value.optString("purpose"))||!expectedHash.equals(value.optString("sha256")))throw new IllegalStateException("新附件登记已变化，已保留。");
        getWritableDatabase().delete("documents","uri=?",new String[]{uri});
    }
    /** Private recovery records share the durable index without changing any archive proofs or database version. */
    synchronized JSONArray pendingPublications() throws Exception {
        JSONArray result = new JSONArray();
        try (Cursor rows = getReadableDatabase().rawQuery("SELECT value FROM metadata WHERE key LIKE 'publication:%' ORDER BY key", null)) {
            while (rows.moveToNext()) result.put(new JSONObject(rows.getString(0)));
        }
        return result;
    }
    synchronized void putPublication(JSONObject value) throws Exception {
        getWritableDatabase().execSQL("INSERT OR REPLACE INTO metadata(key,value) VALUES(?,?)", new Object[]{"publication:" + value.getString("id"), value.toString()});
    }
    synchronized void removePublication(String id) {
        // Success already removes the record atomically with registration; avoid a redundant write transaction.
        try (Cursor row = getReadableDatabase().rawQuery("SELECT 1 FROM metadata WHERE key=?", new String[]{"publication:" + id})) {
            if (!row.moveToFirst()) return;
        }
        getWritableDatabase().delete("metadata", "key=?", new String[]{"publication:" + id});
    }
}
