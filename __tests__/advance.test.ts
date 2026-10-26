/**
 * 任务链状态机单元测试（独立版）。
 *
 * advance() 是纯函数，逻辑直接复制自 store/planStore.ts，
 * 不依赖任何 RN / zustand / SQLite 模块，可以直接用 tsx 跑。
 *
 * 覆盖：正常推进、后台追帧、计次步骤、repeatRest、边界条件。
 */

// ── 直接复制 advance 相关类型和逻辑 ────────────────────

type RunPhase = 'step' | 'rest' | 'repeatRest' | 'finished';

interface Step {
  kind: 'timed' | 'count';
  durationSec: number;
  restAfterSec: number;
  repeatCount: number;
  repeatRestSec: number;
}

interface Plan {
  steps: Step[];
}

interface PhaseTransition {
  kind: 'step' | 'rest' | 'repeatRest' | 'finished';
  index: number;
  repeat: number;
}

interface AdvanceResult {
  index: number;
  repeatIndex: number;
  phase: RunPhase;
  deadline: number;
  finished: boolean;
  transitions: PhaseTransition[];
}

const MAX_PHASE_STEPS = 512;

function advance(
  plan: Plan,
  index: number,
  repeatIndex: number,
  phase: RunPhase,
  deadline: number,
  now: number,
): AdvanceResult {
  const lastIndex = plan.steps.length - 1;
  const transitions: PhaseTransition[] = [];

  let cursorIndex = index;
  let cursorRepeat = repeatIndex;
  let cursorPhase = phase;
  let cursorDeadline = deadline;

  const anchor = (d: number) => (d === Number.POSITIVE_INFINITY ? now : d);
  const stepPhaseDeadline = (base: number, step?: Step) =>
    step?.kind === 'count'
      ? Number.POSITIVE_INFINITY
      : anchor(base) + (step?.durationSec ?? 0) * 1000;

  let guard = 0;
  while (now >= cursorDeadline) {
    guard += 1;
    if (guard > MAX_PHASE_STEPS) break;

    const current = plan.steps[cursorIndex];

    if (cursorPhase === 'step' && current !== undefined) {
      if (cursorRepeat < current.repeatCount - 1) {
        if (current.repeatRestSec > 0) {
          cursorPhase = 'repeatRest';
          cursorDeadline = anchor(cursorDeadline) + current.repeatRestSec * 1000;
          transitions.push({ kind: 'repeatRest', index: cursorIndex, repeat: cursorRepeat });
          continue;
        }
        cursorRepeat += 1;
        cursorDeadline = stepPhaseDeadline(cursorDeadline, current);
        transitions.push({ kind: 'step', index: cursorIndex, repeat: cursorRepeat });
        continue;
      }
      if (current.restAfterSec > 0) {
        cursorPhase = 'rest';
        cursorDeadline = anchor(cursorDeadline) + current.restAfterSec * 1000;
        transitions.push({ kind: 'rest', index: cursorIndex, repeat: cursorRepeat });
        continue;
      }
    }

    if (cursorPhase === 'repeatRest' && current !== undefined) {
      cursorRepeat += 1;
      cursorPhase = 'step';
      cursorDeadline = stepPhaseDeadline(cursorDeadline, current);
      transitions.push({ kind: 'step', index: cursorIndex, repeat: cursorRepeat });
      continue;
    }

    if (cursorIndex >= lastIndex) {
      transitions.push({ kind: 'finished', index: cursorIndex, repeat: cursorRepeat });
      return {
        index: lastIndex,
        repeatIndex: 0,
        phase: 'step',
        deadline: Number.POSITIVE_INFINITY,
        finished: true,
        transitions,
      };
    }

    cursorIndex += 1;
    cursorRepeat = 0;
    cursorPhase = 'step';
    cursorDeadline = stepPhaseDeadline(cursorDeadline, plan.steps[cursorIndex]);
    transitions.push({ kind: 'step', index: cursorIndex, repeat: 0 });
  }

  return {
    index: cursorIndex,
    repeatIndex: cursorRepeat,
    phase: cursorPhase,
    deadline: cursorDeadline,
    finished: false,
    transitions,
  };
}

// ── 测试基建 ────────────────────────────────────────────

let passed = 0;
let failed = 0;

interface StepInput extends Partial<Step> {
  durationSec?: number; // 让 durationSec 可选（count 步骤不需要）
}

function step(overrides: StepInput): Step {
  return {
    kind: 'timed',
    durationSec: 30,
    restAfterSec: 0,
    repeatCount: 1,
    repeatRestSec: 0,
    ...overrides,
  } as Step;
}

function plan(steps: Step[]): Plan {
  return { steps };
}

