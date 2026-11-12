import {
  BANDS, DIESEL_PRICE, DRILL_FEE, GOLD_PRICE_PER_GRAM, HOPPER, LAYERS, LAYER_KEYS, LAYER_LOADS, MAP_SIZES, PRICE, SEASON_DAYS, SELL_BACK,
  STORE, TANKS, TICKS_PER_DAY, VEHICLES, bandOf,
} from '../data/balance';
import { layerGrade, organicGrade } from '../sim/mapgen';
import { isContainer, isProcessor, isTank, isVehicle, isWash, itemById, onGround, tileAt, tileLevel } from '../sim/state';
import { dailyBurn, nextClaimCost } from '../sim/systems/economy';
import { canDigLayer, linkedSluice, wet } from '../sim/systems/machines';
import { ITEM_NAME } from './actions';
import { Session } from './session';
import { BAND_CSS } from './bands';
import { DAWN_OFFSET } from './View3D';

const $ = (n: number) => '$' + Math.round(n).toLocaleString('en-US');
const el = (id: string) => document.getElementById(id)!;
const LAYER_CSS = ['#5d9441', '#8a6a44', '#6b4a2b', '#4f6d8a', '#8b8f96'];
const ICON: Record<string, string> = { bucket: 'bucket_empty', barrow: 'barrow_empty', atv: 'atv_empty', worker: 'miner_0' };
const iconOf = (id: string) => ICON[id] ?? id;
const TIER_NAMES = ['', 'hand tools', 'first machines', 'the brown layer', 'the blue layer', 'bedrock'];

export class Hud {
  last = 0; lastMini = 0;
  modal: '' | 'store' | 'help' = '';

