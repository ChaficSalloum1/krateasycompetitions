export const playerHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="theme-color" content="#14201c">
  <title>My next match · Krateasy Competitions</title>
  <style>
    :root{color-scheme:light;--ink:#17201d;--muted:#65706b;--canvas:#f3f2ed;--surface:#fffefb;--line:#d8d8d1;--accent:#087b59;--warm:#f4e9df;font-family:Geist,"Avenir Next",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    *{box-sizing:border-box}body{margin:0;background:var(--canvas);color:var(--ink)}button,input,a{font:inherit;min-height:48px}.shell{width:min(780px,100%);margin:auto;padding:22px 18px calc(42px + env(safe-area-inset-bottom))}.top{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:34px;padding-bottom:18px;border-bottom:1px solid var(--line)}.brand{font-weight:850;letter-spacing:-.02em}.brand small{display:block;color:var(--muted);font-weight:600;font-size:12px}.verified{font-size:12px;font-weight:750;color:var(--accent);text-align:right}.verified a{color:inherit;text-decoration:none;min-height:0}h1{font-size:clamp(38px,10vw,62px);line-height:.95;letter-spacing:-.055em;margin:0 0 12px;max-width:10ch}p{color:var(--muted);line-height:1.5}.finder{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;margin:24px 0 10px}.finder input{width:100%;border:1px solid #bfc3bd;border-radius:13px;background:white;padding:0 15px;font-size:16px}.finder button,.share{border:0;border-radius:13px;background:var(--ink);color:white;font-weight:750;padding:0 18px;cursor:pointer}.finder button:active,.share:active,.quiet:active{transform:translateY(1px)}.identity{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:46px;margin-bottom:13px}.identity span{font-size:13px;color:var(--muted)}.quiet{border:0;background:transparent;color:var(--accent);font-weight:750;cursor:pointer;padding:0 4px;min-height:44px}.status{min-height:24px;margin:8px 0 14px;color:var(--muted);font-size:14px}.next{background:var(--ink);color:white;border-radius:22px;padding:27px;min-height:300px;display:flex;flex-direction:column;justify-content:space-between;box-shadow:0 18px 50px rgba(23,32,29,.12)}.eyebrow{font-size:11px;letter-spacing:.13em;text-transform:uppercase;font-weight:850;color:#73d2b2}.time{font:800 clamp(56px,16vw,86px)/1 Geist Mono,ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:-.075em}.next h2{font-size:23px;margin:7px 0}.next p{color:#c9d6d0;margin:0}.chips{display:flex;gap:8px;flex-wrap:wrap;margin-top:17px}.chips span{background:rgba(255,255,255,.11);border-radius:999px;padding:8px 11px;font-size:13px;font-weight:750}.next-actions{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:20px}.share{background:white;color:var(--ink);font-size:13px;min-height:44px}.fresh{color:#aebdb6;font-size:12px}.upcoming{margin-top:18px;background:var(--surface);border-top:1px solid var(--ink);border-bottom:1px solid var(--line)}.upcoming h2{font-size:17px;margin:0;padding:19px 2px 14px}.match{display:grid;grid-template-columns:62px minmax(0,1fr) auto;gap:13px;align-items:center;padding:17px 2px;border-top:1px solid var(--line)}.match time{font-weight:850;font-variant-numeric:tabular-nums}.match strong{overflow-wrap:anywhere}.match small{display:block;color:var(--muted);margin-top:4px}.court{white-space:nowrap;border:1px solid var(--line);border-radius:999px;padding:7px 10px;font-size:12px;font-weight:750}.recovery{display:grid;grid-template-columns:auto minmax(0,1fr);gap:14px;align-items:center;margin-top:20px;padding:16px;background:var(--warm);border-radius:14px}.recovery img{width:84px;height:84px;background:white;padding:5px}.recovery strong{display:block;margin-bottom:4px}.recovery p{font-size:13px;margin:0}.privacy{margin-top:18px;font-size:12px;color:var(--muted)}.empty{padding:22px 2px;color:var(--muted)}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}:focus-visible{outline:3px solid #79c9af;outline-offset:2px}
    @media(max-width:560px){.shell{padding-top:17px}.top{margin-bottom:28px}.finder{grid-template-columns:1fr}.next{min-height:282px;border-radius:19px;padding:23px}.next-actions{align-items:flex-end}.match{grid-template-columns:54px minmax(0,1fr)}.court{grid-column:2;justify-self:start}.recovery{grid-template-columns:1fr}.recovery img{display:none}}
    @media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important}}
  </style>
