package io.github.papabolso.menostela;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
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
    protected void onPause() {
        super.onPause();
        // Deixa os widgets atualizados ao sair do app.
        new Thread(() -> WidgetUpdater.updateAll(getApplicationContext())).start();
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
            return Usage.hasPermission(MainActivity.this);
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
            return Usage.between(MainActivity.this, (long) start, (long) end);
        }

        /** Relatório do dia em JSON: por hora, por app e desbloqueios. */
        @JavascriptInterface
        public String getDayReport(double start, double end) {
            try {
                return Usage.report(MainActivity.this, (long) start, (long) end).toString();
            } catch (Exception e) {
                return "{\"total\":0,\"unlocks\":0,\"hours\":[],\"apps\":[]}";
            }
        }

        @JavascriptInterface
        public String getAppIcon(String pkg) {
            return Usage.icon(MainActivity.this, pkg);
        }

        /** Guarda as configurações do plano para os widgets calcularem a meta sozinhos. */
        @JavascriptInterface
        public void saveSettings(String json) {
            WidgetUpdater.saveSettings(getApplicationContext(), json);
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
}
