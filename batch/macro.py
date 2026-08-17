"""매크로 지표 수집 (종목 무관, 날짜 단위).

- 국내 지수(KOSPI): KIS
- VIX / 미10년물 / USD/KRW / S&P500 / 달러지수: FRED 공개 CSV (API 키 불필요)
- VKOSPI: KIS 지수코드가 설정된 경우에만. 없으면 스코어링에서 VIX로 대체.
"""
from __future__ import annotations

import config
import fred
import kis_client


def _ret20(series: list[dict]) -> float | None:
    closes = [r["close"] for r in series if r.get("close") is not None]
    if len(closes) < 21:
        return None
    return (closes[-1] - closes[-21]) / closes[-21] * 100


def _fred(series_id: str) -> list[tuple[str, float]]:
    try:
        return fred.fetch_series(series_id, 10)
    except Exception as e:  # noqa: BLE001
        print(f"  [macro] FRED {series_id} 실패: {e}")
        return []


def _val_and_chg(series: list[tuple[str, float]]) -> tuple[float | None, float | None]:
    """최근값과 약 1주(5영업일) 변화량."""
    if not series:
        return None, None
    val = series[-1][1]
    chg = val - series[-6][1] if len(series) >= 6 else None
    return val, chg


def collect() -> dict:
    result = {
        "trade_date": None,
        "vix": None, "vkospi": None,
        "us10y": None, "dxy": None, "usdkrw": None,
        "kospi_close": None, "spx_close": None,
        # 스코어링용 부가정보(테이블에는 저장 안 함)
        "_kospi_ret20": None, "_us10y_chg": None, "_usdkrw_chg": None,
    }

    # KOSPI 지수 (KIS)
    try:
        kospi = kis_client.fetch_domestic_index_daily(config.KOSPI_INDEX_CODE, 40)
        if kospi:
            result["kospi_close"] = kospi[-1]["close"]
            result["trade_date"] = kis_client.iso(kospi[-1]["date"])
            result["_kospi_ret20"] = _ret20(kospi)
    except Exception as e:  # noqa: BLE001
        print(f"  [macro] KOSPI 지수 수집 실패: {e}")

    # VKOSPI (코드가 설정된 경우에만)
    if config.VKOSPI_INDEX_CODE:
        try:
            vk = kis_client.fetch_domestic_index_daily(config.VKOSPI_INDEX_CODE, 5)
            if vk:
                result["vkospi"] = vk[-1]["close"]
        except Exception as e:  # noqa: BLE001
            print(f"  [macro] VKOSPI 수집 실패: {e}")

    # FRED 지표
    result["vix"], _ = _val_and_chg(_fred("VIXCLS"))
    result["us10y"], result["_us10y_chg"] = _val_and_chg(_fred("DGS10"))
    result["usdkrw"], result["_usdkrw_chg"] = _val_and_chg(_fred("DEXKOUS"))
    result["spx_close"], _ = _val_and_chg(_fred("SP500"))
    result["dxy"], _ = _val_and_chg(_fred("DTWEXBGS"))  # 무역가중 달러지수(DXY 대용)

    # KOSPI 기준일이 없으면 SP500 날짜라도 사용
    if not result["trade_date"]:
        s = _fred("SP500")
        if s:
            result["trade_date"] = s[-1][0]

    return result
