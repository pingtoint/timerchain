/**
 * SQLite 数据层（expo-sqlite 异步 API）
 *
 * 设计要点：
 * 1. **Steps 独立成表**而不是塞进 Plan 的一个 JSON 字段。理由是列表页只需要
 *    聚合后的「3 步 · 约 12 分钟」，用 SQL 聚合可以避免把全部步骤读进内存再算，
 *    任务数量增长时首屏 IO 保持恒定。
 * 2. 列名用 `order_index` 而不是 `order` —— ORDER 是 SQL 保留字，裸用会直接语法报错。
 * 3. 连接是**懒加载单例**：首次访问才 open + migrate，之后复用同一个连接。
 *    expo-sqlite 的 `PRAGMA` 是连接级的，复用连接才能保证 `foreign_keys` 一直生效。
 * 4. 所有写入都走事务；读接口返回的已经是领域模型（Plan / PlanSummary），
 *    调用方不需要知道下划线命名的列。
 */

import * as SQLite from 'expo-sqlite';

import {
  ALERT_SOUNDS,
  type AlertSound,
  type NotificationSound,
  type Plan,
  type PlanSummary,
  type ReminderConfig,
  type RepeatMode,
  type SavePlanInput,
  type Step,
} from '../types';
import { calcNextFire } from '../utils/calcNextFire';
import { normalizePlanDraft } from '../utils/plan';
import { createId } from '../utils/id';

const DATABASE_NAME = 'timerchain.db';

/** 所有需要迁移的列（key = 列名，value = ALTER TABLE ADD COLUMN 的默认值片段）。 */
const MIGRATION_COLUMNS: Record<string, string> = {
  sort_order: 'INTEGER NOT NULL DEFAULT 0',
  notification_sound: "TEXT NOT NULL DEFAULT 'chime'",
  reminder_enabled: 'INTEGER NOT NULL DEFAULT 0',
  scheduled_for: 'INTEGER',
  time_of_day: 'INTEGER',
  repeat_mode: "TEXT NOT NULL DEFAULT 'once'",
  repeat_mask: 'TEXT',
};

/** steps 表的增量列（重复/计次）。 */
const STEP_MIGRATION_COLUMNS: Record<string, string> = {
  repeat_count: 'INTEGER NOT NULL DEFAULT 1',
  repeat_rest_sec: 'INTEGER NOT NULL DEFAULT 0',
  kind: "TEXT NOT NULL DEFAULT 'timed'",
};

/** plans 表的一行。列名是 snake_case，与领域模型之间靠下面的映射函数转换。 */
interface PlanRow {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  sort_order: number;
  notification_sound: string;
  reminder_enabled: number;
  scheduled_for: number | null;
  time_of_day: number | null;
  repeat_mode: string;
  repeat_mask: string | null;
}

interface StepRow {
  id: string;
  plan_id: string;
  order_index: number;
  title: string;
  content: string;
  kind: string;
  duration_sec: number;
  rest_after_sec: number;
  repeat_count: number;
  repeat_rest_sec: number;
  alert_sound: string;
  video_url: string | null;
}

interface PlanSummaryRow {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  sort_order: number;
  step_count: number;
  total_duration_sec: number;
  notification_sound: string;
  reminder_enabled: number;
  scheduled_for: number | null;
  time_of_day: number | null;
  repeat_mode: string;
  repeat_mask: string | null;
}

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS plans (
  id                 TEXT    PRIMARY KEY NOT NULL,
  title              TEXT    NOT NULL,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL,
  sort_order         INTEGER NOT NULL DEFAULT 0,
  notification_sound TEXT    NOT NULL DEFAULT 'chime',
  reminder_enabled   INTEGER NOT NULL DEFAULT 0,
  scheduled_for      INTEGER,
  time_of_day        INTEGER,
  repeat_mode        TEXT    NOT NULL DEFAULT 'once',
  repeat_mask        TEXT
);

