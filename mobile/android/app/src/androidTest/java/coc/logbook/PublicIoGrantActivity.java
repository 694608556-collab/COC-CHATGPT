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
            for(String name:new String[]{"public-io-library.json","public-io-card.xlsx","public-io-card-spill.xlsx","public-io-card.xls","public-io-table.csv","public-io-table.xlsx","public-io-table.xls"}){
                // Optional user-selected card is copied into this test UID at
                // runtime by the local runner. It is never an APK asset.
                boolean localCard=getIntent().getBooleanExtra("localPrivateCard",false)&&name.equals("public-io-card.xlsx");
                boolean localTable=getIntent().getBooleanExtra("localPrivateTable",false)&&name.equals("public-io-table.xlsx");
                if(localTable){
                    java.io.File marker=new java.io.File(getFilesDir(),"local-table-owner.txt");if(!marker.createNewFile())throw new IllegalStateException("Refuse existing private table ownership marker");
                    try(java.io.OutputStream output=new java.io.FileOutputStream(marker)){output.write(id.getBytes(java.nio.charset.StandardCharsets.UTF_8));}
                }
                try(java.io.InputStream input=localCard||localTable?new java.io.FileInputStream(new java.io.File(getFilesDir(),localTable?"local-table-input.xlsx":"local-card-input.xlsx")):getAssets().open(name);java.io.OutputStream output=new java.io.FileOutputStream(new java.io.File(directory,name))){byte[] buffer=new byte[65536];int count;while((count=input.read(buffer))!=-1)output.write(buffer,0,count);}
            }
            String searchInput=getIntent().getStringExtra("privateSearchInput");
            if(searchInput!=null){
                if(!searchInput.matches("private-search-input-[a-f0-9]{64}\\.json"))throw new IllegalStateException("Refuse unknown private search source");
                for(String name:new String[]{searchInput,searchInput.replace("input-","reference-")}){
                    String destination=name.equals(searchInput)?"private-search-resume.json":"private-search-reference.json";
                    try(java.io.InputStream input=new java.io.FileInputStream(new java.io.File(getFilesDir(),name));java.io.OutputStream output=new java.io.FileOutputStream(new java.io.File(directory,destination))){byte[] buffer=new byte[65536];int count;while((count=input.read(buffer))!=-1)output.write(buffer,0,count);}
                }
            }
        }catch(java.io.IOException error){throw new IllegalStateException("Public fixture preparation failed",error);}
        grantUriPermission(target,android.net.Uri.parse(value),android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION|android.content.Intent.FLAG_GRANT_WRITE_URI_PERMISSION|android.content.Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION|android.content.Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
        finish();
    }
}
