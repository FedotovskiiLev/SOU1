// SPDX-License-Identifier: AGPL-3.0-only
package org.sou1;

import android.app.*;
import android.content.*;
import android.content.pm.ServiceInfo;
import android.media.*;
import android.media.session.*;
import android.os.*;
import android.util.Log;
import org.sou1.audio.AmbientEngine;

/** Owns synthesis independently of the Activity. No network or recorded audio. */
public final class PlaybackService extends Service {
    public static final String ACTION_PLAY = "org.sou1.PLAY";
    public static final String ACTION_STOP = "org.sou1.STOP";
    public static final String ACTION_UPDATE = "org.sou1.UPDATE";
    public static final String EXTRA_INTENSITY = "intensity";
    public static final String EXTRA_BRIGHTNESS = "brightness";
    public static final String EXTRA_MOTION = "motion";
    public static final String EXTRA_SEED = "seed";
    public static final String EXTRA_TIMBRE = "timbre";
    public static final String EXTRA_WARMTH = "warmth";
    public static final String EXTRA_STRENGTH = "strength";
    public static final String EXTRA_WIDTH = "width";
    public static final String EXTRA_WASH = "wash";
    public static final String EXTRA_PAD = "pad";
    public static final String EXTRA_PLUCK = "pluck";
    public static final String EXTRA_BELL = "bell";
    public static final String EXTRA_TEXTURE = "texture";
    public static final String EXTRA_PULSE = "pulse";
    public static final String EXTRA_EVOLUTION = "evolution";
    public static final String EXTRA_RAIN_TYPE = "rainType";
    public static final String EXTRA_RAIN = "rain";
    public static final String EXTRA_THUNDER = "thunder";
    public static final String EXTRA_WIND = "wind";
    public static final String EXTRA_VOLUME = "volume";
    private static final String CHANNEL = "sou1_playback";
    private static final String PREFERENCES = "sou1_audio";
    private static final String PREFERENCE_CONTROLS = "controls";
    private static volatile boolean playing;
    private static volatile String statusJson = "{\"playing\":false}";
    private long sessionStartedAt, sessionSeed, timerDeadline;
    private int timerMinutes;
    public static String getStatus() { return statusJson; }
    private org.json.JSONObject controlSnapshot() throws org.json.JSONException {
        return new org.json.JSONObject().put("volume", volume)
                .put("intensity", parameters.intensity).put("brightness", parameters.brightness)
                .put("motion", parameters.motion).put("timbre", parameters.timbre)
                .put("warmth", parameters.warmth).put("strength", parameters.strength)
                .put("width", parameters.width).put("wash", parameters.wash)
                .put("pad", parameters.pad).put("pluck", parameters.pluck).put("bell", parameters.bell)
                .put("texture", parameters.texture).put("pulse", parameters.pulse).put("evolution", parameters.evolution)
                .put("rainType", parameters.rainType).put("rain", parameters.rain)
                .put("thunder", parameters.thunder).put("wind", parameters.wind);
    }
    private void publishStatus() {
        try {
            org.json.JSONObject value = controlSnapshot();
            value.put("playing", playing).put("startedAt", sessionStartedAt).put("seed", sessionSeed)
                    .put("timerMinutes", timerMinutes).put("deadline", timerDeadline);
            statusJson = value.toString();
        } catch (org.json.JSONException impossible) { statusJson = "{\"playing\":false}"; }
    }
    private void restoreControls() {
        try {
            org.json.JSONObject saved = new org.json.JSONObject(
                    getSharedPreferences(PREFERENCES, MODE_PRIVATE).getString(PREFERENCE_CONTROLS, "{}"));
            parameters = new AmbientEngine.Parameters(
                    saved.optDouble(EXTRA_INTENSITY, parameters.intensity),
                    saved.optDouble(EXTRA_BRIGHTNESS, parameters.brightness),
                    saved.optDouble(EXTRA_MOTION, parameters.motion),
                    saved.optDouble(EXTRA_TIMBRE, parameters.timbre),
                    saved.optDouble(EXTRA_WARMTH, parameters.warmth),
                    saved.optDouble(EXTRA_STRENGTH, parameters.strength),
                    saved.optDouble(EXTRA_WIDTH, parameters.width),
                    saved.optDouble(EXTRA_WASH, parameters.wash),
                    saved.optDouble(EXTRA_PAD, parameters.pad),
                    saved.optDouble(EXTRA_PLUCK, parameters.pluck),
                    saved.optDouble(EXTRA_BELL, parameters.bell),
                    saved.optDouble(EXTRA_TEXTURE, parameters.texture),
                    saved.optDouble(EXTRA_PULSE, parameters.pulse),
                    saved.optDouble(EXTRA_EVOLUTION, parameters.evolution),
                    saved.optInt(EXTRA_RAIN_TYPE, parameters.rainType),
                    saved.optDouble(EXTRA_RAIN, parameters.rain),
                    saved.optDouble(EXTRA_THUNDER, parameters.thunder),
                    saved.optDouble(EXTRA_WIND, parameters.wind));
            double savedVolume = saved.optDouble(EXTRA_VOLUME, volume);
            if (Double.isFinite(savedVolume)) volume = Math.max(0, Math.min(1, savedVolume));
        } catch (org.json.JSONException | ClassCastException invalidPreferences) {
            Log.w("SOU1", "Ignoring invalid saved audio controls", invalidPreferences);
        }
    }
    private void saveControls() {
        try {
            getSharedPreferences(PREFERENCES, MODE_PRIVATE).edit()
                    .putString(PREFERENCE_CONTROLS, controlSnapshot().toString()).apply();
        } catch (org.json.JSONException impossible) {
            Log.w("SOU1", "Audio controls could not be saved", impossible);
        }
    }
    private static double control(Intent intent, String key, double fallback) {
        double value = intent.getDoubleExtra(key, fallback);
        return Double.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
    }
    private static final Object TELEMETRY_LOCK = new Object();
    private static final float[] waveform = new float[64];
    private static float level;
    /** Copy owned by the caller; samples are post-gain mono PCM in [-1, 1]. */
    public static float[] getWaveformSnapshot() {
        synchronized (TELEMETRY_LOCK) { return waveform.clone(); }
    }
    /** Post-gain stereo RMS, normalized to PCM full scale. */
    public static float getLevel() {
        synchronized (TELEMETRY_LOCK) { return level; }
    }
    private static void clearTelemetry() {
        synchronized (TELEMETRY_LOCK) {
            java.util.Arrays.fill(waveform, 0f);
            level = 0f;
        }
    }
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Runnable endSession = this::stopPlayback;
    private AudioManager audioManager;
    private AudioFocusRequest focus;
    private MediaSession mediaSession;
    private Session current;
    private volatile double volume = .35;
    private boolean destroyed;
    private AmbientEngine.Parameters parameters = AmbientEngine.Parameters.DEFAULT;
    public static boolean isPlaying() { return playing; }

