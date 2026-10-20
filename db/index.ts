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
  type Plan,
  type PlanSummary,
  type SavePlanInput,
  type Step,
} from '../types';
import { normalizePlanDraft } from '../utils/plan';
import { createId } from '../utils/id';

const DATABASE_NAME = 'timerchain.db';

/** plans 表的一行。列名是 snake_case，与领域模型之间靠下面的映射函数转换。 */
interface PlanRow {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
}

interface StepRow {
  id: string;
  plan_id: string;
  order_index: number;
  title: string;
  content: string;
  duration_sec: number;
  rest_after_sec: number;
  alert_sound: string;
  video_url: string | null;
}

interface PlanSummaryRow {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  step_count: number;
  total_duration_sec: number;
}

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS plans (
  id         TEXT    PRIMARY KEY NOT NULL,
  title      TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS steps (
  id             TEXT    PRIMARY KEY NOT NULL,
  plan_id        TEXT    NOT NULL,
  order_index    INTEGER NOT NULL,
  title          TEXT    NOT NULL,
  content        TEXT    NOT NULL DEFAULT '',
  duration_sec   INTEGER NOT NULL,
  rest_after_sec INTEGER NOT NULL DEFAULT 0,
  alert_sound    TEXT    NOT NULL DEFAULT 'chime',
  video_url      TEXT,
  FOREIGN KEY (plan_id) REFERENCES plans (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS steps_plan_order_idx ON steps (plan_id, order_index);
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
  return db;
}

/**
 * 把库里读出的音效字符串收窄成 `AlertSound`。
 * 数据是上一个版本写进去的，不能假定它一定合法，因此这里做一次真实校验
 * 而不是 `as AlertSound` 强转。
 */
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
    durationSec: row.duration_sec,
    restAfterSec: row.rest_after_sec,
    alertSound: toAlertSound(row.alert_sound),
    videoUrl: row.video_url,
  };
}

/**
 * 列表页数据源。
 *
 * 一次查询同时拿到「步骤数」与「总时长」，避免 N+1。
 * 总时长计入停歇，因为它才是真实占用的墙钟时间。
 */
export async function listPlanSummaries(): Promise<PlanSummary[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<PlanSummaryRow>(
    `SELECT p.id            AS id,
            p.title         AS title,
            p.created_at    AS created_at,
            p.updated_at    AS updated_at,
            COUNT(s.id)                                                  AS step_count,
            COALESCE(SUM(s.duration_sec + s.rest_after_sec), 0)          AS total_duration_sec
       FROM plans AS p
       LEFT JOIN steps AS s ON s.plan_id = p.id
      GROUP BY p.id
      ORDER BY p.updated_at DESC`,
  );

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    stepCount: row.step_count,
    totalDurationSec: row.total_duration_sec,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

/** 读取单个任务链（含全部步骤）。找不到时返回 null，由调用方决定怎么提示。 */
export async function getPlanById(id: string): Promise<Plan | null> {
  const db = await getDatabase();

  const plan = await db.getFirstAsync<PlanRow>(
    'SELECT id, title, created_at, updated_at FROM plans WHERE id = ?',
    [id],
  );

  if (plan === null) {
    return null;
  }

  const stepRows = await db.getAllAsync<StepRow>(
    `SELECT id, plan_id, order_index, title, content, duration_sec, rest_after_sec, alert_sound, video_url
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

  await db.withExclusiveTransactionAsync(async (txn) => {
    const existing = await txn.getFirstAsync<{ created_at: number }>(
      'SELECT created_at FROM plans WHERE id = ?',
      [planId],
    );
    // 编辑已有任务链时必须保留原始创建时间，否则列表排序会突然把它顶到最前。
    const createdAt = existing?.created_at ?? now;

    await txn.runAsync(
      `INSERT INTO plans (id, title, created_at, updated_at)
            VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET title = excluded.title, updated_at = excluded.updated_at`,
      [planId, draft.title, createdAt, now],
    );

    await txn.runAsync('DELETE FROM steps WHERE plan_id = ?', [planId]);

    for (const step of draft.steps) {
      await txn.runAsync(
        `INSERT INTO steps
           (id, plan_id, order_index, title, content, duration_sec, rest_after_sec, alert_sound, video_url)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          step.id,
          planId,
          step.order,
          step.title,
          step.content,
          step.durationSec,
          step.restAfterSec,
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
