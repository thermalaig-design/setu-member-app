package com.Setu.app;

import android.app.Activity;
import android.view.Window;
import android.view.WindowManager;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.PluginMethod;

@CapacitorPlugin(name = "SecureScreen")
public class SecureScreenPlugin extends Plugin {
    private boolean secureEnabled = false;

    @PluginMethod
    public void enable(PluginCall call) {
        setSecureFlag(true, call);
    }

    @PluginMethod
    public void disable(PluginCall call) {
        setSecureFlag(false, call);
    }

    private void setSecureFlag(boolean enabled, PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.resolve();
            return;
        }

        activity.runOnUiThread(() -> {
            Window window = activity.getWindow();
            if (enabled) {
                if (!secureEnabled) {
                    window.addFlags(WindowManager.LayoutParams.FLAG_SECURE);
                    secureEnabled = true;
                }
            } else if (secureEnabled) {
                window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
                secureEnabled = false;
            }

            call.resolve();
        });
    }
}