  constructor(private ses: Session) {
    el('hud').innerHTML = `
      <div id="top" class="panel">
        <div class="brand">YUKON'S GOLD</div>
        <div class="stat" id="s-cash"><label>Cash</label><b id="cash">$1,000</b><small id="runway"></small></div>
        <div class="stat"><label>Burn</label><b id="burn" class="neg"></b><small id="burnsub">living + wages + upkeep</small></div>
        <div class="stat"><label>Gold recovered</label><b id="gold" class="goldc"></b><small id="goldsub"></small></div>
        <div class="dial" title="Time of day"><div id="dialarm"><i class="sun"></i><i class="moon"></i></div></div>
        <div class="stat wide"><label id="daylabel">Day 1</label><div class="track"><i id="daybar"></i></div><small id="daysub"></small></div>
        <div class="speed" id="speed">
          <button data-s="0" title="Pause (Space)">❚❚</button><button data-s="1" title="1">1x</button><button data-s="2" title="2">2x</button><button data-s="4" title="3">4x</button><button id="mute" title="Sound on or off">♪</button>
        </div>
      </div>
      <div id="goals" class="panel"></div>
      <div id="sel" class="panel"></div>
      <div id="right">
        <div id="mini" class="panel"><div class="mm"><canvas id="mm" width="128" height="128"></canvas></div><div class="legend" id="legend"></div></div>
        <div id="tile" class="panel"></div>
      </div>
      <div id="bar">
        <button id="b-pan"><kbd>T</kbd><span>Test pan</span></button>
        <button id="b-drill" style="display:none"><kbd>R</kbd><span>Core drill</span></button>
        <button id="b-claim"><kbd>C</kbd><span id="claimlabel">Stake claim</span></button>
        <button id="b-store"><kbd>B</kbd><span>Supply store</span></button>
        <button id="b-drop"><kbd>G</kbd><span>Drop</span></button>
        <button id="b-help"><kbd>H</kbd><span>Help</span></button>
      </div>
      <div id="mode"></div>
      <div id="toasts"></div>
      <div id="warn"></div>
      <div id="modal" class="hidden"></div>
      <div id="screen"></div>`;
    el('legend').innerHTML = BANDS.map((b, i) => `<span><i style="background:${BAND_CSS[i]}"></i>${b.name}</span>`).join('');
    ses.onToast = t => this.toast(t);
    el('speed').addEventListener('click', e => {
      if ((e.target as HTMLElement).id === 'mute') { ses.sfx.start(); ses.sfx.setMuted(!ses.sfx.muted); return; }
      const s = (e.target as HTMLElement).dataset.s; if (s === undefined) return;
      if (s === '0') ses.paused = !ses.paused; else { ses.speed = Number(s); ses.paused = false; }
    });
    el('b-pan').onclick = () => { ses.mode = ses.mode === 'testpan' ? '' : 'testpan'; ses.pending = null; };
    el('b-claim').onclick = () => { ses.mode = ses.mode === 'claim' ? '' : 'claim'; ses.pending = null; };
    el('b-drill').onclick = () => { ses.mode = ses.mode === 'drill' ? '' : 'drill'; ses.pending = null; };
    el('b-store').onclick = () => this.open('store');
    el('b-help').onclick = () => this.open('help');
    el('b-drop').onclick = () => ses.selUnits.forEach(id => ses.send({ c: 'drop', p: ses.me, unit: id }));
    document.addEventListener('hud-store', () => this.open(this.modal === 'store' ? '' : 'store'));
    document.addEventListener('hud-help', () => this.open(this.modal === 'help' ? '' : 'help'));
    document.addEventListener('hud-close', () => this.open(''));
    document.addEventListener('hud-cash', () => { const c = el('cash'); c.classList.remove('pop'); void c.offsetWidth; c.classList.add('pop'); });
    el('modal').addEventListener('click', e => {
      const t = e.target as HTMLElement;
      if (t.id === 'modal' || t.dataset.close !== undefined) return this.open('');
      const buy = t.closest<HTMLElement>('[data-buy]')?.dataset.buy;
      if (!buy) return;
      if (ses.player.cash < (STORE.find(e => e.id === buy)?.price ?? 0)) return this.toast('Not enough cash');
      if (buy === 'worker' || buy === 'drill') { ses.send({ c: 'buy', p: ses.me, what: buy }); if (ses.paused) this.toast('Done: takes effect when you unpause'); if (buy === 'drill') this.open(''); }
      else { ses.mode = 'place'; ses.pending = buy; this.open(''); } // pick where it is delivered
    });
    el('sel').addEventListener('click', e => {
      const a = (e.target as HTMLElement).closest<HTMLElement>('[data-a]'); if (!a) return;
      const act = a.dataset.a!, id = Number(a.dataset.id);
      if (act === 'sell') { ses.send({ c: 'sell', p: ses.me, item: id }); ses.selItem = -1; }
      else if (act === 'fire') ses.send({ c: 'fire', p: ses.me, unit: id });
      else if (act === 'clear') ses.send({ c: 'job', p: ses.me, units: [id], job: null });
      else if (act === 'drop') ses.send({ c: 'drop', p: ses.me, unit: id });
      else if (act === 'pan') ses.mode = 'testpan';
      else if (act === 'move') { ses.mode = 'move'; ses.pending = id; }
      else if (act === 'fuel') ses.send({ c: 'fuel', p: ses.me, item: id });
      else if (act === 'dismount') ses.send({ c: 'dismount', p: ses.me, unit: id });
    });
    document.addEventListener('click', e => { if ((e.target as HTMLElement).closest('button')) ses.sfx.play('click'); }, true);
    document.addEventListener('visibilitychange', () => { if (document.hidden) ses.save(); });
    el('goals').addEventListener('click', e => {
      if (!(e.target as HTMLElement).closest('[data-min]')) return;
      this.goalsMin = !this.goalsMin; try { localStorage.setItem('yukons-gold-tutorial-min', this.goalsMin ? '1' : '0'); } catch { /* fine */ }
      this.renderGoals();
    });
    // Saves and settings from builds before the rename are no longer readable: clear them out.
    try { for (const k of ['gold-digger-save-v2', 'gold-digger-muted', 'gold-digger-save']) localStorage.removeItem(k); } catch { /* fine */ }
    this.startScreen();
    this.phoneNotice();
    const loop = (t: number) => { this.update(t); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  icon(key: string) { return this.ses.icons[key] ?? ''; }

  toast(text: string) {
    const box = el('toasts');
    if ([...box.children].some(c => c.textContent === text)) return;
    const d = document.createElement('div'); d.className = 'toast'; d.textContent = text; box.appendChild(d);
    setTimeout(() => d.classList.add('out'), 2600); setTimeout(() => d.remove(), 3100);
  }

  open(m: '' | 'store' | 'help') {
    this.modal = m;
    const box = el('modal'); box.classList.toggle('hidden', !m);
    if (m === 'store') this.renderStore();
    if (m === 'help') box.innerHTML = `<div class="sheet panel"><h2>How to play</h2>
      <div class="cols"><div>
      <h3>The loop</h3><ol>
      <li><b>Test pan</b> (T) to read the ground. Flags show the reading; it can be off by one band.</li>
      <li><b>Stake a claim</b> (C). It is 8 x 8 tiles, centered wherever you point. The first is free. You can only dig on your claims.</li>
      <li>Pick up the <b>bucket</b>, right-click your claim to <b>dig</b>.</li>
      <li>Right-click the <b>sieve</b> to screen the dirt.</li>
      <li>Right-click the <b>pan</b> at the creek to wash out the gold.</li>
      <li>Spend gold at the <b>store</b> (B): hired hands, wheelbarrow, sluice box.</li></ol>
      <p>Cash drains every day. At $0 the season is over. Survive ${SEASON_DAYS} days with as much cash as you can.</p></div><div>
      <h3>Controls</h3><table>
      <tr><td>Left-click / drag</td><td>Select a miner or gear / box-select a crew</td></tr>
      <tr><td>Right-click</td><td>Walk, pick up, dig, use a station</td></tr>
      <tr><td>M</td><td>Move the selected bucket, sieve, pan or sluice: click where it should go</td></tr>
      <tr><td>Q / E</td><td>Rotate the camera</td></tr>
      <tr><td>G</td><td>Drop what you carry</td></tr>
      <tr><td>F</td><td>Find and select your miner</td></tr>
      <tr><td>WASD / arrows</td><td>Move the camera (two-finger scroll and middle-drag also work)</td></tr>
      <tr><td>Scroll wheel, pinch, + / -</td><td>Zoom</td></tr>
      <tr><td>Space, 1, 2, 3</td><td>Pause, 1x, 2x, 4x speed</td></tr></table>
      <h3>Going deeper</h3><p>The ground has five layers. Each needs bigger gear: a mini excavator for topsoil; a dozer to rip the brown layer and a mid excavator to dig it; a large excavator for the blue layer; a mining excavator, crusher and mill for bedrock, the richest of all. A tile can only go one layer deeper than the tiles around it, so deep pits need to be wide. Buy the drill rig and press <kbd>R</kbd> to read every layer of a tile before you commit.</p><h3>Machines</h3><p>Buying a sluice box unlocks them. Set a <b>trommel</b> on a tile touching a sluice and a <b>diesel tank</b> within 8 tiles. Right-click a hired hand onto the <b>excavator</b>, then right-click your claim. It digs, dumps into the trommel, and the trommel feeds the sluice. Topsoil can only be dug once the organic layer is off the four tiles around it.</p><h3>Hired hands</h3><p>Select a hand and right-click your claim. They <b>mine on their own</b>: dig, screen, wash, repeat. Add more hands the same way.</p><p>Optional: right-click a hand onto the sieve or pan to <b>staff it full time</b>. Everyone else, you included, then just drops buckets there and walks off.</p>
      </div></div><button class="primary" data-close>Got it</button></div>`;
  }

  renderStore() {
    const pl = this.ses.player, cash = pl.cash;
    const card = (e: typeof STORE[number]) => { const locked = e.tier > pl.tier, owned = e.id === 'drill' && pl.drill; return `<button class="card ${cash < e.price ? 'poor' : ''} ${locked || owned ? 'lockedc' : ''}" ${locked || owned ? 'disabled' : `data-buy="${e.id}"`}>
        <img src="${this.icon(iconOf(e.id))}" alt=""><b>${e.name}</b><span>${e.blurb}</span>
        <em>${owned ? 'Owned' : $(e.price)}${e.upkeep && !owned ? ` <small>+ ${$(e.upkeep)}/day</small>` : ''}</em></button>`; };
    const key = ['', 'a sluice box', 'a mini excavator', 'a mid excavator', 'a large excavator'];
    el('modal').innerHTML = `<div class="sheet panel wide"><h2>Supply store</h2><p class="sub">Pick gear, then click the spot where you want it delivered. Gear sells back at ${SELL_BACK * 100}%. Diesel is ${$(DIESEL_PRICE)} a gallon.</p>
      ${[1, 2, 3, 4, 5].map(t => `<h3>Tier ${t}: ${TIER_NAMES[t]} ${t > pl.tier ? `<small class="lk">locked: buy ${key[t - 1]} first</small>` : ''}</h3><div class="cards">${STORE.filter(e => e.tier === t).map(card).join('')}</div>`).join('')}
      <button class="primary" data-close>Close</button></div>`;
  }

  startScreen() {
    const save = Session.peekSave(), day = save ? Math.floor(save.core.tick / TICKS_PER_DAY) + 1 : 0;
    el('screen').innerHTML = `<div class="cover"><div class="title panel">
      <h1>YUKON'S GOLD</h1><div class="wt">a gold mining strategy game</div>
      <p>One shovel, one bucket, $1,000, and a bill of $50 a day.<br>Find rich ground, stake it, and dig your way from a gold pan to a bedrock mine in ${SEASON_DAYS} days.</p>
      <ol><li><kbd>T</kbd> Test pan the ground to find color</li><li><kbd>C</kbd> Stake your free claim on the best of it</li><li>Right-click to dig, sieve and pan your way to gold</li></ol>
      ${save ? `<button class="primary big" id="resume">Continue: day ${day}, ${$(save.core.players[0].cash)}</button><br>` : ''}
      <button class="${save ? 'ghost' : 'primary big'}" id="start">${save ? 'Start a new season' : 'Start the season'}</button>
      <div class="seed">Map <select id="size">${MAP_SIZES.map(m => `<option value="${m.size}" ${m.size === this.ses.size ? 'selected' : ''}>${m.name} (${m.size} x ${m.size})</option>`).join('')}</select>
        &nbsp; Seed <input id="seed" value="${this.ses.seed}" inputmode="numeric" size="7"></div></div></div>`;
    el('start').onclick = () => {
      const seed = Number((el('seed') as HTMLInputElement).value) || this.ses.seed, size = Number((el('size') as HTMLSelectElement).value) || this.ses.size;
      el('screen').innerHTML = ''; this.ses.sfx.start(); window.focus();
      if (seed !== this.ses.seed || size !== this.ses.size || this.ses.state.tick > 0) this.ses.restart(seed, size); else { this.ses.started = true; this.ses.paused = false; }
    };
    if (save) el('resume').onclick = () => { el('screen').innerHTML = ''; this.ses.sfx.start(); this.ses.resume(); };
  }

  /** The game needs a mouse and keyboard. Say so to anyone arriving on a phone or tablet. */
  phoneNotice() {
    const touchOnly = window.matchMedia?.('(pointer: coarse)').matches && !window.matchMedia('(any-pointer: fine)').matches;
    if (!touchOnly && Math.min(window.innerWidth, window.innerHeight) >= 520) return;
    const d = document.createElement('div'); d.id = 'phone';
    d.innerHTML = `<div class="panel"><h2>Best on desktop</h2><p>Yukon's Gold is played with a mouse and keyboard. Open it on a laptop or desktop for the full game.</p><button class="ghost" id="phone-go">Look around anyway</button></div>`;
    document.body.appendChild(d);
    document.getElementById('phone-go')!.onclick = () => d.remove();
  }

  endScreen() {
    const s = this.ses.state, p = this.ses.player, broke = s.over === 'broke';
    const day = Math.min(SEASON_DAYS, Math.floor(s.tick / TICKS_PER_DAY) + 1);
    el('screen').innerHTML = `<div class="cover"><div class="title panel">
      <h1>${broke ? 'BUSTED' : 'SEASON OVER'}</h1><div class="wt">${broke ? `Out of cash on day ${day}` : `You made it through all ${SEASON_DAYS} days`}</div>
      <div class="score"><div><label>Final cash</label><b>${$(p.cash)}</b></div><div><label>Gold recovered</label><b>${p.goldGrams.toFixed(1)} g</b></div>
      <div><label>Gold sold</label><b>${$(p.earned)}</b></div><div><label>Tiles dug out</label><b>${p.tilesDug}</b></div>
      <div><label>Loads washed</label><b>${p.loadsWashed}</b></div><div><label>Claims</label><b>${p.claims}</b></div></div>
      <button class="primary big" id="again">New season, new ground</button> <button class="ghost" id="same">Replay this map</button></div></div>`;
    el('again').onclick = () => { el('screen').innerHTML = ''; this.ses.restart(Math.floor(Math.random() * 1e6) + 1); };
    el('same').onclick = () => { el('screen').innerHTML = ''; this.ses.restart(this.ses.seed); };
  }

  update(time: number) {
    const ses = this.ses, s = ses.state, p = ses.player;
    const burn = dailyBurn(s, ses.me);
    el('cash').textContent = $(p.cash);
    const runway = p.cash / burn;
    el('s-cash').classList.toggle('danger', runway < 2.5 && ses.started);
    el('runway').textContent = `${runway.toFixed(1)} days of runway`;
    const dayF = s.tick / TICKS_PER_DAY, day = Math.min(SEASON_DAYS, Math.floor(dayF) + 1);
    el('daylabel').textContent = `Day ${day} of ${SEASON_DAYS}`;
    (el('daybar') as HTMLElement).style.width = (dayF / SEASON_DAYS * 100).toFixed(2) + '%';
    // sun and moon dial: the sun is up for the first 72% of each day
    const f = (dayF + DAWN_OFFSET) % 1, ang = f < 0.72 ? -90 + 180 * (f / 0.72) : 90 + 180 * ((f - 0.72) / 0.28);
    el('dialarm').style.transform = `rotate(${ang.toFixed(1)}deg)`;
    if (s.over && !el('screen').innerHTML) this.endScreen();
    if (time - this.last < 180) return;
    this.last = time;

    el('burn').textContent = `-${$(burn)}/day`;
    el('gold').textContent = p.goldGrams.toFixed(1) + ' g';
    const gal = s.items.filter(i => isTank(i.kind) && i.owner === ses.me).reduce((a, i) => a + i.fuel, 0), tanks = s.items.some(i => isTank(i.kind) && i.owner === ses.me);
    el('burnsub').textContent = tanks ? `diesel in tanks: ${Math.round(gal)} gal` : 'living + wages + upkeep';
    el('burnsub').style.color = tanks && gal < 15 ? 'var(--bad)' : '';
    el('mute').classList.toggle('off', ses.sfx.muted);
    el('goldsub').textContent = `${$(p.earned)} sold at ${$(GOLD_PRICE_PER_GRAM)}/g`;
    el('daysub').textContent = ses.paused && ses.started ? 'Paused' : `${SEASON_DAYS - day} days left`;
    el('speed').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.s === '0' ? ses.paused : !ses.paused && Number(b.dataset.s) === ses.speed));
    el('b-drill').style.display = p.drill ? '' : 'none'; el('b-drill').classList.toggle('on', ses.mode === 'drill');
    el('b-pan').classList.toggle('on', ses.mode === 'testpan'); el('b-claim').classList.toggle('on', ses.mode === 'claim');
    const cc = nextClaimCost(s, ses.me);
    el('claimlabel').textContent = `Stake claim (${cc ? $(cc) : 'free'})`;
    el('b-claim').classList.toggle('glow', p.claims === 0 && p.samples >= 3);
    el('mode').textContent = ses.mode === 'testpan' ? 'TEST PAN: click ground to sample it. Right-click or Esc to stop.' : ses.mode === 'drill' ? `CORE DRILL: click a tile to read all five layers for ${$(DRILL_FEE)}. Right-click or Esc to stop.` : ses.mode === 'claim' ? 'STAKE CLAIM: point anywhere and click to stake 8 x 8 tiles. Right-click or Esc to cancel.' : ses.mode === 'place' ? 'DELIVERY: click where you want it. Shift-click to buy another. Right-click or Esc to cancel.' : ses.mode === 'move' ? 'MOVE: click where it should go. Right-click or Esc to cancel.' : '';
    el('mode').style.display = ses.mode ? 'block' : 'none';
    const secs = runway * 60 / (ses.paused ? 1 : ses.speed);
    el('warn').textContent = ses.started && !s.over && runway < 1.5 ? `Broke in ${Math.ceil(secs)} seconds` : '';
    if (this.modal === 'store') el('modal').querySelectorAll<HTMLElement>('.card').forEach((c, i) => c.classList.toggle('poor', p.cash < STORE[i].price));
    this.renderGoals(); this.renderSel(); this.renderTile(); if (time - this.lastMini > 600) { this.lastMini = time; this.renderMini(); }
  }

