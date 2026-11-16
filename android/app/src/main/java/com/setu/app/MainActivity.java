package com.Setu.app;

import android.os.Bundle;
import android.content.pm.ApplicationInfo;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.PluginHandle;
import com.facebook.FacebookSdk;
import com.facebook.LoggingBehavior;
import com.razorpay.PaymentData;
import com.razorpay.PaymentResultWithDataListener;

public class MainActivity extends BridgeActivity implements PaymentResultWithDataListener {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SecureScreenPlugin.class);
        registerPlugin(MetaEventsPlugin.class);
        registerPlugin(SystemInfoPlugin.class);
        registerPlugin(RazorpayPlugin.class);

        super.onCreate(savedInstanceState);

        boolean isDebuggable =
                (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;

        if (isDebuggable) {
            FacebookSdk.setIsDebugEnabled(true);
            FacebookSdk.addLoggingBehavior(LoggingBehavior.APP_EVENTS);
            FacebookSdk.addLoggingBehavior(LoggingBehavior.REQUESTS);
        }
    }

    // Razorpay delivers checkout results to this Activity; hand them to the plugin.
    @Override
    public void onPaymentSuccess(String paymentId, PaymentData data) {
        RazorpayPlugin plugin = razorpayPlugin();
        if (plugin != null) plugin.handleSuccess(paymentId, data);
    }

    @Override
    public void onPaymentError(int code, String response, PaymentData data) {
        RazorpayPlugin plugin = razorpayPlugin();
        if (plugin != null) plugin.handleError(code, response);
    }

    private RazorpayPlugin razorpayPlugin() {
        if (getBridge() == null) return null;
        PluginHandle handle = getBridge().getPlugin("Razorpay");
        return handle == null ? null : (RazorpayPlugin) handle.getInstance();
    }
}
