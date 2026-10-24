"""Offline, reproducible 20-session stock-selection evaluation (no DB writes).

python rank_evaluation.py --output logs/rank-evaluation
Raw OHLCV cache and cached ticker metadata are required. Pickles must be trusted.
This is research on CURRENT surviving symbols, not a point-in-time universe.
"""
from __future__ import annotations

import argparse
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path

import numpy as np
import pandas as pd

import direction_model as dm
import indicators
import scoring

VERSION = 'rank-evaluation-v1'
MODEL_NAMES = {'technical': '기술 점수', 'momentum': '12개월 모멘텀', 'ridge': '선형 순위 모델',
               'equal_weight': '전체 동일비중', 'market': '시장 ETF'}
FEATURES = ['r5', 'r20', 'r60', 'mom12_1', 'ma20_gap', 'ma60_gap',
            'rsi14', 'bb_pctb', 'vol20', 'vol60', 'hi52_gap', 'log_vol_ratio']

@dataclass(frozen=True)
class Settings:
    horizon: int = 20
    top_n: int = 20
    min_train_days: int = 252
    start: str = '2024-09-01'
    ridge_alpha: float = 0.1
    offsets: tuple[int, ...] = (0, 5, 10, 15)
    buy_bps: float = 10.0
    sell_bps: float = 20.0
    stress_multiplier: float = 2.0


def fingerprint(paths: list[Path], settings: Settings) -> str:
    import config
    h = hashlib.sha256(json.dumps({'settings': asdict(settings), 'trend_extra': config.TREND_EXTRA, 'pandas': pd.__version__, 'numpy': np.__version__}, sort_keys=True).encode())
    for p in paths:
        h.update(p.name.encode())
        h.update(p.read_bytes())
    return h.hexdigest()


def technical_scores(df: pd.DataFrame, index_close: pd.Series) -> pd.Series:
    """Exact existing rounded technical contributions, with proxy RS20.

    Market-common stress damping is omitted: it cannot add cross-sectional information.
    Ties use ticker, not the original row order. TREND_EXTRA follows runtime config.
    """
    c = df['close']
    ma20, ma60, ma120 = (df[f'ma{n}'] for n in (20, 60, 120))
    arr = np.select([(ma20 > ma60) & (ma60 > ma120), (ma20 <= ma60) & (ma60 <= ma120)], [2, -2], 0)
    gap = (c / ma20 - 1) * 100
    pos = np.select([gap >= 5, gap >= 2, gap > -2, gap > -5], [2, 1, 0, -1], -2)
    trend = (arr + pos) / 2
    # Optional experimental trend additions use the production helpers, avoiding a second formula.
    import config
    if config.TREND_EXTRA:
        trend = np.array([scoring.group_avg(scoring._trend(r, r['close'])) for r in df.to_dict('records')])
    rsi = df['rsi14'].astype(float)
    rsis = np.select([rsi.between(55, 70), rsi.between(50, 55, inclusive='left') | rsi.between(70, 75, inclusive='right'),
                     rsi.between(45, 50, inclusive='left'), (rsi < 30) | (rsi > 80)], [2, 1, 0, -2], -1)
    macd = np.select([(df.macd > df.macd_signal) & (df.macd_hist > 0), df.macd > df.macd_signal,
                      (df.macd < df.macd_signal) & (df.macd_hist < 0)], [2, 1, -2], -1)
    index_ret = index_close.pct_change(20, fill_method=None) * 100
    rs = c.pct_change(20, fill_method=None) * 100 - df.trade_date.map(index_ret)
    rss = np.select([rs >= 3, rs >= .5, rs > -.5, rs > -3], [2, 1, 0, -1], -2)
    mom = np.where(rs.notna(), (rsis + macd + rss) / 3, (rsis + macd) / 2)
    pb = pd.to_numeric(df.bb_percent_b, errors="coerce").astype(float)
    pbs = np.select([pb.between(.5, .8), pb.between(.8, 1, inclusive='right'), pb < .2, pb > 1], [2, 1, -2, -1], 0)
    widths = pd.to_numeric(df.bb_width, errors="coerce").astype(float)
    pct = widths.dropna().rolling(120, min_periods=20).apply(lambda a: np.mean(a < a[-1]), raw=True).reindex(df.index)
    squeeze = np.where(pct <= .2, np.sign(c - df.bb_mid), 0)
    env = np.select([c > df.env_upper, c > df.bb_mid, c < df.env_lower], [-2, 2, -1], 0)
    band = (pbs + squeeze + env) / 3
    vr, up = pd.to_numeric(df.vol_ratio20, errors="coerce").astype(float), c.diff() > 0
    vol = np.select([(vr >= 1.5) & up, vr >= 1.5, (vr >= 1.2) & up, vr >= 1.2], [2, -2, 1, -1], 0)
    volume = (vol + 2 * np.sign(df.obv - df.obv.shift(20))) / 2
    groups = {'trend': trend, 'momentum': mom, 'band': band, 'volume': volume}
    total = sum(np.rint(groups[g] / 2 * w) for g, w in scoring.WEIGHTS.items())
    return pd.Series(total, index=df.index)


