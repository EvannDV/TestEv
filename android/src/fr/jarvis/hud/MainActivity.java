package fr.jarvis.hud;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Build;
import android.os.Bundle;
import android.speech.tts.TextToSpeech;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebView;
import android.widget.ScrollView;
import android.widget.TextView;

import java.io.BufferedReader;
import java.io.File;
import java.io.InputStreamReader;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public class MainActivity extends Activity {
    private static final String DEMO = "demo", DIAG = "diag", SNIFF = "sniff";
    private WebView web;
    private TextToSpeech tts;
    private boolean ttsReady;
    private ElmReader reader;
    private SharedPreferences prefs;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        prefs = getPreferences(MODE_PRIVATE);

        tts = new TextToSpeech(this, status -> {
            if (status != TextToSpeech.SUCCESS) return;
            tts.setLanguage(Locale.FRENCH);
            tts.setPitch(0.85f);
            ttsReady = true;
        });

        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setMediaPlaybackRequiresUserGesture(false);
        web.addJavascriptInterface(new Bridge(this), "Android");
        setContentView(web);

        if (Build.VERSION.SDK_INT >= 31
                && checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.BLUETOOTH_CONNECT}, 1);
        } else {
            start();
        }
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        start();
    }

    /** Lance le HUD avec le dongle memorise, ou demande lequel utiliser. */
    private void start() {
        String addr = prefs.getString("device", null);
        if (addr == null) pickDevice();
        else use(addr);
    }

    private void use(String addr) {
        if (reader != null) reader.shutdown();
        reader = null;
        boolean demo = DEMO.equals(addr);
        web.loadUrl("file:///android_asset/index.html?nofs&autostart" + (demo ? "&demo" : ""));
        if (demo) return;
        reader = new ElmReader(addr, json ->
                runOnUiThread(() -> web.evaluateJavascript("window.onCar&&onCar(" + json + ")", null)));
        reader.start();
    }

    private void pickDevice() {
        final List<String> names = new ArrayList<>();
        final List<String> addrs = new ArrayList<>();
        try {
            BluetoothAdapter a = BluetoothAdapter.getDefaultAdapter();
            if (a != null) for (BluetoothDevice d : a.getBondedDevices()) {
                names.add((d.getName() == null ? "?" : d.getName()) + "\n" + d.getAddress());
                addrs.add(d.getAddress());
            }
        } catch (SecurityException ignored) { }
        names.add("Mode démo (sans voiture)");
        addrs.add(DEMO);
        names.add("Écoute CAN de l'autoradio (étape 2)");
        addrs.add(SNIFF);
        names.add("Diagnostic de l'écran");
        addrs.add(DIAG);
        new AlertDialog.Builder(this)
                .setTitle(addrs.size() == 3
                        ? "Aucun appareil Bluetooth appairé. Appaire d'abord le dongle OBD dans les réglages Android."
                        : "Choisis ton dongle OBD (ELM327)")
                .setItems(names.toArray(new String[0]), (dlg, i) -> {
                    if (DIAG.equals(addrs.get(i))) { showDiag(); return; }
                    if (SNIFF.equals(addrs.get(i))) {
                        startActivity(new Intent(this, SniffActivity.class));
                        if (web.getUrl() == null) use(DEMO);
                        return;
                    }
                    prefs.edit().putString("device", addrs.get(i)).apply();
                    use(addrs.get(i));
                })
                .setOnCancelListener(dlg -> { if (web.getUrl() == null) use(DEMO); })
                .show();
    }

    /** Affiche ce qui permet d'identifier l'autoradio et son acces au bus CAN. */
    private void showDiag() {
        StringBuilder sb = new StringBuilder();
        sb.append("Android ").append(Build.VERSION.RELEASE).append(" (API ").append(Build.VERSION.SDK_INT).append(")\n");
        sb.append("Fabricant: ").append(Build.MANUFACTURER).append(" / ").append(Build.BRAND).append('\n');
        sb.append("Modele: ").append(Build.MODEL).append(" / ").append(Build.DEVICE).append('\n');
        sb.append("Carte: ").append(Build.BOARD).append(" / ").append(Build.HARDWARE).append('\n');
        sb.append("Build: ").append(Build.DISPLAY).append('\n').append(Build.FINGERPRINT).append('\n');

        String[] keys = {"syu", "fyt", "microntek", "mtc", "can", "mcu", "teyes", "com.ts.", "dudu", "hzbhd",
                "nwd", "zxw", "xyauto", "roadrover", "hiworld", "raise", "car", "vehicle", "autochips",
                "topway", "com.tw.", "qf.", "kld", "sprd", "obd"};
        sb.append("\n== Applis liees a la voiture ==\n");
        try {
            for (PackageInfo pi : getPackageManager().getInstalledPackages(0)) {
                String n = pi.packageName.toLowerCase(Locale.ROOT);
                for (String k : keys) if (n.contains(k)) { sb.append(pi.packageName).append("  ").append(pi.versionName).append('\n'); break; }
            }
        } catch (RuntimeException e) { sb.append("erreur: ").append(e).append('\n'); }

        sb.append("\n== Ports serie ==\n");
        File[] devs = new File("/dev").listFiles();
        if (devs == null) sb.append("/dev illisible\n");
        else for (File f : devs) {
            String n = f.getName();
            if (n.startsWith("tty") && n.length() > 3 && !Character.isDigit(n.charAt(3)) || n.startsWith("can"))
                sb.append(n).append(f.canRead() ? "  lecture OK" : "  lecture refusee").append('\n');
        }
        File net = new File("/sys/class/net");
        String[] ifs = net.list();
        if (ifs != null) for (String n : ifs) if (n.contains("can")) sb.append("interface reseau ").append(n).append('\n');

        sb.append("\n== Proprietes systeme ==\n");
        try {
            BufferedReader r = new BufferedReader(new InputStreamReader(Runtime.getRuntime().exec("getprop").getInputStream()));
            String[] pk = {"fyt", "syu", "mcu", "can", "mtc", "microntek", "customer", "board.platform", "product.model", "car", "ts."};
            for (String line; (line = r.readLine()) != null; ) {
                String l = line.toLowerCase(Locale.ROOT);
                for (String k : pk) if (l.contains(k)) { sb.append(line).append('\n'); break; }
            }
        } catch (Exception e) { sb.append("getprop: ").append(e).append('\n'); }

        TextView tv = new TextView(this);
        tv.setText(sb);
        tv.setTextSize(13);
        tv.setTypeface(Typeface.MONOSPACE);
        tv.setTextIsSelectable(true);
        tv.setPadding(32, 16, 32, 16);
        ScrollView sv = new ScrollView(this);
        sv.addView(tv);
        new AlertDialog.Builder(this).setTitle("Diagnostic — prends tout en photo").setView(sv)
                .setPositiveButton("Fermer", (d, w) -> { if (web.getUrl() == null) pickDevice(); }).show();
    }

    // Appele depuis la page (window.Android), hors du thread principal.
    void say(String text) {
        if (ttsReady) tts.speak(text, TextToSpeech.QUEUE_ADD, null, "jarvis");
    }

    void hush() {
        if (ttsReady) tts.stop();
    }

    void pickDeviceFromPage() {
        runOnUiThread(this::pickDevice);
    }

    @Override
    public void onWindowFocusChanged(boolean focus) {
        super.onWindowFocusChanged(focus);
        if (focus) web.setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
    }

    @Override
    protected void onDestroy() {
        if (reader != null) reader.shutdown();
        if (tts != null) tts.shutdown();
        web.destroy();
        super.onDestroy();
    }
}