</head>
<body>
  <main class="shell">
    <header class="top">
      <div class="brand">Krateasy <small>Competitions</small></div>
      <div class="verified">No app needed<br><a href="/display">Open venue board</a></div>
    </header>
    <h1>When do I play?</h1>
    <p>Find your pair once. This browser will remember it, and every important message should contain the time and court even if you never return here.</p>
    <div class="finder">
      <label class="sr-only" for="player">Player or pair name</label>
      <input id="player" type="search" list="pair-options" placeholder="Type your pair or player name" autocomplete="name">
      <datalist id="pair-options"></datalist>
      <button id="find" type="button">Find my pair</button>
    </div>
    <div class="identity"><span id="remembered">Nothing is saved until you choose a pair.</span><button class="quiet" id="not-me" type="button" hidden>Not my pair</button></div>
    <div class="status" id="status" aria-live="polite">Search or scan the event QR to see your next match.</div>
    <article class="next" aria-labelledby="next-title">
      <div><div class="eyebrow">Your next match</div><div class="time" id="next-time">—</div></div>
      <div>
        <h2 id="next-title">Find your pair</h2>
        <p id="next-players">Your next court and arrival target will appear here.</p>
        <div class="chips"><span id="next-court">Court —</span><span>Arrive 10 minutes early</span></div>
        <div class="next-actions"><span class="fresh" id="freshness">Checking published revision…</span><button class="share" id="share" type="button" disabled>Share my live page</button></div>
      </div>
    </article>
    <section class="upcoming" aria-labelledby="upcoming-title">
      <h2 id="upcoming-title">Your later confirmed matches</h2>
      <div id="matches"><div class="empty">Choose your pair above.</div></div>
    </section>
    <section class="recovery"><img src="/next-qr.svg" alt="QR code for this next-match finder"><div><strong>Someone else needs their match?</strong><p>Scan the same venue QR or open <b>/next</b> on any phone. No account, download or home-screen installation is required.</p></div></section>
    <div class="privacy">This is a local delivery rehearsal. Production personal routes use opaque, expiring participant tokens; private contact and eligibility data never appear in the public schedule.</div>
  </main>
  <script>
    const input=document.querySelector('#player'),status=document.querySelector('#status'),share=document.querySelector('#share'),find=document.querySelector('#find'),notMe=document.querySelector('#not-me'),matchesNode=document.querySelector('#matches');let state,selected;
    const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const clock=v=>v?new Intl.DateTimeFormat(undefined,{hour:'2-digit',minute:'2-digit'}).format(new Date(v)):'—';
    const storageKey=()=>state?'krateasy.next.'+state.competition.id:'krateasy.next';
    function participantFromToken(token){return state.participants.find(item=>item.token===token)}
    function choose(participant,persist=true){selected=participant??null;if(!selected){input.value='';share.disabled=true;notMe.hidden=true;document.querySelector('#remembered').textContent='Nothing is saved until you choose a pair.';if(persist)localStorage.removeItem(storageKey());const url=new URL(location.href);url.searchParams.delete('token');history.replaceState(null,'',url);render();return}input.value=selected.displayName;share.disabled=false;notMe.hidden=false;document.querySelector('#remembered').textContent='Remembering '+selected.displayName+' on this device.';if(persist)localStorage.setItem(storageKey(),selected.token);const url=new URL(location.href);url.searchParams.set('token',selected.token);history.replaceState(null,'',url);render()}
    function render(){const mine=selected?state.contests.filter(item=>item.participantIds.includes(selected.id)):[],next=mine[0];status.textContent=selected?(mine.length?mine.length+' confirmed matches found for '+selected.displayName:'No confirmed published match is available yet. This page will retain your pair.'):'Search or scan the event QR to see your next match.';document.querySelector('#next-time').textContent=next?clock(next.start):'—';document.querySelector('#next-title').textContent=next?next.title:selected?'Waiting for confirmation':'Find your pair';document.querySelector('#next-players').textContent=next?next.participantNames.join(' vs '):'Your next court and arrival target will appear here.';document.querySelector('#next-court').textContent=next?next.court:'Court —';document.querySelector('#freshness').textContent='Certified rehearsal revision '+state.competition.revision+' · source time '+clock(state.competition.updatedAt);matchesNode.innerHTML=mine.slice(1).map(item=>'<article class="match"><time>'+clock(item.start)+'</time><div><strong>'+esc(item.title)+'</strong><small>'+esc(item.participantNames.join(' vs '))+'</small></div><span class="court">'+esc(item.court)+'</span></article>').join('')||'<div class="empty">'+(next?'No later confirmed matches yet.':'Your page will update when the next match is confirmed.')+'</div>'}
    find.addEventListener('click',()=>{const needle=input.value.trim().toLowerCase(),exact=state.participants.find(item=>item.displayName.toLowerCase()===needle),matches=state.participants.filter(item=>item.displayName.toLowerCase().includes(needle));if(exact||matches.length===1)choose(exact??matches[0]);else status.textContent=matches.length>1?'Be more specific — '+matches.length+' pairs match that search.':'No registered pair matched that name. Ask the desk to check the registration spelling.'});
    input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();find.click()}});notMe.addEventListener('click',()=>choose(null));
    share.addEventListener('click',async()=>{const data={title:'My next match',text:selected?'Live schedule for '+selected.displayName:'My live competition schedule',url:location.href};try{if(navigator.share)await navigator.share(data);else{await navigator.clipboard.writeText(location.href);status.textContent='Live page copied.'}}catch(error){if(error?.name!=='AbortError')status.textContent='Copy the browser address to share this live page.'}});
    async function load(){try{const response=await fetch('/api/participant-attention');if(!response.ok)throw Error();state=await response.json();document.querySelector('#pair-options').innerHTML=state.participants.map(item=>'<option value="'+esc(item.displayName)+'"></option>').join('');const params=new URLSearchParams(location.search),fromUrl=participantFromToken(params.get('token')),fromDevice=participantFromToken(localStorage.getItem(storageKey()));choose(fromUrl??fromDevice??null,false)}catch{status.textContent='The published schedule is temporarily unavailable. Use the venue display or ask the desk while connection is restored.'}}
    load();
  </script>
</body>
</html>`;
