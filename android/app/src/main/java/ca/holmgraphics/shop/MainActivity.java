package ca.holmgraphics.shop;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugins that live in this app module aren't in capacitor.plugins.json
        // (that file is generated from npm packages by `cap sync`), so they
        // have to be registered by hand — and before super.onCreate(), which
        // is where the bridge is built.
        registerPlugin(HgPosPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
