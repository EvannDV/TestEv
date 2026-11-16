package fr.jarvis.hud;

import android.content.res.AssetManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayInputStream;
import java.io.IOException;

/**
 * Sert les fichiers de l'APK sous l'adresse https://jarvis.app/ : la page a ainsi une vraie
 * origine web (stockage local, GPS et appels aux services en ligne fonctionnent normalement).
 */
final class JarvisWebClient extends WebViewClient {
    private final AssetManager assets;

    JarvisWebClient(AssetManager assets) { this.assets = assets; }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
        if (!"jarvis.app".equals(req.getUrl().getHost())) return null;
        String path = req.getUrl().getPath();
        if (path == null || path.length() < 2) path = "/index.html";
        String mime = path.endsWith(".html") ? "text/html" : path.endsWith(".js") ? "application/javascript"
                : path.endsWith(".css") ? "text/css" : path.endsWith(".png") ? "image/png" : "application/octet-stream";
        try {
            return new WebResourceResponse(mime, mime.startsWith("image") ? null : "utf-8", assets.open(path.substring(1)));
        } catch (IOException e) {
            return new WebResourceResponse("text/plain", "utf-8", new ByteArrayInputStream(new byte[0]));
        }
    }

    @Override
    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
        return !"jarvis.app".equals(req.getUrl().getHost()); // on ne quitte jamais la page de Jarvis
    }
}