CREATE TABLE IF NOT EXISTS steps (
  id             TEXT    PRIMARY KEY NOT NULL,
  plan_id        TEXT    NOT NULL,
  order_index    INTEGER NOT NULL,
  title          TEXT    NOT NULL,
  content        TEXT    NOT NULL DEFAULT '',
  kind           TEXT    NOT NULL DEFAULT 'timed',
  duration_sec   INTEGER NOT NULL,
  rest_after_sec INTEGER NOT NULL DEFAULT 0,
  repeat_count   INTEGER NOT NULL DEFAULT 1,
  repeat_rest_sec INTEGER NOT NULL DEFAULT 0,
  alert_sound    TEXT    NOT NULL DEFAULT 'chime',
  video_url      TEXT,
  FOREIGN KEY (plan_id) REFERENCES plans (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS steps_plan_order_idx ON steps (plan_id, order_index);
CREATE INDEX IF NOT EXISTS plans_reminder_idx ON plans (reminder_enabled, scheduled_for);
CREATE INDEX IF NOT EXISTS plans_sort_order_idx ON plans (sort_order);
`;

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

/**
 * 取得（并初始化）数据库连接。
 *
 * 用 Promise 单例而不是「先 await 一个 module-level 变量」：并发调用 loadPlans()
 * 时不会把建表和迁移跑两遍。
 */
export function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (databasePromise === null) {
    databasePromise = openAndMigrate();
  }
  return databasePromise;
}

async function openAndMigrate(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(DATABASE_NAME);
  await db.execAsync(SCHEMA);

  // 逐列迁移 — SQLite 不支持批量 ALTER TABLE，必须一条条 ADD COLUMN。
  // PRAGMA table_info 拿现有列清单，只给缺的补。单列失败不拖垮其它列。
  try {
    const cols = await db.getAllAsync<{ name: string }>('PRAGMA table_info(plans)');
    const existing = new Set(cols.map((c) => c.name));

    for (const [column, definition] of Object.entries(MIGRATION_COLUMNS)) {
      if (!existing.has(column)) {
        try {
          await db.execAsync(`ALTER TABLE plans ADD COLUMN ${column} ${definition}`);
        } catch {
          // 单列失败继续 —— 读取侧有 COALESCE 兜底，最坏该列功能降级
        }
      }
    }

    // steps 表增量列（重复次数/间隙），老行由 DEFAULT 自动补 1/0
    const stepCols = await db.getAllAsync<{ name: string }>('PRAGMA table_info(steps)');
    const stepExisting = new Set(stepCols.map((c) => c.name));
    for (const [column, definition] of Object.entries(STEP_MIGRATION_COLUMNS)) {
      if (!stepExisting.has(column)) {
        try {
          await db.execAsync(`ALTER TABLE steps ADD COLUMN ${column} ${definition}`);
        } catch {
          // 同上：读取侧有 ?? 1 / ?? 0 兜底
        }
      }
    }

    // 给首次出现 sort_order 的旧数据按 created_at 升序编号（只在刚才真的 ADD 了的时候）
    if (!existing.has('sort_order')) {
      await db.execAsync(`
        UPDATE plans SET sort_order = (
          SELECT COUNT(*) FROM plans p2
          WHERE p2.created_at < plans.created_at
             OR (p2.created_at = plans.created_at AND p2.id < plans.id)
        )
      `);
    }

    // 老库历史数据兜底：早期版本写入的行可能在新增列上是 NULL，
    // 直接映射成领域模型会炸 UI —— 统一回填默认值（幂等，每次启动都跑代价可忽略）。
    try {
      await db.execAsync(`
        UPDATE plans SET
          sort_order         = COALESCE(sort_order, 0),
          notification_sound = COALESCE(notification_sound, 'chime'),
          reminder_enabled   = COALESCE(reminder_enabled, 0),
          repeat_mode        = COALESCE(repeat_mode, 'once')
      `);
    } catch {
      // 列不存在时 UPDATE 会失败，读取侧 COALESCE 仍然兜得住
    }
  } catch {
    // 迁移失败不阻塞启动 — 最坏情况 reminder 字段全是默认值，提醒功能暂时不可用
  }

  return db;
}

/** 数据库层 → ReminderConfig。enabled=0 时整组 rem 字段返回 null，UI 层省事。 */
function toReminderConfig(row: Pick<
  PlanRow,
  | 'notification_sound'
  | 'reminder_enabled'
  | 'scheduled_for'
  | 'time_of_day'
  | 'repeat_mode'
  | 'repeat_mask'
>): ReminderConfig | null {
  if (!row.reminder_enabled) return null;

  // repeatMode 收窄合法性
  const mode = row.repeat_mode as RepeatMode;
  const validMode: RepeatMode = ['once', 'daily', 'weekly', 'monthly'].includes(mode)
    ? mode
    : 'once';

  return {
    enabled: true,
    repeatMode: validMode,
    targetDate: validMode === 'once' && row.scheduled_for !== null ? new Date(row.scheduled_for) : undefined,
    timeOfDaySec: row.time_of_day ?? undefined,
    weeklyMask: validMode === 'weekly' ? row.repeat_mask ?? undefined : undefined,
    monthlyMask: validMode === 'monthly' ? row.repeat_mask ?? undefined : undefined,
    scheduledFor: row.scheduled_for,
    notificationSound: (row.notification_sound as NotificationSound) ?? 'chime',
  };
}

function toAlertSound(value: string): AlertSound {
  const matched = ALERT_SOUNDS.find((sound) => sound === value);
  return matched ?? 'chime';
}

function toStep(row: StepRow): Step {
  return {
    id: row.id,
    order: row.order_index,
    title: row.title,
    content: row.content,
    kind: row.kind === 'count' ? 'count' : 'timed',
    durationSec: row.duration_sec,
    restAfterSec: row.rest_after_sec,
    repeatCount: row.repeat_count ?? 1,
    repeatRestSec: row.repeat_rest_sec ?? 0,
    alertSound: toAlertSound(row.alert_sound),
    videoUrl: row.video_url,
  };
}

/**
 * 从 SavePlanInput.reminder 提取要写入 DB 的 6 个字段。
 * 同时调 calcNextFire 算出 scheduled_for（下次触发时间戳）。
 */
function reminderToRow(reminder: SavePlanInput['reminder'] | null | undefined) {
  if (reminder === null || reminder === undefined || !reminder.enabled) {
    return {
      notificationSound: 'chime' as NotificationSound,
      reminderEnabled: 0,
      scheduledFor: null as number | null,
      timeOfDay: null as number | null,
      repeatMode: 'once' as RepeatMode,
      repeatMask: null as string | null,
    };
  }

  // 补默认值
  const normalized: ReminderConfig = {
    ...reminder,
    enabled: true,
    repeatMode: reminder.repeatMode ?? 'once',
    timeOfDaySec: reminder.timeOfDaySec ?? 0,
    notificationSound: reminder.notificationSound ?? 'chime',
  };

  const { fireAtMs } = calcNextFire(normalized);

  return {
    notificationSound: (normalized.notificationSound ?? 'chime') as NotificationSound,
    reminderEnabled: 1,
    scheduledFor: fireAtMs ?? null,
    timeOfDay: normalized.timeOfDaySec ?? null,
    repeatMode: normalized.repeatMode ?? 'once',
    repeatMask:
      normalized.repeatMode === 'weekly'
        ? normalized.weeklyMask ?? null
        : normalized.repeatMode === 'monthly'
          ? normalized.monthlyMask ?? null
          : null,
  };
}

/**
 * 列表页数据源。
 *
 * 一次查询同时拿到「步骤数」「总时长」和「提醒配置」，避免 N+1。
 */
export async function listPlanSummaries(): Promise<PlanSummary[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<PlanSummaryRow>(
    `SELECT p.id                 AS id,
            p.title              AS title,
            p.created_at         AS created_at,
            p.updated_at         AS updated_at,
            COALESCE(p.sort_order, 0)           AS sort_order,
            COALESCE(p.notification_sound, 'chime') AS notification_sound,
            COALESCE(p.reminder_enabled, 0)     AS reminder_enabled,
            p.scheduled_for      AS scheduled_for,
            p.time_of_day        AS time_of_day,
            COALESCE(p.repeat_mode, 'once')     AS repeat_mode,
            p.repeat_mask        AS repeat_mask,
            COUNT(s.id)                                                  AS step_count,
            COALESCE(SUM(s.duration_sec * COALESCE(s.repeat_count, 1)
                       + s.repeat_rest_sec * (COALESCE(s.repeat_count, 1) - 1)
                       + s.rest_after_sec), 0)                           AS total_duration_sec
       FROM plans AS p
       LEFT JOIN steps AS s ON s.plan_id = p.id
      GROUP BY p.id
      ORDER BY p.sort_order ASC, p.updated_at DESC`,
  );

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    stepCount: row.step_count,
    totalDurationSec: row.total_duration_sec,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sortOrder: row.sort_order,
    reminder: toReminderConfig(row),
  }));
}

/** 读取单个任务链（含全部步骤）。找不到时返回 null，由调用方决定怎么提示。 */
export async function getPlanById(id: string): Promise<Plan | null> {
  const db = await getDatabase();

  const plan = await db.getFirstAsync<PlanRow>(
    `SELECT id, title, created_at, updated_at,
            COALESCE(sort_order, 0)               AS sort_order,
            COALESCE(notification_sound, 'chime') AS notification_sound,
            COALESCE(reminder_enabled, 0)         AS reminder_enabled,
            scheduled_for, time_of_day,
            COALESCE(repeat_mode, 'once')         AS repeat_mode,
            repeat_mask
       FROM plans WHERE id = ?`,
    [id],
  );

  if (plan === null) {
    return null;
  }

  const stepRows = await db.getAllAsync<StepRow>(
    `SELECT id, plan_id, order_index, title, content,
            COALESCE(kind, 'timed')      AS kind,
            duration_sec, rest_after_sec,
            COALESCE(repeat_count, 1)    AS repeat_count,
            COALESCE(repeat_rest_sec, 0) AS repeat_rest_sec,
            alert_sound, video_url
       FROM steps
      WHERE plan_id = ?
      ORDER BY order_index ASC`,
    [id],
  );

  return {
    id: plan.id,
    title: plan.title,
    steps: stepRows.map(toStep),
    createdAt: plan.created_at,
    updatedAt: plan.updated_at,
    sortOrder: plan.sort_order,
    reminder: toReminderConfig(plan),
  };
}

/**
 * 新建或整体覆盖一个任务链。
 *
 * 步骤采用「先删后插」而不是逐行 diff：一条任务链最多几十步，整体重写的
 * 代价可以忽略，但换来的是绝对不会出现 order_index 错位或残留孤儿行。
 */
export async function savePlan(input: SavePlanInput): Promise<Plan> {
  const db = await getDatabase();
  const draft = normalizePlanDraft(input);
  const now = Date.now();
  const planId = draft.id ?? createId('plan');
  const remRow = reminderToRow(draft.reminder ?? null);

  await db.withExclusiveTransactionAsync(async (txn) => {
    const existing = await txn.getFirstAsync<{ created_at: number; sort_order: number }>(
      'SELECT created_at, sort_order FROM plans WHERE id = ?',
      [planId],
    );
    const createdAt = existing?.created_at ?? now;
    // 新建时 sort_order 放末尾；编辑时保持原值
    const sortOrder = existing?.sort_order ?? (
      (await txn.getFirstAsync<{ m: number }>(
        'SELECT COALESCE(MAX(sort_order) + 1, 0) AS m FROM plans',
      ))?.m ?? 0
    );

    await txn.runAsync(
      `INSERT INTO plans
           (id, title, created_at, updated_at, sort_order,
            notification_sound, reminder_enabled, scheduled_for,
            time_of_day, repeat_mode, repeat_mask)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title,
         updated_at = excluded.updated_at,
         notification_sound = excluded.notification_sound,
         reminder_enabled = excluded.reminder_enabled,
         scheduled_for = excluded.scheduled_for,
         time_of_day = excluded.time_of_day,
         repeat_mode = excluded.repeat_mode,
         repeat_mask = excluded.repeat_mask`,
      [
        planId,
        draft.title,
        createdAt,
        now,
        sortOrder,
        remRow.notificationSound,
        remRow.reminderEnabled,
        remRow.scheduledFor,
        remRow.timeOfDay,
        remRow.repeatMode,
        remRow.repeatMask,
      ],
    );

    await txn.runAsync('DELETE FROM steps WHERE plan_id = ?', [planId]);

    for (const step of draft.steps) {
      await txn.runAsync(
        `INSERT INTO steps
           (id, plan_id, order_index, title, content, kind, duration_sec, rest_after_sec, repeat_count, repeat_rest_sec, alert_sound, video_url)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          step.id,
          planId,
          step.order,
          step.title,
          step.content,
          step.kind,
          step.durationSec,
          step.restAfterSec,
          step.repeatCount,
          step.repeatRestSec,
          step.alertSound,
          step.videoUrl,
        ],
      );
    }
  });

  const persisted = await getPlanById(planId);
  if (persisted === null) {
    throw new Error('保存失败：写入后无法读回该任务链');
  }
  return persisted;
}

