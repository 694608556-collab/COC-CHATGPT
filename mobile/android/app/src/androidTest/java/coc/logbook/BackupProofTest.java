package coc.logbook;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.io.*;
import java.security.MessageDigest;
import java.util.Locale;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Public byte fixtures check the complete native proof, including failure at EOF. */
@RunWith(AndroidJUnit4.class)
public final class BackupProofTest {
    @Test public void everyDigestByteMatchesTheIndependentFormatter() {
        byte[] values=new byte[256];StringBuilder expected=new StringBuilder();
        for(int index=0;index<values.length;index++){values[index]=(byte)index;expected.append(String.format(Locale.ROOT,"%02x",index));}
        assertEquals(expected.toString(),BackupSession.digestHex(values));assertEquals("",BackupSession.digestHex(new byte[0]));
    }
    @Test public void completeMultiBufferProofReadsEveryByteAndEof()throws Exception {
        byte[] bytes=new byte[3*65536+17];for(int index=0;index<bytes.length;index++)bytes[index]=(byte)(index*37);
        int[] eof={0};InputStream input=new ByteArrayInputStream(bytes){
            public synchronized int read(byte[] buffer,int offset,int count){int read=super.read(buffer,offset,Math.min(count,997));if(read<0)eof[0]++;return read;}
        };
        BackupSession.Proof proof=BackupSession.streamProof(input,bytes.length);
        StringBuilder expected=new StringBuilder();for(byte value:MessageDigest.getInstance("SHA-256").digest(bytes))expected.append(String.format(Locale.ROOT,"%02x",value&255));
        proof.matches(bytes.length,expected.toString());assertEquals(1,eof[0]);
        try{proof.matches(bytes.length-1,expected.toString());fail("Incorrect complete length accepted");}catch(IOException required){}
        try{proof.matches(bytes.length,expected.substring(1)+"0");fail("Incorrect complete digest accepted");}catch(IOException required){}
    }
    @Test public void emptyInputKeepsTheStandardCompleteProof()throws Exception {
        BackupSession.streamProof(new ByteArrayInputStream(new byte[0]),0).matches(0,"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    }
    @Test public void oversizeInvalidBudgetAndReadFailuresNeverProduceAProof()throws Exception {
        for(long maximum:new long[]{-1,StorageBudget.JS_SAFE_INTEGER+1})try{BackupSession.streamProof(new ByteArrayInputStream(new byte[1]),maximum);fail("Invalid proof budget accepted");}catch(IOException required){}
        try{BackupSession.streamProof(null,1);fail("Missing input accepted");}catch(IOException required){}
        try{BackupSession.streamProof(new ByteArrayInputStream(new byte[2]),1);fail("Unproven trailing byte accepted");}catch(IOException required){}
        IOException failure=new IOException("public EOF failure");
        try{BackupSession.streamProof(new InputStream(){public int read()throws IOException{throw failure;}},4);fail("Read failure accepted");}catch(IOException actual){assertSame(failure,actual);}
    }
}
