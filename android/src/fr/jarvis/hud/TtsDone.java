package fr.jarvis.hud;

import android.speech.tts.UtteranceProgressListener;

/** Previent la page quand une phrase a fini d'etre prononcee. */
final class TtsDone extends UtteranceProgressListener {
    private final MainActivity app;

    TtsDone(MainActivity app) { this.app = app; }

    @Override public void onStart(String id) { }

    @Override public void onDone(String id) { app.ttsDone(id); }

    @Override public void onError(String id) { app.ttsDone(id); }
}
