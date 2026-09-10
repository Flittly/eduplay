import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode
} from "react";

export type Language = "zh" | "en";

const LANG_STORAGE_KEY = "eduplay.language";

type Dict = Record<string, string>;

const dictionaries: Record<Language, Dict> = {
  zh: {
    // 侧边栏导航
    "nav.games": "游戏中心",
    "nav.store": "游戏商城",
    "nav.points": "学生积分",
    "nav.students": "学生管理",
    "nav.classes": "班级管理",
    "nav.tools": "工具箱",
    "nav.settings": "设置",
    "nav.logout": "退出登录",
    "nav.about": "关于平台",
    "role.teacher": "教师",
    "role.student": "学生",

    // 设置页
    "settings.kicker": "Settings",
    "settings.title": "设置",
    "settings.subtitle": "管理平台偏好与运行参数",
    "settings.section.general": "通用",
    "settings.language": "界面语言",
    "settings.language.hint": "界面语言切换后立即生效；各业务页面将逐步支持英文。",
    "settings.section.plugins": "游戏安装位置",
    "settings.plugins.current": "当前目录",
    "settings.plugins.hint":
      "修改后会把已安装的游戏整体迁移到新目录，保存即生效，无需重启。打包版桌面应用每次启动会自动选一个空闲端口，不受此目录影响。",
    "settings.plugins.save": "保存并迁移",
    "settings.plugins.saving": "迁移中…",
    "settings.plugins.done": "已迁移到新目录",
    "settings.section.info": "平台信息",
    "settings.info.version": "平台版本",
    "settings.info.port": "本地服务端口",
    "settings.info.db": "游戏数据库文件",
    "settings.info.cloud": "云端服务状态",
    "settings.cloud.online": "在线",
    "settings.cloud.offline": "离线",
    "settings.cloud.checking": "检测中…",
    "settings.section.cloud": "云端服务",
    "settings.cloud.url": "云端服务地址",
    "settings.cloud.hint":
      "当前未购买服务器，商城功能暂不可用。将来部署云端服务器后，在此填写其 IP:端口或域名（如 http://192.168.1.100:17070 或 https://shop.example.com），保存后商城、激活码等云端请求将指向该地址并立即生效。",
    "settings.cloud.save": "保存云端地址",
    "settings.cloud.saved": "云端地址已保存",
    "settings.section.data": "数据与隐私",
    "settings.data.clear": "清除记住的登录密码",
    "settings.data.cleared": "已清除本机保存的登录密码",
    "settings.data.hint":
      "删除本机自动填写的本地与云端登录密码。清除后需重新输入密码登录。",
    "settings.section.about": "关于",
    "settings.message.saved": "设置已保存",
    "settings.message.failed": "操作失败"
  },
  en: {
    "nav.games": "Game Center",
    "nav.store": "Game Store",
    "nav.points": "Student Points",
    "nav.students": "Students",
    "nav.classes": "Classes",
    "nav.tools": "Toolbox",
    "nav.settings": "Settings",
    "nav.logout": "Log out",
    "nav.about": "About",
    "role.teacher": "Teacher",
    "role.student": "Student",

    "settings.kicker": "Settings",
    "settings.title": "Settings",
    "settings.subtitle": "Manage preferences and runtime options",
    "settings.section.general": "General",
    "settings.language": "Interface language",
    "settings.language.hint":
      "Applies immediately. Other pages will be localized progressively.",
    "settings.section.plugins": "Game install location",
    "settings.plugins.current": "Current folder",
    "settings.plugins.hint":
      "Installed games will be moved to the new folder. Takes effect immediately, no restart needed. The packaged desktop app always picks a free port at startup, unaffected by this folder.",
    "settings.plugins.save": "Save & move",
    "settings.plugins.saving": "Moving…",
    "settings.plugins.done": "Moved to the new folder",
    "settings.section.info": "Platform info",
    "settings.info.version": "Platform version",
    "settings.info.port": "Local server port",
    "settings.info.db": "Game database file",
    "settings.info.cloud": "Cloud service",
    "settings.cloud.online": "Online",
    "settings.cloud.offline": "Offline",
    "settings.cloud.checking": "Checking…",
    "settings.section.cloud": "Cloud service",
    "settings.cloud.url": "Cloud server address",
    "settings.cloud.hint":
      "No server is deployed yet, so the store is unavailable. Once your cloud server is up, enter its IP:port or domain (e.g. http://192.168.1.100:17070 or https://shop.example.com). Store and activation-code requests will target it immediately after saving.",
    "settings.cloud.save": "Save cloud address",
    "settings.cloud.saved": "Cloud address saved",
    "settings.section.data": "Data & privacy",
    "settings.data.clear": "Clear remembered passwords",
    "settings.data.cleared": "Saved passwords on this device were cleared",
    "settings.data.hint":
      "Removes locally remembered local & cloud login passwords. You will need to type the password again next time.",
    "settings.section.about": "About",
    "settings.message.saved": "Settings saved",
    "settings.message.failed": "Operation failed"
  }
};

function readStoredLanguage(): Language {
  const raw = localStorage.getItem(LANG_STORAGE_KEY);
  return raw === "en" ? "en" : "zh";
}

interface LanguageContextValue {
  lang: Language;
  setLang: (lang: Language) => void;
  t: (key: string) => string;
}

const LanguageContext = createContext<LanguageContextValue>({
  lang: "zh",
  setLang: () => undefined,
  t: (key) => dictionaries.zh[key] ?? key
});

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>(readStoredLanguage);

  const setLang = useCallback((next: Language) => {
    setLangState(next);
    localStorage.setItem(LANG_STORAGE_KEY, next);
  }, []);

  const t = useCallback(
    (key: string) => dictionaries[lang][key] ?? dictionaries.zh[key] ?? key,
    [lang]
  );

  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useTranslation() {
  return useContext(LanguageContext);
}
