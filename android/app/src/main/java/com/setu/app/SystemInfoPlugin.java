package com.Setu.app;

import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.os.Build;
import android.util.Log;

import java.util.List;
import org.json.JSONObject;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Device + default-browser details for the login session audit.
 * Uses only Build.* and PackageManager: no permissions, no device identifiers
 * (IMEI / Android ID / serial / MAC / advertising ID), no package list.
 */
@CapacitorPlugin(name = "SystemInfo")
public class SystemInfoPlugin extends Plugin {

    private static final String TAG = "SystemInfo";
    private static final String PROBE_URL = "https://example.com";

    private static final String STATUS_RESOLVED = "resolved";
    private static final String STATUS_NO_DEFAULT = "no_default";
    private static final String STATUS_UNAVAILABLE = "unavailable";

    @PluginMethod
    public void getSystemInfo(PluginCall call) {
        JSObject result = new JSObject();
        result.put("device_manufacturer", Build.MANUFACTURER);
        result.put("device_brand", Build.BRAND);
        result.put("device_model", Build.MODEL);
        result.put("android_version", Build.VERSION.RELEASE);
        result.put("android_sdk", Build.VERSION.SDK_INT);

        String browserPackage = null;
        String browserName = null;
        String browserStatus;

        try {
            PackageManager pm = getContext().getPackageManager();
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(PROBE_URL));
            intent.addCategory(Intent.CATEGORY_BROWSABLE);

            ResolveInfo defaultHandler = resolveDefault(pm, intent);
            ActivityInfo activity = defaultHandler != null ? defaultHandler.activityInfo : null;

            if (activity == null || isChooser(activity) || !isHttpsHandler(pm, intent, activity.packageName)) {
                // No fixed default: Android would show its resolver/chooser.
                browserStatus = STATUS_NO_DEFAULT;
            } else {
                browserPackage = activity.packageName;
                CharSequence label = pm.getApplicationLabel(activity.applicationInfo);
                browserName = label != null ? label.toString() : null;
                browserStatus = STATUS_RESOLVED;
            }
        } catch (Exception e) {
            Log.w(TAG, "Default browser lookup failed", e);
            browserPackage = null;
            browserName = null;
            browserStatus = STATUS_UNAVAILABLE;
        }

        // JSONObject.put(key, null) drops the key; JSONObject.NULL keeps it as null.
        result.put("default_browser_name", browserName != null ? browserName : JSONObject.NULL);
        result.put("default_browser_package", browserPackage != null ? browserPackage : JSONObject.NULL);
        result.put("default_browser_status", browserStatus);
        result.put("device_info_source", "android-native");

        call.resolve(result);
    }

    private ResolveInfo resolveDefault(PackageManager pm, Intent intent) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return pm.resolveActivity(
                    intent,
                    PackageManager.ResolveInfoFlags.of(PackageManager.MATCH_DEFAULT_ONLY)
            );
        }
        return pm.resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY);
    }

    @SuppressWarnings("deprecation")
    private List<ResolveInfo> queryHandlers(PackageManager pm, Intent intent) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return pm.queryIntentActivities(
                    intent,
                    PackageManager.ResolveInfoFlags.of(PackageManager.MATCH_DEFAULT_ONLY)
            );
        }
        return pm.queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY);
    }

    // The system resolver/chooser (package "android", or the separate
    // IntentResolver module on newer releases) is never a real browser.
    private boolean isChooser(ActivityInfo activity) {
        String pkg = activity.packageName != null ? activity.packageName : "";
        String name = activity.name != null ? activity.name : "";
        return "android".equals(pkg)
                || pkg.endsWith(".intentresolver")
                || name.endsWith("ResolverActivity")
                || name.endsWith("ChooserActivity");
    }

    // The resolved package must itself be one of the HTTPS handlers; otherwise
    // it is a vendor resolver/chooser rather than a browser.
    private boolean isHttpsHandler(PackageManager pm, Intent intent, String packageName) {
        if (packageName == null) return false;
        List<ResolveInfo> handlers = queryHandlers(pm, intent);
        if (handlers == null) return false;
        for (ResolveInfo handler : handlers) {
            if (handler.activityInfo != null && packageName.equals(handler.activityInfo.packageName)) {
                return true;
            }
        }
        return false;
    }
}
