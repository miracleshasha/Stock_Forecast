"""미국 종목 한글명을 symbols.name_ko 에 적용.

- 이미 존재하는 티커만 대상(미존재 티커 삽입 방지).
- name_ko 컬럼만 업데이트(merge 업서트) → market 등 다른 값은 건드리지 않음.

사용법: python apply_us_ko_names.py
"""
from __future__ import annotations

import supabase_io
from us_ko_names import US_KO_NAMES


def main():
    supabase_io.config.require_supabase()
    existing = {s["ticker"] for s in supabase_io.get_active_symbols()}
    targets = {t: n for t, n in US_KO_NAMES.items() if t in existing}
    missing = [t for t in US_KO_NAMES if t not in existing]
    print(f"적용 대상 {len(targets)}종목 / 매핑 {len(US_KO_NAMES)}개")
    if missing:
        print(f"  (유니버스에 없어 건너뜀: {', '.join(missing)})")
    for t, n in targets.items():
        supabase_io.patch("symbols", {"ticker": t}, {"name_ko": n})
    print("완료 — 이제 한글명으로 검색됩니다.")


if __name__ == "__main__":
    main()
