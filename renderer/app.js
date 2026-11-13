/* 钉钉外壳 —— 交互层 + 真实内容接入
   - 中栏会话列表：优先用 webview 内抓到的真实话题，抓不到才用演示数据
   - 点击会话：webview 跳到该话题详情页（Discourse 帖子流天然像聊天消息）
   - 各站注入 CSS 隐藏网站自带顶栏/侧栏，只留内容主体 */

/* 原版钉钉的默认头像全部是蓝色系底 + 白色单字，不再出现绿 / 紫 / 橙等杂色。
   这里只做明度与色相的细微梯度，保证一眼看过去「都是蓝的」。 */
const PALETTE = ["#0089FF", "#2F7FF0", "#3C7EFF", "#1E6FD9", "#4A93E8",
  "#0B84F3", "#5A8DEE", "#2277E0", "#1885F5", "#3479D8"];
function blueOf(i) { return PALETTE[((i % PALETTE.length) + PALETTE.length) % PALETTE.length]; }

const SITES = {
  linuxdo: {
    name: "linux.do",
    url: "https://linux.do/",
    loginUrl: "https://linux.do/",
    css: `
      .d-header, .sidebar-wrapper, .sidebar-container, .header-clearance,
      .topic-list-categories, .category-list, #navigation-bar, .list-controls { display:none !important; }
      #main-outlet { padding: 12px 20px !important; margin: 0 !important; max-width: 100% !important; }
      .topic-list { width: 100% !important; }
      body { background: #FFFFFF !important; }
    `,
    demo: [
      { n: "华电南方区域", d: "魏华政: http://pxclus...", t: "11-06", tag: "内部群" },
      { n: "赵炯轩", d: "喔喔，那我写一下", t: "11:05" },
      { n: "陈俊业 Insane", d: "[已读]有bug吧 你检...", t: "11:06" },
      { n: "149测试环境", d: "[@所有人]阿坤：【算...", t: "11:06", tag: "内部群", b: "1" },
      { n: "【日报】算法组", d: "自定义: [P1] 无实际...", t: "11:05", tag: "内部群", b: "2" },
      { n: "林文燕", d: "上线提到这几个比...", t: "11:01" },
      { n: "工作通知·北京", d: "张泽彪: 极速打卡·成功", t: "09:26", tag: "内部群" },
    ],
  },
  zhihu: {
    name: "知乎",
    url: "https://www.zhihu.com/",
    loginUrl: "https://www.zhihu.com/signin",
    css: `
      .AppHeader, .ColumnPageHeader, .TopstorySideBar, .TopstorySideBar-corner,
      .TopstoryHeader, .QuestionHeader-side, .CornerButtons { display:none !important; }
      .TopstoryMainColumn, .Question-mainColumn, .Question-main { width:100% !important; max-width:100% !important; margin:0 !important; float:none !important; }
      .Topstory-container, .QuestionPage { max-width:100% !important; padding:0 20px !important; }
      body { background:#FFFFFF !important; }
    `,
    demo: [
      { n: "技术方案沉淀", d: "把上次的架构图补上", t: "11:02", tag: "内部群", b: "2" },
      { n: "行业研究 · 季度", d: "竞品数据已更新", t: "10:30" },
      { n: "新人培训材料", d: "第三章需要补充示例", t: "昨天", tag: "内部群" },
      { n: "客户案例整理", d: "已收到 5 份授权", t: "昨天" },
      { n: "知识库巡检", d: "有 12 篇待归档", t: "周一" },
    ],
  },
  x: {
    name: "X",
    url: "https://x.com/home",
    loginUrl: "https://x.com/i/flow/login",
    css: `
      header[role="banner"], [data-testid="sidebarColumn"], [data-testid="primaryColumn"] > div > div:first-child > div:first-child { display:none !important; }
      [data-testid="primaryColumn"] { width:100% !important; max-width:100% !important; border:0 !important; }
      body { background:#FFFFFF !important; }
    `,
    demo: [
      { n: "增长数据看板", d: "本周环比 +12%", t: "10:45", tag: "内部群", b: "5" },
      { n: "投放素材 A/B", d: "B 组转化更好", t: "09:20" },
      { n: "竞品监测", d: "新增 3 条动态", t: "昨天" },
      { n: "内容排期", d: "下周三篇待发", t: "昨天" },
      { n: "舆情日报", d: "无异常", t: "周一" },
    ],
  },
  xhs: {
    name: "小红书",
    url: "https://www.xiaohongshu.com/explore",
    loginUrl: "https://www.xiaohongshu.com/explore",
    css: `
      .header, .side-bar, .channel-container, .feeds-page .side-bar,
      .feeds-page .channel-container { display:none !important; }
      .main-content, .feeds-page { margin-left:0 !important; padding:0 16px !important; }
      body { background:#FFFFFF !important; }
    `,
    demo: [
      { n: "品牌素材库", d: "新增 24 张主图", t: "11:15", tag: "内部群", b: "8" },
      { n: "达人合作", d: "本周寄样 6 份", t: "10:08" },
      { n: "选品会", d: "周四下午两点", t: "昨天" },
      { n: "笔记数据复盘", d: "爆文率 3.2%", t: "昨天" },
      { n: "客服反馈", d: "物流问题集中", t: "周一" },
    ],
  },
};

const NAV = [
  { label: "千问办公", icon: "i-ai" },
  { label: "消息", icon: "i-msg", badge: "99+", site: "zhihu" },
  { label: "会议", icon: "i-meet" },
  { label: "AI 听记", icon: "i-listen" },
  { label: "日历", icon: "i-cal" },
  { label: "文档", icon: "i-doc", site: "linuxdo" },
  { label: "AI 表格", icon: "i-sheet", site: "x" },
  { label: "工作台", icon: "i-app", site: "xhs" },
  { label: "通讯录", icon: "i-book" },
  { label: "待办", icon: "i-todo" },
  { label: "更多", icon: "i-more" },
];

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36";

const frame = document.getElementById("frame");
const loading = document.getElementById("loading");
const railItems = document.getElementById("railItems");
const convList = document.getElementById("convList");
const chatTitle = document.getElementById("chatTitle");
const chatSub = document.getElementById("chatSub");
const chatCount = document.getElementById("chatCount");
const newmsg = document.getElementById("newmsg");
const chatView = document.getElementById("chatView");
const chatBody = document.querySelector(".chat-body");
const viewSwitch = document.getElementById("viewSwitch");

let current = null;
let activeConv = 0;
let tabMode = "all";
const liveConvs = {};   // { siteKey: [conv] } 真实抓到的数据
const topicFull = {};   // { 话题 url: { state, title, posts, text } } 自动展开的全部楼层
let topicOpened = false;      // 主 webview 当前停在某个话题详情页
const autoOpened = {};       // 每个站点同步成功后自动展开首条，仅一次
const COMMENTS_KEY = "dingtalk-shell-comments";
let myComments = {};    // { 话题 url: [{ text, time, ts }] } 我从底部输入框发的评论
try {
  myComments = JSON.parse(localStorage.getItem(COMMENTS_KEY) || "{}") || {};
  // 清掉自动化验证时留下的测试评论，保证交付界面是干净的
  let dirty = false;
  for (const k of Object.keys(myComments)) {
    if (!Array.isArray(myComments[k])) { delete myComments[k]; dirty = true; continue; }
    const kept = myComments[k].filter((m) => m && m.text !== "test comment from me");
    if (kept.length !== myComments[k].length) dirty = true;
    if (kept.length) myComments[k] = kept;
    else { delete myComments[k]; dirty = true; }
  }
  if (dirty) localStorage.setItem(COMMENTS_KEY, JSON.stringify(myComments));
} catch (_) { myComments = {}; }

/* 已读会话：点开过就变灰、消掉未读点，跟真钉钉的会话列表一致 */
const READ_KEY = "dingtalk-shell-read";
let readSet = {};
try { readSet = JSON.parse(localStorage.getItem(READ_KEY) || "{}") || {}; } catch (_) { readSet = {}; }
function markRead(c) {
  if (!c) return;
  readSet[convKey(c)] = 1;
  try { localStorage.setItem(READ_KEY, JSON.stringify(readSet)); } catch (_) {}
}

const esc = (s) =>
  String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );

