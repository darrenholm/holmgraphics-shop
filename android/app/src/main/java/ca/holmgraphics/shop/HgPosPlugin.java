package ca.holmgraphics.shop;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.content.Context;
import android.content.Intent;
import android.location.LocationManager;
import android.provider.Settings;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.PermissionState;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.OutputStream;
import java.lang.reflect.Method;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * HgPos — the two native capabilities the counter POS needs that no
 * Capacitor 8 plugin provides.
 *
 * 1. Runtime ACCESS_FINE_LOCATION, plus a check on whether device location
 *    services are actually switched ON. The Stripe Terminal SDK refuses to
 *    take payments when it can't place the device, and
 *    @capgo/capacitor-stripe-terminal exposes no permission API — it just
 *    rejects discoverReaders() with a raw permission string that means
 *    nothing to whoever is standing at the counter.
 *
 * 2. Raw byte writes to a Bluetooth CLASSIC (SPP) printer. The counter
 *    printer is SPP, so the BLE plugins can't see it at all, and the two SPP
 *    plugins on npm peer-depend on Capacitor 6/7 while this app is on 8.
 *    The surface needed is small enough — bonded device list, open socket,
 *    write, close — that owning it beats carrying a version-mismatched
 *    dependency.
 *
 * Written in Java rather than Kotlin deliberately: the app module compiles
 * Java only, and adding the Kotlin plugin to it just for this file would drag
 * the Kotlin toolchain into every build for no benefit.
 */
@CapacitorPlugin(
    name = "HgPos",
    permissions = {
        @Permission(alias = HgPosPlugin.LOCATION, strings = { Manifest.permission.ACCESS_FINE_LOCATION })
    }
)
public class HgPosPlugin extends Plugin {

    static final String LOCATION = "location";

    /** The standard Serial Port Profile UUID. Every ESC/POS printer uses it. */
    private static final UUID SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");

    /**
     * Socket work never runs on the main thread: a printer that has been
     * switched off blocks connect() for the full Bluetooth timeout, and doing
     * that on the UI thread is an ANR with a customer at the counter.
     */
    private final ExecutorService io = Executors.newSingleThreadExecutor();

    // ─── Location ────────────────────────────────────────────────────────────

    @PluginMethod
    public void ensureLocationPermission(PluginCall call) {
        if (getPermissionState(LOCATION) == PermissionState.GRANTED) {
            JSObject ret = new JSObject();
            ret.put("granted", true);
            call.resolve(ret);
            return;
        }
        requestPermissionForAlias(LOCATION, call, "locationPermissionCallback");
    }

    @PermissionCallback
    private void locationPermissionCallback(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", getPermissionState(LOCATION) == PermissionState.GRANTED);
        call.resolve(ret);
    }

    /**
     * Permission granted is not enough — the device's location toggle has to
     * be on as well, and a tablet with it off fails reader discovery with an
     * error that reads like a Bluetooth fault.
     */
    @PluginMethod
    public void locationServicesEnabled(PluginCall call) {
        boolean enabled = false;
        try {
            LocationManager lm = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
            if (lm != null) {
                enabled = lm.isProviderEnabled(LocationManager.GPS_PROVIDER)
                       || lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
            }
        } catch (Exception ignored) { }
        JSObject ret = new JSObject();
        ret.put("enabled", enabled);
        call.resolve(ret);
    }

