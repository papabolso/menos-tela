package io.github.papabolso.menostela;

import android.app.Activity;
import android.app.AppOpsManager;
import android.app.usage.UsageEvents;
import android.app.usage.UsageStatsManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.os.Bundle;
import android.os.Process;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewClientCompat;

import java.util.HashSet;
import java.util.Set;

public class MainActivity extends Activity {
    // Origem fixa: o localStorage (onde ficam os dados) fica preso a ela.
    private static final String APP_URL = "https://appassets.androidplatform.net/assets/www/index.html";
    private static final int PICK_FILE = 1;

    private WebView web;
    private ValueCallback<Uri[]> fileCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);

        web.setWebViewClient(new WebViewClientCompat() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return loader.shouldInterceptRequest(request.getUrl());
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent i = new Intent(Intent.ACTION_GET_CONTENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
                startActivityForResult(Intent.createChooser(i, "Importar backup"), PICK_FILE);
                return true;
            }
        });
        web.addJavascriptInterface(new Bridge(), "MenosTelaNative");
        web.loadUrl(APP_URL);
        setContentView(web);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.evaluateJavascript("window.onNativeResume && window.onNativeResume()", null);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == PICK_FILE && fileCallback != null) {
            Uri uri = resultCode == RESULT_OK && data != null ? data.getData() : null;
            fileCallback.onReceiveValue(uri != null ? new Uri[]{uri} : null);
            fileCallback = null;
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onBackPressed() {
        web.evaluateJavascript("window.onNativeBack ? window.onNativeBack() : false", value -> {
            if (!"true".equals(value)) MainActivity.super.onBackPressed();
        });
    }

    /** Métodos expostos ao JavaScript como window.MenosTelaNative. */
    private class Bridge {
        @JavascriptInterface
        public boolean hasUsagePermission() {
            AppOpsManager ops = (AppOpsManager) getSystemService(Context.APP_OPS_SERVICE);
            int mode = ops.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), getPackageName());
            return mode == AppOpsManager.MODE_ALLOWED;
        }

        @JavascriptInterface
        public void openUsageSettings() {
            runOnUiThread(() -> {
                Intent i = new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS);
                i.setData(Uri.parse("package:" + getPackageName()));
                try {
                    startActivity(i);
                } catch (Exception e) {
                    startActivity(new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS));
                }
            });
        }

        /** Tempo de tela (ms) entre start e end, em epoch ms. */
        @JavascriptInterface
        public double getUsage(double start, double end) {
            return usageBetween((long) start, (long) end);
        }

        @JavascriptInterface
        public void shareBackup(String json) {
            runOnUiThread(() -> {
                Intent i = new Intent(Intent.ACTION_SEND).setType("application/json");
                i.putExtra(Intent.EXTRA_SUBJECT, "Backup Menos Tela");
                i.putExtra(Intent.EXTRA_TEXT, json);
                startActivity(Intent.createChooser(i, "Salvar backup"));
            });
        }
    }

    /**
     * Soma os intervalos em que algum app (exceto o launcher e a barra do sistema) estava em primeiro
     * plano, como o Bem-estar digital faz. Começa a ler 3h antes para saber o que já estava aberto.
     */
    private long usageBetween(long start, long end) {
        if (end <= start) return 0;
        UsageStatsManager usm = (UsageStatsManager) getSystemService(Context.USAGE_STATS_SERVICE);
        UsageEvents events = usm.queryEvents(start - 3 * 3600_000L, end);
        Set<String> ignored = ignoredPackages();

        Set<String> resumed = new HashSet<>();
        long since = -1, total = 0;
        UsageEvents.Event e = new UsageEvents.Event();
        while (events.hasNextEvent()) {
            events.getNextEvent(e);
            long t = e.getTimeStamp();
            int type = e.getEventType();
            boolean wasActive = !resumed.isEmpty();

            if (type == UsageEvents.Event.ACTIVITY_RESUMED) {
                if (ignored.contains(e.getPackageName())) continue;
                resumed.add(e.getPackageName() + "/" + e.getClassName());
            } else if (type == UsageEvents.Event.ACTIVITY_PAUSED || type == UsageEvents.Event.ACTIVITY_STOPPED) {
                resumed.remove(e.getPackageName() + "/" + e.getClassName());
            } else if (type == UsageEvents.Event.SCREEN_NON_INTERACTIVE || type == UsageEvents.Event.DEVICE_SHUTDOWN) {
                resumed.clear();
            } else {
                continue;
            }

            boolean active = !resumed.isEmpty();
            if (!wasActive && active) since = t;
            if (wasActive && !active) total += overlap(since, t, start, end);
        }
        if (!resumed.isEmpty() && since >= 0) total += overlap(since, Math.min(end, System.currentTimeMillis()), start, end);
        return total;
    }

    private static long overlap(long a, long b, long start, long end) {
        return Math.max(0, Math.min(b, end) - Math.max(a, start));
    }

    private Set<String> ignoredPackages() {
        Set<String> out = new HashSet<>();
        out.add("com.android.systemui");
        Intent home = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME);
        for (ResolveInfo ri : getPackageManager().queryIntentActivities(home, PackageManager.MATCH_DEFAULT_ONLY)) {
            out.add(ri.activityInfo.packageName);
        }
        return out;
    }
}