/** 删除任务链及其全部步骤。 */
export async function deletePlan(id: string): Promise<void> {
  const db = await getDatabase();
  await db.withExclusiveTransactionAsync(async (txn) => {
    // 不依赖 ON DELETE CASCADE：显式删除，行为只由这段代码决定
    await txn.runAsync('DELETE FROM steps WHERE plan_id = ?', [id]);
    await txn.runAsync('DELETE FROM plans WHERE id = ?', [id]);
  });
}

/** 批量删除任务链及其步骤（单事务 + IN 查询，清空全部也走这里）。 */
export async function deletePlans(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  const db = await getDatabase();
  const placeholders = ids.map(() => '?').join(', ');
  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.runAsync(`DELETE FROM steps WHERE plan_id IN (${placeholders})`, [...ids]);
    await txn.runAsync(`DELETE FROM plans WHERE id IN (${placeholders})`, [...ids]);
  });
}

/**
 * 按给定顺序重排任务链列表。
 * ids 必须是当前库中全部 plan 的完整集合（顺序即新 sort_order，从 0 开始）。
 * 单事务 + 单条 CASE WHEN SQL：比 N 次 UPDATE 快一个数量级。
 */
export async function reorderPlans(orderedIds: readonly string[]): Promise<void> {
  if (orderedIds.length === 0) return;
  const db = await getDatabase();
  const whenClauses = orderedIds.map((id, i) => `WHEN ? THEN ${i}`).join(' ');
  const sql = `UPDATE plans SET sort_order = CASE id ${whenClauses} END WHERE id IN (${orderedIds.map(() => '?').join(', ')})`;
  await db.runAsync(sql, [...orderedIds, ...orderedIds]);
}

