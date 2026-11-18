package fr.jarvis.hud;

import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanResult;

/** Appareils Bluetooth basse consommation trouves pendant la recherche. */
final class BleScanCb extends ScanCallback {
    private final BleBridge bridge;

    BleScanCb(BleBridge bridge) { this.bridge = bridge; }

    @Override
    public void onScanResult(int type, ScanResult r) {
        if (r != null && r.getDevice() != null) bridge.found(r.getDevice());
    }
}
