import unittest
import pandas as pd
import paper_monitor as pm

class PaperMonitorTests(unittest.TestCase):
    def test_cannot_fill_before_publication(self):
        dates=['2026-10-23','2026-10-26','2026-10-27']
        self.assertEqual(pm.future_entry(dates,'2026-10-23','2026-10-26T01:00:00+00:00','KR'),'2026-10-27')

    def test_korean_next_session_after_weekend(self):
        self.assertEqual(pm.future_entry(['2026-10-23','2026-10-26'],'2026-10-23','2026-10-24T15:00:00+00:00','KR'),'2026-10-26')

    def test_us_open_respects_dst(self):
        self.assertEqual(pm.future_entry(['2026-10-26','2026-10-27'],'2026-10-23','2026-10-26T13:31:00+00:00','US'),'2026-10-27')

    def test_no_future_prices_means_wait(self):
        raw={'SPY':('US',pd.DataFrame({'trade_date':['2026-10-23'],'open':[100.],'close':[100.],'high':[100.],'low':[100.],'volume':[100]}))}
        snap={'published_at':'2026-10-24T15:00:00+00:00','fingerprint':'test',
              'settings':{'horizon':20,'buy_bps':10,'sell_bps':20},
              'picks':[{'region':'US','model':'market','signal_date':'2026-10-23','tickers':['SPY']}]}
        row=pm.grade(snap,raw)[0]
        self.assertEqual(row['status'],'awaiting_entry')
        self.assertNotIn('net_return',row)

if __name__=='__main__':unittest.main()
