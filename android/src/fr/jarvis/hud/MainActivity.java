package fr.jarvis.hud;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Build;
import android.os.Bundle;
import android.speech.tts.TextToSpeech;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.ScrollView;
import android.widget.TextView;

import java.io.BufferedReader;
import java.io.File;
import java.io.InputStreamReader;
import java.util.Locale;

/**
 * Affiche l'interface Jarvis (giulietta/dist/index.html, embarquee dans l'APK) et lui fournit
 * ce que le navigateur de l'autoradio n'a pas : la voix, et les trames du bus CAN TopWay.
 */
public class MainActivity extends Activity {
    static final String ORIGIN = "https://jarvis.app/";
    private WebView web;
    private TextToSpeech tts;
    private boolean ttsReady;
    private TwBus bus;
    private final JarvisChromeClient chrome = new JarvisChromeClient();

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        tts = new TextToSpeech(this, status -> {
            if (status != TextToSpeech.SUCCESS) return;
            tts.setLanguage(Locale.FRENCH);
            tts.setOnUtteranceProgressListener(new TtsDone(this));
            ttsReady = true;
        });

        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        WebSettings ws = web.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);          // reglages et historique de Jarvis (localStorage)
        ws.setDatabaseEnabled(true);
        ws.setGeolocationEnabled(true);
        ws.setMediaPlaybackRequiresUserGesture(false);
        web.setWebViewClient(new JarvisWebClient(getAssets()));
        web.setWebChromeClient(chrome);
        web.addJavascriptInterface(new Bridge(this), "Android");
        setContentView(web);

        if (Build.VERSION.SDK_INT >= 23
                && checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION}, 1); // GPS pour la carte
        } else {
            start();
        }
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        start();
    }

    private void start() {
        if (web.getUrl() != null) return;
        web.loadUrl(ORIGIN + "index.html");
        // Trames du boitier CAN -> page (CanSource les decode). Lecture seule.
        bus = new TwBus((what, type, data) -> {
            StringBuilder hex = new StringBuilder();
            for (byte x : data) hex.append(String.format("%02X", x));
            web.evaluateJavascript("window.onCanFrame&&onCanFrame(" + what + "," + type + ",'" + hex + "')", null);
        });
        String err = bus.open();
        if (err != null) chrome.errors.append("CAN: ").append(err).append('\n');
    }

    /** Menu natif, ouvert en touchant le badge CAN en haut a gauche de Jarvis. */
    void menu() {
        runOnUiThread(() -> new AlertDialog.Builder(this).setTitle("Jarvis · autoradio")
                .setItems(new String[]{"Écoute CAN (trames de la voiture)", "Diagnostic de l'écran", "Recharger Jarvis"}, (d, i) -> {
                    if (i == 0) startActivity(new Intent(this, SniffActivity.class));
                    else if (i == 1) showDiag();
                    else web.reload();
                }).show());
    }

    private void showDiag() {
        StringBuilder sb = new StringBuilder();
        try {
            sb.append("WEBVIEW: ").append(WebSettings.getDefaultUserAgent(this)).append("\n\n");
        } catch (Throwable t) { sb.append("WEBVIEW: ").append(t).append("\n\n"); }
        sb.append("ERREURS JS: ").append(chrome.errors.length() == 0 ? "aucune" : "\n" + chrome.errors).append("\n\n");
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
        if (web.getUrl() != null) web.evaluateJavascript(
                "(function(){var c=document.createElement('canvas');return 'webgl1='+!!c.getContext('webgl')"
                        + "+' webgl2='+!!document.createElement('canvas').getContext('webgl2')"
                        + "+' ecran='+innerWidth+'x'+innerHeight+' dpr='+devicePixelRatio})()",
                r -> tv.setText("GRAPHISME: " + r + "\n" + sb));
        tv.setTextSize(13);
        tv.setTypeface(Typeface.MONOSPACE);
        tv.setTextIsSelectable(true);
        tv.setPadding(32, 16, 32, 16);
        ScrollView sv = new ScrollView(this);
        sv.addView(tv);
        new AlertDialog.Builder(this).setTitle("Diagnostic — prends tout en photo").setView(sv)
                .setPositiveButton("Fermer", null).show();
    }

    // Appele depuis la page (window.Android), hors du thread principal.
    void say(String text, int id) {
        if (ttsReady) tts.speak(text, TextToSpeech.QUEUE_ADD, null, String.valueOf(id));
        else ttsDone(String.valueOf(id));
    }

    void hush() {
        if (ttsReady) tts.stop();
    }

    void ttsDone(String id) {
        runOnUiThread(() -> web.evaluateJavascript("window.__ttsDone&&__ttsDone(" + id + ")", null));
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
    public void onBackPressed() {
        // Retour : ne quitte pas Jarvis par accident ; le bouton Accueil reste disponible
    }

    @Override
    protected void onDestroy() {
        if (bus != null) bus.close();
        if (tts != null) tts.shutdown();
        web.destroy();
        super.onDestroy();
    }
}
