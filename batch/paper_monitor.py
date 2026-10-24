"""Freeze ALL model picks before future outcomes; grade matured snapshots on later runs.

python paper_monitor.py --record --results logs/rank-evaluation
Run again after collecting new daily prices to update paper-outcomes.json.
No live orders, DB changes, or scheduled jobs. Snapshots are append-only.
"""
from __future__ import annotations
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
from zoneinfo import ZoneInfo
import numpy as np
import pandas as pd
import direction_model as dm
import rank_evaluation as ev


def future_entry(calendar, signal: str, published: str, region: str):
    """First market open AFTER publication, never a retroactive next-day fill."""
    zone, hh, mm = ('Asia/Seoul', 9, 0) if region == 'KR' else ('America/New_York', 9, 30)
    now = pd.Timestamp(published)
    for date in calendar:
        opening = pd.Timestamp(date).tz_localize(ZoneInfo(zone)) + pd.Timedelta(hours=hh, minutes=mm)
        if str(date) > signal and opening > now:
            return str(date)
    return None


def record(results: Path, archive: Path):
    report = json.loads((results / 'report.json').read_text())
    pred = pd.read_pickle(results / 'oos-predictions.pkl')
    picks = []
    for region, rows in pred.groupby('region'):
        latest = rows[rows.trade_date == rows.trade_date.max()]
        for model in ev.MODEL_NAMES:
            if model == 'market':
                selected = [dm.MARKET_PROXY[region]]
            elif model == 'equal_weight':
                selected = sorted(latest.ticker.tolist())
            else:
                selected = latest.sort_values([model, 'ticker'], ascending=[False, True]).ticker.head(report['settings']['top_n']).tolist()
            picks.append({'region': region, 'model': model, 'signal_date': latest.trade_date.max(), 'tickers': selected})
    snapshot = {'published_at': datetime.now(timezone.utc).isoformat(), 'fingerprint': report['fingerprint'],
                'settings': report['settings'], 'picks': picks,
                'note': 'Only market opens strictly after publication are eligible; no retrospective fills.'}
    archive.mkdir(parents=True, exist_ok=True)
    # A repeat of an identical experiment never changes its original timestamp/picks.
    path = archive / f"{report['fingerprint']}.json"
    if path.exists():
        return path
    with path.open('x', encoding='utf-8') as f:
        json.dump(snapshot, f, ensure_ascii=False, indent=2)
    return path


def grade(snapshot: dict, raw: dict):
    rows = []
    for pick in snapshot['picks']:
        region = pick['region']
        proxy = dm.MARKET_PROXY[region]
        calendar = dm._normalize(raw[proxy][1]).trade_date.to_numpy()
        entry = future_entry(calendar, pick['signal_date'], snapshot['published_at'], region)
        item = {'fingerprint': snapshot['fingerprint'], 'region': region, 'model': pick['model'],
                'signal_date': pick['signal_date'], 'entry_date': entry, 'status': 'awaiting_entry'}
        if entry:
            position = list(calendar).index(entry)
            h = snapshot['settings']['horizon']
            if position + h >= len(calendar):
                item['status'] = 'awaiting_exit'
            else:
                exit_day = str(calendar[position + h])
                window = calendar[position:position + h + 1]
                basket, invalid = [], []
                for ticker in pick['tickers']:
                    if ticker not in raw:
                        invalid.append(ticker); continue
                    frame = dm._normalize(raw[ticker][1]).set_index('trade_date').reindex(window)
                    if frame[['open', 'close']].isna().any().any() or (frame[['open', 'close']] <= 0).any().any() or (frame.volume.iloc[[0, -1]] <= 0).any():
                        invalid.append(ticker); continue
                    # Unresolved corporate-action discontinuities invalidate grading, not dropped winners/losers.
                    ratios = frame.close.pct_change(fill_method=None) + 1
                    if ((ratios < .35) | (ratios > 2.9)).any():
                        invalid.append(ticker); continue
                    series = frame.close / frame.open.iloc[0]
                    series.iloc[-1] = frame.open.iloc[-1] / frame.open.iloc[0]
                    basket.append(series.to_numpy(float))
                item.update(exit_date=exit_day, invalid_tickers=invalid)
                if invalid or not basket:
                    item['status'] = 'needs_price_review'
                else:
                    costs = snapshot['settings']
                    buy, sell = costs['buy_bps'] / 1e4, costs['sell_bps'] / 1e4
                    wealth = np.mean(basket, axis=0) / (1 + buy)
                    wealth[-1] *= 1 - sell
                    curve = np.r_[1., wealth]
                    item.update(status='matured', net_return=float(wealth[-1] - 1),
                                max_drawdown=float((curve / np.maximum.accumulate(curve) - 1).min()))
        rows.append(item)
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--results', type=Path, default=Path(__file__).parent / 'logs/rank-evaluation')
    parser.add_argument('--prices', type=Path, default=dm.PRICE_CACHE)
    parser.add_argument('--record', action='store_true')
    args = parser.parse_args()
    archive = args.results / 'paper'
    if args.record:
        print('Frozen snapshot:', record(args.results, archive))
    raw = pd.read_pickle(args.prices)
    rows = [row for p in sorted(archive.glob('*.json')) for row in grade(json.loads(p.read_text()), raw)]
    out = args.results / 'paper-outcomes.json'
    out.write_text(json.dumps({'updated_at': datetime.now(timezone.utc).isoformat(), 'outcomes': rows}, ensure_ascii=False, indent=2), encoding='utf-8')
    print('Paper outcomes:', {s: sum(r['status'] == s for r in rows) for s in sorted({r['status'] for r in rows})})

if __name__ == '__main__':
    main()
