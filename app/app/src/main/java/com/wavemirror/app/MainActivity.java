package com.wavemirror.app;

import android.annotation.SuppressLint;
import android.content.Intent;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.RelativeLayout;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

public class MainActivity extends AppCompatActivity {

    // Load bundled local assets for full independent offline/instant startup
    private static final String TARGET_URL = "file:///android_asset/index.html";

    private WebView webView;
    private SwipeRefreshLayout swipeRefresh;
    private RelativeLayout splashOverlay;
    private FrameLayout customViewContainer;
    private View customView;
    private WebChromeClient.CustomViewCallback customViewCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        // Keep screen on during streaming playback & optimize hardware acceleration
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        webView = findViewById(R.id.webView);
        swipeRefresh = findViewById(R.id.swipeRefresh);
        splashOverlay = findViewById(R.id.splashOverlay);
        customViewContainer = findViewById(R.id.customViewContainer);

        setupWebView();
        setupSwipeRefresh();
        setupBackNavigation();

        webView.loadUrl(TARGET_URL);
    }

    @SuppressLint({"SetJavaScriptEnabled", "JavascriptInterface"})
    private void setupWebView() {
        WebSettings settings = webView.getSettings();
        
        // Essential Web App, Storage & Hardware Acceleration Settings
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setAllowUniversalAccessFromFileURLs(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setSupportZoom(false);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);

        // Native Popup & Ad Shield Settings
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
            CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);
        }

        // Bridge native Android capabilities into web context
        webView.addJavascriptInterface(new WaveMirrorBridge(this), "WaveMirrorNative");

        // WebView Client for Asset Routing, Direct Downloads & Ad Protection
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                swipeRefresh.setRefreshing(false);
                if (splashOverlay.getVisibility() == View.VISIBLE) {
                    splashOverlay.animate()
                            .alpha(0f)
                            .setDuration(350)
                            .withEndAction(() -> splashOverlay.setVisibility(View.GONE));
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();

                // Handle magnet & custom URI schemes directly
                if (url.startsWith("magnet:") || url.startsWith("intent:")) {
                    try {
                        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                        startActivity(intent);
                        return true;
                    } catch (Exception e) {
                        Toast.makeText(MainActivity.this, "No external app found to handle this link", Toast.LENGTH_SHORT).show();
                        return true;
                    }
                }

                // Handle local asset navigations
                if (url.startsWith("file:///android_asset/")) {
                    return false;
                }

                // Handle TMDB API, safe stream providers & embeds
                if (url.contains("themoviedb.org") || 
                    url.contains("vidsrc") || 
                    url.contains("autoembed") || 
                    url.contains("embed.su") || 
                    url.contains("vidlink") || 
                    url.contains("2embed") || 
                    url.contains("superstream") || 
                    url.contains("youtube") || 
                    url.contains("google") || 
                    url.contains("gstatic") ||
                    url.contains("tmdb.org")) {
                    return false;
                }

                // Block suspicious popups/redirects
                if (url.startsWith("http://") || url.startsWith("https://")) {
                    Toast.makeText(MainActivity.this, "🛡️ External Ad Redirect Blocked", Toast.LENGTH_SHORT).show();
                    return true;
                }

                return false;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                super.onReceivedError(view, request, error);
            }
        });

        // WebChromeClient with Built-In Popup Protection & Fullscreen Video Playback
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, android.os.Message resultMsg) {
                // Block all script-created popup windows automatically
                Toast.makeText(MainActivity.this, "🛡️ Ad Popup Window Blocked", Toast.LENGTH_SHORT).show();
                return false;
            }

            @Override
            public void onShowCustomView(View view, CustomViewCallback callback) {
                if (customView != null) {
                    onHideCustomView();
                    return;
                }
                customView = view;
                customViewCallback = callback;
                customViewContainer.addView(customView, new FrameLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT));
                customViewContainer.setVisibility(View.VISIBLE);
                swipeRefresh.setVisibility(View.GONE);

                // Hide status & navigation bars for immersive video
                getWindow().getDecorView().setSystemUiVisibility(
                        View.SYSTEM_UI_FLAG_FULLSCREEN
                                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
            }

            @Override
            public void onHideCustomView() {
                if (customView == null) return;

                customViewContainer.removeView(customView);
                customView = null;
                customViewContainer.setVisibility(View.GONE);
                swipeRefresh.setVisibility(View.VISIBLE);

                if (customViewCallback != null) {
                    customViewCallback.onCustomViewHidden();
                    customViewCallback = null;
                }

                getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);
            }
        });
    }

    private void setupSwipeRefresh() {
        swipeRefresh.setColorSchemeResources(R.color.primary_cyan, R.color.primary_violet);
        swipeRefresh.setProgressBackgroundColorSchemeResource(R.color.bg_glass);
        swipeRefresh.setOnRefreshListener(() -> {
            webView.reload();
        });
    }

    private void setupBackNavigation() {
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (customView != null) {
                    // Exit fullscreen video
                    if (webView.getWebChromeClient() != null) {
                        webView.getWebChromeClient().onHideCustomView();
                    }
                    return;
                }

                // Check if web app modal/drawer is open
                webView.evaluateJavascript("typeof handleAndroidBack === 'function' ? handleAndroidBack() : false;", new ValueCallback<String>() {
                    @Override
                    public void onReceiveValue(String value) {
                        if ("true".equals(value)) {
                            // Handled by in-page navigation (e.g. closed drawer or modal)
                            return;
                        }

                        if (webView.canGoBack()) {
                            webView.goBack();
                        } else {
                            finish();
                        }
                    }
                });
            }
        });
    }

    @Override
    protected void onPause() {
        super.onPause();
        webView.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        webView.onResume();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
        }
        super.onDestroy();
    }
}
