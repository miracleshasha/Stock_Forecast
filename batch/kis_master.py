"""KIS 종목 마스터 파일(공식) — KOSPI200·KOSDAQ150 구성종목과 ETF 목록.

한국투자증권이 매일 내려주는 고정폭 텍스트 파일입니다(cp949).
  https://new.real.download.dws.co.kr/common/master/kospi_code.mst.zip
  https://new.real.download.dws.co.kr/common/master/kosdaq_code.mst.zip
각 줄 = 앞부분(단축코드 9 · 표준코드 12 · 한글명) + 뒷부분 고정폭 필드.
뒷부분 길이는 KOSPI 227자, KOSDAQ 221자이고, 필드 위치는 2026-10 실제 파일에서
삼성전자·SK하이닉스(KOSPI200), 에코프로·에코프로비엠(KOSDAQ150), KODEX 200(ETF)으로 검증했습니다.
"""
from __future__ import annotations

import io
import zipfile

import requests

BASE = "https://new.real.download.dws.co.kr/common/master"

# KOSPI 뒷부분(227자) 앞쪽 필드: 그룹코드(2) 시총규모(1) 대·중·소분류(4·4·4) 제조업(1) 저유동성(1) 지배구조(1) KOSPI200섹터(1)
KOSPI_TAIL = 227
KOSDAQ_TAIL = 221
_K200_SECTOR_AT = 2 + 1 + 4 + 4 + 4 + 1 + 1 + 1          # = 18
# KOSPI 시가총액(억원) 필드 위치: 뒷부분 끝에서 9+3+1+1+1 앞 = 시가총액(9) 그룹사코드(3) 플래그 3개
_K_MCAP_FROM_END = 9 + 3 + 1 + 1 + 1
# KOSDAQ 뒷부분: 그룹(2) 시총규모(1) 분류(4·4·4) 벤처·저유동·KRX·ETP(4) KRX100~운송 16개 플래그 + 단기과열 → KOSDAQ150
_Q150_AT = 35


def _download(name: str) -> bytes:
    resp = requests.get(f"{BASE}/{name}.mst.zip", timeout=60)
    resp.raise_for_status()
    with zipfile.ZipFile(io.BytesIO(resp.content)) as z:
        return z.read(f"{name}.mst")


def _rows(raw: bytes, tail: int):
    for line in raw.splitlines():
        if len(line) <= tail:
            continue
        head = line[: len(line) - tail].decode("cp949", "replace")
        back = line[len(line) - tail:].decode("cp949", "replace")
        yield head[0:9].strip(), head[21:].strip(), back


def kospi() -> list[dict]:
    out = []
    for code, name, back in _rows(_download("kospi_code"), KOSPI_TAIL):
        mcap = back[len(back) - _K_MCAP_FROM_END: len(back) - _K_MCAP_FROM_END + 9].strip()
        out.append({
            "code": code,
            "name": name,
            "group": back[0:2],                      # ST 주식, EF ETF, EN ETN ...
            "k200": back[_K200_SECTOR_AT] not in (" ", "0"),
            "mcap": int(mcap) if mcap.isdigit() else 0,   # 억원 (ETF는 순자산 규모 근사)
        })
    return out


def kosdaq() -> list[dict]:
    out = []
    for code, name, back in _rows(_download("kosdaq_code"), KOSDAQ_TAIL):
        out.append({"code": code, "name": name, "group": back[0:2], "q150": back[_Q150_AT] == "Y"})
    return out


def index_members() -> tuple[list[dict], list[dict]]:
    """(KOSPI200, KOSDAQ150) 주식 목록."""
    k = [r for r in kospi() if r["group"] == "ST" and r["k200"]]
    q = [r for r in kosdaq() if r["group"] == "ST" and r["q150"]]
    return k, q
