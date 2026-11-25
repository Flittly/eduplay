"""临时实例的接口冒烟测试：只验证本次修复涉及的行为。"""
import json
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

BASE = "http://127.0.0.1:17081/api/v1"
results = []


def call(method, path, body=None, token=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(BASE + path, data=data, method=method)
    if body is not None:
        req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return resp.status, json.loads(resp.read().decode() or "{}")
    except urllib.error.HTTPError as err:
        raw = err.read().decode()
        try:
            return err.code, json.loads(raw or "{}")
        except json.JSONDecodeError:
            return err.code, {"raw": raw[:200]}


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else "  -> " + str(detail)))


user = "smoke" + str(int(time.time() * 1000) % 1000000)
status, body = call("POST", "/auth/local/register", {
    "username": user, "password": "smoke123456", "nickname": "冒烟老师"
})
token = (body.get("data") or {}).get("token")
check("注册教师", status == 200 and bool(token), (status, body))

# 1) 401：无令牌
status, body = call("GET", "/students")
check("无令牌访问返回 401", status == 401 and body.get("code") == "UNAUTHORIZED", (status, body))

# 2) 新增学生：非法初始积分必须被拒（原先可直接入库）
status, body = call("POST", "/students", {
    "name": "负数生", "studentNo": "S001", "className": "高一1班", "initialPoints": -5
}, token)
check("初始积分 -5 被拒", status == 400 and body.get("code") == "INVALID_POINTS", (status, body))

status, body = call("POST", "/students", {
    "name": "张三", "studentNo": "S001", "className": "高一1班", "initialPoints": 10
}, token)
student_id = (body.get("data") or {}).get("id")
check("新增学生成功", status == 200 and student_id is not None, (status, body))

# 3) 幂等：同一个 requestId 提交两次，只加一次
payload = {"amount": 10, "reason": "课堂表现", "requestId": "req-fixed-1"}
s1, b1 = call("POST", f"/students/{student_id}/points", payload, token)
s2, b2 = call("POST", f"/students/{student_id}/points", payload, token)
total_after_idem = (b2.get("data") or {}).get("totalPoints")
check("同一 requestId 只记一次账", s1 == 200 and s2 == 200 and total_after_idem == 20,
      (s1, b1, s2, b2))

# 4) 并发：两个不同请求同时加 5，都不能 500，且结果必须是 30
def bump(i):
    return call("POST", f"/students/{student_id}/points",
                {"amount": 5, "reason": "并发", "requestId": f"concurrent-{i}"}, token)

with ThreadPoolExecutor(max_workers=2) as pool:
    outs = list(pool.map(bump, [1, 2]))
codes = sorted(o[0] for o in outs)
status, body = call("GET", f"/students/{student_id}/points", token=token)
final_total = (body.get("data") or {}).get("student", {}).get("totalPoints")
check("并发加分不报 500", codes == [200, 200], outs)
check("并发加分结果正确（10+10+5+5=30）", final_total == 30, final_total)
ledger = (body.get("data") or {}).get("ledger", [])
# 1 条 INIT（初始积分 10）+ 1 条「课堂表现」+ 2 条并发 = 4；幂等那次没有重复记
check("流水条数为 4（含 INIT，幂等的那次没重复记）", len(ledger) == 4, len(ledger))
check("「课堂表现」只记了一笔",
      sum(1 for item in ledger if item.get("bizType") == "课堂表现") == 1,
      [item.get("bizType") for item in ledger])

# 5) 参数类型错误不再是 500
status, body = call("GET", "/students/abc/points", token=token)
check("路径参数类型错误返回 400", status == 400 and body.get("code") == "INVALID_PARAMETER",
      (status, body))

# 6) 不存在的接口是 404，不能返回 index.html
status, body = call("GET", "/no-such-endpoint", token=token)
check("未知接口返回 404", status == 404, (status, body))

# 7) 游戏不存在 → 404（原来是 400）
status, body = call("GET", "/store/games/not_a_game/cover")
check("封面取不存在的游戏返回 404", status == 404, (status, body))

# 8) 票据接口：未登录拿不到票据
status, body = call("POST", "/play-ticket/demo/1.0.0")
check("未登录签发票据返回 401", status == 401, (status, body))

# 9) 票据接口：已登录但游戏没装 → GAME_NOT_FOUND / GAME_NOT_INSTALLED
status, body = call("POST", "/play-ticket/not_a_game/1.0.0", token=token)
check("未安装游戏不签发票据", status in (400, 404) and body.get("code") in
      ("GAME_NOT_FOUND", "GAME_NOT_INSTALLED"), (status, body))

# 10) 班级：只有班委没有学生也要能删
status, body = call("PUT", "/classes/monitor",
                    {"className": "高二2班", "monitorName": "李四"}, token)
check("设置班委成功", status == 200, (status, body))
status, body = call("DELETE", "/classes?className=%E9%AB%98%E4%BA%8C2%E7%8F%AD", token=token)
check("空班级可以删除", status == 200, (status, body))

# 11) Content-Type 写错 → 415，不是兜底 500
#     用已登录的 multipart 接口：注册时把 Content-Type 发成 form-urlencoded。
req = urllib.request.Request(BASE + "/store/games/demo/package-install",
                             data=b"a=1", method="POST")
req.add_header("Content-Type", "application/x-www-form-urlencoded")
req.add_header("Authorization", "Bearer " + token)
try:
    with urllib.request.urlopen(req, timeout=20) as resp:
        status, body = resp.status, json.loads(resp.read().decode() or "{}")
except urllib.error.HTTPError as err:
    raw = err.read().decode()
    try:
        status, body = err.code, json.loads(raw or "{}")
    except json.JSONDecodeError:
        status, body = err.code, {"raw": raw[:200]}
check("Content-Type 不支持返回 415", status == 415 and body.get("code") ==
      "UNSUPPORTED_MEDIA_TYPE", (status, body))

failed = [r for r in results if not r[1]]
print()
print(f"共 {len(results)} 项，失败 {len(failed)} 项")
