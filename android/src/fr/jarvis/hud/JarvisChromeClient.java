package fr.jarvis.hud;

import android.webkit.ConsoleMessage;
import android.webkit.GeolocationPermissions;
import android.webkit.WebChromeClient;

/** Autorise le GPS pour la page et garde les erreurs JavaScript pour l'ecran de diagnostic. */
final class JarvisChromeClient extends WebChromeClient {
    final StringBuilder errors = new StringBuilder();

    @Override
    public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
        callback.invoke(origin, origin != null && origin.startsWith("https://jarvis.app"), false);
    }

    @Override
    public boolean onConsoleMessage(ConsoleMessage m) {
        if (m.messageLevel() == ConsoleMessage.MessageLevel.ERROR && errors.length() < 4000)
            errors.append(m.message()).append(" @").append(m.lineNumber()).append('\n');
        return true;
    }
}
