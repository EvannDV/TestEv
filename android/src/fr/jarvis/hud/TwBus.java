package fr.jarvis.hud;

import android.os.Handler;
import android.os.Looper;
import android.os.Message;

/**
 * Abonnement aux messages du boitier CAN d'un autoradio TopWay, via la classe systeme cachee
 * android.tw.john.TWUtil (API relevee sur l'appareil). Lecture seule : rien n'est envoye.
 */
final class TwBus {
    interface Sink { void onFrame(int what, int type, byte[] data); }

    /** Canal 05xx = donnees du boitier CAN (liste tiree des applis systeme com.tw.car / carinfoservice). */
    private static final short[] IDS = {0x0501, 0x0505, 0x0506, 0x0507, 0x0508, 0x0509, 0x050A, 0x050B,
            0x050C, 0x050D, 0x050E, 0x0511, 0x0512};

    private final Handler handler;
    private Class<?> cls;
    private Object tw;

    TwBus(Sink sink) {
        handler = new Handler(Looper.getMainLooper(), (Message m) -> {
            if (m.obj instanceof byte[]) sink.onFrame(m.what & 0xFFFF, m.arg1 & 0xFF, (byte[]) m.obj);
            return true;
        });
    }

    /** @return null si l'abonnement est en place, sinon la raison de l'echec. */
    String open() {
        try {
            cls = Class.forName("android.tw.john.TWUtil");
            tw = cls.getConstructor().newInstance();
            Object r = cls.getMethod("open", short[].class).invoke(tw, (Object) IDS);
            cls.getMethod("addHandler", String.class, Handler.class).invoke(tw, "jarvis-hud", handler);
            cls.getMethod("start").invoke(tw);
            return r instanceof Integer && (Integer) r != 0 ? "open() a renvoye " + r : null;
        } catch (ClassNotFoundException e) {
            return "pas un autoradio TopWay (TWUtil absent)";
        } catch (Throwable t) {
            return String.valueOf(t.getCause() == null ? t : t.getCause());
        }
    }

    void close() {
        if (tw == null) return;
        try { cls.getMethod("removeHandler", String.class).invoke(tw, "jarvis-hud"); } catch (Throwable ignored) { }
        try { cls.getMethod("stop").invoke(tw); } catch (Throwable ignored) { }
        try { cls.getMethod("close").invoke(tw); } catch (Throwable ignored) { }
        tw = null;
    }
}
