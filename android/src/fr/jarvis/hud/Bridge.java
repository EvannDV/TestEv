package fr.jarvis.hud;

import android.webkit.JavascriptInterface;

/** Objet expose a la page sous le nom window.Android. */
final class Bridge {
    private final MainActivity app;

    Bridge(MainActivity app) { this.app = app; }

    @JavascriptInterface
    public void say(String text) { app.say(text); }

    @JavascriptInterface
    public void hush() { app.hush(); }

    @JavascriptInterface
    public void pickDevice() { app.pickDeviceFromPage(); }
}
