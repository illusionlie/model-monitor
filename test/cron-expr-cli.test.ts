import { execFile } from 'node:child_process';
import { URL as NodeURL, fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { minutesToCron } from '../src/lib/cron';

// 对拍:CLI 子进程输出必须与 src/lib/cron.ts 的纯函数完全一致(CI 用 CLI,Worker 用函数,
// 两端共享同一实现,但仍然验证"进程边界"没有引入差异——退出码、stdout 归一化、兜底语义)。
const execFileAsync = promisify(execFile);
// 注意显式用 node:url 的 URL:全局 URL 来自 @cloudflare/workers-types,与 node 类型不兼容
const SCRIPT = fileURLToPath(new NodeURL('../scripts/cron-expr.mjs', import.meta.url));

// Windows 下必须用 process.execPath(node 可执行文件)而不是 "node"(PATH 解析/扩展名问题);
// 脚本是 .mjs,无需 shell。
async function runCli(...args: string[]): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFileAsync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    timeout: 30_000,
  });
  return { stdout, stderr };
}

describe('scripts/cron-expr.mjs(CLI 对拍)', () => {
  it('无参 → 兜底 */30,退出码 0(CI 兜底语义)', async () => {
    const { stdout } = await runCli();
    expect(stdout.trim()).toBe('*/30 * * * *');
  });

  it('空串参数 → 兜底 */30', async () => {
    const { stdout } = await runCli('');
    expect(stdout.trim()).toBe('*/30 * * * *');
  });

  it('非法输入 abc → 兜底 */30 且 stderr 有警告(退出码仍 0)', async () => {
    const { stdout, stderr } = await runCli('abc');
    expect(stdout.trim()).toBe('*/30 * * * *');
    expect(stderr).toContain('警告');
  });

  it('代表值:45 / 60 / 90 / 1440', async () => {
    expect((await runCli('45')).stdout.trim()).toBe('*/45 * * * *');
    expect((await runCli('60')).stdout.trim()).toBe('0 * * * *');
    expect((await runCli('90')).stdout.trim()).toBe('0 */2 * * *');
    expect((await runCli('1440')).stdout.trim()).toBe('0 0 * * *');
  });

  it('对拍:CLI 输出 === minutesToCron(同输入)', async () => {
    const values = ['1', '5', '30', '59', '61', '100', '120', '720', '1439', '2000', '  30  '];
    for (const v of values) {
      const { stdout } = await runCli(v);
      expect(stdout.trim(), `input=${JSON.stringify(v)}`).toBe(minutesToCron(v));
    }
  });

  it('stdout 仅一行表达式(可安全用于 $(...) 命令替换)', async () => {
    const { stdout } = await runCli('30');
    expect(stdout.trimEnd().split('\n')).toHaveLength(1);
    expect(stdout.trim()).toBe('*/30 * * * *');
  });
});
