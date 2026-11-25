"""插件票据链路的端到端验证：建游戏 → 上传包 → 兑换 → 安装 → 签发票据 → 取资源。"""
import io
import json
import time
import urllib.error
import urllib.request
import uuid
import zipfile

BASE = "http://127.0.0.1:17081/api/v1"
results = []


def call(method, path, body=None, token=None, raw=None, content_type=None):
    data = raw if raw is not None else (None if body is None else json.dumps(body).encode())
    req = urllib.request.Request(BASE + path, data=data, method=method)
    if body is not None:
        req.add_header("Content-Type", "application/json")
    if content_type:
        req.add_header("Content-Type", content_type)
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            payload = resp.read()
            try:
                return resp.status, json.loads(payload.decode()), dict(resp.headers)
            except (json.JSONDecodeError, UnicodeDecodeError):
                return resp.status, payload, dict(resp.headers)
    except urllib.error.HTTPError as err:
        raw_body = err.read().decode(errors="replace")
        try:
            return err.code, json.loads(raw_body or "{}"), dict(err.headers)
        except json.JSONDecodeError:
            return err.code, {"raw": raw_body[:200]}, dict(err.headers)


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else "  -> " + str(detail)))


# 每次跑用唯一 gameCode：脚本要能重复执行（第二次跑时同名会被正确拒绝）
game_code = "smoke_" + str(int(time.time() * 1000) % 1000000)

# ---- 管理端 ----
status, body, _ = call("POST", "/admin/login", {"username": "admin", "password": "admin123"})
admin_token = (body.get("data") or {}).get("token")
check("管理员登录", status == 200 and bool(admin_token), (status, body))

status, body, _ = call("POST", "/admin/games", {
    "gameCode": game_code, "name": "冒烟游戏", "description": "测试用", "priceCents": 0
}, admin_token)
check("创建游戏", status == 200, (status, body))

# 非法 gameCode 必须被拒（原来可以建出 URL 取不到的游戏）
status, body, _ = call("POST", "/admin/games", {
    "gameCode": "非法 名称/1", "name": "坏代码", "priceCents": 0
}, admin_token)
check("非法 gameCode 被拒", status == 400 and body.get("code") == "INVALID_GAME_CODE", (status, body))

# 打包一个最小插件包
manifest = {
    "gameCode": game_code, "version": "1.0.0", "name": "冒烟游戏",
    "entry": "index.html", "description": "测试用",
    "tags": {"grades": ["高一"], "topics": ["冒烟"]}
}
buf = io.BytesIO()
with zipfile.ZipFile(buf, "w") as zf:
    zf.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False))
    zf.writestr("index.html", "<html><body>smoke</body></html>")
    zf.writestr("cover.svg", "<svg xmlns='http://www.w3.org/2000/svg'/>")
package_bytes = buf.getvalue()

boundary = "----smoke" + uuid.uuid4().hex
parts = (
    f"--{boundary}\r\n"
    'Content-Disposition: form-data; name="file"; filename="smoke_game-1.0.0.zip"\r\n'
    "Content-Type: application/zip\r\n\r\n"
).encode() + package_bytes + f"\r\n--{boundary}--\r\n".encode()

status, body, _ = call("POST", f"/admin/games/{game_code}/packages", token=admin_token,
                       raw=parts, content_type=f"multipart/form-data; boundary={boundary}")
check("上传插件包", status == 200, (status, body))

status, body, _ = call("POST", "/admin/codes/generate", {"gameCode": game_code, "count": 1}, admin_token)
code = ((body.get("data") or [{}])[0]).get("code")
check("生成激活码", status == 200 and bool(code), (status, body))

# 为不存在的游戏生成激活码必须被拒（原来会造废码）
status, body, _ = call("POST", "/admin/codes/generate", {"gameCode": "no_such_game", "count": 1}, admin_token)
check("为不存在的游戏生成激活码被拒",
      status in (400, 404) and body.get("code") == "GAME_NOT_FOUND", (status, body))

# 管理端游戏列表：安装数与版本数不再是 0 / 真实统计
status, body, _ = call("GET", "/admin/games", token=admin_token)
row = next((g for g in (body.get("data") or []) if g.get("gameCode") == game_code), None)
check("游戏列表包含新游戏且版本数为 1",
      status == 200 and row is not None and row.get("packageVersionCount") == 1,
      row)

# ---- 教师端 ----
user = "plug" + str(int(time.time() * 1000) % 1000000)
status, body, _ = call("POST", "/auth/local/register", {
    "username": user, "password": "smoke123456", "nickname": "插件老师"
})
teacher_token = (body.get("data") or {}).get("token")
check("注册教师", status == 200 and bool(teacher_token), (status, body))

# 未兑换不能下载包（原来任何教师都能拿走）
status, body, _ = call("GET", f"/store/games/{game_code}/package", token=teacher_token)
check("未兑换不能下载包",
      status in (400, 403) and body.get("code") == "ENTITLEMENT_REQUIRED", (status, body))

status, body, _ = call("POST", "/store/redeem", {"code": code}, teacher_token)
check("兑换激活码", status == 200, (status, body))

# 再次兑换同一个码 → 明确的业务错误，不是 500
status, body, _ = call("POST", "/store/redeem", {"code": code}, teacher_token)
check("重复兑换返回业务错误", status == 400 and body.get("code") in
      ("CODE_ALREADY_USED", "ALREADY_OWNED"), (status, body))

status, body, _ = call("POST", f"/store/games/{game_code}/install", token=teacher_token)
check("安装游戏", status == 200, (status, body))

status, body, _ = call("POST", f"/play-ticket/{game_code}/1.0.0", token=teacher_token)
ticket = (body.get("data") or {}).get("ticket")
check("签发游戏票据", status == 200 and bool(ticket), (status, body))

status, body, headers = call("GET", f"/plugin/{ticket}/{game_code}/1.0.0/index.html")
check("用票据取插件资源", status == 200 and b"smoke" in (body if isinstance(body, bytes) else b""),
      status)
cache_control = headers.get("Cache-Control", "")
check("插件资源可长缓存（不再是 no-store）",
      "immutable" in cache_control and "no-store" not in cache_control, cache_control)

# 主登录 token 不能再当插件凭证用（这就是原先的泄漏面）
status, body, _ = call("GET", f"/plugin/{teacher_token}/{game_code}/1.0.0/index.html")
check("主 token 不能读取插件资源", status == 401, (status, body))

# 票据不能跨版本使用
status, body, _ = call("GET", f"/plugin/{ticket}/{game_code}/9.9.9/index.html")
check("票据不能跨版本使用", status in (400, 403), (status, body))

# 卸载后票据立即失效
status, body, _ = call("POST", f"/store/games/{game_code}/uninstall", token=teacher_token)
check("卸载游戏", status == 200, (status, body))
status, body, _ = call("GET", f"/plugin/{ticket}/{game_code}/1.0.0/index.html")
check("卸载后旧票据失效", status in (400, 404) and body.get("code") in
      ("GAME_NOT_INSTALLED", "GAME_NOT_FOUND"), (status, body))

failed = [r for r in results if not r[1]]
print()
print(f"共 {len(results)} 项，失败 {len(failed)} 项")
