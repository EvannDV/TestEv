package fr.jarvis.hud;

import android.app.AlertDialog;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.os.Build;
import android.os.Bundle;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Mises a jour depuis le depot GitHub : compare version.json au numero installe, propose
 * la nouvelle version, la telecharge et la remet a l'installateur d'Android.
 * Android demande toujours une confirmation : rien ne s'installe sans un appui sur "Installer".
 */
final class Updater {
    static final String ACTION = "fr.jarvis.hud.INSTALL_STATUS";
    private static final String BASE = "https://raw.githubusercontent.com/EvannDV/TestEv/main/";
    private final MainActivity app;
    private boolean busy;

    Updater(MainActivity app) { this.app = app; }

    /** @param manual vrai si l'utilisateur l'a demande : on lui repond meme s'il n'y a rien de neuf. */
    void check(boolean manual) {
        if (busy) return;
        new Thread(() -> {
            try {
                JSONObject o = new JSONObject(new String(fetch(BASE + "version.json?t=" + System.currentTimeMillis()), "UTF-8"));
                int latest = o.getInt("code");
                int mine = app.getPackageManager().getPackageInfo(app.getPackageName(), 0).versionCode;
                if (latest > mine) app.runOnUiThread(() -> propose(o.optString("name", "?")));
                else if (manual) toast("Jarvis est à jour (version " + o.optString("name", "?") + ").");
            } catch (Exception e) {
                if (manual) toast("Vérification impossible : " + e.getMessage());
            }
        }, "update-check").start();
    }

    private void propose(String name) {
        if (app.isFinishing()) return;
        new AlertDialog.Builder(app).setTitle("Mise à jour disponible")
                .setMessage("La version " + name + " de Jarvis est prête. L'installer maintenant ?")
                .setPositiveButton("Installer", (d, w) -> install())
                .setNegativeButton("Plus tard", null).show();
    }

    private void install() {
        if (busy) return;
        busy = true;
        toast("Téléchargement de la mise à jour…");
        new Thread(() -> {
            try {
                PackageInstaller pi = app.getPackageManager().getPackageInstaller();
                int id = pi.createSession(new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL));
                PackageInstaller.Session s = pi.openSession(id);
                HttpURLConnection c = open(BASE + "jarvis-hud.apk?t=" + System.currentTimeMillis());
                try (InputStream in = c.getInputStream(); OutputStream out = s.openWrite("jarvis", 0, -1)) {
                    byte[] buf = new byte[65536];
                    for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
                    s.fsync(out);
                }
                Intent back = new Intent(app, MainActivity.class).setAction(ACTION);
                int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
                s.commit(PendingIntent.getActivity(app, id, back, flags).getIntentSender());
                s.close();
            } catch (Exception e) {
                toast("Mise à jour impossible : " + e.getMessage());
            }
            busy = false;
        }, "update-install").start();
    }

    /** Reponse de l'installateur d'Android (recue par MainActivity.onNewIntent). */
    void onStatus(Intent i) {
        Bundle x = i.getExtras();
        if (x == null) return;
        int status = x.getInt(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            Intent confirm = (Intent) x.get(Intent.EXTRA_INTENT);
            if (confirm != null) app.startActivity(confirm); // ecran "Installer ?" d'Android
        } else if (status != PackageInstaller.STATUS_SUCCESS) {
            toast("Installation refusée : " + x.getString(PackageInstaller.EXTRA_STATUS_MESSAGE)
                    + (status == PackageInstaller.STATUS_FAILURE_CONFLICT || status == PackageInstaller.STATUS_FAILURE_INCOMPATIBLE
                    ? " (désinstalle Jarvis puis réinstalle-le depuis le lien)" : ""));
        }
    }

    private void toast(String msg) {
        app.runOnUiThread(() -> Toast.makeText(app, msg, Toast.LENGTH_LONG).show());
    }

    private static HttpURLConnection open(String url) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(15000);
        c.setReadTimeout(30000);
        c.setRequestProperty("Cache-Control", "no-cache");
        if (c.getResponseCode() != 200) throw new Exception("réponse " + c.getResponseCode());
        return c;
    }

    private static byte[] fetch(String url) throws Exception {
        try (InputStream in = open(url).getInputStream()) {
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            for (int n; (n = in.read(buf)) > 0 && bo.size() < 100000; ) bo.write(buf, 0, n);
            return bo.toByteArray();
        }
    }
}
