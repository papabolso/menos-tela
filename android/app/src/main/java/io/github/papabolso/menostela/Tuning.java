package io.github.papabolso.menostela;

/** Limiares da projeção, das notificações e da calibragem. Ajuste aqui. */
final class Tuning {
    private Tuning() {}

    /* Histórico usado na curva média de uso acumulado */
    static final int HISTORY_MAX_DAYS = 14;
    static final int HISTORY_MIN_DAYS = 3;          // abaixo disso não afirma tendência
    static final double MIN_DAY_TOTAL_MIN = 5;      // dias com menos uso são ignorados (sem dados)

    /* Quando ainda é cedo para prever */
    static final double MIN_EXPECTED_SO_FAR_MIN = 30; // uso normal esperado até agora
    static final int MIN_AWAKE_MIN = 120;             // minutos desde a hora de acordar

    /* Ritmo de hoje (uso atual / esperado até agora), limitado a esta faixa */
    static final double PACE_MIN = 0.7;
    static final double PACE_MAX = 1.3;

    /* Faixas da mensagem (projeção / meta) */
    static final double CALM_BELOW = 0.85;
    static final double NEAR_UP_TO = 1.0;
    static final double NORMAL_TOLERANCE_MIN = 5;     // "no seu normal" se a diferença for menor

    /* Notificações: todas as condições precisam valer */
    static final double NOTIFY_PROJECTION_RATIO = 1.05;
    static final double NOTIFY_MIN_USED_SHARE = 0.30;
    static final int NOTIFY_CONSECUTIVE_CHECKS = 2;
    static final long NOTIFY_COOLDOWN_MIN = 90;
    static final int NOTIFY_MAX_PER_DAY = 2;
    static final long LAST_HOUR_WINDOW_MIN = 60;

    /* Checagem periódica (mínimo do WorkManager: 15 min) */
    static final long CHECK_INTERVAL_MIN = 15;

    /* Horários em que a projeção é registrada para medir o erro */
    static final int[] CALIBRATION_HOURS = {14, 18};

    /* Sequência de dias dentro da meta */
    static final double SHIELD_TOLERANCE = 1.15;      // escudo salva dias até 15% acima da meta
    static final int SHIELDS_PER_WEEK = 1;            // semana de segunda a domingo
    static final int[] STREAK_MILESTONES = {3, 7, 14, 30}; // depois de 30, a cada 30 dias
}
