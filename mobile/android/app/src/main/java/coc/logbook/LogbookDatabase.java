package coc.logbook;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

/** Versioned Android-owned snapshot store, never opens the desktop database. */
final class LogbookDatabase extends SQLiteOpenHelper {
    private java.util.Map<String, String> baseFields;
    LogbookDatabase(Context context) { super(context, "coc-logbook.sqlite", null, 3); }
    @Override public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE app_state(id INTEGER PRIMARY KEY CHECK(id=1), json TEXT, revision INTEGER NOT NULL)");
        db.execSQL("INSERT INTO app_state VALUES(1,NULL,0)");
        db.execSQL("CREATE TABLE snapshot_chunks(position INTEGER PRIMARY KEY, data TEXT NOT NULL)");
        createFields(db);
    }
    @Override public void onUpgrade(SQLiteDatabase db, int before, int after) {
        if (before == 1 && after == 3) createFields(db);
        else if (before == 2 && after == 3) { /* Existing chunks/fields are retained byte for byte. */ }
        else throw new IllegalStateException("数据库版本暂不兼容，未清空任何数据。");
    }
    private void createFields(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE snapshot_fields(field TEXT NOT NULL,position INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(field,position))");
    }
    private String baseSnapshot() {
        try (Cursor row = getReadableDatabase().rawQuery("SELECT json FROM app_state WHERE id=1", null)) {
            row.moveToFirst(); if (row.isNull(0)) return null;
        }
        // Android 9 CursorWindow cannot hold one large 75-session JSON row. Keep each row bounded.
        StringBuilder json = new StringBuilder();
        try (Cursor chunks = getReadableDatabase().rawQuery("SELECT data FROM snapshot_chunks ORDER BY position", null)) {
            while (chunks.moveToNext()) json.append(chunks.getString(0));
        }
        if (json.length() == 0) throw new IllegalStateException("数据库正文不完整，未重置数据。");
        return json.toString();
    }
    /** Stored metadata overrides survive restart; full restores atomically replace base and clear overrides. */
    synchronized java.util.Map<String, String> fields() {
        if (baseFields == null) {
            String base = baseSnapshot();
            if (base == null) return null;
            baseFields = JsonFields.split(base);
        }
        java.util.Map<String, String> fields = new java.util.LinkedHashMap<>(baseFields);
        try (Cursor rows = getReadableDatabase().rawQuery("SELECT field,data FROM snapshot_fields ORDER BY field,position", null)) {
            String previous = null; StringBuilder value = new StringBuilder();
            while (rows.moveToNext()) {
                String field = rows.getString(0);
                if (!field.equals(previous)) {
                    if (previous != null) fields.put(previous, value.toString());
                    previous = field; value.setLength(0);
                }
                value.append(rows.getString(1));
            }
            if (previous != null) fields.put(previous, value.toString());
        }
        return fields;
    }
    synchronized String snapshot() {
        // Preserve the exact imported text until the first metadata patch, including legacy v1 upgrades.
        try (Cursor rows = getReadableDatabase().rawQuery("SELECT 1 FROM snapshot_fields LIMIT 1", null)) {
            if (!rows.moveToFirst()) return baseSnapshot();
        }
        java.util.Map<String,String> fields = fields();
        try { RecordOverlay.compose(fields); }
        catch (Exception error) { throw new IllegalStateException("场次数据不完整，未重置数据。", error); }
        return JsonFields.join(fields);
    }
    /** Only trusted native-produced fields reach here. CAS and all field updates share one transaction. */
    synchronized long replaceFields(java.util.Map<String, String> fields, long expected) {
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            if (revision() != expected) throw new IllegalStateException("数据已变化，请重新读取。");
            try (Cursor row = db.rawQuery("SELECT json IS NOT NULL FROM app_state WHERE id=1", null)) {
                if (!row.moveToFirst() || row.getInt(0) != 1) throw new IllegalStateException("尚无已保存数据。");
            }
            try (android.database.sqlite.SQLiteStatement insert = db.compileStatement("INSERT INTO snapshot_fields VALUES(?,?,?)")) {
                for (java.util.Map.Entry<String, String> field : fields.entrySet()) {
                    db.execSQL("DELETE FROM snapshot_fields WHERE field=?", new Object[]{field.getKey()});
                    String value = field.getValue(); int position = 0;
                    for (int start = 0; start < value.length();) {
                        int end = Math.min(start + 65536, value.length());
                        if (end < value.length() && Character.isHighSurrogate(value.charAt(end - 1))) end--;
                        insert.bindString(1, field.getKey()); insert.bindLong(2, position++);
                        insert.bindString(3, value.substring(start, end)); insert.executeInsert(); start = end;
                    }
                }
            }
            db.execSQL("UPDATE app_state SET revision=? WHERE id=1", new Object[]{expected + 1});
            db.setTransactionSuccessful(); return expected + 1;
        } finally { db.endTransaction(); }
    }
    long revision() {
        try (Cursor row = getReadableDatabase().rawQuery("SELECT revision FROM app_state WHERE id=1", null)) {
            row.moveToFirst(); return row.getLong(0);
        }
    }
    /** Compare-and-swap under SQLite transaction; failures leave the previous snapshot intact. */
    synchronized long replace(String json, long expected) {
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            if (revision() != expected) throw new IllegalStateException("数据已变化，请重新预览备份。");
            db.execSQL("DELETE FROM snapshot_chunks");
            db.execSQL("DELETE FROM snapshot_fields");
            try (android.database.sqlite.SQLiteStatement insert = db.compileStatement("INSERT INTO snapshot_chunks VALUES(?,?)")) {
                int position = 0;
                for (int start = 0; start < json.length();) {
                    int end = Math.min(start + 65536, json.length());
                    // Never split a UTF-16 surrogate pair before SQLite encodes the chunk.
                    if (end < json.length() && Character.isHighSurrogate(json.charAt(end - 1))) end--;
                    insert.bindLong(1, position++); insert.bindString(2, json.substring(start, end)); insert.executeInsert();
                    start = end;
                }
            }
            db.execSQL("UPDATE app_state SET json='chunked-v1',revision=? WHERE id=1", new Object[]{expected + 1});
            db.setTransactionSuccessful();
            baseFields = null;
            return expected + 1;
        } finally { db.endTransaction(); }
    }
}
