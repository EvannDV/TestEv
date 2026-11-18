package fr.jarvis.hud;

import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothProfile;

/** Evenements d'une connexion GATT, transmis a BleBridge. */
final class BleGattCb extends BluetoothGattCallback {
    private final BleBridge bridge;
    private final String addr;

    BleGattCb(BleBridge bridge, String addr) { this.bridge = bridge; this.addr = addr; }

    @Override
    public void onConnectionStateChange(BluetoothGatt g, int status, int state) {
        bridge.onState(addr, g, status == BluetoothGatt.GATT_SUCCESS && state == BluetoothProfile.STATE_CONNECTED);
    }

    @Override
    public void onServicesDiscovered(BluetoothGatt g, int status) {
        bridge.onServices(addr, g, status == BluetoothGatt.GATT_SUCCESS);
    }

    @Override
    public void onCharacteristicChanged(BluetoothGatt g, BluetoothGattCharacteristic c) {
        bridge.onNotify(addr, c, c.getValue());
    }

    @Override
    public void onCharacteristicWrite(BluetoothGatt g, BluetoothGattCharacteristic c, int status) {
        bridge.opDone(bridge.currentOp(), status == BluetoothGatt.GATT_SUCCESS, "écriture échouée (" + status + ")");
    }

    @Override
    public void onDescriptorWrite(BluetoothGatt g, BluetoothGattDescriptor d, int status) {
        bridge.opDone(bridge.currentOp(), status == BluetoothGatt.GATT_SUCCESS, "abonnement échoué (" + status + ")");
    }
}
