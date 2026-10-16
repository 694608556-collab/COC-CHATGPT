package coc.logbook;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle state) {
        registerPlugin(LogbookPlugin.class);
        super.onCreate(state);
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().setBackgroundColor(0xffe6e8ec);
        }
        if (android.os.Build.VERSION.SDK_INT >= 31) {
            getSplashScreen().setOnExitAnimationListener(view -> view.remove());
        }
    }
}
