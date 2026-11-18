package fr.jarvis.hud;

import android.location.Location;
import android.location.LocationListener;
import android.os.Bundle;

/** Positions d'un fournisseur (GPS ou réseau), transmises à GpsBridge. */
final class GpsListener implements LocationListener {
    private final GpsBridge bridge;
    private final boolean gps;

    GpsListener(GpsBridge bridge, boolean gps) { this.bridge = bridge; this.gps = gps; }

    @Override public void onLocationChanged(Location l) { if (l != null) bridge.onLocation(l, gps); }
    @Override public void onStatusChanged(String p, int s, Bundle b) { }
    @Override public void onProviderEnabled(String p) { bridge.onProviderChange(); }
    @Override public void onProviderDisabled(String p) { bridge.onProviderChange(); }
}
