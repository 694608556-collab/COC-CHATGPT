package coc.logbook;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.io.*;
import java.nio.ByteBuffer;
import java.nio.charset.*;
import java.util.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Independent platform decoder is the oracle for the actual candidate-line seam. */
@RunWith(AndroidJUnit4.class)
public final class TableLineUtf8Test {
    private static String platform(byte[] bytes)throws Exception {
        return StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString();
    }
    private static void same(byte[] bytes,int chunk)throws Exception {
        String expected=null;boolean valid=true;
        try{expected=platform(bytes);}catch(CharacterCodingException invalid){valid=false;}
        byte[] complete=Arrays.copyOf(bytes,bytes.length+1);complete[bytes.length]=10;
        List<String> values=new ArrayList<>();List<Long> lengths=new ArrayList<>();boolean accepted=true;
        TableSession.Lines lines=new TableSession.Lines();
        try{
            for(int offset=0;offset<complete.length;offset+=chunk)lines.appendWithProof(complete,offset,Math.min(chunk,complete.length-offset),(value,length)->{values.add(value);lengths.add(length);});
            lines.finish();
        }catch(CharacterCodingException invalid){accepted=false;}
        assertEquals("Strict UTF-8 acceptance differs",valid,accepted);
        if(valid){assertEquals(Collections.singletonList(expected),values);assertEquals(Collections.singletonList((long)bytes.length),lengths);}
        else assertTrue("Invalid complete line must not reach a consumer",values.isEmpty());
    }
    @Test public void unicodeScalarBoundariesControlsAndNoncharactersRemainComplete()throws Exception {
        StringBuilder value=new StringBuilder();for(int unit=0;unit<128;unit++)if(unit!=10)value.append((char)unit);
        for(int point:new int[]{0x7f,0x80,0x7ff,0x800,0xd7ff,0xe000,0xffff,0x10000,0x10ffff})value.appendCodePoint(point);
        Random random=new Random(20261023);for(int index=0;index<12000;index++){int point=random.nextInt(0x110000);if(point==10||point>=0xd800&&point<=0xdfff)continue;value.appendCodePoint(point);}
        byte[] bytes=value.toString().getBytes(StandardCharsets.UTF_8);same(bytes,1);same(bytes,65536);same(new byte[0],1);
    }
    @Test public void everyOneAndTwoByteSequenceMatchesStrictPlatformAcceptance()throws Exception {
        for(int first=0;first<256;first++)if(first!=10){same(new byte[]{(byte)first},2);for(int second=0;second<256;second++)if(second!=10)same(new byte[]{(byte)first,(byte)second},3);}
    }
    @Test public void overlongSurrogateOverflowAndTruncatedMultiByteSequencesAreRejected()throws Exception {
        int[][] invalid={{0xc0,0x80},{0xc1,0xbf},{0xe0,0x80,0x80},{0xe0,0x9f,0xbf},{0xed,0xa0,0x80},{0xed,0xbf,0xbf},{0xf0,0x80,0x80,0x80},{0xf0,0x8f,0xbf,0xbf},{0xf4,0x90,0x80,0x80},{0xf5,0x80,0x80,0x80},{0xff},{0x80},{0xc2},{0xe0,0xa0},{0xf0,0x90,0x80},{0xf4,0x8f,0xbf,0xff}};
        for(int[] input:invalid){byte[] bytes=new byte[input.length];for(int index=0;index<input.length;index++)bytes[index]=(byte)input[index];same(bytes,1);same(bytes,65536);}
        byte[] prefix=(String.join("",Collections.nCopies(90000,"完整😀中"))).getBytes(StandardCharsets.UTF_8);
        byte[] tail=Arrays.copyOf(prefix,prefix.length+3);tail[prefix.length]=(byte)0xf0;tail[prefix.length+1]=(byte)0x90;tail[prefix.length+2]=(byte)0x80;same(tail,65535);
    }
    @Test public void randomizedWholeLinesAndEveryTruncatedUnicodeTailMatchThePlatform()throws Exception {
        Random random=new Random(20261024);for(int index=0;index<2000;index++){byte[] bytes=new byte[random.nextInt(65)];random.nextBytes(bytes);for(int at=0;at<bytes.length;at++)if(bytes[at]==10)bytes[at]=11;same(bytes,1+random.nextInt(33));}
        for(String scalar:new String[]{"\u0080","\u07ff","\u0800","\ud7ff","\ue000","\uffff","😀",new String(Character.toChars(0x10ffff))}){
            byte[] bytes=scalar.getBytes(StandardCharsets.UTF_8);for(int count=0;count<=bytes.length;count++)same(Arrays.copyOf(bytes,count),1);
        }
    }
}
