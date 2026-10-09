/* AI 短影音工作坊：讀 window.COURSE（content.js）渲染單頁。無外部相依。 */
(function () {
  'use strict';

  var LS_TRACK = 'aiws.track';
  var LS_TEACHER = 'aiws.teacher';
  var COPY_RESET_MS = 2000;

  var C = window.COURSE;
  var state = { track: 'anim', teacher: false };
  var timerUI = {};             // 節次 index -> { btn, disp, card, minutes }
  var timer = { idx: -1, endAt: 0, iv: 0 };
  var navItems = [];            // 節次 index -> 課表 <a>
  var cards = [];               // 節次 index -> <article>

  /* ---------- 小工具 ---------- */
  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* 無痕模式等 */ } }
  function str(v) { return v == null ? '' : String(v); }
  function arr(v) { return Array.isArray(v) ? v : []; }
  function safeId(s) { return str(s).replace(/[^A-Za-z0-9_-]/g, ''); }
  function safeUrl(u) { u = str(u).trim(); return /^https?:\/\//i.test(u) ? u : ''; }
  function $(id) { return document.getElementById(id); }

  // 只用 textContent 建 DOM，內容不經 innerHTML，避免注入
  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null || v === false) return;
        if (k === 'class') el.className = v;
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : String(v));
      });
    }
    add(el, kids);
    return el;
  }
  function add(el, kids) {
    if (kids == null) return el;
    (Array.isArray(kids) ? kids : [kids]).forEach(function (c) {
      if (c == null || c === false || c === '') return;
      el.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
    });
    return el;
  }

  /* ---------- 時間（台北） ---------- */
  function parseRange(t) {
    var m = str(t).match(/(\d{1,2}):(\d{2})\s*[–—\-~～至到]\s*(\d{1,2}):(\d{2})/);
    if (!m) return null;
    return { start: +m[1] * 60 + +m[2], end: +m[3] * 60 + +m[4] };
  }
  function taipeiNowMinutes() {
    var d = new Date();                       // 台灣無日光節約，固定 UTC+8
    return ((d.getUTCHours() + 8) % 24) * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60;
  }
  function currentSectionIndex() {
    var now = taipeiNowMinutes();
    var secs = arr(C.sections);
    for (var i = 0; i < secs.length; i++) {
      var r = parseRange(secs[i].time);
      if (r && now >= r.start && now < r.end) return i;
    }
    return -1;
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function fmt(sec) { sec = Math.max(0, sec); return pad2(Math.floor(sec / 60)) + ':' + pad2(sec % 60); }

  /* ---------- 複製 ---------- */
  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;font-size:16px;';
    document.body.appendChild(ta);
    var ok = false;
    try {
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      ok = document.execCommand('copy');
    } catch (e) { ok = false; }
    document.body.removeChild(ta);
    if (!ok) throw new Error('copy failed');
    return true;
  }
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).catch(function () { return fallbackCopy(text); });
    }
    return new Promise(function (resolve) { resolve(fallbackCopy(text)); });
  }
  function copyBtn(getText, label, extraClass) {
    label = label || '複製';
    var btn = h('button', { type: 'button', class: 'btn copy-btn' + (extraClass ? ' ' + extraClass : '') }, label);
    var t = 0;
    btn.addEventListener('click', function () {
      clearTimeout(t);
      copyText(str(getText())).then(function () {
        btn.textContent = '已複製 ✓';
        btn.className = btn.className.replace(/ ?(done|fail)/g, '') + ' done';
      }, function () {
        btn.textContent = '請長按文字複製';
        btn.className = btn.className.replace(/ ?(done|fail)/g, '') + ' fail';
      }).then(function () {
        t = setTimeout(function () {
          btn.textContent = label;
          btn.className = btn.className.replace(/ ?(done|fail)/g, '');
        }, COPY_RESET_MS);
      });
    });
    return btn;
  }

  /* ---------- 共用元件 ---------- */
  function trackLabel(tr) {
    var t = C.tracks && C.tracks[tr];
    return str(t && t.label) || (tr === 'real' ? '真人軌' : '動畫軌');
  }

  // 截圖：先試 .jpg，失敗再試 .png，兩者都沒有才顯示灰框
  var SHOT_EXTS = ['.jpg', '.png'];
  function shotFigure(id) {
    var base = 'assets/shots/' + id;
    var fig = h('figure', { class: 'shot' });
    var img = h('img', { alt: '截圖：' + id, loading: 'lazy', decoding: 'async' });
    var link = h('a', { href: base + SHOT_EXTS[0], target: '_blank', rel: 'noopener', 'aria-label': '放大截圖' }, img);
    var tryIdx = 0;
    img.addEventListener('error', function () {
      tryIdx++;
      if (tryIdx < SHOT_EXTS.length) {
        link.setAttribute('href', base + SHOT_EXTS[tryIdx]);
        img.src = base + SHOT_EXTS[tryIdx];
        return;
      }
      fig.textContent = '';
      fig.appendChild(h('div', { class: 'shot-missing' }, '截圖：' + id));
    });
    img.src = base + SHOT_EXTS[0];
    fig.appendChild(link);
    return fig;
  }

  function stepsList(steps) {
    return h('ol', { class: 'steps' }, arr(steps).map(function (s, i) {
      var st = typeof s === 'string' ? { text: s } : (s || {});
      var shot = safeId(st.shot);
      return h('li', { class: 'step' + (shot ? ' has-shot' : '') }, [
        h('span', { class: 'step-num', 'aria-hidden': 'true' }, String(i + 1)),
        h('div', { class: 'step-text' }, str(st.text)),
        shot ? shotFigure(shot) : null
      ]);
    }));
  }

  function videoBox(rawId, caption) {
    var id = safeId(rawId);
    var fig = h('figure', { class: 'video-box' });
    if (!id) return fig;
    var v = h('video', { controls: true, playsinline: true, preload: 'metadata' });
    v.addEventListener('error', function () {
      fig.replaceChild(h('div', { class: 'video-missing', role: 'img', 'aria-label': '影片準備中' },
        ['影片準備中', h('small', null, id + '.mp4')]), v);
    });
    v.src = 'assets/videos/' + id + '.mp4';
    fig.appendChild(v);
    if (caption) fig.appendChild(h('figcaption', null, caption));
    return fig;
  }

  function promptCard(p) {
    p = p || {};
    var a = str(p.anim || p.real), r = str(p.real || p.anim);
    var same = a === r;
    var getText = function () { return same ? a : (state.track === 'real' ? r : a); };
    return h('div', { class: 'prompt-card' + (same ? ' same' : '') }, [
      h('div', { class: 'prompt-head' }, [
        h('h4', { class: 'prompt-title' }, [
          str(p.title) || '提示詞',
          same ? h('span', { class: 'track-tag' }, '兩軌通用')
            : [h('span', { class: 'track-tag tag-anim' }, trackLabel('anim')),
               h('span', { class: 'track-tag tag-real' }, trackLabel('real'))]
        ].flat()),
        copyBtn(getText)
      ]),
      same ? h('pre', { class: 'prompt-text' }, a)
        : [h('pre', { class: 'prompt-text pt-anim' }, a), h('pre', { class: 'prompt-text pt-real' }, r)],
      p.note ? h('p', { class: 'prompt-note' }, '小提醒：' + str(p.note)) : null
    ].flat());
  }

  function exampleItem(x) {
    if (x == null) return null;
    if (typeof x !== 'object') return h('li', null, str(x));
    var title = str(x.title || x.name);
    var body = str(x.text || x.desc || x.description || x.prompt || x.content);
    return h('li', null, [title ? h('strong', null, title + (body ? '：' : '')) : null, body]);
  }

  /* ---------- 區塊 ---------- */
  function renderHero() {
    var m = C.meta || {};
    if (m.title) { document.title = str(m.title); $('hero-title').textContent = str(m.title); }
    var hero = $('top');
    var poster = hero.querySelector('.poster');
    poster.alt = str(m.title) ? str(m.title) + ' 海報' : '課程海報';
    hero.classList.add('has-poster');
    poster.addEventListener('error', function () { poster.remove(); hero.classList.remove('has-poster'); });
    if (poster.complete && poster.naturalWidth === 0) { poster.remove(); hero.classList.remove('has-poster'); }

    var goal = str(m.goal || m.todayGoal || m.objective);
    if (!goal) {
      var firstLesson = arr(C.sections).filter(function (s) { return (s.type || 'lesson') === 'lesson'; })[0];
      goal = str(firstLesson && firstLesson.goal);
    }
    var subParts = [str(m.date), str(m.organizer)].filter(Boolean);
    var meta = $('hero-meta');
    add(meta, [
      h('p', { class: 'hero-line' }, [
        m.subtitle ? h('span', { class: 'subtitle' }, str(m.subtitle)) : null,
        goal ? h('span', { class: 'today-goal' }, [h('b', null, '今天目標'), goal]) : null
      ]),
      subParts.length ? h('p', { class: 'hero-sub' }, subParts.join('｜')) : null
    ]);
    if (C.tracks) {
      meta.appendChild(h('div', { class: 'track-cards' }, ['anim', 'real'].map(function (tr) {
        var t = C.tracks[tr] || {};
        return h('button', { type: 'button', class: 'track-card', 'data-track': tr, onclick: function () { setTrack(tr); } },
          [h('b', null, trackLabel(tr)), h('span', null, str(t.desc))]);
      })));
    }
  }

  function renderToolbar() {
    var links = (C.meta && C.meta.links) || {};
    var defs = [['gemini', 'Gemini'], ['flow', 'Flow'], ['drive', '班級雲端']];
    var box = $('tb-links');
    defs.forEach(function (d) {
      var url = safeUrl(links[d[0]]);
      if (!url && d[0] === 'drive') return;   // 班級雲端沒連結就完全不顯示
      box.appendChild(url
        ? h('a', { class: 'btn link-btn', href: url, target: '_blank', rel: 'noopener noreferrer' }, [d[1], h('span', { class: 'ext', 'aria-hidden': 'true' }, ' ↗')])
        : h('span', { class: 'btn link-btn disabled', 'aria-disabled': 'true', title: '尚未提供連結' }, d[1]));
    });
    Array.prototype.forEach.call(document.querySelectorAll('.track-btn'), function (b) {
      b.textContent = trackLabel(b.getAttribute('data-track'));
      b.addEventListener('click', function () { setTrack(b.getAttribute('data-track')); });
    });
    $('teacher-toggle').addEventListener('click', function () { setTeacher(!state.teacher); });
    $('tt-stop').addEventListener('click', stopTimer);
    $('tt-label').addEventListener('click', function () {
      if (timer.idx >= 0 && cards[timer.idx]) cards[timer.idx].scrollIntoView({ block: 'start' });
    });

    // 手機課表開合
    var nav = $('schedule'), tog = $('nav-toggle');
    function setNav(open) {
      nav.classList.toggle('open', open);
      tog.setAttribute('aria-expanded', open ? 'true' : 'false');
      tog.textContent = open ? '課表 ▴' : '課表 ▾';
    }
    tog.addEventListener('click', function (e) { e.stopPropagation(); setNav(!nav.classList.contains('open')); });
    nav.addEventListener('click', function (e) { if (e.target.closest('a')) setNav(false); });
    document.addEventListener('click', function (e) {
      if (nav.classList.contains('open') && !nav.contains(e.target)) setNav(false);
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setNav(false); });

    // 工具列高度 → CSS 變數（sticky 偏移與錨點捲動）
    var tb = $('toolbar');
    function syncH() { document.documentElement.style.setProperty('--toolbar-h', tb.offsetHeight + 'px'); }
    syncH();
    if (window.ResizeObserver) new ResizeObserver(syncH).observe(tb);
    else window.addEventListener('resize', syncH);
  }

  function navLink(href, cls, time, mins, title) {
    return h('li', null, h('a', { class: 'sched-item ' + cls, href: href }, [
      h('span', { class: 'sched-time' }, time),
      h('span', { class: 'sched-min' }, mins),
      h('span', { class: 'sched-title' }, title)
    ]));
  }

  function sectionCard(s, idx) {
    s = s || {};
    var type = (s.type === 'break' || s.type === 'lunch') ? s.type : 'lesson';
    var mins = Number(s.minutes) || 0;
    var id = 'sec-' + (safeId(s.id) || idx);
    var card = h('article', { class: 'section-card type-' + type + (s.minimal ? ' minimal' : ''), id: id, 'aria-labelledby': id + '-t' });

    add(card, h('header', { class: 'sec-head' }, [
      h('h2', { class: 'sec-title', id: id + '-t' }, str(s.title)),
      h('span', { class: 'time-badge' }, str(s.time) + (mins ? '｜' + mins + ' 分' : ''))
    ]));
    // minimal 節次（16:25 比賽活動辦法）：只留大標題＋時間徽章，不渲染講師要點、計時、步驟等
    if (s.minimal) { cards[idx] = card; return card; }
    if (s.goal) add(card, h('p', { class: 'goal' }, str(s.goal)));

    // 講師要點＋倒數（講師模式才顯示）
    var disp = h('span', { class: 'timer-disp', role: 'timer', 'aria-label': '剩餘時間' }, fmt(mins * 60));
    var btn = h('button', { type: 'button', class: 'btn primary start-btn' }, '開始這段');
    if (!mins) btn.disabled = true;
    btn.addEventListener('click', function () { if (timer.idx === idx) stopTimer(); else startTimer(idx); });
    timerUI[idx] = { btn: btn, disp: disp, card: card, minutes: mins };
    add(card, h('div', { class: 'teacher-box' }, [
      h('div', { class: 'teacher-head' }, [h('strong', null, '講師要點'), h('div', { class: 'teacher-ctrl' }, [disp, btn])]),
      arr(s.teacher).length ? h('ul', null, arr(s.teacher).map(function (t) { return h('li', null, str(t)); })) : null
    ]));

    if (arr(s.steps).length) add(card, [h('h3', { class: 'sub-h' }, '跟著做'), stepsList(s.steps)]);
    if (arr(s.prompts).length) {
      add(card, [h('h3', { class: 'sub-h' }, '提示詞（按「複製」再貼上）'),
        h('div', { class: 'prompts' }, arr(s.prompts).map(promptCard))]);
    }
    if (arr(s.examples).length) {
      add(card, [h('h3', { class: 'sub-h' }, '範例'), h('ul', { class: 'examples' }, arr(s.examples).map(exampleItem))]);
    }
    if (arr(s.faq).length) {
      add(card, [h('h3', { class: 'sub-h' }, '常見問題'), h('div', { class: 'faq' }, arr(s.faq).map(function (f) {
        f = f || {};
        return h('details', { class: 'fold' }, [h('summary', null, str(f.q)), h('div', { class: 'fold-body' }, str(f.a))]);
      }))]);
    }
    var sampleById = {};
    arr(C.samples).forEach(function (x) { if (x && x.id) sampleById[x.id] = x; });
    var vids = arr(s.videos);
    // 第一節後面緊接範例影片區：已在範例區的影片不重複放，改成往下跳的按鈕
    if (idx === 0 && vids.length) {
      var dup = vids.filter(function (v) { return sampleById[v]; });
      vids = vids.filter(function (v) { return !sampleById[v]; });
      if (dup.length) add(card, h('p', null, h('a', { class: 'btn primary', href: '#samples' }, '往下看 ' + dup.length + ' 支範例影片 ↓')));
    }
    if (vids.length) {
      add(card, [h('h3', { class: 'sub-h' }, '範例影片'), h('div', { class: 'videos' }, vids.map(function (v) {
        var x = sampleById[v];
        return videoBox(v, x ? str(x.title) : '');
      }))]);
    }
    cards[idx] = card;
    return card;
  }

  function sampleCard(x) {
    x = x || {};
    var shots = arr(x.shots).map(function (p) {
      return typeof p === 'object' && p ? str(p.prompt || p.text) : str(p);
    }).filter(Boolean);
    var fold = null;
    if (shots.length) {
      fold = h('details', { class: 'fold' }, [
        h('summary', null, '看 ' + shots.length + ' 格提示詞'),
        h('div', { class: 'fold-body' }, shots.map(function (t, i) {
          return h('div', { class: 'mini-prompt' }, [
            h('div', { class: 'mini-head' }, [h('span', null, '第 ' + (i + 1) + ' 格'), copyBtn(function () { return t; })]),
            h('pre', { class: 'prompt-text' }, t)
          ]);
        }).concat(shots.length > 1 ? [copyBtn(function () {
          return shots.map(function (t, i) { return '第' + (i + 1) + '格：' + t; }).join('\n\n');
        }, '全部複製', 'copy-all')] : []))
      ]);
    }
    return h('article', { class: 'sample-card' }, [
      videoBox(x.id),
      h('h4', null, str(x.title)),
      x.style ? h('span', { class: 'style-tag' }, str(x.style)) : null,
      x.plot ? h('p', { class: 'plot' }, str(x.plot)) : null,
      fold
    ]);
  }

  function samplesBlock() {
    var list = arr(C.samples);
    if (!list.length) return null;
    var rows = ['anim', 'real'].map(function (tr) {
      var items = list.filter(function (x) { return x && x.track === tr; });
      if (!items.length) return null;
      return h('div', { class: 'sample-row row-' + tr }, [
        h('h3', { class: 'row-title' }, trackLabel(tr) + '範例（' + items.length + ' 支）'),
        h('div', { class: 'sample-strip' }, items.map(sampleCard))
      ]);
    });
    return h('section', { class: 'card samples', id: 'samples', 'aria-labelledby': 'samples-t' }, [
      h('h2', { id: 'samples-t' }, '範例影片'),
      h('p', { class: 'samples-intro' }, '先看看做出來長怎樣。左右滑可以看更多。'),
      rows
    ].flat());
  }

  function prepBlock() {
    var p = C.prep;
    if (!p || !arr(p.items).length) return null;
    return h('section', { class: 'card prep', id: 'prep', 'aria-labelledby': 'prep-t' }, [
      h('h2', { class: 'sec-title', id: 'prep-t' }, str(p.title) || '課前準備'),
      h('div', { class: 'prep-grid' }, arr(p.items).map(function (it) {
        it = it || {};
        return h('div', { class: 'prep-item' }, [h('h3', null, str(it.title)), stepsList(it.steps)]);
      }))
    ]);
  }

  function renderMain() {
    var main = $('main'), list = $('sched-list');
    var secs = arr(C.sections);
    var prep = prepBlock();
    if (prep) { main.appendChild(prep); list.appendChild(navLink('#prep', 'extra', '課前', '', str(C.prep.title) || '課前準備')); }
    secs.forEach(function (s, i) {
      main.appendChild(sectionCard(s, i));
      var type = (s && (s.type === 'break' || s.type === 'lunch')) ? s.type : 'lesson';
      var li = navLink('#' + cards[i].id, 'type-' + type, str(s && s.time), s && s.minutes ? s.minutes + ' 分' : '', str(s && s.title));
      navItems[i] = li.firstChild;
      list.appendChild(li);
      if (i === 0) {
        var sb = samplesBlock();
        if (sb) { main.appendChild(sb); list.appendChild(navLink('#samples', 'extra', '範例', '', '範例影片')); }
      }
    });
    var m = C.meta || {};
    $('footer').textContent = [str(m.title), str(m.organizer), str(m.date)].filter(Boolean).join('｜');
  }

  /* ---------- 狀態切換 ---------- */
  function setTrack(tr) {
    state.track = tr === 'real' ? 'real' : 'anim';
    document.body.classList.toggle('track-real', state.track === 'real');
    document.body.classList.toggle('track-anim', state.track === 'anim');
    Array.prototype.forEach.call(document.querySelectorAll('.track-btn'), function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-track') === state.track ? 'true' : 'false');
    });
    lsSet(LS_TRACK, state.track);
  }

  function setTeacher(on) {
    state.teacher = !!on;
    document.body.classList.toggle('teacher-on', state.teacher);
    $('teacher-toggle').setAttribute('aria-checked', state.teacher ? 'true' : 'false');
    lsSet(LS_TEACHER, state.teacher ? '1' : '0');
    updateTopIdle();
  }

  /* ---------- 倒數計時（同時只跑一個） ---------- */
  function startTimer(idx) {
    stopTimer();
    var u = timerUI[idx];
    if (!u || !u.minutes) return;
    timer.idx = idx;
    timer.endAt = Date.now() + u.minutes * 60000;
    u.btn.textContent = '停止';
    u.card.classList.add('timing');
    $('tt-stop').hidden = false;
    $('tt-label').textContent = '計時中：' + str(C.sections[idx].title);
    tick();
    timer.iv = setInterval(tick, 250);
  }

  function stopTimer() {
    if (timer.iv) clearInterval(timer.iv);
    var u = timerUI[timer.idx];
    if (u) {
      u.btn.textContent = '開始這段';
      u.disp.textContent = fmt(u.minutes * 60);
      u.disp.className = 'timer-disp';
      u.card.classList.remove('timing', 'run', 'warn', 'over');
    }
    timer.idx = -1; timer.iv = 0; timer.endAt = 0;
    $('tt-stop').hidden = true;
    $('tt-time').textContent = '';
    $('top-timer').className = 'top-timer';
    updateTopIdle();
  }

  function tick() {
    var u = timerUI[timer.idx];
    if (!u) return;
    var remain = Math.ceil((timer.endAt - Date.now()) / 1000);
    var st = remain <= 0 ? 'over' : (remain <= 120 ? 'warn' : 'run');
    var txt = remain <= 0 ? '00:00' : fmt(remain);
    if (u.disp.textContent !== txt) u.disp.textContent = txt;
    u.disp.className = 'timer-disp ' + st;
    u.card.classList.remove('run', 'warn', 'over');
    u.card.classList.add(st);
    $('tt-time').textContent = remain <= 0 ? '時間到' : txt;
    $('top-timer').className = 'top-timer ' + st;
  }

  function updateTopIdle() {
    if (timer.idx >= 0) return;
    var i = currentSectionIndex();
    var s = arr(C.sections)[i];
    $('tt-label').textContent = s ? '現在：' + str(s.title) + '（尚未計時）' : '尚未開始計時';
  }

  /* ---------- 目前節次高亮 ---------- */
  function updateNow() {
    var cur = currentSectionIndex();
    cards.forEach(function (card, i) {
      var on = i === cur;
      card.classList.toggle('is-now', on);
      if (navItems[i]) {
        navItems[i].classList.toggle('is-now', on);
        if (on) navItems[i].setAttribute('aria-current', 'step'); else navItems[i].removeAttribute('aria-current');
      }
      var tag = card.querySelector('.now-tag');
      if (on && !tag) card.querySelector('.sec-head').appendChild(h('span', { class: 'now-tag' }, '現在'));
      if (!on && tag) tag.remove();
    });
    updateTopIdle();
  }

  /* ---------- 啟動 ---------- */
  function init() {
    if (!C || typeof C !== 'object') {
      $('main').appendChild(h('div', { class: 'notice', role: 'alert' }, '課程內容還沒載入（找不到 content.js）。請確認檔案在同一個資料夾。'));
      return;
    }
    renderHero();
    renderToolbar();
    renderMain();
    setTrack(lsGet(LS_TRACK) === 'real' ? 'real' : 'anim');
    setTeacher(lsGet(LS_TEACHER) === '1');
    updateNow();
    setInterval(updateNow, 30000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