def prepare(raw: dict, metadata: pd.DataFrame, settings: Settings):
    meta = metadata.drop_duplicates('ticker').set_index('ticker')
    etfs = set(meta.index[meta.is_etf == 1])
    known = set(meta.index)
    frames, matrices, calendars, diagnostics = [], {}, {}, []
    for region, proxy in dm.MARKET_PROXY.items():
        if proxy not in raw:
            raise ValueError(f'Missing market proxy {proxy}')
        idx = dm._normalize(raw[proxy][1])
        idx = idx[(idx.open > 0) & (idx.close > 0)].set_index('trade_date')
        calendars[region] = idx.index.to_numpy()
        matrices[region] = {'open': {}, 'close': {}, 'volume': {}, 'jumps': {}}
        for ticker, (r, prices) in raw.items():
            if r != region:
                continue
            df = dm._normalize(prices)
            if df.trade_date.duplicated().any():
                raise ValueError(f'Duplicate dates: {ticker}')
            if ((df[['open', 'close']] <= 0).any().any() or df[['open', 'close']].isna().any().any()):
                raise ValueError(f'Invalid price: {ticker}')
            day = df.set_index('trade_date')
            for col in ('open', 'close', 'volume'):
                matrices[region][col][ticker] = day[col]
            ratio = day.close.pct_change(fill_method=None) + 1
            matrices[region]['jumps'][ticker] = (ratio < .35) | (ratio > 2.9)
            if ticker not in known or ticker in etfs:
                continue
            # Restart all indicator histories after unresolved structural price breaks.
            for seg in dm._segments(df):
                seg = indicators.compute(seg.to_dict('records'))
                features = dm.stock_features(seg)
                features['technical'] = technical_scores(seg, idx.close)
                features['ticker'], features['region'] = ticker, region
                # Map to the MARKET calendar, not the next observed row for suspended stocks.
                aligned = day.reindex(calendars[region])
                entry = aligned.open.shift(-1)
                exit_price = aligned.open.shift(-(settings.horizon + 1))
                target = exit_price / entry - 1
                exit_dates = pd.Series(calendars[region], index=calendars[region]).shift(-(settings.horizon + 1))
                features['target'] = features.trade_date.map(target)
                features['exit_date'] = features.trade_date.map(exit_dates)
                # Do not train on a label crossing an unresolved break or a segment boundary.
                features.loc[features.exit_date > seg.trade_date.iloc[-1], ['target', 'exit_date']] = [np.nan, None]
                features = features.iloc[252:].copy()
                features = features.dropna(subset=FEATURES + ['technical'])
                features = features[features.trade_date.map(day.volume).gt(0)]
                frames.append(features[['ticker', 'region', 'trade_date', 'exit_date', 'target', 'technical'] + FEATURES])
        for col, data in matrices[region].items():
            matrices[region][col] = pd.DataFrame(data).reindex(calendars[region])
        diagnostics.append({'region': region, 'calendar_from': str(calendars[region][0]),
                            'calendar_to': str(calendars[region][-1]), 'raw_tickers': len(matrices[region]['open'].columns)})
    panel = pd.concat(frames, ignore_index=True).replace([np.inf, -np.inf], np.nan)
    panel = panel.dropna(subset=FEATURES + ['technical'])
    keys = [panel.region, panel.trade_date]
    ranks = panel.groupby(keys)[FEATURES].rank(pct=True) - .5
    for f in FEATURES:
        panel[f'x_{f}'] = ranks[f]
    # Same-date target rank = rank of market-excess return (benchmark common to all).
    panel['target_rank'] = panel.groupby(keys).target.rank(pct=True) - .5
    return panel, matrices, calendars, {'markets': diagnostics, 'unknown_metadata_tickers': sorted(set(raw) - known),
                                       'excluded_etfs': len(etfs), 'rows': len(panel), 'stocks': panel.ticker.nunique()}


