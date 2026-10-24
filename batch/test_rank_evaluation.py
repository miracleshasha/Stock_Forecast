"""Economic/timing invariants; run with python -m unittest test_rank_evaluation."""
import unittest
import numpy as np
import pandas as pd
from dataclasses import replace
import rank_evaluation as re
import indicators
import scoring

class EvaluationTests(unittest.TestCase):
    def test_round_trip_cost_is_self_financing(self):
        p = pd.Series({'A': 10.})
        h, cash, fee, delta = re.rebalance(pd.Series({'A': 0.}), 1., p, ['A'], .01, .02)
        self.assertAlmostEqual(h.A * 10 + cash + fee, 1.)
        h, cash, fee2, _ = re.rebalance(h, cash, p, [], .01, .02)
        self.assertAlmostEqual(cash, .98 / 1.01)
        self.assertAlmostEqual(h.A, 0.)

    def test_retained_weights_not_charged_twice(self):
        h = pd.Series({'A': .05, 'B': .05})
        _, cash, fee, delta = re.rebalance(h, 0., pd.Series({'A': 10., 'B': 10.}), ['A', 'B'], .01, .02)
        self.assertAlmostEqual(fee, 0.)
        self.assertAlmostEqual(cash, 0.)

    def fixture(self, gap=False):
        dates = pd.bdate_range('2024-01-01', periods=25).strftime('%Y-%m-%d').to_numpy()
        op = pd.DataFrame({'A': np.r_[10., np.repeat(20., 24)], 'SPY': np.repeat(10., 25)}, index=dates)
        cl = op.copy()
        if gap:
            cl.loc[dates[3], 'A'] = 10.
        v = pd.DataFrame(100., index=dates, columns=op.columns)
        pred = pd.DataFrame({'ticker': ['A'] * 25, 'region': ['US'] * 25, 'trade_date': dates,
                             'technical': 1., 'momentum': 1., 'ridge': 1.})
        mat = {'open': op, 'close': cl, 'volume': v,
               'jumps': pd.DataFrame(False, index=dates, columns=op.columns)}
        return dates, mat, pred

    def test_next_open_does_not_capture_overnight_gap(self):
        dates, mat, pred = self.fixture()
        eq, tr, _ = re.simulate(pred, mat, dates, 'ridge', replace(re.Settings(), buy_bps=0, sell_bps=0), 0)
        self.assertAlmostEqual(eq.nav.iloc[-1], 1.)
        self.assertEqual(tr.iloc[0].date, dates[1])
        self.assertEqual(tr.iloc[0].signal_date, dates[0])

    def test_drawdown_uses_daily_marks(self):
        dates, mat, pred = self.fixture(gap=True)
        eq, tr, _ = re.simulate(pred, mat, dates, 'ridge', replace(re.Settings(), buy_bps=0, sell_bps=0), 0)
        self.assertAlmostEqual(re.metrics(eq, tr)['max_drawdown'], -.5)

    def test_higher_costs_reduce_flat_price_wealth(self):
        dates, mat, pred = self.fixture()
        a, _, _ = re.simulate(pred, mat, dates, 'ridge', re.Settings(), 0, 1.)
        b, _, _ = re.simulate(pred, mat, dates, 'ridge', re.Settings(), 0, 2.)
        self.assertLess(b.nav.iloc[-1], a.nav.iloc[-1])

    def test_suspension_retains_holding_and_reports_it(self):
        dates, mat, pred = self.fixture()
        mat['volume'].loc[dates[-1], 'A'] = 0
        eq, tr, diag = re.simulate(pred, mat, dates, 'ridge', re.Settings(), 0)
        self.assertIn('A', diag['unliquidated'])
        self.assertTrue(diag['stale_events'])
        self.assertGreater(eq.nav.iloc[-1], 0.)

    def test_vector_technical_matches_production(self):
        rng = np.random.default_rng(3)
        closes = np.exp(np.cumsum(rng.normal(0, .02, 350))) * 100
        dates = pd.bdate_range('2020-01-01', periods=350)
        frame = indicators.compute([dict(date=d.strftime('%Y%m%d'), trade_date=d.strftime('%Y-%m-%d'),
            close=float(c), open=float(c), high=float(c * 1.01), low=float(c * .99), volume=int(v))
            for d, c, v in zip(dates, closes, rng.integers(100, 1000, 350))])
        idx = pd.Series(np.linspace(100, 130, 350), index=frame.trade_date)
        score = re.technical_scores(frame, idx)
        for i in range(252, 350):
            win = frame.iloc[:i + 1]
            r = (idx.iloc[i] / idx.iloc[i-20] - 1) * 100
            expected = scoring.score_signal(win, {}, 'NASDAQ', 'USD', r)['score']
            self.assertEqual(score.iloc[i], expected, f'row {i}')

    def test_walk_forward_excludes_future_label_end(self):
        dates = pd.bdate_range('2023-01-02', '2025-01-01').strftime('%Y-%m-%d')
        d = pd.DataFrame({'ticker': 'A', 'region': 'US', 'trade_date': dates,
                          'exit_date': pd.Series(dates).shift(-21), 'target': .01, 'target_rank': 0., 'mom12_1': .1})
        for f in re.FEATURES:
            d[f'x_{f}'] = 0.
        _, folds = re.walk_forward(d, re.Settings())
        self.assertTrue(folds)
        for f in folds:
            self.assertLess(f['last_label_exit'], f['test_from'])

if __name__ == '__main__':
    unittest.main()