/* 站点 JSON / 摘要里常夹着未解码的 HTML 实体，直接显示会出现 &hellip; 这类字面量 */
function decodeEnt(s) {
  return String(s == null ? "" : s)
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&hellip;|&#8230;/gi, "…")
    .replace(/&mdash;|&#8212;/gi, "—")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&lt;|&#60;/gi, "<")
    .replace(/&gt;|&#62;/gi, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;|&#38;/gi, "&");
}

/* Electron 的 <webview> 在 DOMContentLoaded 时内部尚未初始化完，
   此时改 src / 调 loadURL 会被丢弃。必须等首次 dom-ready 后再导航。 */
let webviewReady = false;
let pendingNav = null;

function navigateFrame(url) {
  if (!webviewReady) { pendingNav = url; return; }
  // 只发一次导航：同时设 src 又调 loadURL 会互相 ABORT（ERR_ABORTED -3）。
  // dom-ready 之后改 src 是上一版已验证有效的路径。
  frame.src = url;
}

function activeList() {
  const site = SITES[current];
  const live = liveConvs[current];
  return live && live.length ? live : site.demo;
}

function renderRail() {
  railItems.innerHTML = NAV.map(
    (n) => `
    <button class="rail-item ${n.site && n.site === current ? "active" : ""}" ${n.site ? `data-site="${n.site}"` : 'data-decor="1"'} title="${n.label}">
      <svg class="ic"><use href="#${n.icon}"/></svg>
      <span class="label">${n.label}</span>
      ${n.badge ? `<span class="rail-badge">${n.badge}</span>` : ""}
    </button>`
  ).join("");

  railItems.querySelectorAll(".rail-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!btn.dataset.site) return;
      // 点已选中的站点 = 回到该站首页列表
      if (btn.dataset.site === current) {
        activeConv = 0;
        stopCapture();
        topicOpened = false;
        loadSite(current, true);
        renderConvs();
        syncChatHead();
      } else {
        selectSite(btn.dataset.site);
      }
    });
  });
}

/* ---------- 掩饰模式：把左栏聊天备注 / 会话名 / 头像换成工作群聊外观 ----------
   只作用于「聊天外壳」这一层，右栏正文依然是能读到底的真实全文；
   按话题链接稳定取值，重绘、重启都不会跳变；顶部「掩饰」按钮可一键看回真实内容。
   词库与组合方式参考原项目的「伪装标题 / 伪装头像」。 */
const MASK_KEY = "dingtalk-shell-mask";
let maskOn = true;
try {
  const v = localStorage.getItem(MASK_KEY);
  maskOn = v === null ? true : v === "1";
} catch (_) {}

const MASK_ORGS = ["产品", "研发", "设计", "运营", "市场", "销售", "财务", "人力", "法务", "客服", "数据", "增长"];
const MASK_OBJS = ["需求", "方案", "进度", "指标", "预算", "版本", "活动", "合同", "报表", "问题", "排期", "复盘"];
const MASK_ACTS = ["同步群", "评审会", "对齐会", "周会", "跟进群", "值班群", "项目组", "讨论组", "协作群", "拉通会"];
const MASK_TITLES = [
  "产品需求评审", "本周工作同步", "技术方案讨论", "项目进度对齐", "线上问题排查",
  "发版 Checklist", "设计稿确认", "客户反馈跟进", "OKR 季度对齐", "数据报表复核",
  "运营活动排期", "合同条款评审", "预算审批沟通", "招聘面试安排", "安全合规检查",
  "接口联调纪要", "周会待办汇总", "版本回归测试", "供应商比价", "权限申请流程",
  "内容选题讨论", "监控告警复盘", "培训材料更新", "绩效面谈准备", "跨组协作排期",
  "需求优先级排序", "灰度发布观察", "客服工单升级", "品牌物料确认", "财报数据核对",
  "会议室预约冲突", "出差行程确认", "法务意见回复", "新员工 onboarding", "依赖升级评估",
  "压测结果同步", "埋点方案评审", "SLA 达标复盘", "渠道投放优化", "库存预警处理",
];
const MASK_WHO = ["李工", "王经理", "张伟", "陈敏", "刘洋", "赵磊", "周婷", "吴昊",
  "徐静", "孙宇", "何欣", "郭强", "小林", "老周", "郑工", "杨主管"];
const MASK_LINES = [
  "收到，我这边同步一下", "方案已更新，麻烦看下", "下午三点会议室过一下",
  "这个我跟进，晚点给你结论", "好的，按这版推进", "数据我核对完了，没问题",
  "文档已上传到群文件", "稍等，我确认下再回复", "辛苦了，明天上线前再对一次",
  "已转给相关同事跟进", "这里的口径再统一一下", "刚开了个会，晚点补结论",
  "我改好了，帮忙复核下", "这版先按计划发吧", "没问题，我这边配合",
  "刚才那条我补充两句", "进度我更新到表里了", "有变化随时在群里说",
];
const MASK_SYS = ["[图片]", "[文件] 会议纪要.docx", "[语音] 12″", "[有人@我] 麻烦确认下这版",
  "对方撤回了一条消息", "[位置] 公司 3 号会议室", "[链接] 本周排期表", "[表情]"];
const MASK_TAGS = ["内部群", "项目群", "部门群", "讨论组"];
const MASK_NOTICE_TITLES = [
  "【群公告】本周工作同步", "【群公告】项目排期调整", "【群公告】协作方式说明",
  "【群公告】评审安排通知", "【群公告】版本发布提醒", "【群公告】资料归档要求",
];
const MASK_NOTICES = [
  "各位好，本群用于日常需求对齐与问题跟进。请在周五前把进度更新到协作表，重要结论沉淀到群文件，有阻塞随时在群里同步。",
  "本周起例会改为每周二、周四下午三点，会议纪要当天发到群里；议题请提前一天补充到排期表。",
  "请大家把方案、数据口径和最终结论统一放到群文档，聊天里只做快速对齐；@所有人 收到请回复。",
  "新版本灰度期间如发现异常，请附截图、复现步骤和环境信息发到本群，值班同学会第一时间跟进。",
  "项目资料统一按「日期-模块-负责人」命名归档，历史版本不要覆盖，有问题在群里找管理员。",
  "本周五前完成各自模块自测与交叉复核，发版 Checklist 已上传群文件，完成后请在文档里勾一下。",
];
/* 群头像里每一格同样只能是蓝底白单字，颜色统一取自 blueOf / PALETTE */
const AVATAR_SURNAMES = ["李", "王", "张", "陈", "刘", "赵", "周", "吴", "徐", "孙", "郑", "杨", "何", "郭", "林", "黄"];

