package com.amyc.finance;

import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.community.database.sqlite.CapacitorSQLitePlugin;

import java.io.File;

public class MainActivity extends BridgeActivity {
    private static final String PREFS_NAME = "amyc_native_startup";
    private static final String CACHE_RESET_VERSION_KEY = "webview_cache_reset_version";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(CapacitorSQLitePlugin.class);
        resetStaleWebViewCacheOncePerVersion();
        super.onCreate(savedInstanceState);
    }

    private void resetStaleWebViewCacheOncePerVersion() {
        try {
            int versionCode = getCurrentVersionCode();
            SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
            if (prefs.getInt(CACHE_RESET_VERSION_KEY, -1) == versionCode) {
                return;
            }

            deleteRecursively(getCacheDir());
            deleteRecursively(new File(getApplicationInfo().dataDir, "app_webview/Service Worker"));
            deleteRecursively(new File(getApplicationInfo().dataDir, "app_webview/Default/Service Worker"));

            prefs.edit().putInt(CACHE_RESET_VERSION_KEY, versionCode).apply();
        } catch (Exception ignored) {
            // Startup must never be blocked by cache cleanup.
        }
    }

    private int getCurrentVersionCode() throws Exception {
        PackageInfo packageInfo = getPackageManager().getPackageInfo(getPackageName(), 0);
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.P) {
            return (int) packageInfo.getLongVersionCode();
        }
        return packageInfo.versionCode;
    }

    private void deleteRecursively(File file) {
        if (file == null || !file.exists()) return;
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children != null) {
                for (File child : children) {
                    deleteRecursively(child);
                }
            }
        }
        file.delete();
    }
}
