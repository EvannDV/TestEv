package fr.jarvis.hud;

import android.app.Activity;
import android.content.pm.ApplicationInfo;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.Message;
import android.view.WindowManager;
import android.widget.ScrollView;
import android.widget.TextView;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.lang.reflect.Constructor;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Enumeration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TreeMap;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

/**
 * Ecoute (sans rien envoyer) les messages vehicule d'un autoradio TopWay (com.tw.*).
 *
 * Les applis systeme TopWay recoivent leurs donnees via la classe android.tw.john.TWUtil,
 * en s'abonnant a des listes d'identifiants. On retrouve ces listes dans le code des
 * applis systeme, on s'abonne aux memes, et on affiche tout ce qui arrive.
 */
public class SniffActivity extends Activity {
    private static final String[] PKGS = {"com.tw.car", "com.tw.carinfoservice", "com.tw.service",
            "com.tw.core", "com.tw.coreservice", "com.dofun.carsetting", "com.dofun.carassistant.car"};

    private final Map<String, Row> rows = new TreeMap<>();
    private final StringBuilder info = new StringBuilder();
    private final List<Object> utils = new ArrayList<>();
    private Class<?> twClass;
    private TextView tv;
    private final Handler ui = new Handler(Looper.getMainLooper());

    private final Handler sink = new Handler(Looper.getMainLooper(), this::onMessage);

    private boolean onMessage(Message m) {
        int what = m.what & 0xFFFF;
        String key = String.format("%04X", what);
        String val, hint = "";
        if (m.obj instanceof byte[]) {
            // sur le canal 05xx : arg1 = type de trame du boitier CAN, arg2 = longueur
            byte[] b = (byte[]) m.obj;
            key += String.format(" t%02X", m.arg1 & 0xFF);
            StringBuilder h = new StringBuilder();
            for (int i = 0; i < b.length && i < 24; i++) h.append(String.format("%02X ", b[i]));
            val = h.toString().trim();
            if (what == 0x0501) hint = guess(m.arg1 & 0xFF, b);
        } else {
            val = m.arg1 + " " + m.arg2 + (m.obj == null ? "" : " " + m.obj);
            if (val.length() > 40) val = val.substring(0, 40);
        }
        Row r = rows.get(key);
        if (r == null) {
            if (rows.size() >= 300) return true;
            rows.put(key, r = new Row());
        }
        r.count++;
        if (!val.equals(r.last)) {
            r.changes++;
            r.prev2 = r.prev1;
            r.prev1 = r.last;
        }
        r.last = val;
        r.hint = hint;
        return true;
    }