function hashKey(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/* 原版钉钉头像：单聊=蓝底白色单字；群聊=2×2 / 3×3 个「蓝底白单字」方块拼接。
   无论掩饰开关，头像都走这一套，切换时不会跳变。 */
function avatarHtmlFor(c, label) {
  const seed = hashKey(convKey(c));
  const grid = (seed % 5) < 3;
  const cellsN = (seed >>> 4) % 2 ? 4 : 9;
  if (grid) {
    let cells = "";
    for (let i = 0; i < cellsN; i++) {
      cells += `<span style="background:${blueOf(seed + i * 3)}">` +
        AVATAR_SURNAMES[(seed + i * 7) % AVATAR_SURNAMES.length] + "</span>";
    }
    return { grid: true, html: `<span class="avatar-grid${cellsN === 4 ? " cols2" : ""}">${cells}</span>` };
  }
  return { grid: false, html: esc(String(label || c.n || "?").replace(/[【】·]/g, "").slice(0, 1) || "?") };
}

function maskData(c) {
  const seed = hashKey(convKey(c));
  const org = MASK_ORGS[seed % MASK_ORGS.length];
  const obj = MASK_OBJS[(seed >>> 3) % MASK_OBJS.length];
  const act = MASK_ACTS[(seed >>> 7) % MASK_ACTS.length];
  const name = (seed % 2 === 0)
    ? (seed >>> 11) % 3 === 0 ? `【${org}】${obj}${act}` : `${org}·${obj}${act}`
    : MASK_TITLES[(seed >>> 5) % MASK_TITLES.length];
  const sys = (seed >>> 13) % 5 === 0;
  const note = sys
    ? MASK_SYS[(seed >>> 7) % MASK_SYS.length]
    : MASK_WHO[(seed >>> 9) % MASK_WHO.length] + "：" +
      MASK_LINES[(seed >>> 3) % MASK_LINES.length];
  const av = avatarHtmlFor(c, name);
  return {
    name, note, grid: av.grid, avatarHtml: av.html,
    avatar: name.replace(/[【】·]/g, "").slice(0, 1),
    tag: MASK_TAGS[seed % MASK_TAGS.length],
    noticeTitle: MASK_NOTICE_TITLES[(seed >>> 5) % MASK_NOTICE_TITLES.length],
    notice: MASK_NOTICES[(seed >>> 9) % MASK_NOTICES.length],
  };
}

/* 左栏「备注」包装：原始抓取文本里混着 markdown 符号、HTML 残留、阅读全文尾巴，
   直接铺上去不像会话预览。这里统一清成「作者：最后一条内容」的钉钉格式。 */
function cleanNote(s) {
  return decodeEnt(String(s == null ? "" : s))
    .replace(/<[^>]+>/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[….·\s]*阅读全文\s*$/g, "")
    .replace(/[*_`#>|~]/g, " ")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s:：,，、.。\-]+/g, "")
    .replace(/https?:\/\/\S+/gi, "[链接]")
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[邮箱]")
    .replace(/(^|[^\d])1[3-9]\d{9}(?!\d)/g, "$1[手机号]")
    .trim();
}

function convNote(c) {
  // 已展开全文：预览直接换成最后一层回复，跟真实 IM 的会话摘要一致
  const full = topicFull[convKey(c)];
  if (full && full.state === "ok" && full.posts && full.posts.length) {
    const last = full.posts[full.posts.length - 1];
    const body = cleanNote(last.text).slice(0, 46);
    return (last.user ? last.user + "：" : "") + (body || "查看 " + full.posts.length + " 条回复");
  }
  const author = c.author || "";
  let body = cleanNote(c.body || c.d || "");
  // 抓取器给的「点标题进入话题…」属于占位兜底，不是真实摘要，别铺到备注里
  if (/^点(标题|击|开)/.test(body) || /查看完整帖子与全部回复|查看完整正文/.test(body)) body = "";
  // 抓取器旧格式的 "作者: 内容" 前缀去掉，统一用中文全角冒号
  if (author && body.indexOf(author + ": ") === 0) body = body.slice(author.length + 2).trim();
  else if (author && body.indexOf(author + "：") === 0) body = body.slice(author.length + 1).trim();
  else body = body.replace(/^([^\s:：]{1,20}):\s*/, "$1：");
  if (!body) return (author ? author + "：" : "") +
    (c.posts ? c.posts + " 条回复" : "点击查看完整内容");
  return (author ? author + "：" : "") + body.slice(0, 46);
}

function convTime(c) {
  if (c.ts) {
    const d = new Date(c.ts);
    if (!isNaN(d.getTime())) {
      const now = new Date();
      if (d.toDateString() === now.toDateString()) return d.toTimeString().slice(0, 5);
      const y = new Date(now.getTime() - 86400000);
      if (d.toDateString() === y.toDateString()) return "昨天";
      return String(d.getMonth() + 1).padStart(2, "0") + "/" + String(d.getDate()).padStart(2, "0");
    }
  }
  return c.t || "";
}

function convTag(c) {
  if (c.tag) return c.tag;
  if (c.posts) return c.posts + " 楼";
  return ({ linuxdo: "话题", zhihu: "问答", x: "动态", xhs: "笔记" })[current] || "网页";
}

function renderConvs() {
  const all = activeList();
  const scroll = convList.scrollTop;
  const list = tabMode === "unread"
    ? all.filter((c) => c.b || (!readSet[convKey(c)] && c.url))
    : all;

  convList.innerHTML = list
    .map((c) => {
      const idx = all.indexOf(c);
      const read = !!readSet[convKey(c)];
      const m = maskOn ? maskData(c) : null;
      const av = avatarHtmlFor(c, m ? m.name : c.n);
      return `
    <div class="conv ${idx === activeConv ? "active" : ""} ${read ? "is-read" : ""}" data-idx="${idx}">
      <div class="conv-avatar${av.grid ? " is-grid" : ""}" style="background:${av.grid ? "#FFFFFF" : blueOf(idx)}">${av.html}</div>
      <div class="conv-body">
        <div class="conv-top">
          <div class="conv-name">${esc(m ? m.name : c.n)}</div>
          <div class="conv-time">${esc(convTime(c))}</div>
        </div>
        <div class="conv-bottom">
          <div class="conv-desc">${esc(m ? m.note : convNote(c))}</div>
          <span class="conv-tag">${esc(m ? m.tag : convTag(c))}</span>
        </div>
      </div>
      ${c.b ? `<span class="conv-badge">${esc(c.b)}</span>`
        : (!read && c.url ? `<span class="conv-dot"></span>` : "")}
    </div>`;
    })
    .join("");
  convList.scrollTop = scroll;

  convList.querySelectorAll(".conv").forEach((el) => {
    el.addEventListener("click", () => {
      stopCapture();
      activeConv = Number(el.dataset.idx);
      markRead(all[activeConv]);
      renderConvs();
      syncChatHead();
      // 参考原项目：选中会话就自动展开该话题的全部楼层，不需要再点「查看原文」
      openTopic(all[activeConv]);
    });
  });
}

function updateHead(cur, full) {
  if (!cur) return;
  const m = maskOn ? maskData(cur) : null;
  chatTitle.textContent = m ? m.name : cur.n;
  const n = full && full.state === "ok" && full.posts && full.posts.length
    ? full.posts.length : (cur.posts || 0);
  chatCount.textContent = n ? String(n) : "";
  chatSub.textContent = (n ? n + " 条回复 · " : "话题讨论 · ") +
    (m ? "内部讨论 · 工作空间" : "来自 " + (SITES[current] ? SITES[current].name : "网页"));
}

function syncChatHead() {
  const c = activeList()[activeConv];
  if (!c) return;
  updateHead(c, topicFull[convKey(c)]);
  renderChatView();
}

/* 右栏 = 当前话题的全部楼层回复 + 我自己的评论区。
   规则：别人发的内容一律靠左；只有从底部输入框主动发送，才会出现靠右的「我」气泡。 */
function cleanSummary(s) {
  return decodeEnt(String(s == null ? "" : s))
    .replace(/[….·\s]*阅读全文\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/* 小红书链接带一次性 xsec_token，缓存 key 要去掉它，否则同一笔记每次都算新会话 */
function convKey(c) {
  const u = c.url || c.n;
  try {
    const x = new URL(u);
    if (x.searchParams.has("xsec_token")) return x.origin + x.pathname;
  } catch (_) {}
  return u;
}

/* 群公告正文：掩饰时用工作公告，否则用话题的问题表述（首楼正文 / 抓取摘要） */
function noticeData(cur, full, m) {
  const first = full && full.state === "ok" && full.posts && full.posts[0];
  let raw = cleanNote(first ? (first.text || "") : (cur.body || cur.d || ""));
  if (/^点(标题|击|开)/.test(raw) || /查看完整帖子与全部回复|查看完整正文/.test(raw)) raw = "";
  if (!raw) raw = "这个话题的正文与全部回复已在下方按楼层展开，可直接往下阅读。";
  const original = raw.slice(0, 600);
  // 掩饰开启：公告主体是工作话术，原始问题表述折进「原始问题」一栏，随时可展开查
  return m ? { title: m.noticeTitle, text: m.notice, original }
    : { title: cur.n, text: original };
}

function renderChatView() {
  const list = activeList();
  const cur = list[activeConv] || list[0];
  if (!cur) return;
  const key = convKey(cur);
  const full = topicFull[key];
  const mine = myComments[key] || [];
  const site = SITES[current];
  const meName = readIdentity().name;
  const nl = (s) => esc(decodeEnt(s)).replace(/\n/g, "<br>");
  const bodyOf = (p) => p.html || nl(p.text || "(无正文)");
  updateHead(cur, full);

  /* 原版钉钉：消息流顶部是一条居中的灰色时间线「今天 14:28」 */
  const d = new Date();
  const clock = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  const suffix = maskOn || !site ? "" : " · " + esc(site.name);
  let html = `<div class="day-divider"><span>今天 ${clock}${suffix}</span></div>`;

  /* 参考钉钉：问题表述挂在群公告卡片里，不再当一条普通消息混在回复中。
     掩饰开启时公告同步换成工作群公告，点顶部「掩饰」即可看回原始问题。 */
  const notice = noticeData(cur, full, maskOn ? maskData(cur) : null);
  html += `
    <div class="group-notice">
      <span class="notice-badge"><svg class="ic"><use href="#i-megaphone"/></svg>群公告</span>
      <div class="notice-main">
        <div class="notice-title">${esc(notice.title)}</div>
        <div class="notice-text">${esc(notice.text)}</div>
        ${notice.original ? `<div class="notice-original"><b>原始问题</b>${esc(notice.original)}</div>` : ""}
      </div>
      ${(notice.text.length > 70 || notice.original)
        ? `<button class="notice-toggle" data-act="toggle-notice" data-label="${notice.original ? "原始问题" : "展开"}">${notice.original ? "原始问题" : "展开"}</button>`
        : ""}
    </div>`;

  if (full && full.state === "ok") {
    const posts = full.posts && full.posts.length
      ? full.posts
      : [{ user: cur.n, time: cur.t || "", text: full.text || "", html: full.html || "", floor: 0 }];
    posts.forEach((p, i) => {
      const color = blueOf(i + 1);
      html += `
      <div class="msg">
        <div class="msg-avatar" style="background:${color}">${esc(String(p.user || "?").slice(0, 1))}</div>
        <div class="msg-main wide">
          <div class="msg-meta"><span>${esc(p.user || "匿名")}</span><span>${esc(p.time || "")}</span>${p.floor ? `<span>#${p.floor}</span>` : ""}${p.stats ? `<span>${esc(p.stats)}</span>` : ""}</div>
          <div class="msg-bubble full">${bodyOf(p)}</div>
        </div>
      </div>`;
    });
    html += `<div class="full-actions">
      <button class="link-btn" data-act="reload-topic">重新载入</button>
      <button class="link-btn" data-act="open-web">查看网页版</button>
    </div>`;
  } else {
    const author = cur.author || "内容";
    const color = blueOf(1);
    html += `
      <div class="msg">
        <div class="msg-avatar" style="background:${color}">${esc(author.slice(0, 1))}</div>
        <div class="msg-main wide">
          <div class="msg-meta"><span>${esc(author)}</span><span>${esc(cur.t || "")}</span>${cur.stats ? `<span>${esc(cur.stats)}</span>` : ""}</div>
          <div class="msg-bubble full">${cur.html || nl(cur.body || cleanSummary(cur.d))}</div>
        </div>
      </div>`;
    if (full && full.state === "loading") {
      html += `<div class="full-hint loading-hint">正在展开这个话题的全部回复… 网页里若出现验证，完成后会自动补全。</div>`;
    } else if (full && full.state === "error") {
      html += `<div class="full-hint">${esc(full.note || "暂时没能读出全部回复")} · <button class="link-btn" data-act="reload-topic">重新展开</button>${cur.url ? ` · <button class="link-btn" data-act="open-web">打开网页完成验证</button>` : ""}</div>`;
    }
  }

  /* 我发的评论：唯一允许出现的「我」气泡 */
  mine.forEach((m) => {
    html += `
    <div class="msg me">
      <div class="msg-avatar" style="background:#0089FF">${esc(meName.slice(0, 1))}</div>
      <div class="msg-main">
        <div class="msg-meta"><span>${esc(meName)}</span><span>${esc(m.time || "")}</span><span>我的评论</span></div>
        <div class="msg-bubble">${nl(m.text)}</div>
        <div class="msg-foot"><span class="msg-read">已读</span><button class="msg-del" data-act="del-comment" data-ts="${m.ts}">删除</button></div>
      </div>
    </div>`;
  });

  chatView.innerHTML = html;
  chatView.querySelectorAll("[data-act]").forEach((b) => {
    b.addEventListener("click", () => {
      const act = b.dataset.act;
      if (act === "reload-topic") openTopic(cur);
      else if (act === "open-web") openOriginal(cur);
      else if (act === "del-comment") removeComment(cur, Number(b.dataset.ts));
      else if (act === "toggle-notice") {
        const card = b.closest(".group-notice");
        const expanded = card.classList.toggle("expanded");
        b.textContent = expanded ? "收起" : (b.dataset.label || "展开");
      }
    });
  });
  chatView.scrollTop = full && full.state === "ok" ? 0 : chatView.scrollHeight;
  // 富文本里的图片会延后布局，下一帧再钉到顶部，保证从第 1 楼开始看
  if (full && full.state === "ok") requestAnimationFrame(() => { chatView.scrollTop = 0; });
}

/* 点会话 = 直接展开该话题全部楼层（参考原项目「选中即看全文」的形式）：
   主 webview 导航到详情页，页内包装器就地转成 IM 楼层流；
   同时定时把已渲染 DOM 读回消息视图。全程不需要用户再点「查看原文」。 */
async function openTopic(cur, fastOnly) {
  if (!cur) return;
  // 用户主动选会话才占住「首条已处理」；启动兜底失败时仍允许同步成功后自动展开
  if (current && !fastOnly) autoOpened[current] = true;
  const key = convKey(cur);
  if (!cur.url || !/^https?:/.test(cur.url)) {
    topicFull[key] = { state: "error", note: "这条内容没有原文链接" };
    renderChatView();
    return;
  }
  // fastOnly（启动兜底）只试同源 JSON，不打断站点同步、不导航详情页
  if (!fastOnly) { stopCapture(); stopPolling(); }
  resetCaptureAcc();
  topicFull[key] = { state: "loading", loading: true };
  renderChatView();
  setStatus("正在展开「" + String(cur.n).slice(0, 14) + "」的全部回复…", "", "none");

  /* 快速路径：站点有同源 JSON API 时直接读全部楼层，不等详情页渲染。
     linux.do 的 /t/{id}.json 即使在人机验证页也能返回全部回复。 */
  const fast = window.FULLTEXT && window.FULLTEXT[current];
  if (fast) {
    let data = null;
    try {
      const raw = await execInFrame("(" + fast.toString() + ")(" + JSON.stringify(cur.url) + ")", 4000);
      data = typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch (_) {}
    if (data && data.state === "ok" && ((data.posts && data.posts.length) || data.text)) {
      topicOpened = false;   // 主 webview 仍在首页，不打断站点同步
      if (fastOnly && current) autoOpened[current] = true;
      topicFull[key] = data;
      if (activeList()[activeConv] === cur) renderChatView();
      renderConvs();   // 备注换成该话题最后一层回复
      setStatus("已展开 " + ((data.posts && data.posts.length) || 1) + " 条回复 · " + SITES[current].name, "", "none");
      await saveCache();
      return;
    }
  }
  if (fastOnly) {
    delete topicFull[key];   // JSON 没读到就安静回到列表，不显示 loading、不打断同步
    renderChatView();
    return;
  }

  /* 兜底：导航详情页，页内包装 + DOM 读回 */
  topicOpened = true;
  // 详情页必须套 IM 包装（手动关过也自动恢复），保证网页模式同样是消息流
  if (!packEnabled) {
    packEnabled = true;
    if (btnRaw) { btnRaw.textContent = "IM 包装"; btnRaw.classList.add("on"); }
  }
  if (chatBody.classList.contains("show-web")) loading.classList.add("show");
  navigateFrame(cur.url);
  captureTimer = setInterval(() => tryCapture(cur), 1200);
}

/* 网页模式闭环：打开话题 → 页面渲染完 → 从 DOM 把全部楼层读回消息视图 */
let captureTimer = null;
let captureTries = 0;
/* 知乎回答流懒加载：记住读到过的最多楼层，连续几轮不再增长才收尾 */
let captureBest = null;
let captureStable = 0;

function resetCaptureAcc() { captureBest = null; captureStable = 0; captureTries = 0; }

function stopCapture() {
  if (captureTimer) { clearInterval(captureTimer); captureTimer = null; }
}

function samePage(a, b) {
  try {
    const x = new URL(a), y = new URL(b);
    return x.host === y.host && x.pathname === y.pathname;
  } catch (_) { return false; }
}

async function tryCapture(cur) {
  if (!cur || !cur.url) { stopCapture(); return; }
  captureTries++;
  if (captureTries > 45) {   // 留出登录 / 人机验证的时间
    stopCapture();
    const st = topicFull[convKey(cur)];
    if (st && st.state === "loading") {
      topicFull[convKey(cur)] = { state: "error", note: "页面还没就绪" };
      if (activeList()[activeConv] === cur) renderChatView();
    }
    setStatus("已在网页中打开话题 · 完成验证后点「重新展开」", "warn", "web");
    return;
  }
  let href = "";
  try { href = frame.getURL ? frame.getURL() : ""; } catch (_) {}
  // 小红书笔记详情页会重定向到 /login：别空转 45 轮，直接露网页引导扫码
  if (/xiaohongshu\.com\/login/.test(href)) {
    stopCapture();
    topicFull[convKey(cur)] = { state: "error", note: "小红书笔记需登录后才能展开" };
    if (activeList()[activeConv] === cur) renderChatView();
    if (current === "xhs" && !autoShownWeb[current]) {
      autoShownWeb[current] = true;
      showWeb(true);
    }
    setStatus("小红书需要登录 · 在网页里扫码登录后再点会话", "warn", "web");
    return;
  }
  // 验证页 / 跳转中不抓，避免把列表页文字当成全文
  if (!href || !samePage(href, cur.url)) return;
  // 详情页懒加载时补一次包装注入
  if (packEnabled && packState.state !== "ok" && captureTries % 3 === 1) injectPacker();
  const fn = window.FULLTEXT && window.FULLTEXT.capture;
  if (!fn) { stopCapture(); return; }
  let data = null;
  try {
    const raw = await execInFrame("(" + fn.toString() + ")()", 8000);
    data = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (_) {}
  const posts = (data && data.posts) || [];
  const ok = data && data.state === "ok" && (posts.length || data.text);
  if (!ok) return;
  // 首条楼层过短通常意味着懒加载只渲染了半截，再等一轮（小红书笔记本来就短，跳过）
  if (posts.length && posts[0].text && posts[0].text.length < 40 && captureTries < 6 &&
      !/xiaohongshu\.com/.test(href)) return;
  /* 知乎回答 / 小红书评论都是渐进渲染：楼层数还在涨就继续等，
     连续 4 轮不增长（或够 30 层）才用最好的一轮收尾。 */
  if (/zhihu\.com|xiaohongshu\.com/.test(href) && posts.length && captureTries < 12) {
    if (!captureBest || posts.length > (captureBest.posts || []).length) {
      captureBest = data;
      captureStable = 0;
    } else {
      captureStable++;
    }
    // 知乎问题页逐条回答是 SPA 渐进渲染，多等几轮再收尾，别只拿首屏那几条
    if (posts.length < 30 && captureStable < 4) return;
    data = captureBest || data;
  }
  stopCapture();
  topicFull[convKey(cur)] = data;
  if (activeList()[activeConv] === cur) renderChatView();
  renderConvs();   // 备注跟着读回的全文更新
  setStatus("已展开 " + (posts.length || 1) + " 条回复 · " + SITES[current].name, "", "none");
  await saveCache();
}

function openOriginal(cur) {
  if (!cur || !cur.url) return;
  showWeb(true);
  chatTitle.textContent = maskOn ? maskData(cur).name : cur.n;
  let href = "";
  try { href = typeof frame.getURL === "function" ? frame.getURL() : ""; } catch (_) {}
  // 主 webview 通常已经在详情页；只有还在首页/验证页时才补导航
  if (!samePage(href, cur.url)) {
    loading.classList.add("show");
    topicOpened = true;
    navigateFrame(cur.url);
    resetCaptureAcc();
    if (!captureTimer) captureTimer = setInterval(() => tryCapture(cur), 1500);
  }
}

function sendComment() {
  const input = document.getElementById("composerInput");
  const cur = activeList()[activeConv];
  if (!input || !cur) return;
  const text = input.value.trim();
  if (!text) return;
  const key = convKey(cur);
  if (!Array.isArray(myComments[key])) myComments[key] = [];
  const d = new Date();
  myComments[key].push({
    text: text.slice(0, 2000),
    time: String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"),
    ts: Date.now(),
  });
  try { localStorage.setItem(COMMENTS_KEY, JSON.stringify(myComments)); } catch (_) {}
  input.value = "";
  renderChatView();
  chatView.scrollTop = chatView.scrollHeight;
  input.focus();
}

function removeComment(cur, ts) {
  const key = convKey(cur);
  if (!Array.isArray(myComments[key])) return;
  myComments[key] = myComments[key].filter((m) => m.ts !== ts);
  try { localStorage.setItem(COMMENTS_KEY, JSON.stringify(myComments)); } catch (_) {}
  renderChatView();
}

function loadSite(key, force) {
  const site = SITES[key];
  if (!site) return;
  if (!force && frame.dataset.current === key) return;
  frame.dataset.current = key;
  startPolling();
  loading.classList.add("show");
  frame.setAttribute("useragent", UA);
  navigateFrame(site.url);
}

function selectSite(key) {
  if (current === key) return;
  stopCapture();
  topicOpened = false;
  current = key;
  activeConv = 0;
  renderRail();
  renderConvs();
  syncChatHead();
  loadSite(key);
}

/* ---------- 从 webview 页面内抓真实内容（复用页面登录态，同源请求） ---------- */
/* 各站提取器定义在 crawlers.js，注入到 webview 页内执行，天然复用该页登录态。
   统一返回 { state, items }；state 决定右上角提示与是否需要引导登录。 */

let cssInjectedFor = "";
let packEnabled = true;      // 网页模式是否套用 IM 包装
let packState = {};          // 页内包装器回报的状态
const btnRaw = document.getElementById("btnRaw");
/* 验证页 / 未就绪页里 executeJavaScript 可能永远不 resolve，
   必须加超时，否则会把整个轮询卡死 */
function execInFrame(code, ms = 4000) {
  return Promise.race([
    frame.executeJavaScript(code),
    new Promise((_, rej) => setTimeout(() => rej(new Error("exec timeout")), ms)),
  ]);
}

async function injectChromeCSS() {
  const css = SITES[current] && SITES[current].css;
  if (!css) return;
  let href = "";
  try { href = typeof frame.getURL === "function" ? frame.getURL() : ""; } catch (_) {}
  const key = current + "|" + href;
  if (cssInjectedFor === key) return;   // 避免每轮轮询重复插入同一段样式
  try {
    if (typeof frame.insertCSS === "function") {
      await frame.insertCSS(css);
      cssInjectedFor = key;
    }
  } catch (_) {}
}

/* ---------- 网页就地包装：照原项目做法，把网页 DOM 抽成钉钉消息气泡 ----------
   包装器注入到 webview 页内，自带重试定时器，能跟上 SPA / 懒加载；
   登录页与人机验证页会自动「解包」露出原页面，用户完成后再自动包回来。 */
async function readPackState() {
  try {
    const raw = await execInFrame("JSON.stringify(window.__wbPackState||{})", 2000);
    packState = JSON.parse(raw || "{}") || {};
  } catch (_) { /* 页面正在跳转，忽略 */ }
  if (btnRaw) {
    btnRaw.textContent = packEnabled ? "IM 包装" : "原页";
    btnRaw.classList.toggle("on", packEnabled);
    btnRaw.title = packEnabled
      ? "网页已转成钉钉消息气泡 · 点此查看网站原页"
      : "当前是网站原页 · 点此重新套用 IM 包装";
  }
  return packState;
}

let lastPackInject = 0;
async function injectPacker() {
  lastPackInject = Date.now();
  if (!window.PACKER) return;
  const code = "(" + window.PACKER.toString() + ")(" +
    JSON.stringify(current) + "," + JSON.stringify({ enabled: packEnabled }) + ")";
  try { await execInFrame(code, 4000); } catch (_) { /* 验证页可能挂起 */ }
  return readPackState();
}

/* 抓取轮询顺带兜底：dom-ready 没赶上懒加载时，隔几秒补一次注入 */
async function ensurePacked() {
  if (!packEnabled || packState.state === "ok") return;
  if (Date.now() - lastPackInject < 6000) return;
  await injectPacker();
}

/* ---------- 抓取到的内容落盘缓存：下次启动立刻有内容，不必重新登录 ---------- */
async function loadCache() {
  try {
    if (!window.appInfo || !window.appInfo.cacheRead) return;
    const d = await window.appInfo.cacheRead();
    if (!d || typeof d !== "object") return;
    // 上次展开过的全文：启动瞬间就能显示，完全不依赖网络
    if (d.__full__ && typeof d.__full__ === "object") {
      for (const k of Object.keys(d.__full__)) {
        if (d.__full__[k] && d.__full__[k].state === "ok") {
          topicFull[normalizeZhihuUrl(k)] = d.__full__[k];
        }
      }
    }
    for (const k of Object.keys(d)) {
      if (k === "__full__") continue;
      if (d[k] && Array.isArray(d[k].items) && d[k].items.length) {
        /* 旧缓存里指向单条回答页的链接迁移到问题页，顺带按链接去重；
           小红书旧条目没有 xsec_token，点开会 404，直接丢掉等重新抓 */
        const items = k === "xhs"
          ? d[k].items.filter((it) => it && /xsec_token=/.test(it.url || ""))
          : d[k].items;
        liveConvs[k] = mergeConvs([], items);
      }
    }
  } catch (_) {}
}

async function saveCache() {
  const d = { __full__: {} };
  for (const k of Object.keys(liveConvs)) {
    if (liveConvs[k] && liveConvs[k].length) {
      d[k] = { items: liveConvs[k], ts: Date.now() };
    }
  }
  // 只留最近 6 个已展开话题，正文做长度保护，避免缓存文件无限膨胀
  Object.keys(topicFull)
    .filter((k) => topicFull[k] && topicFull[k].state === "ok")
    .slice(-6)
    .forEach((k) => {
      const v = topicFull[k];
      d.__full__[k] = {
        state: "ok", title: v.title || "",
        text: String(v.text || "").slice(0, 8000), html: String(v.html || "").slice(0, 20000),
        posts: (v.posts || []).slice(0, 40).map((p) => ({
          user: p.user, time: p.time, floor: p.floor, stats: p.stats || "",
          text: String(p.text || "").slice(0, 8000), html: String(p.html || "").slice(0, 20000),
        })),
      };
    });
  try {
    if (window.appInfo && window.appInfo.cacheWrite) await window.appInfo.cacheWrite(d);
  } catch (_) {}
}

/* ---------- 轮询抓取：不依赖 dom-ready（验证页会打断事件） ---------- */
const STATE_HINT = {
  login: (n) => n + " 需要登录 · 点这里去登录",
  blocked: (n) => n + " 正在验证 · 点这里打开网页",
  empty: (n) => n + " 暂无内容 · 点这里打开网页",
  error: (n) => n + " 读取失败 · 点这里重试",
  timeout: (n) => n + " 无响应 · 点这里重试",
};

let pollTimer = null;
let autoReturn = false;  // 从「登录」入口进入网页模式，同步成功后自动回消息视图
const crawlState = {};   // { siteKey: 最后一次抓取状态 }
const diagReported = {}; // 失败状态上报限流，便于从 runtime-status.json 看清卡在哪
const autoShownWeb = {}; // 每个站点只自动露出一次验证页，不跟用户手动切换打架

/* 知乎是无限滚动：一次抓取只有首屏十来条，必须多轮滚动 + 合并去重才能拿满。 */
const ZHIHU_TARGET = 36;
const XHS_TARGET = 24;   // 小红书首屏瀑布流约 20+ 条，多轮累积到 24 条即收敛
const crawlAcc = {};     // { siteKey: { rounds, last, stable, start, autoOpen } }

/* 知乎推荐卡片指向「单条回答页」，点进去只能看到 1 个回答。
   全链路统一收敛到 /question/{id}，会话列表、详情页导航、全文缓存的 key 才一致。 */
function normalizeZhihuUrl(u) {
  if (!u) return u;
  try {
    const x = new URL(u, location.href);
    const q = /\/question\/(\d+)/.exec(x.pathname);
    if (q) return x.origin + "/question/" + q[1];
  } catch (_) {}
  return u;
}

/* 合并新旧会话：按详情链接去重，新抓到的字段更全就覆盖旧的，
   顺序保持「先旧后新」，重绘时不会把用户正在看的会话挤走。 */
function mergeConvs(prev, next) {
  const norm = (u) => {
    try { const x = new URL(u, location.href); return x.origin + x.pathname; }
    catch (_) { return String(u || ""); }
  };
  const keyOf = (it) => norm(it.url) || String(it.n || "");
  const map = new Map();
  (prev || []).forEach((it) => { if (it && it.n) map.set(keyOf(it), it); });
  (next || []).forEach((it) => {
    if (!it || !it.n) return;
    const fixed = Object.assign({}, it, { url: normalizeZhihuUrl(it.url || "") });
    const k = keyOf(fixed);
    const old = map.get(k);
    map.set(k, old ? Object.assign({}, old, fixed) : fixed);
  });
  return Array.from(map.values()).slice(0, 60);
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

/* 站点同步完成后自动展开首条话题：启动就有完整楼层流，不用手工点开原文 */
let autoOpenTimer = null;
function autoOpenFirst(key) {
  if (autoOpened[key] || topicOpened || current !== key || autoOpenTimer) return;
  if (chatBody.classList.contains("show-web")) return;   // 不打断用户正在看的网页 / 验证页
  autoOpenTimer = setTimeout(() => {
    autoOpenTimer = null;
    if (autoOpened[key] || topicOpened || current !== key) return;
    const c = activeList()[activeConv];
    if (!c || !c.url) return;
    autoOpened[key] = true;
    openTopic(c);
  }, 1200);
}

let pollingBusy = false;
function startPolling() {
  stopPolling();
  const key = current;
  const site = SITES[key];
  if (!site) return;
  let tries = 0;
  pollingBusy = false;
  setStatus("正在同步 " + site.name + "…", "", "none");
  pollTimer = setInterval(async () => {
    if (pollingBusy) return;      // 上一轮还在等页面响应，不并发
    if (current !== key) { stopPolling(); return; }
    pollingBusy = true;
    try {
      tries++;
      await injectChromeCSS();
      const ok = await tryCrawlOnce();
      if (ok) { stopPolling(); return; }
      const maxTries = key === "zhihu" ? 30 : 20;  // 知乎要多轮滚动累积
      if (tries >= maxTries) {
        stopPolling();
        const st = crawlState[key] || "timeout";
        const n = (liveConvs[key] || []).length;
        const acc = crawlAcc[key];
        if (n) {
          setStatus("已同步 " + n + " 条 · " + site.name + "（列表已加载完）", "", "sync");
        } else {
          const action = st === "login" ? "login" : "web";
          setStatus((STATE_HINT[st] || STATE_HINT.timeout)(site.name) + " · 演示数据", "warn", action);
        }
        await reportStatus({ crawled: n, reason: st, rounds: acc ? acc.rounds : 0 });
        if (!acc || acc.autoOpen !== false) autoOpenFirst(key);
      }
    } finally {
      pollingBusy = false;
    }
  }, 2500);
}

async function tryCrawlOnce() {
  const key = current;
  const fn = window.CRAWLERS && window.CRAWLERS[key];
  if (!fn) return false;
  await ensurePacked();
  let res = null;
  let execErr = "";
  try {
    // 把提取器源码注入 webview 页内执行，天然带上该站的 cookie
    const raw = await execInFrame("(" + fn.toString() + ")()", key === "zhihu" ? 8000 : 4000);
    res = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (e) {
    execErr = String((e && e.message) || e).slice(0, 140);
  }
  if (!res || !res.state) {
    if (current === key) {
      const n = liveConvs[key] && liveConvs[key].length;
      setStatus(
        n ? "本地缓存 " + n + " 条 · 点这里打开网页完成验证" : "页面未就绪 · 点这里打开网页",
        "warn",
        "web"
      );
    }
    if (!diagReported[key] || Date.now() - diagReported[key] > 10000) {
      diagReported[key] = Date.now();
      await reportStatus({ crawled: 0, state: "no-exec", execErr: execErr });
    }
    return false;
  }
  crawlState[key] = res.state;

  if (res.state === "ok" && Array.isArray(res.items) && res.items.length) {
    const acc = crawlAcc[key] || (crawlAcc[key] = { rounds: 0, last: 0, stable: 0, start: 0 });
    const merged = mergeConvs(liveConvs[key], res.items);
    liveConvs[key] = merged;
    autoShownWeb[key] = false;
    acc.rounds++;
    acc.stable = merged.length > acc.last ? 0 : acc.stable + 1;
    acc.last = merged.length;

    /* 知乎 / 小红书都是虚拟流：只要还在变多就继续下一轮，别一抓到首屏就停 */
    const target = key === "zhihu" ? ZHIHU_TARGET : (key === "xhs" ? XHS_TARGET : 0);
    const wantMore = target && merged.length < target &&
      acc.stable < 2 && acc.rounds < 14 && !topicOpened;

    if (current === key && !topicOpened) {
      if (acc.rounds === 1 && acc.keepSelection !== true) activeConv = 0;  // 累积期间不打断阅读
      renderConvs();
      if (!wantMore) syncChatHead();
    }
    if (wantMore) {
      setStatus("正在加载 " + SITES[key].name + " 推荐流 · 已获取 " + merged.length + " 条…", "", "none");
      await saveCache();
      return false;   // 让轮询继续滚动累积
    }

    if (acc.autoOpen !== false) autoOpenFirst(key);
    if (current === key) {
      const p = await readPackState();
      const packed = p && p.state === "ok" && p.count ? " · 网页已包装成 " + p.count + " 条消息" : "";
      const added = merged.length - (acc.start || 0);
      setStatus("已同步 " + merged.length + " 条真实内容 · " + SITES[key].name +
        (added > 0 ? "（新增 " + added + " 条）" : "") + packed, "", "sync");
      // 从「登录」入口进来的，同步完成后自动回到消息视图
      if (autoReturn && chatBody.classList.contains("show-web")) {
        showWeb(false);
        autoReturn = false;
      }
    }
    await saveCache();
    await reportStatus({
      crawled: merged.length,
      state: "ok",
      packed: packState,
      rounds: acc.rounds,
      firstTitles: merged.slice(0, 4).map((x) => x.n),
    });
    return true;
  }

  if (current === key) {
    const cached = liveConvs[key] && liveConvs[key].length;
    if (cached) {
      setStatus("本地缓存 " + cached + " 条 · 点刷新更新", "demo", "sync");
    } else if (res.state === "login") {
      setStatus(STATE_HINT.login(SITES[key].name), "warn", "login");
    } else if (res.state === "blocked") {
      setStatus(STATE_HINT.blocked(SITES[key].name), "warn", "web");
      // 完全没有缓存时，把验证页露出来，否则用户看不到「请稍候…」也没法完成验证
      if (!cached && !autoShownWeb[key]) {
        autoShownWeb[key] = true;
        showWeb(true);
      }
    }
  }
  if (!diagReported[key] || Date.now() - diagReported[key] > 10000) {
    diagReported[key] = Date.now();
    await reportStatus({ crawled: 0, state: res.state, note: "retrying" });
  }
  return false;
}

async function reportStatus(extra) {
  let raw = "";
  try {
    raw = await execInFrame(`JSON.stringify({
      url: location.href,
      title: document.title,
      ready: document.readyState,
      textLen: ((document.body && document.body.innerText) || '').length,
      sample: ((document.body && document.body.innerText) || '').replace(/\\s+/g, ' ').slice(0, 140)
    })`);
  } catch (_) {}
  let page = {};
  try { page = JSON.parse(raw || "{}"); } catch (_) {}
  const r = frame.getBoundingClientRect();
  try {
    window.appInfo?.report?.({
      site: current,
      ...extra,
      page,
      webviewApi: {
        loadURL: typeof frame.loadURL,
        getURL: typeof frame.getURL,
        srcAttr: frame.getAttribute("src"),
        currentURL: (() => { try { return frame.getURL ? frame.getURL() : ""; } catch (_) { return ""; } })(),
      },
      frameRect: { w: Math.round(r.width), h: Math.round(r.height) },
      ts: new Date().toISOString(),
    });
  } catch (_) {}
}

function setStatus(text, kind, action) {
  if (!newmsg) return;
  newmsg.className = "newmsg" + (kind ? " " + kind : "");
  const icon = kind === "warn" ? "i-warn" : "i-check";
  newmsg.innerHTML = '<svg class="ic"><use href="#' + icon + '"/></svg><span></span>';
  newmsg.querySelector("span").textContent = text;
  newmsg.dataset.action = action || "none";
  newmsg.style.display = "flex";
}

/* 网页 / 消息视图切换 + 登录入口 */
function showWeb(on) {
  chatBody.classList.toggle("show-web", on);
  viewSwitch.classList.toggle("on", on);
  viewSwitch.textContent = on ? "消息" : "网页";
}

function openLogin() {
  const site = SITES[current];
  if (!site) return;
  showWeb(true);
  autoReturn = true;
  loading.classList.add("show");
  navigateFrame(site.loginUrl || site.url);
  startPolling();
}

/* 验证页 / 空内容页：只把网页模式露出来，不重新导航（否则会打断验证） */
function showWebAction() {
  showWeb(true);
  autoReturn = true;   // 验证 / 登录完成后自动回到消息视图
  let href = "";
  try { href = typeof frame.getURL === "function" ? frame.getURL() : ""; } catch (_) {}
  if (!href || href === "about:blank") navigateFrame(SITES[current].url);
  if (!pollTimer) startPolling();
  setStatus("在网页里完成验证后点「刷新」", "warn", "sync");
}

/* ---------- 页面刷新 ----------
   旧版「同步」在首页状态下完全不导航，只在旧 DOM 上重跑抓取脚本：
   知乎 SPA 不会重新请求推荐流，看到的永远是同一批旧卡片。
   这里统一做真·重载：清掉注入/包装/收敛状态，重新加载页面，再滚动累积抓全。 */
function resetCrawlState(key) {
  cssInjectedFor = "";
  packState = {};
  lastPackInject = 0;
  crawlState[key] = "";
  diagReported[key] = 0;
  autoShownWeb[key] = false;
  autoOpened[key] = false;
  crawlAcc[key] = {
    rounds: 0, last: 0, stable: 0,
    start: (liveConvs[key] || []).length,
    autoOpen: false,       // 手动刷新不自动跳详情页，避免打断正在读的内容
    keepSelection: true,   // 保留当前选中的会话
  };
  resetCaptureAcc();
}

function refreshSite() {
  const site = SITES[current];
  if (!site) return;
  stopPolling();
  stopCapture();
  resetCrawlState(current);

  let href = "";
  try { href = typeof frame.getURL === "function" ? frame.getURL() : ""; } catch (_) {}
  const atHome = href && samePage(href, site.url);
  const inWeb = chatBody.classList.contains("show-web");
  const onDetail = href && !atHome && !/about:blank/.test(href);

  /* 网页模式里正停在某个话题详情页：只刷新这一页，不把用户拽回首页 */
  if (inWeb && onDetail) {
    if (typeof frame.reload === "function") frame.reload();
    else navigateFrame(href);
    setStatus("正在刷新当前页面…", "", "none");
    const c = activeList()[activeConv];
    if (c && c.url) {
      topicOpened = true;
      captureTimer = setInterval(() => tryCapture(c), 1500);
    }
    return;
  }

  topicOpened = false;
  /* 真重载：已在首页时 reload()，否则导航回首页。不靠改 src 同值碰运气。 */
  if (atHome && typeof frame.reload === "function") frame.reload();
  else navigateFrame(site.url);
  renderConvs();
  startPolling();
  // startPolling 内部会先写「正在同步…」，这里覆盖成更准确的刷新提示
  setStatus("正在刷新 " + site.name + " 页面并重新抓取帖子…", "", "none");
  /* 站点限流 / 验证页导致刷新后迟迟没有推荐流时，给一个明确交代，
     同时保留本地已缓存的帖子，不会因为刷新把内容清空。 */
  const key = current;
  setTimeout(() => {
    if (current !== key) return;
    const acc = crawlAcc[key];
    if (acc && acc.rounds === 0 && crawlState[key] !== "ok") {
      const n = (liveConvs[key] || []).length;
      setStatus("页面已刷新 · 站点暂未返回新内容，继续显示本地 " + n + " 条", "warn", "sync");
    }
  }, 9000);
}

function syncNow() { refreshSite(); }

frame.addEventListener("did-start-loading", () => loading.classList.add("show"));
frame.addEventListener("did-stop-loading", () => loading.classList.remove("show"));
frame.addEventListener("did-fail-load", (e) => {
  if (e.errorCode === -3) return;
  loading.classList.remove("show");
});
frame.addEventListener("dom-ready", () => {
  // 首次（about:blank）dom-ready 代表 webview 内部已就绪，补发排队的导航
  if (!webviewReady) {
    webviewReady = true;
    if (pendingNav) {
      const u = pendingNav;
      pendingNav = null;
      navigateFrame(u);
      return;
    }
  }
  let href = "";
  try { href = typeof frame.getURL === "function" ? frame.getURL() : ""; } catch (_) {}
  if (!href || href === "about:blank") return;
  loading.classList.remove("show");
  injectChromeCSS();
  injectPacker();
  // 登录 / 人机验证跳转也会触发 dom-ready，此时若尚未抓到内容，重新给一轮轮询窗口
  if (!topicOpened && chatBody.classList.contains("show-web") && crawlState[current] !== "ok") startPolling();
  // 用户在网页模式完成验证后页面重新 dom-ready，若话题还没展开就继续读回
  if (topicOpened && !captureTimer) {
    const c = activeList()[activeConv];
    const st = c && topicFull[convKey(c)];
    if (c && c.url && (!st || st.state === "loading" || st.state === "error")) {
      resetCaptureAcc();
      captureTimer = setInterval(() => tryCapture(c), 1500);
    }
  }
});

/* ---------- 顶栏身份 ---------- */
const IDENTITY_KEY = "dingtalk-shell-identity";
const DEFAULT_IDENTITY = { name: "我", org: "我的组织" };

function readIdentity() {
  try {
    const raw = localStorage.getItem(IDENTITY_KEY);
    if (!raw) return { ...DEFAULT_IDENTITY };
    const v = JSON.parse(raw);
    return {
      name: (v.name || "").trim() || DEFAULT_IDENTITY.name,
      org: (v.org || "").trim() || DEFAULT_IDENTITY.org,
    };
  } catch (_) {
    return { ...DEFAULT_IDENTITY };
  }
}

function applyIdentity() {
  const v = readIdentity();
  document.getElementById("meName").textContent = v.name;
  document.getElementById("meOrg").textContent = v.org;
  document.getElementById("meAvatar").textContent = v.name.slice(0, 1);
}

function setupIdentityEditor() {
  const me = document.getElementById("me");
  const editor = document.getElementById("meEditor");
  const inputName = document.getElementById("inputName");
  const inputOrg = document.getElementById("inputOrg");
  const open = () => {
    const v = readIdentity();
    inputName.value = v.name;
    inputOrg.value = v.org;
    editor.hidden = false;
    inputName.focus();
  };
  const close = () => { editor.hidden = true; };

  me.addEventListener("click", (e) => { e.stopPropagation(); editor.hidden ? open() : close(); });
  editor.addEventListener("click", (e) => e.stopPropagation());
  document.addEventListener("click", close);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
    if (e.key === "Enter" && !editor.hidden) document.getElementById("btnSave").click();
  });

  document.getElementById("btnSave").addEventListener("click", () => {
    const v = { name: inputName.value.trim(), org: inputOrg.value.trim() };
    try {
      if (v.name === DEFAULT_IDENTITY.name && v.org === DEFAULT_IDENTITY.org) {
        localStorage.removeItem(IDENTITY_KEY);
      } else {
        localStorage.setItem(IDENTITY_KEY, JSON.stringify(v));
      }
    } catch (_) {}
    applyIdentity();
    close();
  });
  document.getElementById("btnReset").addEventListener("click", () => {
    try { localStorage.removeItem(IDENTITY_KEY); } catch (_) {}
    applyIdentity();
    close();
  });
}

/* ---------- 零碎交互 ---------- */
function setupMisc() {
  document.querySelectorAll(".wbtn").forEach((b) => {
    b.addEventListener("click", () => {
      if (window.appInfo && typeof window.appInfo.winCtl === "function") {
        window.appInfo.winCtl(b.dataset.ctl);
      }
    });
  });

  document.querySelectorAll(".tab").forEach((t) => {
    t.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
      t.classList.add("active");
      tabMode = t.dataset.tab;
      renderConvs();
    });
  });

  const tip = document.querySelector(".key-tip");
  document.getElementById("closeKeyTip")?.addEventListener("click", () => {
    if (tip) tip.style.display = "none";
  });

  /* 「待办 / 看闲忙」是界面复刻的装饰入口，点了就把焦点落到我的评论区 */
  document.querySelector(".chat-shortcuts")?.addEventListener("click", (e) => {
    if (e.target.closest("button")) document.getElementById("composerInput")?.focus();
  });

  document.getElementById("btnSend")?.addEventListener("click", sendComment);
  const composerInput = document.getElementById("composerInput");
  composerInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.isComposing) {
      e.preventDefault();
      sendComment();
    }
  });

  viewSwitch?.addEventListener("click", () => {
    const on = !chatBody.classList.contains("show-web");
    // 不打断正在进行的「自动展开全部回复」读回
    showWeb(on);
    if (on) {
      let href = "";
      try { href = typeof frame.getURL === "function" ? frame.getURL() : ""; } catch (_) {}
      if (!href || href === "about:blank") {
        navigateFrame(SITES[current].url);
        startPolling();
      }
      injectPacker();
    }
  });

  btnRaw?.addEventListener("click", async () => {
    packEnabled = !packEnabled;
    await injectPacker();
    setStatus(
      packEnabled ? "已套用 IM 包装 · 网页内容转成钉钉消息气泡" : "已切回网站原页 · 可在此登录或完成验证",
      "", "none"
    );
  });

  const btnMask = document.getElementById("btnMask");
  function syncMaskBtn() {
    if (!btnMask) return;
    btnMask.classList.toggle("on", maskOn);
    btnMask.textContent = maskOn ? "掩饰" : "原备注";
    btnMask.title = maskOn
      ? "掩饰已开启：左栏备注与会话名显示为工作群聊，点此查看真实内容"
      : "当前显示真实标题与备注，点此重新掩饰";
  }
  btnMask?.addEventListener("click", () => {
    maskOn = !maskOn;
    try { localStorage.setItem(MASK_KEY, maskOn ? "1" : "0"); } catch (_) {}
    syncMaskBtn();
    renderConvs();
    syncChatHead();
    setStatus(maskOn ? "已开启掩饰 · 左栏备注与会话名改为工作群聊" : "已关闭掩饰 · 显示真实标题与备注", "", "none");
  });
  syncMaskBtn();

  document.getElementById("btnSync")?.addEventListener("click", syncNow);
  document.getElementById("btnLogin")?.addEventListener("click", openLogin);
  newmsg?.addEventListener("click", () => {
    const a = newmsg.dataset.action;
    if (a === "login") openLogin();
    else if (a === "web") showWebAction();
    else if (a === "sync") syncNow();
  });

  /* ---------- 「…」菜单：把刷新 / 登录 / 网页 / 掩饰 / IM 包装收进去 ----------
     顶部三点、左栏「更多」、列表头菜单按钮都能唤出；菜单项转发 click 到隐藏的原按钮，
     因此原有逻辑、状态文案与掩饰开关全部不用改动。 */
  const moreMenu = document.getElementById("moreMenu");
  const btnMore = document.getElementById("btnMore");
  const filterBtn = document.querySelector(".filter-btn");
  if (filterBtn) filterBtn.title = "更多操作";

  function syncMoreMenu() {
    if (!moreMenu) return;
    const inWeb = chatBody.classList.contains("show-web");
    moreMenu.querySelectorAll("[data-target]").forEach((it) => {
      const b = document.getElementById(it.dataset.target);
      const st = it.querySelector(".mm-state");
      if (!b || !st) return;
      let text = "", on = false;
      const id = it.dataset.target;
      if (id === "viewSwitch") { on = inWeb; text = inWeb ? "网页中" : "消息中"; }
      else if (id === "btnMask") { on = maskOn; text = on ? "已开启" : "已关闭"; }
      else if (id === "btnRaw") { on = b.classList.contains("on") || packEnabled; text = on ? "已开启" : "已关闭"; }
      st.textContent = text;
      it.classList.toggle("on", on);
    });
  }

  function closeMoreMenu() {
    if (!moreMenu) return;
    moreMenu.hidden = true;
    btnMore?.classList.remove("open");
    btnMore?.setAttribute("aria-expanded", "false");
  }

  function toggleMoreMenu(anchor) {
    if (!moreMenu) return;
    if (!moreMenu.hidden) { closeMoreMenu(); return; }
    syncMoreMenu();
    moreMenu.hidden = false;
    const r = anchor.getBoundingClientRect();
    const w = moreMenu.offsetWidth || 208;
    const h = moreMenu.offsetHeight || 226;
    let left = r.right - w;
    let top = r.bottom + 6;
    if (top + h > window.innerHeight - 8) top = r.top - h - 6;
    moreMenu.style.left = Math.max(8, Math.min(left, window.innerWidth - w - 8)) + "px";
    moreMenu.style.top = Math.max(8, top) + "px";
    btnMore?.classList.add("open");
    btnMore?.setAttribute("aria-expanded", "true");
  }

  [btnMore, filterBtn].forEach((b) => {
    b?.addEventListener("click", (e) => { e.stopPropagation(); toggleMoreMenu(b); });
  });
  railItems.addEventListener("click", (e) => {
    const b = e.target.closest('.rail-item[title="更多"]');
    if (!b) return;
    e.stopPropagation();
    toggleMoreMenu(b);
  });
  moreMenu?.addEventListener("click", (e) => {
    const it = e.target.closest("[data-target]");
    if (!it) return;
    e.stopPropagation();
    document.getElementById(it.dataset.target)?.click();
    syncMoreMenu();
    setTimeout(syncMoreMenu, 400);   // IM 包装异步注入，状态稍后回写
    closeMoreMenu();
  });
  document.addEventListener("click", (e) => {
    if (!moreMenu || moreMenu.hidden) return;
    if (e.target.closest("#moreMenu") || e.target.closest("#btnMore") ||
        e.target.closest(".filter-btn") || e.target.closest('.rail-item[title="更多"]')) return;
    closeMoreMenu();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMoreMenu(); });
  window.addEventListener("resize", closeMoreMenu);
}

window.addEventListener("DOMContentLoaded", () => {
  applyIdentity();
  setupIdentityEditor();
  setupMisc();
  try {
    window.appInfo?.report?.({
      state: "boot",
      crawlers: typeof window.CRAWLERS,
      keys: Object.keys(window.CRAWLERS || {}),
      fulltext: Object.keys(window.FULLTEXT || {}),
    });
  } catch (_) {}
  // 先读缓存再渲染，保证启动瞬间中栏就有上次抓到的真实内容。
  // 同步成功会由 autoOpenFirst 展开首条；站点卡在验证页时，6 秒后用缓存首条
  // 走同源 JSON 快速展开，避免用户一直看到摘要、还得自己点开原文。
  loadCache().then(() => {
    selectSite("zhihu");   // 缓存里已有全文时，这一句就直接把楼层铺出来
    // 站点卡在验证页时同步很慢；缓存没有全文就隔几秒用同源 JSON 静默补一次
    let bootTries = 0;
    const bootExpand = () => {
      if (autoOpened[current] || topicOpened || chatBody.classList.contains("show-web")) return;
      const c = activeList()[activeConv];
      if (!c || !c.url || !window.FULLTEXT || !window.FULLTEXT[current]) return;
      const st = topicFull[convKey(c)];
      if (st && st.state === "ok") return;
      if (captureTimer) return;         // 用户已在手动展开别的话题
      openTopic(c, true);
      if (++bootTries < 3) setTimeout(bootExpand, 6000);
    };
    setTimeout(bootExpand, 5000);
  });
});
