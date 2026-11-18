package fr.jarvis.hud;

import android.app.AlertDialog;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.le.BluetoothLeScanner;
import android.os.Handler;
import android.os.Looper;
import android.widget.ArrayAdapter;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Bluetooth basse consommation pour l'adaptateur OBD (OBDLink CX), au service du code OBD
 * d'origine de Jarvis : la page voit un navigator.bluetooth classique (voir tools/shim.js).
 * Tout se passe sur le fil principal ; les operations GATT sont faites une par une.
 */
final class BleBridge {
    private static final UUID CCCD = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");
    private final MainActivity app;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Map<String, BluetoothGatt> gatts = new HashMap<>();
    private final Map<String, Integer> connecting = new HashMap<>();
    private final ArrayDeque<Object[]> ops = new ArrayDeque<>(); // {reqId, Runnable}
    private int opReq = -1;

    // choix de l'adaptateur
    private BleScanCb scanCb;
    private ArrayAdapter<String> listAdapter;
    private final List<String> addrs = new ArrayList<>();
    private int pickReq = -1;

    BleBridge(MainActivity app) { this.app = app; }

    private static BluetoothAdapter adapter() { return BluetoothAdapter.getDefaultAdapter(); }

    /** Appele depuis la page (n'importe quel fil). */
    void call(String method, int id, String args) {
        main.post(() -> {
            try {
                JSONArray a = new JSONArray(args);
                BluetoothAdapter ad = adapter();
                if (ad == null) { fail(id, "NotSupportedError", "pas de Bluetooth sur cet appareil"); return; }
                if (!ad.isEnabled() && !"disconnect".equals(method)) {
                    try { ad.enable(); } catch (SecurityException ignored) { }
                    fail(id, "NetworkError", "Bluetooth éteint : je l'allume, réessayez dans quelques secondes");
                    return;
                }
                switch (method) {
                    case "pick": pick(id); break;
                    case "connect": connect(id, a.getString(0)); break;
                    case "disconnect": disconnect(a.getString(0)); ok(id, null); break;
                    case "notify": queue(id, () -> notifyOn(id, a.optString(0), a.optString(1), a.optString(2))); break;
                    case "write": queue(id, () -> write(id, a.optString(0), a.optString(1), a.optString(2), a.optString(3), a.optBoolean(4))); break;
                    default: fail(id, "NotSupportedError", "méthode inconnue " + method);
                }
            } catch (SecurityException e) {
                fail(id, "SecurityError", "permission Bluetooth refusée");
            } catch (Exception e) {
                fail(id, "NetworkError", String.valueOf(e.getMessage()));
            }
        });
    }

    // ---------- reponses vers la page ----------
    private void ok(int id, Object data) {
        app.js("window.__bleDone&&__bleDone(" + id + ",true," + (data == null ? "null" : JSONObject.quote(data.toString())) + ")");
    }

    private void fail(int id, String name, String msg) {
        JSONObject e = new JSONObject();
        try { e.put("name", name); e.put("message", msg); } catch (Exception ignored) { }
        app.js("window.__bleDone&&__bleDone(" + id + ",false," + JSONObject.quote(e.toString()) + ")");
    }

    private void event(String type, String dev, String svc, String chr, String hex) {
        app.js("window.__bleEvent&&__bleEvent('" + type + "','" + dev + "','" + svc + "','" + chr + "','" + hex + "')");
    }