  /** The tutorial: one short checklist per tier, shown until it is done. It can be minimized. */
  renderGoals() {
    const s = this.ses.state, p = this.ses.player, me = this.ses.me;
    const own = (k: string) => s.items.find(i => i.kind === k && i.owner === me);
    const driven = (k: string) => { const v = own(k); return v ? s.units.find(u => u.id === v.driver) : undefined; };
    const deepest = (k: number) => s.tiles.some(t => t.owner === me && !t.water && tileLevel(t) >= k);
    const workers = s.units.filter(u => u.owner === me && !u.boss);
    const tr = own('trommel'), wp = own('washplant'), cr = own('crusher'), ml = own('mill');
    const touch = (a?: { x: number; y: number }, b?: { x: number; y: number }) => !!a && !!b && Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1;
    const lists: [string, [string, boolean][]][] = [
      ['Getting started', [
        ['Test pan 3 spots to find color <kbd>T</kbd>', p.samples >= 3],
        ['Stake your free claim on good ground <kbd>C</kbd>', p.claims >= 1],
        ['Pick up the bucket and dig on your claim', s.tiles.some(t => t.owner === me && t.known)],
        ['Screen at the sieve, then wash at the pan', p.goldGrams > 0],
        ['Hire a hand <kbd>B</kbd>, select them, right-click your claim', workers.some(w => w.job)],
        ['Buy a sluice box and set it at the creek', !!own('sluice')],
      ]],
      ['Going mechanical', [
        ['Buy a trommel <kbd>B</kbd> and set it on a tile touching your sluice', !!tr && !!linkedSluice(s, tr)],
        ['Buy a diesel tank and set it within 8 tiles of the trommel', !!tr && s.items.some(i => isTank(i.kind) && i.owner === me && (i.x - tr.x) ** 2 + (i.y - tr.y) ** 2 <= TANKS[i.kind].range ** 2)],
        ['Buy a mini excavator, select a hired hand, right-click the excavator', !!driven('excavator')],
        ['With the driver selected, right-click your claim', !!driven('excavator')?.job],
        ['Dig the topsoil off a tile (its 4 neighbours need their organic layer gone first)', deepest(2)],
      ]],
      ['Down to the brown layer', [
        ['Buy a wash plant and set it beside the creek, or near a pump', !!wp && wet(s, wp.x, wp.y, me)],
        ['Buy a dozer and put a hand in it, then right-click your claim: it rips the brown layer', !!driven('dozer')?.job],
        ['Buy a mid excavator, put a hand in it, right-click your claim', !!driven('excavator2')?.job],
        ['Dig a tile down through the brown layer', deepest(3)],
        ['Optional: a dump truck hauls for the excavator, and a fuel truck keeps both running', !!own('truck') || deepest(3)],
      ]],
      ['The blue layer', [
        ['Stake claims side by side: a deep pit has to be wide', p.claims >= 4],
        ['Buy a large excavator, put a hand in it, right-click your claim', !!driven('excavator3')?.job],
        ['Dig a tile down through the blue layer', deepest(4)],
      ]],
      ['Bedrock', [
        ['Buy a mill and set it on a tile touching your wash plant', touch(ml, wp)],
        ['Buy a crusher and set it on a tile touching the mill', touch(cr, ml)],
        ['Buy a mining excavator, put a hand in it, right-click your claim', !!driven('excavator4')?.job],
        ['Break through bedrock on a tile', deepest(5)],
      ]],
    ];
    const box = el('goals');
    const open = lists.slice(0, p.tier).find(l => l[1].some(g => !g[1]));
    if (!open) { box.style.display = 'none'; return; }
    box.style.display = '';
    const [title, goals] = open, next = goals.findIndex(g => !g[1]), tierNo = lists.indexOf(open) + 1;
    const html = this.goalsMin
      ? `<h4 class="gmin" data-min title="Show the tutorial">Tutorial: ${title} <b>+</b></h4>`
      : `<h4>${title} <small>tier ${tierNo} of 5</small><b data-min title="Minimize">&minus;</b></h4>` + goals.map(([t, d], i) => `<div class="goal ${d ? 'done' : i === next ? 'next' : ''}"><i>${d ? '✓' : i + 1}</i><span>${t}</span></div>`).join('');
    box.classList.toggle('min', this.goalsMin);
    if (box.innerHTML !== html) box.innerHTML = html;
  }
  goalsMin = (() => { try { return localStorage.getItem('yukons-gold-tutorial-min') === '1'; } catch { return false; } })();

