package fr.jarvis.hud;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationManager;
import android.os.Build;
import android.os.Looper;
import android.provider.Settings;

import java.util.Locale;

/**
 * GPS lu directement par Android (LocationManager), sans passer par la géolocalisation du
 * WebView, qui échoue souvent sur les autoradios sans services Google. La page voit un
 * navigator.geolocation classique (voir tools/shim.js) : __gpsFix, __gpsErr, __gpsSats.
 */
final class GpsBridge {
    private final MainActivity app;
    private LocationManager lm;
    private GpsListener gpsL, netL;
    private GnssCb gnss;
    private boolean on, askedSettings;
    private long lastGpsFix;
    int satsSeen = -1, satsUsed = -1;
    private Location last;

    GpsBridge(MainActivity app) { this.app = app; }

    private boolean allowed() {
        return Build.VERSION.SDK_INT < 23 || app.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    /** Appelé par la page (watchPosition) ; sans effet si déjà démarré. */
    void start() {
        app.runOnUiThread(() -> {
            if (on) { if (last != null) send(last); return; }
            if (!allowed()) { app.requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION}, 3); return; }
            lm = (LocationManager) app.getSystemService(android.content.Context.LOCATION_SERVICE);
            if (lm == null) { app.js("window.__gpsErr&&__gpsErr(2,'pas de GPS')"); return; }
            boolean gps = lm.isProviderEnabled(LocationManager.GPS_PROVIDER), net = lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
            if (!gps && !net) {
                app.js("window.__gpsErr&&__gpsErr(2,'localisation désactivée')");
                app.toast("La localisation est désactivée : active-la dans les réglages, puis touche la carte.");
                if (!askedSettings) {
                    askedSettings = true;
                    try { app.startActivity(new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS)); } catch (Exception ignored) { }
                }
                return;
            }
            try {
                on = true;
                if (gps) { gpsL = new GpsListener(this, true); lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000, 0, gpsL, Looper.getMainLooper()); }
                if (net) { netL = new GpsListener(this, false); lm.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 3000, 0, netL, Looper.getMainLooper()); }
                if (gps && Build.VERSION.SDK_INT >= 24) { gnss = new GnssCb(this); lm.registerGnssStatusCallback(gnss); }
                Location best = null;
                for (String p : new String[]{LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER}) {
                    Location l = lm.getLastKnownLocation(p);
                    if (l != null && System.currentTimeMillis() - l.getTime() < 120000 && (best == null || l.getAccuracy() < best.getAccuracy())) best = l;
                }
                if (best != null) onLocation(best, LocationManager.GPS_PROVIDER.equals(best.getProvider()));
            } catch (SecurityException e) {
                on = false;
                app.js("window.__gpsErr&&__gpsErr(1,'permission refusée')");
            }
        });
    }

    void stop() {
        app.runOnUiThread(() -> {
            if (lm == null) return;
            try {
                if (gpsL != null) lm.removeUpdates(gpsL);
                if (netL != null) lm.removeUpdates(netL);
                if (gnss != null && Build.VERSION.SDK_INT >= 24) lm.unregisterGnssStatusCallback(gnss);
            } catch (Exception ignored) { }
            gpsL = netL = null; gnss = null; on = false;
        });
    }

    /** Réponse à la demande de permission (code 3). */
    void onPermission(boolean granted) {
        if (granted) start();
        else { app.js("window.__gpsErr&&__gpsErr(1,'permission refusée')"); app.toast("Jarvis a besoin de la localisation pour la carte et le GPS."); }
    }

    void onLocation(Location l, boolean fromGps) {
        long now = System.currentTimeMillis();
        if (fromGps) lastGpsFix = now;
        else if (now - lastGpsFix < 5000) return; // le GPS est plus précis que le réseau
        last = l;
        send(l);
    }

    private void send(Location l) {
        app.js(String.format(Locale.US, "window.__gpsFix&&__gpsFix(%.7f,%.7f,%.1f,%s,%s,%d)",
                l.getLatitude(), l.getLongitude(), l.hasAccuracy() ? l.getAccuracy() : 50f,
                l.hasSpeed() ? String.format(Locale.US, "%.2f", l.getSpeed()) : "null",
                l.hasBearing() ? String.format(Locale.US, "%.1f", l.getBearing()) : "null", l.getTime()));
    }

    void onSats(int seen, int used) {
        satsSeen = seen; satsUsed = used;
        app.js("window.__gpsSats&&__gpsSats(" + seen + "," + used + ")");
    }

    void onProviderChange() {
        app.runOnUiThread(() -> { if (on) { stop(); start(); } });
    }

    String describe() {
        LocationManager m = lm != null ? lm : (LocationManager) app.getSystemService(android.content.Context.LOCATION_SERVICE);
        StringBuilder sb = new StringBuilder();
        sb.append("permission ").append(allowed() ? "OK" : "REFUSÉE");
        if (m != null) {
            sb.append(", GPS ").append(m.isProviderEnabled(LocationManager.GPS_PROVIDER) ? "actif" : "ÉTEINT");
            sb.append(", réseau ").append(m.isProviderEnabled(LocationManager.NETWORK_PROVIDER) ? "actif" : "éteint");
        }
        sb.append(", écoute ").append(on ? "en cours" : "arrêtée");
        if (satsSeen >= 0) sb.append(", satellites ").append(satsUsed).append(" utilisés / ").append(satsSeen).append(" vus");
        if (last != null) sb.append(String.format(Locale.FRANCE, ", dernière position il y a %d s (±%.0f m, %s)",
                (System.currentTimeMillis() - last.getTime()) / 1000, last.getAccuracy(), last.getProvider()));
        else sb.append(", aucune position reçue");
        return sb.toString();
    }
}
