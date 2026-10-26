"""DB 용량 추세 계산 검증; run with python -m unittest test_db_usage."""
import unittest

import db_usage as du

MB = du.MB
LIMIT = 500 * MB


def rows(*pairs) -> list[dict]:
    """(날짜, MB) 쌍들을 db_usage 행 형태로."""
    return [{"measured_on": d, "total_bytes": int(m * MB)} for d, m in pairs]


class EstimateTests(unittest.TestCase):
    def test_no_rows_has_no_trend(self):
        e = du.estimate([], LIMIT)
        self.assertEqual(e["points"], 0)
        self.assertIsNone(e["per_week"])
        self.assertIsNone(e["reach_on"])

    def test_single_row_reports_size_but_no_trend(self):
        e = du.estimate(rows(("2026-10-26", 241)), LIMIT)
        self.assertEqual(e["points"], 1)
        self.assertEqual(e["latest_bytes"], 241 * MB)
        self.assertAlmostEqual(e["used_pct"], 48.2, places=1)
        self.assertIsNone(e["per_week"])

    def test_weekly_growth_slope(self):
        """7일 간격으로 10MB씩 늘면 주당 +10MB."""
        e = du.estimate(rows(("2026-10-05", 200), ("2026-10-12", 210),
                             ("2026-10-19", 220), ("2026-10-26", 230)), LIMIT)
        self.assertEqual(e["points"], 4)
        self.assertAlmostEqual(e["per_week"] / MB, 10.0, places=6)

    def test_reach_date_from_slope(self):
        """230MB에서 주당 10MB면 남은 270MB는 27주 뒤 = 189일."""
        e = du.estimate(rows(("2026-10-05", 200), ("2026-10-12", 210),
                             ("2026-10-19", 220), ("2026-10-26", 230)), LIMIT)
        self.assertAlmostEqual(e["weeks_left"], 27.0, places=3)
        self.assertEqual(e["reach_on"], "2027-05-03")  # 2026-10-26 + 189일

    def test_shrinking_has_no_reach_date(self):
        e = du.estimate(rows(("2026-10-12", 240), ("2026-10-19", 235),
                             ("2026-10-26", 230)), LIMIT)
        self.assertLess(e["per_week"], 0)
        self.assertIsNone(e["reach_on"])
        self.assertIsNone(e["weeks_left"])

    def test_cleanup_resets_the_window(self):
        """정리로 303 → 241MB 로 꺾인 뒤에는 그 이후 구간만 써야 한다.
        전체를 묶어 재면 기울기가 음수가 되어 '한도에 안 닿는다'는 잘못된 답이 나온다."""
        r = rows(("2026-09-14", 285), ("2026-09-21", 294), ("2026-10-05", 303),
                 ("2026-10-12", 241), ("2026-10-19", 249), ("2026-10-26", 257))
        e = du.estimate(r, LIMIT)
        self.assertTrue(e["trimmed"])
        self.assertEqual(e["points"], 3)
        self.assertAlmostEqual(e["per_week"] / MB, 8.0, places=6)
        self.assertIsNotNone(e["reach_on"])

    def test_small_dip_is_not_treated_as_cleanup(self):
        """측정 시각 차이로 생기는 몇 MB 흔들림은 정리가 아니다."""
        r = rows(("2026-10-12", 240), ("2026-10-19", 238), ("2026-10-26", 246))
        e = du.estimate(r, LIMIT)
        self.assertFalse(e["trimmed"])
        self.assertEqual(e["points"], 3)

    def test_only_last_cleanup_counts(self):
        r = rows(("2026-08-03", 300), ("2026-08-10", 200),   # 1차 정리
                 ("2026-09-07", 320), ("2026-09-14", 230),   # 2차 정리 — 여기서부터
                 ("2026-09-21", 240), ("2026-09-28", 250))
        e = du.estimate(r, LIMIT)
        self.assertTrue(e["trimmed"])
        self.assertEqual(e["points"], 3)

    def test_window_caps_at_max_points(self):
        many = rows(*[(f"2026-{(i // 28) + 1:02d}-{(i % 28) + 1:02d}", 100 + i)
                      for i in range(40)])
        e = du.estimate(many, LIMIT)
        self.assertEqual(e["points"], du.MAX_POINTS)

    def test_already_over_limit_has_no_reach_date(self):
        e = du.estimate(rows(("2026-10-19", 495), ("2026-10-26", 505)), LIMIT)
        self.assertGreater(e["used_pct"], 100.0)
        self.assertIsNone(e["reach_on"])

    def test_flat_series_has_no_reach_date(self):
        e = du.estimate(rows(("2026-10-12", 241), ("2026-10-19", 241),
                             ("2026-10-26", 241)), LIMIT)
        self.assertEqual(e["per_week"], 0.0)
        self.assertIsNone(e["reach_on"])

    def test_glacial_growth_gives_no_date(self):
        """1000주를 넘으면 사실상 안 닿는 것이라 날짜를 내지 않는다."""
        r = [{"measured_on": "2026-10-12", "total_bytes": 100 * MB},
             {"measured_on": "2026-10-19", "total_bytes": 100 * MB + 1000},
             {"measured_on": "2026-10-26", "total_bytes": 100 * MB + 2000}]
        e = du.estimate(r, LIMIT)
        self.assertGreater(e["per_week"], 0)
        self.assertIsNone(e["reach_on"])

    def test_uneven_gaps_use_actual_days(self):
        """측정이 빠진 주가 있어도 날짜 간격으로 재야 한다(행 순서가 아니라)."""
        e = du.estimate(rows(("2026-10-05", 200), ("2026-10-26", 230)), LIMIT)
        self.assertAlmostEqual(e["per_week"] / MB, 10.0, places=6)


class SinceLastDropTests(unittest.TestCase):
    def test_keeps_all_when_monotonic(self):
        r = rows(("2026-10-12", 230), ("2026-10-19", 240), ("2026-10-26", 250))
        self.assertEqual(len(du.since_last_drop(r)), 3)

    def test_starts_at_the_drop_row(self):
        r = rows(("2026-10-12", 303), ("2026-10-19", 241), ("2026-10-26", 249))
        kept = du.since_last_drop(r)
        self.assertEqual([x["measured_on"] for x in kept],
                         ["2026-10-19", "2026-10-26"])


class FormatTests(unittest.TestCase):
    def test_mb_formatting(self):
        self.assertEqual(du.mb(241 * MB), "241.0MB")
        self.assertEqual(du.mb(-62 * MB), "-62.0MB")
        self.assertEqual(du.mb(0), "0.0MB")


if __name__ == "__main__":
    unittest.main()
