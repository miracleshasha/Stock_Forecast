"""국내 종목 투자자별 순매수 과거 이력 받기 (연구용, 2026-10-24).

N일 뒤 방향 예측에 외국인·기관 수급이 도움이 되는지 검증하려고, KIS '종목별 투자자매매동향(일별)'
(FHPTJ04160001, 호출당 30거래일, 기준일 지정 가능)으로 과거를 거슬러 받아 로컬 파일에 둡니다.
DB 용량(무료 500MB)을 아끼려고 DB 에는 넣지 않습니다 — 매일 쌓는 운영 데이터는
extras.collect_investor_flows 가 daily_investor_flow 에 계속 넣고 있습니다.

종목마다 logs/flows/<ticker>.pkl 로 저장해 중간에 끊겨도 이어서 받습니다.
금액 단위: 백만원(KIS *_ntby_tr_pbmn), trade_value 는 원(acml_tr_pbmn).

사용법: python flow_backfill.py            (국내 주식 전부, 이미 받은 종목은 건너뜀)
        python flow_backfill.py 005930     (특정 종목만)
"""
from __future__ import annotations

import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

import pandas as pd

import kis_client
import supabase_io

OUT = Path(__file__).parent / "logs" / "flows"
SINCE = "20210101"
FIELDS = {
    "close": "stck_clpr",
    "trade_value": "acml_tr_pbmn",
    "foreign_net_amt": "frgn_ntby_tr_pbmn",
    "inst_net_amt": "orgn_ntby_tr_pbmn",
    "indiv_net_amt": "prsn_ntby_tr_pbmn",
    "pension_net_amt": "fund_ntby_tr_pbmn",      # 연기금 등
    "foreign_net_qty": "frgn_ntby_qty",
    "inst_net_qty": "orgn_ntby_qty",
}


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def fetch_history(code: str) -> pd.DataFrame:
    rows: dict[str, dict] = {}
    end = datetime.now().strftime("%Y%m%d")
    while end >= SINCE:
        d = kis_client._get(
            "/uapi/domestic-stock/v1/quotations/investor-trade-by-stock-daily", "FHPTJ04160001",
            {"FID_COND_MRKT_DIV_CODE": "J", "FID_INPUT_ISCD": code, "FID_INPUT_DATE_1": end,
             "FID_ORG_ADJ_PRC": "", "FID_ETC_CLS_CODE": ""},
        )
        if d.get("rt_cd") not in (None, "0"):
            raise RuntimeError(f"{d.get('msg_cd')} {d.get('msg1')}")
        page = [r for r in d.get("output2") or [] if r.get("stck_bsop_date")]
        if not page:
            break
        for r in page:
            rows[r["stck_bsop_date"]] = {k: _num(r.get(src)) for k, src in FIELDS.items()}
        oldest = min(r["stck_bsop_date"] for r in page)
        if len(page) < 5:  # 상장 초기에 닿음
            break
        end = (datetime.strptime(oldest, "%Y%m%d") - timedelta(days=1)).strftime("%Y%m%d")
    df = pd.DataFrame.from_dict(rows, orient="index")
    df.index.name = "date"
    return df.sort_index().reset_index()


def main(argv):
    OUT.mkdir(parents=True, exist_ok=True)
    wanted = [a for a in argv if not a.startswith("--")]
    syms = supabase_io.select("symbols", {"select": "ticker,currency,kind", "is_active": "eq.true"})
    codes = [s["ticker"] for s in syms if s["currency"] == "KRW" and s.get("kind") != "etf"]
    if wanted:
        codes = [c for c in codes if c in wanted]
    todo = [c for c in codes if wanted or not (OUT / f"{c}.pkl").exists()]
    print(f"국내 주식 {len(codes)}개 중 {len(todo)}개 받기", flush=True)
    t0 = time.time()
    for i, code in enumerate(todo, 1):
        try:
            df = fetch_history(code)
            df.to_pickle(OUT / f"{code}.pkl")
            span = f"{df['date'].iloc[0]}~{df['date'].iloc[-1]}" if len(df) else "없음"
            print(f"  [{i}/{len(todo)}] {code} {len(df)}일 ({span}) · {time.time() - t0:.0f}s", flush=True)
        except Exception as e:  # noqa: BLE001
            print(f"  [{i}/{len(todo)}] {code} 실패: {e}", flush=True)


if __name__ == "__main__":
    main(sys.argv[1:])