  renderSel() {
    const ses = this.ses, s = ses.state;
    let html = '';
    const it = itemById(s, ses.selItem);
    const units = s.units.filter(u => ses.selUnits.has(u.id));
    if (it) {
      const name = ITEM_NAME[it.kind];
      let body = '';
      let extra = '';
      const fuelLine = isVehicle(it.kind) ? ` &middot; fuel ${it.fuel.toFixed(0)} of ${VEHICLES[it.kind].tank} gal` : '';
      if (isTank(it.kind)) { const T = TANKS[it.kind], need = T.capacity - it.fuel; body = `${Math.round(it.fuel).toLocaleString()} of ${T.capacity.toLocaleString()} gallons. Feeds machines within ${T.range} tiles.`; extra = `<button data-a="fuel" data-id="${it.id}" ${need < 1 ? 'disabled' : ''}>Fill up (${$(Math.ceil(need) * DIESEL_PRICE)})</button>`; }
      else if (isVehicle(it.kind)) {
        const d = s.units.find(u => u.id === it.driver);
        body = `${d ? 'Driver: ' + d.name : 'No driver: select a hired hand and right-click it'}${fuelLine}` + (it.kind === 'truck' ? ` &middot; load ${it.hopper} of ${HOPPER.truck}${it.ore && it.hopper ? ' (ore)' : ''}` : it.kind === 'fueltruck' ? ` &middot; carrying ${Math.round(it.cargo)} gal` : '');
      }
      else if (isProcessor(it.kind)) body = `Hopper: ${it.hopper} of ${HOPPER[it.kind]} loads &middot; ${it.running ? 'running' : 'stopped'}`;
      else if (it.kind === 'pump') body = it.running ? 'Running: watering everything within 10 tiles' : 'Idle';
      else if (it.kind === 'sluice' && it.feed > 0) body = `Fed by the trommel: ${it.feed} loads waiting`;
      else if (isContainer(it.kind)) body = it.contents === 'empty' ? 'Empty' : `${it.loads} load${it.loads > 1 ? 's' : ''} of ${it.contents === 'fines' ? 'screened fines' : 'pay dirt'}`;
      else {
        const inn = itemById(s, it.inSlot), out = itemById(s, it.outSlot);
        body = `In: ${inn ? (inn.contents === 'fines' ? 'fines' : 'pay dirt') : 'empty'}` + (it.kind === 'sieve' ? ` &middot; Out: ${out ? 'fines ready' : 'empty'}` : '');
        if (isWash(it.kind) && onGround(it) && !wet(s, it.x, it.y, ses.me)) body += `<div class="bad">Needs water. Move it beside the creek, or add a pump.</div>`;
      }
      if (it.note) body += `<div class="bad">${it.note}</div>`;
      html = `<div class="head"><img src="${this.icon(isContainer(it.kind) ? it.kind + '_' + it.contents : it.kind)}"><div><b>${name[0].toUpperCase() + name.slice(1)}</b><small>${body}</small></div></div>
        <div class="btns">${extra}${isVehicle(it.kind) ? '' : `<button data-a="move" data-id="${it.id}">Move <kbd>M</kbd></button>`}<button data-a="sell" data-id="${it.id}">Sell for ${$((PRICE[it.kind] ?? 0) * SELL_BACK)}</button></div>`;
    } else if (units.length === 1) {
      const u = units[0], c = itemById(s, u.carrying);
      const carry = c ? `Carrying ${ITEM_NAME[c.kind]}${isContainer(c.kind) && c.contents !== 'empty' ? ` (${c.contents === 'fines' ? 'fines' : 'pay dirt'})` : isContainer(c.kind) ? ' (empty)' : ''}` : 'Hands free';
      const job = u.boss ? '' : `<div class="job">${u.vehicle >= 0 ? (u.job ? `Job: ${ITEM_NAME[itemById(s, u.vehicle)?.kind ?? ''] ?? 'machine'} driver` : 'In the cab: right-click your claim to put it to work') : !u.job ? 'No job: right-click your claim to start them mining' : u.job.type === 'dig' ? 'Job: miner (digs, screens, washes)' : itemById(s, u.job.station)?.kind === 'sieve' ? 'Job: sieve operator' : 'Job: washer'}</div>`;
      html = `<div class="head"><img src="${this.icon(u.boss ? 'miner_boss' : 'miner_' + (u.id % 3))}"><div><b>${u.boss ? 'You, the prospector' : u.name + ', hired hand'}</b><small>${u.status}${u.vehicle >= 0 ? '' : ' &middot; ' + carry}</small></div></div>${job}
        <div class="btns">${u.boss ? `<button data-a="pan">Test pan <kbd>T</kbd></button>` : ''}${c ? `<button data-a="drop" data-id="${u.id}">Drop <kbd>G</kbd></button>` : ''}
        ${u.vehicle >= 0 ? `<button data-a="dismount" data-id="${u.id}">Get out</button>` : ''}${!u.boss && u.job ? `<button data-a="clear" data-id="${u.id}">Stop job</button>` : ''}${!u.boss ? `<button data-a="fire" data-id="${u.id}" class="warnb">Let go</button>` : ''}</div>`;
    } else if (units.length > 1) {
      html = `<div class="head"><img src="${this.icon('miner_0')}"><div><b>${units.length} selected</b><small>${units.map(u => u.name).join(', ')}</small></div></div><div class="dim">Right-click your claim to set them all mining.</div>`;
    } else html = `<div class="dim">Nothing selected. Left-click your miner, or press <kbd>F</kbd> to find them.</div>`;
    if (el('sel').innerHTML !== html) el('sel').innerHTML = html;
  }

