/**
 * 本地 id 生成。
 *
 * 这是一个纯本地、单设备的应用，不需要跨端唯一性，也不需要密码学强度。
 * 因此不引入 expo-crypto 之类的额外原生依赖，用「时间戳 + 随机后缀」即可：
 * 同一毫秒内生成上万次也不会冲突。
 */

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

function randomChunk(length: number): string {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += ID_ALPHABET[Math.floor(Math.random() * ID_ALPHABET.length)];
  }
  return out;
}

/** 生成形如 `plan_m3k9x1_7f2a8c` 的 id。前缀用于日志里一眼看出实体类型。 */
export function createId(prefix: 'plan' | 'step'): string {
  return `${prefix}_${Date.now().toString(36)}_${randomChunk(6)}`;
}