    /** Drops staff straight on the Location settings screen instead of "go find it". */
    @PluginMethod
    public void openLocationSettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not open location settings: " + e.getMessage());
        }
    }

    // ─── Bluetooth Classic (SPP) printer ─────────────────────────────────────

    /**
     * Devices already bonded in Android's Bluetooth settings.
     *
     * The printer is paired by hand, once. The card reader deliberately is
     * NOT — the Stripe SDK discovers and bonds the WisePad itself, and a
     * manual system pairing interferes with that. Anything that looks like a
     * reader is flagged here so the settings screen can warn about it rather
     * than letting someone pick it as a printer.
     */
    @PluginMethod
    public void listPairedDevices(PluginCall call) {
        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        if (adapter == null) {
            call.reject("This device has no Bluetooth adapter.");
            return;
        }
        if (!adapter.isEnabled()) {
            call.reject("Bluetooth is switched off.");
            return;
        }
        try {
            JSArray devices = new JSArray();
            Set<BluetoothDevice> bonded = adapter.getBondedDevices();
            for (BluetoothDevice d : bonded) {
                JSObject o = new JSObject();
                String name = d.getName() == null ? "" : d.getName();
                o.put("name", name);
                o.put("address", d.getAddress());
                o.put("bondState", d.getBondState());
                o.put("looksLikeCardReader", name.toUpperCase().contains("WISEPAD")
                                          || name.toUpperCase().contains("CHIPPER")
                                          || name.toUpperCase().contains("STRIPE"));
                devices.put(o);
            }
            JSObject ret = new JSObject();
            ret.put("devices", devices);
            call.resolve(ret);
        } catch (SecurityException e) {
            call.reject("Bluetooth permission denied: " + e.getMessage());
        }
    }

    /** Opens and immediately closes a socket, so settings can prove reachability. */
    @PluginMethod
    public void probePrinter(final PluginCall call) {
        final String address = call.getString("address");
        if (address == null || address.isEmpty()) {
            call.reject("address is required");
            return;
        }
        io.execute(() -> {
            BluetoothSocket socket = null;
            try {
                socket = openSocket(address);
                JSObject ret = new JSObject();
                ret.put("ok", true);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject(friendly(e, address));
            } finally {
                closeQuietly(socket);
            }
        });
    }

    /**
     * Writes raw ESC/POS bytes. `data` is base64 because Capacitor's JSON
     * bridge mangles binary any other way.
     *
     * A fresh socket per print: keeping one open is faster, but a stale
     * handle to a printer that has been power-cycled hangs the next write,
     * and at counter volume the reconnect costs a fraction of a second.
     */
    @PluginMethod
    public void printRaw(final PluginCall call) {
        final String address = call.getString("address");
        final String data = call.getString("data");
        if (address == null || address.isEmpty()) { call.reject("address is required"); return; }
        if (data == null) { call.reject("data (base64) is required"); return; }

        final byte[] bytes;
        try {
            bytes = Base64.decode(data, Base64.DEFAULT);
        } catch (IllegalArgumentException e) {
            call.reject("data is not valid base64");
            return;
        }

        io.execute(() -> {
            BluetoothSocket socket = null;
            try {
                socket = openSocket(address);
                OutputStream out = socket.getOutputStream();
                // Chunked with a short pause: the print buffer on these heads
                // is small, and firing a long receipt at it in one write drops
                // characters silently rather than erroring.
                final int CHUNK = 512;
                for (int i = 0; i < bytes.length; i += CHUNK) {
                    int len = Math.min(CHUNK, bytes.length - i);
                    out.write(bytes, i, len);
                    out.flush();
                    if (i + CHUNK < bytes.length) Thread.sleep(20);
                }
                // Let the head finish drawing before the socket drops —
                // closing immediately truncates the tail of the receipt.
                Thread.sleep(150);
                JSObject ret = new JSObject();
                ret.put("ok", true);
                ret.put("bytes", bytes.length);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject(friendly(e, address));
            } finally {
                closeQuietly(socket);
            }
        });
    }

    // ─── Socket plumbing ─────────────────────────────────────────────────────

    private BluetoothSocket openSocket(String address) throws Exception {
        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        if (adapter == null) throw new IllegalStateException("This device has no Bluetooth adapter.");
        if (!adapter.isEnabled()) throw new IllegalStateException("Bluetooth is switched off.");

        BluetoothDevice device = adapter.getRemoteDevice(address);
        // Discovery is expensive and will slow a connect attempt to a crawl
        // if it happens to be running.
        try { adapter.cancelDiscovery(); } catch (SecurityException ignored) { }

        try {
            BluetoothSocket socket = device.createRfcommSocketToServiceRecord(SPP_UUID);
            socket.connect();
            return socket;
        } catch (Exception first) {
            // Well-known fallback for the white-label POS printers that
            // advertise no SPP service record: bind to RFCOMM channel 1
            // directly through the hidden constructor.
            try {
                Method m = device.getClass().getMethod("createRfcommSocket", int.class);
                BluetoothSocket socket = (BluetoothSocket) m.invoke(device, 1);
                socket.connect();
                return socket;
            } catch (Exception second) {
                throw first;
            }
        }
    }

    private void closeQuietly(BluetoothSocket socket) {
        if (socket == null) return;
        try { socket.close(); } catch (Exception ignored) { }
    }

    /** Bluetooth exceptions are famously unhelpful. Say what to actually do. */
    private String friendly(Exception e, String address) {
        String msg = e.getMessage() == null ? e.toString() : e.getMessage();
        if (msg.contains("read failed") || msg.contains("socket might closed")) {
            return "The printer at " + address + " did not answer. Check it is switched on and in range.";
        }
        if (msg.contains("Device or resource busy")) {
            return "The printer is busy — another app or a previous print is still holding it.";
        }
        if (e instanceof SecurityException) {
            return "Bluetooth permission denied. Grant Nearby devices in Android settings.";
        }
        return "Printer error: " + msg;
    }

    @Override
    protected void handleOnDestroy() {
        io.shutdownNow();
        super.handleOnDestroy();
    }
}
