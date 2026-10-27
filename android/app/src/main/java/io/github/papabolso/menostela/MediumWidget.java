package io.github.papabolso.menostela;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;

/** Widget médio (4×2): total, barra de progresso, períodos e aviso. */
public class MediumWidget extends AppWidgetProvider {
    @Override
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        SmallWidget.refresh(this, c);
    }
}