def ridge_predict(train: pd.DataFrame, test: pd.DataFrame, alpha: float) -> np.ndarray:
    cols = [f'x_{f}' for f in FEATURES]
    x, y = train[cols].to_numpy(float), train.target_rank.to_numpy(float)
    weights = 1 / train.groupby('trade_date').ticker.transform('size').to_numpy()
    weights /= weights.sum()
    # Cross-sectional rank features already have the same fixed scale. No future-fitted scaler.
    beta = np.linalg.solve(np.einsum('ni,nj,n->ij', x, x, weights) + alpha * np.eye(len(cols)), np.einsum('ni,n,n->i', x, weights, y))
    return np.einsum('ni,i->n', test[cols].to_numpy(float), beta)


def walk_forward(panel: pd.DataFrame, settings: Settings):
    outputs, folds = [], []
    for region, d in panel.groupby('region'):
        starts = pd.date_range(pd.Timestamp(settings.start).to_period('Q').start_time,
                               d.trade_date.max(), freq='QS')
        for start in starts:
            lo, hi = start.strftime('%Y-%m-%d'), (start + pd.offsets.QuarterBegin(startingMonth=1)).strftime('%Y-%m-%d')
            test = d[(d.trade_date >= max(lo, settings.start)) & (d.trade_date < hi)].copy()
            if test.empty:
                continue
            train = d[(d.trade_date < lo) & d.target.notna() & d.exit_date.lt(lo)]
            if train.trade_date.nunique() < settings.min_train_days:
                continue
            assert train.exit_date.max() < test.trade_date.min()
            test['ridge'] = ridge_predict(train, test, settings.ridge_alpha)
            test['momentum'] = test.mom12_1
            outputs.append(test)
            folds.append({'region': region, 'quarter': lo[:7], 'train_from': train.trade_date.min(),
                          'train_to': train.trade_date.max(), 'last_label_exit': train.exit_date.max(),
                          'test_from': test.trade_date.min(), 'test_to': test.trade_date.max(),
                          'train_days': int(train.trade_date.nunique()), 'rows': len(train)})
    if not outputs:
        raise ValueError('Insufficient data for walk-forward evaluation')
    return pd.concat(outputs, ignore_index=True), folds


def rebalance(holdings: pd.Series, cash: float, opens: pd.Series, selected: list[str], buy: float, sell: float):
    """Self-financing rebalance; charges costs on actual notional, including retained weight changes."""
    old = holdings.reindex(opens.index, fill_value=0) * opens
    nav = float(old.sum() + cash)
    weights = pd.Series(0., index=opens.index)
    if selected:
        weights.loc[selected] = 1 / len(selected)
    investable = nav
    # Exact fixed-point budget: target holdings + commissions = pretrade NAV.
    for _ in range(80):
        delta = weights * investable - old
        fees = float(delta.clip(lower=0).sum() * buy + (-delta.clip(upper=0)).sum() * sell)
        updated = nav - fees
        if abs(updated - investable) < 1e-12:
            break
        investable = updated
    target = weights * updated
    delta = target - old
    cost = float(delta.clip(lower=0).sum() * buy + (-delta.clip(upper=0)).sum() * sell)
    quantities = target / opens
    quantities = quantities.where(target != 0, 0.)
    return quantities, nav - float(target.sum()) - cost, cost, delta


