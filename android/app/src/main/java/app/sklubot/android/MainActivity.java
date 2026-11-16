package app.sklubot.android;

import android.Manifest;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.inputmethod.EditorInfo;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Scanner;

/**
 * The whole app: a first-run screen that asks for the address of a Sklubot server, then that server's
 * web app shown full screen, with the pieces a plain browser tab would handle for it — file uploads,
 * downloads, microphone permission, the back button and links to other sites.
 */
public class MainActivity extends Activity {
    private static final String PREFS = "sklubot";
    private static final String KEY_SERVER = "server";
    private static final String ACTION_CHANGE_SERVER = "app.sklubot.android.CHANGE_SERVER";
    /** Launcher shortcut "Phone control", and the web app's "Link this phone" link (sklubot://relay). */
    private static final String ACTION_PHONE_RELAY = "app.sklubot.android.PHONE_RELAY";
    private static final int REQUEST_FILES = 1;
    private static final int REQUEST_MIC = 2;

    private FrameLayout root;
    private WebView web;
    private String server;
    private ValueCallback<Uri[]> pendingFiles;
    private PermissionRequest pendingMic;
    private final Handler main = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        root = new FrameLayout(this);
        root.setBackgroundColor(getColor(R.color.surface));
        // Recent Android versions draw apps under the status and navigation bars; keep our content clear of them and of the keyboard.
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            int bottom = Math.max(insets.getSystemWindowInsetBottom(), 0);
            if (android.os.Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime() | WindowInsets.Type.displayCutout());
                v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            } else {
                v.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), bottom);
            }
            return insets;
        });
        setContentView(root);

        server = prefs().getString(KEY_SERVER, null);
        if (server == null || ACTION_CHANGE_SERVER.equals(getIntent().getAction())) showSetup(server);
        else showWeb(state);
        if (server != null && ACTION_PHONE_RELAY.equals(getIntent().getAction())) openRelay();
    }

    private void openRelay() {
        startActivity(new Intent(this, app.sklubot.android.relay.RelayActivity.class));
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (ACTION_CHANGE_SERVER.equals(intent.getAction())) showSetup(server);
        else if (ACTION_PHONE_RELAY.equals(intent.getAction()) && server != null) openRelay();
    }

    private SharedPreferences prefs() {
        return getSharedPreferences(PREFS, MODE_PRIVATE);
    }

    // ── First run: which server? ─────────────────────────────────────────────
    private void showSetup(String current) {
        if (web != null) { web.destroy(); web = null; }
        root.removeAllViews();
        View view = getLayoutInflater().inflate(R.layout.setup, root, false);
        root.addView(view);
        EditText address = view.findViewById(R.id.address);
        TextView error = view.findViewById(R.id.error);
        Button connect = view.findViewById(R.id.connect);
        if (current != null) address.setText(current);
        else if (!BuildConfig.DEFAULT_SERVER.isEmpty()) address.setText(BuildConfig.DEFAULT_SERVER);

        final String[] lastFailed = { null };
        Runnable submit = () -> {
            String base = normalise(address.getText().toString());
            if (base == null) { error.setText(R.string.setup_invalid); error.setVisibility(View.VISIBLE); return; }
            error.setVisibility(View.GONE);
            connect.setEnabled(false);
            connect.setText(R.string.setup_checking);
            new Thread(() -> {
                boolean ok = isSklubot(base);
                main.post(() -> {
                    if (isFinishing() || isDestroyed()) return;
                    connect.setEnabled(true);
                    connect.setText(R.string.setup_button);
                    // Second press on the same address after a failed check: open it anyway (a flaky network or a
                    // proxy can make the check fail while the site itself loads fine in the WebView).
                    boolean retry = base.equals(lastFailed[0]);
                    if (!ok && !retry) { lastFailed[0] = base; error.setText(R.string.setup_unreachable_retry); error.setVisibility(View.VISIBLE); return; }
                    server = base;
                    prefs().edit().putString(KEY_SERVER, base).apply();
                    showWeb(null);
                });
            }).start();
        };
        connect.setOnClickListener(v -> submit.run());
        address.setOnEditorActionListener((v, action, event) -> {
            if (action == EditorInfo.IME_ACTION_GO || (event != null && event.getKeyCode() == KeyEvent.KEYCODE_ENTER)) { submit.run(); return true; }
            return false;
        });
    }

    /** "sklubot.example.com/" → "https://sklubot.example.com". Returns null when it cannot be an address. */
    static String normalise(String raw) {
        String s = raw == null ? "" : raw.trim();
        if (s.isEmpty() || s.contains(" ")) return null;
        if (!s.matches("(?i)^https?://.*")) s = "https://" + s;
        try {
            URL url = new URL(s);
            if (url.getHost() == null || url.getHost().isEmpty()) return null;
            return url.getProtocol().toLowerCase() + "://" + url.getAuthority();
        } catch (Exception e) {
            return null;
        }
    }

    /** A Sklubot server answers its health check with a small JSON object saying it is fine. */
    private static boolean isSklubot(String base) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(base + "/api/health").openConnection();
            c.setConnectTimeout(8000);
            c.setReadTimeout(8000);
            if (c.getResponseCode() != 200) return false;
            try (Scanner in = new Scanner(c.getInputStream(), "UTF-8")) {
                String body = in.useDelimiter("\\A").hasNext() ? in.next() : "";
                return body.replace(" ", "").contains("\"ok\":true");
            }
        } catch (Exception e) {
            return false;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    // ── The app itself ───────────────────────────────────────────────────────
    private void showWeb(Bundle state) {
        root.removeAllViews();
        web = new WebView(this);
        web.setBackgroundColor(getColor(R.color.surface));
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setSupportZoom(false);
        s.setUserAgentString(s.getUserAgentString() + " SklubotAndroid/1.0");
        CookieManager.getInstance().setAcceptCookie(true);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (uri.toString().startsWith(server + "/") || uri.toString().equals(server)) return false;
                // The web app's "Link this phone" (Settings → Computers, shown only inside this app): our own screen,
                // opened explicitly. It only shows the relay screen; turning the relay on stays a tap of the user there.
                if ("sklubot".equals(uri.getScheme()) && "relay".equals(uri.getHost())) { openRelay(); return true; }
                // Anything outside our server belongs in the phone's own browser.
                try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch (ActivityNotFoundException ignored) { }
                return true;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showLoadError();
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                CookieManager.getInstance().flush();
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (pendingFiles != null) pendingFiles.onReceiveValue(null);
                pendingFiles = callback;
                Intent pick = new Intent(Intent.ACTION_GET_CONTENT);
                pick.addCategory(Intent.CATEGORY_OPENABLE);
                pick.setType("*/*");
                pick.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                try {
                    startActivityForResult(Intent.createChooser(pick, null), REQUEST_FILES);
                } catch (ActivityNotFoundException e) {
                    pendingFiles = null;
                    return false;
                }
                return true;
            }

            @Override
            public void onPermissionRequest(PermissionRequest request) {
                boolean wantsMic = false;
                for (String r : request.getResources()) if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)) wantsMic = true;
                // Only our own server may use the microphone, and only that.
                if (!wantsMic || !request.getOrigin().toString().startsWith(server)) { request.deny(); return; }
                if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                    request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                } else {
                    pendingMic = request;
                    requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQUEST_MIC);
                }
            }
        });

        web.setDownloadListener((url, userAgent, disposition, mime, length) -> {
            try {
                DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
                String cookie = CookieManager.getInstance().getCookie(url);
                if (cookie != null) req.addRequestHeader("Cookie", cookie);
                req.addRequestHeader("User-Agent", userAgent);
                String name = URLUtil.guessFileName(url, disposition, mime);
                req.setTitle(name);
                req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                req.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
                ((DownloadManager) getSystemService(DOWNLOAD_SERVICE)).enqueue(req);
                Toast.makeText(this, R.string.download_started, Toast.LENGTH_SHORT).show();
            } catch (Exception e) {
                try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); } catch (ActivityNotFoundException ignored) { }
            }
        });

        if (state == null || web.restoreState(state) == null) web.loadUrl(server + "/");
    }

    private void showLoadError() {
        root.removeAllViews();
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER);
        int pad = (int) (28 * getResources().getDisplayMetrics().density);
        box.setPadding(pad, pad, pad, pad);
        TextView text = new TextView(this);
        text.setText(R.string.load_error);
        text.setTextSize(16);
        text.setTextColor(Color.parseColor("#1D1E22"));
        text.setGravity(Gravity.CENTER);
        Button retry = new Button(this);
        retry.setText(R.string.retry);
        retry.setOnClickListener(v -> showWeb(null));
        Button change = new Button(this);
        change.setText(R.string.change_server);
        change.setOnClickListener(v -> showSetup(server));
        LinearLayout.LayoutParams gap = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        gap.topMargin = pad / 2;
        box.addView(text);
        box.addView(retry, gap);
        box.addView(change, gap);
        root.addView(box);
        if (web != null) { web.destroy(); web = null; }
    }

    @Override
    protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request != REQUEST_FILES || pendingFiles == null) return;
        Uri[] picked = null;
        if (result == RESULT_OK && data != null) {
            if (data.getClipData() != null) {
                picked = new Uri[data.getClipData().getItemCount()];
                for (int i = 0; i < picked.length; i++) picked[i] = data.getClipData().getItemAt(i).getUri();
            } else if (data.getData() != null) {
                picked = new Uri[]{data.getData()};
            }
        }
        pendingFiles.onReceiveValue(picked);
        pendingFiles = null;
    }

    @Override
    public void onRequestPermissionsResult(int request, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(request, permissions, results);
        if (request != REQUEST_MIC || pendingMic == null) return;
        if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) {
            pendingMic.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
        } else {
            pendingMic.deny();
            Toast.makeText(this, R.string.mic_denied, Toast.LENGTH_LONG).show();
        }
        pendingMic = null;
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        if (web != null) web.saveState(out);
    }

    @Override
    protected void onDestroy() {
        if (web != null) web.destroy();
        super.onDestroy();
    }
}