function assert<T>(actual: T, expected: T, msg: string): void {
  const ok = actual === expected;
  if (!ok) {
    console.error(`  ✗ ${msg}\n      expected: ${JSON.stringify(expected)}\n      actual:   ${JSON.stringify(actual)}`);
    failed += 1;
  } else {
    console.log(`  ✓ ${msg}`);
    passed += 1;
  }
}

function assertTrue(cond: unknown, msg: string): void {
  if (!cond) {
    console.error(`  ✗ ${msg}`);
    failed += 1;
  } else {
    console.log(`  ✓ ${msg}`);
    passed += 1;
  }
}

// ── 用例 ────────────────────────────────────────────────

console.log('\n═══════════════════════════════════════');
console.log('  TimerChain 状态机单元测试');
console.log('═══════════════════════════════════════\n');

// ① 单步骤 30 秒正常走完
console.log('① 单步骤 30s 正常走完');
{
  const p = plan([step({ durationSec: 30 })]);
  const now = 1000;
  const r = advance(p, 0, 0, 'step', now + 30_000, now + 31_000);
  assert(r.finished, true, 'finished');
  assert(r.phase, 'step', 'phase 回到 step');
  assert(r.repeatIndex, 0, 'repeatIndex 归零');
}

// ② 两步链 + 停歇
console.log('\n② 两步链 30s → rest 10s → 20s');
{
  const p = plan([
    step({ durationSec: 30, restAfterSec: 10 }),
    step({ durationSec: 20 }),
  ]);
  const now = 1000;

  let r = advance(p, 0, 0, 'step', now + 30_000, now + 29_000);
  assert(r.finished, false, '29s 时未完成');

  r = advance(p, 0, 0, 'step', now + 30_000, now + 30_001);
  assert(r.phase, 'rest', '30s 刚过 → rest');
  // rest 从上一阶段的 deadline（now+30_000）起算，不是追帧时刻
  assert(r.deadline, now + 40_000, 'rest deadline = plan_deadline + 10s');

  r = advance(p, 0, 0, 'rest', now + 40_000, now + 40_002);
  assert(r.index, 1, 'rest 结束 → index=1');
  assert(r.phase, 'step', '→ step');
  // 第二步从 rest deadline（now+40_000）起算
  assert(r.deadline, now + 60_000, '第二步 deadline = rest_deadline + 20s');
}

// ③ 后台追帧：一次跨过多个阶段
console.log('\n③ 后台追帧：锁屏 5 分钟一次跨过 3 步');
{
  const p = plan([
    step({ durationSec: 10 }),
    step({ durationSec: 10 }),
    step({ durationSec: 10 }),
  ]);
  const now = 1000;
  const r = advance(p, 0, 0, 'step', now + 10_000, now + 300_000);
  assert(r.finished, true, '5 分钟后应全部完成');
  // 初始在 step(0) → step(1) → step(2) → finished = 3 个 transition
  assertTrue(r.transitions.length === 3, `恰好 3 个 transition（实际 ${r.transitions.length}）`);
}

// ④ 计次步骤 3 遍 + 间隙 5s
console.log('\n④ 计次 3 遍 + 间隙 5s');
{
  const p = plan([step({ kind: 'count', durationSec: 0, repeatCount: 3, repeatRestSec: 5 })]);
  const now = 1000;

  let r = advance(p, 0, 0, 'step', now, now);
  assert(r.phase, 'repeatRest', '第 1 遍结束 → 间隙');
  assert(r.repeatIndex, 0, 'repeatIndex 保持 0');
  assert(r.deadline, now + 5_000, '间隙 deadline = now + 5s');

  r = advance(p, 0, 0, 'repeatRest', now + 5_000, now + 5_001);
  assert(r.phase, 'step', '间隙结束 → step');
  assert(r.repeatIndex, 1, 'repeatIndex = 1');

  r = advance(p, 0, 1, 'step', now + 5_001, now + 5_001);
  assert(r.phase, 'repeatRest', '第 2 遍结束 → 间隙');

  r = advance(p, 0, 1, 'repeatRest', now + 10_001, now + 10_002);
  assert(r.phase, 'step', '→ step');
  assert(r.repeatIndex, 2, 'repeatIndex = 2（第 3 遍）');

  r = advance(p, 0, 2, 'step', now + 10_002, now + 10_002);
  assert(r.finished, true, '最后一遍 → finished');
}

// ⑤ 计次无间隙 + 最后一遍后有停歇
console.log('\n⑤ 计次无间隙 + 最后一遍后有停歇');
{
  const p = plan([step({ kind: 'count', durationSec: 0, repeatCount: 2, repeatRestSec: 0, restAfterSec: 10 })]);
  const now = 1000;

  let r = advance(p, 0, 0, 'step', now, now);
  assert(r.phase, 'step', '无间隙 → 直接 step');
  assert(r.repeatIndex, 1, 'repeatIndex = 1');

  r = advance(p, 0, 1, 'step', now, now);
  assert(r.phase, 'rest', '最后一遍 → rest');
  assert(r.deadline, now + 10_000, 'rest deadline = now + 10s');
}

