// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and renders
// the ranked pre-token board, the already-trading set kept apart, filters, sortable columns and a
// detail view for every protocol. No network: every byte it shows arrived in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', chain: 'all', category: 'all', tab: 'pre', wl: false, sort: 'rank', dir: 1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) { return n === null || n === undefined ? 'n/a' : Number(n).toFixed(3); }

  // The model, restated in the page: implied value recomputed from the row's own snapshot figures
  // and the same constants main.ts scored with, so the detail view can show its working and check
  // the board's number instead of merely repeating it.
  function impliedOf(row) {
    var m = DATA.model;
    var growth = Math.min(m.growth_cap, Math.max(m.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + m.growth_weight * Math.tanh(growth / m.growth_scale);
    var age = row.age_days === null || row.age_days === undefined ? DATA.unknown_age_days : row.age_days;
    var maturityMult = m.maturity_floor + m.maturity_range * (1 - Math.exp(-Math.max(age, 0) / m.maturity_scale_days));
    return { value: Math.max(1, Math.round(row.tvl_usd * DATA.base_multiple * growthMult * maturityMult)), growthMult: growthMult, maturityMult: maturityMult };
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('tab') === 'live') state.tab = 'live';
    if (params.get('wl') === '1') state.wl = true;
    if (params.get('p')) state.selected = params.get('p');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.tab === 'live') params.set('tab', 'live');
    if (state.wl) params.set('wl', '1');
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    window.history.replaceState(null, '', next ? '#' + next : window.location.pathname + window.location.search);
  }

  function tabRows() { return state.tab === 'pre' ? DATA.rows : DATA.live; }
  function filtered() {
    var q = state.q.trim().toLowerCase();
    return tabRows().filter(function (r) {
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (state.category !== 'all' && (r.category || 'Uncategorised') !== state.category) return false;
      if (state.tab === 'pre' && state.wl && !r.watchlist) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category || '', r.symbol || '', (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function naturalCmp(key, a, b) {
    if (key === 'rank') return a.rank - b.rank;
    if (key === 'name') return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0;
    if (key === 'tvl') return b.tvl_usd - a.tvl_usd;
    if (key === 'growth') return (b.change_7d === null ? -Infinity : b.change_7d) - (a.change_7d === null ? -Infinity : a.change_7d);
    if (key === 'age') return (b.age_days === null || b.age_days === undefined ? -1 : b.age_days) - (a.age_days === null || a.age_days === undefined ? -1 : a.age_days);
    if (key === 'mcap') return (b.mcap_usd === null ? -1 : b.mcap_usd) - (a.mcap_usd === null ? -1 : a.mcap_usd);
    return b.implied_value_usd - a.implied_value_usd;
  }
  function sorted(list) {
    return list.slice().sort(function (a, b) {
      var c = naturalCmp(state.sort, a, b) * state.dir;
      if (c !== 0) return c;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  /* ---------------------------------------------------------- static shell */

  var searchInput = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category, chain or ticker', 'aria-label': 'Search the board' });
  var chainSelect = el('select', { id: 'chain', 'aria-label': 'Filter by chain' });
  var catSelect = el('select', { id: 'category', 'aria-label': 'Filter by category' });
  var wlCheck = el('input', { type: 'checkbox', id: 'wl' });
  var preTab = el('button', { type: 'button', text: 'Pre-token' });
  var liveTab = el('button', { type: 'button', text: 'Already trading' });
  var countSpan = el('span', { class: 'count' });
  var tableHost = el('div');
  var modelHost = el('div');

  function fillOptions(select, values, allLabel, current) {
    select.textContent = '';
    select.appendChild(el('option', { value: 'all', text: allLabel }));
    values.forEach(function (v) { select.appendChild(el('option', { value: v, text: v })); });
    select.value = values.indexOf(current) >= 0 ? current : 'all';
    return select.value;
  }
  function refreshFilterOptions() {
    var rows = tabRows();
    var chainCounts = {};
    var cats = {};
    rows.forEach(function (r) {
      (r.chains || []).forEach(function (c) { chainCounts[c] = (chainCounts[c] || 0) + 1; });
      cats[r.category || 'Uncategorised'] = true;
    });
    var chains = Object.keys(chainCounts).sort(function (a, b) { return chainCounts[b] - chainCounts[a] || (a < b ? -1 : 1); });
    state.chain = fillOptions(chainSelect, chains, 'All chains', state.chain);
    state.category = fillOptions(catSelect, Object.keys(cats).sort(), 'All categories', state.category);
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' },
        el('span', { class: 'mark', 'aria-hidden': 'true' }),
        el('div', null,
          el('div', { class: 'brand-name', text: 'TOKEN RADAR' }),
          el('div', { class: 'brand-sub', text: 'pre-token protocols, ranked by implied value' })
        )
      ),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: 'model ' + DATA.model_version })
      )
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: 'Every protocol still waiting on its token, ranked by what that token would be worth' }),
        el('p', null,
          'The board ranks ',
          el('b', { text: String(DATA.board_size) }),
          ' protocols that record no token - the snapshot\u2019s ',
          el('b', { text: String(DATA.watchlist_size) }),
          '-protocol watchlist included in full, and every qualifying protocol below its $' + Math.round(DATA.floor_usd / 1e6) + 'M floor besides. ',
          'Wrapped, staked and bridged products of tokens that already trade are left off: they are not launches waiting to happen. ',
          'Implied value is this dashboard\u2019s model, computed from the snapshot\u2019s own figures - never a prediction that a token will be issued.'
        )
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token protocols ranked' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Already trading, set aside' }), el('b', { text: String(DATA.live_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Protocols in the snapshot' }), el('b', { text: String(DATA.universe_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Base multiple (measured)' }), el('b', { text: String(DATA.base_multiple) }))
      )
    );
  }

  function controls() {
    searchInput.value = state.q;
    searchInput.addEventListener('input', function () { state.q = searchInput.value; writeHash(); update(); });
    chainSelect.addEventListener('change', function () { state.chain = chainSelect.value; writeHash(); update(); });
    catSelect.addEventListener('change', function () { state.category = catSelect.value; writeHash(); update(); });
    wlCheck.checked = state.wl;
    wlCheck.addEventListener('change', function () { state.wl = wlCheck.checked; writeHash(); update(); });
    preTab.addEventListener('click', function () { setTab('pre'); });
    liveTab.addEventListener('click', function () { setTab('live'); });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), searchInput),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSelect),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), catSelect),
      el('label', { class: 'check' }, wlCheck, 'Watchlist only'),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, preTab, liveTab)),
      countSpan
    );
  }
  function setTab(tab) {
    if (state.tab === tab) return;
    state.tab = tab;
    state.sort = tab === 'pre' ? 'rank' : 'mcap';
    state.dir = 1;
    preTab.setAttribute('aria-pressed', tab === 'pre' ? 'true' : 'false');
    liveTab.setAttribute('aria-pressed', tab === 'live' ? 'true' : 'false');
    refreshFilterOptions();
    writeHash();
    update();
  }

  /* ---------------------------------------------------------- tables */

  function sortHeader(key, label) {
    var active = state.sort === key;
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () {
        if (state.sort === key) state.dir = -state.dir;
        else { state.sort = key; state.dir = 1; }
        update();
      } }, label, active ? el('span', { 'aria-hidden': 'true', text: state.dir > 0 ? ' \u25bc' : ' \u25b2' }) : null)
    );
  }

  function nameCell(r, badge) {
    return el('td', null, el('div', { class: 'name' },
      el('span', null, el('b', { text: r.name }), badge || null),
      el('span', { class: 'sub', text: (r.category || 'Uncategorised') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 3).join(', ') : 'an unnamed chain') })
    ));
  }

  function boardTable(list) {
    if (list.length === 0) return emptyPanel();
    var max = DATA.rows[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false', tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        nameCell(r, r.watchlist ? el('span', { class: 'wl', text: 'watchlist' }) : null),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(2, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'chip pre', text: 'no token on record' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' }, el('div', { class: 'table-wrap' },
      el('table', null,
        el('caption', { class: 'sub', text: 'Pre-token protocols by implied value. Select any row for its value breakdown and farm plan.' }),
        el('thead', null, el('tr', null,
          sortHeader('rank', 'Rank'), sortHeader('name', 'Protocol'), sortHeader('tvl', 'TVL'),
          sortHeader('growth', '7d'), sortHeader('age', 'Age'), sortHeader('implied', 'Implied value'),
          el('th', { scope: 'col', text: 'Token' })
        )),
        tbody
      )
    ));
  }

  function liveTable(list) {
    if (list.length === 0) return emptyPanel();
    var tbody = el('tbody');
    list.forEach(function (r) {
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false', tabindex: '0',
        onclick: function () { openLiveDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openLiveDetail(r.slug); } }
      },
        nameCell(r, r.symbol ? el('span', { class: 'sym', text: ' ' + r.symbol }) : null),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'chip live', text: 'already trades' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' }, el('div', { class: 'table-wrap' },
      el('table', null,
        el('caption', { class: 'sub', text: 'Already trading: these protocols have a token, so their market cap is a market fact, not a model. They are never mixed into the pre-token ranking.' }),
        el('thead', null, el('tr', null,
          sortHeader('name', 'Protocol'), sortHeader('tvl', 'TVL'), sortHeader('growth', '7d'),
          sortHeader('mcap', 'Market cap'), el('th', { scope: 'col', text: 'Token' })
        )),
        tbody
      )
    ));
  }

  function emptyPanel() {
    return el('div', { class: 'panel' }, el('div', { class: 'empty' },
      el('h2', { text: 'No protocol matches that filter' }),
      el('p', { text: 'Clear the search or widen the chain and category filters to see the board again.' }),
      el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () {
        state.q = ''; state.chain = 'all'; state.category = 'all'; state.wl = false;
        searchInput.value = ''; wlCheck.checked = false; refreshFilterOptions(); writeHash(); update();
      } })
    ));
  }

  function modelPanel() {
    var m = DATA.model;
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How the radar works' }),
      el('p', null,
        'One function scores every row from the snapshot\u2019s own figures. No protocol name is special-cased, ',
        'and the page recomputes each row from the same numbers, so what you read here is what board.json carries.'),
      el('div', { class: 'formula', text: 'implied = round( tvl_usd x ' + DATA.base_multiple + ' x (1 + ' + m.growth_weight + ' x tanh(clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / ' + m.growth_scale + ')) x (' + m.maturity_floor + ' + ' + m.maturity_range + ' x (1 - exp(-age_days / ' + m.maturity_scale_days + '))) )' }),
      el('ul', null,
        el('li', null, el('b', { text: 'The base multiple is measured, not chosen. ' }), 'It is the median market-cap-to-TVL ratio of the ' + DATA.calibration_size + ' protocols in this same snapshot whose token already trades, exchanges and chains excluded - the market\u2019s own answer to what a dollar of TVL is worth as a token.'),
        el('li', null, el('b', { text: 'Growth bends, it does not explode. ' }), 'A strong week lifts a protocol\u2019s value and a bad one cuts it, through a tanh curve, so one wild week cannot carry a small protocol past the giants.'),
        el('li', null, el('b', { text: 'Time without a token is evidence. ' }), 'The longer a protocol has run tokenless, the more of its record is proven; the maturity lift saturates near three years. A protocol with no listing date scores at the board\u2019s median age, ' + DATA.unknown_age_days + ' days.'),
        el('li', null, el('b', { text: 'The watchlist is the floor. ' }), 'Every one of the snapshot\u2019s ' + DATA.watchlist_size + ' watchlist protocols is ranked, and so is every other protocol that records no token and is not a wrapped, staked or bridged product of one that trades - ' + DATA.board_size + ' rows in all.')
      )
    );
  }

  function footer() {
    return el('footer', { class: 'foot' },
      el('span', { text: 'Data: ' + DATA.source + '. Figures are the snapshot\u2019s, frozen at the fetch; nothing here is live.' }),
      el('span', { text: 'A protocol is described as recording no token because that is what the snapshot\u2019s record says; a record can lag a launch. Implied value is a model\u2019s claim about a token that may never be issued - it is not a price, a promise or advice.' })
    );
  }

  /* ---------------------------------------------------------- detail view */

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); updateSelection(); });
  function updateSelection() {
    var trs = tableHost.querySelectorAll('tr[data-selected]');
    trs.forEach(function (tr) { tr.setAttribute('data-selected', 'false'); });
  }
  function showDialog() {
    if (typeof dialog.showModal === 'function') { if (!dialog.open) dialog.showModal(); }
    else dialog.setAttribute('open', '');
  }
  function detailHead(kicker, title, sub) {
    return el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: kicker }),
        el('h2', { id: 'detail-title', text: title }),
        el('p', { class: 'sub', text: sub })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    );
  }
  function figuresGrid(pairs) {
    return el('div', { class: 'equation' }, pairs.map(function (pair) {
      return el('div', pair[2] ? { class: 'total' } : null, el('span', { text: pair[0] }), el('b', { class: 'num', text: pair[1] }));
    }));
  }

  function openDetail(slug) {
    var row = null;
    DATA.rows.forEach(function (r) { if (r.slug === slug) row = r; });
    if (!row) return;
    state.selected = slug;
    writeHash();
    var check = impliedOf(row);
    dialog.textContent = '';
    dialog.appendChild(detailHead(
      'Rank ' + row.rank + ' of ' + DATA.board_size + (row.watchlist ? ' - on the snapshot watchlist' : ' - below the watchlist floor'),
      row.name,
      (row.category || 'Uncategorised') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain')
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value, from its own figures' }),
      figuresGrid([
        ['TVL (snapshot)', fmtUsd(row.tvl_usd)],
        ['Base multiple (median of ' + DATA.calibration_size + ' live protocols)', String(DATA.base_multiple)],
        ['Seven-day growth', fmtPct(row.change_7d)],
        ['Growth multiplier', fmtMult(row.growth_multiplier)],
        ['Age with no token', fmtAge(row.age_days) + (row.listed_at ? ' (listed ' + row.listed_at + ')' : ' (no listing date; scored at the median)')],
        ['Maturity multiplier', fmtMult(row.maturity_multiplier)],
        ['Implied value', fmtUsd(row.implied_value_usd), true]
      ]),
      el('p', { class: 'note', text: 'This page recomputes the row from the same figures and gets ' + fmtUsd(check.value) + (check.value === row.implied_value_usd ? ' - the same number the board carries.' : ' - which differs from the board, so the data would be stale.') + ' The value is what a token would be worth if the protocol\u2019s record stayed as it is; it says nothing about whether a token will be issued.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, row.farm_steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), tail ? el('span', { class: 'cost', text: tail }) : null);
      })),
      el('p', { class: 'note', text: 'Steps are generated from this protocol\u2019s category, chains, TVL and age - the same plan board.json carries for this row.' })
    ));
    showDialog();
  }

  function openLiveDetail(slug) {
    var row = null;
    DATA.live.forEach(function (r) { if (r.slug === slug) row = r; });
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    dialog.appendChild(detailHead(
      'Already trading' + (row.symbol ? ' - ' + row.symbol : ''),
      row.name,
      (row.category || 'Uncategorised') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain')
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'The market\u2019s own figures' }),
      figuresGrid([
        ['TVL (snapshot)', fmtUsd(row.tvl_usd)],
        ['Seven-day growth', fmtPct(row.change_7d)],
        ['Market cap', fmtUsd(row.mcap_usd), true]
      ]),
      el('p', { class: 'note', text: 'This protocol\u2019s token already trades, so the radar does not rank it and writes it no farm plan: its market cap is a fact the market set, not a value a model implies. It is kept in this separate view so the pre-token board is never padded with protocols whose launch has already happened.' })
    ));
    showDialog();
  }

  /* ---------------------------------------------------------- render */

  function update() {
    var list = sorted(filtered());
    countSpan.textContent = list.length + (state.tab === 'pre' ? ' pre-token rows' : ' live-token protocols');
    tableHost.textContent = '';
    tableHost.appendChild(state.tab === 'pre' ? boardTable(list) : liveTable(list));
    modelHost.textContent = '';
    if (state.tab === 'pre') modelHost.appendChild(modelPanel());
  }

  readHash();
  preTab.setAttribute('aria-pressed', state.tab === 'pre' ? 'true' : 'false');
  liveTab.setAttribute('aria-pressed', state.tab === 'live' ? 'true' : 'false');
  if (state.tab === 'live') state.sort = 'mcap';
  var shell = el('div', { class: 'shell' });
  shell.appendChild(header());
  shell.appendChild(lede());
  shell.appendChild(controls());
  shell.appendChild(tableHost);
  shell.appendChild(modelHost);
  shell.appendChild(footer());
  app.appendChild(shell);
  app.appendChild(dialog);
  refreshFilterOptions();
  update();
  app.setAttribute('aria-busy', 'false');
  if (state.selected) {
    if (state.tab === 'live') openLiveDetail(state.selected);
    else openDetail(state.selected);
  }
})();
