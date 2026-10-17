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
        importLegacy(legacy);
        try (android.database.sqlite.SQLiteStatement insert = getWritableDatabase().compileStatement("INSERT INTO documents(uri,json) VALUES(?,?)")) {
            insert.bindString(1, entry.getString("uri"));
            insert.bindString(2, entry.toString());
            insert.executeInsert();
        }
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
}