    // ---------- choix de l'adaptateur : recherche pendant que la liste est affichee ----------
    private void pick(int id) {
        if (pickReq >= 0) { fail(id, "InvalidStateError", "une recherche est déjà en cours"); return; }
        pickReq = id;
        addrs.clear();
        listAdapter = new ArrayAdapter<>(app, android.R.layout.simple_list_item_1, new ArrayList<>());
        BluetoothAdapter ad = adapter();
        for (BluetoothDevice d : ad.getBondedDevices()) found(d);
        BluetoothLeScanner sc = ad.getBluetoothLeScanner();
        if (sc != null) { scanCb = new BleScanCb(this); sc.startScan(scanCb); }
        new AlertDialog.Builder(app).setTitle("Choisis l'adaptateur OBD (OBDLink CX)")
                .setAdapter(listAdapter, (dlg, which) -> {
                    int req = pickReq; pickReq = -1; stopScan();
                    String addr = addrs.get(which), label = listAdapter.getItem(which);
                    JSONObject o = new JSONObject();
                    try { o.put("id", addr); o.put("name", label.contains("\n") ? label.substring(0, label.indexOf('\n')) : "OBD"); } catch (Exception ignored) { }
                    ok(req, o);
                })
                .setOnDismissListener(dlg -> {
                    stopScan();
                    if (pickReq >= 0) { int req = pickReq; pickReq = -1; fail(req, "NotFoundError", "annulé"); }
                })
                .show();
        main.postDelayed(this::stopScan, 20000);
    }

    /** Appele par BleScanCb pour chaque appareil vu. */
    void found(BluetoothDevice d) {
        main.post(() -> {
            if (listAdapter == null || pickReq < 0 || addrs.contains(d.getAddress())) return;
            String n;
            try { n = d.getName(); } catch (SecurityException e) { n = null; }
            if (n == null || n.trim().isEmpty()) return; // les appareils sans nom encombrent la liste
            addrs.add(d.getAddress());
            listAdapter.add(n + "\n" + d.getAddress());
        });
    }

    private void stopScan() {
        if (scanCb == null) return;
        try {
            BluetoothLeScanner sc = adapter().getBluetoothLeScanner();
            if (sc != null) sc.stopScan(scanCb);
        } catch (Exception ignored) { }
        scanCb = null;
    }

    // ---------- connexion ----------
    private void connect(int id, String addr) {
        disconnect(addr);
        BluetoothDevice dev = adapter().getRemoteDevice(addr);
        connecting.put(addr, id);
        BluetoothGatt g = dev.connectGatt(app, false, new BleGattCb(this, addr), BluetoothDevice.TRANSPORT_LE);
        gatts.put(addr, g);
        main.postDelayed(() -> {
            Integer req = connecting.remove(addr);
            if (req != null && req == id) { disconnect(addr); fail(id, "NetworkError", "l'adaptateur ne répond pas (contact mis ?)"); }
        }, 12000);
    }

    private void disconnect(String addr) {
        BluetoothGatt g = gatts.remove(addr);
        if (g != null) { try { g.disconnect(); g.close(); } catch (Exception ignored) { } }
        ops.clear();
        opReq = -1;
    }

    /** Evenements GATT (recus sur un fil Bluetooth, renvoyes ici sur le fil principal). */
    void onState(String addr, BluetoothGatt g, boolean up) {
        main.post(() -> {
            if (gatts.get(addr) != g) return; // ancienne connexion
            if (up) { g.discoverServices(); return; }
            Integer req = connecting.remove(addr);
            disconnect(addr);
            if (req != null) fail(req, "NetworkError", "connexion refusée par l'adaptateur");
            else event("disconnected", addr, "", "", "");
        });
    }