def simulate(pred: pd.DataFrame, matrices: dict, calendar: np.ndarray, model: str,
             settings: Settings, offset: int, multiplier: float = 1.0):
    start = pred.trade_date.min()
    dates = calendar[calendar >= start]
    if len(dates) < settings.horizon + 2:
        raise ValueError('Short evaluation calendar')
    op, cl, volume = (matrices[k].reindex(dates) for k in ('open', 'close', 'volume'))
    # Common proxy is included for market benchmark. Other benchmarks use identical eligible stocks.
    proxy = dm.MARKET_PROXY[str(pred.region.iloc[0])]
    all_symbols = sorted(set(pred.ticker) | {proxy})
    op, cl, volume = (m.reindex(columns=all_symbols) for m in (op, cl, volume))
    jump_flags = matrices['jumps'].reindex(index=dates, columns=all_symbols).eq(True)
    # Mark suspended holdings at last close. Never invent an execution price.
    marks = cl.ffill()
    schedule = {dates[i + 1]: dates[i] for i in range(offset, len(dates) - 1, settings.horizon)}
    by_day = {d: g for d, g in pred.groupby('trade_date')}
    holdings, cash = pd.Series(0., index=all_symbols), 1.
    equity, trades, stale, structural = [], [], [], []
    buys, sells = settings.buy_bps * multiplier / 1e4, settings.sell_bps * multiplier / 1e4
    for i, date in enumerate(dates):
        preheld = holdings.gt(1e-12)
        jumps = jump_flags.loc[date]
        if (preheld & jumps).any():
            structural.append({'date': str(date), 'tickers': list(preheld.index[preheld & jumps])})
        signal = schedule.get(date)
        terminal = i == len(dates) - 1
        if signal is not None or terminal:
            candidates = by_day.get(signal, pd.DataFrame())
            chosen = []
            if not terminal:
                if model == 'market':
                    chosen = [proxy]
                elif not candidates.empty:
                    if model == 'equal_weight':
                        chosen = sorted(candidates.ticker.tolist())
                    else:
                        chosen = candidates.sort_values([model, 'ticker'], ascending=[False, True]).ticker.head(settings.top_n).tolist()
            prices = op.loc[date]
            # Observed at execution time: no fill on missing open/zero session volume.
            executable = prices.gt(0) & volume.loc[date].gt(0)
            locked = holdings.gt(0) & ~executable
            if locked.any():
                stale.append({'date': str(date), 'tickers': list(locked.index[locked]), 'kind': 'unfilled_rebalance'})
            chosen = [t for t in chosen if executable.get(t, False)]
            # Frozen positions remain held; rebalance only freely tradable assets and cash.
            available = executable & ~locked
            free, cash, fees, delta = rebalance(holdings[available], cash, prices[available], chosen, buys, sells)
            holdings.loc[available] = free
            for ticker, value in delta.items():
                if abs(value) > 1e-10:
                    trades.append({'date': str(date), 'signal_date': str(signal) if signal else None,
                                   'ticker': ticker, 'side': 'buy' if value > 0 else 'sell',
                                   'notional': float(abs(value)), 'fee': float(abs(value) * (buys if value > 0 else sells))})
        held = holdings.gt(1e-12)
        missing = held & cl.loc[date].isna()
        if missing.any():
            stale.append({'date': str(date), 'tickers': list(missing.index[missing]), 'kind': 'stale_mark'})
        values = holdings[held] * marks.loc[date, held]
        if values.isna().any():
            raise ValueError('Unpriceable holding')
        nav = float(cash + values.sum())
        equity.append({'date': str(date), 'nav': nav})
    return pd.DataFrame(equity), pd.DataFrame(trades), {'stale_events': stale, 'structural_events': structural,
                                                      'unliquidated': list(holdings.index[holdings.gt(1e-12)])}


def metrics(equity: pd.DataFrame, trades: pd.DataFrame) -> dict:
    nav = equity.set_index('date').nav
    with_start = np.r_[1., nav.to_numpy()]
    peak = np.maximum.accumulate(with_start)
    elapsed = (pd.Timestamp(nav.index[-1]) - pd.Timestamp(nav.index[0])).days / 365.25
    out = {'total_return': float(nav.iloc[-1] - 1),
           'annualized_return': float(nav.iloc[-1] ** (1 / elapsed) - 1) if elapsed > 0 else 0.,
           'max_drawdown': float((with_start / peak - 1).min()), 'trade_count': len(trades),
           'total_cost': float(trades.fee.sum()) if len(trades) else 0.,
           'annualized_turnover': float(trades.notional.sum() / nav.mean() / max(elapsed, 1e-9)) if len(trades) else 0.}
    return out


def quarterly_returns(equity: pd.DataFrame) -> dict:
    nav = equity.set_index(pd.to_datetime(equity.date)).nav
    ends = nav.groupby(nav.index.to_period('Q')).last()
    returns = ends / ends.shift(1, fill_value=1.) - 1
    return {str(k): float(v) for k, v in returns.items()}


