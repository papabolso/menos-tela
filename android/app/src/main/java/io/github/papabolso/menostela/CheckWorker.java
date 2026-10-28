package io.github.papabolso.menostela;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import java.time.ZonedDateTime;
import java.util.concurrent.TimeUnit;

/** Checagem periódica: atualiza widgets, registra a calibragem e decide se notifica. */
public class CheckWorker extends Worker {
    private static final String NAME = "menostela-check";

    public CheckWorker(@NonNull Context c, @NonNull WorkerParameters params) {
        super(c, params);
    }

    /** Agenda a checagem uma única vez (se já existe, mantém). */
    static void schedule(Context c) {
        PeriodicWorkRequest req = new PeriodicWorkRequest.Builder(CheckWorker.class, Tuning.CHECK_INTERVAL_MIN, TimeUnit.MINUTES).build();
        WorkManager.getInstance(c).enqueueUniquePeriodicWork(NAME, ExistingPeriodicWorkPolicy.KEEP, req);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context c = getApplicationContext();
        Trend.Result r = Trend.compute(c);
        WidgetUpdater.render(c, r);
        if (r.ready) {
            calibrate(c, r);
            Notifier.check(c, r);
        }
        return Result.success();
    }

    /** Registra a projeção na primeira checagem depois de cada horário fixo e fecha os dias anteriores. */
    private static void calibrate(Context c, Trend.Result r) {
        HistoryDb db = HistoryDb.get(c);
        db.fillActuals(r.date);
        if (!r.valid) return;
        int hour = ZonedDateTime.now().getHour();
        int[] slots = Tuning.CALIBRATION_HOURS;
        for (int i = 0; i < slots.length; i++) {
            int next = i + 1 < slots.length ? slots[i + 1] : 24;
            if (hour >= slots[i] && hour < next && !db.hasProjection(r.date, slots[i])) db.logProjection(r.date, slots[i], r);
        }
    }
}
