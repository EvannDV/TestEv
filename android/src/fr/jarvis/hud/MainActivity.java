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
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

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
    private String ttsInfo = "en attente";
    private SpeechRecognizer sr;
    private int pendingListen;
    private TwBus bus;
    private final JarvisChromeClient chrome = new JarvisChromeClient();
    private final Updater updater = new Updater(this);
    private final Handler timer = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        tts = new TextToSpeech(this, status -> {
            if (status != TextToSpeech.SUCCESS) { ttsInfo = "aucun moteur de synthese vocale (statut " + status + ")"; toast("Jarvis ne peut pas parler : aucun moteur de synthèse vocale sur l'autoradio."); return; }
            int lang = tts.setLanguage(Locale.FRANCE);
            if (lang < TextToSpeech.LANG_AVAILABLE) lang = tts.setLanguage(Locale.FRENCH);
            ttsInfo = "moteur " + tts.getDefaultEngine() + ", francais " + (lang >= TextToSpeech.LANG_AVAILABLE ? "OK" : "ABSENT (" + lang + ")");
            if (lang < TextToSpeech.LANG_AVAILABLE) toast("Aucune voix française installée : Paramètres Android > Langue et saisie > Synthèse vocale.");
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
        if (code == 2) { // micro
            if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) listen(pendingListen);
            else { toast("Jarvis a besoin du micro pour vous entendre."); srEvent(pendingListen, "error", "not-allowed"); srEvent(pendingListen, "end", ""); }
            return;
        }
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
        timer.postDelayed(this::autoUpdate, 15000); // mises a jour : au lancement, puis toutes les 6 h
        String err = bus.open();
        if (err != null) chrome.errors.append("CAN: ").append(err).append('\n');
    }

    private void autoUpdate() {
        updater.check(false);
        timer.postDelayed(this::autoUpdate, 6 * 3600 * 1000L);
    }

    @Override
    protected void onNewIntent(Intent i) {
        super.onNewIntent(i);
        if (Updater.ACTION.equals(i.getAction())) updater.onStatus(i);
    }

    /** Menu natif, ouvert en touchant le badge CAN en haut a gauche de Jarvis. */
    void menu() {
        runOnUiThread(() -> new AlertDialog.Builder(this).setTitle("Jarvis · autoradio")
                .setItems(new String[]{"Écoute CAN (trames de la voiture)", "Diagnostic de l'écran", "Recharger Jarvis", "Vérifier les mises à jour"}, (d, i) -> {
                    if (i == 0) startActivity(new Intent(this, SniffActivity.class));
                    else if (i == 1) showDiag();
                    else if (i == 2) web.reload();
                    else updater.check(true);
                }).show());
    }

    private void showDiag() {
        StringBuilder sb = new StringBuilder();
        try {
            sb.append("WEBVIEW: ").append(WebSettings.getDefaultUserAgent(this)).append("\n\n");
        } catch (Throwable t) { sb.append("WEBVIEW: ").append(t).append("\n\n"); }
        sb.append("VOIX: ").append(ttsInfo).append("\nMICRO: reconnaissance vocale ")
                .append(SpeechRecognizer.isRecognitionAvailable(this) ? "disponible" : "ABSENTE").append("\n\n");
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

    void listen(int id) {
        runOnUiThread(() -> {
            if (Build.VERSION.SDK_INT >= 23 && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                pendingListen = id;
                requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, 2);
                return;
            }
            if (!SpeechRecognizer.isRecognitionAvailable(this)) {
                toast("Pas de reconnaissance vocale sur cet autoradio : installe l'appli Google (Play Store), puis réessaie.");
                srEvent(id, "error", "not-available");
                srEvent(id, "end", "");
                return;
            }
            if (ttsReady) tts.stop();
            if (sr == null) sr = SpeechRecognizer.createSpeechRecognizer(this);
            sr.cancel();
            sr.setRecognitionListener(new SrListener(this, id));
            Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                    .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                    .putExtra(RecognizerIntent.EXTRA_LANGUAGE, "fr-FR")
                    .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                    .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
                    .putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, getPackageName());
            sr.startListening(i);
        });
    }

    void stopListen() {
        runOnUiThread(() -> { if (sr != null) sr.stopListening(); });
    }

    void srEvent(int id, String type, String text) {
        runOnUiThread(() -> web.evaluateJavascript("window.__srEvent&&__srEvent(" + id + ",'" + type + "'," + JSONObject.quote(text) + ")", null));
    }

    void srError(int code) {
        String why = code == SpeechRecognizer.ERROR_NETWORK || code == SpeechRecognizer.ERROR_NETWORK_TIMEOUT ? "pas d'Internet"
                : code == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS ? "micro non autorisé"
                : code == SpeechRecognizer.ERROR_AUDIO ? "micro indisponible"
                : code == SpeechRecognizer.ERROR_NO_MATCH || code == SpeechRecognizer.ERROR_SPEECH_TIMEOUT ? null
                : "erreur " + code;
        if (why != null) toast("Reconnaissance vocale : " + why + ".");
    }

    void toast(String msg) {
        runOnUiThread(() -> Toast.makeText(this, msg, Toast.LENGTH_LONG).show());
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
        timer.removeCallbacksAndMessages(null);
        if (bus != null) bus.close();
        if (sr != null) sr.destroy();
        if (tts != null) tts.shutdown();
        web.destroy();
        super.onDestroy();
    }
}