def evaluate(pred: pd.DataFrame, matrices: dict, calendars: dict, settings: Settings, output: Path):
    results, offsets, diagnostics = [], [], []
    for region, d in pred.groupby('region'):
        for offset in settings.offsets:
            for mult in (1., settings.stress_multiplier):
                runs = {}
                for model in MODEL_NAMES:
                    eq, trades, diag = simulate(d, matrices[region], calendars[region], model, settings, offset, mult)
                    key = f'{region}-{model}-offset{offset}-cost{mult:g}'
                    eq.to_csv(output / f'{key}-equity.csv', index=False)
                    trades.to_csv(output / f'{key}-trades.csv', index=False)
                    runs[model] = {'model': model, 'name': MODEL_NAMES[model], 'region': region,
                                   'offset': offset, 'cost_multiplier': mult, **metrics(eq, trades),
                                   'quarters': quarterly_returns(eq), 'diagnostic_count': sum(len(v) for v in diag.values())}
                    if any(diag.values()):
                        diagnostics.append({'run': key, **diag})
                for row in runs.values():
                    row['market_excess'] = row['total_return'] - runs['market']['total_return']
                    row['equal_weight_excess'] = row['total_return'] - runs['equal_weight']['total_return']
                    row['momentum_excess'] = row['total_return'] - runs['momentum']['total_return']
                    row['winning_quarters_vs_market'] = sum(v > runs['market']['quarters'][q] for q, v in row['quarters'].items())
                    row['quarter_count'] = len(row['quarters'])
                    (results if offset == settings.offsets[0] else offsets).append(row)
                print(f'{region} offset={offset} cost={mult:g} complete', flush=True)
    return results, offsets, diagnostics


def rank_ic(pred: pd.DataFrame, settings: Settings) -> list[dict]:
    rows = []
    for region, d in pred.dropna(subset=['target']).groupby('region'):
        for model in ('technical', 'momentum', 'ridge'):
            series = d.groupby('trade_date').apply(lambda g: g[model].rank().corr(g.target.rank()), include_groups=False).dropna()
            rows.append({'region': region, 'model': model, 'mean_ic': float(series.mean()), 'days': len(series)})
    return rows


