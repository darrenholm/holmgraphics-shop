package ca.holmgraphics.shop;

import android.app.KeyguardManager;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;

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

        showOverLockScreen();
    }

    /**
     * Lets the counter POS sit in front of the tablet's lock screen.
     *
     * Without this the till gets stuck in a loop nobody can break without
     * picking the tablet up: the card reader drops, the screen eventually
     * sleeps, waking it shows the lock screen rather than the app, so the app
     * stays hidden — and a hidden WebView is suspended by Android, which stops
     * the reconnect watchdog running. It cannot heal itself, and every morning
     * somebody has to unlock and tap.
     *
     * Scope is deliberately narrow. This shows THIS app over the lock screen;
     * it does not unlock the tablet. Everything else — settings, other apps,
     * the file system — still needs the passcode. The trade-off is that anyone
     * at the counter can reach the POS without unlocking, which is the same
     * access they'd have if the tablet were simply awake, and the reader still
     * requires a card and usually a PIN before any money moves.
     */
    private void showOverLockScreen() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            // API 27+ — the modern calls. This tablet is API 27.
            setShowWhenLocked(true);
            setTurnScreenOn(true);
            // Showing over the lock screen is not enough on its own: Android
            // will not open the on-screen keyboard over a keyguard, so after a
            // reboot the sign-in page appeared but nobody could type into it
            // (2026-09-14). Ask for the keyguard to be dismissed as well. The
            // counter tablet has no PIN, so this just unlocks it; a tablet
            // that does have one would prompt for it rather than bypass it.
            KeyguardManager km = (KeyguardManager) getSystemService(KEYGUARD_SERVICE);
            if (km != null) km.requestDismissKeyguard(this, null);
        } else {
            getWindow().addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                    | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
            );
        }
    }
}
