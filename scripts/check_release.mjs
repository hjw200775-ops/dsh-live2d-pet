#!/usr/bin/env node
/**
 * 发布前检查：确认仓库里没有混入模型资产、Cubism Core、本机路径或密钥。
 *
 *   node scripts/check_release.mjs [仓库路径]
 *
 * 不带参数时检查脚本所在的仓库（scripts/ 的上一级）；
 * 只检查 git 已跟踪的文件（未跟踪的不会被推到 GitHub）。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const cwd = process.argv[2] || path.resolve(here, '..');

let files;
try {
  files = execFileSync('git', ['-C', cwd, 'ls-files', '-z'], { encoding: 'utf8' })
    .split('\u0000')
    .filter(Boolean);
} catch (e) {
  console.error(`不是 git 仓库，或 git 不可用：${cwd}`);
  process.exit(2);
}

const forbidden = [
  [/\.moc3$/i, '模型二进制（协议禁止再分发）'],
  [/\.model3\.json$/i, '模型入口文件'],
  [/\.physics3\.json$/i, '模型物理文件'],
  [/\.cdi3\.json$/i, '模型显示信息'],
  [/\.vtube\.json$/i, 'VTube Studio 模型配置'],
  [/\.psd$/i, 'PSD 源文件'],
  [/\.can3$/i, 'Cubism 动画工程'],
  [/live2dcubismcore/i, 'Live2D Cubism Core（分发需 Live2D 授权）'],
  [/(^|\/)qa\//i, 'QA 截图目录'],
  [/^\.dsh\//i, '本机 DSH 数据目录'],
  [/(^|\/)(preferences|config)\.json$/i, '本机配置'],
  [/\.(log|tgz|zip|bak)$/i, '临时/打包产物'],
];

const textLike = /\.(m?js|cjs|ts|json|md|ya?ml|html|css|py|txt)$/i;
const secrets = [
  [/[A-Za-z]:[\\/]{1,2}Users[\\/]/i, '本机绝对路径'],
  [/sk-[A-Za-z0-9_-]{16,}/, '疑似 API key'],
];

const problems = [];
for (const file of files) {
  for (const [re, why] of forbidden) {
    if (re.test(file)) problems.push(`✗ ${file} —— ${why}`);
  }
  // 只有这两个图片允许进仓库：托盘图标、摸头的临时手部素材
  const allowedImages = new Set(['desktop/tray.png', 'renderer/assets/petpat.png']);
  if (file.endsWith('.png') && !allowedImages.has(file)) {
    problems.push(`✗ ${file} —— 图片（模型/截图不要进仓库；README 用外链）`);
  }
  if (textLike.test(file)) {
    let text;
    try { text = readFileSync(path.resolve(cwd, file), 'utf8'); } catch { continue; }
    for (const [re, why] of secrets) {
      const m = text.match(re);
      if (m) problems.push(`✗ ${file} —— ${why}：${m[0].slice(0, 60)}`);
    }
  }
}

if (problems.length) {
  console.error(`发现 ${problems.length} 个问题：\n` + problems.join('\n'));
  process.exit(1);
}

console.log(`[ok] ${files.length} 个已跟踪文件，未发现模型资产、Core、本机路径或密钥。`);
