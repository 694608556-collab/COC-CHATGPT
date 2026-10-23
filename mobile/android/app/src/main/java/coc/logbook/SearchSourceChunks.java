package coc.logbook;

import java.io.IOException;
import java.io.OutputStream;

/** Immutable slices of the exact full source; no partial result or write authority. */
final class SearchSourceChunks extends OutputStream implements SearchSnapshot.Boundaries {
    interface Published {void part(int index,String kind,String key)throws Exception;}
    private final BackupSession owner;
    private final OutputStream full;
    private final long maximumBytes;
    private final Published published;
    private final long targetBytes,recordLimit;
    private OutputStream part;
    private String kind="root";
    private int index,records;
    private long bytes,total;
    private boolean complete;
    SearchSourceChunks(BackupSession owner,OutputStream full,long maximumBytes,Published published){
        this(owner,full,maximumBytes,published,256*1024,4);
    }
    SearchSourceChunks(BackupSession owner,OutputStream full,long maximumBytes,Published published,long targetBytes){
        this(owner,full,maximumBytes,published,targetBytes,Long.MAX_VALUE);
    }
    private SearchSourceChunks(BackupSession owner,OutputStream full,long maximumBytes,Published published,long targetBytes,long recordLimit){
        if(targetBytes<1)throw new IllegalArgumentException("搜索分片传输预算无效。");
        this.owner=owner;this.full=full;this.maximumBytes=maximumBytes;this.published=published;this.targetBytes=targetBytes;this.recordLimit=recordLimit;
    }
    @Override public void write(int value)throws IOException{write(new byte[]{(byte)value},0,1);}
    @Override public void write(byte[] value,int start,int length)throws IOException{
        if(complete)throw new IOException("搜索分片已结束。");
        if(length==0)return;
        if(length<0||total>maximumBytes-length)throw new SearchSnapshot.Unavailable();
        try{
            if(part==null)part=owner.beginSearchPart(index);
            full.write(value,start,length);part.write(value,start,length);
            bytes+=length;total+=length;
        }catch(IOException error){throw error;}catch(Exception error){throw new IOException(error);}
    }
    private void seal()throws Exception{
        if(part==null)return;
        String key=owner.finishSearchPart(index);
        published.part(index,kind,key);index++;part=null;bytes=0;records=0;
    }
    @Override public void boundary(String boundary)throws Exception{
        if(complete)throw new IOException("搜索分片边界重复。");
        switch(boundary){
            case "root":
                if(!kind.equals("root")||part==null)throw new IOException("搜索根分片无效。");
                seal();kind="records";break;
            case "record":
                if(!kind.equals("records")||part==null)throw new IOException("搜索记录分片无效。");
                // These are transport grouping thresholds, never content limits.
                // Start useful worker work promptly, then amortize transport
                // over coarse groups. Neither threshold limits record content.
                long groupBytes=index==1?Math.min(targetBytes,128L*1024):targetBytes;
                if(++records>=recordLimit||bytes>=groupBytes)seal();break;
            case "recordsEnd":
                if(!kind.equals("records"))throw new IOException("搜索记录结束次序无效。");
                seal();kind="tail";break;
            case "tail":
                if(!kind.equals("tail")||bytes!=3)throw new IOException("搜索尾部分片无效。");
                seal();complete=true;break;
            default:throw new IOException("搜索分片边界无效。");
        }
    }
    int count()throws IOException{if(!complete)throw new IOException("搜索分片尚未完整。");return index;}
}
