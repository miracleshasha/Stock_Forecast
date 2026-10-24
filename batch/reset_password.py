"""회원 비밀번호 재설정 (운영자용, 로컬에서 직접 실행).

앱에는 비밀번호 찾기가 없고(전화번호를 받을 수 없는 이메일 형식 ID로 쓰기 때문),
운영자가 Supabase 관리자 API(service key, batch/.env)로 새 비밀번호를 지정합니다.
새 비밀번호는 화면에 표시되지 않게 입력받고, 어디에도 저장하거나 출력하지 않습니다.
바꾸면 그 계정의 다른 기기 로그인은 다음 토큰 갱신 때 풀릴 수 있습니다.

사용법: .venv/bin/python reset_password.py 01012345678
"""
from __future__ import annotations

import getpass
import sys

import requests

import config

ID_DOMAIN = "stock-forecast-59po.vercel.app"   # web/lib/auth.ts 와 같아야 함
PASSWORD_MIN = 6                                # web/lib/phone.ts 와 같음


def main(argv):
    if len(argv) != 1:
        raise SystemExit("사용법: python reset_password.py 010xxxxxxxx")
    phone = "".join(ch for ch in argv[0] if ch.isdigit())
    email = f"{phone}@{ID_DOMAIN}"
    config.require_supabase()
    h = {"apikey": config.SUPABASE_SERVICE_ROLE_KEY,
         "authorization": f"Bearer {config.SUPABASE_SERVICE_ROLE_KEY}",
         "content-type": "application/json"}

    user = None
    page = 1
    while user is None:
        r = requests.get(f"{config.SUPABASE_URL}/auth/v1/admin/users", headers=h,
                         params={"page": page, "per_page": 200}, timeout=30)
        r.raise_for_status()
        users = r.json().get("users", [])
        user = next((u for u in users if u.get("email") == email), None)
        if len(users) < 200:
            break
        page += 1
    if not user:
        raise SystemExit(f"{phone} 로 가입된 계정이 없습니다.")

    pw = getpass.getpass("새 비밀번호: ")
    if len(pw) < PASSWORD_MIN:
        raise SystemExit(f"비밀번호는 {PASSWORD_MIN}자 이상이어야 합니다.")
    if getpass.getpass("한 번 더: ") != pw:
        raise SystemExit("두 번 입력한 비밀번호가 다릅니다.")

    r = requests.put(f"{config.SUPABASE_URL}/auth/v1/admin/users/{user['id']}", headers=h,
                     json={"password": pw}, timeout=30)
    if r.status_code >= 300:
        raise SystemExit(f"변경 실패 [{r.status_code}]: {r.text[:200]}")
    print("비밀번호를 바꿨어요. 새 비밀번호로 로그인하세요.")


if __name__ == "__main__":
    main(sys.argv[1:])
