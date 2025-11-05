// FILE: app.js
// PURPOSE: Logika licznika F1 — sekwencja startowa, timer, okrążenia, SC/VSC, persist
// RUNTIME: browser
// NOTES: Jedno źródło stanu; render() idempotentny; debouncing rejestracji okrążeń

'use strict';

(function(){
  // iOS viewport fix
  function setVh(){ document.documentElement.style.setProperty('--vh', window.innerHeight + 'px'); }
  window.addEventListener('resize', setVh); setVh();

  const PERSIST_KEY = 'f1-counter-v1';

  const initialDriver = i => ({
    id: i,
    name: `Kierowca ${i}`,
    laps: [],          // [lapMillis, ...]
    lastLapAt: null,   // timestamp session when started counting current lap
    sum: 0,            // total time
    best: null,        // best lap millis
    lastLap: null,     // last lap millis
    _lastRegisterTs: 0 // debouncing
  });

  const state = {
    locks: { starting:false },
    flags: { sc:false, vsc:false },
    session: {
      running: false,
      startedAt: null, // perf.now() when running
      elapsed: 0       // accumulated ms when paused
    },
    driversCount: 2,
    activeDriver: 1,
    drivers: { 1: initialDriver(1), 2: initialDriver(2), 3: initialDriver(3), 4: initialDriver(4) }
  };

  // Persist
  function save(){ localStorage.setItem(PERSIST_KEY, JSON.stringify(state, (k,v)=>(k==='_lastRegisterTs'?undefined:v))); }
  function load(){
    const raw = localStorage.getItem(PERSIST_KEY);
    if(!raw) return;
    try{
      const s = JSON.parse(raw);
      Object.assign(state.flags, s.flags||{});
      Object.assign(state.session, s.session||{});
      state.driversCount = s.driversCount||2;
      state.activeDriver = s.activeDriver||1;
      // drivers
      for (const i of [1,2,3,4]){
        const d = s.drivers?.[i]||initialDriver(i);
        state.drivers[i] = {...initialDriver(i), ...d, _lastRegisterTs:0};
      }
    }catch{}
  }

  function must(sel){ const el = document.querySelector(sel); if(!el) throw new Error(`Missing ${sel}`); return el; }
  const $ = (sel)=>document.querySelector(sel);

  // Format helpers
  function fmt(ms){
    const m = Math.floor(ms/60000);
    const s = Math.floor((ms%60000)/1000);
    const x = Math.floor(ms%1000);
    return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(x).padStart(3,'0')}`;
  }

  // Timer
  function now(){ return performance.now(); }
  function sessionNowMs(){
    if (state.session.running){
      return state.session.elapsed + (now() - state.session.startedAt);
    }
    return state.session.elapsed;
  }

  function startSequence(){
    if (state.locks.starting || state.session.running) return;
    state.locks.starting = true;
    render();
    const lights = [1,2,3,4,5].map(n=>document.querySelector(`.light[data-light="${n}"]`));
    let idx = 0;
    const audio = document.querySelector('[data-audio="start"]');
    const step = ()=>{
      if (idx < lights.length){
        lights[idx].classList.add('on');
        idx++;
        setTimeout(step, 700);
      } else {
        // Lights out
        lights.forEach(l=>l.classList.remove('on'));
        if (audio) { try{ audio.currentTime=0; audio.play().catch(()=>{});}catch{} }
        state.session.running = true;
        state.session.startedAt = now();
        // init per driver lap start
        const t = sessionNowMs();
        for (const i of rangeDrivers()){
          state.drivers[i].lastLapAt = t;
        }
        state.locks.starting = false;
        render();
      }
    };
    step();
  }

  function pause(){
    if (!state.session.running) return;
    state.session.elapsed = sessionNowMs();
    state.session.running = false;
    state.session.startedAt = null;
    render();
  }
  function resume(){
    if (state.session.running) return;
    state.session.startedAt = now();
    state.session.running = true;
    render();
  }

  function hardReset(){
    localStorage.removeItem(PERSIST_KEY);
    // reset state
    state.locks.starting = false;
    state.flags.sc = false; state.flags.vsc = false;
    state.session.running = false; state.session.startedAt = null; state.session.elapsed = 0;
    state.driversCount = 2; state.activeDriver = 1;
    state.drivers = { 1: initialDriver(1), 2: initialDriver(2), 3: initialDriver(3), 4: initialDriver(4) };
    render();
  }

  function rangeDrivers(){ return Array.from({length: state.driversCount}, (_,k)=>k+1); }

  function registerLap(driverId){
    const d = state.drivers[driverId];
    const tnow = now();
    if (tnow - d._lastRegisterTs < 300) return; // debouncing
    d._lastRegisterTs = tnow;

    const sessMs = sessionNowMs();
    if (d.lastLapAt == null) d.lastLapAt = sessMs;
    const lapMs = Math.max(0, Math.floor(sessMs - d.lastLapAt));
    d.lastLapAt = sessMs;
    d.lastLap = lapMs;
    d.laps.push(lapMs);
    d.sum += lapMs;
    if (d.best == null || lapMs < d.best) d.best = lapMs;
    render();
  }

  function toggleFlag(key){
    state.flags[key] = !state.flags[key];
    if (key==='sc' && state.flags.sc) state.flags.vsc = false;
    if (key==='vsc' && state.flags.vsc) state.flags.sc = false;
    render();
  }

  function setDriversCount(n){
    state.driversCount = n;
    if (state.activeDriver > n) state.activeDriver = n;
    render();
  }

  function nextActive(){
    state.activeDriver = ((state.activeDriver) % state.driversCount) + 1;
    render();
  }

  // Ranking
  function buildTableData(){
    const rows = rangeDrivers().map(i=>{
      const d = state.drivers[i];
      return {
        id: i,
        name: d.name,
        laps: d.laps.length,
        best: d.best,
        last: d.lastLap,
        sum: d.sum
      };
    });
    // sort: więcej okrążeń → krótsza suma → lepsze best
    rows.sort((a,b)=>{
      if (b.laps !== a.laps) return b.laps - a.laps;
      if (a.sum !== b.sum) return a.sum - b.sum;
      if (a.best==null && b.best!=null) return 1;
      if (b.best==null && a.best!=null) return -1;
      return (a.best||Infinity) - (b.best||Infinity);
    });
    return rows.map((r,idx)=>({...r, pos: idx+1}));
  }

  // Render
  let rafId = null;
  function render(){
    // flags
    for (const k of ['sc','vsc']){
      const el = document.querySelector(`.flag.${k}`);
      if (el){ el.classList.toggle('active', !!state.flags[k]); }
    }

    // status/timer
    const timeEl = document.querySelector('[data-field="session-time"]');
    const statusEl = document.querySelector('[data-field="status"]');
    if (timeEl) timeEl.textContent = fmt(sessionNowMs());
    if (statusEl){
      statusEl.textContent = state.locks.starting ? 'STARTING' : (state.session.running ? 'RUNNING' : 'PAUSED/READY');
    }

    // controls visibility
    const btnStart = document.querySelector('[data-action="start"]');
    if (btnStart) btnStart.disabled = state.locks.starting || state.session.running;
    const btnPause = document.querySelector('[data-action="pause"]');
    if (btnPause) btnPause.disabled = state.locks.starting || !state.session.running;
    const btnResume = document.querySelector('[data-action="resume"]');
    if (btnResume) btnResume.disabled = state.locks.starting || state.session.running;

    // driver cards
    const list = document.querySelector('[data-role="drivers"]');
    if (list){
      list.innerHTML = '';
      for (const i of rangeDrivers()){
        const d = state.drivers[i];
        const card = document.createElement('div');
        card.className = 'card';
        const activeMark = (state.activeDriver===i) ? ' <span class="act">(AKTYWNY)</span>' : '';
        card.innerHTML = `
          <h3>${d.name}${activeMark}</h3>
          <div class="badges">
            <span class="badge">Okra: ${d.laps.length}</span>
            <span class="badge">Best: ${d.best!=null?fmt(d.best):'—'}</span>
            <span class="badge">Last: ${d.lastLap!=null?fmt(d.lastLap):'—'}</span>
            <span class="badge">Sum: ${fmt(d.sum)}</span>
          </div>
          <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">
            <button data-action="lap" data-driver="${i}">+ Okrążenie (${i})</button>
            <button data-action="activate" data-driver="${i}">Ustaw aktywnego</button>
          </div>
        `;
        list.appendChild(card);
      }
    }

    // table
    const tbody = document.querySelector('[data-role="table-body"]');
    if (tbody){
      tbody.innerHTML = '';
      const data = buildTableData();
      const globalBest = Math.min(...rangeDrivers().map(i=>state.drivers[i].best||Infinity));
      for (const r of data){
        const tr = document.createElement('tr');
        if (r.best!=null && r.best === globalBest) tr.classList.add('best');
        tr.innerHTML = `
          <td>P${r.pos}</td>
          <td>${state.drivers[r.id].name}</td>
          <td>${r.laps}</td>
          <td>${r.best!=null?fmt(r.best):'—'}</td>
          <td>${r.last!=null?fmt(r.last):'—'}</td>
          <td>${fmt(r.sum)}</td>
        `;
        tbody.appendChild(tr);
      }
    }

    // drivers count select
    const sel = document.querySelector('[data-action="set-drivers"]');
    if (sel && Number(sel.value)!==state.driversCount) sel.value = String(state.driversCount);

    // animate timer
    if (state.session.running && rafId==null){
      const loop = ()=>{ 
        rafId = requestAnimationFrame(()=>{
          rafId = null;
          const t = document.querySelector('[data-field="session-time"]');
          if (t) t.textContent = fmt(sessionNowMs());
          if (state.session.running) loop();
        });
      };
      loop();
    }
    if (!state.session.running && rafId!=null){
      cancelAnimationFrame(rafId); rafId = null;
    }

    save();
  }

  // Events
  function onClick(e){
    const el = e.target.closest('button,select,.flag');
    if (!el) return;
    if (el.matches('[data-action="start"]')) startSequence();
    else if (el.matches('[data-action="pause"]')) pause();
    else if (el.matches('[data-action="resume"]')) resume();
    else if (el.matches('[data-action="reset"]')) hardReset();
    else if (el.matches('[data-action="export"]')) exportCSV();
    else if (el.matches('[data-action="lap"]')) registerLap(Number(el.getAttribute('data-driver')));
    else if (el.matches('[data-action="activate"]')) { state.activeDriver = Number(el.getAttribute('data-driver')); render(); }
    else if (el.matches('[data-action="set-drivers"]')) setDriversCount(Number(el.value));
    else if (el.matches('.flag.sc')) toggleFlag('sc');
    else if (el.matches('.flag.vsc')) toggleFlag('vsc');
  }

  function onKey(e){
    if (e.repeat) return;
    const k = e.key.toLowerCase();
    if (k==='enter'){ startSequence(); }
    else if (k===' '){ e.preventDefault(); state.session.running?pause():resume(); }
    else if (k==='tab'){ e.preventDefault(); nextActive(); }
    else if (k==='s'){ toggleFlag('sc'); }
    else if (k==='v'){ toggleFlag('vsc'); }
    else if (k==='r'){ hardReset(); }
    else if (k==='e'){ exportCSV(); }
    else if (k>='1' && k<='4'){ const n = Number(k); if (n<=state.driversCount) registerLap(n); }
  }

  function exportCSV(){
    const rows = [['driver','lap_index','lap_ms','lap_fmt','sum_ms_after','sum_fmt_after']];
    for (const i of rangeDrivers()){
      const d = state.drivers[i];
      let run=0;
      d.laps.forEach((lap,idx)=>{
        run += lap;
        rows.push([d.name, idx+1, lap, fmt(lap), run, fmt(run)]);
      });
    }
    const csv = rows.map(r=>r.join(',')).join('\n');
    const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'f1_laps.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // Smoke test
  window.__smoke = ()=>{
    const mustSel = s=>{ const el=document.querySelector(s); if(!el) throw new Error('Missing '+s); return el; };
    mustSel('#app'); mustSel('[data-action="start"]'); mustSel('[data-role="drivers"]'); mustSel('[data-role="table-body"]');
    console.log('SMOKE OK');
  };

  // Init
  document.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);
  load(); render();

})();
