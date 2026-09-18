/**
 * 界面背景主题。
 *
 * 只有两套底色：paper（米黄纸张，历史默认）与 white（纯白）。
 * 实现方式很薄：把主题名写到 <html data-theme="...">,
 * 样式表里用 :root[data-theme="white"] 覆盖 --paper / --paper-dim 两个变量，
 * 其余设计令牌（ink / pink / blue / orange / green）保持不变，
 * 所以切换主题不会影响任何组件的尺寸、间距或对比层级。
 *
 * 存储键与 index.html 里的首屏内联脚本共用，改名字要同时改两处。
 */
export type Theme = "paper" | "white";

const THEME_STORAGE_KEY = "eduplay.theme";

/** 读取本机保存的主题，缺省为米黄纸张。 */
export function readStoredTheme(): Theme {
  return localStorage.getItem(THEME_STORAGE_KEY) === "white" ? "white" : "paper";
}

/** 把主题写到 <html data-theme>，样式表据此覆盖 CSS 变量。 */
export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}

/** 保存并立即应用。 */
export function saveTheme(theme: Theme) {
  localStorage.setItem(THEME_STORAGE_KEY, theme);
  applyTheme(theme);
}