    /** Decodage provisoire : vide tant que le protocole du boitier n'est pas identifie. */
    private static String guess(int type, byte[] b) {
        return "";
    }

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        tv = new TextView(this);
        tv.setTextSize(13);
        tv.setTypeface(Typeface.MONOSPACE);
        tv.setTextColor(Color.WHITE);
        tv.setPadding(24, 12, 24, 12);
        ScrollView sv = new ScrollView(this);
        sv.setBackgroundColor(Color.BLACK);
        sv.addView(tv);
        setContentView(sv);
        try {
            setup();
        } catch (Throwable t) {
            info.append("ERREUR setup: ").append(t).append('\n');
        }
        refresh();
    }

    private void setup() throws Exception {
        // 1. Listes d'identifiants utilisees par les applis systeme
        Map<String, short[]> lists = new LinkedHashMap<>();
        for (String pkg : PKGS) {
            List<short[]> found = new ArrayList<>();
            try {
                ApplicationInfo ai = getPackageManager().getApplicationInfo(pkg, 0);
                scanApp(new File(ai.sourceDir), found);
            } catch (Exception e) {
                info.append(pkg).append(": ").append(e.getClass().getSimpleName()).append('\n');
                continue;
            }
            info.append(pkg).append(": ").append(found.size()).append(" liste(s)\n");
            for (short[] a : found) {
                String k = hex(a);
                if (!lists.containsKey(k)) lists.put(k, a);
                info.append("  ").append(k).append('\n');
            }
        }

        // 2. La classe TWUtil et son API reelle
        info.append("\n== TWUtil ==\n");
        try {
            twClass = Class.forName("android.tw.john.TWUtil");
        } catch (Throwable t) {
            info.append("introuvable: ").append(t).append('\n');
            return;
        }
        for (Constructor<?> c : twClass.getDeclaredConstructors()) info.append(sig(c.toString())).append('\n');
        for (Method m : twClass.getDeclaredMethods()) info.append(sig(m.toString())).append('\n');

        // 3. Un abonnement par liste, exactement comme le fait l'appli d'origine
        info.append("\n== Abonnements ==\n");
        int n = 0;
        for (short[] ids : lists.values()) {
            if (n++ >= 24) break;
            try {
                Object tw;
                try {
                    tw = twClass.getConstructor().newInstance();
                } catch (NoSuchMethodException e) {
                    tw = twClass.getConstructor(int.class).newInstance(1);
                }
                Object r = twClass.getMethod("open", short[].class).invoke(tw, (Object) ids);
                twClass.getMethod("addHandler", String.class, Handler.class).invoke(tw, "jarvis" + n, sink);
                twClass.getMethod("start").invoke(tw);
                utils.add(tw);
                info.append("open(").append(ids.length).append(" ids) -> ").append(r).append('\n');
            } catch (Throwable t) {
                Throwable c = t.getCause() == null ? t : t.getCause();
                info.append("echec (").append(ids.length).append(" ids): ").append(c).append('\n');
            }
        }
        if (lists.isEmpty()) info.append("aucune liste trouvee\n");
    }

    /** Cherche les tableaux short[] constants dans le code d'une appli (APK, ou .vdex/.odex a cote). */
    private static void scanApp(File apk, List<short[]> out) throws Exception {
        try (ZipFile z = new ZipFile(apk)) {
            for (Enumeration<? extends ZipEntry> e = z.entries(); e.hasMoreElements(); ) {
                ZipEntry ze = e.nextElement();
                if (ze.getName().endsWith(".dex")) try (InputStream in = z.getInputStream(ze)) { scan(readAll(in), out); }
            }
        }
        File oat = new File(apk.getParentFile(), "oat");
        File[] archs = oat.listFiles();
        if (archs != null) for (File arch : archs) {
            File[] fs = arch.listFiles();
            if (fs != null) for (File f : fs)
                if (f.getName().endsWith(".vdex") || f.getName().endsWith(".odex"))
                    try (InputStream in = new FileInputStream(f)) { scan(readAll(in), out); }
        }
    }

    private static byte[] readAll(InputStream in) throws Exception {
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        byte[] buf = new byte[65536];
        for (int n; (n = in.read(buf)) > 0 && bo.size() < 48_000_000; ) bo.write(buf, 0, n);
        return bo.toByteArray();
    }

    /** Motif dex "fill-array-data" : 00 03, largeur 2, taille sur 4 octets, puis les valeurs. */
    static void scan(byte[] d, List<short[]> out) {
        for (int i = 0; i + 10 <= d.length; i++) {
            if (d[i] != 0 || d[i + 1] != 3 || d[i + 2] != 2 || d[i + 3] != 0) continue;
            int size = (d[i + 4] & 0xFF) | (d[i + 5] & 0xFF) << 8 | (d[i + 6] & 0xFF) << 16 | (d[i + 7] & 0xFF) << 24;
            if (size < 1 || size > 128 || i + 8 + 2 * size > d.length) continue;
            short[] a = new short[size];
            for (int j = 0; j < size; j++) a[j] = (short) ((d[i + 8 + 2 * j] & 0xFF) | d[i + 9 + 2 * j] << 8);
            boolean dup = false;
            for (short[] o : out) if (Arrays.equals(o, a)) { dup = true; break; }
            if (!dup && out.size() < 40) out.add(a);
        }
    }

    private static String hex(short[] a) {
        StringBuilder sb = new StringBuilder();
        for (short s : a) sb.append(String.format("%04X ", s & 0xFFFF));
        return sb.toString().trim();
    }

    private static String sig(String s) {
        return s.replace("android.tw.john.", "").replace("java.lang.", "").replace("android.os.", "")
                .replace("public ", "").replace("native ", "n ");
    }

    private void refresh() {
        StringBuilder sb = new StringBuilder("ECOUTE TOPWAY v2 — photo de ce tableau apres chaque action\n");
        sb.append("id  type    recus chgts  dernier  |  avant  |  encore avant\n");
        for (Map.Entry<String, Row> e : rows.entrySet()) {
            Row r = e.getValue();
            sb.append(String.format(Locale.US, "%-9s %5d %5d  %s", e.getKey(), r.count, r.changes, r.last));
            if (!r.prev1.isEmpty()) sb.append("  |  ").append(r.prev1);
            if (!r.prev2.isEmpty()) sb.append("  |  ").append(r.prev2);
            sb.append('\n');
            if (!r.hint.isEmpty()) sb.append("            -> ").append(r.hint).append('\n');
        }
        if (rows.isEmpty()) sb.append("(aucun message recu pour l'instant)\n");
        sb.append('\n').append(info);
        tv.setText(sb);
        ui.postDelayed(this::refresh, 700);
    }

    @Override
    protected void onDestroy() {
        ui.removeCallbacksAndMessages(null);
        int n = 0;
        for (Object tw : utils) {
            n++;
            try { twClass.getMethod("removeHandler", String.class).invoke(tw, "jarvis" + n); } catch (Throwable ignored) { }
            try { twClass.getMethod("stop").invoke(tw); } catch (Throwable ignored) { }
            try { twClass.getMethod("close").invoke(tw); } catch (Throwable ignored) { }
        }
        super.onDestroy();
    }
}

class Row {
    int count, changes;
    String last = "", prev1 = "", prev2 = "", hint = "";
}
