package io.github.papabolso.menostela;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

import java.time.LocalDate;
import java.time.LocalTime;

/**
 * Notifica só quando a projeção indica de fato que a meta vai estourar. Chamado apenas pela checagem
 * periódica, para que "checagens seguidas" signifique intervalos de ~15 min.
 */
final class Notifier {
    private static final String PREFS = "menostela_notify";
    private static final String CHANNEL = "trend";
    private static final int NOTIFICATION_ID = 1;

    private Notifier() {}

    static void check(Context c, Trend.Result r) {
        SharedPreferences sp = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String today = r.date.toString();
        if (!today.equals(sp.getString("date", ""))) {
            sp.edit().putString("date", today).putInt("hits", 0).putInt("count", 0).apply();
        }

        // 1) projeção acima do limite com folga e 3) uso já relevante (e a meta ainda não passou)
        boolean cond = r.valid
                && r.used < r.goal
                && r.projected > r.goal * Tuning.NOTIFY_PROJECTION_RATIO
                && r.used > r.goal * Tuning.NOTIFY_MIN_USED_SHARE;

        // 2) ritmo da última hora, estendido até a hora de dormir, também passa
        double lastHour = 0, rate = 0;
        if (cond) {
            long now = System.currentTimeMillis();
            long window = Tuning.LAST_HOUR_WINDOW_MIN * 60_000L;
            lastHour = Usage.between(c, now - window, now) / 60000.0;
            rate = lastHour / Tuning.LAST_HOUR_WINDOW_MIN;
            cond = r.used + rate * (r.endMin - r.nowMin) > r.goal;
        }

        // 4) persiste por checagens seguidas
        int hits = cond ? sp.getInt("hits", 0) + 1 : 0;
        sp.edit().putInt("hits", hits).apply();
        if (hits < Tuning.NOTIFY_CONSECUTIVE_CHECKS) return;

        // 5) intervalo mínimo e teto diário
        long last = sp.getLong("lastAt", 0);
        int count = sp.getInt("count", 0);
        if (count >= Tuning.NOTIFY_MAX_PER_DAY) return;
        if (System.currentTimeMillis() - last < Tuning.NOTIFY_COOLDOWN_MIN * 60_000L) return;

        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (!nm.areNotificationsEnabled()) return;

        int minutesToGoal = (int) Math.ceil((r.goal - r.used) / Math.max(rate, 0.01));
        String eta = LocalTime.now().plusMinutes(minutesToGoal).withSecond(0).withNano(0).toString();
        post(c, nm, "No ritmo atual você chega na meta de " + Plan.fmt(r.goal) + " por volta das " + eta.replace(":", "h") + ".",
                "Hoje: " + Plan.fmt(r.used) + " · previsão " + Plan.fmt(r.projected) + ".");

        sp.edit().putLong("lastAt", System.currentTimeMillis()).putInt("count", count + 1).apply();
        HistoryDb.get(c).logNotification(LocalDate.parse(today), r, lastHour, eta);
    }

    private static void post(Context c, NotificationManager nm, String title, String text) {
        nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Tendência do dia", NotificationManager.IMPORTANCE_DEFAULT));
        Intent open = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent pi = PendingIntent.getActivity(c, 1, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification n = new Notification.Builder(c, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat)
                .setContentTitle(title)
                .setContentText(text)
                .setStyle(new Notification.BigTextStyle().bigText(title + "\n" + text))
                .setContentIntent(pi)
                .setAutoCancel(true)
                .build();
        nm.notify(NOTIFICATION_ID, n);
    }
}
