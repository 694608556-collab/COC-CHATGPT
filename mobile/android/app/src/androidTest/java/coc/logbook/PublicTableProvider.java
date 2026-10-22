package coc.logbook;

/** Empty provider in the instrumentation APK only. It contains no user files. */
public final class PublicTableProvider extends android.content.ContentProvider {
    public boolean onCreate(){return true;}
    public String getType(android.net.Uri uri){return "vnd.android.document/directory";}
    public android.database.Cursor query(android.net.Uri uri,String[] columns,String selection,String[] args,String order){return new android.database.MatrixCursor(columns==null?new String[]{"document_id"}:columns);}
    public android.net.Uri insert(android.net.Uri uri,android.content.ContentValues values){throw new UnsupportedOperationException();}
    public int update(android.net.Uri uri,android.content.ContentValues values,String selection,String[] args){throw new UnsupportedOperationException();}
    public int delete(android.net.Uri uri,String selection,String[] args){throw new UnsupportedOperationException();}
}
