package coc.logbook;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle state) {
        registerPlugin(LogbookPlugin.class);
        super.onCreate(state);
    }
}
