package io.github.papabolso.menostela;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;

/** Widget pequeno (2×1). Também recebe o alarme de atualização periódica. */
public class SmallWidget extends AppWidgetProvider {
    @Override
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        refresh(this, c);
    }

    @Override
    public void onReceive(Context c, Intent intent) {
        if (WidgetUpdater.ACTION_REFRESH.equals(intent.getAction())) refresh(this, c);
        else super.onReceive(c, intent);
    }

    /** Ler o uso pode levar alguns instantes, então roda fora da thread principal. */
    static void refresh(AppWidgetProvider p, Context c) {
        final PendingResult result = p.goAsync();
        new Thread(() -> {
            try {
                WidgetUpdater.updateAll(c.getApplicationContext());
            } finally {
                result.finish();
            }
        }).start();
    }
}
