/* 网页 IM 包装器 —— 参考原项目 zhihu-im.user.js 的转化思路：
   不重新造网页，而是把原网页 DOM 当作数据源（隐藏但保活，滚动/懒加载/交互不中断），
   从原生卡片 / 回答流里抽取 { 标题, 作者, 时间, 正文全文, 点赞评论数, 链接 }，
   再重建成钉钉风格的聊天气泡流覆盖在页面上。这样「投屏」进去的是包装过的内容，
   不是网站自带的顶栏 / 广告 / 页脚。

   window.PACKER 会被 toString() 后注入 <webview> 页内执行，
   函数体必须完全自包含，不能引用外部变量或闭包。 */
(function () {
  "use strict";

  window.PACKER = function (site, opts) {
    var o = opts || {};
    var ROOT = "wb-pack";
    var STYLE_ID = "wb-pack-style";
    /* 原版钉钉默认头像统一蓝底白单字，群头像也是多个蓝色方块拼接 */
    var COLORS = ["#0089FF", "#2F7FF0", "#3C7EFF", "#1E6FD9", "#4A93E8",
      "#0B84F3", "#5A8DEE", "#2277E0", "#1885F5", "#3479D8"];
    var state = { state: "starting", count: 0, title: "" };
    window.__wbPackState = state;

    function clean(s) {
      return String(s == null ? "" : s)
        .replace(/\u200B|\u200E/g, "")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    }
    function one(s) { return clean(String(s == null ? "" : s).replace(/\s+/g, " ")); }
    function esc(s) {
      return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
      });
    }
    /* 所有抽取都要排除包装容器自身，避免把自己生成的 DOM 再抽一遍 */
    function qsa(sel, root) {
      var doc = root || document;
      return Array.prototype.slice.call(doc.querySelectorAll(sel)).filter(function (el) {
        return !el.closest || !el.closest("#" + ROOT);
      });
    }
    function first(sel, root) { var a = qsa(sel, root); return a.length ? a[0] : null; }
    function txt(sel, root) {
      var el = first(sel, root);
      return clean(el ? (el.innerText || el.textContent) : "");
    }
    function hrefOf(sel, root) {
      var el = first(sel, root);
      if (!el) return "";
      try { return new URL(el.getAttribute("href"), location.href).href; } catch (e) { return ""; }
    }
    function safeHref(u) {
      if (!u || !/^https?:\/\//i.test(u)) return "";
      return u;
    }
    /* 去掉原生卡片里「阅读全文 / 显示全部 / 收起」这类按钮文案，正文保持完整不截断 */
    function bodyText(el) {
      if (!el) return "";
      var clone = el.cloneNode(true);
      clone.querySelectorAll("script,style,button,.ContentItem-more,.QuestionRichText-more,.RichContent-hide,.zh-expand").forEach(function (n) { n.remove(); });
      return clean((clone.innerText || clone.textContent || ""))
        .replace(/[\s…·]*阅读全文[\s›»]*$/g, "")
        .replace(/[\s…·]*显示全部[\s›»]*$/g, "")
        .replace(/[\s…·]*收起[\s‹«]*$/g, "")
        .slice(0, 12000);
    }
    /* 保留原网页的富文本结构（段落 / 编号列表 / 加粗 / 图片 / 链接），
       参考原项目 cleanRich()：只去脚本与站内交互件，不把正文压成一坨纯文本。 */
    function richHtml(el) {
      if (!el) return "";
      try {
        var clone = el.cloneNode(true);
        clone.querySelectorAll("script,style,iframe,video,audio,button,form,input,select,textarea,svg,canvas,noscript").forEach(function (n) { n.remove(); });
        clone.querySelectorAll(".ContentItem-more,.RichContent-hide,.QuestionRichText-more,[class*='ADLinkCard'],[class*='advert'],[class*='Pc-card']").forEach(function (n) { n.remove(); });
        var nodes = [clone].concat(Array.prototype.slice.call(clone.querySelectorAll("*")));
        nodes.forEach(function (node) {
          Array.prototype.slice.call(node.attributes || []).forEach(function (a) {
            var n = a.name.toLowerCase(), v = String(a.value || "");
            if (/^on/.test(n) || n === "style" ||
                (n === "href" && !/^(https?:|#|\/)/i.test(v)) ||
                (n === "src" && /^(data|javascript):/i.test(v))) {
              try { node.removeAttribute(a.name); } catch (e) {}
            }
          });
          if (node.tagName === "IMG") {
            var real = node.getAttribute("data-actualsrc") || node.getAttribute("data-src") || node.getAttribute("src") || "";
            if (!/^https?:/i.test(real)) { node.remove(); return; }
            node.setAttribute("src", real);
            node.setAttribute("loading", "lazy");
          }
          if (node.tagName === "A") {
            node.setAttribute("target", "_self");
            node.setAttribute("rel", "noopener noreferrer");
          }
        });
        return clone.innerHTML.slice(0, 30000);
      } catch (e) {
        return "";
      }
    }

    function statOf(card) {
      var acts = txt(".ContentItem-actions, .Actions, .ContentItem-action, [class*='ContentItem-actions'], [data-testid='reply']", card);
      var parts = [];
      var vote = txt(".VoteButton--up, [data-testid='like']", card);
      if (vote) parts.push("赞同 " + one(vote).replace(/^赞同\s*/, ""));
      else {
        var vm = /赞同\s*([\d.]+\s*万?)/.exec(acts) || /([\d.]+\s*万?)\s*人赞同/.exec(acts);
        if (vm) parts.push("赞同 " + vm[1]);
      }
      var cm = /([\d.]+\s*万?\s*条(?:评论|回复))/.exec(acts);
      if (cm) parts.push(cm[1]);
      var star = /([\d.]+\s*万?)\s*(?:人)?收藏/.exec(acts);
      if (star) parts.push("收藏 " + star[1]);
      return parts.join(" · ");
    }
    function item(name, time, text, title, href, stats, badge, html) {
      return {
        name: one(name).slice(0, 12) || "匿名",
        time: one(time),
        text: text || "",
        title: one(title),
        href: safeHref(href),
        stats: one(stats),
        badge: one(badge),
        html: html || "",
      };
    }

    /* ---------- 各站抽取：返回 { title, sub, items } ---------- */
    function extractZhihu() {
      var isDetail = /\/(question|p|zvideo)\//.test(location.pathname);
      if (isDetail) {
        var title = txt(".QuestionHeader-title, .Post-Title, .ZVideo-title, h1") || document.title;
        var descEl = first(".QuestionRichText, .QuestionHeader-detail");
        var desc = bodyText(descEl);
        var items = [];
        if (desc) items.push(item("问题描述", "", desc, "", "", "", "问题", richHtml(descEl)));
        var answers = qsa(".AnswerItem, .ContentItem-answer");
        if (answers.length < 2) {
          /* 新版知乎 / 单条回答页没有 .AnswerItem，直接取正文容器并去掉嵌套 */
          var richs = qsa(".RichContent-inner, .Post-RichTextContainer, .Post-RichText, .ZVideo-description")
            .filter(function (el) {
              return !el.closest(".QuestionRichText") &&
                !(el.parentElement && el.parentElement.closest(".RichContent-inner"));
            });
          if (richs.length > answers.length) answers = richs;
        }
        answers.slice(0, 80).forEach(function (a, i) {
          var rich = first(".RichContent-inner, .RichText, .Post-RichText", a) || a;
          var t = bodyText(rich);
          if (!t || t.length < 8) return;
          var auSel = ".AuthorInfo-name, .UserLink-link, .AuthorInfo .name, .Post-Author, .ContentItem-meta .author";
          var au = txt(auSel, a) || txt(auSel, a.parentElement || document);
          if (!au) { var m = /^([^\n：:]{2,16})[：:]/.exec(t); if (m) au = m[1]; }
          items.push(item(
            au,
            txt(".ContentItem-time, .Post-Time, time", a),
            t, "", hrefOf("a[href*='/answer/'], a[href*='/p/']", a) || location.href,
            statOf(a),
            answers.length > 1 ? "#" + (i + 1) : txt(".AuthorInfo-badgeText", a),
            richHtml(rich)
          ));
        });
        return {
          title: title,
          sub: "知乎讨论 · " + (items.length ? items.length + " 条内容已转成消息" : "正在读取回答"),
          items: items,
        };
      }

      /* 只排除广告卡片，不再因为「没有标准链接」就整条丢掉：
         热榜 / 视频 / 回答类卡片链接形态不同，之前正是这里造成 13 条只包出 12 条。 */
      var cards = qsa(".TopstoryItem, .ContentItem, .HotItem, .SearchResult-Card, .List-item").filter(function (c) {
        return !first(".TopstoryItem--advertCard, .Pc-card, .Pc-word, [class*='ADLinkCard']", c);
      });
      var seen = {};
      var out = [];
      cards.forEach(function (c) {
        var title = txt(".ContentItem-title, .HotItem-title, .SearchResult-title, h2", c);
        if (!title || title.length < 3) return;
        var link = hrefOf('a[href*="/question/"], a[href*="/p/"], a[href*="/zvideo/"], a[href*="/pin/"], a[href*="/answer/"]', c);
        var k = link ? link.split("?")[0] : title;
        if (seen[k]) return;
        seen[k] = 1;
        var rich = first(".RichContent-inner, .RichText, .SearchItem-snippet, .HotItem-excerpt", c);
        var text = bodyText(rich) || "知乎讨论 · 点标题查看完整回答";
        var au = txt(".AuthorInfo-name, .FeedSource, .HotItem-meta, .UserLink-link, .AuthorInfo .name", c);
        /* 推荐流的正文常写成「作者名：正文」，作者节点被折叠时从这里兜底 */
        if (!au) { var m = /^([^\n：:]{2,16})[：:]/.exec(text); if (m) au = m[1]; }
        out.push(item(
          au || "知乎答主",
          txt(".ContentItem-time, .FeedSource-time, .HotItem-metrics", c),
          text, title, link, statOf(c), "", richHtml(rich)
        ));
      });
      out = out.slice(0, 60);
      return {
        title: /\/hot/.test(location.pathname) ? "知乎热榜" : "知乎 · 消息",
        sub: "站内内容已转成钉钉会话消息 · 点左栏会话自动展开全部回复",
        items: out,
      };
    }

    function extractLinuxdo() {
      var posts = qsa(".topic-post");
      if (posts.length) {
        var title = txt(".topic-title h1, #topic-title h1, .fancy-title") || document.title;
        var items = [];
        posts.slice(0, 80).forEach(function (p) {
          var cooked = first(".cooked", p);
          var t = bodyText(cooked);
          if (!t) return;
          var tm = first("time, .post-date, .post-time", p);
          items.push(item(
            txt(".username, .names .username, [data-user-card]", p) || "坛友",
            tm ? String(tm.getAttribute("datetime") || tm.innerText || "").slice(0, 16).replace("T", " ") : "",
            t, "", location.href, "", "", richHtml(cooked)
          ));
        });
        return { title: title, sub: "Linux DO 话题 · " + items.length + " 层回复已转成消息", items: items };
      }
      var rows = qsa("tr.topic-list-item, .topic-list-item, .latest-topic-list-item");
      var out = [];
      rows.forEach(function (r) {
        var title = txt(".main-link .title, .title a, a.raw-link, .topic-title", r);
        if (!title || title.length < 3) return;
        out.push(item(
          txt(".posters a[data-user-card], .posters img", r) || "坛友",
          txt(".post-activity, .activity, time", r),
          "点标题进入话题，查看完整帖子与全部回复", title,
          hrefOf('a[href^="/t/"], a[href*="/t/"]', r), "", ""
        ));
      });
      return { title: "Linux DO · 最新话题", sub: "论坛话题已转成钉钉会话列表", items: out.slice(0, 40) };
    }

    function extractX() {
      var arts = qsa('article[data-testid="tweet"], article');
      var out = [];
      var seen = {};
      arts.forEach(function (a) {
        var t = bodyText(first('[data-testid="tweetText"], [lang]', a));
        if (!t || t.length < 4 || seen[t.slice(0, 40)]) return;
        seen[t.slice(0, 40)] = 1;
        var name = one((txt('[data-testid="User-Name"]', a) || "").split("\n")[0]);
        var tm = first("time", a);
        out.push(item(
          name || "X 用户",
          tm ? String(tm.getAttribute("datetime") || "").slice(5, 16).replace("T", " ") : "",
          t, "", hrefOf('a[href*="/status/"]', a), "", "",
          richHtml(first('[data-testid="tweetText"], [lang]', a))
        ));
      });
      return { title: "X · 时间线", sub: "推文已转成钉钉会话消息", items: out.slice(0, 40) };
    }

    function xhsImages(sel, root) {
      var html = "";
      qsa(sel, root).slice(0, 9).forEach(function (im) {
        var s = im.getAttribute("data-src") || im.getAttribute("src") || "";
        if (/^https?:/i.test(s)) html += '<img class="wb-cover" src="' + esc(s) + '" loading="lazy">';
      });
      return html;
    }

    function extractXhs() {
      var detail = first(".note-content, #detail-desc, .note-desc");
      if (detail && /\/explore\/|\/discovery\/item\//.test(location.pathname)) {
        var title = txt("#detail-title, .title, .note-title") || document.title;
        var author = txt(".author-container .username, .author .name, .username") || "小红书作者";
        var items = [];
        var dHtml = richHtml(detail) + xhsImages(".media-container img, .note-image img, .swiper-slide img, .image-container img");
        items.push(item(author, "", bodyText(detail), title, location.href, "", "笔记", dHtml));
        var cmts = qsa(".comments-container .comment-item, .comment-item, .parent-comment, [class*='comment-item']");
        var seen = {};
        cmts.slice(0, 80).forEach(function (c) {
          var el = first(".content, .comment-content, .note-text, [class*='content']", c) || c;
          var t = bodyText(el);
          if (!t || t.length < 2 || seen[t.slice(0, 40)]) return;
          seen[t.slice(0, 40)] = 1;
          var like = txt(".like .count, [class*='like'] .count", c);
          items.push(item(
            txt(".author .name, .user-name, .nickname, [class*='author']", c) || "小红书用户",
            txt(".time, .date, [class*='time']", c), t, "",
            "", like ? "赞 " + like : "", "#" + (items.length + 1), richHtml(el)
          ));
        });
        return { title: title, sub: "小红书笔记 · " + items.length + " 条内容已转成消息", items: items };
      }
      var cards = qsa("section.note-item, .note-item");
      var seenL = {};
      var out = [];
      cards.forEach(function (c) {
        var title = txt(".title, .note-title, [class*='title'] span", c);
        if (!title || title.length < 3) return;
        /* 优先带 xsec_token 的链接，隐藏的无 token 链接会跳 404 */
        var link = hrefOf('a[href*="xsec_token"]', c) ||
          hrefOf('a[href*="/explore/"], a[href*="/discovery/item/"]', c);
        var k = link ? link.split("?")[0] : title;
        if (seenL[k]) return;
        seenL[k] = 1;
        var rich = first(".desc, .note-desc, [class*='desc']", c);
        var text = bodyText(rich) || title;
        var like = txt(".like-wrapper .count, [class*='like'] .count, .count", c);
        var cover = first("img", c);
        var cs = cover ? (cover.getAttribute("data-src") || cover.getAttribute("src") || "") : "";
        var html = richHtml(rich);
        if (!html) html = "<div>" + esc(title) + "</div>";
        if (/^https?:/i.test(cs)) html += '<img class="wb-cover" src="' + esc(cs) + '" loading="lazy">';
        out.push(item(
          txt(".author .name, .author-wrapper .name, [class*='author'] span", c) || "小红书作者",
          txt(".time, [class*='time']", c), text, title, link,
          /\d/.test(like) ? "赞 " + like : "", "", html
        ));
      });
      return {
        title: "小红书 · 消息",
        sub: "站内内容已转成钉钉会话消息 · 点左栏会话自动展开全部回复",
        items: out.slice(0, 60),
      };
    }

    function extractGeneric() {
      /* 兜底：至少把网页正文变成一条消息，绝不露出裸网页 */
      var t = clean(document.body ? document.body.innerText : "").slice(0, 6000);
      if (t.length < 40) return { title: document.title, sub: "", items: [] };
      return {
        title: document.title || "网页内容",
        sub: "网页正文已转成消息",
        items: [item("网页内容", "", t, "", location.href, "", "")],
      };
    }

    function extract() {
      try {
        if (site === "zhihu") return extractZhihu();
        if (site === "linuxdo") return extractLinuxdo();
        if (site === "x") return extractX();
        if (site === "xhs") return extractXhs();
        return extractGeneric();
      } catch (e) {
        return { title: document.title || "", sub: "", items: [] };
      }
    }

    /* 登录 / 人机验证 / 出错页必须露出来，否则用户没法完成验证 */
    function isGate() {
      var t = document.title || "";
      var b = one(document.body ? document.body.innerText : "").slice(0, 800);
      return /安全验证|人机验证|身份验证|访问受限|请稍候|Just a moment|扫码登录|登录知乎|登录后查看|Sign in to X|Don't miss what's happening|手机验证码|验证码登录|Something went wrong|出错了|ERR_/i.test(t + " " + b)
        || /^\/(signin|login|passport|i\/flow\/login)/.test(location.pathname);
    }

    var CSS = [
      "body.wb-packed > *:not(#wb-pack){opacity:0!important;pointer-events:none!important;}",
      "html.wb-packed,body.wb-packed{overflow-x:hidden!important;max-width:100vw!important;}",
      "#wb-pack{position:fixed;inset:0;z-index:2147483647;overflow-y:auto;overflow-x:hidden;background:#FFFFFF;",
      "  color:#171A1D;font:14px/1.65 'PingFang SC','Microsoft YaHei',Arial,sans-serif;}",
      "#wb-pack *{box-sizing:border-box;}",
      "#wb-pack::-webkit-scrollbar{width:6px;}",
      "#wb-pack::-webkit-scrollbar-thumb{background:#D8DBE0;border-radius:3px;}",
      ".wb-head{position:sticky;top:0;z-index:2;background:#fff;border-bottom:1px solid #E9EAEC;padding:10px 26px;}",
      ".wb-head-t{font-size:15px;font-weight:600;color:#171A1D;line-height:1.4;}",
      ".wb-head-s{font-size:11px;color:#8A9099;margin-top:2px;}",
      ".wb-list{max-width:none;margin:0;padding:0 26px 70px;}",
      ".wb-day{text-align:center;font-size:11px;color:#A0A6AD;padding:16px 0 8px;}",
      ".wb-msg{display:flex;gap:12px;align-items:flex-start;padding:14px 4px 6px;margin-bottom:14px;}",
      ".wb-av{width:36px;height:36px;border-radius:6px;flex:none;color:#fff;font-size:15px;",
      "  display:flex;align-items:center;justify-content:center;font-weight:500;}",
      ".wb-main{min-width:0;max-width:min(760px,88%);flex:0 1 auto;}",
      ".wb-meta{display:flex;align-items:center;gap:8px;font-size:11px;color:#8A9099;margin-bottom:6px;}",
      ".wb-meta b{font-weight:500;color:#5A616B;}",
      ".wb-meta i{font-style:normal;background:#EAF3FF;color:#0089FF;border-radius:3px;padding:0 4px;font-size:10px;}",
      /* 原版钉钉：对方消息是淡灰气泡，四角圆润、无边框无阴影 */
      ".wb-bubble{background:#F2F3F5;border:0;border-radius:10px;",
      "  padding:10px 14px;word-break:break-word;}",
      ".wb-title{display:block;font-size:15px;font-weight:600;color:#171A1D;text-decoration:none;",
      "  line-height:1.45;margin-bottom:8px;}",
      ".wb-title:hover{color:#0089FF;}",
      ".wb-text{font-size:14px;color:#2B2F36;line-height:1.8;white-space:normal;",
      "  max-width:100%;overflow-wrap:anywhere;}",
      ".wb-text p{margin:0 0 10px;}",
      ".wb-text ol,.wb-text ul{padding-left:22px;margin:8px 0 12px;}",
      ".wb-text li{margin:0 0 8px;}",
      ".wb-text img{max-width:100%;height:auto;border-radius:6px;margin:8px 0;}",
      ".wb-text blockquote{border-left:3px solid #D8DBE0;margin:10px 0;padding:2px 0 2px 12px;color:#5A616B;}",
      ".wb-text pre{white-space:pre-wrap;background:#FFFFFF;border-radius:6px;padding:10px;overflow-x:auto;max-width:100%;}",
      ".wb-text table{max-width:100%;display:block;overflow-x:auto;}",
      ".wb-text h1,.wb-text h2,.wb-text h3{font-size:15px;margin:12px 0 8px;}",
      ".wb-text a{color:#0089FF;text-decoration:none;}",
      ".wb-stats{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:10px;font-size:11px;color:#8A9099;}",
      ".wb-stats-left{min-width:0;}",
      ".wb-link{color:#0089FF;text-decoration:none;white-space:nowrap;}",
      ".wb-link:hover{text-decoration:underline;}",
      ".wb-empty{padding:60px 20px;text-align:center;color:#8A9099;font-size:13px;}",
    ].join("\n");

    function ensureStyle() {
      var s = document.getElementById(STYLE_ID);
      if (!s) {
        s = document.createElement("style");
        s.id = STYLE_ID;
        s.textContent = CSS;
        (document.head || document.documentElement).appendChild(s);
      }
    }

    function unpack() {
      if (document.body) document.body.classList.remove("wb-packed");
      document.documentElement.classList.remove("wb-packed");
      var h = document.getElementById(ROOT);
      if (h) h.remove();
    }
    function stop() {
      if (window.__wbPackTimer) { clearInterval(window.__wbPackTimer); window.__wbPackTimer = null; }
    }
    function restore() { unpack(); stop(); }

    function render(data) {
      if (!document.body) return;
      ensureStyle();
      var host = document.getElementById(ROOT);
      if (!host) {
        host = document.createElement("div");
        host.id = ROOT;
        document.body.appendChild(host);
      }
      var html = '<div class="wb-head"><div class="wb-head-t">' + esc(data.title || "") +
        '</div><div class="wb-head-s">' + esc(data.sub || "") + '</div></div><div class="wb-list">' +
        '<div class="wb-day">今天</div>';
      data.items.forEach(function (it, i) {
        var c = COLORS[i % COLORS.length];
        html += '<div class="wb-msg">' +
          '<div class="wb-av" style="background:' + c + '">' + esc((it.name || "?").slice(0, 1)) + '</div>' +
          '<div class="wb-main">' +
            '<div class="wb-meta"><b>' + esc(it.name) + '</b>' +
              (it.badge ? '<i>' + esc(it.badge) + '</i>' : '') +
              '<span>' + esc(it.time) + '</span></div>' +
            '<div class="wb-bubble">' +
              (it.title ? '<a class="wb-title" href="' + esc(it.href || "#") + '">' + esc(it.title) + '</a>' : '') +
              '<div class="wb-text">' + (it.html || esc(it.text || "(无正文)")) + '</div>' +
            '</div>' +
            /* 已经展开全部楼层，不再留「查看原文 / 全部回答」这类二次入口 */
            ((it.stats || it.badge) ? '<div class="wb-stats"><span class="wb-stats-left">' +
              esc([it.badge, it.stats].filter(Boolean).join(" · ")) + '</span></div>' : '') +
          '</div></div>';
      });
      html += "</div>";
      host.innerHTML = html;
      document.documentElement.classList.add("wb-packed");
      /* 站外图片防盗链失败时不留破图占位，避免撑乱排版 */
      Array.prototype.slice.call(host.querySelectorAll(".wb-text img")).forEach(function (im) {
        im.addEventListener("error", function () { this.style.display = "none"; });
      });
      document.body.classList.add("wb-packed");
    }

    /* 原站是 SPA / 懒加载：页内自己重试，内容出现后还会随滚动不断更新 */
    var tries = 0;
    function tick() {
      if (!document.body) return;
      tries++;
      /* 不碰原网页滚动：知乎虚拟列表在被滚到底后会卸载上方卡片，
         反而让推荐流消失。包装器只负责重绘，页面保持停在顶部。 */
      var data = extract();
      if (data && data.items && data.items.length) {
        render(data);
        state = { state: "ok", count: data.items.length, title: data.title };
        window.__wbPackState = state;
        if (tries >= 45) stop();   // 页面稳定后停止轮询，DOM 变化由下次注入兜底
      } else if (isGate()) {
        unpack();                  // 验证 / 登录页露出来，但定时器继续，完成后自动包装
        state = { state: "gate", count: 0, title: document.title || "" };
        window.__wbPackState = state;
      } else if (tries >= 45) {
        state = { state: "empty", count: 0, title: document.title || "" };
        window.__wbPackState = state;
        stop();
      }
    }

    stop();
    if (o.enabled === false) {
      restore();
      state = { state: "off", count: 0, title: "" };
      window.__wbPackState = state;
      return JSON.stringify(state);
    }
    tick();
    if (state.state !== "ok" || tries < 45) {
      window.__wbPackTimer = setInterval(tick, 1200);
    }
    return JSON.stringify(state);
  };
})();
