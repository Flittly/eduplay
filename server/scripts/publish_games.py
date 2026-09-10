# -*- coding: utf-8 -*-
"""一键上架四个游戏到 EduPlay 云端商城（需要云端服务器运行中）"""
import json
import subprocess
import sys

BASE = "http://127.0.0.1:17070/api/v1"
GAMES_DIR = r"E:\Self\workspace\eduplay-games"

GAMES = [
    ("geo_gomoku",      "经纬度五子棋",   f"{GAMES_DIR}\\geo-gomoku\\dist\\geo_gomoku-0.2.0.zip"),
    ("province_puzzle", "行政区拼图",     f"{GAMES_DIR}\\province-puzzle\\dist\\province_puzzle-0.3.7.zip"),
    ("province_quiz",   "省级行政区识别", f"{GAMES_DIR}\\province-quiz\\dist\\province_quiz-0.2.2.zip"),
    ("shanhe_match3",   "山河三消",       f"{GAMES_DIR}\\shanhe-match3\\dist\\shanhe_match3-0.1.1.zip"),
]

CODE_COUNT = 10  # 每个游戏生成的激活码数量


def curl(method, path, token=None, json_body=None, form_file=None):
    cmd = ["curl", "-s", "-X", method, f"{BASE}{path}"]
    if token:
        cmd += ["-H", f"Authorization: Bearer {token}"]
    if json_body is not None:
        cmd += ["-H", "Content-Type: application/json", "-d", json.dumps(json_body)]
    if form_file:
        cmd += ["-F", f"file=@{form_file}"]
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")
    try:
        return json.loads(r.stdout)
    except json.JSONDecodeError:
        print(f"  !! 非 JSON 响应: {r.stdout[:300]}")
        return {"success": False}


def main():
    # 1. 登录
    resp = curl("POST", "/admin/login", json_body={"username": "admin", "password": "admin123"})
    if not resp.get("success"):
        print("管理员登录失败:", resp)
        sys.exit(1)
    token = resp["data"]["token"]
    print("[1/4] 管理员登录成功")

    # 2. 建游戏 + 传包 + 上架
    print("[2/4] 创建游戏并上传插件包、启用：")
    for game_code, name, zip_path in GAMES:
        resp = curl("POST", "/admin/games", token, {
            "gameCode": game_code, "name": name,
            "description": name, "priceCents": 0,
        })
        if not resp.get("success"):
            print(f"  x {name} 创建失败: {resp.get('message')}")
            continue
        game_id = resp["data"]["id"]

        resp = curl("POST", f"/admin/games/{game_code}/packages", token, form_file=zip_path)
        if not resp.get("success"):
            print(f"  x {name} 传包失败: {resp.get('message')}")
            continue
        version = resp["data"].get("version") or resp["data"].get("latestVersion") or "?"

        resp = curl("PATCH", f"/admin/games/{game_id}/status", token, {"status": "ACTIVE"})
        status = "ACTIVE" if resp.get("success") else f"失败({resp.get('message')})"
        print(f"  + {name} ({game_code}) v{version} -> {status}")

    # 3. 生成激活码
    print(f"[3/4] 每个游戏生成 {CODE_COUNT} 个激活码：")
    for game_code, name, _ in GAMES:
        resp = curl("POST", "/admin/codes/generate", token,
                    {"gameCode": game_code, "count": CODE_COUNT})
        codes = resp["data"] if resp.get("success") else []
        print(f"  + {name}: {len(codes)} 个" + (f"  首码 {codes[0]['code']}" if codes else f"  失败: {resp.get('message')}"))

    # 4. 校验
    print("[4/4] 校验商城列表：")
    resp = curl("GET", "/admin/games", token)
    for g in resp.get("data") or []:
        print(f"  {g['gameCode']:<18} {g['name']:<10} v{g.get('version')}  {g['status']}  ¥{g.get('priceCents',0)/100:.2f}")


if __name__ == "__main__":
    main()
