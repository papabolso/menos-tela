package io.github.papabolso.menostela;

import android.app.AlarmManager;
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

import org.json.JSONObject;

import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.temporal.ChronoUnit;

/**
 * Monta os widgets. O plano (meta do dia, divisão por período) é o mesmo do app.js, recalculado
 * aqui a partir das configurações que o app salva, para o widget funcionar com o app fechado.
 */
final class WidgetUpdater {
    static final String ACTION_REFRESH = "io.github.papabolso.menostela.REFRESH";
    private static final String PREFS = "menostela";
    private static final String KEY_SETTINGS = "settings";

    private static final String[] ICONS = {"☀️", "🌤️", "🌙"};
    private static final String[] PREPS = {"de manhã", "à tarde", "à noite"};
    private static final double[] WEIGHTS = {0.9, 1.0, 0.8};
    private static final int MAX_FIRST_CUT = 120;

    private WidgetUpdater() {}

    static void saveSettings(Context c, String json) {
        c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY_SETTINGS, json).apply();
        updateAll(c);
    }

    static void updateAll(Context c) {
        AppWidgetManager m = AppWidgetManager.getInstance(c);
        int[] small = m.getAppWidgetIds(new ComponentName(c, SmallWidget.class));
        int[] medium = m.getAppWidgetIds(new ComponentName(c, MediumWidget.class));
        if (small.length + medium.length == 0) return;

        Status s = compute(c);
        for (int id : small) m.updateAppWidget(id, small(c, s));
        for (int id : medium) m.updateAppWidget(id, medium(c, s));
        schedule(c);
    }

    /** Atualização a cada ~15 min com o celular acordado (não acorda o aparelho). */
    private static void schedule(Context c) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        Intent i = new Intent(c, SmallWidget.class).setAction(ACTION_REFRESH);
        PendingIntent pi = PendingIntent.getBroadcast(c, 0, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        am.setInexactRepeating(AlarmManager.RTC, System.currentTimeMillis() + AlarmManager.INTERVAL_FIFTEEN_MINUTES,
                AlarmManager.INTERVAL_FIFTEEN_MINUTES, pi);
    }

    /* ---------- Cálculo ---------- */

    static final class Status {
        boolean ready;
        long used, goal;
        long[] per = new long[3];
        int idx;
        int level; // 0 tranquilo, 1 reduzir, 2 estourou
        String shortMsg = "Abra o app", msg = "Abra o app para configurar.";
    }

    private static Status compute(Context c) {
        Status s = new Status();
        String json = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_SETTINGS, null);
        if (json == null) return s;
        if (!Usage.hasPermission(c)) {
            s.msg = "Libere o acesso ao uso no app.";
            return s;
        }
        try {
            JSONObject o = new JSONObject(json);
            int baseline = o.getInt("baseline"), target = o.getInt("target"), step = o.getInt("step");
            int w = toMin(o.getString("wake")), slRaw = toMin(o.getString("sleep"));
            LocalDate start = LocalDate.parse(o.getString("startDate"));

            int sl = slRaw <= w ? slRaw + 1440 : slRaw;
            int[][] b = {{w, Math.max(w + 60, 720)}, {Math.max(720, w), 1080}, {1080, Math.max(1140, sl)}};
            int cut = (int) (Math.round(slRaw + ((w - slRaw + 1440) % 1440) / 2.0) % 1440);

            ZoneId z = ZoneId.systemDefault();
            ZonedDateTime now = ZonedDateTime.now(z);
            int t = now.getHour() * 60 + now.getMinute();
            LocalDate date = now.toLocalDate();
            if (cut < 720 && t < cut) date = date.minusDays(1);
            int rt = rel(t, cut);
            s.idx = rt < rel(720, cut) ? 0 : rt < rel(1080, cut) ? 1 : 2;

            long[][] r = {
                    {ms(date, cut < 720 ? cut : 0, z), ms(date, 720, z)},
                    {ms(date, 720, z), ms(date, 1080, z)},
                    {ms(date, 1080, z), ms(date.plusDays(1), cut, z)},
            };
            long nowMs = System.currentTimeMillis();
            for (int i = 0; i < 3; i++) {
                s.per[i] = r[i][0] < nowMs ? Usage.between(c, r[i][0], Math.min(r[i][1], nowMs)) / 60000 : 0;
                s.used += s.per[i];
            }

            long days = Math.max(0, ChronoUnit.DAYS.between(start, date));
            s.goal = Math.max(target, round5(startGoal(baseline, target) - (double) step * days));

            double[] base = new double[3];
            double total = 0;
            for (int i = 0; i < 3; i++) total += Math.max(60, b[i][1] - b[i][0]) * WEIGHTS[i];
            for (int i = 0; i < 3; i++) base[i] = s.goal * Math.max(60, b[i][1] - b[i][0]) * WEIGHTS[i] / total;

            long pastUsed = 0;
            for (int i = 0; i < s.idx; i++) pastUsed += s.per[i];
            double futBase = 0;
            for (int i = s.idx; i < 3; i++) futBase += base[i];
            double adjCur = Math.max(0, s.goal - pastUsed) * base[s.idx] / futBase;
            long cur = s.per[s.idx];

            if (s.used > s.goal) {
                s.level = 2;
                s.shortMsg = "Meta estourada";
                s.msg = "Meta do dia estourada. Hora de largar o celular.";
            } else if (cur > base[s.idx] && cur >= 10) {
                s.level = 1;
                s.shortMsg = "Dá uma reduzida";
                s.msg = "Muito uso " + PREPS[s.idx] + ". Melhor dar uma reduzida.";
            } else if (adjCur > 0 && cur >= adjCur * 0.8 && cur >= 10) {
                s.level = 1;
                s.shortMsg = "Vai com calma";
                s.msg = "Perto do limite " + PREPS[s.idx] + ": restam " + fmt(Math.round(adjCur - cur)) + ".";
            } else {
                s.level = 0;
                s.shortMsg = "Tranquilo";
                s.msg = "Tranquilo, dentro do plano.";
            }
            s.ready = true;
        } catch (Exception e) {
            s.msg = "Abra o app para atualizar.";
        }
        return s;
    }

    private static long startGoal(int baseline, int target) {
        int gap = baseline - target;
        if (gap <= 0) return target;
        return round5(baseline - Math.min(gap / 2.0, MAX_FIRST_CUT));
    }

    private static long round5(double x) { return Math.round(x / 5.0) * 5; }
    private static int rel(int x, int cut) { return ((x - cut) % 1440 + 1440) % 1440; }
    private static int toMin(String hhmm) {
        String[] p = hhmm.split(":");
        return Integer.parseInt(p[0]) * 60 + Integer.parseInt(p[1]);
    }
    private static long ms(LocalDate d, int min, ZoneId z) {
        return d.atStartOfDay(z).plusMinutes(min).toInstant().toEpochMilli();
    }
    static String fmt(long min) {
        min = Math.max(0, min);
        long h = min / 60, m = min % 60;
        if (h == 0) return m + "min";
        return m == 0 ? h + "h" : String.format("%dh%02d", h, m);
    }

    /* ---------- Layouts ---------- */

    private static int dot(int level) {
        return level == 2 ? R.drawable.dot_bad : level == 1 ? R.drawable.dot_warn : R.drawable.dot_ok;
    }
    private static int color(Context c, int level) {
        return c.getColor(level == 2 ? R.color.w_bad : level == 1 ? R.color.w_warn : R.color.w_ok);
    }
    private static PendingIntent openApp(Context c) {
        Intent i = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return PendingIntent.getActivity(c, 0, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private static RemoteViews small(Context c, Status s) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_small);
        v.setOnClickPendingIntent(R.id.root, openApp(c));
        if (!s.ready) {
            v.setTextViewText(R.id.used, "—");
            v.setTextViewText(R.id.goal, "");
            v.setTextViewText(R.id.status, s.msg);
            v.setImageViewResource(R.id.dot, R.drawable.dot_warn);
            return v;
        }
        v.setTextViewText(R.id.used, fmt(s.used));
        v.setTextViewText(R.id.goal, "/ " + fmt(s.goal));
        v.setTextViewText(R.id.status, s.shortMsg);
        v.setTextColor(R.id.status, color(c, s.level));
        v.setImageViewResource(R.id.dot, dot(s.level));
        return v;
    }

    private static RemoteViews medium(Context c, Status s) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_medium);
        v.setOnClickPendingIntent(R.id.root, openApp(c));
        int[] bars = {R.id.bar_ok, R.id.bar_warn, R.id.bar_bad};
        if (!s.ready) {
            v.setTextViewText(R.id.used, "—");
            v.setTextViewText(R.id.goal, "");
            v.setTextViewText(R.id.left, "");
            v.setTextViewText(R.id.periods, "");
            v.setTextViewText(R.id.status, s.msg);
            v.setImageViewResource(R.id.dot, R.drawable.dot_warn);
            return v;
        }
        v.setTextViewText(R.id.used, fmt(s.used));
        v.setTextViewText(R.id.goal, " de " + fmt(s.goal));
        v.setTextViewText(R.id.left, s.used > s.goal ? "+" + fmt(s.used - s.goal) : "restam " + fmt(s.goal - s.used));
        v.setTextColor(R.id.left, color(c, s.level));

        int pct = s.goal > 0 ? (int) Math.min(100, s.used * 100 / s.goal) : 0;
        for (int i = 0; i < 3; i++) {
            v.setViewVisibility(bars[i], i == s.level ? View.VISIBLE : View.GONE);
            v.setProgressBar(bars[i], 100, pct, false);
        }

        SpannableStringBuilder p = new SpannableStringBuilder();
        for (int i = 0; i < 3; i++) {
            if (i > 0) p.append("    ");
            int from = p.length();
            p.append(ICONS[i]).append(" ").append(fmt(s.per[i]));
            if (i == s.idx) p.setSpan(new StyleSpan(Typeface.BOLD), from, p.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        }
        v.setTextViewText(R.id.periods, p);

        v.setTextViewText(R.id.status, s.msg);
        v.setTextColor(R.id.status, color(c, s.level));
        v.setImageViewResource(R.id.dot, dot(s.level));
        return v;
    }
}
