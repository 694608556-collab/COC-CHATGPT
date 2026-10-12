package coc.logbook;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

/** Versioned Android-owned snapshot store, never opens the desktop database. */
final class LogbookDatabase extends SQLiteOpenHelper {
    LogbookDatabase(Context context) { super(context, "coc-logbook.sqlite", null, 1); }
    @Override public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE app_state(id INTEGER PRIMARY KEY CHECK(id=1), json TEXT, revision INTEGER NOT NULL)");
        db.execSQL("INSERT INTO app_state VALUES(1,NULL,0)");
        db.execSQL("CREATE TABLE snapshot_chunks(position INTEGER PRIMARY KEY, data TEXT NOT NULL)");
    }
    @Override public void onUpgrade(SQLiteDatabase db, int before, int after) {
        throw new IllegalStateException("数据库版本暂不兼容，未清空任何数据。");
    }
    String snapshot() {
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
    long revision() {
        try (Cursor row = getReadableDatabase().rawQuery("SELECT revision FROM app_state WHERE id=1", null)) {
            row.moveToFirst(); return row.getLong(0);
        }
    }
    /** Compare-and-swap under SQLite transaction; failures leave the previous snapshot intact. */
    long replace(String json, long expected) {
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            if (revision() != expected) throw new IllegalStateException("数据已变化，请重新预览备份。");
            db.execSQL("DELETE FROM snapshot_chunks");
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
            return expected + 1;
        } finally { db.endTransaction(); }
    }
}
