package com.Setu.app;

import android.os.Bundle;
import android.util.Log;

import java.util.Iterator;
import org.json.JSONObject;

import com.facebook.appevents.AppEventsConstants;
import com.facebook.appevents.AppEventsLogger;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "MetaEvents")
public class MetaEventsPlugin extends Plugin {

    private static final String TAG = "MetaEvents";

    @PluginMethod
    public void logViewContent(PluginCall call) {
        String contentId = call.getString("contentId");
        String contentType = call.getString("contentType");
        String contentName = call.getString("contentName");

        if (contentId == null || contentId.trim().isEmpty()) {
            Log.w(TAG, "ViewContent skipped: contentId is missing");
            call.reject("contentId is required");
            return;
        }

        if (contentType == null || contentType.trim().isEmpty()) {
            Log.w(TAG, "ViewContent skipped: contentType is missing");
            call.reject("contentType is required");
            return;
        }

        if (contentName == null || contentName.trim().isEmpty()) {
            Log.w(TAG, "ViewContent skipped: contentName is missing");
            call.reject("contentName is required");
            return;
        }

        try {
            Bundle params = new Bundle();

            // Meta standard parameter -> fb_content_id
            params.putString(
                    AppEventsConstants.EVENT_PARAM_CONTENT_ID,
                    contentId
            );

            // Meta standard parameter -> fb_content_type
            params.putString(
                    AppEventsConstants.EVENT_PARAM_CONTENT_TYPE,
                    contentType
            );

            // Meta standard parameter -> fb_description
            params.putString(
                    AppEventsConstants.EVENT_PARAM_DESCRIPTION,
                    contentName
            );

            // Custom readable parameter; Meta UI may or may not display this.
            params.putString(
                    "content_name",
                    contentName
            );

            Log.d(
                    TAG,
                    "About to send ViewContent"
                            + " | contentId=" + contentId
                            + " | contentType=" + contentType
                            + " | contentName=" + contentName
            );

            AppEventsLogger logger = AppEventsLogger.newLogger(getContext());

            logger.logEvent(
                    AppEventsConstants.EVENT_NAME_VIEWED_CONTENT,
                    params
            );

            // Testing ke time immediate send ke liye.
            // Meta verification complete hone ke baad remove kar sakte ho.
            logger.flush();

            Log.d(
                    TAG,
                    "ViewContent logged and flushed"
                            + " | contentId=" + contentId
            );

            call.resolve();

        } catch (Exception e) {
            Log.e(TAG, "Failed to log ViewContent", e);
            call.reject("Failed to log ViewContent", e);
        }
    }

    @PluginMethod
    public void logEvent(PluginCall call) {
        String eventName = call.getString("eventName");

        if (eventName == null || eventName.trim().isEmpty()) {
            Log.w(TAG, "logEvent skipped: eventName is missing");
            call.reject("eventName is required");
            return;
        }

        try {
            Bundle params = new Bundle();
            JSObject jsParams = call.getObject("params");

            if (jsParams != null) {
                Iterator<String> keys = jsParams.keys();
                while (keys.hasNext()) {
                    String key = keys.next();
                    Object value = jsParams.opt(key);
                    if (value == null || value == JSONObject.NULL) continue;
                    params.putString(key, String.valueOf(value));
                }
            }

            AppEventsLogger.newLogger(getContext()).logEvent(eventName.trim(), params);

            Log.d(TAG, "Event logged | eventName=" + eventName.trim());

            call.resolve();

        } catch (Exception e) {
            Log.e(TAG, "Failed to log event: " + eventName, e);
            call.reject("Failed to log event", e);
        }
    }
}