    private final BroadcastReceiver noisy = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) { stopPlayback(); }
    };

    @Override public void onCreate() {
        super.onCreate();
        restoreControls();
        publishStatus();
        audioManager = getSystemService(AudioManager.class);
        getSystemService(NotificationManager.class).createNotificationChannel(
                new NotificationChannel(CHANNEL, "Ambient playback", NotificationManager.IMPORTANCE_LOW));
        mediaSession = new MediaSession(this, "SOU1");
        mediaSession.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { safeStart(System.nanoTime()); }
            @Override public void onPause() { stopPlayback(); }
            @Override public void onStop() { stopPlayback(); }
        }, main);
        mediaSession.setMetadata(new MediaMetadata.Builder()
                .putString(MediaMetadata.METADATA_KEY_TITLE, "SOU1 · Ambient")
                .putString(MediaMetadata.METADATA_KEY_ARTIST, "Generated on this device").build());
        AudioAttributes attributes = attributes();
        focus = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(attributes).setWillPauseWhenDucked(true)
                .setOnAudioFocusChangeListener(change -> {
                    if (change != AudioManager.AUDIOFOCUS_GAIN) stopPlayback();
                }, main).build();
        if (Build.VERSION.SDK_INT >= 33) {
            registerReceiver(noisy, new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY), Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(noisy, new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY));
        }
    }

    private static AudioAttributes attributes() {
        return new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build();
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) { stopPlayback(); return START_NOT_STICKY; }
        String action = intent.getAction();
        if ("org.sou1.TIMER".equals(action)) {
            main.removeCallbacks(endSession);
            int minutes = intent.getIntExtra("minutes", 0);
            timerMinutes = minutes > 0 && minutes <= 180 ? minutes : 0;
            timerDeadline = timerMinutes > 0 ? System.currentTimeMillis() + timerMinutes * 60000L : 0;
            publishStatus();
            if (minutes > 0 && minutes <= 180 && current != null) main.postDelayed(endSession, minutes * 60000L);
            if (current == null) stopSelf();
            return START_NOT_STICKY;
        }
        if (ACTION_STOP.equals(action)) { stopPlayback(); return START_NOT_STICKY; }
        parameters = new AmbientEngine.Parameters(
                control(intent, EXTRA_INTENSITY, parameters.intensity),
                control(intent, EXTRA_BRIGHTNESS, parameters.brightness),
                control(intent, EXTRA_MOTION, parameters.motion),
                control(intent, EXTRA_TIMBRE, parameters.timbre),
                control(intent, EXTRA_WARMTH, parameters.warmth),
                control(intent, EXTRA_STRENGTH, parameters.strength),
                control(intent, EXTRA_WIDTH, parameters.width),
                control(intent, EXTRA_WASH, parameters.wash),
                control(intent, EXTRA_PAD, parameters.pad),
                control(intent, EXTRA_PLUCK, parameters.pluck),
                control(intent, EXTRA_BELL, parameters.bell),
                control(intent, EXTRA_TEXTURE, parameters.texture),
                control(intent, EXTRA_PULSE, parameters.pulse),
                control(intent, EXTRA_EVOLUTION, parameters.evolution),
                intent.getIntExtra(EXTRA_RAIN_TYPE, parameters.rainType),
                control(intent, EXTRA_RAIN, parameters.rain),
                control(intent, EXTRA_THUNDER, parameters.thunder),
                control(intent, EXTRA_WIND, parameters.wind));
        double requestedVolume = intent.getDoubleExtra(EXTRA_VOLUME, volume);
        if (Double.isFinite(requestedVolume)) volume = Math.max(0, Math.min(1, requestedVolume));
        saveControls();
        if (current != null) current.engine.setParameters(parameters);
        if (ACTION_PLAY.equals(action)) safeStart(intent.getLongExtra(EXTRA_SEED, System.nanoTime()));
        else if (current == null) stopSelf();
        publishStatus();
        return START_NOT_STICKY;
    }

    private void safeStart(long seed) {
        if (destroyed) return;
        try { startPlayback(seed); }
        catch (RuntimeException failure) {
            Log.e("SOU1", "Playback could not start", failure);
            stopPlayback();
        }
    }

    private void startPlayback(long seed) {
        if (current != null) return;
        Notification notification = notification();
        if (Build.VERSION.SDK_INT >= 29) startForeground(1, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        else startForeground(1, notification);
        if (audioManager.requestAudioFocus(focus) != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
            stopPlayback(); return;
        }
        Session session = new Session(seed);
        current = session;
        playing = true;
        sessionStartedAt = System.currentTimeMillis(); sessionSeed = seed; timerMinutes = 0; timerDeadline = 0;
        publishStatus();
        mediaSession.setPlaybackState(new PlaybackState.Builder().setActions(
                PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_STOP)
                .setState(PlaybackState.STATE_PLAYING, PlaybackState.PLAYBACK_POSITION_UNKNOWN, 1f).build());
        mediaSession.setActive(true);
        session.thread.start();
    }

    private Notification notification() {
        PendingIntent stop = PendingIntent.getService(this, 1,
                new Intent(this, PlaybackService.class).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE);
        PendingIntent open = PendingIntent.getActivity(this, 2,
                new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE);
        return new Notification.Builder(this, CHANNEL).setSmallIcon(android.R.drawable.ic_media_play)
                .setContentTitle("SOU1").setContentText("Ambient sound is playing")
                .setContentIntent(open).setOngoing(true).setOnlyAlertOnce(true)
                .setCategory(Notification.CATEGORY_TRANSPORT)
                .addAction(new Notification.Action.Builder(android.R.drawable.ic_media_pause, "Stop", stop).build())
                .setStyle(new Notification.MediaStyle().setMediaSession(mediaSession.getSessionToken()).setShowActionsInCompactView(0))
                .build();
    }

    private void stopPlayback() {
        main.removeCallbacks(endSession);
        Session old = current;
        current = null;
        playing = false;
        timerMinutes = 0; timerDeadline = 0; publishStatus();
        if (old != null) old.cancel();
        clearTelemetry();
        if (audioManager != null && focus != null) audioManager.abandonAudioFocusRequest(focus);
        if (mediaSession != null) {
            mediaSession.setPlaybackState(new PlaybackState.Builder().setState(
                    PlaybackState.STATE_STOPPED, PlaybackState.PLAYBACK_POSITION_UNKNOWN, 0).build());
            mediaSession.setActive(false);
        }
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    private final class Session implements Runnable {
        final AmbientEngine engine;
        final Thread thread;
        volatile boolean running = true;
        private AudioTrack track;
        Session(long seed) {
            engine = new AmbientEngine(48000, seed);
            engine.setParameters(parameters);
            thread = new Thread(this, "SOU1-audio");
        }
        synchronized void cancel() {
            running = false;
            if (track != null) {
                try { track.pause(); track.flush(); } catch (IllegalStateException ignored) { }
            }
        }
        @Override public void run() {
            android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_AUDIO);
            try {
                int size = AudioTrack.getMinBufferSize(48000, AudioFormat.CHANNEL_OUT_STEREO, AudioFormat.ENCODING_PCM_16BIT);
                if (size <= 0) throw new IllegalStateException("Unsupported audio output");
                synchronized (this) {
                    if (!running) return;
                    track = new AudioTrack.Builder().setAudioAttributes(attributes())
                            .setAudioFormat(new AudioFormat.Builder().setSampleRate(48000)
                                    .setChannelMask(AudioFormat.CHANNEL_OUT_STEREO).setEncoding(AudioFormat.ENCODING_PCM_16BIT).build())
                            .setBufferSizeInBytes(Math.max(size, 4096)).setTransferMode(AudioTrack.MODE_STREAM).build();
                    if (track.getState() != AudioTrack.STATE_INITIALIZED) throw new IllegalStateException("AudioTrack initialization failed");
                    engine.start(); track.play();
                }
                short[] buffer = new short[1024];
                double gain = 0;
                final double gainStep = 1 - Math.exp(-1.0 / (48000 * .05));
                while (running) {
                    engine.render(buffer, 0, buffer.length / 2);
                    double targetGain = volume;
                    for (int i = 0; i < buffer.length; i += 2) {
                        gain += (targetGain - gain) * gainStep;
                        buffer[i] = (short) Math.round(buffer[i] * gain);
                        buffer[i + 1] = (short) Math.round(buffer[i + 1] * gain);
                    }
                    synchronized (TELEMETRY_LOCK) {
                        // cancel() precedes clearTelemetry(): stale workers cannot republish.
                        if (running) {
                            double squares = 0;
                            for (short sample : buffer) {
                                double normalized = sample / 32768.0;
                                squares += normalized * normalized;
                            }
                            level = (float) Math.sqrt(squares / buffer.length);
                            int frames = buffer.length / 2;
                            for (int i = 0; i < waveform.length; i++) {
                                int frame = i * frames / waveform.length;
                                waveform[i] = (buffer[frame * 2] + buffer[frame * 2 + 1]) / 65536f;
                            }
                        }
                    }
                    int offset = 0;
                    while (running && offset < buffer.length) {
                        int written = track.write(buffer, offset, buffer.length - offset, AudioTrack.WRITE_BLOCKING);
                        if (written < 0) throw new IllegalStateException("Audio write failed: " + written);
                        if (written == 0 && running) throw new IllegalStateException("Audio output made no progress");
                        else offset += written;
                    }
                }
            } catch (RuntimeException failure) {
                Log.e("SOU1", "Audio output stopped", failure);
            } finally {
                synchronized (this) { if (track != null) { track.release(); track = null; } }
                main.post(() -> { if (current == this) stopPlayback(); });
            }
        }
    }
    @Override public void onDestroy() {
        destroyed = true;
        stopPlayback(); unregisterReceiver(noisy); mediaSession.release(); super.onDestroy();
    }
    @Override public IBinder onBind(Intent intent) { return null; }
}