/**
 * 列出所有 enabled=1 且 scheduled_for IS NOT NULL 的任务。
 *
 * 通知 service 不需要 step_count / total_duration_sec，所以不走 listPlanSummaries 的
 * GROUP BY + LEFT JOIN steps —— 避免每次 refreshAll 都全表聚合。
 */
export async function listReminderPlans(): Promise<PlanSummary[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<PlanSummaryRow>(
    `SELECT p.id                 AS id,
            p.title              AS title,
            p.created_at         AS created_at,
            p.updated_at         AS updated_at,
            COALESCE(p.sort_order, 0) AS sort_order,
            COALESCE(p.notification_sound, 'chime') AS notification_sound,
            COALESCE(p.reminder_enabled, 0)         AS reminder_enabled,
            p.scheduled_for      AS scheduled_for,
            p.time_of_day        AS time_of_day,
            COALESCE(p.repeat_mode, 'once')         AS repeat_mode,
            p.repeat_mask        AS repeat_mask,
            0 AS step_count,
            0 AS total_duration_sec
       FROM plans AS p
      WHERE p.reminder_enabled = 1 AND p.scheduled_for IS NOT NULL
      ORDER BY p.scheduled_for ASC`,
  );

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    stepCount: row.step_count,
    totalDurationSec: row.total_duration_sec,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sortOrder: row.sort_order,
    reminder: toReminderConfig(row),
  }));
}
