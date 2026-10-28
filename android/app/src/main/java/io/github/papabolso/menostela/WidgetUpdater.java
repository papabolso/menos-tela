package io.github.papabolso.menostela;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Typeface;
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.style.StyleSpan;
import android.view.View;
import android.widget.RemoteViews;

/** Monta os widgets a partir da tendência do dia (Trend). */
final class WidgetUpdater {
    static final String ACTION_REFRESH = "io.github.papabolso.menostela.REFRESH";
    private static final String[] ICONS = {"☀️", "🌤️", "🌙"};

    private WidgetUpdater() {}

    static void saveSettings(Context c, String json) {
        c.getSharedPreferences(Plan.PREFS, Context.MODE_PRIVATE).edit().putString(Plan.KEY_SETTINGS, json).apply();
        updateAll(c);
    }

    private static boolean hasWidgets(Context c) {
        AppWidgetManager m = AppWidgetManager.getInstance(c);
        return m.getAppWidgetIds(new ComponentName(c, SmallWidget.class)).length
                + m.getAppWidgetIds(new ComponentName(c, MediumWidget.class)).length > 0;
    }

    static void updateAll(Context c) {
        if (hasWidgets(c)) render(c, Trend.compute(c));
    }

    static void render(Context c, Trend.Result r) {
        AppWidgetManager m = AppWidgetManager.getInstance(c);
        for (int id : m.getAppWidgetIds(new ComponentName(c, SmallWidget.class))) m.updateAppWidget(id, small(c, r));
        for (int id : m.getAppWidgetIds(new ComponentName(c, MediumWidget.class))) m.updateAppWidget(id, medium(c, r));
    }

    private static int dot(int level) {
        return level == Trend.OVER ? R.drawable.dot_bad : level == Trend.NEAR ? R.drawable.dot_warn
                : level == Trend.CALM ? R.drawable.dot_ok : R.drawable.dot_neutral;
    }
    private static int color(Context c, int level) {
        return c.getColor(level == Trend.OVER ? R.color.w_bad : level == Trend.NEAR ? R.color.w_warn
                : level == Trend.CALM ? R.color.w_ok : R.color.w_muted);
    }
    private static PendingIntent openApp(Context c) {
        Intent i = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return PendingIntent.getActivity(c, 0, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private static RemoteViews small(Context c, Trend.Result r) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_small);
        v.setOnClickPendingIntent(R.id.root, openApp(c));
        v.setTextViewText(R.id.used, r.ready ? Plan.fmt(r.used) : "—");
        v.setTextViewText(R.id.goal, r.ready ? "/ " + Plan.fmt(r.goal) : "");
        v.setTextViewText(R.id.status, r.shortMsg);
        v.setTextColor(R.id.status, color(c, r.level));
        v.setImageViewResource(R.id.dot, dot(r.level));
        return v;
    }

    private static RemoteViews medium(Context c, Trend.Result r) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_medium);
        v.setOnClickPendingIntent(R.id.root, openApp(c));
        int[] bars = {R.id.bar_ok, R.id.bar_warn, R.id.bar_bad};
        v.setTextViewText(R.id.status, r.msg);
        v.setTextColor(R.id.status, color(c, r.level));
        v.setImageViewResource(R.id.dot, dot(r.level));
        if (!r.ready) {
            v.setTextViewText(R.id.used, "—");
            v.setTextViewText(R.id.goal, "");
            v.setTextViewText(R.id.left, "");
            v.setTextViewText(R.id.periods, "");
            return v;
        }
        v.setTextViewText(R.id.used, Plan.fmt(r.used));
        v.setTextViewText(R.id.goal, " de " + Plan.fmt(r.goal));
        String left = r.used > r.goal ? "+" + Plan.fmt(r.used - r.goal)
                : r.valid ? "previsão " + Plan.fmt(r.projected) : "restam " + Plan.fmt(r.goal - r.used);
        v.setTextViewText(R.id.left, left);
        v.setTextColor(R.id.left, color(c, r.level == Trend.NEUTRAL ? Trend.CALM : r.level));

        int pct = r.goal > 0 ? (int) Math.min(100, r.used * 100 / r.goal) : 0;
        int bar = r.level == Trend.OVER ? 2 : r.level == Trend.NEAR ? 1 : 0;
        for (int i = 0; i < 3; i++) {
            v.setViewVisibility(bars[i], i == bar ? View.VISIBLE : View.GONE);
            v.setProgressBar(bars[i], 100, pct, false);
        }

        SpannableStringBuilder p = new SpannableStringBuilder();
        for (int i = 0; i < 3; i++) {
            if (i > 0) p.append("    ");
            int from = p.length();
            p.append(ICONS[i]).append(" ").append(Plan.fmt(r.per[i]));
            if (i == r.idx) p.setSpan(new StyleSpan(Typeface.BOLD), from, p.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        }
        v.setTextViewText(R.id.periods, p);
        return v;
    }
}
