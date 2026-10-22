package coc.logbook;

/** Runs under the test APK UID so the production bridge sees a real live grant. */
public final class PublicTableGrantActivity extends android.app.Activity {
    @Override public void onCreate(android.os.Bundle saved){
        super.onCreate(saved);
        String target=getIntent().getStringExtra("publicTarget"),value=getIntent().getStringExtra("publicUri");
        if(target==null||!target.matches("coc\\.logbook\\.debug[0-9]+")||!getPackageName().equals(target+".test")||value==null||!value.startsWith("content://coc.logbook.public.tabletest/tree/public-"))throw new IllegalStateException("Refuse non-public test grant");
        grantUriPermission(target,android.net.Uri.parse(value),android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION|android.content.Intent.FLAG_GRANT_WRITE_URI_PERMISSION|android.content.Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        finish();
    }
}
