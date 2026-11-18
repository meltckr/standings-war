/* Standings War live-score poller.
   Polls same-origin data/war.json every 30s only while any game is in_progress.
   When nothing is live: zero polling, zero extra requests. Re-checks on load and
   when the tab becomes visible again. Stops once every game is final. */
(function () {
  "use strict";

  var INTERVAL_MS = 30000;
  var timer = null;
  var inFlight = false;
  var readyTimer = null;

  function api() { return window.StandingsWarLive; }

  function ready() {
    var a = api();
    return !!(a && typeof a.getWar === "function" && a.getWar() && typeof a.hasLive === "function" && typeof a.applyWar === "function");
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function start() {
    if (timer) return;
    timer = setInterval(tick, INTERVAL_MS);
  }

  function tick() {
    if (inFlight) return;
    if (document.visibilityState === "hidden") return;
    if (!ready()) return;
    var a = api();
    if (dataIsStale() || !a.hasLive()) {
      stop();
      return;
    }
    inFlight = true;
    fetch("data/war.json?t=" + Date.now(), { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("war.json " + r.status);
        return r.json();
      })
      .then(function (war) {
        a.applyWar(war);
        if (!a.hasLive(war)) stop();
      })
      .catch(function (err) {
        if (window.console) console.warn(err);
      })
      .then(function () {
        inFlight = false;
      });
  }

  function dataIsStale() {
    var a = api(), war = a && a.getWar && a.getWar();
    if (!war || !war.today || !war.today.date) return false;
    try {
      var today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Phoenix" });
      return today !== war.today.date;
    } catch (e) { return false; }
  }

  // Decide from currently loaded data only — no fetch when nothing is live.
  function syncFromLoaded() {
    if (!ready()) return;
    var a = api();
    if (dataIsStale()) { stop(); return; }
    if (a.hasLive()) start();
    else stop();
  }

  function onVisible() {
    if (document.visibilityState !== "visible") {
      stop();
      return;
    }
    syncFromLoaded();
    // If a live window is open, pull once immediately so scores catch up after a hidden tab.
    if (ready() && api().hasLive()) tick();
  }

  function waitForBoot() {
    var n = 0;
    if (readyTimer) clearInterval(readyTimer);
    readyTimer = setInterval(function () {
      n += 1;
      if (ready()) {
        clearInterval(readyTimer);
        readyTimer = null;
        syncFromLoaded();
      } else if (n > 150) {
        clearInterval(readyTimer);
        readyTimer = null;
      }
    }, 100);
  }

  document.addEventListener("visibilitychange", onVisible);
  waitForBoot();
})();
