package fr.jarvis.hud;

import android.os.Bundle;
import android.speech.RecognitionListener;
import android.speech.SpeechRecognizer;

import java.util.ArrayList;

/** Transmet a la page les evenements de la reconnaissance vocale d'Android (une ecoute = un id). */
final class SrListener implements RecognitionListener {
    private final MainActivity app;
    private final int id;
    private boolean ended;

    SrListener(MainActivity app, int id) { this.app = app; this.id = id; }

    private static String first(Bundle b) {
        ArrayList<String> r = b == null ? null : b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        return r == null || r.isEmpty() ? "" : r.get(0);
    }

    private void end() {
        if (ended) return;
        ended = true;
        app.srEvent(id, "end", "");
    }

    @Override public void onReadyForSpeech(Bundle p) { app.srEvent(id, "start", ""); }
    @Override public void onBeginningOfSpeech() { }
    @Override public void onRmsChanged(float db) { }
    @Override public void onBufferReceived(byte[] b) { }
    @Override public void onEndOfSpeech() { }
    @Override public void onPartialResults(Bundle b) { String t = first(b); if (!t.isEmpty()) app.srEvent(id, "partial", t); }
    @Override public void onEvent(int type, Bundle p) { }

    @Override public void onResults(Bundle b) {
        if (ended) return;
        app.srEvent(id, "result", first(b));
        end();
    }

    @Override public void onError(int code) {
        if (ended) return;
        app.srEvent(id, "error", String.valueOf(code));
        app.srError(code);
        end();
    }
}