    void onServices(String addr, BluetoothGatt g, boolean success) {
        main.post(() -> {
            Integer req = connecting.remove(addr);
            if (req == null || gatts.get(addr) != g) return;
            if (!success) { disconnect(addr); fail(req, "NetworkError", "services Bluetooth illisibles"); return; }
            JSONArray out = new JSONArray();
            try {
                for (BluetoothGattService s : g.getServices()) {
                    JSONArray cs = new JSONArray();
                    for (BluetoothGattCharacteristic c : s.getCharacteristics()) {
                        int p = c.getProperties();
                        cs.put(new JSONObject().put("uuid", c.getUuid().toString())
                                .put("write", (p & BluetoothGattCharacteristic.PROPERTY_WRITE) != 0)
                                .put("writeNoResp", (p & BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0)
                                .put("notify", (p & BluetoothGattCharacteristic.PROPERTY_NOTIFY) != 0)
                                .put("indicate", (p & BluetoothGattCharacteristic.PROPERTY_INDICATE) != 0)
                                .put("read", (p & BluetoothGattCharacteristic.PROPERTY_READ) != 0));
                    }
                    out.put(new JSONObject().put("uuid", s.getUuid().toString()).put("chars", cs));
                }
            } catch (Exception e) { fail(req, "NetworkError", String.valueOf(e.getMessage())); return; }
            ok(req, out);
        });
    }

    void onNotify(String addr, BluetoothGattCharacteristic c, byte[] v) {
        StringBuilder h = new StringBuilder();
        if (v != null) for (byte x : v) h.append(String.format("%02x", x));
        String svc = c.getService().getUuid().toString(), chr = c.getUuid().toString(), hex = h.toString();
        main.post(() -> event("notify", addr, svc, chr, hex));
    }

    // ---------- operations GATT, une par une ----------
    private void queue(int id, Runnable r) {
        ops.add(new Object[]{id, r});
        if (opReq < 0) next();
    }

    private void next() {
        Object[] o = ops.poll();
        if (o == null) { opReq = -1; return; }
        int id = (Integer) o[0];
        opReq = id;
        try { ((Runnable) o[1]).run(); } catch (Exception e) { opDone(id, false, String.valueOf(e.getMessage())); return; }
        main.postDelayed(() -> { if (opReq == id) opDone(id, false, "pas de réponse de l'adaptateur"); }, 3000);
    }

    /** Fin d'une operation (appele aussi par BleGattCb). */
    void opDone(int id, boolean success, String why) {
        main.post(() -> {
            if (opReq != id) return;
            if (success) ok(id, null); else fail(id, "NetworkError", why);
            next();
        });
    }

    int currentOp() { return opReq; }

    private BluetoothGattCharacteristic find(String addr, String svc, String chr) {
        BluetoothGatt g = gatts.get(addr);
        if (g == null) return null;
        BluetoothGattService s = g.getService(UUID.fromString(svc));
        return s == null ? null : s.getCharacteristic(UUID.fromString(chr));
    }

    private void notifyOn(int id, String addr, String svc, String chr) {
        BluetoothGattCharacteristic c = find(addr, svc, chr);
        BluetoothGatt g = gatts.get(addr);
        if (c == null || g == null) { opDone(id, false, "caractéristique absente"); return; }
        g.setCharacteristicNotification(c, true);
        BluetoothGattDescriptor d = c.getDescriptor(CCCD);
        if (d == null) { opDone(id, true, null); return; }
        boolean ind = (c.getProperties() & BluetoothGattCharacteristic.PROPERTY_NOTIFY) == 0;
        d.setValue(ind ? BluetoothGattDescriptor.ENABLE_INDICATION_VALUE : BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
        if (!g.writeDescriptor(d)) opDone(id, false, "abonnement refusé");
    }

    private void write(int id, String addr, String svc, String chr, String hex, boolean noResp) {
        BluetoothGattCharacteristic c = find(addr, svc, chr);
        BluetoothGatt g = gatts.get(addr);
        if (c == null || g == null) { opDone(id, false, "adaptateur déconnecté"); return; }
        byte[] b = new byte[hex.length() / 2];
        for (int i = 0; i < b.length; i++) b[i] = (byte) Integer.parseInt(hex.substring(i * 2, i * 2 + 2), 16);
        c.setWriteType(noResp ? BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE : BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT);
        c.setValue(b);
        if (!g.writeCharacteristic(c)) opDone(id, false, "écriture refusée");
    }

    void closeAll() {
        stopScan();
        for (String a : new ArrayList<>(gatts.keySet())) disconnect(a);
    }
}
