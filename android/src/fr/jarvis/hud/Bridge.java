package fr.jarvis.hud;

import android.webkit.JavascriptInterface;

/** Objet expose a la page sous le nom window.Android. */
final class Bridge {
    private final MainActivity app;

    Bridge(MainActivity app) { this.app = app; }

    @JavascriptInterface
    public void say(String text, int id) { app.say(text, id); }

    @JavascriptInterface
    public void hush() { app.hush(); }

    @JavascriptInterface
    public void menu() { app.menu(); }

    @JavascriptInterface
    public void ble(String method, int id, String args) { app.ble.call(method, id, args); }

    @JavascriptInterface
    public void gpsStart() { app.gps.start(); }

    @JavascriptInterface
    public void gpsStop() { app.gps.stop(); }

    @JavascriptInterface
    public void listen(int id) { app.listen(id); }

    @JavascriptInterface
    public void stopListen() { app.stopListen(); }
}
