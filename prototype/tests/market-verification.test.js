import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {providerMinuteTimestamp} from '../shared/provider-time.mjs';
import {parseMinutes, instrument} from '../server/providers.mjs';
import {diagnoseMarketData} from '../server/market-diagnostics.mjs';
import {verifyMarketSources, fingerprint} from '../server/market-verification.mjs';

const minute = (symbol, time) => parseMinutes({data: {code: instrument(symbol).code, trends: [`${time},0,100,0`]}}, instrument(symbol));
test('A/H primary minute time is normalized without changing raw provider records', () => {
  const a = minute('600519.SH', '2026-09-30 15:00');
  const frozen = JSON.stringify(a);
  const d = diagnoseMarketData('600519.SH', a, {state:'ok'}, '2026-10-02T05:30:00Z');
  assert.equal(d.dataAt, '2026-09-30T07:00:00.000Z');
  assert.equal(d.rawProviderTime, '2026-09-30 15:00');
  assert.equal(d.dataState, 'closed-session-cache');
  assert.equal(JSON.stringify(a), frozen);
  const hk = minute('00700.HK', '2026-10-02 13:30');
  const current = diagnoseMarketData('00700.HK', hk, {state:'ok'}, '2026-10-02T05:31:00Z');
  assert.equal(current.dataAt, '2026-10-02T05:30:00.000Z');
  assert.equal(current.dataAgeSeconds, 60);
  assert.equal(current.dataState, 'recent-unverified');
  assert.equal(current.executable, false);
  assert.equal(current.realtimeVerified, false);
  assert.equal(diagnoseMarketData('00700.HK', hk, {}, '2026-10-02T05:40:00Z').dataState, 'stale');
  assert.equal(diagnoseMarketData('00700.HK', hk, {}, '2026-10-02T05:20:00Z').dataState, 'future');
});

test('unknown US source timezone remains unknown and invalid dates never roll over', () => {
  const us = minute('AAPL.US', '2026-10-02 04:00');
  assert.equal(diagnoseMarketData('AAPL.US', us, {}, '2026-10-02T05:30:00Z').dataState, 'time-unverified');
  for (const stamp of ['2026-02-30 13:00', '2026-09-30 24:01', '2026-13-01 00:00', '2026-09-30 12:60']) {
    assert.equal(providerMinuteTimestamp(stamp, 'Asia/Shanghai'), null);
    assert.throws(() => minute('600519.SH', stamp), /没有有效/);
  }
  assert.equal(providerMinuteTimestamp('2026-09-30 23:00', 'America/New_York'), null);
  assert.equal(new Date(providerMinuteTimestamp('2026-10-01 00:01', 'Asia/Hong_Kong')).toISOString(), '2026-09-30T16:01:00.000Z');
  assert.equal(new Date(providerMinuteTimestamp('2024-02-29 12:00', 'UTC')).toISOString(), '2024-02-29T12:00:00.000Z');
});

const dailyPayload = {chart: {result: [{meta: {symbol:'0700.HK',currency:'HKD',exchangeTimezoneName:'Asia/Hong_Kong',dataGranularity:'1d'},timestamp:[Date.parse('2026-09-30T01:30:00Z') / 1000],indicators:{quote:[{close:[100]}]}}]}};
test('verification exercises adapters and persistence, fingerprints data and leaves paper book unchanged', async () => {
  const result = await verifyMarketSources(['700.hk', '00700.HK'], {now: () => Date.parse('2026-10-02T05:31:00Z'), fetcher: async url => url.includes('yahoo') ? Response.json(dailyPayload) : Response.json({data:{code:'00700',trends:['2026-10-02 13:30,0,100,0']}})});
  assert.deepEqual(result.report.symbols, ['00700.HK']);
  assert.equal(result.report.requests.length, 2);
  assert.equal(result.report.requestsSucceeded, true);
  assert.equal(result.report.paperUnchanged, true);
  assert.equal(result.report.normalizedDataSha256, fingerprint(result.snapshots));
  assert.equal(result.snapshots[0].minutes.points.length, 1);
  assert.equal(result.report.capabilities[0].minutes.diagnostics.dataState, 'recent-unverified');
  assert.equal(result.report.databaseScope, 'new-in-memory-research');
});

test('verification preserves failed/cooling outcomes, hides sensitive diagnostics and makes no retry storm', async () => {
  let requests = 0;
  const result = await verifyMarketSources(['600519.SH', '00700.HK'], {fetcher: async () => {requests++; return new Response('denied', {status:403});}});
  assert.equal(requests, 2); // Both providers are cooled, including across symbols.
  assert.equal(result.report.requestsSucceeded, false);
  assert.equal(result.report.outcomes.length, 2);
  assert.equal(result.report.capabilities[1].minutes.diagnostics.dataState, 'missing');
  const sensitive = await verifyMarketSources(['AAPL.US'], {fetcher: async () => {throw new Error('fetch failed https://example.invalid?token=PRIVATE_INPUT');}});
  assert.ok(!JSON.stringify(sensitive.report).includes('PRIVATE_INPUT'));
  assert.equal(sensitive.report.paperUnchanged, true);
  await assert.rejects(verifyMarketSources(['not-a-symbol'], {fetcher: () => assert.fail('no network')}));
});

test('verification CLI saves a reproducible report, refuses overwrite and returns partial-failure status', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'market-verification-'));
  const run = promisify(execFile);
  try {
    const preload = join(dir, 'fetch.mjs');
    await writeFile(preload, 'globalThis.fetch=async()=>new Response("denied",{status:403});');
    const output = join(dir, 'output');
    await assert.rejects(run(process.execPath, ['--import', preload, 'scripts/verify-market-sources.mjs', output, 'AAPL.US'], {cwd:new URL('../',import.meta.url)}), e => e.code === 2);
    const reportText = await readFile(join(output, 'report.json'), 'utf8');
    const report = JSON.parse(reportText);
    const data = JSON.parse(await readFile(join(output, 'normalized-data.json'), 'utf8'));
    assert.equal(report.normalizedDataSha256, fingerprint(data));
    assert.equal(report.requestsSucceeded, false);
    assert.equal(report.paperUnchanged, true);
    await writeFile(preload, 'globalThis.fetch=()=>{throw new Error("SHOULD_NOT_FETCH");};');
    await assert.rejects(run(process.execPath, ['--import', preload, 'scripts/verify-market-sources.mjs', output, 'AAPL.US'], {cwd:new URL('../',import.meta.url)}), e => e.code === 1);
    assert.equal(await readFile(join(output, 'report.json'), 'utf8'), reportText);
  } finally { await rm(dir, {recursive:true, force:true}); }
});
