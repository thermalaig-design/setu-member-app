package com.Setu.app;

import android.app.Activity;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.razorpay.Checkout;
import com.razorpay.PaymentData;
import org.json.JSONObject;

// Opens Razorpay's native Android Checkout. The SDK reports the result to the
// Activity that opened it, so MainActivity forwards it to handleSuccess/handleError.
@CapacitorPlugin(name = "Razorpay")
public class RazorpayPlugin extends Plugin {
    private PluginCall pendingCall;

    @Override
    public void load() {
        Checkout.preload(getContext().getApplicationContext());
    }

    @PluginMethod
    public void open(PluginCall call) {
        JSObject options = call.getObject("options");
        String keyId = options == null ? null : options.getString("key");
        if (keyId == null || keyId.isEmpty()) {
            call.reject("Checkout options with a key are required.", "INVALID_OPTIONS");
            return;
        }

        Activity activity = getActivity();
        if (activity == null) {
            call.reject("Payment screen is not available.", "NO_ACTIVITY");
            return;
        }
        if (pendingCall != null) {
            call.reject("A payment is already in progress.", "PAYMENT_IN_PROGRESS");
            return;
        }

        pendingCall = call;
        activity.runOnUiThread(() -> {
            try {
                Checkout checkout = new Checkout();
                checkout.setKeyID(keyId);
                checkout.open(activity, options);
            } catch (Exception e) {
                rejectPending("Could not open Razorpay checkout.", "CHECKOUT_OPEN_FAILED");
            }
        });
    }

    void handleSuccess(String paymentId, PaymentData data) {
        PluginCall call = pendingCall;
        if (call == null) return;
        pendingCall = null;

        JSObject result = new JSObject();
        result.put("razorpay_payment_id", data != null && data.getPaymentId() != null ? data.getPaymentId() : paymentId);
        result.put("razorpay_order_id", data != null ? data.getOrderId() : null);
        result.put("razorpay_signature", data != null ? data.getSignature() : null);
        call.resolve(result);
    }

    void handleError(int code, String response) {
        if (code == Checkout.PAYMENT_CANCELED) {
            rejectPending("Payment cancelled.", "PAYMENT_CANCELLED");
            return;
        }
        rejectPending(describeError(response), "PAYMENT_FAILED");
    }

    private void rejectPending(String message, String code) {
        PluginCall call = pendingCall;
        if (call == null) return;
        pendingCall = null;
        call.reject(message, code);
    }

    // The SDK sends errors as JSON like {"error":{"description":"..."}}.
    private static String describeError(String response) {
        try {
            String description = new JSONObject(response).getJSONObject("error").optString("description");
            if (!description.isEmpty()) return description;
        } catch (Exception ignored) {
            // Not JSON; fall through to the generic message.
        }
        return "Payment failed. Please try again.";
    }
}
