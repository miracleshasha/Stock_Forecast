/** Owner-only authorization and server-render regression checks. No real credentials. */
import ts from "typescript";
import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
import React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const compile = p => ts.transpileModule(fs.readFileSync(path.join(root, p), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
let identity = null;
let authError = false;
const authBox = { exports: {}, require: n => {
  if (n === 'server-only') return {};
  if (n === './auth') return { getSessionUser: async () => {
    if (authError) throw new Error('Auth unavailable');
    return identity;
  }};
  throw Error(n);
}};
vm.runInNewContext(compile('lib/model-access.ts'), authBox);
const owner = { id: '1cb6ce0b-c6a5-4cdc-a0b6-f49a4b916bcf', email: 'owner@example.com' };
const other = { id: 'other-account', email: owner.email, user_metadata: { id: owner.id } };
let reportLoads = 0;
const pageBox = { exports: {}, require: n => {
  if (n === 'server-only') return {};
  if (n === 'react/jsx-runtime') return jsxRuntime;
  if (n === 'next/link') return { default: ({ children, ...props }) => React.createElement('a', props, children) };
  if (n === 'next/navigation') return { notFound: () => { throw Error('NOT_FOUND'); } };
  if (n === '@/lib/model-access') return authBox.exports;
  if (n === '@/lib/model-research') return { getRankEvaluationReport: async () => {
    reportLoads++;
    return { created_at: '2026-01-01', settings: {buy_bps:10,sell_bps:20,stress_multiplier:2}, data:{stocks:10},
      folds:[{region:'KR',test_from:'2025-01-01',test_to:'2025-12-31'}],
      results:[{region:'KR',model:'ridge',name:'선형 순위 모델',cost_multiplier:1,total_return:0,market_excess:0,
        max_drawdown:0,trade_count:0,annualized_turnover:0,winning_quarters_vs_market:0,quarter_count:1,quarters:{'2025Q1':0}}],
      offset_results:[],limitations:['Synthetic test fixture'],diagnostics:[] };
  }};
  throw Error(n);
}};
vm.runInNewContext(compile('app/research/page.tsx'), pageBox);
(async () => {
  const can = authBox.exports.canViewModelResearch;
  assert.equal(can(owner), true);
  assert.equal(can(null), false);
  assert.equal(can({ user_metadata: { id: owner.id } }), false);
  assert.equal(can(other), false);
  for (const user of [null, other]) {
    identity = user;
    await assert.rejects(pageBox.exports.default(), /NOT_FOUND/);
    assert.equal(reportLoads, 0, 'Forbidden account must not load report data');
  }
  authError = true;
  await assert.rejects(pageBox.exports.default(), /NOT_FOUND/);
  assert.equal(reportLoads, 0);
  authError = false;
  identity = owner;
  const html = renderToStaticMarkup(await pageBox.exports.default());
  assert.equal(reportLoads, 1);
  assert.ok(html.includes('모델 비교 연구'));
  assert.ok(html.includes('선형 순위 모델'));
  assert.ok(!html.includes(owner.email), 'Account identifier must not appear in HTML');
  const stock = fs.readFileSync(path.join(root, 'app/stock/[ticker]/page.tsx'), 'utf8');
  // N일 뒤 전망은 2026-10-25부터 로그인 회원 모두에게 공개 — 종목 화면에는 계정 제한이 없어야 함
  assert.ok(stock.includes('getOutlook(stock.symbol.ticker, region)'));
  assert.ok(!stock.includes('isModelResearchOwner') && !stock.includes('isBeta()'));
  console.log('Model research: owner render, non-owner/anonymous/auth-failure rejection, no unauthorized report load passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
