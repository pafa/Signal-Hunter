import {mkdir, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {instrument} from '../shared/securities.mjs';
import {verifyMarketSources} from '../server/market-verification.mjs';

const [directory, ...symbols] = process.argv.slice(2);
if (!directory || !symbols.length || symbols.length > 12) {
  console.error('用法：npm run market:verify -- <全新输出目录> <证券代码...，最多12个>');
  process.exitCode = 1;
} else {
  try {
    symbols.forEach(symbol => instrument(symbol));
    const output = resolve(directory);
    // Exclusive directory reservation also rejects existing files and symlinks before any request.
    await mkdir(output, {mode: 0o700});
    const {report, snapshots} = await verifyMarketSources(symbols);
    await writeFile(resolve(output, 'normalized-data.json'), JSON.stringify(snapshots, null, 2), {flag: 'wx', mode: 0o600});
    await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2), {flag: 'wx', mode: 0o600});
    console.log(JSON.stringify({output, requestsSucceeded: report.requestsSucceeded, paperUnchanged: report.paperUnchanged,
      results: report.capabilities.map(row => ({symbol: row.symbol, daily: row.daily.diagnostics.dataState, minutes: row.minutes.diagnostics.dataState}))}));
    if (!report.requestsSucceeded) process.exitCode = 2;
  } catch {
    console.error('核验未完成：检查证券代码、输出目录须不存在且父目录可写，以及运行环境。已有文件未覆盖。');
    process.exitCode = 1;
  }
}