  renderTile() {
    const ses = this.ses, s = ses.state, st = ses.selTile, t = st && tileAt(s, st.x, st.y);
    let html = '';
    if (!st || !t) html = `<h4>Ground</h4><div class="dim">Hover a tile to read it.</div>`;
    else if (t.water) html = `<h4>Creek <span class="xy">${st.x}, ${st.y}</span></h4><div class="dim">Running water. Pans, sluices and wash plants only work beside it or near a pump.</div>`;
    else {
      const seen = t.known || t.drilled, band = seen ? bandOf(organicGrade(t)) : t.sample;
      const chip = band < 0 ? `<span class="chip none">Not sampled</span>` : `<span class="chip" style="background:${BAND_CSS[band]}">${BANDS[band].name}</span>`;
      const note = t.drilled ? 'Core-sampled: every layer is known.' : t.known ? `Proven by digging: ${organicGrade(t).toFixed(2)} g per load` : band >= 0 ? 'Test pan reading. Could be one band off.' : 'Press T and click here to test pan.';
      const own = t.owner === ses.me ? `<span class="own">Your claim</span>` : `<span class="unown">Unclaimed</span>`;
      const k = tileLevel(t);
      let lock = '';
      if (k >= 1 && k <= 4 && !canDigLayer(s, st.x, st.y, k)) lock = `The ${LAYERS[k].name.toLowerCase()} is locked: dig the 4 tiles around this one down to the same depth first.`;
      else if (k === 2 && !t.ripped) lock = 'The brown layer needs a dozer pass before an excavator can dig it.';
      html = `<h4>Ground <span class="xy">${st.x}, ${st.y}</span> ${own}</h4>
        <div class="read">${chip}<small>${note}</small></div>
        <div class="layers">${LAYERS.map((l, i) => { const left = t[LAYER_KEYS[i]], gone = left <= 0; return `<div class="${gone ? 'gone' : i === k ? 'cur' : ''}"><i style="background:${LAYER_CSS[i]}"></i><b>${l.name}</b>
          <span class="bar"><u style="width:${left / LAYER_LOADS[i] * 100}%;background:${LAYER_CSS[i]}"></u></span>
          <em>${gone ? 'dug out' : t.drilled || (i === 0 && t.known) ? layerGrade(t, i).toFixed(2) + ' g/load' : left + ' loads'}</em><small>${gone ? '' : l.tool}</small></div>`; }).join('')}</div>
        ${lock ? `<div class="bad">${lock}</div>` : ''}`;
    }
    if (el('tile').innerHTML !== html) el('tile').innerHTML = html;
  }

