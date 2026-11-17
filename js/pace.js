/* Pace math. No DOM in here, so the proof scripts can run the same functions
   the page uses (node proof/whatif-check.js). */
(function (root) {
  "use strict";

  var SEASON_GAMES = 82;

  // Wins still needed = max(0, pace line - current wins).
  function winsNeeded(line, wins) {
    return Math.max(0, line - wins);
  }

  // Fewest wins in the next `games` games that keep the required win rate from
  // rising: the smallest k with (need - k) / (remaining - games) <= need / remaining,
  // which is the same as k >= games * need / remaining.
  function minWinsToHold(need, remaining, games) {
    if (need <= 0 || games <= 0) return 0;
    return Math.ceil((need * games) / remaining - 1e-9);
  }

  function rate(need, remaining) {
    return remaining > 0 ? need / remaining : need > 0 ? Infinity : 0;
  }

  // picks: array with "W", "L" or null for each what-if game.
  function verdict(line, wins, losses, picks) {
    var g = picks.length;
    var w = picks.filter(function (p) { return p === "W"; }).length;
    var l = picks.filter(function (p) { return p === "L"; }).length;
    var u = g - w - l;
    var rem0 = SEASON_GAMES - wins - losses;
    var need0 = winsNeeded(line, wins);
    var winsAfter = wins + w;
    var lossesAfter = losses + l;
    var remAfter = SEASON_GAMES - winsAfter - lossesAfter;
    var needAfter = winsNeeded(line, winsAfter);
    var minWins = minWinsToHold(need0, rem0, g);
    var state;
    if (need0 === 0) state = "reached";
    else if (need0 > rem0) state = "out";
    else if (g === 0) state = "idle";
    else if (u === 0) state = w >= minWins ? "on" : "off";
    else if (w >= minWins) state = "safe";
    else if (w + u < minWins) state = "off";
    else state = "open";
    return {
      line: line, games: g, w: w, l: l, unset: u,
      need0: need0, rem0: rem0, rate0: rate(need0, rem0),
      winsAfter: winsAfter, lossesAfter: lossesAfter,
      needAfter: needAfter, remAfter: remAfter, rateAfter: rate(needAfter, remAfter),
      minWins: minWins, stillNeeds: Math.max(0, minWins - w), state: state
    };
  }

  var api = {
    SEASON_GAMES: SEASON_GAMES,
    winsNeeded: winsNeeded,
    minWinsToHold: minWinsToHold,
    rate: rate,
    verdict: verdict
  };
  root.Pace = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
