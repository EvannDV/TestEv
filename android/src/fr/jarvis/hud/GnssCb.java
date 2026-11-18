package fr.jarvis.hud;

import android.location.GnssStatus;

/** Nombre de satellites vus et utilisés, pour savoir où en est la recherche du GPS. */
final class GnssCb extends GnssStatus.Callback {
    private final GpsBridge bridge;
    private long lastSent;

    GnssCb(GpsBridge bridge) { this.bridge = bridge; }

    @Override
    public void onSatelliteStatusChanged(GnssStatus st) {
        long now = System.currentTimeMillis();
        if (now - lastSent < 2000) return;
        lastSent = now;
        int used = 0;
        for (int i = 0; i < st.getSatelliteCount(); i++) if (st.usedInFix(i)) used++;
        bridge.onSats(st.getSatelliteCount(), used);
    }
}
