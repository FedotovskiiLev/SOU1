// SPDX-License-Identifier: AGPL-3.0-only
package org.sou1;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import android.webkit.*;
import android.graphics.Color;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;

/** Local-only shared interface; audio is owned by the native foreground service. */
public final class MainActivity extends Activity {
    private static final String ORIGIN = "https://sou1.local/";
    private WebView web;
    private static final int SAVE_MIDI = 702;
    private static final int MIDI_MAX_BYTES = 262144;
    private static final Object MIDI_LOCK = new Object();
    private static byte[] pendingMidi;
    private static volatile String midiStatus = "idle";

    @SuppressLint("SetJavaScriptEnabled")
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.BLACK);
        getWindow().setNavigationBarColor(Color.BLACK);
        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setAllowFileAccess(false);
        web.getSettings().setAllowContentAccess(false);
        web.getSettings().setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        web.addJavascriptInterface(new Bridge(), "AndroidBridge");
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri=request.getUrl();
                if (!"https".equals(uri.getScheme()) || !"sou1.local".equals(uri.getHost()) || (uri.getPort()!=-1 && uri.getPort()!=443)) return denied();
                String path=uri.getPath();
                if (path==null || path.equals("/")) path="/index.html";
                if(path.contains("..") || path.contains("\\") || path.indexOf('\0')>=0) return denied();
                String type=path.endsWith(".js")?"text/javascript":path.endsWith(".css")?"text/css":path.endsWith(".svg")?"image/svg+xml":path.endsWith(".json")||path.endsWith(".webmanifest")?"application/json":"text/html";
                try { return new WebResourceResponse(type,"UTF-8",getAssets().open(path.substring(1))); }
                catch(IOException missing){ return denied(); }
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri=request.getUrl();
                if("https".equals(uri.getScheme()) && "sou1.local".equals(uri.getHost()) && (uri.getPort()==-1 || uri.getPort()==443)) return false;
                if(request.hasGesture() && "https".equals(uri.getScheme())) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW,uri)); } catch(RuntimeException unavailable) { }
                }
                return true;
            }
        });
        web.setOnApplyWindowInsetsListener((view, insets) -> {
            view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                    insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets;
        });
        setContentView(web);web.loadUrl(ORIGIN);
    }
    private static WebResourceResponse denied() {
        return new WebResourceResponse("text/plain","UTF-8",404,"Not found",java.util.Collections.emptyMap(),new ByteArrayInputStream(new byte[0]));
    }
    private Intent command(String action, String data) throws JSONException {
        JSONObject json=new JSONObject(data);
        Intent intent=new Intent(this,PlaybackService.class).setAction(action);
        for(String key:new String[]{"intensity","brightness","motion","timbre","warmth","strength","width","wash",
                "pad","pluck","bell","texture","pulse","evolution","rain","thunder","wind","volume",
                "kick","snare","hihat","toms","cymbal","ambient","counterpoint","rhythmic","arpeggio","density","complexity","swing"}) {
            if (!json.has(key)) continue;
            double value=json.optDouble(key,Double.NaN);
            if(!Double.isFinite(value)) continue;
            intent.putExtra(key,Math.max(0,Math.min(1,value)));
        }
        if (json.has("rainType")) {
            double rainType=json.optDouble("rainType",Double.NaN);
            if(Double.isFinite(rainType)) intent.putExtra(PlaybackService.EXTRA_RAIN_TYPE,(int)Math.max(0,Math.min(3,Math.round(rainType))));
        }
        if (json.has("composition")) {
            double value=json.optDouble("composition",Double.NaN);
            if(Double.isFinite(value)) intent.putExtra(PlaybackService.EXTRA_COMPOSITION,(int)Math.max(0,Math.min(3,Math.round(value))));
        }
        if (json.has("bpm")) {
            double value=json.optDouble("bpm",Double.NaN);
            if(Double.isFinite(value)) intent.putExtra(PlaybackService.EXTRA_BPM,(double)Math.max(30,Math.min(180,Math.round(value))));
        }
        if (json.has("polyphony")) intent.putExtra(PlaybackService.EXTRA_POLYPHONY,json.optInt("polyphony",16));
        if (json.has("melodyEnabled")) intent.putExtra(PlaybackService.EXTRA_MELODY_ENABLED,json.optBoolean("melodyEnabled",true));
        if (json.has("drumsEnabled")) intent.putExtra(PlaybackService.EXTRA_DRUMS_ENABLED,json.optBoolean("drumsEnabled",false));
        intent.putExtra(PlaybackService.EXTRA_SEED,json.optLong("seed",1));
        return intent;
    }
    private void finishMidi(String result) {
        synchronized (MIDI_LOCK) { pendingMidi = null; midiStatus = result; }
        runOnUiThread(() -> { if (web != null) web.evaluateJavascript(
                "window.sou1MidiExportResult&&window.sou1MidiExportResult("+JSONObject.quote(result)+")", null); });
    }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request != SAVE_MIDI) return;
        final byte[] payload;
        synchronized (MIDI_LOCK) {
            if (!"pending".equals(midiStatus) || pendingMidi == null) { finishMidi("cancelled"); return; }
            payload = pendingMidi;
            midiStatus = "writing";
        }
        if (result != RESULT_OK || data == null || data.getData() == null) { finishMidi("cancelled"); return; }
        final Uri destination = data.getData();
        new Thread(() -> {
            try (OutputStream output = getContentResolver().openOutputStream(destination, "wt")) {
                if (output == null) throw new IOException("No destination stream");
                output.write(payload);
            } catch (IOException | RuntimeException failure) { finishMidi("failed"); return; }
            finishMidi("saved");
        }, "sou1-midi-save").start();
    }
    private final class Bridge {
        @JavascriptInterface public String midiExportStatus() { return midiStatus; }
        @JavascriptInterface public boolean exportMidi(String encoded, String filename) {
            if (encoded == null || encoded.length() > ((MIDI_MAX_BYTES+2)/3)*4 || filename == null || !filename.matches("SOU1-[0-9a-f]{8}\\.mid")) return false;
            final byte[] bytes;
            try { bytes = Base64.decode(encoded, Base64.NO_WRAP); }
            catch (IllegalArgumentException invalid) { return false; }
            if (bytes.length < 14 || bytes.length > MIDI_MAX_BYTES || bytes[0]!='M' || bytes[1]!='T' || bytes[2]!='h' || bytes[3]!='d' || bytes[4]!=0 || bytes[5]!=0 || bytes[6]!=0 || bytes[7]!=6) return false;
            synchronized (MIDI_LOCK) {
                if ("pending".equals(midiStatus) || "writing".equals(midiStatus)) return false;
                pendingMidi = bytes; midiStatus = "pending";
            }
            runOnUiThread(() -> {
                try {
                    Intent save = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                            .setType("audio/midi").putExtra(Intent.EXTRA_TITLE, filename);
                    startActivityForResult(save, SAVE_MIDI);
                } catch (RuntimeException unavailable) { finishMidi("failed"); }
            });
            return true;
        }
        @JavascriptInterface public boolean play(String data) {
            try { startForegroundService(command(PlaybackService.ACTION_PLAY,data));return true; }
            catch(RuntimeException|JSONException failure){ return false; }
        }
        @JavascriptInterface public void update(String data) {
            try { startService(command(PlaybackService.ACTION_UPDATE,data)); } catch(RuntimeException|JSONException ignored) { }
        }
        @JavascriptInterface public boolean reseed(long seed) {
            try {
                startService(new Intent(MainActivity.this,PlaybackService.class)
                        .setAction(PlaybackService.ACTION_RESEED).putExtra(PlaybackService.EXTRA_SEED,seed));
                return true;
            } catch(RuntimeException unavailable) { return false; }
        }
        @JavascriptInterface public void stop() {
            startService(new Intent(MainActivity.this,PlaybackService.class).setAction(PlaybackService.ACTION_STOP));
        }
        @JavascriptInterface public void clearScore(){startService(new Intent(MainActivity.this,PlaybackService.class).setAction("org.sou1.CLEAR_SCORE"));}
        @JavascriptInterface public String score(){return PlaybackService.getScoreSnapshot();}
        @JavascriptInterface public String status(){return PlaybackService.getStatus();}
        @JavascriptInterface public boolean isPlaying(){return PlaybackService.isPlaying();}
        @JavascriptInterface public double level(){return PlaybackService.getLevel();}
        @JavascriptInterface public String waveform(){try { return new JSONArray(PlaybackService.getWaveformSnapshot()).toString(); } catch (JSONException ignored) { return "[]"; }}
        @JavascriptInterface public void setTimer(int minutes) {
            startService(new Intent(MainActivity.this,PlaybackService.class).setAction("org.sou1.TIMER").putExtra("minutes",minutes));
        }
    }
    @Override public void onResume(){super.onResume();if(web!=null){web.onResume();web.evaluateJavascript("window.dispatchEvent(new Event('sou1-resume'))",null);}}
    @Override public void onPause(){if(web!=null)web.onPause();super.onPause();}
    @Override public void onDestroy(){if(isFinishing() && "pending".equals(midiStatus))finishMidi("cancelled");if(web!=null){web.removeJavascriptInterface("AndroidBridge");web.destroy();web=null;}super.onDestroy();}
}
