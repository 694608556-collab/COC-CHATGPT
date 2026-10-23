package coc.logbook;

import android.database.sqlite.SQLiteDatabase;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import org.json.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public final class SearchSnapshotTest {
    @Test public void projectedSourceRetainsSearchFieldsFullManualAndOriginalProofWithoutChangingDatabase()throws Exception{
        try(SQLiteDatabase db=SQLiteDatabase.create(null)){
            IndexedSnapshot.create(db);IndexedSnapshot store=new IndexedSnapshot(db,false,()->Long.MAX_VALUE);
            String original="{\"schemaVersion\":2,\"records\":[{\"id\":\"r1\",\"moduleId\":\"m1\",\"rawContent\":{\"parserVersion\":1,\"messages\":[{\"id\":\"msg\",\"order\":0,\"displayName\":\"公开\",\"text\":\"完整😀BODY_END\",\"type\":\"text\",\"isDiceCommand\":false,\"isOffTopic\":false,\"images\":[],\"raw\":{\"n\":9007199254740993,\"tail\":\"RAW_END\"}}]},\"manualContent\":\"完整手动😀MANUAL_END\"}]}";
            store.replace(new StringReader(original));
            StringWriter full=new StringWriter();store.write(full,Collections.singleton("r1"));
            byte[] expected=("{\"snapshot\":"+full+"}").getBytes(StandardCharsets.UTF_8);
            ByteArrayOutputStream projected=new ByteArrayOutputStream();
            BackupSession.Proof proof=SearchSnapshot.write(db,projected,Collections.singleton("r1"),32*1024*1024,"{\"snapshot\":");
            proof.matches(expected.length,BackupSession.digestHex(MessageDigest.getInstance("SHA-256").digest(expected)));
            JSONObject record=new JSONObject(projected.toString("UTF-8")).getJSONObject("snapshot").getJSONArray("records").getJSONObject(0);
            JSONArray message=record.getJSONObject("rawContent").getJSONArray("messages").getJSONArray(0);
            assertEquals(7,message.length());assertTrue(message.isNull(0));assertEquals("公开",message.getString(1));
            assertEquals("完整😀BODY_END",message.getString(3));assertFalse(message.getBoolean(6));
            assertEquals("完整手动😀MANUAL_END",record.getString("manualContent"));
            StringWriter after=new StringWriter();store.write(after,Collections.singleton("r1"));assertEquals(full.toString(),after.toString());
            try{SearchSnapshot.write(db,new ByteArrayOutputStream(),Collections.singleton("r1"),1,"{\"snapshot\":");fail("Tiny acceleration budget did not request the complete fallback");}catch(SearchSnapshot.Unavailable expectedFallback){}
            db.execSQL("UPDATE indexed_bodies SET data='{\"messages\":[{\"text\":\"visible\",\"raw\":{\"a\":1,\"\\u0061\":2}}]}' WHERE kind='rawContent'");
            try{SearchSnapshot.write(db,new ByteArrayOutputStream(),Collections.singleton("r1"),32*1024*1024,"{\"snapshot\":");fail("Malformed discarded tail was accepted");}catch(SearchSnapshot.Unavailable expectedFallback){}
        }
    }
}
