/**
 * 自定义入口：先注册前台服务（notifee 要求尽早注册，且不随热重载持久），
 * 再挂 expo-router。package.json 的 main 指向本文件。
 */

import { registerRunForeground } from './notifications/runForeground';

registerRunForeground();

import 'expo-router/entry';
