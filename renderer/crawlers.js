/* 各站点内容提取器。
   这些函数会被 toString() 后注入到 <webview> 页面内执行，因此函数体必须完全自包含，
   不能引用外部变量或闭包。复用页面自身的 cookie / 登录态做同源请求。
   统一返回 JSON 字符串：{ state: "ok"|"login"|"blocked"|"empty"|"error", items: [...] }
   items 字段：{ n 名称, d 摘要, t 时间/作者, url 详情链接, posts 楼层数 } */
(function () {
  "use strict";

  window.CRAWLERS = {
    /* linux.do：Discourse 公开 JSON，无需登录 */
    linuxdo: async function () {
      const clean = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
      const R = (state, items) => JSON.stringify({ state: state, items: items || [] });
      try {
        const r = await fetch("/latest.json", { headers: { Accept: "application/json" } });
        if (!r.ok) return R("blocked");
        const d = await r.json();
        const arr = (d.topic_list && d.topic_list.topics) || [];
        const items = arr.slice(0, 18).map((t) => {
          const body = clean(String(t.excerpt || "").replace(/<[^>]+>/g, " ")).replace(/[….·\s]*阅读全文\s*$/, "");
          return {
            n: t.title || "(无标题)",
            d: clean((t.last_poster_username ? t.last_poster_username + ": " : "") + body).slice(0, 60),
            body: body || "点标题进入话题，查看完整帖子与全部回复",
            author: t.last_poster_username || "坛友",
            t: (t.last_posted_at || "").slice(5, 10).replace("-", "/"),
            ts: t.last_posted_at || "",
            posts: t.posts_count || 0,
            id: t.id,
            url: "https://linux.do/t/" + (t.slug || "topic") + "/" + t.id,
          };
        });
        return items.length ? R("ok", items) : R("empty");
      } catch (e) {
        return R("error");
      }
    },

    /* 知乎：推荐流 / 热榜卡片。首页与问题页都是无限滚动懒加载，
       每次调用先「推到底 + 点加载更多」触发下一批渲染，再把当前全部卡片收回来；
       app 层按链接去重合并，多轮累积就能拿满，而不是只有首屏那十来条。 */
    zhihu: async function () {
      const clean = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
      const R = (state, items, extra) =>
        JSON.stringify(Object.assign({ state: state, items: items || [] }, extra || {}));
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      /* 包装器生成的气泡也是 a[href*="/question/"]，必须排除，否则会抓出重复会话 */
      const qsa = (sel, root) => Array.from((root || document).querySelectorAll(sel))
        .filter((el) => !(el.closest && el.closest("#wb-pack")));
      const first = (sel, root) => { const a = qsa(sel, root); return a.length ? a[0] : null; };
      /* 推荐卡片默认指向「单条回答页」，点进去只能看到 1 个回答。
         统一收敛到问题页 /question/{id}，才能展开这个话题的全部回答；
         同时避免同一问题的不同回答生成一堆重复会话。 */
      const normLink = (u) => {
        try {
          const x = new URL(u, location.href);
          const q = /\/question\/(\d+)/.exec(x.pathname);
          if (q) return x.origin + "/question/" + q[1];
          return x.href;
        } catch (_) { return String(u || ""); }
      };
      const norm = (u) => {
        try { const x = new URL(u, location.href); return x.origin + x.pathname; }
        catch (_) { return String(u || ""); }
      };
      const hrefOf = (sel, root) => {
        const el = first(sel, root);
        if (!el) return "";
        try { return new URL(el.getAttribute("href"), location.href).href; } catch (_) { return ""; }
      };
      /* 保留段落 / 列表 / 加粗等结构，供消息视图原样排版 */
      const htmlOf = (el) => {
        if (!el) return "";
        try {
          const c = el.cloneNode(true);
          c.querySelectorAll("script,style,button,iframe,video,form,input,.ContentItem-more,.RichContent-hide,[class*='advert']").forEach(n => n.remove());
          [c, ...Array.from(c.querySelectorAll("*"))].forEach(n => {
            Array.from(n.attributes || []).forEach(a => {
              if (/^on/.test(a.name) || a.name === "style" ||
                  (a.name === "href" && !/^(https?:|#|\/)/i.test(a.value))) n.removeAttribute(a.name);
            });
            if (n.tagName === "IMG") {
              const s = n.getAttribute("data-actualsrc") || n.getAttribute("data-src") || n.getAttribute("src");
              if (s && /^https?:/i.test(s)) n.setAttribute("src", s); else n.remove();
            }
          });
          return c.innerHTML.slice(0, 20000);
        } catch (_) { return ""; }
      };
      const CARD = ".TopstoryItem, .ContentItem, .HotItem, .SearchResult-Card, .List-item";
      const LINK = 'a[href*="/question/"], a[href*="/p/"], a[href*="/zvideo/"], a[href*="/answer/"], a[href*="/pin/"]';
      const cardCount = () => qsa(CARD).length;

      /* 知乎首页是虚拟列表：一旦把 window 滚到底，上方推荐卡片会被卸载，
         整页反而抓空（实测 cards 从 40+ 掉到 0）。所以这里绝不主动滚动，
         只在页面已被推离顶部时复位，靠多轮轮询 + 链接合并累积新内容。 */
      const before = cardCount();
      try {
        if ((window.scrollY || 0) > 80) {
          window.scrollTo(0, 0);
          window.dispatchEvent(new Event("scroll"));
        }
        qsa("button").filter((b) =>
          /^(查看更多|加载更多|更多回答|展开更多|显示全部|查看全部)/.test(clean(b.innerText || b.textContent))
        ).slice(0, 2).forEach((b) => { try { b.click(); } catch (_) {} });
      } catch (_) {}
      await sleep(200);

      const seen = new Set();
      const out = [];
      const push = (name, url, card) => {
        const n = clean(name);
        if (n.length < 4 || n.length > 120) return;
        if (/^(登录|注册|知乎|首页|发现|关注|推荐|热榜|更多|设置|帮助|下载|搜索|等待|等一分钟)$/.test(n)) return;
        const raw = url || hrefOf(LINK, card) || "";
        const u = raw ? normLink(raw) : "";
        const k = norm(u) || n;
        if (seen.has(k)) return;
        seen.add(k);
        const subEl = card && first(".RichContent-inner, .HotItem-excerpt, .ContentItem-excerpt, .SearchItem-snippet", card);
        const auEl = card && first(".AuthorInfo-name, .HotItem-meta, .FeedSource, .UserLink-link", card);
        const voteEl = card && first(".VoteButton--up", card);
        const timeEl = card && first(".ContentItem-time, .FeedSource-time, .HotItem-metrics", card);
        const sub = clean(subEl ? subEl.innerText : "").replace(/[….·\s]*阅读全文\s*$/, "");
        const tm = /刚刚|\d+\s*(?:分钟|小时|天)前|昨天|前天|\d{1,2}月\d{1,2}日/
          .exec(clean(timeEl ? timeEl.innerText : ""));
        out.push({
          n: n.slice(0, 80),
          d: (sub || n).slice(0, 60),
          body: sub || "点标题查看该问题的完整回答",
          html: htmlOf(subEl),
          author: clean(auEl ? auEl.innerText : "") || "知乎答主",
          stats: clean(voteEl ? "赞同 " + (voteEl.innerText || "").replace(/^赞同\s*/, "") : ""),
          t: tm ? tm[0] : "",
          url: u,
        });
      };

      qsa(CARD).forEach((c) => {
        if (first(".TopstoryItem--advertCard, .Pc-card, .Pc-word, [class*='ADLinkCard']", c)) return;
        const t = first(".ContentItem-title, .HotItem-title, .SearchResult-title, h2", c);
        push(t ? t.innerText : "", hrefOf(LINK, c), c);
      });
      /* 补充不在标准卡片里的独立标题链接（热榜 / 搜索结果 / 侧栏推荐） */
      qsa(LINK).forEach((a) => {
        const n = clean(a.innerText || a.textContent);
        if (n.length < 6) return;
        push(n, a.href || "", a.closest(CARD) || a.parentElement);
      });

      if (out.length >= 3) return R("ok", out.slice(0, 40), { domCards: cardCount(), before: before });

      const body = clean((document.body && document.body.innerText) || "").slice(0, 400);
      const title = document.title || "";
      if (/signin|login/i.test(location.href) || /登录后|立即登录|扫码登录|登录知乎/.test(body)) return R("login");
      if (/安全验证|身份验证|访问受限|请稍候|Just a moment/i.test(title + body)) return R("blocked");
      return R("empty");
    },

    /* X：推文卡片，未登录时是登录墙 */
    x: async function () {
      const clean = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
      const R = (state, items) => JSON.stringify({ state: state, items: items || [] });
      const arts = Array.from(document.querySelectorAll('article[data-testid="tweet"], article'))
        .filter((el) => !(el.closest && el.closest("#wb-pack")));
      const seen = new Set();
      const out = [];
      for (const a of arts) {
        const txtEl = a.querySelector('[data-testid="tweetText"]');
        const nameEl = a.querySelector('[data-testid="User-Name"]');
        const link = a.querySelector('a[href*="/status/"]');
        const timeEl = a.querySelector("time");
        const d = clean(txtEl ? txtEl.innerText : "");
        if (d.length < 4) continue;
        const key = d.slice(0, 40);
        if (seen.has(key)) continue;
        seen.add(key);
        const n = clean(nameEl ? nameEl.innerText : "").split("\n")[0];
        out.push({
          n: (n || "动态").slice(0, 24),
          d: d.slice(0, 70),
          body: d,
          author: n || "X 用户",
          t: timeEl ? (timeEl.getAttribute("datetime") || "").slice(5, 10).replace("-", "/") : "",
          ts: timeEl ? timeEl.getAttribute("datetime") || "" : "",
          url: link ? link.href : "",
        });
        if (out.length >= 18) break;
      }
      if (out.length >= 2) return R("ok", out);

      const body = clean((document.body && document.body.innerText) || "").slice(0, 400);
      const title = document.title || "";
      if (/Sign in|Log in|登录 X|Don't miss what's happening|Happening now/i.test(body + title)) return R("login");
      if (/Something went wrong|Retry|Just a moment|请稍候|This browser is no longer supported/i.test(body + title)) return R("blocked");
      return R("empty");
    },

    /* 小红书：发现页笔记卡片，字段与知乎对齐（标题 / 摘要 / 作者 / 时间 / 赞 / 链接） */
    xhs: async function () {
      const clean = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
      const R = (state, items) => JSON.stringify({ state: state, items: items || [] });
      const qsa = (sel, root) => Array.from((root || document).querySelectorAll(sel))
        .filter((el) => !(el.closest && el.closest("#wb-pack")));
      const first = (sel, root) => { const a = qsa(sel, root); return a.length ? a[0] : null; };
      const txt = (sel, root) => { const el = first(sel, root); return clean(el ? (el.innerText || el.textContent) : ""); };
      const norm = (u) => {
        try { const x = new URL(u, location.href); return x.origin + x.pathname; }
        catch (_) { return String(u || ""); }
      };
      /* 发现页是虚拟瀑布流：绝不主动滚到底，否则上方卡片会被卸载（同知乎） */
      try {
        if ((window.scrollY || 0) > 80) {
          window.scrollTo(0, 0);
          window.dispatchEvent(new Event("scroll"));
        }
      } catch (_) {}
      await new Promise((r) => setTimeout(r, 200));

      const seen = new Set();
      const out = [];
      const push = (c) => {
        /* 卡片里第一个 <a> 是隐藏的无 token 链接，必须优先取带 xsec_token 的，
           否则点会话会跳到 404「当前笔记暂时无法浏览」 */
        const a = c.tagName === "A"
          ? (String(c.href || "").indexOf("xsec_token") >= 0 ? c : null)
          : first('a[href*="xsec_token"]', c) ||
            first('a[href*="/explore/"], a[href*="/discovery/item/"]', c) || first("a", c);
        if (!a) return;
        const href = a.href || "";
        if (!/\/explore\/|\/discovery\/item\//.test(href)) return;
        const k = norm(href);
        if (seen.has(k)) return;
        seen.add(k);
        const n = clean(txt(".title, .note-title, [class*='title'] span", c) || a.innerText || a.textContent);
        if (n.length < 4 || n.length > 120) return;
        const author = txt(".author .name, .author-wrapper .name, [class*='author'] span", c);
        const desc = txt(".desc, .note-desc, [class*='desc']", c);
        const like = txt(".like-wrapper .count, [class*='like'] .count, .count", c);
        const stats = /\d/.test(like) ? "赞 " + like.slice(0, 12) : "";
        const cover = first("img", c);
        const cs = cover ? (cover.getAttribute("data-src") || cover.getAttribute("src") || "") : "";
        let html = "";
        if (/^https?:/i.test(cs)) {
          const box = document.createElement("div");
          box.textContent = n;
          const im = document.createElement("img");
          im.setAttribute("src", cs);
          im.setAttribute("class", "wb-cover");
          im.setAttribute("loading", "lazy");
          box.appendChild(im);
          html = box.innerHTML;
        }
        out.push({
          n: n.slice(0, 80),
          d: (desc || (author ? author + " · " + (stats || "笔记") : n)).slice(0, 60),
          body: desc || n,
          html: html,
          author: author || "小红书作者",
          stats: stats,
          t: txt(".time, [class*='time']", c).slice(0, 16),
          url: href,
        });
      };
      qsa('section.note-item, .note-item, a[href*="/explore/"], a[href*="/discovery/item/"]').forEach(push);
      qsa('a[href*="/explore/"], a[href*="/discovery/item/"]').forEach(push);
      if (out.length >= 3) return R("ok", out.slice(0, 40));

      const body = clean((document.body && document.body.innerText) || "").slice(0, 400);
      const title = document.title || "";
      if (/登录|扫码|手机号登录|验证码|登录后查看/.test(body) || /login/i.test(location.href)) return R("login");
      if (/安全验证|访问受限|请稍候|Just a moment/i.test(title + body)) return R("blocked");
      return R("empty");
    },
  };

  /* 全文提取器：在 webview 页面内同源请求，天然复用登录态。
     统一返回 { state:"ok"|"empty"|"error", title, text, posts:[{user,time,text,floor}] }
     函数体必须完全自包含（会被 toString 后注入）。 */
  window.FULLTEXT = {
    /* linux.do：Discourse 的 /t/{id}.json 直接给出首楼与每层回复，
       不依赖网页渲染（人机验证页也能读），并保留正文 HTML 结构 */
    linuxdo: async function (url) {
      const R = (state, data) => JSON.stringify(Object.assign({ state: state }, data || {}));
      const docOf = (html) => {
        try { return new DOMParser().parseFromString(String(html || ""), "text/html"); }
        catch (e) { return null; }
      };
      const plain = (doc) => {
        if (!doc || !doc.body) return "";
        doc.querySelectorAll("br").forEach((b) => b.replaceWith("\n"));
        doc.querySelectorAll("p,div,li,blockquote,pre,h1,h2,h3").forEach((p) => p.append("\n"));
        return (doc.body.innerText || doc.body.textContent || "")
          .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
      };
      const rich = (doc) => {
        if (!doc || !doc.body) return "";
        try {
          doc.querySelectorAll("script,style,button,iframe,video,audio,form,input,select,textarea,svg,canvas,noscript,.lightbox,.meta-line")
            .forEach((n) => n.remove());
          const nodes = [doc.body].concat(Array.from(doc.body.querySelectorAll("*")));
          nodes.forEach((n) => {
            Array.from(n.attributes || []).forEach((a) => {
              const nm = a.name.toLowerCase(), v = String(a.value || "");
              if (/^on/.test(nm) || nm === "style" ||
                  (nm === "href" && !/^(https?:|#|\/)/i.test(v)) ||
                  (nm === "src" && /^(data|javascript):/i.test(v))) {
                try { n.removeAttribute(a.name); } catch (_) {}
              }
            });
            if (n.tagName === "IMG") {
              const s = n.getAttribute("data-src") || n.getAttribute("src") || "";
              if (!/^https?:/i.test(s)) { n.remove(); return; }
              n.setAttribute("src", s);
            }
            if (n.tagName === "A") { n.setAttribute("target", "_self"); n.setAttribute("rel", "noopener noreferrer"); }
          });
          return doc.body.innerHTML.slice(0, 30000);
        } catch (e) { return ""; }
      };
      try {
        const m = /\/t\/[^/]+\/(\d+)/.exec(url) || /\/(\d+)(?:[?#]|$)/.exec(url);
        if (!m) return R("error");
        const r = await fetch("/t/" + m[1] + ".json", { headers: { Accept: "application/json" } });
        if (!r.ok) return R("error");
        const d = await r.json();
        const posts = ((d.post_stream && d.post_stream.posts) || []).slice(0, 80).map((p) => {
          const doc = docOf(p.cooked);
          const doc2 = docOf(p.cooked);
          return {
            user: p.username || p.name || "匿名",
            time: String(p.created_at || "").slice(5, 16).replace("T", " "),
            text: plain(doc),
            html: rich(doc2),
            floor: p.post_number || 0,
            stats: "",
          };
        });
        return posts.length ? R("ok", { title: d.title || "", posts: posts }) : R("empty");
      } catch (e) {
        return R("error");
      }
    },

    /* 通用：同源 fetch 文章页 HTML → DOMParser 取最长正文块 */
    generic: async function (url) {
      const R = (state, data) => JSON.stringify(Object.assign({ state: state }, data || {}));
      try {
        if (!/^https?:\/\//.test(url)) return R("error");
        const r = await fetch(url, { credentials: "include" });
        if (!r.ok) return R("error");
        const html = await r.text();
        const doc = new DOMParser().parseFromString(html, "text/html");
        /* 只认精确正文容器，不用 main/#content 这类宽泛选择器，
           否则会把页脚导航、备案信息当成正文读回来 */
        const sels = [
          ".Post-RichText", ".RichText", ".RichContent-inner", ".ContentItem-answer",
          ".AnswerItem .RichText", ".topic-post .cooked", "#post_1 .cooked",
          "article .cooked", ".markdown-body", ".article-content", ".note-content",
        ];
        const isNoise = (t) => {
          const marks = ["帮助中心", "知乎协议", "ICP备", "举报中心", "关于知乎", "投资者关系",
            "网站资信", "违法和不良信息", "用户协议", "隐私指引", "京公网安备", "下载知乎"];
          let hit = 0;
          for (const w of marks) if (t.indexOf(w) >= 0) hit++;
          const lines = t.split("\n").filter((x) => x.trim());
          const short = lines.filter((l) => l.trim().length < 12).length;
          return hit >= 3 || (lines.length > 8 && short / lines.length > 0.7);
        };
        let best = "";
        for (const s of sels) {
          const nodes = doc.querySelectorAll(s);
          for (const n of nodes) {
            const t = (n.innerText || n.textContent || "").replace(/\s+\n/g, "\n").trim();
            if (t.length > best.length && !isNoise(t)) best = t;
          }
        }
        if (best.length < 250) return R("empty");
        return R("ok", { title: (doc.title || "").trim(), text: best.slice(0, 12000), posts: [] });
      } catch (e) {
        return R("error");
      }
    },

    /* 从「当前已渲染」的详情页 DOM 抓全部楼层：点会话后自动调用，
       返回逐条 { user,time,text,floor,html,stats }，html 保留段落 / 编号列表 / 图片。
       参考原项目 cleanRich()：正文按楼层拆开，不压成一坨文字。 */
    capture: async function () {
      const R = (state, data) => JSON.stringify(Object.assign({ state: state }, data || {}));
      const clean = (s) => String(s == null ? "" : s)
        .replace(/\u200B|\u200E/g, "").replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n").trim();
      const one = (s) => clean(String(s == null ? "" : s).replace(/\s+/g, " "));
      /* 包装容器里复用了原网页 class，必须排除，否则会把气泡内容再抓一遍 */
      const qsa = (sel, root) => Array.from((root || document).querySelectorAll(sel))
        .filter((el) => !(el.closest && el.closest("#wb-pack")));
      const first = (sel, root) => { const a = qsa(sel, root); return a.length ? a[0] : null; };
      const txt = (sel, root) => { const el = first(sel, root); return clean(el ? (el.innerText || el.textContent) : ""); };
      /* 同一个 clone 同时产出纯文本兜底与富文本 HTML */
      const prep = (el) => {
        if (!el) return null;
        try {
          const c = el.cloneNode(true);
          c.querySelectorAll("script,style,iframe,video,audio,button,form,input,select,textarea,svg,canvas,noscript," +
            ".ContentItem-more,.RichContent-hide,.QuestionRichText-more,.zh-expand,[class*='advert'],[class*='ADLinkCard']")
            .forEach((n) => n.remove());
          const nodes = [c].concat(Array.from(c.querySelectorAll("*")));
          nodes.forEach((node) => {
            Array.from(node.attributes || []).forEach((a) => {
              const n = a.name.toLowerCase(), v = String(a.value || "");
              if (/^on/.test(n) || n === "style" ||
                  (n === "href" && !/^(https?:|#|\/)/i.test(v)) ||
                  (n === "src" && /^(data|javascript):/i.test(v))) {
                try { node.removeAttribute(a.name); } catch (_) {}
              }
            });
            if (node.tagName === "IMG") {
              const real = node.getAttribute("data-actualsrc") || node.getAttribute("data-src") || node.getAttribute("src") || "";
              if (!/^https?:/i.test(real)) { node.remove(); return; }
              node.setAttribute("src", real);
              node.setAttribute("loading", "lazy");
            }
            if (node.tagName === "A") { node.setAttribute("target", "_self"); node.setAttribute("rel", "noopener noreferrer"); }
          });
          return c;
        } catch (_) { return null; }
      };
      const textOf = (c) => {
        if (!c) return "";
        const t = clean(c.innerText || c.textContent || "");
        return t.replace(/[\s…·]*阅读全文[\s›»]*$/g, "")
          .replace(/[\s…·]*显示全部[\s›»]*$/g, "")
          .replace(/[\s…·]*收起[\s‹«]*$/g, "").slice(0, 12000);
      };
      const htmlOf = (c) => (c ? c.innerHTML.slice(0, 30000) : "");
      const mk = (user, time, text, floor, html, stats) => ({
        user: one(user) || "匿名", time: one(time), text: text || "",
        floor: floor || 0, html: html || "", stats: one(stats),
      });
      const statOf = (card) => {
        const acts = txt(".ContentItem-actions, .Actions, .ContentItem-action, [class*='ContentItem-actions']", card);
        const parts = [];
        const vote = txt(".VoteButton--up, [data-testid='like']", card);
        if (vote) parts.push("赞同 " + one(vote).replace(/^赞同\s*/, ""));
        else {
          const vm = /赞同\s*([\d.]+\s*万?)/.exec(acts) || /([\d.]+\s*万?)\s*人赞同/.exec(acts);
          if (vm) parts.push("赞同 " + vm[1]);
        }
        const cm = /([\d.]+\s*万?\s*条(?:评论|回复))/.exec(acts);
        if (cm) parts.push(cm[1]);
        return parts.join(" · ");
      };
      try {
        const posts = [];
        let title = "";
        /* 知乎虚拟列表：停在底部时上方回答会被卸载，楼层就抓不全。
           只复位到顶部 + 点「更多回答」类按钮，绝不主动把页面推到底。 */
        if (/zhihu\.com/.test(location.hostname)) {
          try {
            if ((window.scrollY || 0) > 80) {
              window.scrollTo(0, 0);
              window.dispatchEvent(new Event("scroll"));
            }
            qsa("button").filter((b) =>
              /^(查看更多回答|加载更多|更多回答|展开更多|显示全部)/.test(String(b.innerText || b.textContent || "").trim())
            ).slice(0, 2).forEach((b) => { try { b.click(); } catch (_) {} });
          } catch (_) {}
          await new Promise((r) => setTimeout(r, 250));
        }

        /* linux.do：Discourse 话题页每个 .topic-post 就是一层 */
        const ldo = qsa(".topic-post");
        if (ldo.length) {
          title = txt(".topic-title h1, #topic-title h1, .fancy-title") || document.title;
          ldo.slice(0, 80).forEach((p, i) => {
            const cooked = first(".cooked", p);
            const c = prep(cooked);
            const t = textOf(c);
            if (!t) return;
            const tm = first("time, .post-date, .post-time", p);
            posts.push(mk(
              txt(".username, .names .username, [data-user-card]", p) || "坛友",
              tm ? String(tm.getAttribute("datetime") || tm.innerText || "").slice(0, 16).replace("T", " ") : "",
              t, i + 1, htmlOf(c), ""
            ));
          });
        }

        /* 知乎：问题页逐条回答；新版单回答页退化为正文容器 */
        if (!posts.length) {
          let answers = qsa(".AnswerItem, .ContentItem-answer");
          const richs = qsa(".RichContent-inner, .Post-RichTextContainer, .Post-RichText, .ZVideo-description")
            .filter((el) => !el.closest(".QuestionRichText") &&
              !(el.parentElement && el.parentElement.closest(".RichContent-inner")));
          if (richs.length > answers.length) answers = richs;
          if (answers.length) {
            title = txt(".QuestionHeader-title, .Post-Title, .ZVideo-title, h1") || document.title;
            const descEl = first(".QuestionRichText, .QuestionHeader-detail");
            const dc = prep(descEl);
            const desc = textOf(dc);
            if (desc) posts.push(mk("问题描述", "", desc, 0, htmlOf(dc), ""));
            answers.slice(0, 80).forEach((a, i) => {
              const rich = first(".RichContent-inner, .RichText, .Post-RichText", a) || a;
              const c = prep(rich);
              const t = textOf(c);
              if (!t || t.length < 8) return;
              const auSel = ".AuthorInfo-name, .UserLink-link, .AuthorInfo .name, .Post-Author, .ContentItem-meta .author";
              let au = txt(auSel, a) || txt(auSel, a.parentElement || document);
              if (!au) { const m = /^([^\n：:]{2,16})[：:]/.exec(t); if (m) au = m[1]; }
              posts.push(mk(au, txt(".ContentItem-time, .Post-Time, time", a), t, i + 1, htmlOf(c), statOf(a)));
            });
          }
        }

        /* X：时间线逐条推文 */
        if (!posts.length) {
          const arts = qsa('article[data-testid="tweet"], article');
          arts.slice(0, 40).forEach((a, i) => {
            const el = first('[data-testid="tweetText"], [lang]', a);
            const c = prep(el);
            const t = textOf(c);
            if (!t || t.length < 4) return;
            const tm = first("time", a);
            posts.push(mk(
              one(txt('[data-testid="User-Name"]', a)).split("\n")[0] || "X 用户",
              tm ? String(tm.getAttribute("datetime") || "").slice(5, 16).replace("T", " ") : "",
              t, i + 1, htmlOf(c), ""
            ));
          });
          if (posts.length) title = txt('[data-testid="User-Name"]') || document.title;
        }

        /* 小红书：首楼笔记正文 + 图集，评论逐条成楼层（与知乎多回答同形式） */
        if (!posts.length && /xiaohongshu\.com/.test(location.hostname)) {
          title = txt("#detail-title, .title, .note-title") || document.title;
          const author = txt(".author-container .username, .author .name, .username") || "小红书作者";
          const note = first(".note-content, #detail-desc, .desc, .note-desc");
          let body = "", html = "";
          if (note) {
            const c = prep(note);
            body = textOf(c);
            html = htmlOf(c);
          }
          /* 图集：正文容器里没有图片时单独补上，最多 9 张 */
          const frag = document.createElement("div");
          qsa(".media-container img, .note-image img, .swiper-slide img, .image-container img, .carousel img")
            .slice(0, 9).forEach((im) => {
              const s = im.getAttribute("data-src") || im.getAttribute("src") || "";
              if (!/^https?:/i.test(s)) return;
              const n = document.createElement("img");
              n.setAttribute("src", s);
              n.setAttribute("class", "wb-cover");
              n.setAttribute("loading", "lazy");
              frag.appendChild(n);
            });
          html += frag.innerHTML;
          if (body || html) posts.push(mk(author, "", body || title, 1, html, ""));

          const cmts = qsa(".comments-container .comment-item, .comment-item, .parent-comment, [class*='comment-item']");
          const seenC = new Set();
          cmts.slice(0, 80).forEach((c) => {
            const el = first(".content, .comment-content, .note-text, [class*='content']", c) || c;
            const cc = prep(el);
            const t = textOf(cc);
            if (!t || t.length < 2 || seenC.has(t.slice(0, 40))) return;
            seenC.add(t.slice(0, 40));
            const like = txt(".like .count, [class*='like'] .count", c);
            posts.push(mk(
              txt(".author .name, .user-name, .nickname, [class*='author']", c) || "小红书用户",
              txt(".time, .date, [class*='time']", c),
              t, posts.length + 1, htmlOf(cc), like ? "赞 " + like : ""
            ));
          });
        }

        if (posts.length) return R("ok", { title: title, posts: posts.slice(0, 80), text: "" });

        /* 通用兜底：取最长正文块 */
        const sels = [
          ".Post-RichText", ".RichText", ".RichContent-inner", ".ContentItem-answer",
          ".AnswerItem .RichText", ".markdown-body", ".article-content", ".note-content",
        ];
        const isNoise = (t) => {
          const marks = ["帮助中心", "知乎协议", "ICP备", "举报中心", "关于知乎", "投资者关系",
            "网站资信", "违法和不良信息", "用户协议", "隐私指引", "京公网安备", "下载知乎"];
          let hit = 0;
          for (const w of marks) if (t.indexOf(w) >= 0) hit++;
          const lines = t.split("\n").filter((x) => x.trim());
          const short = lines.filter((l) => l.trim().length < 12).length;
          return hit >= 3 || (lines.length > 8 && short / lines.length > 0.7);
        };
        let best = "", bestHtml = "";
        for (const s of sels) {
          for (const n of qsa(s)) {
            const c = prep(n);
            const t = textOf(c);
            if (t.length > best.length && !isNoise(t)) { best = t; bestHtml = htmlOf(c); }
          }
        }
        if (best.length < 120) return R("empty");
        return R("ok", { title: document.title || "", text: best.slice(0, 12000), html: bestHtml, posts: [] });
      } catch (e) {
        return R("error");
      }
    },
  };
})();
