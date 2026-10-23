package coc.logbook;

import android.content.*;
import android.net.Uri;
import android.provider.DocumentsContract;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.xml.sax.*;
import org.xml.sax.helpers.DefaultHandler;
import javax.xml.parsers.SAXParserFactory;
import java.io.*;
import java.util.*;
import java.util.zip.*;
import static org.junit.Assert.*;

/** Local diagnostic only. Private XLSX arrives at runtime in the test UID;
 * no field values, paths, or private workbook bytes are emitted. */
@RunWith(AndroidJUnit4.class)
public final class PrivateXmlAuditTest {
    @Test public void measurePlatformXmlValidationWithoutImportingData() throws Exception {
        Context target=InstrumentationRegistry.getInstrumentation().getTargetContext(), tests=InstrumentationRegistry.getInstrumentation().getContext();
        assertEquals("coc.logbook.debug55",target.getPackageName());
        boolean localCard="true".equals(InstrumentationRegistry.getArguments().getString("localPrivateCard"));
        String id="public-"+UUID.randomUUID();
        Uri tree=DocumentsContract.buildTreeDocumentUri(PublicIoProvider.AUTHORITY,id);
        tests.startActivity(new Intent().setComponent(new ComponentName(tests.getPackageName(),PublicIoGrantActivity.class.getName())).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra("publicTarget",target.getPackageName()).putExtra("publicUri",tree.toString()).putExtra("localPrivateCard",localCard));
        int modes=Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION;boolean granted=false;
        try {
            long deadline=System.currentTimeMillis()+20000;
            while(!granted)try{target.getContentResolver().takePersistableUriPermission(tree,modes);granted=true;}catch(SecurityException pending){assertTrue(System.currentTimeMillis()<deadline);Thread.sleep(50);}
            long start=System.nanoTime();final long[] cells={0};int parts=0;StringBuilder samples=new StringBuilder();
            SAXParserFactory factory=SAXParserFactory.newInstance();factory.setNamespaceAware(true);
            factory.setFeature("http://xml.org/sax/features/external-general-entities",false);
            factory.setFeature("http://xml.org/sax/features/external-parameter-entities",false);
            XMLReader reader=factory.newSAXParser().getXMLReader();
            reader.setEntityResolver((publicId,systemId)->{throw new SAXException("External entities are forbidden");});
            reader.setContentHandler(new DefaultHandler(){int depth;@Override public void startElement(String uri,String local,String q,Attributes attrs)throws SAXException{if(++depth>256)throw new SAXException("XML nesting budget");if("c".equals(local))cells[0]++;}@Override public void endElement(String uri,String local,String q){depth--;}});
            Uri file=DocumentsContract.buildDocumentUriUsingTree(tree,id+"/public-io-card.xlsx");
            for(int sample=0;sample<3;sample++){long sampleStart=System.nanoTime();cells[0]=0;parts=0;
            try(InputStream original=target.getContentResolver().openInputStream(file);ZipInputStream zip=new ZipInputStream(new BufferedInputStream(original,65536))){
                ZipEntry entry;byte[] buffer=new byte[65536];while((entry=zip.getNextEntry())!=null){
                    if(entry.getName().endsWith(".xml")&&!entry.getName().equals("xl/styles.xml")){parts++;reader.parse(new InputSource(new FilterInputStream(zip){@Override public void close(){}}));}
                    else while(zip.read(buffer)!=-1){}zip.closeEntry();
                }
            }
            if(sample>0)samples.append(',');samples.append((System.nanoTime()-sampleStart)/1000000.0);}
            assertTrue(cells[0]>0);android.os.Bundle report=new android.os.Bundle();report.putString("local_xml_audit","{\"milliseconds\":"+((System.nanoTime()-start)/1000000.0)+",\"samples\":["+samples+"],\"xmlParts\":"+parts+",\"cells\":"+cells[0]+",\"notImportAcceptance\":true}");InstrumentationRegistry.getInstrumentation().sendStatus(0,report);
        } finally { if(granted) { try{DocumentsContract.deleteDocument(target.getContentResolver(),DocumentsContract.buildDocumentUriUsingTree(tree,id+"/public-io-card.xlsx"));}finally{target.getContentResolver().releasePersistableUriPermission(tree,modes);} } }
    }
}
