package fr.jarvis.hud;

import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

/**
 * Lit les donnees moteur via un dongle OBD-II ELM327 Bluetooth (profil serie SPP).
 * N'envoie que des requetes de lecture OBD standard (mode 01).
 */
class ElmReader extends Thread {
    interface Listener { void onState(String json); }

    private static final UUID SPP = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    // champ, PID ; les deux premiers sont lus a chaque tour, les autres a tour de role
    private static final String[][] PIDS = {
            {"speed", "0D"}, {"rpm", "0C"},
            {"coolant", "05"}, {"throttle", "11"}, {"load", "04"},
            {"fuel", "2F"}, {"voltage", "42"}, {"intake", "0F"}};

    private final String address;
    private final Listener listener;
    private final Map<String, Double> values = new HashMap<>();
    private final Map<String, Integer> misses = new HashMap<>();
    private volatile boolean running = true;
    private volatile BluetoothSocket socket;
    private long lastData = 0;
    private String link = "CONNEXION…";

    ElmReader(String address, Listener listener) {
        super("elm-reader");
        this.address = address;
        this.listener = listener;
    }

    void shutdown() {
        running = false;
        closeSocket();
        interrupt();
    }

    private void closeSocket() {
        BluetoothSocket s = socket;
        socket = null;
        if (s != null) try { s.close(); } catch (IOException ignored) { }
    }

    @Override
    public void run() {
        while (running) {
            try {
                session();
            } catch (SecurityException e) {
                link = "PERMISSION BLUETOOTH";
            } catch (Exception e) {
                if (running) link = "OBD INJOIGNABLE";
            }
            closeSocket();
            publish();
            try { Thread.sleep(3000); } catch (InterruptedException e) { return; }
        }
    }

    private void session() throws IOException {
        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        if (adapter == null || !adapter.isEnabled()) { link = "BLUETOOTH ÉTEINT"; return; }
        link = "CONNEXION…";
        publish();
        BluetoothDevice dev = adapter.getRemoteDevice(address);
        adapter.cancelDiscovery();
        BluetoothSocket s;
        try {
            s = dev.createRfcommSocketToServiceRecord(SPP);
            socket = s;
            s.connect();
        } catch (IOException first) { // certains clones ELM327 n'acceptent que le mode non securise
            closeSocket();
            s = dev.createInsecureRfcommSocketToServiceRecord(SPP);
            socket = s;
            s.connect();
        }
        InputStream in = s.getInputStream();
        OutputStream out = s.getOutputStream();

        cmd(in, out, "ATZ", 3000);   // reset
        cmd(in, out, "ATE0", 1000);  // pas d'echo
        cmd(in, out, "ATL0", 1000);  // pas de saut de ligne
        cmd(in, out, "ATS0", 1000);  // pas d'espaces
        cmd(in, out, "ATH0", 1000);  // pas d'en-tetes
        cmd(in, out, "ATSP0", 1000); // protocole automatique
        cmd(in, out, "0100", 12000); // declenche la detection du protocole
        link = "CONTACT COUPÉ ?";
        misses.clear();

        List<String[]> slow = new ArrayList<>();
        for (int i = 2; i < PIDS.length; i++) slow.add(PIDS[i]);
        int turn = 0;
        while (running) {
            query(in, out, PIDS[0]);
            query(in, out, PIDS[1]);
            if (!slow.isEmpty()) {
                String[] p = slow.get(turn++ % slow.size());
                query(in, out, p);
                if (misses.containsKey(p[0]) && misses.get(p[0]) >= 4) slow.remove(p); // PID non supporte
            }
            publish();
        }
    }

    private void query(InputStream in, OutputStream out, String[] p) throws IOException {
        String r = cmd(in, out, "01" + p[1], 2500);
        Double v = parse(p[1], r);
        if (v == null) {
            Integer m = misses.get(p[0]);
            misses.put(p[0], m == null ? 1 : m + 1);
            return;
        }
        misses.put(p[0], 0);
        values.put(p[0], v);
        lastData = System.currentTimeMillis();
    }

    /** Envoie une commande et lit jusqu'a l'invite '>' de l'ELM327. */
    private static String cmd(InputStream in, OutputStream out, String c, int timeoutMs) throws IOException {
        while (in.available() > 0) in.read();
        out.write((c + "\r").getBytes("US-ASCII"));
        out.flush();
        StringBuilder sb = new StringBuilder();
        long deadline = System.currentTimeMillis() + timeoutMs;
        while (System.currentTimeMillis() < deadline) {
            if (in.available() == 0) {
                try { Thread.sleep(5); } catch (InterruptedException e) { throw new IOException("stop"); }
                continue;
            }
            int b = in.read();
            if (b < 0) throw new IOException("ferme");
            if (b == '>') return sb.toString();
            if (b > 32) sb.append((char) b);
        }
        return sb.toString();
    }

    /** Decode une reponse mode 01 (ex. "410D3C") selon la norme SAE J1979. */
    static Double parse(String pid, String resp) {
        String r = resp.toUpperCase(Locale.ROOT);
        int i = r.indexOf("41" + pid);
        if (i < 0) return null;
        i += 4;
        try {
            int a = Integer.parseInt(r.substring(i, i + 2), 16);
            switch (pid) {
                case "0D": return (double) a;
                case "05": case "0F": return (double) (a - 40);
                case "04": case "11": case "2F": return a * 100.0 / 255.0;
                case "0C": return (a * 256 + Integer.parseInt(r.substring(i + 2, i + 4), 16)) / 4.0;
                case "42": return (a * 256 + Integer.parseInt(r.substring(i + 2, i + 4), 16)) / 1000.0;
                default: return null;
            }
        } catch (RuntimeException e) {
            return null;
        }
    }

    private void publish() {
        double age = lastData == 0 ? 99 : (System.currentTimeMillis() - lastData) / 1000.0;
        StringBuilder sb = new StringBuilder("{\"source\":\"obd\",\"gear\":null");
        sb.append(",\"age\":").append(String.format(Locale.US, "%.1f", age));
        sb.append(",\"link\":\"").append(link).append('"');
        for (String[] p : PIDS) {
            Double v = values.get(p[0]);
            sb.append(",\"").append(p[0]).append("\":")
                    .append(v == null ? "null" : String.format(Locale.US, "%.2f", v));
        }
        listener.onState(sb.append('}').toString());
    }
}
