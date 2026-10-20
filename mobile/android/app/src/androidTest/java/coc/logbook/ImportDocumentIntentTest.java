package coc.logbook;

import android.content.Intent;
import android.webkit.MimeTypeMap;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.util.Arrays;
import java.util.List;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Exercise the actual picker intent, including the device's CSV MIME alias. */
@RunWith(AndroidJUnit4.class)
public class ImportDocumentIntentTest {
    @Test public void recordPickerAcceptsDeviceCsvAndPreservesBackupKinds() {
        Intent records = LogbookPlugin.importDocumentIntent("record-table");
        List<String> types = Arrays.asList(records.getStringArrayExtra(Intent.EXTRA_MIME_TYPES));
        assertEquals(Intent.ACTION_OPEN_DOCUMENT, records.getAction());
        assertTrue(records.hasCategory(Intent.CATEGORY_OPENABLE));
        assertTrue((records.getFlags() & Intent.FLAG_GRANT_READ_URI_PERMISSION) != 0);
        assertTrue(types.contains("text/csv"));
        assertTrue(types.contains("text/comma-separated-values"));
        String deviceCsv = MimeTypeMap.getSingleton().getMimeTypeFromExtension("csv");
        assertNotNull(deviceCsv);
        assertTrue("Unsupported device CSV MIME: " + deviceCsv, types.contains(deviceCsv));
        assertTrue(types.contains("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"));
        assertArrayEquals(new String[]{"application/json", "application/zip", "application/octet-stream", "text/plain"},
            LogbookPlugin.importDocumentIntent("backup").getStringArrayExtra(Intent.EXTRA_MIME_TYPES));
    }
}
