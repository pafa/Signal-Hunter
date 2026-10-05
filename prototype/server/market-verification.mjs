import {createHash} from 'node:crypto';
import {instrument} from '../shared/securities.mjs';
import {safeDiagnosticPayload} from '../shared/safe-errors.mjs';
import {openStore} from './store.mjs';
import {createService} from './service.mjs';

export const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Exercise the same adapters, validation, provider cooling and persistence as research mode.
// The caller cannot supply an existing database; no scheduler tick or trade action is invoked.
export async function verifyMarketSources(symbols, {fetcher = fetch, now = Date.now} = {}) {
  if (!Array.isArray(symbols) || !symbols.length || symbols.length > 12) throw new Error('指定 1–12 个核验证券');
  const selected = [...new Set(symbols.map(value => instrument(value).symbol))];
  const startedAt = new Date(now()).toISOString();
  const requests = [];
  const recordedFetch = async (url, options) => {
    const row = {host: new URL(url).hostname, startedAt: new Date(now()).toISOString()};
    requests.push(row);
    try {
      const response = await fetcher(url, options);
      row.status = response.status;
      return response;
    } catch (error) {
      row.transportFailed = true;
      throw error;
    } finally { row.finishedAt = new Date(now()).toISOString(); }
  };
  const store = openStore(':memory:');
  let service;
  try {
    service = createService(store, {mode: 'research', fetcher: recordedFetch, now});
    const paperBefore = fingerprint(service.paper.snapshot());
    selected.forEach(symbol => store.addWatch(symbol));
    const outcomes = [];
    for (const symbol of selected) {
      outcomes.push({symbol, daily: await service.refreshDaily(symbol, true), minutes: await service.refreshQuote(symbol)});
    }
    const finishedAt = new Date(now()).toISOString();
    const snapshots = selected.map(symbol => ({symbol, daily: store.daily(symbol), minutes: store.quote(symbol)}));
    const capabilities = service.snapshot().dataCapabilities;
    const paperUnchanged = paperBefore === fingerprint(service.paper.snapshot());
    if (!paperUnchanged) throw new Error('核验过程意外改变模拟账本');
    return {
      report: safeDiagnosticPayload({
        schemaVersion: 1, startedAt, finishedAt, symbols: selected, requests, outcomes,
        capabilities, sourceChecks: store.checks(), normalizedDataSha256: fingerprint(snapshots),
        requestsSucceeded: outcomes.every(result => result.daily.ok === true && result.minutes.ok === true),
        paperUnchanged, databaseScope: 'new-in-memory-research',
        realtimeVerified: false, executable: false,
        coverage: '指定证券的一次抽查，不代表全市场、连续可用或实时可成交',
      }),
      snapshots,
    };
  } finally {
    service?.close();
    store.close();
  }
}
