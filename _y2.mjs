// 直接在浏览器里量：v0.119 布局下 (400,300) 处有没有图元
import { spawn } from 'node:child_process';
import { freePort } from './test/_free-port.mjs';
import fs from 'node:fs';
console.log('这个探针需要起服务+CDP，改用更轻的办法：直接问 relax 里的墨迹定义');
