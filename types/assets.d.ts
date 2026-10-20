/**
 * Metro 资源导入的类型声明。
 *
 * 为什么需要这个文件：
 * expo-router 只内置声明了 `*.png`（expo-router/build/ts-declarations/assets.d.ts），
 * 音频资源没有任何内置声明。缺了它，`import x from './chime.mp3'` 会报 TS2307，
 * 而临时用 `require()` 绕过去只会把类型问题藏起来。
 *
 * Metro 在打包时会把音频文件替换成一个资源 ID（number），
 * expo-audio 的 `AudioSource` 正好接受这个 number。
 */

declare module '*.mp3' {
  const assetId: number;
  export default assetId;
}

declare module '*.wav' {
  const assetId: number;
  export default assetId;
}

declare module '*.m4a' {
  const assetId: number;
  export default assetId;
}