// ⑥ 混合链：计时 → 计次 → 计时
console.log('\n⑥ 混合链：计时 → 计次 → 计时');
{
  const p = plan([
    step({ durationSec: 10 }),
    step({ kind: 'count', repeatCount: 2, repeatRestSec: 3, restAfterSec: 5 }),
    step({ durationSec: 15 }),
  ]);
  const now = 1000;

  let r = advance(p, 0, 0, 'step', now + 10_000, now + 10_001);
  assert(r.index, 1, '→ index=1（计次）');
  assert(r.phase, 'step', '→ step');
  assert(r.deadline, Number.POSITIVE_INFINITY, '计次 deadline = INFINITY');

  r = advance(p, 1, 0, 'step', now + 10_001, now + 10_001);
  assert(r.phase, 'repeatRest', '→ 间隙');
  assert(r.deadline, now + 13_001, '间隙 3s');

  r = advance(p, 1, 0, 'repeatRest', now + 13_001, now + 13_002);
  assert(r.repeatIndex, 1, 'repeatIndex = 1');

  r = advance(p, 1, 1, 'step', now + 13_002, now + 13_002);
  assert(r.phase, 'rest', '→ rest');
  assert(r.deadline, now + 18_002, 'rest 5s');

  r = advance(p, 1, 1, 'rest', now + 18_002, now + 18_003);
  assert(r.index, 2, '→ index=2');
  // 第三步从 rest deadline（now+18_002）起算
  assert(r.deadline, now + 33_002, '15s 计时');
}

// ⑦ 0 时长脏数据不会死循环
console.log('\n⑦ 0 时长脏数据 → MAX_PHASE_STEPS 兜底');
{
  const p = plan([step({ durationSec: 0 })]);
  const now = 1000;
  const r = advance(p, 0, 0, 'step', now, now);
  assert(r.finished, true, '0 时长 → 立即 finished');
  assertTrue(r.transitions.length <= 3, `过渡次数 ≤ 3（实际 ${r.transitions.length}）`);
}

// ⑧ 单遍计次（repeatCount=1，没有间隙也没有 restAfterSec）
console.log('\n⑧ 单遍计次（repeatCount=1，无间隙无停歇）');
{
  const p = plan([
    step({ kind: 'count', repeatCount: 1, repeatRestSec: 0, restAfterSec: 0 }),
    step({ durationSec: 10 }),
  ]);
  const now = 1000;

  // completeRep：第一遍（也是唯一一遍）完成 → 直接进下一步
  let r = advance(p, 0, 0, 'step', now, now);
  assert(r.index, 1, '单遍完成 → index=1');
  assert(r.phase, 'step', '→ step（下一步是计时）');
  assert(r.deadline, now + 10_000, '下一步 deadline = now + 10s');
}

// ⑨ 多遍 + 有间隙 + 有停歇：完整路径
console.log('\n⑨ 完整路径：3 遍 + 间隙 3s + 停歇 10s + 下一步');
{
  const p = plan([
    step({ kind: 'count', repeatCount: 3, repeatRestSec: 3, restAfterSec: 10 }),
    step({ durationSec: 5 }),
  ]);
  const now = 1000;

  let r = advance(p, 0, 0, 'step', now, now);
  assert(r.phase, 'repeatRest', '① 第 1 遍 → 间隙');

  r = advance(p, 0, 0, 'repeatRest', now + 3_000, now + 3_001);
  assert(r.repeatIndex, 1, '→ 第 2 遍');

  r = advance(p, 0, 1, 'step', now + 3_001, now + 3_001);
  assert(r.phase, 'repeatRest', '② 第 2 遍 → 间隙');

  r = advance(p, 0, 1, 'repeatRest', now + 6_001, now + 6_002);
  assert(r.repeatIndex, 2, '→ 第 3 遍');

  r = advance(p, 0, 2, 'step', now + 6_002, now + 6_002);
  assert(r.phase, 'rest', '③ 最后一遍 → rest');
  assert(r.deadline, now + 16_002, 'rest 10s');

  r = advance(p, 0, 2, 'rest', now + 16_002, now + 16_003);
  assert(r.index, 1, 'rest 结束 → 下一步');
  // 下一步从 rest deadline（now+16_002）起算
  assert(r.deadline, now + 21_002, '5s 计时');
}

// ── 结果 ────────────────────────────────────────────────

console.log(`\n═══════════════════════════════════════`);
console.log(`  通过: ${passed}  失败: ${failed}  总计: ${passed + failed}`);
console.log(`═══════════════════════════════════════\n`);

if (failed > 0) {
  console.error('❌ 有测试失败！');
  process.exit(1);
} else {
  console.log('✅ 全部通过！\n');
}
