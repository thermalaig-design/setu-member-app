package com.Setu.app;

import android.os.Bundle;
import android.content.pm.ApplicationInfo;

import com.getcapacitor.BridgeActivity;
import com.facebook.FacebookSdk;
import com.facebook.LoggingBehavior;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SecureScreenPlugin.class);
        registerPlugin(MetaEventsPlugin.class);

        super.onCreate(savedInstanceState);

        boolean isDebuggable =
                (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;

        if (isDebuggable) {
            FacebookSdk.setIsDebugEnabled(true);
            FacebookSdk.addLoggingBehavior(LoggingBehavior.APP_EVENTS);
            FacebookSdk.addLoggingBehavior(LoggingBehavior.REQUESTS);
        }
    }
}