/* Standings War, design B "The War Room".
   Reads data/*.json written by scripts/refresh.py (which runs scripts/fetch.py and scripts/war.py).
   Every number and every Phoenix lens line comes from those files. */
(function () {
  "use strict";

  var FOCUS = "PHX";
  var CITY = "Phoenix";
  var KEY_LINES = [
    { seed: 6, tag: "Last guaranteed playoff spot", sub: "Seeds 1 through 6 skip the play-in." },
    { seed: 8, tag: "Upper half of the play-in", sub: "Seeds 7 and 8 get two chances to win one game." },
    { seed: 10, tag: "Last play-in spot", sub: "Seeds 9 and 10 have to win twice." }
  ];
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var DOW_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var FAV_KEY = "standings-war:favorites";
  var STAR_P = "M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.4l-5.8 3.1 1.1-6.5L2.6 9.4l6.5-.9z";
  var CHEV = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  var D = {};            // loaded data
  var picks = {};        // what-if picks: game id -> "W" | "L"
  var favs = [];         // starred team codes, in the order they were starred
  var open = {};         // collapsible id -> true when open (all start collapsed)
  var openRows = {};     // board row details open, by "West:GSW"
  var L = {};            // day words: "Tonight" / "Last night", or the dates when the data is from an earlier day

  // ------------------------------------------------------------ helpers
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function ord(n) {
    var s = ["th", "st", "nd", "rd"], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }
  function pct(p) {
    if (p == null) return "n/a";
    if (p <= 0) return "0%";
    if (p >= 1) return "100%";
    if (p < 0.01) return "&lt;1%";
    if (p > 0.99) return "&gt;99%";
    if (p < 0.1) return (p * 100).toFixed(1) + "%";
    return Math.round(p * 100) + "%";
  }
  function rateStr(r) {
    if (!isFinite(r)) return "n/a";
    return r.toFixed(3).replace(/^0/, "");
  }
  function parseDay(s) {
    var p = s.split("-");
    return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
  }
  function isoDay(d) { return d.toISOString().slice(0, 10); }
  function addDays(d, n) { return new Date(d.getTime() + n * 86400000); }
  function shortDate(s) { var d = parseDay(s); return MONTHS[d.getUTCMonth()] + " " + d.getUTCDate(); }
  function dowDate(s) { var d = parseDay(s); return DOW[d.getUTCDay()] + " " + shortDate(s); }
  // "In progress, 10:28 left in the 4th" -> "10:28 · 4th", the design's short clock.
  function liveShort(text) {
    var m = /^In progress, (\S+) left in (?:the )?(.+)$/.exec(text || "");
    if (m) return m[1] + " · " + m[2];
    var t = String(text || "").replace(/^In progress, /, "");
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
  function noAZ(t) { return String(t || "").replace(/ AZ$/, ""); }
  function gamesText(x) {
    x = Math.abs(x);
    return (x % 1 ? x.toFixed(1) : String(x)) + (x === 1 ? " game" : " games");
  }
  function gapOf(a, b) { return ((a.wins - b.wins) + (b.losses - a.losses)) / 2; }
  // Records ("9-4") and scores must not break at the hyphen.
  // Keeps W-L records, ISO dates, season ranges and hyphenated words ("What-if", "6th-seed") on one line.
  function nw(text) { return esc(text).replace(/\b\w+(?:-\w+)+\b/g, '<span class="nw">$&</span>'); }
  var STATUS_TEXT = { in_progress: "In progress", postponed: "Postponed", canceled: "Canceled", suspended: "Suspended" };
  function matchup(g) { return (g.home_away === "home" ? "vs " : "at ") + g.opp; }
  function todayAZ() {
    try {
      return new Date().toLocaleDateString("en-CA", { timeZone: "America/Phoenix" });
    } catch (e) {
      return D.war.today.date;
    }
  }
  // The reader's hour on the Arizona clock (0 to 23), or null when the browser cannot say.
  function hourAZ() {
    try {
      var h = parseInt(new Date().toLocaleString("en-US", { timeZone: "America/Phoenix", hour: "numeric", hourCycle: "h23" }), 10);
      return isNaN(h) ? null : h % 24;
    } catch (e) {
      return null;
    }
  }
  // When the data is from an earlier day, lens lines written for the pull's day name the day instead of "tonight".
  function dayText(t) {
    if (!L.stale) return t;
    return String(t || "").replace(/\blast night\b/g, "on " + D.war.yesterday.short).replace(/\btonight\b/g, "on " + D.war.today.short);
  }
  function weekLabel(wf) {
    var today = todayAZ();
    if (today < wf.week_start) return "Next up";
    if (today > wf.week_end) return "Last update's week";
    return "This week";
  }
  function motionOK() {
    return !(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }
  function lineFor(seed, hist) { return (hist || D.hist).median_wins_by_seed[seed - 1]; }
  function team(code) { return D.war.teams[code]; }
  function teamRow(code) {
    return D.standings.teams.concat(D.east.teams).filter(function (t) { return t.team === code; })[0];
  }
  function finishText(need, rem) {
    if (need === 0) return "Reached";
    if (need > rem) return "Out of reach";
    return need + "-" + (rem - need);
  }
  function isPickTeam(code) { return D.war.pick_teams.indexOf(code) >= 0; }
  function isFav(code) { return favs.indexOf(code) >= 0; }
  function gameHasFav(g) { return isFav(g.away.abbr) || isFav(g.home.abbr); }
  function asOfParts() {
    var m = /^(.*\d{4}), (.*)$/.exec(D.war.as_of_display);
    return m ? { date: m[1], time: m[2] } : { date: D.war.as_of_display, time: "" };
  }
  // Team colors go into style attributes, so only a plain #rrggbb gets through.
  function safeColor(c) { return /^#[0-9a-f]{6}$/i.test(c || "") ? c : "#6B5BD6"; }
  function lightColor(hex) {
    if (!hex) return false;
    var n = parseInt(hex.slice(1), 16), r = n >> 16 & 255, g = n >> 8 & 255, b = n & 255;
    return (0.299 * r + 0.587 * g + 0.114 * b) > 165;
  }

  // ------------------------------------------------------------ data check
  // Codes, records, scores, dates and states are written into the page as markup, so each one
  // must have the plain shape the refresh writes. Anything else stops the page with an error
  // instead of being drawn. Free text (names, reasons, lens lines) always goes through esc().
  function checkData() {
    var CODE = /^[A-Z]{2,3}$/, REC = /^\d{1,2}-\d{1,2}$/, SCORE = /^\d{1,3}-\d{1,3}$/, DAY = /^\d{4}-\d{2}-\d{2}$/, ID = /^\d+$/;
    var TIP = /^(\d{1,2}:\d{2} [AP]M AZ|Time TBD|TBD)$/, NUM = function (v) { return v == null || (typeof v === "number" && isFinite(v)); };
    var bad = [];
    function need(ok, what) { if (!ok) bad.push(what); }
    var teams = D.war.teams;
    Object.keys(teams).forEach(function (c) {
      var t = teams[c];
      need(CODE.test(c) && t.abbr === c && REC.test(t.record) && NUM(t.seed) && /^(West|East)$/.test(t.conference) &&
        /^img\/[a-z]{2,3}\.png$/.test(t.logo) && (t.color == null || /^#[0-9a-f]{6}$/i.test(t.color)), "team " + c);
    });
    function code(c) { return CODE.test(c) && !!teams[c]; }
    D.war.tonight.games.concat(D.war.last_night.games).forEach(function (g) {
      need(ID.test(g.id) && /^(scheduled|in_progress|final|postponed|canceled|suspended)$/.test(g.status) && TIP.test(g.tip_az) &&
        /^(suns|stake|none)$/.test(g.kind) && (g.winner == null || code(g.winner)) && (g.root == null || code(g.root)) &&
        (g.verdict == null || /^(Helped|Hurt|No stake)$/.test(g.verdict)) && g.goals.every(function (x) { return /^(seeding|pick)$/.test(x); }) &&
        [g.away, g.home].every(function (t) { return code(t.abbr) && REC.test(t.record) && NUM(t.score); }), "game " + g.id);
    });
    D.war.pick.three.concat(D.war.pick.order).forEach(function (r) {
      need(code(r.abbr) && REC.test(r.record) && /^T?\d{1,2}$/.test(r.place_label), "pick " + r.abbr);
    });
    Object.keys(D.war.glance).forEach(function (c) {
      var g = D.war.glance[c];
      need(!g.last || (code(g.last.opp) && /^[WL]$/.test(g.last.result) && NUM(g.last.score_for) && NUM(g.last.score_against) && DAY.test(g.last.date_az)), "last " + c);
      need(!g.next || (code(g.next.opp) && DAY.test(g.next.date_az) && TIP.test(g.next.tip_az) && /^(home|road)$/.test(g.next.home_away)), "next " + c);
    });
    D.suns.games.forEach(function (g) {
      need(ID.test(g.id) && code(g.opp) && /^(home|road)$/.test(g.home_away) && DAY.test(g.date_az) && TIP.test(g.tip_az) &&
        (g.result == null || /^[WL]$/.test(g.result)) && (g.score == null || SCORE.test(g.score)), "schedule " + g.id);
    });
    D.standings.teams.concat(D.east.teams).forEach(function (t) {
      need(code(t.team) && NUM(t.wins) && NUM(t.losses) && NUM(t.seed) && /^(-|-?\d+(\.5)?)$/.test(t.games_behind || "-") &&
        /^(-|[WL]\d+)$/.test(t.streak || "-") && /^(-|\d{1,2}-\d{1,2})$/.test(t.last_10 || "-"), "row " + t.team);
    });
    [D.history.teams, D.east.history].forEach(function (h) {
      Object.keys(h).forEach(function (c) {
        h[c].forEach(function (g) { need(DAY.test(g.date) && code(g.opp) && /^[WL]$/.test(g.result) && SCORE.test(g.score), "log " + c); });
      });
    });
    [D.hist, D.histEast].forEach(function (h) { Object.keys(h.seasons).forEach(function (k) { need(/^\d{4}-\d{2}$/.test(k), "season " + k); }); });
    (D.war.pace_targets ? D.war.pace_targets.rows : []).forEach(function (r) {
      [r.now].concat(r.scenarios).forEach(function (c) {
        need(/^(live|reached|out)$/.test(c.state) && NUM(c.need) && NUM(c.left) && (c.rate == null || NUM(c.rate)), "pace " + r.seed);
      });
      need(NUM(r.seed) && NUM(r.line), "pace " + r.seed);
    });
    if (bad.length) throw new Error("data check failed: " + bad.slice(0, 3).join(", "));
  }
  function setDayWords() {
    var stale = todayAZ() !== D.war.today.date;
    L = { stale: stale, today: todayAZ(), tonight: stale ? D.war.today.short : "Tonight", lastNight: stale ? D.war.yesterday.short : "Last night" };
  }
  // Nav tabs, the skip link and the ticker label follow the reader's day, not the pull's.
  function setDayChrome() {
    var tabs = document.querySelectorAll("#secnav a");
    var wf = D.suns.whatif, wk = weekLabel(wf);
    if (tabs.length >= 3) {
      tabs[0].textContent = L.tonight;
      tabs[1].textContent = wk === "This week" ? "This week" : wk === "Next up" ? "Next up" : "What-if";
      tabs[2].textContent = L.lastNight;
    }
    var skip = document.querySelector("a.skip");
    if (skip) skip.textContent = L.stale ? "Skip to the board for " + D.war.today.short : "Skip to tonight's board";
    var tk = $("ticker");
    if (tk) tk.setAttribute("aria-label", L.stale ? "Final scores, " + D.war.yesterday.short : "Last night's final scores");
  }

  // ------------------------------------------------------------ small components
  function plate(code, size) {
    var t = team(code), inner = Math.round(size * 0.72);
    return '<span class="plate" style="width:' + size + "px;height:" + size + 'px">' +
      '<img src="' + esc(t ? t.logo : "img/" + code.toLowerCase() + ".png") + '" width="' + inner + '" height="' + inner +
      '" alt="" decoding="async"></span>';
  }
  function starSvg(on, size) {
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" aria-hidden="true"><path d="' + STAR_P +
      '" fill="' + (on ? "var(--gold)" : "none") + '" stroke="' + (on ? "var(--gold)" : "currentColor") +
      '" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  }
  // The star control. where: which part of the page it sits in, so focus can come back after a redraw.
  function star(code, where, size, cls) {
    if (code === FOCUS || !team(code)) return "";
    var on = isFav(code), name = team(code).name;
    return '<button type="button" class="star' + (cls ? " " + cls : "") + (on ? " on" : "") + '" data-fav="' + code +
      '" data-where="' + where + '" aria-pressed="' + on + '" aria-label="' + (on ? "Remove " : "Add ") + esc(name) +
      (on ? " from favorites" : " to favorites") + '">' + starSvg(on, size || 18) + "</button>";
  }
  // extra: more markup inside the same lens box, under the line (the pace rows in Pick the results).
  function lens(text, cls, extra) {
    return '<div class="lens' + (cls ? " " + cls : "") + '"><span class="lens-k"><img src="img/phx.png" width="18" height="18" alt="">' +
      'Phoenix lens</span>' + (extra ? '<div class="lens-body"><p class="lens-t">' + nw(text) + "</p>" + extra + "</div>"
        : '<p class="lens-t">' + nw(text) + "</p>") + "</div>";
  }
  function head(num, kicker, h2, h2id, lensText, lede, lensExtra) {
    return '<div class="sh"><span class="sh-n" aria-hidden="true">' + num + '</span><div><p class="kicker">' + kicker +
      '</p><h2 id="' + h2id + '">' + h2 + "</h2>" + (lede ? '<p class="lede">' + lede + "</p>" : "") + "</div></div>" +
      lens(lensText, lensExtra ? "lens-pace" : "", lensExtra);
  }
  // Whole percent with halves rounded up, in integer math: the same rounding as war.py pct_half_up,
  // so a verdict card and a pace row never disagree.
  function halfUp(need, left) { return Math.floor((200 * need + left) / (2 * left)); }
  function paceCell(line, wins, left) {
    var need = Math.max(0, line - wins);
    if (need === 0) return { state: "reached", need: 0, left: left, rate: null };
    if (need > left) return { state: "out", need: need, left: left, rate: null };
    return { state: "live", need: need, left: left, rate: halfUp(need, left) };
  }
  function outWords(c) { return plural(c.need, "win", "wins") + " needed, " + plural(c.left, "game", "games") + " left"; }

  // The win rate Phoenix needs for each seed line, now and after its next two games. All numbers come
  // from war.json "pace_targets" (written by the refresh from the standings and the pace lines).
  function paceRows() {
    var pt = D.war.pace_targets;
    if (!pt || !pt.rows) return "";
    function cell(label, c, cls) {
      var main = c.state === "reached" ? "Reached" : c.state === "out" ? "Out of reach" : c.need + " of " + c.left;
      var rate = c.state === "live" ? c.rate + "%" : c.state === "out" ? c.need + " needed, " + c.left + " left" : "";
      return '<span class="pace-c' + (cls ? " " + cls : "") + " st-" + c.state + '" role="cell" data-label="' + esc(label) + '" data-state="' + c.state +
        '"><em>' + esc(label) + "</em> <b>" + esc(main) + "</b>" + (rate ? " <i>" + esc(rate) + "</i>" : "") + "</span>";
    }
    var rows = pt.rows.map(function (r) {
      var cells;
      if (r.now.state === "reached") cells = '<span class="pace-c wide st-reached" role="cell" data-label="Now" data-state="reached"><b>Already reached</b></span>';
      else if (r.now.state === "out") cells = '<span class="pace-c wide st-out" role="cell" data-label="Now" data-state="out"><b>Out of reach</b> <i>' +
        esc(outWords(r.now)) + "</i></span>";
      else cells = cell("Now", r.now, "now") + r.scenarios.map(function (c) { return cell(c.label, c); }).join("");
      return '<div class="pace-r" role="row" data-seed="' + r.seed + '" data-line="' + r.line + '"><span class="pace-l" role="rowheader">' +
        esc(r.label) + "</span>" + cells + "</div>";
    }).join("");
    // Column headers for screen readers; the cells carry the same labels on screen.
    var cols = ["Seed line", "Now"].concat(pt.games === 2 ? ["Win both", "Split", "Lose both"] : pt.games === 1 ? ["Win", "Loss"] : []);
    var heads = '<div class="pace-h sr" role="row">' + cols.map(function (c) { return '<span role="columnheader">' + c + "</span>"; }).join("") + "</div>";
    return '<div class="pace" id="pace-rows" role="table" aria-label="Win rate Phoenix needs for each seed line, now and after its next ' +
      (pt.games === 1 ? "game" : "two games") + '">' + heads + rows + '</div><p class="pace-note">' + esc(pt.note) + "</p>";
  }
  // A disclosure button and its panel id. label/sub change with state; count stays.
  // labels and subs: [when closed, when open].
  // controls: the ids the button shows and hides, when that is not the one panel named id.
  function disclose(id, labels, count, subs, controls) {
    var isOpen = !!open[id], i = isOpen ? 1 : 0;
    subs = subs || ["", ""];
    return '<button type="button" class="disc' + (isOpen ? " open" : "") + '" aria-expanded="' + isOpen + '" aria-controls="' + (controls || id) +
      '" data-disc="' + id + '" data-labels="' + esc(JSON.stringify(labels)) + '" data-subs="' + esc(JSON.stringify(subs)) +
      '"><span class="dc-l"><b class="dc-b">' + esc(labels[i]) + "</b>" + (count ? "<em>" + esc(count) + "</em>" : "") +
      '<span class="dc-s">' + esc(subs[i]) + '</span></span><span class="dc-r"><span class="dc-t">' +
      (isOpen ? "Hide" : "Show") + '</span><span class="dc-c">' + CHEV + "</span></span></button>";
  }
  function panel(id, html, cls) {
    return '<div class="dpanel' + (cls ? " " + cls : "") + '" id="' + id + '"' + (open[id] ? "" : " hidden") + ">" + html + "</div>";
  }

  // ------------------------------------------------------------ favorites storage
  function storage() {
    try {
      var s = window.localStorage;
      var k = "standings-war:probe";
      s.setItem(k, "1");
      s.removeItem(k);
      return s;
    } catch (e) {
      return null;     // private mode or storage blocked: favorites still work for this visit
    }
  }
  function loadFavs() {
    var s = storage(), list = [];
    if (s) {
      try {
        var raw = JSON.parse(s.getItem(FAV_KEY) || "[]");
        if (Array.isArray(raw)) list = raw;
      } catch (e) { list = []; }
    }
    var seen = {};
    favs = list.filter(function (c) {
      var ok = typeof c === "string" && c !== FOCUS && !!team(c) && !seen[c];
      seen[c] = true;
      return ok;
    });
  }
  function saveFavs() {
    var s = storage();
    if (!s) return;
    try { s.setItem(FAV_KEY, JSON.stringify(favs)); } catch (e) { /* quota or blocked: keep in memory */ }
  }
  function toggleFav(code) {
    var i = favs.indexOf(code);
    if (i >= 0) favs.splice(i, 1); else favs.push(code);
    saveFavs();
  }

  // ------------------------------------------------------------ ticker + masthead
  function renderTicker() {
    var games = D.war.last_night.games;
    var mk = { Helped: "helped", Hurt: "hurt", "No stake": "none" };
    $("ticker-row").innerHTML = games.length ? games.map(function (g) {
      function side(t) {
        return '<span class="tk-t' + (g.winner === t.abbr ? " w" : "") + '">' + t.abbr + " <b>" + t.score + "</b></span>";
      }
      return '<span class="tk-g">' + side(g.away) + side(g.home) + '<i class="tk-m ' + mk[g.verdict] + '" title="' +
        esc(g.verdict) + '"></i><span class="sr">' + esc(g.verdict) + "</span></span>";
    }).join("") : '<span class="tk-g">No finals</span>';
    document.querySelector(".tk-lab").textContent = L.lastNight;
    var p = asOfParts();
    // A last-refresh stamp, not a clock: "Updated 10:05 AM AZ", with the pull's weekday once the reader's day has moved on.
    var wd = new Date(D.war.as_of).toLocaleDateString("en-US", { weekday: "short", timeZone: "America/Phoenix" });
    $("stamp").textContent = "Updated " + p.date + " · " + p.time;
    $("stamp-short").textContent = "Updated " + (L.stale ? wd + " " : "") + p.time;
    $("season-label").textContent = D.war.season;
  }

  // ------------------------------------------------------------ hero
  function podOf(h) { return h < 12 ? "morning" : h < 17 ? "afternoon" : "night"; }
  function pullPartOfDay() { return podOf(parseInt(D.war.as_of.slice(11, 13), 10)); }
  // The reader's part of the day on the Arizona clock; the pull's when the browser cannot say.
  function partOfDay() {
    var h = hourAZ();
    return h == null ? pullPartOfDay() : podOf(h);
  }
  function welcomeText() {
    if (L.stale) return "Mat, here is where the war stood on " + D.war.today.weekday + " " + pullPartOfDay() + ".";
    var now = partOfDay(), pulled = pullPartOfDay();
    if (now !== pulled) return "Mat, here is where the war stood this " + pulled + ".";
    return "Mat, here is where the war stands on " + D.war.today.weekday + " " + now + ".";
  }
  function renderHero() {
    var t = teamRow(FOCUS), line6 = lineFor(6), need = Pace.winsNeeded(line6, t.wins), rem = t.games_remaining;
    $("welcome").textContent = welcomeText();
    var note = $("stale-note");
    note.hidden = !L.stale;
    note.textContent = L.stale ? "Last updated " + D.war.as_of_display + ". Today's games come in with the next refresh." : "";
    var big, h;
    if (need === 0) {
      big = line6;
      h = "Wins banked. <br>" + CITY + " has reached <br><b>6th-seed pace</b>.";
    } else if (need > rem) {
      big = need;
      h = (need === 1 ? "Win" : "Wins") + " needed in <b>" + plural(rem, "game", "games") + "</b>. <br>6th-seed pace is <br>out of reach.";
    } else {
      big = need;
      h = "More " + (need === 1 ? "win" : "wins") + " in <b>" + plural(rem, "game", "games") + "</b> <br>to put " + CITY + " on <br>6th-seed pace.";
    }
    $("hero-num").textContent = big;
    $("hero-answer").innerHTML = '<span class="sr">' + big + " </span>" + h;
    var proj = t.games_played ? Math.round(t.wins / t.games_played * Pace.SEASON_GAMES) : null;
    var sub = "The Suns are " + t.wins + "-" + t.losses + ", " + ord(t.seed) + " in the West.";
    if (proj !== null) sub += " Keep winning at this rate and they finish with " + proj + ". The typical 6th seed wins " + line6 + ".";
    $("hero-sub").innerHTML = nw(sub);
    renderPaceInfo(t, line6, need, rem);
  }

  function renderPaceInfo(t, line6, need, rem) {
    var seasons = Object.keys(D.hist.seasons);
    var wins6 = seasons.map(function (s) { return D.hist.seasons[s][5].wins; });
    var list = wins6.slice(0, -1).join(", ") + " and " + wins6[wins6.length - 1];
    var s1 = "The 6th-seed target of " + line6 + " wins is the median (middle number) of what the team that finished 6th in the West won in each of the last " +
      seasons.length + " full 82-game seasons, " + seasons[0] + " through " + seasons[seasons.length - 1] + ": " + list + ".";
    var s2 = need === 0
      ? CITY + " already has " + t.wins + " wins, so it has reached that target."
      : CITY + " has " + plural(t.wins, "win", "wins") + ", so it needs " + need + " more, and it has " + rem + " of its 82 games left.";
    var s3 = "This number does not use the odds simulation, which only sets the \"Est. chance\" figures below.";
    $("pace-info").innerHTML = "<p>" + esc(s1) + "</p><p>" + esc(s2) + " " + esc(s3) + "</p>";
  }

  function togglePaceInfo() {
    var btn = $("pace-info-btn"), p = $("pace-info"), isOpen = btn.getAttribute("aria-expanded") !== "true";
    btn.setAttribute("aria-expanded", String(isOpen));
    p.classList.remove("is-closing");
    if (isOpen || !motionOK()) { p.hidden = !isOpen; return; }
    p.classList.add("is-closing");
    setTimeout(function () {
      p.classList.remove("is-closing");
      if (btn.getAttribute("aria-expanded") !== "true") p.hidden = true;
    }, 170);
  }

  function renderLines() {
    var t = teamRow(FOCUS), odds = D.odds.teams[FOCUS] || {}, rem = t.games_remaining;
    $("lines").innerHTML = KEY_LINES.map(function (k) {
      var line = lineFor(k.seed), need = Pace.winsNeeded(line, t.wins), p = odds["top" + k.seed];
      var n, u;
      if (need === 0) { n = line; u = "wins <br>reached"; }
      else if (need > rem) { n = need; u = "needed <br>out of reach"; }
      else { n = need; u = "more " + (need === 1 ? "win" : "wins") + " <br>for a " + need + "-" + (rem - need) + " finish"; }
      var fill = Math.min(100, t.wins / line * 100);
      return '<article class="tt tt' + k.seed + '" role="listitem" data-seed="' + k.seed + '">' +
        '<div class="tt-h"><b>' + ord(k.seed) + " seed</b><span>" + esc(k.tag) + "</span></div>" +
        '<div class="tt-n"><span class="n">' + n + '</span><span class="u">' + u + "</span></div>" +
        '<div class="meter" role="img" aria-label="' + t.wins + " of " + line + ' wins banked"><span style="width:' + fill.toFixed(1) + '%"></span></div>' +
        '<div class="tt-cap"><span>' + t.wins + " banked</span><span>Line " + line + "</span></div>" +
        '<div class="tt-ch"><span>Est. chance</span><b>' + pct(p) + '</b></div><span class="sr">to finish ' + ord(k.seed) + " or better</span></article>";
    }).join("");
  }

  // Phoenix's game tonight, or the next one when there is none.
  function renderTonightStrip() {
    var sg = D.war.tonight.games.filter(function (g) { return g.kind === "suns"; })[0];
    var sched = {};
    D.suns.games.forEach(function (g) { sched[g.id] = g; });
    var k, tl, away, home, scA = "", scH = "";
    var lensLine = L.stale ? "Last updated " + D.war.as_of_display + ". " + (D.war.lens.standing || "") : D.war.lens.tonight;
    if (sg && !L.stale) {
      var venue = sched[sg.id] && sched[sg.id].venue;
      away = sg.away.abbr; home = sg.home.abbr;
      k = L.tonight;
      if (sg.status === "scheduled") tl = esc(sg.tip_az) + (venue ? " · " + esc(venue) : "");
      else if (sg.status === "in_progress") tl = '<i class="ldot" aria-hidden="true"></i>Live · ' + esc(liveShort(sg.state_text));
      else tl = esc(sg.state_text);
      if (sg.status === "in_progress" || sg.status === "final") {
        scA = '<em class="ts-sc">' + sg.away.score + "</em>";
        scH = '<em class="ts-sc">' + sg.home.score + "</em>";
      }
    } else {
      // The next Suns game on the reader's clock: today's counts, past days do not.
      var nxt = D.suns.games.filter(function (g) { return g.date_az >= L.today && (L.stale || g.date_az > D.war.today.date) && g.status === "scheduled"; })[0];
      if (!nxt) {
        $("tonight-strip").innerHTML = '<div class="ts-l"><span class="ts-k">' + esc(L.stale ? "Next game" : L.tonight) + '</span><span class="ts-t">' +
          (L.stale ? "Not on the schedule yet" : "No Suns game") + "</span></div>" +
          '<p class="ts-lens"><span class="lens-k">Phoenix lens</span><span>' + nw(lensLine) + "</span></p>";
        return;
      }
      k = nxt.date_az === L.today ? "Tonight" : "Next game";
      tl = esc(dowDate(nxt.date_az)) + " · " + esc(nxt.tip_az);
      away = nxt.home_away === "road" ? FOCUS : nxt.opp;
      home = nxt.home_away === "road" ? nxt.opp : FOCUS;
    }
    function side(code, sc) {
      var t = team(code);
      return plate(code, 56) + '<div><b>' + esc(t.short) + "</b><span>" + t.record + "</span></div>" + sc;
    }
    $("tonight-strip").innerHTML = '<div class="ts-l"><span class="ts-k">' + k + '</span><span class="ts-t">' + tl + "</span></div>" +
      '<div class="ts-m">' + side(away, scA) + '<span class="ts-at">at</span>' + side(home, scH) + "</div>" +
      '<p class="ts-lens"><span class="lens-k">Phoenix lens</span><span>' + nw(lensLine) + "</span></p>";
  }

  // ------------------------------------------------------------ favorites
  function tonightGame(code) {
    return D.war.tonight.games.filter(function (g) { return g.away.abbr === code || g.home.abbr === code; })[0];
  }
  function lastNightGame(code) {
    return D.war.last_night.games.filter(function (g) { return g.away.abbr === code || g.home.abbr === code; })[0];
  }
  // A team's next game from the pull, only if it has not already passed on the reader's clock.
  // false: the pull's next game is in the past, so the real next game comes with the next refresh.
  function nextFor(code) {
    var n = (D.war.glance[code] || {}).next;
    if (!n) return null;
    return n.date_az >= L.today ? n : false;
  }
  function favTonightCell(code) {
    var g = tonightGame(code);
    if (g) {
      var isAway = g.away.abbr === code, me = isAway ? g.away : g.home, opp = isAway ? g.home : g.away, ha = isAway ? "at" : "vs";
      var val;
      if (g.status === "scheduled" && L.stale) {
        val = "<b>" + ha + " " + opp.abbr + "</b><span>Result comes in with the next refresh</span>";
      } else if (g.status === "scheduled") {
        val = "<b>" + ha + " " + opp.abbr + "</b><span>" + esc(g.tip_az) + "</span>";
      } else if (g.status === "in_progress") {
        val = "<b>" + ha + " " + opp.abbr + " <em>" + me.score + "-" + opp.score + '</em></b><span class="lv">Live · ' +
          esc(liveShort(g.state_text)) + "</span>";
      } else if (g.status === "final") {
        var wl = g.winner === code ? "W" : "L";
        val = '<b><i class="r' + wl + '">' + wl + "</i> " + me.score + "-" + opp.score + "</b><span>" + ha + " " + esc(opp.short) +
          " · " + esc(g.state_text) + "</span>";
      } else {
        val = "<b>" + ha + " " + opp.abbr + "</b><span>" + esc(g.state_text) + "</span>";
      }
      return '<div class="fv-c"><span class="fv-k">' + esc(L.tonight) + '</span><div class="fv-v">' + plate(opp.abbr, 28) + "<div>" + val + "</div></div></div>";
    }
    var n = nextFor(code);
    if (n === false) return '<div class="fv-c"><span class="fv-k">Next game</span><div class="fv-v"><div><span>Comes in with the next refresh</span></div></div></div>';
    if (!n) return '<div class="fv-c"><span class="fv-k">Next game</span><div class="fv-v"><div><span>Not on the schedule yet</span></div></div></div>';
    return '<div class="fv-c"><span class="fv-k">' + (n.date_az === L.today ? "Tonight" : "Next game") + '</span><div class="fv-v">' + plate(n.opp, 28) + "<div><b>" +
      (n.home_away === "home" ? "vs " : "at ") + n.opp + "</b><span>" + dowDate(n.date_az) + " · " + esc(n.tip_az) + "</span></div></div></div>";
  }
  function favLastCell(code) {
    var g = lastNightGame(code);
    if (g) {
      var isAway = g.away.abbr === code, me = isAway ? g.away : g.home, opp = isAway ? g.home : g.away;
      var wl = g.winner === code ? "W" : "L";
      return '<div class="fv-c"><span class="fv-k">' + esc(L.lastNight) + '</span><div class="fv-v">' + plate(opp.abbr, 28) + '<div><b><i class="r' + wl + '">' +
        wl + "</i> " + me.score + "-" + opp.score + "</b><span>" + (isAway ? "at " : "vs ") + esc(opp.short) + "</span></div></div></div>";
    }
    var l = (D.war.glance[code] || {}).last;
    if (!l) return '<div class="fv-c"><span class="fv-k">Last game</span><div class="fv-v"><div><span>No games yet</span></div></div></div>';
    return '<div class="fv-c"><span class="fv-k">Last game</span><div class="fv-v">' + plate(l.opp, 28) + '<div><b><i class="r' + l.result + '">' +
      l.result + "</i> " + l.score_for + "-" + l.score_against + "</b><span>" + dowDate(l.date_az) + " " +
      (l.home_away === "home" ? "vs " : "at ") + esc(team(l.opp).short) + "</span></div></div></div>";
  }
  function renderFavorites() {
    var title = '<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="' + STAR_P +
      '" fill="var(--gold)"/></svg><h2 class="fv-h" id="favorites-h">Your favorites</h2>';
    var s = favs.length
      ? '<div class="fv-head"><div class="fv-t">' + title + "<em>" + favs.length + '</em></div><span class="fv-sub">Saved on this device · Tap a star on any team to add or remove</span></div>'
      : '<div class="fv-head"><div class="fv-t">' + title + '<span class="fv-sub">Saved on this device</span></div></div>';
    if (!favs.length) {
      $("favorites").innerHTML = s + '<div class="fv-empty"><span class="star big" aria-hidden="true">' + starSvg(false, 20) +
        "</span><p>Star any team to follow it here.</p></div>";
      return;
    }
    s += '<div class="fv-grid n' + Math.min(favs.length, 3) + '">' + favs.map(function (code) {
      var t = team(code), r = teamRow(code) || {};
      var rel;
      if (t.conference === "West") {
        rel = D.war.glance[code].vs_phx || "";
      } else {
        rel = "Eastern Conference" + (isPickTeam(code) ? " · 2027 pick team" : "");
      }
      var third = (r.last_10 && r.last_10 !== "-") ? ["Last 10", r.last_10] : ["Streak", r.streak || "n/a"];
      return '<article class="fv" data-team="' + code + '" style="--tc:' + safeColor(t.color) + '"><div class="fv-top">' + plate(code, 56) +
        '<div class="fv-id"><b>' + esc(t.short) + "</b><span>" + esc(rel) + "</span></div>" + star(code, "fav-card", 22) + "</div>" +
        '<div class="fv-nums"><div><em>' + t.record + "</em><span>Record</span></div><div><em>" + ord(t.seed) + "</em><span>" + t.conference +
        "</span></div><div><em>" + esc(third[1]) + "</em><span>" + third[0] + "</span></div></div>" +
        '<div class="fv-cells">' + favTonightCell(code) + favLastCell(code) + "</div></article>";
    }).join("") + '<a class="fv-add" href="#standings"><span class="star big" aria-hidden="true">' + starSvg(false, 22) +
      "</span><b>Add a team</b><span>Tap the star on any row in the standings</span></a></div>";
    // With two or more stars each team gets its first sentence, plus its 2027 pick sentence when it has one.
    var lines = favs.map(function (c) {
      var t = D.war.glance[c].lens;
      if (favs.length < 2) return t;
      var parts = t.split(". ").map(function (x) { return x.replace(/\.?$/, "."); });
      return [parts[0]].concat(parts.slice(1).filter(function (x) { return /2027/.test(x); })).join(" ");
    });
    s += lens(lines.join(" "), "slim");
    $("favorites").innerHTML = s;
  }

  // ------------------------------------------------------------ 01 tonight's board
  function renderRooting() {
    var w = D.war, games = w.tonight.games.slice();
    // Phoenix first, then games with a starred team, then the rest in the data's order.
    games.sort(function (a, b) {
      function rank(g) { return g.kind === "suns" ? 0 : gameHasFav(g) ? 1 : 2; }
      return rank(a) - rank(b) || w.tonight.games.indexOf(a) - w.tonight.games.indexOf(b);
    });
    // Phones fold the board: the lead game stays up (the Suns game, else the first game with a Phoenix stake in this order)
    // and the rest wait behind one disclosure. Desktop never folds (CSS: the fold rules live in the phone breakpoint only).
    var lead = games.filter(function (g) { return g.kind === "suns"; })[0] || games.filter(function (g) { return g.kind === "stake"; })[0] || null;
    var matter = games.filter(function (g) { return g.kind === "suns" || g.kind === "stake"; }).length;
    var foldable = games.length > (lead ? 1 : 0);
    var rows = games.map(function (g) {
      var st = g.status, root = g.root, live = st === "in_progress", fin = st === "final";
      var stx;
      if (live) stx = '<span class="live"><i></i>Live</span><span class="tm2">' + esc(liveShort(g.state_text)) + "</span>";
      else if (fin) stx = '<span class="tm1">Final</span><span class="tm2">' + (g.overtime ? "OT · " : "") + "Tipped " + esc(g.tip_az) + "</span>";
      else if (st === "scheduled") stx = '<span class="tm1">' + esc(g.time_valid ? noAZ(g.tip_az) : "TBD") + '</span><span class="tm2">' + (g.time_valid ? "AZ" : "Time TBD") + "</span>";
      else stx = '<span class="tm1">' + esc(g.state_text) + "</span>";
      function tside(t) {
        var cls = (t.abbr === root ? " r" : "") + (fin && g.winner === t.abbr ? " won" : "");
        var num = (live || fin) && t.score != null ? "<em>" + t.score + "</em>" : "";
        return '<span class="ms' + cls + '" data-team="' + t.abbr + '">' + plate(t.abbr, 36) + "<b>" + t.abbr + "</b><i>" + t.record + "</i>" +
          '<span class="sr"> ' + esc(t.short) + "</span>" + num + star(t.abbr, "rooting", 16) + "</span>";
      }
      var rf;
      if (g.kind === "suns") rf = '<span class="rf" style="--tc:#E56020">' + plate("PHX", 28) + "Suns win</span>";
      else if (g.kind === "stake" && root) {
        var rt = team(root);
        rf = '<span class="rf' + (lightColor(rt.color) ? " lt" : "") + '" style="--tc:' + safeColor(rt.color) + '">' + plate(root, 28) +
          '<span class="sr">Root for </span>' + esc(rt.short) + "</span>";
      } else if (g.kind === "stake") rf = '<span class="rf none either">Either result</span>';
      else rf = '<span class="rf none">No stake</span>';
      var tags = "";
      if (gameHasFav(g)) tags += '<span class="tag t-fav">Your favorite</span>';
      g.goals.forEach(function (k) {
        tags += k === "seeding" ? '<span class="tag t-seed">Seeding</span>' : '<span class="tag t-pick">2027 pick</span>';
      });
      if (live && root && g.away.score != null) {
        var mine = g.away.abbr === root ? g.away.score : g.home.score, theirs = g.away.abbr === root ? g.home.score : g.away.score;
        tags += mine > theirs ? '<span class="going good">Going Phoenix&rsquo;s way</span>'
          : mine < theirs ? '<span class="going bad">Trailing</span>' : '<span class="going">Tied</span>';
      }
      if (fin && g.verdict && g.verdict !== "No stake") {
        tags += '<span class="going ' + (g.verdict === "Helped" ? "good" : "bad") + '">' + g.verdict + "</span>";
      }
      var why = g.kind === "suns" ? D.war.lens.tonight : g.why;
      return '<div class="tb-r k-' + g.kind + (gameHasFav(g) ? " fav" : "") + (g === lead ? " tb-lead" : " tb-fold") + '" role="row" data-game="' + esc(g.id) + '" data-answer="' + esc(g.answer) +
        '" data-status="' + st + '" data-tip="' + esc(g.tip_az) + '">' +
        '<span class="tb-t" role="cell">' + stx + "</span>" +
        '<span class="tb-m" role="cell">' + tside(g.away) + '<span class="at" aria-hidden="true">@</span>' + tside(g.home) + "</span>" +
        '<span class="tb-rf" role="cell">' + rf + "</span>" +
        '<span class="tb-w" role="cell">' + (tags ? '<span class="tags">' + tags + "</span>" : "") + '<span class="wy">' + nw(why) + "</span></span></div>";
    }).join("");
    var lede = "Every NBA game " + (L.stale ? "on " + esc(w.today.short) : "tonight") + " and the result that helps Phoenix." +
      (favs.length ? " Your favorites&rsquo; games come right after the Suns." : "") +
      " Arizona time (AZ). Scores as of " + esc(L.stale ? w.as_of_display : asOfParts().time) + ".";
    $("rooting").innerHTML = head("01", "Rooting guide · " + plural(games.length, "game", "games") + (L.stale ? " on " + esc(w.today.short) : " tonight"),
        L.stale ? "The board for " + esc(w.today.short) : "Tonight&rsquo;s board", "rooting-h", dayText(w.lens.board), lede) +
      (games.length ? '<div class="tb' + (foldable && !open["board-all"] ? " folded" : "") + '" id="board-all" role="table" aria-label="' + (L.stale ? "Games on " + esc(w.today.short) : "Tonight&rsquo;s games") + '"><div class="tb-h" role="row"><span role="columnheader">Time</span><span role="columnheader">Matchup</span>' +
        '<span role="columnheader">Root for</span><span role="columnheader">Why it matters to Phoenix</span></div>' + rows + "</div>" +
        (foldable ? '<div class="tb-fold-ctl">' + disclose("board-all", [plural(games.length, "game", "games") + (L.stale ? " on " + w.today.short : " tonight") + " · " +
          (matter === 1 ? "1 matters" : matter + " matter") + " to Phoenix", "All " + plural(games.length, "game", "games") + (L.stale ? " on " + w.today.short : " tonight")], "",
          [lead ? "Show the full list" : "Show the games", "Showing the full list"]) + "</div>" : "")
        : '<p class="empty-note">No NBA games are on the schedule ' + (L.stale ? "on " + esc(w.today.short) : "tonight") + ".</p>");
  }

  // ------------------------------------------------------------ 02 pick the results (what-if)
  function whatifGames() { return (D.odds.whatif && D.odds.whatif.games) || []; }
  function pickList() { return whatifGames().map(function (g) { return picks[g.id] || null; }); }
  function scenarioKey() { return pickList().map(function (p) { return p || "-"; }).join(""); }

  function renderWhatif() {
    var wf = D.suns.whatif, n = whatifGames().length;
    var lede = n ? "Tap W or L for " + (n === 1 ? "the game" : "each game") + " still to play. Each card shows the wins " + CITY +
      " needs for that seed line over the games left, and the win rate that takes, before and after your picks." : "No Suns games are left to pick right now.";
    $("whatif").innerHTML = head("02", esc(weekLabel(wf)) + " · " + shortDate(wf.week_start) + " to " +
        (parseDay(wf.week_start).getUTCMonth() === parseDay(wf.week_end).getUTCMonth() ? parseDay(wf.week_end).getUTCDate() : shortDate(wf.week_end)),
        "Pick the results", "whatif-h", D.war.lens.week, lede, paceRows()) +
      '<div class="wf"><div class="wf-games" id="wf-games"></div><div class="wf-out"><p class="wf-hl" id="wf-headline" aria-live="polite"></p>' +
      '<div class="verdicts" id="verdicts" aria-live="polite"></div><button type="button" class="reset" id="wf-reset" hidden>Clear picks</button></div></div>';
    renderWhatifGames();
    renderVerdicts();
  }

  function renderWhatifGames() {
    var wf = D.suns.whatif, byId = {}, toggle = {};
    D.suns.games.forEach(function (g) { byId[g.id] = g; });
    whatifGames().forEach(function (g) { toggle[g.id] = true; });
    $("wf-games").innerHTML = wf.week_game_ids.map(function (id) {
      var g = byId[id], o = team(g.opp), ctl, when2;
      if (g.status === "final") {
        when2 = "Final";
        ctl = '<span class="res res-' + g.result + '">' + g.result + " " + esc(g.score) + "</span>";
      } else if (toggle[id]) {
        when2 = STATUS_TEXT[g.status] || esc(g.tip_az);
        ctl = '<span class="wlb" role="group" aria-label="Result ' + esc(matchup(g)) + '">' + ["W", "L"].map(function (r) {
          var on = picks[id] === r;
          return '<button type="button" class="wl-btn wl-' + r + (on ? " on" : "") + '" data-id="' + esc(id) + '" data-pick="' + r +
            '" aria-pressed="' + on + '" aria-label="' + (r === "W" ? "Win" : "Loss") + " " + esc(matchup(g)) + '">' + r + "</button>";
        }).join("") + "</span>";
      } else {
        when2 = STATUS_TEXT[g.status] || esc(g.tip_az);
        ctl = "";
      }
      var cup = g.note && /cup/i.test(g.note) ? '<span class="cup">NBA Cup</span>' : "";
      return '<div class="wg ' + g.home_away + (g.status === "final" ? " fin" : "") + '" data-id="' + esc(id) + '"><div class="wg-d"><b>' + dowDate(g.date_az) +
        "</b><span>" + when2 + '</span></div><div class="wg-o">' + plate(g.opp, 40) + "<div><b>" + (g.home_away === "home" ? "vs " : "at ") +
        esc(o.short) + "</b><span>" + o.record + " " + cup + "</span></div></div>" + ctl + "</div>";
    }).join("");
  }

  // One card per seed line: wins needed of games left and the rate it takes, today and after the picks.
  // A strong label only when a line is actually reached or actually out of reach.
  var BADGE = { live: "In play", reached: "Reached", out: "Out of reach" };
  function verdictCard(line, t, w, l) {
    var today = paceCell(line, t.wins, t.games_remaining);
    var picked = w + l > 0;
    var after = picked ? paceCell(line, t.wins + w, t.games_remaining - w - l) : today;
    var rec = (t.wins + w) + "-" + (t.losses + l);
    var say, sub;
    if (after.state === "reached") say = (picked ? "At " + rec + ": " : "") + "line reached, " + plural(t.wins + w, "win", "wins") + " banked";
    else if (after.state === "out") say = (picked ? "At " + rec + ": " : "") + "out of reach, " + outWords(after);
    else say = (picked ? "At " + rec + ": " : "") + after.need + " of " + after.left + " left (" + after.rate + "%)";
    if (!picked) sub = "Today, before any picks";
    else if (today.state !== "live") sub = today.state === "reached" ? "Already reached today" : "Already out of reach today";
    else if (after.state !== "live") sub = "Today: " + today.need + " of " + today.left + " left (" + today.rate + "%)";
    else if (after.rate === today.rate) sub = "Steady at " + today.rate + "%, same as today";
    else sub = (after.rate > today.rate ? "Up from " : "Down from ") + today.rate + "% today";
    return { state: after.state, say: say, sub: sub };
  }

  function renderVerdicts() {
    var t = teamRow(FOCUS), list = pickList(), any = list.some(Boolean);
    var sc = (D.odds.whatif && D.odds.whatif.scenarios) || {};
    var base = sc[list.map(function () { return "-"; }).join("")] || {};
    var now = sc[scenarioKey()] || base;
    var w = list.filter(function (p) { return p === "W"; }).length, l = list.filter(function (p) { return p === "L"; }).length;
    var hl;
    if (!list.length) hl = CITY + " is " + t.wins + "-" + t.losses + " with " + plural(t.games_remaining, "game", "games") + " left.";
    else if (!any) hl = "No picks yet. " + CITY + " is " + t.wins + "-" + t.losses + " with " + t.games_remaining + " games left.";
    else hl = "With " + (w + l === 1 ? "this pick" : "these picks") + " (" + w + "-" + l + "), " + CITY + " is " + (t.wins + w) + "-" + (t.losses + l) +
      " with " + (t.games_remaining - w - l) + " games left.";
    $("wf-headline").innerHTML = nw(hl);
    $("wf-reset").hidden = !any;
    $("verdicts").innerHTML = KEY_LINES.map(function (k) {
      var line = lineFor(k.seed), c = verdictCard(line, t, w, l);
      var p0 = base["top" + k.seed], p1 = now["top" + k.seed];
      var est = "Est. chance " + pct(p1) + (any && pct(p0) !== pct(p1) ? " (" + pct(p0) + " before picks)" : "");
      return '<div class="vd st-' + c.state + '" data-seed="' + k.seed + '" data-state="' + c.state + '"><div class="vd-h"><span>' + ord(k.seed) +
        " seed · " + line + " wins</span><em>" + BADGE[c.state] + '</em></div><p class="vd-say">' + esc(c.say) + '</p><span class="vd-n">' +
        esc(c.sub) + " · " + est + "</span></div>";
    }).join("");
  }

  // ------------------------------------------------------------ 03 last night
  function sbCard(g) {
    var vc = { Helped: "helped", Hurt: "hurt", "No stake": "none" }[g.verdict] || "none";
    var rows = [g.away, g.home].map(function (t) {
      return '<div class="sb-r' + (t.abbr === g.winner ? " w" : "") + '" data-team="' + t.abbr + '">' + plate(t.abbr, 32) + "<b>" + t.abbr + "</b><span>" +
        esc(t.short) + "</span><em>" + t.score + "</em>" + star(t.abbr, "lastnight", 14) + "</div>";
    }).join("");
    var fv = gameHasFav(g) ? '<i class="fvdot" title="Your favorite"></i><span class="sr">Your favorite</span>' : "";
    return '<article class="sb-g ' + vc + '" data-game="' + esc(g.id) + '"><div class="sb-t"><span>' + (g.overtime ? "Final · OT" : "Final") + fv +
      '</span><b class="mk ' + vc + '">' + esc(g.verdict) + "</b></div>" + rows + "<p>" + esc(g.verdict_tag) + "</p></article>";
  }
  function renderScoreboard() {
    var w = D.war, isToday = todayAZ() === w.today.date, games = w.last_night.games;
    var order = { Helped: 0, Hurt: 1, "No stake": 2 };
    var sorted = games.slice().sort(function (a, b) { return order[a.verdict] - order[b.verdict] || games.indexOf(a) - games.indexOf(b); });
    var shown = sorted.filter(function (g) { return g.verdict !== "No stake"; });
    var hidden = sorted.filter(function (g) { return g.verdict === "No stake"; });
    var T = w.last_night.tally;
    var s = head("03", (isToday ? "Last night" : "The night before") + " · " + esc(w.yesterday.short) + " · " + plural(games.length, "final", "finals"),
      L.stale ? "How " + esc(w.yesterday.short) + " landed" : "How last night landed", "scoreboard-h", dayText(w.lens.last_night));
    if (!games.length) { $("scoreboard").innerHTML = s; return; }
    s += '<div class="tally"><span class="helped"><b>' + T.Helped + '</b>Helped</span><span class="hurt"><b>' + T.Hurt +
      '</b>Hurt</span><span class="none"><b>' + T["No stake"] + "</b>No stake</span></div>";
    if (!shown.length) s += '<p class="empty-note">No game ' + (L.stale ? "on " + esc(w.yesterday.short) : "last night") + " carried a stake for Phoenix.</p>";
    s += '<div class="sb" id="scoreboard-games">' + shown.map(sbCard).join("") +
      (hidden.length ? panel("ln-more", hidden.map(sbCard).join(""), "flow") : "") + "</div>";
    if (hidden.length) {
      var pairs = hidden.map(function (g) { return g.away.abbr + "-" + g.home.abbr; }).join(", ");
      s += disclose("ln-more", ["Show " + hidden.length + " more", "Show fewer"], "",
        ["No stake games · " + pairs, "Hide the " + plural(hidden.length, "No stake game", "No stake games")]);
    }
    $("scoreboard").innerHTML = s;
  }

  // ------------------------------------------------------------ 04 conference boards
  function conference(name) {
    if (name === "East") {
      return { name: "East", teams: D.east.teams, live: D.east.games_in_progress, hist: D.histEast, history: D.east.history,
        odds: D.east.odds.teams, nSims: D.east.odds.n_sims };
    }
    return { name: "West", teams: D.standings.teams, live: D.standings.games_in_progress, hist: D.hist, history: D.history.teams,
      odds: D.odds.teams, nSims: D.odds.n_sims };
  }
  function spark(code, C, W, H) {
    var line = C.history[code] || [];
    W = W || 112; H = H || 32;
    var px = 5, py = 5, min = null, max = null, peak = 1;
    Object.keys(C.history).forEach(function (t) {
      C.history[t].forEach(function (g) {
        if (min === null || g.date < min) min = g.date;
        if (max === null || g.date > max) max = g.date;
        peak = Math.max(peak, Math.abs(g.wins - g.losses));
      });
    });
    if (!line.length || !min) return '<svg class="spark" viewBox="0 0 ' + W + " " + H + '" aria-hidden="true"></svg>';
    var t0 = parseDay(min).getTime() - 86400000, span = Math.max(1, parseDay(max).getTime() - t0);
    function x(d) { return px + (parseDay(d).getTime() - t0) / span * (W - 2 * px); }
    function y(v) { return H / 2 - v / peak * (H / 2 - py); }
    var pts = [[px, y(0)]];
    line.forEach(function (g) { pts.push([x(g.date), y(g.wins - g.losses)]); });
    var d = pts.map(function (p, i) { return (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1); }).join(" ");
    var last = pts[pts.length - 1], end = line[line.length - 1], net = end.wins - end.losses;
    var label = end.wins + "-" + end.losses + ", " + (net === 0 ? "at .500" : Math.abs(net) + (net > 0 ? " over .500" : " under .500"));
    return '<svg class="spark' + (code === FOCUS ? " hi" : "") + '" viewBox="0 0 ' + W + " " + H + '" width="' + W + '" height="' + H +
      '" role="img" aria-label="Record by day: ' + label + '"><title>Record by day: ' + label + "</title>" +
      '<line class="sp-base" x1="' + px + '" x2="' + (W - px) + '" y1="' + y(0) + '" y2="' + y(0) + '"/>' +
      '<path class="sp-line" d="' + d + '"/><circle class="sp-dot" cx="' + last[0].toFixed(1) + '" cy="' + last[1].toFixed(1) + '" r="3"/></svg>';
  }
  function rowDetail(t, C) {
    var odds = C.odds[t.team] || {}, rem = t.games_remaining;
    var ladder = C.hist.seeds.map(function (seed) {
      var line = lineFor(seed, C.hist), need = Pace.winsNeeded(line, t.wins);
      var p = odds.seed_probs ? odds.seed_probs[seed - 1] : null;
      var key = KEY_LINES.filter(function (k) { return k.seed === seed; })[0];
      return '<tr class="' + (key ? "is-key" : "") + '"><th scope="row">' + ord(seed) + "</th><td>" + line + "</td><td><b>" + need + "</b></td><td>" +
        finishText(need, rem) + "</td><td>" + pct(p) + "</td></tr>";
    }).join("");
    var log = (C.history[t.team] || []).map(function (g) {
      return "<tr><td>" + dowDate(g.date) + "</td><td>" + esc(matchup(g)) + '</td><td><span class="res res-' + g.result + '">' + g.result + " " +
        esc(g.score) + "</span></td><td><b>" + g.wins + "-" + g.losses + "</b></td></tr>";
    }).reverse().join("");
    var diff = t.point_diff_per_game;
    var sum = esc(t.nickname) + ": " + t.wins + "-" + t.losses + ", " + plural(rem, "game", "games") + " left" +
      (t.last_10 && t.last_10 !== "-" ? ", " + esc(t.last_10) + " in the last 10" : "") + ", point differential " + (diff > 0 ? "+" : "") + diff.toFixed(1) + " per game.";
    if (odds.median_wins != null) {
      sum += " Est. finish: " + odds.median_wins + " wins. Eight in ten simulated seasons land between " + odds.low_wins + " and " + odds.high_wins + ".";
    }
    return '<p class="bx-sum">' + sum + '</p><div class="bx-spark"><span class="bx-k">Record by day</span>' + spark(t.team, C, 320, 56) + "</div>" +
      '<div class="bx-grid"><div><h3 class="bx-h">Every seed, 1 through 10</h3><table class="ladder"><thead><tr><th scope="col">Seed</th>' +
      '<th scope="col">Line</th><th scope="col">Need</th><th scope="col">Finish</th><th scope="col">Est.</th></tr></thead><tbody>' + ladder + "</tbody></table></div>" +
      '<div><h3 class="bx-h">Record, day by day</h3><div class="log-wrap"><table class="log"><thead><tr><th scope="col">Date</th><th scope="col">Game</th>' +
      '<th scope="col">Result</th><th scope="col">Record</th></tr></thead><tbody>' + log + "</tbody></table></div></div></div>";
  }
  function bxCell(html) { return '<div class="bx-c" role="cell">' + html + "</div>"; }
  function boardRow(t, C, cols, hiddenRow) {
    var key = C.name + ":" + t.team, me = t.team === FOCUS, pick = isPickTeam(t.team), fav = isFav(t.team);
    var cls = "bd-r" + (me ? " me" : "") + (t.team === "CLE" ? " cle" : "") + (fav ? " fav" : "") + (pick ? " is-pick" : "");
    var expanded = !!openRows[key], did = "bx-" + C.name + "-" + t.team;
    var color = safeColor((team(t.team) || {}).color);
    var row = '<div class="' + cls + '" role="row" id="row-' + C.name + "-" + t.team + '" data-team="' + t.team + '" data-seed="' + t.seed + '" style="--tc:' + color + '"' + (hiddenRow ? " hidden" : "") + ">" +
      '<span class="stc" role="cell">' + star(t.team, "board-" + C.name, 16) + '</span><span class="sd" role="cell">' + t.seed + "</span>" +
      '<span class="tm" role="rowheader"><button type="button" class="tm-btn" aria-expanded="' + expanded + '" aria-controls="' + did + '" data-row="' + key + '">' +
      plate(t.team, 32) + '<span class="tm-nm"><b>' + esc(t.nickname) + "</b>" + (pick ? '<i class="pf">Pick</i>' : "") + "</span>" +
      '<span class="sr">, details</span></button></span>' +
      '<span class="wl" role="cell">' + t.wins + "-" + t.losses + '</span><span class="gb" role="cell">' + esc(t.games_behind || "-") + "</span>" + cols + "</div>";
    return row + '<div class="bx" role="row" id="' + did + '"' + (expanded && !hiddenRow ? "" : " hidden") + ">" + (expanded ? bxCell(rowDetail(t, C)) : "") + "</div>";
  }
  function cutRow(text) { return '<div class="cut" role="row"><span role="cell">' + text + "</span></div>"; }
  function renderBoards() {
    var W = conference("West"), E = conference("East");
    var w6 = lineFor(6, W.hist), w8 = lineFor(8, W.hist), w10 = lineFor(10, W.hist);
    function ph(seed, line) {
      return '<span role="columnheader" aria-label="' + ord(seed) + " seed, line " + line + ' wins: wins needed and est. chance">' + ord(seed) + " · " + line + "</span>";
    }
    var west = '<div class="bd west" id="west-table"><div class="bd-t"><h3 id="west-h">Western Conference</h3><span>Wins needed for each pace line · est. chance</span></div>' +
      '<div class="bd-g" role="table" aria-labelledby="west-h"><div class="bd-h" role="row"><span role="columnheader"><span class="sr">Favorite</span></span>' +
      '<span role="columnheader" aria-label="Seed">#</span><span role="columnheader">Team</span><span role="columnheader" aria-label="Wins and losses">W-L</span>' +
      '<span role="columnheader" aria-label="Games behind">GB</span>' + ph(6, w6) + ph(8, w8) + ph(10, w10) + "</div>" +
      W.teams.map(function (t) {
        var odds = W.odds[t.team] || {};
        var cells = KEY_LINES.map(function (k) {
          var need = Pace.winsNeeded(lineFor(k.seed, W.hist), t.wins), out = need > t.games_remaining;
          return '<span class="pc' + (out ? " out" : "") + '" role="cell" data-line="' + k.seed + '"><b>' + need + '</b><span class="sr"> wins needed for ' + ord(k.seed) +
            (out ? ", " : ", est. chance ") + "</span><i>" + (out ? "out" : pct(odds["top" + k.seed])) + "</i></span>";
        }).join("");
        var cut = t.seed === 7 ? cutRow("Playoff line · 7-10 play-in") : t.seed === 11 ? cutRow("Play-in line · 11-15 out") : "";
        return cut + boardRow(t, W, cells, false);
      }).join("") + "</div></div>";

    // East: seeds 1 to 6 always show, plus Cleveland and any starred team. The rest sit behind "Show full East".
    var eOpen = !!open["east-more"], prev = 0;
    var eastRows = E.teams.map(function (t) {
      var always = t.seed <= 6 || t.team === "CLE" || isFav(t.team);
      var hide = !eOpen && !always;
      if (hide) return boardRow(t, E, "", true).replace('class="bd-r', 'class="bd-r more');
      var s = "";
      if (!eOpen && t.seed !== prev + 1) s += '<div class="cut gap" role="none" aria-hidden="true">&middot; &middot; &middot;</div>';
      // The lines go wherever a visible row crosses them, even when the rows around them are hidden.
      if (prev < 7 && t.seed >= 7) s += cutRow("Playoff line · 7-10 play-in");
      if (prev < 11 && t.seed >= 11) s += cutRow("Play-in line · 11-15 out");
      prev = t.seed;
      var cols = '<span class="gb" role="cell">' + esc(t.last_10 || "-") + '</span><span class="gb" role="cell">' + esc(t.streak || "-") + "</span>";
      return s + boardRow(t, E, cols, false).replace('class="bd-r', 'class="bd-r' + (always ? "" : " more"));
    }).join("");
    var notShown = E.teams.filter(function (t) { return !(t.seed <= 6 || t.team === "CLE" || isFav(t.team)); });
    var east = '<div class="bd east" id="east-table"><div class="bd-t"><h3 id="east-h">Eastern Conference</h3><span>Cleveland&rsquo;s 2027 first is in play</span></div>' +
      '<div class="bd-g" role="table" aria-labelledby="east-h"><div class="bd-h" role="row"><span role="columnheader"><span class="sr">Favorite</span></span>' +
      '<span role="columnheader" aria-label="Seed">#</span><span role="columnheader">Team</span><span role="columnheader" aria-label="Wins and losses">W-L</span>' +
      '<span role="columnheader" aria-label="Games behind">GB</span><span role="columnheader" aria-label="Last 10 games">L10</span><span role="columnheader" aria-label="Streak">Strk</span></div>' +
      '<div id="east-more" role="rowgroup">' + eastRows + "</div></div></div>";
    if (notShown.length) {
      var rng = seedRanges(notShown.map(function (t) { return t.seed; }));
      east += disclose("east-more", ["Show full East", "Hide full East"], plural(notShown.length, "more team", "more teams"),
        [rng, rng + ". Cleveland stays in view either way."],
        notShown.map(function (t) { return "row-East-" + t.team; }).join(" "));
    }
    east += cleFocus();

    var note = "Chances are estimates from " + W.nSims.toLocaleString("en-US") + " simulated seasons, not predictions. " +
      "Tap a team for its seed ladder, record by day and game log." + (favs.length ? " Starred rows are your favorites." : "");
    var live = W.live.map(function (g) { return g.away + " at " + g.home; });
    if (live.length) note += " Not yet counted, in progress at update time: " + live.join(", ") + ".";

    $("standings").innerHTML = head("04", "Standings · All 30 teams", "The conference boards", "standings-h", D.war.lens.standings) +
      '<div class="boards">' + west + '<div class="bd-col">' + east + "</div></div>" + '<p class="fine" id="boards-note">' + esc(note) + "</p>";
  }
  // [8, 9, 11, 12, 13] -> "Seeds 8 to 9 and 11 to 13"
  function seedRanges(seeds) {
    var parts = [], a = seeds[0], b = seeds[0];
    seeds.slice(1).concat([null]).forEach(function (x) {
      if (x === b + 1) { b = x; return; }
      parts.push(a === b ? String(a) : a + " to " + b);
      a = b = x;
    });
    var label = seeds.length === 1 ? "Seed " : "Seeds ";
    return label + (parts.length > 1 ? parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1] : parts[0]);
  }
  function cleFocus() {
    var g = tonightGame("CLE"), body;
    if (g) {
      var st = g.status;
      var stl = st === "in_progress" ? '<span class="live"><i></i>Live · ' + esc(liveShort(g.state_text)) + "</span>"
        : '<span class="fin">' + esc(st === "final" ? g.state_text : g.tip_az) + "</span>";
      var scr = (st === "in_progress" || st === "final") ? g.away.abbr + " " + g.away.score + " · " + g.home.abbr + " " + g.home.score
        : g.away.abbr + " at " + g.home.abbr;
      var mk = st === "final" && g.verdict && g.verdict !== "No stake" ? '<b class="mk ' + (g.verdict === "Helped" ? "helped" : "hurt") + '">' + g.verdict + "</b>" : "";
      body = '<span class="cf-k">' + (L.stale ? "Cleveland, " + esc(D.war.today.short) : "Cleveland tonight") + '</span><div class="cf-s">' + stl + "<b>" + scr + "</b>" + mk + "</div>";
    } else {
      var n = nextFor("CLE");
      body = '<span class="cf-k">' + (n && n.date_az === L.today ? "Cleveland tonight" : "Cleveland next") + '</span><div class="cf-s">' +
        (n ? '<span class="fin">' + dowDate(n.date_az) + " · " + esc(n.tip_az) + "</span><b>" + (n.home_away === "home" ? n.opp + " at CLE" : "CLE at " + n.opp) + "</b>"
          : n === false ? "<b>Comes in with the next refresh</b>" : "<b>Not on the schedule yet</b>") + "</div>";
    }
    return '<div class="cle-f">' + plate("CLE", 40) + '<div class="cf-b">' + body + "</div></div>";
  }

  // ------------------------------------------------------------ 05 pick watch
  function renderPick() {
    var p = D.war.pick, land = p.three.filter(function (t) { return t.lands; });
    var cards = p.three.map(function (t) {
      var lab = t.lands ? (land.length > 1 ? "Tied for Phoenix&rsquo;s pick" : "Phoenix&rsquo;s pick today") : t.abbr === "UTA" ? "Top-5 protected" : "In the race";
      var sub = nw(t.note);
      return '<article class="p pick-card' + (t.lands ? " land is-lands" : "") + (isFav(t.abbr) ? " fav" : "") + '" data-team="' + t.abbr +
        '" style="--tc:' + safeColor(team(t.abbr).color) + '">' + plate(t.abbr, 64) + '<div class="p-b"><span class="p-l">' + lab + "</span><b>" +
        esc(t.short) + '</b><div class="p-n"><span><em class="pick-rec">' + t.record + "</em>Record</span><span><em>" + esc(t.place_label) +
        "</em>Draft order</span></div><p>" + sub + "</p></div>" + star(t.abbr, "pick-card", 20) + "</article>";
    }).join("");
    var marks = p.order.filter(function (o) { return isPickTeam(o.abbr); }).map(function (o) { return o.abbr + " " + o.place_label; }).join(", ");
    var chips = p.order.map(function (r) {
      var cls = "dc ord" + (r.mark === "pick" ? " pick is-pick" : "") + (r.lands ? " land" : "") + (r.mark === "suns" ? " suns is-suns" : "") +
        (isFav(r.abbr) ? " fav" : "");
      return '<li class="' + cls + '" data-team="' + r.abbr + '" style="--tc:' + safeColor(team(r.abbr).color) + '">' +
        '<span class="dp ord-place">' + esc(r.place_label) + "</span>" + plate(r.abbr, 40) + '<b class="ord-name">' + r.abbr + "</b>" +
        '<span class="sr"> ' + esc(r.short) + "</span>" + '<span class="dr ord-rec">' + r.record + "</span>" +
        (r.note ? '<span class="sr">. ' + esc(r.note) + "</span>" : "") + star(r.abbr, "order", 14) + "</li>";
    }).join("");
    $("pick").innerHTML = head("05", "2027 Pick Watch · All 30 teams", "The draft board", "pick-h", D.war.lens.pick,
        "Phoenix owns the least favorable of three 2027 firsts: Utah&rsquo;s (top-5 protected), Cleveland&rsquo;s and Minnesota&rsquo;s.") +
      '<div class="p3" id="pick-three">' + cards + "</div>" +
      disclose("order-more", ["Full draft order", "Hide draft order"], "All 30 teams", ["Worst record first, from the same balldontlie pull · " + marks,
        "Worst record first, from the same balldontlie pull · " + marks]) +
      panel("order-more", '<ol class="dboard" id="pick-order" aria-label="Draft order by record, worst first">' + chips + "</ol>" +
        '<ul class="dkey" aria-label="Draft order marks"><li><i class="k-pick"></i>2027 pick teams</li><li><i class="k-land"></i>Phoenix&rsquo;s pick today</li>' +
        '<li><i class="k-suns"></i>Phoenix</li><li>Ties share a place. No lottery odds are shown.</li></ul><p class="fine" id="order-note">' + nw(p.order_note) + "</p>");
  }

  // ------------------------------------------------------------ 06 week by week
  function renderSchedule() {
    var s = D.suns, as = s.all_star, wf = s.whatif, today = todayAZ();
    var byDate = {};
    s.games.forEach(function (g) { (byDate[g.date_az] = byDate[g.date_az] || []).push(g); });
    var fin = s.games.filter(function (g) { return g.status === "final"; });
    var t = teamRow(FOCUS);
    var ssn = '<div class="ssn" role="list" aria-label="Season so far"><span>Season so far</span>' + fin.map(function (g) {
      return '<i class="' + g.result + '" role="listitem" title="' + dowDate(g.date_az) + " " + esc(matchup(g)) + ", " + g.result + " " + esc(g.score) +
        '" aria-label="' + dowDate(g.date_az) + " " + esc(matchup(g)) + ", " + (g.result === "W" ? "win" : "loss") + " " + esc(g.score) + '">' + g.result + "</i>";
    }).join("") + "<b>" + t.wins + "-" + t.losses + "</b></div>";

    // The calendar week (Sunday to Saturday) of the reader's day on the Arizona clock, or of the pull's day if
    // that is later. "This week" and "Next week" are those two weeks. The what-if week rolls forward once this
    // week's last Suns game is final, so it cannot anchor the board.
    var day0 = parseDay(today > D.war.today.date ? today : D.war.today.date);
    var last = parseDay(s.games[s.games.length - 1].week_start), first = addDays(day0, -day0.getUTCDay());
    var weeks = [];
    for (var ws = first; ws <= last; ws = addDays(ws, 7)) weeks.push(ws);
    function week(ws, i) {
      var we = addDays(ws, 6), tix = "";
      for (var d = 0; d < 7; d++) {
        var day = addDays(ws, d), iso = isoDay(day), td = iso === today ? " today" : "";
        (byDate[iso] || []).forEach(function (g) {
          var r;
          if (g.status === "final") r = '<em class="res res-' + g.result + '">' + g.result + " " + esc(g.score) + "</em>";
          else r = "<em>" + (STATUS_TEXT[g.status] || esc(g.tip_az)) + "</em>" + (picks[g.id] ? '<span class="badge wi">What-if ' + picks[g.id] + "</span>" : "");
          tix += '<div class="tix ' + g.home_away + td + '" data-id="' + esc(g.id) + '"><span class="tx-d">' + DOW[day.getUTCDay()] + " " + shortDate(iso) +
            (td ? " · Today" : "") + '</span><div class="tx-o">' + plate(g.opp, 36) + "<b>" + (g.home_away === "home" ? "vs " : "at ") + g.opp + "</b></div>" +
            r + (g.note && /cup/i.test(g.note) ? '<span class="cup">NBA Cup</span>' : "") + "</div>";
        });
        if (!(byDate[iso] || []).length && iso === as.game_date) {
          tix += '<div class="tix asb' + td + '"><span class="tx-d">' + DOW[day.getUTCDay()] + " " + shortDate(iso) + '</span><div class="tx-o"><b>All-Star Game</b></div>' +
            "<em>In Phoenix · All-Star break " + shortDate(as.break_start) + " to " + shortDate(as.break_end) + "</em></div>";
        }
      }
      var range = MONTHS[ws.getUTCMonth()] + " " + ws.getUTCDate() + " to " + (we.getUTCMonth() === ws.getUTCMonth() ? "" : MONTHS[we.getUTCMonth()] + " ") + we.getUTCDate();
      var flag = i === 0 ? "<span>This week</span>" : i === 1 ? '<span class="nx">Next week</span>' : "";
      return '<div class="wk' + (i === 0 ? " is-this" : "") + '"' + (i === 0 ? ' id="this-week"' : "") + '><div class="wk-l"><b>' + range + "</b>" + flag + '</div><div class="wk-g">' +
        (tix || '<p class="wk-none">No Suns games this week.</p>') + "</div></div>";
    }
    var near = weeks.slice(0, 2).map(week).join(""), rest = weeks.slice(2).map(function (w, i) { return week(w, i + 2); }).join("");
    var lastG = s.games[s.games.length - 1];
    var lede = "Upcoming games pick up a What-if badge when you choose a result above.";
    if (s.games_unscheduled > 0) {
      lede = "balldontlie lists " + s.games_listed + " of 82 games. The league sets the other " + s.games_unscheduled +
        " after NBA Cup group play, so they are not on the board yet. " + lede;
    }
    $("schedule").innerHTML = head("06", "Suns schedule · This week and next", "Week by week", "sched-h", dayText(D.war.lens.schedule), nw(lede)) + ssn +
      '<div class="wks" id="weeks">' + near + "</div>" +
      (weeks.length > 2 ? disclose("weeks-more", ["Show all " + weeks.length + " weeks", "Show two weeks"], (weeks.length - 2) + " more weeks",
        ["The rest of the regular season, through " + dowDate(lastG.date_az) + ", " + lastG.date_az.slice(0, 4),
          "Hide the weeks after next week"]) +
        panel("weeks-more", '<div class="wks">' + rest + "</div>") : "") +
      '<div class="key"><span><i class="home"></i>Home</span><span><i class="road"></i>Road</span><span><i class="tdy"></i>Today</span><span>All tip times Arizona time (AZ)</span></div>';
  }

  // ------------------------------------------------------------ sources
  function renderSources() {
    var h = D.hist, c = D.check, o = D.odds, w = D.war, ws = w.sources, he = D.histEast;
    var seasons = Object.keys(h.seasons);
    function paceTable(hh) {
      return '<div class="src-table-wrap"><table class="src-table"><thead><tr><th scope="col">Season</th>' +
        hh.seeds.map(function (s) { return '<th scope="col">' + s + "</th>"; }).join("") + "</tr></thead><tbody>" +
        Object.keys(hh.seasons).map(function (s) {
          return '<tr><th scope="row">' + s + "</th>" + hh.seasons[s].map(function (r) { return "<td>" + r.wins + "</td>"; }).join("") + "</tr>";
        }).join("") + '<tr class="median"><th scope="row">Median</th>' + hh.median_wins_by_seed.map(function (m) { return "<td>" + m + "</td>"; }).join("") +
        "</tr></tbody></table></div>";
    }
    var ok = 0, bad = [];
    c.teams.forEach(function (r) {
      if (r.match && r.match.bdl_game_results === true) ok++; else bad.push(r.team);
    });
    var cross = "At that time " + ok + " of " + c.teams.length + " records matched the results derived from the same balldontlie games pull." + (bad.length ? " Not matched: " + bad.join(", ") + "." : "");
    var live = D.standings.games_in_progress;
    if (live.length) cross += " Games in progress at that time are not counted: " + live.map(function (g) { return g.away + " at " + g.home; }).join(", ") + ".";
    var links = seasons.join(", ");
    var eastLinks = seasons.join(", ");
    var boards = [w.today.short, w.yesterday.short].map(function (lab) { return esc(lab); }).join(" and ");
    var m = o.method;
    var notes = [
      ["Standings, schedules and scores", '<p>balldontlie (<a href="https://www.balldontlie.io/" rel="noopener">balldontlie.io</a> standings and games), pulled ' +
        esc(D.standings.as_of_display) + ". " + esc(cross) + "</p>"],
      ["Tonight's games and last night's scores", "<p>balldontlie games for " + boards + ", pulled " + esc(w.as_of_display) +
        " in the same pull as the standings, so every section on this page agrees. Tip times are converted to Arizona time (AZ). " + esc(ws.crosscheck) + "</p>"],
      ["Pace lines", "<p>Each pace line is the median final win total of the team that finished at that West seed over the last five full 82-game seasons of the play-in era: " +
        seasons.join(", ") + ". The 2019-20 and 2020-21 seasons are left out because they were shortened. Win totals come from balldontlie season standings (" +
        links + "), last checked " + nw(h.last_verified) + ". balldontlie is the only source for these totals.</p>" + paceTable(h)],
      ["Wins still needed", "<p>Wins still needed is the pace line minus current wins, never below zero. Games left is 82 minus games played. " +
        "A line is out of reach when the wins still needed are more than the games left.</p>"],
      ["Seeding rule", "<p>" + nw(ws.seeding_rule) + "</p>"],
      ["Pick rule", "<p>" + esc(ws.pick_rule) + "</p>"],
      ["Helped, Hurt and No stake", "<p>" + esc(ws.marks_rule) + "</p>"],
      ["Pick Watch", "<p>" + esc(ws.pick_facts) + " " + esc(ws.order_rule) + "</p>"],
      ["East table", "<p>The East board comes from the same balldontlie pull and uses the same math as the West board. East pace lines are the median final win total " +
        "at each East seed over the same five seasons, from balldontlie season standings (" + eastLinks + "), last checked " + nw(he.last_verified) +
        ". East chances come from " + D.east.odds.n_sims.toLocaleString("en-US") + " simulated runs of the remaining East schedule, using the method under Estimated chances.</p>" + paceTable(he)],
      ["Phoenix lens", "<p>Each Phoenix lens line is written by the refresh from the same pull: the standings, both scoreboards, the Suns schedule and the pace lines. " +
        "None of them is typed in by hand.</p>"],
      ["Favorites", "<p>Stars are saved only in this browser, on this device. Nothing is sent anywhere. Next and last games for a starred team come from that team's schedule in the same balldontlie pull.</p>"],
      ["Win rates in the what-if", "<p>Each <span class=\"nw\">what-if</span> card takes the wins Phoenix still needs for that seed line over the games left, before and after the picked games, " +
        "and shows the win rate that takes, rounded to the whole percent with halves up, the same way as the pace rows in the Phoenix lens. " +
        "A line shows Reached once the wins are banked and Out of reach once the wins needed are more than the games left. Otherwise it is In play.</p>"],
      ["Estimated chances", "<p>The chances are estimates from " + o.n_sims.toLocaleString("en-US") + " simulated runs of the remaining schedule, with a fixed random seed (" + o.seed +
        ") so reruns match. Each team's strength is " + esc(m.strength) + ": its record with 10 wins and 10 losses added, which pulls every team toward .500 so a winless team still has a chance each night. " +
        "The chance that team A beats team B is a(1-b) divided by a(1-b) + b(1-a), where a and b are the two strengths. There is no home-court adjustment. " +
        "Games the league has not scheduled yet are played against a .500 opponent. Ties in the final standings go to the team with more conference wins, then to a random draw, " +
        "which is simpler than the NBA's real tiebreak rules. The model does not know about injuries, trades or rest.</p>"],
      ["Schedule and All-Star break", "<p>The Suns schedule is from balldontlie, with tip times converted to Arizona time. " +
        (D.suns.games_unscheduled > 0 ? "balldontlie lists " + D.suns.games_listed + " of 82 games. The league sets the other " + D.suns.games_unscheduled +
          " after NBA Cup group play ends, so they are left off the week board. NBA Cup group games are on the board and tagged. " : "") +
        "All-Star dates: break February 19 through 24, 2027; game on Sunday, February 21, at Mortgage Matchup Center in Phoenix.</p>"],
      ["Playoff format", "<p>Seeds 1 through 6 in each conference go straight to the playoffs. Seeds 7 through 10 play in: 7 hosts 8 and the winner is in, the loser then hosts the winner of 9 against 10 for the last spot.</p>"]
    ];
    var p = asOfParts();
    var srcSub = "balldontlie standings, schedules and scores, " + p.time + " · Internal consistency check · Simulation in the same refresh";
    $("sources").innerHTML = '<h2 class="sr" id="sources-h">Sources</h2>' + disclose("sources-more", ["Sources", "Hide sources"], notes.length + " notes", [srcSub, srcSub]) +
      panel("sources-more", '<div class="src-g" id="sources-body">' + notes.map(function (n) { return "<div><h3>" + nw(n[0]) + "</h3>" + n[1] + "</div>"; }).join("") + "</div>") +
      '<p class="colo">Standings War · Built for Mat Ishbia<span class="ver" title="Standings War 1.1.0"> · <span>v1.1</span></span></p>';
  }

  // ------------------------------------------------------------ events

  // ------------------------------------------------------------ how it works: the launch film, in an overlay
  // One small button under the welcome line opens the film full screen. Phones get the vertical cut with captions burned
  // in; wider screens get the widescreen cut with a captions track. Nothing loads until the button is tapped, the tap
  // starts it with sound, and closing pauses it and puts the reader back where they were. #howitworks opens it too.
  var FILM = {
    v: { src: "video/standings-war-how-it-works-v2-9x16.mp4", poster: "video/poster-v2-9x16.jpg", w: 720, h: 1280, cut: "9x16" },
    h: { src: "video/standings-war-how-it-works-v2-16x9.mp4", poster: "video/poster-v2-16x9.jpg", w: 1280, h: 720, cut: "16x9",
      vtt: "video/standings-war-how-it-works-v2-16x9.vtt" },
    rates: [1, 1.25, 1.5, 2]
  };
  var filmRate = 1, film = null;   // film: { opener, scrollY, keydown } while the overlay is open
  function filmPhone() { return !!(window.matchMedia && window.matchMedia("(max-width:600px)").matches); }
  function filmURL(rel) { return new URL(rel, document.baseURI).href; }
  function filmCut() { return filmPhone() ? FILM.v : FILM.h; }
  function filmPageURL() { return location.href.split("#")[0] + "#howitworks"; }
  function renderFilmButton() {
    $("hiw-open-slot").innerHTML =
      '<button type="button" class="hiw-open" id="hiw-open" aria-haspopup="dialog" aria-controls="hiw-dlg">' +
      '<span class="hiw-play" aria-hidden="true"></span><span class="hiw-open-t">Watch how it works</span>' +
      '<span class="hiw-open-d"><span class="sr">, </span>1:02</span></button>';
  }
  function filmFocusables() {
    return Array.prototype.filter.call($("hiw-dlg").querySelectorAll("button, a[href], video[controls]"),
      function (e) { return !e.disabled && e.getClientRects().length; });
  }
  function openFilm(opts) {
    opts = opts || {};
    if (film) return;
    var c = filmCut(), vert = c === FILM.v, dlg = $("hiw-dlg");
    var track = vert ? "" : '<track kind="captions" src="' + c.vtt + '" srclang="en" label="English" default>';
    var speeds = FILM.rates.map(function (r) {
      return '<button type="button" class="hiw-rate' + (r === filmRate ? " on" : "") + '" data-rate="' + r + '" aria-pressed="' + (r === filmRate) + '">' + r + "x</button>";
    }).join("");
    dlg.className = "hiw-dlg" + (vert ? " vert" : "");
    dlg.innerHTML =
      '<div class="hiw-panel">' +
      '<div class="hiw-top"><p class="hiw-title" id="hiw-dlg-t">How it works <span class="hiw-dur">· 62-second tour</span></p>' +
      '<button type="button" class="hiw-x" id="hiw-close" aria-label="Close the film"><span aria-hidden="true">&times;</span></button></div>' +
      '<div class="hiw-frame"><video id="hiw-video" controls playsinline preload="auto" poster="' + c.poster + '" width="' + c.w + '" height="' + c.h +
      '" data-cut="' + c.cut + '" aria-label="Standings War: how it works, 62 seconds' + (vert ? ", captions on the picture" : "") + '">' +
      '<source src="' + c.src + '" type="video/mp4">' + track + '<a href="' + c.src + '">Watch the film (MP4)</a></video></div>' +
      '<div class="hiw-bar"><div class="hiw-speed" role="group" aria-label="Playback speed"><span class="hiw-k">Speed</span>' + speeds + "</div>" +
      '<div class="hiw-share"><button type="button" class="hiw-btn" id="hiw-share">Share</button>' +
      '<a class="hiw-link" href="' + c.src + '" target="_blank" rel="noopener">MP4</a></div></div>' +
      '<p class="hiw-note" id="hiw-status" role="status" aria-live="polite"></p>' +
      '<p class="hiw-when">Filmed on the Mon Nov 16 board; the page itself updates with every refresh.</p></div>';
    film = { opener: opts.opener || $("hiw-open"), scrollY: window.scrollY || window.pageYOffset || 0, fromHash: !!opts.fromHash };
    // Lock the page behind it in place (iOS-safe) and take it out of the tab order and the accessibility tree.
    var b = document.body;
    b.style.top = -film.scrollY + "px";
    b.classList.add("film-open");
    Array.prototype.forEach.call(document.querySelectorAll("body > header, body > main"), function (e) { e.setAttribute("inert", ""); e.setAttribute("aria-hidden", "true"); });
    // A native modal <dialog>: the browser traps focus, makes the page inert and turns Esc into a cancel event even when
    // focus is inside the video's own controls (their key events never reach page listeners).
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", "");
    var v = $("hiw-video");
    v.playbackRate = v.defaultPlaybackRate = filmRate;
    v.addEventListener("loadedmetadata", function () { v.playbackRate = filmRate; });
    film.keydown = function (e) {
      if (e.key === "Escape") { e.preventDefault(); closeFilm(); return; }
      if (e.key !== "Tab") return;
      var f = filmFocusables(); if (!f.length) return;
      var first = f[0], last = f[f.length - 1], a = document.activeElement;
      if (e.shiftKey && (a === first || !dlg.contains(a))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (a === last || !dlg.contains(a))) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", film.keydown, true);
    $("hiw-close").focus();
    // The tap that opened it is the reader's own gesture, so it starts with sound. A shared #howitworks link opens it
    // without a tap, so it waits on the poster with its play button instead of autoplaying.
    if (opts.play !== false) {
      var pr = v.play();
      if (pr && pr.catch) pr.catch(function () {});
    }
  }
  function closeFilm() {
    if (!film) return;
    var v = $("hiw-video"), dlg = $("hiw-dlg"), f = film;
    if (v) { try { v.pause(); } catch (e) {} v.removeAttribute("src"); Array.prototype.forEach.call(v.querySelectorAll("source"), function (s) { s.remove(); }); try { v.load(); } catch (e) {} }
    document.removeEventListener("keydown", f.keydown, true);
    if (dlg.open && dlg.close) dlg.close(); else dlg.removeAttribute("open");
    dlg.innerHTML = "";
    Array.prototype.forEach.call(document.querySelectorAll("body > header, body > main"), function (e) { e.removeAttribute("inert"); e.removeAttribute("aria-hidden"); });
    document.body.classList.remove("film-open");
    document.body.style.top = "";
    window.scrollTo({ top: f.scrollY, left: 0, behavior: "instant" });   // instant: the page has smooth scrolling for nav links
    if (location.hash === "#howitworks" && history.replaceState) history.replaceState(null, "", location.pathname + location.search);
    film = null;
    var o = f.opener && document.contains(f.opener) ? f.opener : $("hiw-open");
    if (o) o.focus({ preventScroll: true });
  }
  function setFilmRate(r) {
    filmRate = r;
    var v = $("hiw-video");
    if (v) { v.playbackRate = r; v.defaultPlaybackRate = r; }
    Array.prototype.forEach.call(document.querySelectorAll(".hiw-rate"), function (b) {
      var on = parseFloat(b.getAttribute("data-rate")) === r;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", String(on));
    });
  }
  // Share the page link that opens the film (#howitworks), so the person gets the site and the film; the MP4 link
  // beside it is the file itself.
  function shareFilm() {
    var url = filmPageURL(), status = $("hiw-status");
    var data = { title: "Standings War: how it works", text: "A 62-second tour of Standings War.", url: url };
    function copied(ok) { status.textContent = ok ? "Link copied: " + url : "Copy this link: " + url; }
    if (navigator.share) {
      navigator.share(data).then(function () { status.textContent = "Shared."; }, function () {});
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () { copied(true); }, function () { copied(false); });
    } else copied(false);
  }
  function setupFilm() {
    renderFilmButton();
    var dlg = $("hiw-dlg");
    dlg.addEventListener("click", function (e) { if (e.target === e.currentTarget) closeFilm(); });   // the backdrop
    dlg.addEventListener("cancel", function (e) { e.preventDefault(); closeFilm(); });                // Esc, wherever focus is
    window.addEventListener("hashchange", function () { if (location.hash === "#howitworks") openFilm({ fromHash: true, play: false }); });
    if (location.hash === "#howitworks") openFilm({ fromHash: true, play: false });
  }

  function renderAll() {
    renderTicker();
    renderHero();
    renderLines();
    renderTonightStrip();
    renderFavorites();
    renderRooting();
    renderWhatif();
    renderScoreboard();
    renderBoards();
    renderPick();
    renderSchedule();
    renderSources();
  }
  function renderFavParts() {
    renderFavorites();
    renderRooting();
    renderScoreboard();
    renderBoards();
    renderPick();
  }

  function onClick(e) {
    var el = e.target.closest ? e.target : null;
    if (!el) return;
    var starBtn = el.closest(".star[data-fav]");
    if (starBtn) {
      var code = starBtn.getAttribute("data-fav"), where = starBtn.getAttribute("data-where");
      toggleFav(code);
      renderFavParts();
      // The stars were redrawn, so put focus back on the same star (or the favorites heading if its card left).
      var again = document.querySelector('.star[data-fav="' + code + '"][data-where="' + where + '"]');
      if (again && again.getClientRects().length) again.focus();
      else if (where === "board-East" && document.querySelector('.disc[data-disc="east-more"]')) document.querySelector('.disc[data-disc="east-more"]').focus();
      else if ($("favorites-h")) { $("favorites-h").setAttribute("tabindex", "-1"); $("favorites-h").focus(); }
      return;
    }
    var wl = el.closest(".wl-btn");
    if (wl) {
      var id = wl.getAttribute("data-id"), p = wl.getAttribute("data-pick");
      if (picks[id] === p) delete picks[id]; else picks[id] = p;
      renderWhatifGames();
      renderVerdicts();
      renderSchedule();
      freshen();
      var b = $("wf-games").querySelector('.wl-btn[data-id="' + id + '"][data-pick="' + p + '"]');
      if (b) b.focus();
      return;
    }
    if (el.closest("#wf-reset")) {
      picks = {};
      renderWhatifGames();
      renderVerdicts();
      renderSchedule();
      freshen();
      var f = $("wf-games").querySelector(".wl-btn");
      if (f) f.focus();
      return;
    }
    var disc = el.closest(".disc[data-disc]");
    if (disc) { toggleDisc(disc.getAttribute("data-disc")); return; }
    var rowBtn = el.closest(".tm-btn");
    if (rowBtn) { toggleRow(rowBtn); return; }
    if (el.closest("#hiw-open")) { openFilm({ opener: el.closest("#hiw-open") }); return; }
    if (el.closest("#hiw-close")) { closeFilm(); return; }
    var rateBtn = el.closest(".hiw-rate");
    if (rateBtn) { setFilmRate(parseFloat(rateBtn.getAttribute("data-rate"))); return; }
    if (el.closest("#hiw-share")) { shareFilm(); return; }
    if (el.closest("#pace-info-btn")) togglePaceInfo();
  }

  function toggleRow(btn) {
    var key = btn.getAttribute("data-row"), box = $(btn.getAttribute("aria-controls"));
    var isOpen = btn.getAttribute("aria-expanded") !== "true";
    openRows[key] = isOpen;
    btn.setAttribute("aria-expanded", String(isOpen));
    if (isOpen) {
      var parts = key.split(":"), C = conference(parts[0]);
      var t = C.teams.filter(function (x) { return x.team === parts[1]; })[0];
      box.innerHTML = bxCell(rowDetail(t, C));
      box.hidden = false;
      reveal(box);
    } else {
      box.hidden = true;
    }
  }

  // Open or close one of the collapsibles. The East board redraws because its gap markers change.
  function toggleDisc(id) {
    open[id] = !open[id];
    if (id === "east-more") {
      renderBoards();
      var b = document.querySelector('.disc[data-disc="east-more"]');
      if (b) b.focus();
      if (open[id]) Array.prototype.forEach.call(document.querySelectorAll("#east-more .bd-r.more"), reveal);
      return;
    }
    var btn = document.querySelector('.disc[data-disc="' + id + '"]'), p = $(id);
    btn.setAttribute("aria-expanded", String(open[id]));
    if (id === "board-all") {   // the board folds by class (its lead row stays), not by hiding one panel
      btn.classList.toggle("open", open[id]);
      btn.querySelector(".dc-t").textContent = open[id] ? "Hide" : "Show";
      btn.querySelector(".dc-b").textContent = JSON.parse(btn.getAttribute("data-labels"))[open[id] ? 1 : 0];
      btn.querySelector(".dc-s").textContent = JSON.parse(btn.getAttribute("data-subs"))[open[id] ? 1 : 0];
      p.classList.toggle("folded", !open[id]);
      if (open[id]) Array.prototype.forEach.call(p.querySelectorAll(".tb-fold"), reveal);
      return;
    }
    btn.classList.toggle("open", open[id]);
    btn.querySelector(".dc-t").textContent = open[id] ? "Hide" : "Show";
    var i = open[id] ? 1 : 0;
    btn.querySelector(".dc-b").textContent = JSON.parse(btn.getAttribute("data-labels"))[i];
    btn.querySelector(".dc-s").textContent = JSON.parse(btn.getAttribute("data-subs"))[i];
    if (open[id]) {
      p.hidden = false;
      if (p.classList.contains("flow")) Array.prototype.forEach.call(p.children, reveal); else reveal(p);
    }
    else p.hidden = true;
  }

  // A short fade and slide for anything that just opened. Skipped with reduced motion.
  function reveal(el) {
    if (!motionOK() || !el.animate) return;
    el.animate([{ opacity: 0, transform: "translateY(-6px)" }, { opacity: 1, transform: "none" }], { duration: 220, easing: "cubic-bezier(.2,.7,.2,1)" });
  }
  function freshen() {
    ["verdicts", "wf-headline"].forEach(function (id) {
      var el = $(id);
      el.classList.remove("is-fresh");
      void el.offsetWidth;
      el.classList.add("is-fresh");
    });
  }


  // The section nav marks the section you are reading.
  function setupNav() {
    var links = Array.prototype.slice.call(document.querySelectorAll("#secnav a"));
    links[0].classList.add("on");
    links[0].setAttribute("aria-current", "true");
    if (!("IntersectionObserver" in window)) return;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        links.forEach(function (a) {
          var on = a.getAttribute("href") === "#" + e.target.id;
          a.classList.toggle("on", on);
          if (on) a.setAttribute("aria-current", "true"); else a.removeAttribute("aria-current");
        });
      });
    }, { rootMargin: "-40% 0px -55% 0px" });
    links.forEach(function (a) { var s = document.querySelector(a.getAttribute("href")); if (s) io.observe(s); });
  }

  function load(name) {
    return fetch("data/" + name + "?t=" + Date.now(), { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error(name + " " + r.status);
      return r.json();
    });
  }

  function boot() {
    Promise.all([
      load("standings.json"), load("games.json"), load("suns-schedule.json"),
      load("historical-west-seeds.json"), load("record-history.json"),
      load("probabilities.json"), load("crosscheck.json"),
      load("war.json"), load("east.json"), load("historical-east-seeds.json")
    ]).then(function (r) {
      D = { standings: r[0], games: r[1], suns: r[2], hist: r[3], history: r[4], odds: r[5], check: r[6],
        war: r[7], east: r[8], histEast: r[9] };
      checkData();
      setDayWords();
      loadFavs();
      renderAll();
      setDayChrome();
      setupNav();
      document.addEventListener("click", onClick);
      setupFilm();
      document.body.classList.add("is-ready");
    }).catch(function (err) {
      $("hero-answer").textContent = "The data did not load.";
      $("hero-sub").textContent = "Serve this folder over http and run the refresh first. See README.md. (" + err.message + ")";
      if (window.console) console.warn(err);
    });
  }

  boot();
})();