def write_markdown(report: dict, path: Path):
    lines = ['# 20거래일 종목 순위 연구 보고서', '',
             f"생성: {report['created_at']} / 실험 식별자: {report['fingerprint'][:16]}", '',
             '**현재 생존 종목 기반의 탐색 연구입니다. 자동 채택하지 않습니다.**', '',
             f'비용은 실제 증권사 요율이 아닌 가정입니다. 기본 매수 {report["settings"]["buy_bps"]:g}bp·매도 {report["settings"]["sell_bps"]:g}bp, 보수 조건은 각각 2배입니다.',
             '국내·미국 현지통화 가격수익률이며 배당·환전·개인별 세금은 별도입니다.', '',
             '|시장|비용 배수|모델|누적 수익률|시장 대비 차이|최대 낙폭|거래 수|연환산 회전율(매수+매도)|',
             '|---|---:|---|---:|---:|---:|---:|---:|']
    for r in report['results']:
        lines.append(f"|{r['region']}|{r['cost_multiplier']:g}|{r['name']}|{r['total_return']:.2%}|{r['market_excess']:.2%}p|{r['max_drawdown']:.2%}|{r['trade_count']}|{r['annualized_turnover']:.1f}|")
    lines += ['', '## 한계와 채택 조건', ''] + [f'- {s}' for s in report['limitations']]
    lines += ['', '일별 자산·거래 내역은 같은 폴더의 CSV, 분기별·시작일별 결과는 report.json에서 확인합니다.', '']
    path.write_text('\n'.join(lines), encoding='utf-8')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prices', type=Path, default=dm.PRICE_CACHE)
    parser.add_argument('--metadata', type=Path, default=Path(__file__).parent / 'logs/direction_panel.pkl')
    parser.add_argument('--output', type=Path, default=Path(__file__).parent / 'logs/rank-evaluation')
    parser.add_argument('--fresh', action='store_true')
    parser.add_argument('--web-report', type=Path, help='Optional server-only JSON destination (never public/)')
    parser.add_argument('--buy-bps', type=float, default=10.)
    parser.add_argument('--sell-bps', type=float, default=20.)
    args = parser.parse_args()
    if not (0 <= args.buy_bps < 1000 and 0 <= args.sell_bps < 1000):
        parser.error('Costs must be in [0, 1000) basis points')
    settings = Settings(buy_bps=args.buy_bps, sell_bps=args.sell_bps)
    args.output.mkdir(parents=True, exist_ok=True)
    sources = [args.prices, args.metadata, Path(__file__), Path(dm.__file__), Path(indicators.__file__), Path(scoring.__file__)]
    key = fingerprint(sources, settings)
    cache = args.output / 'evaluation-panel.pkl'
    manifest = args.output / 'panel-manifest.json'
    if not args.fresh and cache.exists() and manifest.exists() and json.loads(manifest.read_text())['fingerprint'] == key:
        panel = pd.read_pickle(cache)
        # Matrices are price-only; reuse preparation to guarantee no old panel/raw mismatch.
        _, matrices, calendars, data = prepare(pd.read_pickle(args.prices), pd.read_pickle(args.metadata), settings)
    else:
        panel, matrices, calendars, data = prepare(pd.read_pickle(args.prices), pd.read_pickle(args.metadata), settings)
        panel.to_pickle(cache)
        manifest.write_text(json.dumps({'fingerprint': key}), encoding='utf-8')
    print(f'Panel: {len(panel):,} rows, {panel.ticker.nunique()} stocks', flush=True)
    pred, folds = walk_forward(panel, settings)
    pred.to_pickle(args.output / 'oos-predictions.pkl')
    print(f'Walk-forward: {len(folds)} folds, {len(pred):,} OOS rows', flush=True)
    results, offsets, diag = evaluate(pred, matrices, calendars, settings, args.output)
    report = {'version': VERSION, 'created_at': datetime.now(timezone.utc).isoformat(), 'fingerprint': key,
              'settings': asdict(settings), 'data': data, 'folds': folds, 'results': results, 'offset_results': offsets,
              'rank_ic': rank_ic(pred, settings), 'diagnostics': diag, 'adoption': 'research_only',
              'limitations': [
                  '2026-10-24より前の構成銘柄・上場廃止を復元しておらず、生存・選択バイアスが残る。',
                  '同じ過去期間は既に他の実験にも使用済み。未使用データでの将来モニタリングが必要。',
                  '分割・分社等の大きな価格断絶は特徴量と学習ラベルを分断。保有中の断絶は診断に記録し採択を保留。',
                  '欠損・売買停止で約定できなければ持ち越し。終端で売却できない保有と古い評価価格は診断に記録。',
                  '費用は仮定値。実口座手数料・税金・市場インパクト・配当・為替は別途精査。',
                  '市場比は価格リターンの差。国内はKODEX200、米国はSPYで市場全体との完全一致ではない。',
                  '技術点数のRS20は同じ市場ETFを使用。市場共通のストレス減衰は省略した比較用再現値。',
                  '取引は端株可・資金1で計算。最低売買単位・注文サイズ制約は未反映。',
                  '評価最終日は寄付きで清算。最終保有は20日未満になり得る。分期の先頭・末尾は部分期間。',
                  '開始日4通りは重複する感度検証であり、独立した4倍の証拠ではない。',
                  '自動採択なし。費用控除後の基準超過・許容最大下落・期間一貫性・費用感度と将来モニタリングで判断。']}
    (args.output / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False), encoding='utf-8')
    write_markdown(report, args.output / 'report.md')
    if args.web_report:
        if 'public' in args.web_report.parts:
            raise ValueError('Research reports must not be written to a public directory')
        args.web_report.parent.mkdir(parents=True, exist_ok=True)
        compact = {**report, 'diagnostics': [{'run': d['run'], 'stale_count': len(d['stale_events']), 'structural_count': len(d['structural_events']), 'unliquidated_count': len(d['unliquidated'])} for d in diag]}
        temp = args.web_report.with_suffix('.tmp')
        temp.write_text(json.dumps(compact, ensure_ascii=False, indent=2, allow_nan=False), encoding='utf-8')
        temp.replace(args.web_report)
    print(args.output / 'report.md', flush=True)

if __name__ == '__main__':
    main()
