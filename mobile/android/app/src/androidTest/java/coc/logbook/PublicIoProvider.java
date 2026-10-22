package coc.logbook;

import android.database.Cursor;
import android.database.MatrixCursor;
import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import android.provider.DocumentsContract.Document;
import android.provider.DocumentsContract.Root;
import android.provider.DocumentsProvider;
import java.io.File;
import java.io.FileNotFoundException;

/** Instrumentation-only real files, confined to this test APK's public UUID directories. */
public final class PublicIoProvider extends DocumentsProvider {
    public static final String AUTHORITY="coc.logbook.public.iotest55";
    @Override public boolean onCreate(){return true;}
    private File file(String id)throws FileNotFoundException{
        try{
            if(!id.matches("public-[a-f0-9-]+(?:/[^/\\\\]+)?"))throw new Exception();
            File root=new File(getContext().getFilesDir(),"public-io"), value=new File(root,id).getCanonicalFile();
            if(!value.getPath().startsWith(root.getCanonicalPath()+File.separator))throw new Exception();
            return value;
        }catch(Exception error){throw new FileNotFoundException("Refuse non-public test document");}
    }
    @Override public Cursor queryRoots(String[] projection){
        return new MatrixCursor(projection==null?new String[]{Root.COLUMN_ROOT_ID,Root.COLUMN_DOCUMENT_ID,Root.COLUMN_TITLE,Root.COLUMN_FLAGS}:projection);
    }
    private void add(MatrixCursor cursor,String id,File value){
        MatrixCursor.RowBuilder row=cursor.newRow();
        for(String column:cursor.getColumnNames()){
            switch(column){
                case Document.COLUMN_DOCUMENT_ID:row.add(id);break;
                case Document.COLUMN_DISPLAY_NAME:row.add(value.getName());break;
                case Document.COLUMN_MIME_TYPE:row.add(value.isDirectory()?Document.MIME_TYPE_DIR:"application/octet-stream");break;
                case Document.COLUMN_SIZE:row.add(value.length());break;
                case Document.COLUMN_LAST_MODIFIED:row.add(value.lastModified());break;
                case Document.COLUMN_FLAGS:row.add(value.isDirectory()?Document.FLAG_DIR_SUPPORTS_CREATE:Document.FLAG_SUPPORTS_WRITE|Document.FLAG_SUPPORTS_DELETE);break;
                default:row.add(null);
            }
        }
    }
    private MatrixCursor cursor(String[] columns){return new MatrixCursor(columns==null?new String[]{Document.COLUMN_DOCUMENT_ID,Document.COLUMN_DISPLAY_NAME,Document.COLUMN_MIME_TYPE,Document.COLUMN_SIZE,Document.COLUMN_FLAGS}:columns);}
    @Override public Cursor queryDocument(String id,String[] columns)throws FileNotFoundException{File value=file(id);if(!value.exists())throw new FileNotFoundException();MatrixCursor result=cursor(columns);add(result,id,value);return result;}
    @Override public Cursor queryChildDocuments(String id,String[] columns,String order)throws FileNotFoundException{MatrixCursor result=cursor(columns);File[] files=file(id).listFiles();if(files!=null)for(File value:files)add(result,id+"/"+value.getName(),value);return result;}
    @Override public boolean isChildDocument(String parent,String child){try{return child.startsWith(parent+"/")&&file(child).getPath().startsWith(file(parent).getPath()+File.separator);}catch(FileNotFoundException denied){return false;}}
    @Override public String createDocument(String parent,String mime,String name)throws FileNotFoundException{
        if(name==null||name.contains("/")||name.contains("\\")||name.equals(".")||name.equals(".."))throw new FileNotFoundException();
        File directory=file(parent),value=file(parent+"/"+name);
        try{if(!directory.isDirectory()||!value.createNewFile())throw new Exception();return parent+"/"+name;}catch(Exception error){throw new FileNotFoundException("Cannot create public test file");}
    }
    @Override public void deleteDocument(String id)throws FileNotFoundException{if(!file(id).delete())throw new FileNotFoundException("Cannot delete public test file");}
    @Override public ParcelFileDescriptor openDocument(String id,String mode,CancellationSignal signal)throws FileNotFoundException{return ParcelFileDescriptor.open(file(id),ParcelFileDescriptor.parseMode(mode));}
}
