package coc.logbook;

/** Grants only this test APK's new public fixture directory to its own debug application. */
public final class PublicIoGrantActivity extends android.app.Activity {
    @Override public void onCreate(android.os.Bundle saved){
        super.onCreate(saved);
        String target=getIntent().getStringExtra("publicTarget"),value=getIntent().getStringExtra("publicUri");
        if(target==null||!target.equals("coc.logbook.debug55")||!getPackageName().equals(target+".test")||value==null||!value.matches("content://coc\\.logbook\\.public\\.iotest55/tree/public-[a-f0-9-]+"))throw new IllegalStateException("Refuse non-public test grant");
        // Fixture files belong to the provider UID, not the instrumented target UID.
        String id=android.provider.DocumentsContract.getTreeDocumentId(android.net.Uri.parse(value));
        java.io.File directory=new java.io.File(getFilesDir(),"public-io/"+id);
        if(directory.exists()||!directory.mkdirs())throw new IllegalStateException("Refuse existing public fixture directory");
        try{
            for(String name:new String[]{"public-io-library.json","public-io-card.xlsx","public-io-card.xls","public-io-table.csv","public-io-table.xlsx","public-io-table.xls"}){
                try(java.io.InputStream input=getAssets().open(name);java.io.OutputStream output=new java.io.FileOutputStream(new java.io.File(directory,name))){byte[] buffer=new byte[65536];int count;while((count=input.read(buffer))!=-1)output.write(buffer,0,count);}
            }
        }catch(java.io.IOException error){throw new IllegalStateException("Public fixture preparation failed",error);}
        grantUriPermission(target,android.net.Uri.parse(value),android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION|android.content.Intent.FLAG_GRANT_WRITE_URI_PERMISSION|android.content.Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION|android.content.Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
        finish();
    }
}
