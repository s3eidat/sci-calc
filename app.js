/* Scientific Calculator — our own parser (no eval); answers rounded to 12 significant digits for display only. */
(function () {
  "use strict";
  var $ = S3.$, $$ = S3.$$;
  var KEY = "sci.v1";

  // ---------- expression engine: tokenizer → recursive-descent parser → closures. No eval, no globals. ----------
  // Precedence (low → high): + −  |  × ÷ and implicit multiplication  |  unary −  |  ^ (right-assoc)  |  postfix ! %
  // so 2^3^2 = 512, −2^2 = −4, 2(3+4) = 14, 2x^2 = 2·(x²).
  var Expr = (function () {
    var FN = Object.create(null), CONST = Object.create(null);
    function def(name, arity, f, angle) { FN[name] = { arity: arity, f: f, angle: !!angle }; } // angle: f(…, mode)
    function snap(v) { return Math.abs(v) < 1e-15 ? 0 : v; }
    // Trig in degrees is exact at multiples of 90° (sin 180° = 0, cos 90° = 0, tan 90° undefined).
    function trig(name, x, mode) {
      var deg = mode === "deg" ? x : mode === "grad" ? x * 0.9 : null;
      if (deg !== null && isFinite(deg) && deg % 90 === 0) {
        var q = (((deg / 90) % 4) + 4) % 4, s = [0, 1, 0, -1][q], c = [1, 0, -1, 0][q];
        if (name === "sin") return s; if (name === "cos") return c;
        if (name === "tan") return c === 0 ? NaN : s / c; if (name === "cot") return s === 0 ? NaN : c / s;
        if (name === "sec") return c === 0 ? NaN : 1 / c; if (name === "csc") return s === 0 ? NaN : 1 / s;
      }
      var r = deg !== null ? deg * Math.PI / 180 : x;
      var v = name === "sin" ? Math.sin(r) : name === "cos" ? Math.cos(r) : name === "tan" ? Math.tan(r) :
        name === "sec" ? 1 / Math.cos(r) : name === "csc" ? 1 / Math.sin(r) : 1 / Math.tan(r);
      return snap(v);
    }
    function inv(v, mode) { return mode === "deg" ? v * 180 / Math.PI : mode === "grad" ? v * 200 / Math.PI : v; }
    ["sin", "cos", "tan", "sec", "csc", "cot"].forEach(function (n) { def(n, 1, function (x, m) { return trig(n, x, m); }, true); });
    def("asin", 1, function (x, m) { return inv(Math.asin(x), m); }, true); def("acos", 1, function (x, m) { return inv(Math.acos(x), m); }, true);
    def("atan", 1, function (x, m) { return inv(Math.atan(x), m); }, true);
    def("atan2", 2, function (y, x, m) { return inv(Math.atan2(y, x), m); }, true);
    def("sinh", 1, Math.sinh); def("cosh", 1, Math.cosh); def("tanh", 1, Math.tanh);
    def("asinh", 1, Math.asinh); def("acosh", 1, Math.acosh); def("atanh", 1, Math.atanh);
    def("sqrt", 1, Math.sqrt); def("cbrt", 1, Math.cbrt); def("abs", 1, Math.abs); def("exp", 1, Math.exp);
    def("ln", 1, Math.log); def("log10", 1, Math.log10); def("log2", 1, Math.log2);
    def("log", [1, 2], function (x, b) { return b === undefined ? Math.log10(x) : Math.log(x) / Math.log(b); });
    def("root", 2, function (x, n) { return x < 0 && Math.round(n) === n && n % 2 ? -Math.pow(-x, 1 / n) : Math.pow(x, 1 / n); });
    def("floor", 1, Math.floor); def("ceil", 1, Math.ceil); def("round", 1, Math.round); def("sign", 1, Math.sign);
    def("min", [1, 99], Math.min); def("max", [1, 99], Math.max);
    def("mod", 2, function (a, b) { return a - b * Math.floor(a / b); });
    def("nCr", 2, function (n, r) { return comb(n, r, false); }); def("nPr", 2, function (n, r) { return comb(n, r, true); });
    def("fact", 1, factorial); def("gamma", 1, gamma);
    CONST.pi = Math.PI; CONST["π"] = Math.PI; CONST.e = Math.E; CONST.tau = 2 * Math.PI; CONST.phi = (1 + Math.sqrt(5)) / 2;

    function comb(n, r, perm) {
      if (!(Number.isInteger(n) && Number.isInteger(r)) || n < 0 || r < 0 || r > n) return NaN;
      var v = 1;
      if (perm) { for (var i = 0; i < r; i++) v *= n - i; return v; }
      r = Math.min(r, n - r);
      for (i = 1; i <= r; i++) v = v * (n - r + i) / i;
      return Math.round(v);
    }
    function factorial(n) {
      if (Number.isInteger(n)) { if (n < 0) return NaN; if (n > 170) return Infinity; var v = 1; for (var i = 2; i <= n; i++) v *= i; return v; }
      return gamma(n + 1);
    }
    var LG = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
      12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    function gamma(z) { // Lanczos
      if (Number.isInteger(z) && z <= 0) return NaN;
      if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
      z -= 1;
      var x = LG[0], t = z + 7.5;
      for (var i = 1; i < 9; i++) x += LG[i] / (z + i);
      return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
    }

    function Err(msg, pos) { var e = new Error(msg); e.pos = pos; e.expr = true; return e; }

    function tokenize(src) {
      var s = String(src).replace(/[−–]/g, "-").replace(/[×·∙]/g, "*").replace(/÷/g, "/").replace(/\*\*/g, "^")
        .replace(/²/g, "^2").replace(/³/g, "^3");
      var out = [], i = 0, m;
      while (i < s.length) {
        var c = s[i];
        if (/\s/.test(c)) { i++; continue; }
        if ((m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(s.slice(i)))) { out.push({ t: "num", v: parseFloat(m[0]), p: i }); i += m[0].length; continue; }
        if ((m = /^[A-Za-zπθ][A-Za-z0-9πθ]*/.exec(s.slice(i)))) { out.push({ t: "id", v: m[0], p: i }); i += m[0].length; continue; }
        if ("+-*/^()!%,√".indexOf(c) >= 0) { out.push({ t: "op", v: c, p: i }); i++; continue; }
        throw Err("Unexpected character “" + c + "”", i);
      }
      return out;
    }

    // Split an unknown run like "ax" or "pix" into known names (a·x, π·x). Functions may only come last.
    function split(word, vars, beforeParen) {
      var memo = {};
      function go(i) {
        if (i === word.length) return [];
        if (i in memo) return memo[i];
        var best = null;
        for (var j = word.length; j > i; j--) {
          var part = word.slice(i, j);
          var isFn = part in FN && j === word.length && beforeParen, isVal = part in CONST || vars.has(part);
          if (!isFn && !isVal) continue;
          var rest = go(j);
          if (rest) { best = [part].concat(rest); break; }
        }
        return (memo[i] = best);
      }
      return go(0);
    }

    function parse(src, opts) {
      opts = opts || {};
      var vars = new Set(opts.vars || []), toks = tokenize(src), k = 0, used = new Set();
      // Expand identifiers into known names up front.
      var t2 = [];
      toks.forEach(function (t, idx) {
        if (t.t !== "id") return t2.push(t);
        var next = toks[idx + 1], paren = !!(next && next.t === "op" && next.v === "(");
        if ((t.v in FN && paren) || t.v in CONST || vars.has(t.v)) return t2.push(t);
        var parts = split(t.v, vars, paren);
        if (!parts) throw Err(t.v in FN ? t.v + " needs brackets, like " + t.v + "(x)" : "Unknown name “" + t.v + "”", t.p);
        parts.forEach(function (p) { t2.push({ t: "id", v: p, p: t.p }); });
      });
      toks = t2;
      function peek() { return toks[k]; }
      function isOp(v) { var t = toks[k]; return t && t.t === "op" && t.v === v; }
      function expect(v) { if (!isOp(v)) throw Err("Expected “" + v + "”", toks[k] ? toks[k].p : String(src).length); k++; }
      function startsPrimary(t) { return t && (t.t === "num" || t.t === "id" || (t.t === "op" && (t.v === "(" || t.v === "√"))); }

      function sum() {
        var n = product();
        while (isOp("+") || isOp("-")) { var op = toks[k++].v; n = { t: "bin", op: op, a: n, b: product() }; }
        return n;
      }
      function product() {
        var n = unary();
        for (;;) {
          if (isOp("*") || isOp("/")) { var op = toks[k++].v; n = { t: "bin", op: op, a: n, b: unary() }; }
          else if (startsPrimary(peek())) {
            if (peek().t === "num") throw Err("Missing operator before " + peek().v, peek().p); // "3 4" is a typo, not 12
            n = { t: "bin", op: "*", a: n, b: unary() }; // implicit: 2x, 2(3+4), (a)(b)
          }
          else return n;
        }
      }
      function unary() {
        if (isOp("-")) { k++; return { t: "neg", a: unary() }; }
        if (isOp("+")) { k++; return unary(); }
        if (isOp("√")) { k++; return { t: "call", f: "sqrt", args: [unary()] }; }
        return power();
      }
      function power() {
        var base = postfix();
        if (isOp("^")) { k++; return { t: "bin", op: "^", a: base, b: unary() }; } // right-assoc, allows 2^-1
        return base;
      }
      function postfix() {
        var n = primary();
        for (;;) {
          if (isOp("!")) { k++; n = { t: "call", f: "fact", args: [n] }; }
          else if (isOp("%") && opts.percent) { k++; n = { t: "bin", op: "/", a: n, b: { t: "num", v: 100 } }; }
          else return n;
        }
      }
      function primary() {
        var t = toks[k];
        if (!t) throw Err("Unexpected end", String(src).length);
        if (t.t === "num") { k++; return { t: "num", v: t.v }; }
        if (t.t === "op" && t.v === "(") { k++; var e = sum(); expect(")"); return e; }
        if (t.t === "id") {
          k++;
          if (t.v in FN && isOp("(")) {
            k++;
            var args = [];
            if (!isOp(")")) { args.push(sum()); while (isOp(",")) { k++; args.push(sum()); } }
            expect(")");
            var ar = FN[t.v].arity, lo = Array.isArray(ar) ? ar[0] : ar, hi = Array.isArray(ar) ? ar[1] : ar;
            if (args.length < lo || args.length > hi) throw Err(t.v + " takes " + (lo === hi ? lo : lo + "–" + hi) + " argument" + (hi === 1 ? "" : "s"), t.p);
            return { t: "call", f: t.v, args: args };
          }
          if (t.v in CONST) return { t: "num", v: CONST[t.v] };
          if (vars.has(t.v)) { used.add(t.v); return { t: "var", n: t.v }; }
          throw Err("Unknown name “" + t.v + "”", t.p);
        }
        throw Err("Unexpected “" + t.v + "”", t.p);
      }
      if (!toks.length) throw Err("Empty expression", 0);
      var ast = sum();
      if (k < toks.length) throw Err("Unexpected “" + toks[k].v + "”", toks[k].p);
      return { ast: ast, used: used };
    }

    // Closures over the AST: variables are read from a null-prototype map, never from globals.
    function compile(ast, opts) {
      var mode = (opts && opts.angle) || "rad";
      function c(n) {
        if (n.t === "num") { var v = n.v; return function () { return v; }; }
        if (n.t === "var") { var name = n.n; return function (env) { var x = env[name]; return typeof x === "number" ? x : NaN; }; }
        if (n.t === "neg") { var a = c(n.a); return function (env) { return -a(env); }; }
        if (n.t === "bin") {
          var l = c(n.a), r = c(n.b);
          switch (n.op) {
            case "+": return function (e) { return l(e) + r(e); };
            case "-": return function (e) { return l(e) - r(e); };
            case "*": return function (e) { return l(e) * r(e); };
            case "/": return function (e) { return l(e) / r(e); };
            case "^": return function (e) {
              var b = l(e), p = r(e);
              if (b < 0 && !Number.isInteger(p)) { var q = 1 / p; if (Number.isInteger(Math.round(q * 1e9) / 1e9) && Math.round(q) % 2) return -Math.pow(-b, p); } // (−8)^(1/3) = −2
              return Math.pow(b, p);
            };
          }
        }
        if (n.t === "call") {
          var fn = FN[n.f], args = n.args.map(c), m = mode;
          return function (e) { var vals = args.map(function (g) { return g(e); }); if (fn.angle) vals.push(m); return fn.f.apply(null, vals); };
        }
        throw Err("Bad expression", 0);
      }
      return c(ast);
    }

    function evaluate(src, env, opts) {
      opts = opts || {};
      var p = parse(src, { vars: Object.keys(env || {}), percent: opts.percent });
      var e = Object.create(null); for (var key in env) if (Object.prototype.hasOwnProperty.call(env, key)) e[key] = env[key];
      return compile(p.ast, opts)(e);
    }
    return { parse: parse, compile: compile, evaluate: evaluate, FN: FN, CONST: CONST, gamma: gamma, factorial: factorial };
  })();

  var saved = S3.store(KEY) || {};
  var state = {
    angle: ["deg", "rad", "grad"].indexOf(saved.angle) >= 0 ? saved.angle : "deg",
    fmt: saved.fmt === "sci" ? "sci" : "norm", ans: typeof saved.ans === "number" ? saved.ans : 0,
    mem: typeof saved.mem === "number" ? saved.mem : 0, hist: Array.isArray(saved.hist) ? saved.hist.slice(0, 50) : [], second: false, last: null
  };
  var input = $("#expr"), out = $("#result");

  function calc(src) { return Expr.evaluate(src, { ans: state.ans }, { angle: state.angle, percent: true }); }

  // ---------- number formatting ----------
  var SUP = { "-": "⁻", "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹" };
  function plain(v) { // exact-ish text you can paste back in
    if (!isFinite(v)) return String(v);
    var r = +v.toPrecision(12);
    return String(r);
  }
  function show(v, fmt) {
    if (isNaN(v)) return "Undefined";
    if (!isFinite(v)) return v > 0 ? "∞" : "−∞";
    var r = +v.toPrecision(12), a = Math.abs(r);
    if (fmt === "sci" || (a !== 0 && (a >= 1e15 || a < 1e-9))) {
      var p = r.toExponential(fmt === "sci" ? 9 : 11).split("e"), m = p[0].replace(/\.?0+$/, ""), ex = +p[1];
      return m.replace("-", "−") + " × 10" + String(ex).split("").map(function (c) { return SUP[c]; }).join("");
    }
    var s = String(r), neg = s[0] === "-", parts = (neg ? s.slice(1) : s).split(".");
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return (neg ? "−" : "") + parts.join(".");
  }

  // ---------- editing ----------
  function insert(text) {
    var s = input.selectionStart == null ? input.value.length : input.selectionStart, e = input.selectionEnd == null ? s : input.selectionEnd;
    // After "=", typing an operator continues from the answer; typing a number starts fresh.
    if (state.last !== null && input.value === state.last.expr) {
      if (/^[+\-−×÷*/^!%]/.test(text) || text === "^2" || text === "^3" || text === "^(-1)") { input.value = "ans"; s = e = 3; }
      else { input.value = ""; s = e = 0; }
      state.last = null;
    }
    input.value = input.value.slice(0, s) + text + input.value.slice(e);
    var pos = s + text.length;
    input.setSelectionRange(pos, pos);
    preview();
  }
  function negate() {
    var s = input.selectionStart, before = input.value.slice(0, s), after = input.value.slice(s), m;
    if ((m = /\(-(\d+\.?\d*(?:e[+-]?\d+)?)\)$/.exec(before))) before = before.slice(0, m.index) + m[1];
    else if ((m = /(\d+\.?\d*(?:e[+-]?\d+)?|ans|π|e)$/.exec(before))) before = before.slice(0, m.index) + "(-" + m[1] + ")";
    else before += "-";
    input.value = before + after; input.setSelectionRange(before.length, before.length); preview();
  }
  function preview() {
    var v = input.value.trim();
    out.classList.remove("is-err", "is-final");
    if (!v) { out.textContent = show(state.ans === 0 ? 0 : state.ans, state.fmt); out.classList.add("is-dim"); return; }
    out.classList.add("is-dim");
    try { var r = calc(v); out.textContent = "= " + show(r, state.fmt); }
    catch (e) { out.textContent = ""; }
  }
  function equals() {
    var v = input.value.trim();
    if (!v) return;
    try {
      var r = calc(v);
      out.classList.remove("is-dim", "is-err"); out.classList.add("is-final");
      out.textContent = show(r, state.fmt);
      if (isFinite(r)) state.ans = +r.toPrecision(15);
      state.hist.unshift({ e: v, r: r });
      state.hist = state.hist.slice(0, 50);
      state.last = { expr: v, r: r };
      save(); renderHist(); S3.done();
    } catch (e) {
      out.classList.remove("is-dim", "is-final"); out.classList.add("is-err");
      out.textContent = e.expr ? e.message : "Error";
      if (e.expr && typeof e.pos === "number") { var p = Math.min(e.pos, input.value.length); input.focus(); input.setSelectionRange(p, Math.min(p + 1, input.value.length)); }
    }
  }
  function current() { // value for memory keys: the expression if it computes, else ANS
    var v = input.value.trim();
    if (!v) return state.ans;
    try { var r = calc(v); return isFinite(r) ? r : null; } catch (e) { return null; }
  }

  function renderHist() {
    var ol = $("#hist"); ol.textContent = "";
    if (!state.hist.length) { ol.appendChild(S3.h("li", { "class": "empty" }, [S3.h("b", { text: "No calculations yet" }), "Press = and your results collect here."])); return; }
    state.hist.forEach(function (h) {
      ol.appendChild(S3.h("li", {}, [
        S3.h("button", { type: "button", "class": "sc-he mono", dir: "ltr", title: "Edit this expression", text: h.e, onclick: function () { input.value = h.e; state.last = null; input.focus(); preview(); } }),
        S3.h("button", { type: "button", "class": "sc-hr mono", title: "Insert this result", text: "= " + show(h.r, state.fmt), onclick: function () { if (isFinite(h.r)) insert(plain(h.r)); input.focus(); } })
      ]));
    });
  }
  function renderFlags() {
    $$("#angle button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.v === state.angle)); });
    $("#fmt").textContent = state.fmt === "sci" ? "SCI" : "NORM";
    $("#mflag").hidden = !state.mem;
    $("#mflag").title = "Memory: " + plain(state.mem);
    $$("#sci [data-k2]").forEach(function (b) {
      if (!b.dataset.l1) b.dataset.l1 = b.textContent;
      b.textContent = state.second ? b.dataset.l2 : b.dataset.l1;
    });
    $(".k-2nd").setAttribute("aria-pressed", String(state.second));
  }
  function save() { S3.store(KEY, { angle: state.angle, fmt: state.fmt, ans: state.ans, mem: state.mem, hist: state.hist }); }

  // ---------- keys ----------
  function press(b) {
    var act = b.dataset.act;
    if (act === "2nd") { state.second = !state.second; renderFlags(); return; }
    if (act === "ac") { input.value = ""; state.last = null; preview(); return; }
    if (act === "del") {
      var s = input.selectionStart, e = input.selectionEnd;
      if (s !== e) input.value = input.value.slice(0, s) + input.value.slice(e);
      else if (s > 0) {
        var m = /(asinh|acosh|atanh|asin|acos|atan|sinh|cosh|tanh|sin|cos|tan|cbrt|sqrt|root|log|ln|abs|nCr|nPr|mod|ans)\($|ans$/.exec(input.value.slice(0, s));
        var n = m ? m[0].length : 1;
        input.value = input.value.slice(0, s - n) + input.value.slice(s); s -= n;
      }
      input.setSelectionRange(s, s); state.last = null; preview(); return;
    }
    if (act === "eq") return equals();
    if (act === "neg") return negate();
    if (act === "mc") { state.mem = 0; save(); renderFlags(); return S3.toast("Memory cleared"); }
    if (act === "mr") return insert(plain(state.mem));
    if (act === "mplus" || act === "mminus") {
      var v = current();
      if (v === null) return S3.toast("Fix the expression first", "error");
      state.mem = +(state.mem + (act === "mplus" ? v : -v)).toPrecision(15); save(); renderFlags();
      return S3.toast("Memory = " + show(state.mem, state.fmt));
    }
    var k = state.second && b.dataset.k2 ? b.dataset.k2 : b.dataset.k;
    if (k) insert(k);
    if (state.second && b.dataset.k2) { state.second = false; renderFlags(); }
  }
  $$(".sc-calc .k").forEach(function (b) {
    b.addEventListener("pointerdown", function (e) { e.preventDefault(); }); // keep the caret in the input
    b.addEventListener("click", function () { press(b); if (window.matchMedia("(pointer: fine)").matches) input.focus(); });
  });
  input.addEventListener("input", function () { state.last = null; preview(); });
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" || (e.key === "=" && !e.ctrlKey)) { e.preventDefault(); equals(); }
    else if (e.key === "Escape") { e.preventDefault(); input.value = ""; state.last = null; preview(); }
    else if (state.last !== null && e.key.length === 1 && !e.ctrlKey && !e.metaKey && input.selectionStart === input.value.length) { e.preventDefault(); insert(e.key === "*" ? "×" : e.key === "/" ? "÷" : e.key); }
  });
  document.addEventListener("keydown", function (e) { // typing anywhere goes to the calculator
    if (e.target === input || e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(e.target.tagName)) return;
    if (e.key.length === 1 && /[0-9+\-*/^().!%a-z,]/i.test(e.key)) { input.focus(); }
    else if (e.key === "Enter") { e.preventDefault(); equals(); }
  });
  $$("#angle button").forEach(function (b) { b.addEventListener("click", function () { state.angle = b.dataset.v; save(); renderFlags(); preview(); }); });
  $("#fmt").addEventListener("click", function () { state.fmt = state.fmt === "sci" ? "norm" : "sci"; save(); renderFlags(); preview(); renderHist(); });
  $("#consts").addEventListener("change", function (e) { var v = e.target.value; e.target.value = ""; if (v) insert(/^\d/.test(v) ? "(" + v + ")" : v); input.focus(); });
  $("#copy").addEventListener("click", function () {
    var r = state.last ? state.last.r : state.hist.length ? state.hist[0].r : null;
    if (r === null || !isFinite(r)) return S3.toast("Press = first", "error");
    S3.copy(plain(r)); S3.done();
  });
  $("#clearHist").addEventListener("click", function () { state.hist = []; save(); renderHist(); });

  renderFlags(); renderHist(); preview();

  window.S3_DEMO = function () {
    state.angle = "deg"; state.hist = [];
    ["sin(30) + cos(60)", "2^3^2", "nCr(10, 3)", "5! / (2! × 3!)", "√(2)", "ln(e^3)"].forEach(function (x) { input.value = x; equals(); });
    input.value = "6.02214076e23 × 2"; equals(); input.value = "(-8)^(1/3) + 10% "; preview();
  };

  // ---------- self-test ----------
  window.S3_SELFTEST = function () {
    var f = [], keep = { angle: state.angle, ans: state.ans };
    function ok(n, c) { if (!c) f.push(n); }
    function near(a, b) { return Math.abs(a - b) < 1e-9 * Math.max(1, Math.abs(b)); }
    function ev(s, ang) { state.angle = ang || "rad"; return calc(s); }
    function rejects(s) { try { calc(s); return false; } catch (e) { return e.expr === true; } }
    ok("2^3^2 = 512", ev("2^3^2") === 512);
    ok("-2^2 = -4", ev("-2^2") === -4 && ev("(-2)^2") === 4);
    ok("2(3+4) = 14", ev("2(3+4)") === 14);
    ok("sin(90) deg = 1", ev("sin(90)", "deg") === 1);
    ok("sin(pi/2) rad = 1", ev("sin(π/2)", "rad") === 1);
    ok("sin(100) grad = 1", ev("sin(100)", "grad") === 1);
    ok("cos(90) deg = 0", ev("cos(90)", "deg") === 0 && ev("sin(180)", "deg") === 0);
    ok("tan(90) deg undefined", isNaN(ev("tan(90)", "deg")));
    ok("asin(1) deg = 90", near(ev("asin(1)", "deg"), 90) && near(ev("atan(1)", "grad"), 50));
    ok("1+2×3", ev("1+2×3") === 7 && ev("(1+2)×3") === 9 && ev("12÷4÷3") === 1 && ev("2−3−4") === -5);
    ok("factorial", ev("5!") === 120 && ev("0!") === 1 && ev("3!^2") === 36 && near(ev("0.5!"), Math.sqrt(Math.PI) / 2));
    ok("nCr nPr", ev("nCr(10,3)") === 120 && ev("nPr(5,2)") === 20 && ev("nCr(52,5)") === 2598960);
    ok("percent", ev("50%") === 0.5 && ev("200×15%") === 30);
    ok("logs", ev("log(1000)") === 3 && near(ev("ln(e^2)"), 2) && ev("log(8,2)") === 3);
    ok("roots", ev("√16") === 4 && ev("root(27,3)") === 3 && ev("cbrt(-27)") === -3 && near(ev("(-8)^(1/3)"), -2));
    ok("sci notation", ev("1.5e3") === 1500 && ev("2e-3") === 0.002);
    state.ans = 42; ok("ans", ev("ans/2") === 21);
    ok("display 0.1+0.2", show(ev("0.1+0.2"), "norm") === "0.3");
    ok("display big", show(1e20, "norm") === "1 × 10²⁰" && show(-1.5e-12, "norm") === "−1.5 × 10⁻¹²" && show(1234567, "norm") === "1,234,567");
    ok("display sci", show(1234, "sci") === "1.234 × 10³");
    ok("display undefined", show(NaN) === "Undefined" && show(1 / 0) === "∞");
    ["alert(1)", "constructor", "__proto__", "window", "document.cookie", "this", "x", "Math.PI", "ev" + "al(1)", "2 3", "sin 30"].forEach(function (s) { ok("rejects " + s, rejects(s)); });
    state.angle = keep.angle; state.ans = keep.ans;
    return f.length ? f : true;
  };
})();
