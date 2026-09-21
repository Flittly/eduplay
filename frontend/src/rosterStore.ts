import { useSyncExternalStore } from "react";

/**
 * 名单的「变更版本号」。
 *
 * ## 它解决的是什么问题
 *
 * 浮窗随机点名（`components/FloatingPick.tsx`）挂在 `AppLayout` 上，**登录后只挂载一次、
 * 跨路由不卸载** —— 这正是它「进度跨路由保留」的实现方式，是个有意的特性。
 *
 * 代价是：它在挂载那一刻取到的班级列表会一直沿用下去。老师导入完学生名单、回到课堂点开浮窗，
 * 班级下拉里还是只有「全部班级」，**必须重新登录**才能看到新班级 ——
 * 因为重新登录会把 `AppLayout` 连同浮窗整个卸载重建，token 也变了，取数 effect 才重跑。
 *
 * 而整页版 `/tools/random-pick` 看不到这个问题（每次进页面都重新挂载、重新取数），
 * 所以这个 bug 只出现在浮窗上。
 *
 * ## 做法
 *
 * 给「名单」加一个单调递增的版本号：谁改了名单就 `bumpRoster()` 一下，
 * 正在监听的取数逻辑（`hooks/useRandomPick.ts`）把版本号放进 useEffect 依赖里，于是自动重取。
 *
 * ⚠️ **bump 的调用点放在 `api.ts` 的写操作里，而不是各个页面里。**
 * 页面是"会不断新增"的地方，漏调一处这个 bug 就重新长出来；而 `api.ts` 是改名单的必经之路，
 * 放在那里就不会被忘掉。
 */

let version = 0;
const listeners = new Set<() => void>();

/** 名单发生变更（导入名单 / 增删改学生 / 删班级）后调用。 */
export function bumpRoster(): void {
  version += 1;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): number {
  return version;
}

/** 订阅名单版本号：它一变，调用方的取数 effect 就会重跑。 */
export function useRosterVersion(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * 包一层写操作，**只有请求成功之后**才 bump —— 失败不该让别处白刷一次。
 *
 * 用法：`return invalidateRosterAfter(request<Student>("/students", { ... }))`
 */
export function invalidateRosterAfter<T>(promise: Promise<T>): Promise<T> {
  return promise.then((value) => {
    bumpRoster();
    return value;
  });
}