  renderMini() {
    const s = this.ses.state, n = s.size, me = this.ses.me;
    const cv = el('mm') as HTMLCanvasElement; if (cv.width !== n) { cv.width = cv.height = n; this.miniImg = null; }
    const ctx = cv.getContext('2d')!, img = this.miniImg ?? (this.miniImg = ctx.createImageData(n, n)), d = img.data;
    const put = (i: number, c: number) => { d[i * 4] = c >> 16; d[i * 4 + 1] = (c >> 8) & 255; d[i * 4 + 2] = c & 255; d[i * 4 + 3] = 255; };
    const PIT = [0, 0x6b4a2b, 0x4a3320, 0x8a5a3a, 0x4f6d8a, 0x8b8f96];
    for (let i = 0; i < n * n; i++) {
      const t = s.tiles[i];
      if (t.water) { put(i, 0x3f8fc4); continue; }
      const k = tileLevel(t), band = t.known || t.drilled ? bandOf(organicGrade(t)) : t.sample;
      let c = k > 0 ? PIT[k] : band >= 0 ? MINI_BAND[band] : t.owner === me ? 0x86b356 : 0x476f38;
      if (t.owner === me) { const x = i % n, y = (i / n) | 0; if (x === 0 || y === 0 || x === n - 1 || y === n - 1 || s.tiles[i - 1].owner !== me || s.tiles[i + 1].owner !== me || s.tiles[i - n].owner !== me || s.tiles[i + n].owner !== me) c = 0xf2c14e; }
      put(i, c);
    }
    for (const u of s.units) { const x = Math.floor(u.x), y = Math.floor(u.y); for (let dy = 0; dy < (n > 100 ? 2 : 1); dy++) for (let dx = 0; dx < (n > 100 ? 2 : 1); dx++) if (x + dx < n && y + dy < n) put((y + dy) * n + x + dx, u.boss ? 0xff5a3c : 0xffffff); }
    ctx.putImageData(img, 0, 0);
  }
  miniImg: ImageData | null = null;
}

const MINI_BAND = [0x9aa0a6, 0x5fb3a1, 0xf2d04b, 0xff8a3d, 0xff4fa3];
