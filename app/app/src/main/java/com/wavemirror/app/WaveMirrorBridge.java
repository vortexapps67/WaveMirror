package com.wavemirror.app;

import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.view.HapticFeedbackConstants;
import android.webkit.JavascriptInterface;
import android.widget.Toast;

public class WaveMirrorBridge {

    private final MainActivity activity;

    public WaveMirrorBridge(MainActivity activity) {
        this.activity = activity;
    }

    @JavascriptInterface
    public boolean isNativeApp() {
        return true;
    }

    @JavascriptInterface
    public String getAppVersion() {
        return "1.0.0";
    }

    @JavascriptInterface
    public void showToast(String message) {
        if (activity == null || message == null) return;
        activity.runOnUiThread(() -> 
            Toast.makeText(activity, message, Toast.LENGTH_SHORT).show()
        );
    }

    @JavascriptInterface
    public void triggerHaptic() {
        if (activity == null) return;
        activity.runOnUiThread(() -> {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    VibratorManager vibratorManager = (VibratorManager) activity.getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
                    if (vibratorManager != null) {
                        Vibrator vibrator = vibratorManager.getDefaultVibrator();
                        vibrator.vibrate(VibrationEffect.createPredefined(VibrationEffect.EFFECT_CLICK));
                    }
                } else {
                    Vibrator vibrator = (Vibrator) activity.getSystemService(Context.VIBRATOR_SERVICE);
                    if (vibrator != null && vibrator.hasVibrator()) {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                            vibrator.vibrate(VibrationEffect.createOneShot(20, VibrationEffect.DEFAULT_AMPLITUDE));
                        } else {
                            vibrator.vibrate(20);
                        }
                    }
                }
            } catch (Exception ignored) {}
        });
    }

    @JavascriptInterface
    public void shareContent(String title, String text, String url) {
        if (activity == null) return;
        activity.runOnUiThread(() -> {
            try {
                Intent shareIntent = new Intent(Intent.ACTION_SEND);
                shareIntent.setType("text/plain");
                shareIntent.putExtra(Intent.EXTRA_SUBJECT, title);
                String shareBody = (text != null && !text.isEmpty() ? text + "\n\n" : "") + url;
                shareIntent.putExtra(Intent.EXTRA_TEXT, shareBody);
                activity.startActivity(Intent.createChooser(shareIntent, "Share via"));
            } catch (Exception e) {
                Toast.makeText(activity, "Unable to open share menu", Toast.LENGTH_SHORT).show();
            }
        });
    }

    @JavascriptInterface
    public void downloadMedia(String url, String filename) {
        if (activity == null || url == null) return;
        activity.runOnUiThread(() -> {
            try {
                if (url.startsWith("magnet:") || url.startsWith("intent:")) {
                    Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                    activity.startActivity(intent);
                    return;
                }

                DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
                request.setTitle(filename != null && !filename.isEmpty() ? filename : "WaveMirror Media Download");
                request.setDescription("Downloading file from WaveMirror");
                request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, 
                        filename != null && !filename.isEmpty() ? filename : "WaveMirror_Video.mp4");
                request.setAllowedOverMetered(true);
                request.setAllowedOverRoaming(true);

                DownloadManager downloadManager = (DownloadManager) activity.getSystemService(Context.DOWNLOAD_SERVICE);
                if (downloadManager != null) {
                    downloadManager.enqueue(request);
                    Toast.makeText(activity, "⬇️ Download started in notification bar", Toast.LENGTH_SHORT).show();
                }
            } catch (Exception e) {
                // Fallback to opening in external browser / downloader
                try {
                    Intent browserIntent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                    activity.startActivity(browserIntent);
                } catch (Exception ex) {
                    Toast.makeText(activity, "Error initiating download", Toast.LENGTH_SHORT).show();
                }
            }
        });
    }
}
