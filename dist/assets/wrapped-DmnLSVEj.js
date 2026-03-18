import{g as v}from"./vendor-gsap-DDlvirwQ.js";import{h as T}from"./vendor-html2canvas-k0ITeQhV.js";import{e as $,b as y,g as x}from"./index-B_NIvw0H.js";import"./vendor-supabase-BZ0N5lZN.js";import"./vendor-dashjs-BUG1wcKy.js";const z="wrapped-container",M=["naolmideksa@gmail.com","naolmid.official@gmail.com"],a={green:"#1DB954",greenDk:"#1AA34A",black:"#191414",dark:"#121212",pink:"#E8115B",magenta:"#AF2896",orange:"#F49D37",blue:"#2D46B9",red:"#E22134",cream:"#F5F0E1",peach:"#FFCBA4",lavender:"#D4BBFF",white:"#FFFFFF"},_=[{bg:a.black,accent:a.green,text:a.white,pattern:"dots"},{bg:a.green,accent:a.black,text:a.black,pattern:"circles"},{bg:a.magenta,accent:a.lavender,text:a.white,pattern:"stripes"},{bg:a.pink,accent:a.cream,text:a.white,pattern:"squares"},{bg:a.dark,accent:a.green,text:a.white,pattern:"dots"},{bg:a.red,accent:a.white,text:a.white,pattern:"lines"},{bg:a.dark,accent:a.green,text:a.white,pattern:"stripes"},{bg:a.dark,accent:a.magenta,text:a.white,pattern:"squares"},{bg:a.green,accent:a.black,text:a.black,pattern:"scattered"},{bg:a.magenta,accent:a.lavender,text:a.white,pattern:"waves"},{bg:a.blue,accent:a.white,text:a.white,pattern:"lines"},{bg:a.orange,accent:a.black,text:a.black,pattern:"lines"},{bg:a.dark,accent:a.green,text:a.white,pattern:"lines"},{bg:"darkgrad",accent:a.green,text:a.white,pattern:"dots"}];let o=null,h=null,g=null,m={artists:{},tracks:{},albums:{},firstListen:null},f={},w=null,u=null;async function k(e,t={},r=12e3){const n=new AbortController,i=setTimeout(()=>n.abort(),r);try{const l=await fetch(e,{...t,signal:n.signal});let s={};try{s=await l.json()}catch{s={}}if(!l.ok){const c=s?.error||s?.message||`Request failed (${l.status})`;throw new Error(c)}return s}catch(l){throw l?.name==="AbortError"?new Error("Request timed out"):l}finally{clearTimeout(i)}}async function ne(e){g=e||null;const t=document.getElementById(z);if(!t)return;X(),t.innerHTML='<div class="wr-loading"><div class="wr-spinner"></div><p>Preparing your Wrapped…</p></div>',document.body.classList.add("wrapped-active");const r=document.getElementById("page-wrapped");r&&(u=new MutationObserver(()=>{(!r.classList.contains("active")||r.style.display==="none")&&(C(),u?.disconnect())}),u.observe(r,{attributes:!0,attributeFilter:["style","class"]}));try{const{data:{session:n}}=await $.auth.getSession(),i=n?.access_token;if(!i){t.innerHTML='<p class="wr-err">Please sign in to view your Wrapped.</p>';return}const[l,s]=await Promise.allSettled([k(y("/api/wrapped/compute"),{method:"POST",headers:{Authorization:`Bearer ${i}`,"Content-Type":"application/json"}},15e3),k(y("/api/wrapped/leaderboard"),{headers:{Authorization:`Bearer ${i}`}},12e3)]);if(l.status!=="fulfilled")throw l.reason instanceof Error?l.reason:new Error("Failed to load Wrapped data.");if(o=l.value||{},s.status==="fulfilled"?h=s.value?.leaderboard||[]:(h=[],console.warn("[Wrapped] Leaderboard unavailable:",s.reason)),o.error){t.innerHTML=`<p class="wr-err">${o.error}</p>`;return}if(Number(o.total_plays||0)===0){t.innerHTML=`<p class="wr-err">You don't have any listening data for this period yet.<br>Start listening!</p>`;return}await E(),S(t)}catch(n){console.error("[Wrapped]",n),t.innerHTML=`<p class="wr-err">Failed to load Wrapped.<br>${n.message}</p>`}}async function E(){if(m={artists:{},tracks:{},albums:{},firstListen:null},f={},!g)return;const e=[];for(const t of o.top_artists||[])e.push(g.searchArtists(t.name).then(r=>{const n=(r.items||[])[0];n?.picture&&(m.artists[t.name]=g.getArtistPictureUrl(n.picture,"750"))}).catch(()=>{}));for(const t of o.top_tracks||[]){const r=`${t.title}|||${t.artist}`;e.push(g.searchTracks(t.title).then(async n=>{const i=n.items||[],s=i.find(c=>c.title?.toLowerCase()===t.title.toLowerCase()&&(c.artist?.name?.toLowerCase()===t.artist.toLowerCase()||c.artists?.[0]?.name?.toLowerCase()===t.artist.toLowerCase()))||i[0];if(s?.album?.cover&&(m.tracks[r]=g.getCoverUrl(s.album.cover,"750"),s.album?.title&&s.album?.id))try{const b=(await g.getAlbum(s.album.id))?.tracks?.length||0;if(b>3){f[r]={title:s.album.title,artist:t.artist,cover:g.getCoverUrl(s.album.cover,"750"),trackCount:b};const L=`${s.album.title}|||${t.artist}`;m.albums[L]=g.getCoverUrl(s.album.cover,"750")}}catch(c){console.warn("[Wrapped] Failed to fetch album details:",c)}}).catch(()=>{}))}if(o.first_listen){const t=o.first_listen;e.push(g.searchTracks(t.track_title).then(r=>{const n=r.items||[],l=n.find(s=>s.title?.toLowerCase()===t.track_title.toLowerCase()&&(s.artist?.name?.toLowerCase()===t.artist_name.toLowerCase()||s.artists?.[0]?.name?.toLowerCase()===t.artist_name.toLowerCase()))||n[0];l?.album?.cover&&(m.firstListen=g.getCoverUrl(l.album.cover,"750"))}).catch(()=>{}))}await Promise.allSettled(e)}function S(e){e.innerHTML="";const t=d("div","wr-scroller");[q(),H(),U(),W(),P(),I(),N(),Y(),R(),O(),G(),K(),Z(),J()].forEach((l,s)=>{const c=_[s];l.classList.add("wr-section"),l.dataset.idx=s,c.bg==="darkgrad"?l.style.background="linear-gradient(180deg, #121212 0%, #191414 50%, #0d0d0d 100%)":l.style.backgroundColor=c.bg,l.style.color=c.text,c.text===a.black&&(l.dataset.theme="light"),c.pattern!=="none"&&(l.dataset.pattern=c.pattern),t.appendChild(l)});const n=d("div","wr-close","&times;");n.addEventListener("click",()=>{C(),window.history.back()});const i=d("div","wr-share-fab");i.innerHTML='<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>',i.addEventListener("click",B),e.appendChild(t),e.appendChild(n),e.appendChild(i),A(t)}function A(e){w&&w.disconnect(),w=new IntersectionObserver(t=>{t.forEach(r=>{r.isIntersecting&&(j(r.target),w.unobserve(r.target))})},{root:e,threshold:.25}),e.querySelectorAll(".wr-section").forEach(t=>w.observe(t))}function j(e){const t=e.querySelectorAll(".wr-anim");t.length&&v.fromTo(t,{opacity:0,y:50},{opacity:1,y:0,duration:.7,stagger:.12,ease:"power3.out",delay:.1}),e.querySelectorAll("[data-countup]").forEach(r=>{const n=parseInt(r.dataset.countup,10),i={val:0};v.to(i,{val:n,duration:2,ease:"power2.out",delay:.4,onUpdate:()=>{r.textContent=Math.round(i.val).toLocaleString()}})}),e.querySelectorAll(".wr-img-reveal").forEach(r=>{v.fromTo(r,{opacity:0,scale:1.08},{opacity:.55,scale:1,duration:1.5,ease:"power2.out",delay:.15})}),e.classList.contains("wr-confetti-trigger")&&F(e)}function D(){w&&(w.disconnect(),w=null),u&&(u.disconnect(),u=null),document.body.classList.remove("wrapped-active")}function C(){D()}function F(e){const t=[a.green,a.pink,a.orange,a.magenta,a.lavender,a.white,a.peach,"#FFD700"];for(let r=0;r<100;r++){const n=document.createElement("div");n.className="wr-confetti-dot";const i=Math.random()*10+4;n.style.cssText=`background:${t[r%t.length]};left:${Math.random()*100}%;width:${i}px;height:${i}px;border-radius:${Math.random()>.5?"50%":"2px"}`,e.appendChild(n),v.fromTo(n,{y:-30,x:(Math.random()-.5)*80,opacity:1,scale:Math.random()*.5+.7,rotation:0},{y:e.offsetHeight+40,x:`+=${(Math.random()-.5)*200}`,rotation:Math.random()*720,opacity:0,duration:3+Math.random()*2,delay:Math.random()*1,ease:"power1.in",onComplete:()=>n.remove()})}}async function B(){const e=document.createElement("div");e.className="wr-share-card";const t=o.top_artists?.[0],r=o.top_tracks?.[0],n=o.top_genres?.[0];e.innerHTML=`
    <div class="wr-sc-bg"></div>
    <div class="wr-sc-content">
      <div class="wr-sc-logo">TUNES WRAPPED</div>
      <div class="wr-sc-year">${p(o.year_label)}</div>
      <div class="wr-sc-avatar"><img src="${x(o.user_avatar_seed)}" alt=""></div>
      <div class="wr-sc-name">${p(o.user_name)}</div>
      <div class="wr-sc-stats">
        <div class="wr-sc-stat"><span class="wr-sc-num">${o.total_plays}</span><span class="wr-sc-label">plays</span></div>
        <div class="wr-sc-stat"><span class="wr-sc-num">${o.total_minutes}</span><span class="wr-sc-label">minutes</span></div>
      </div>
      ${t?`<div class="wr-sc-row"><span class="wr-sc-tag">Top Artist</span><span class="wr-sc-val">${p(t.name)}</span></div>`:""}
      ${r?`<div class="wr-sc-row"><span class="wr-sc-tag">Top Song</span><span class="wr-sc-val">${p(r.title)}</span></div>`:""}
      ${n?`<div class="wr-sc-row"><span class="wr-sc-tag">Top Genre</span><span class="wr-sc-val">${p(n.genre)}</span></div>`:""}
    </div>
  `,e.style.cssText="position:fixed;top:-9999px;left:-9999px;width:400px;height:520px;z-index:-1",document.body.appendChild(e);try{const i=await T(e,{backgroundColor:null,scale:2,useCORS:!0}),l=await new Promise(c=>i.toBlob(c,"image/png")),s=new File([l],`tunes-wrapped-${o.year_label}.png`,{type:"image/png"});if(navigator.share&&navigator.canShare?.({files:[s]}))await navigator.share({title:`My Tunes ${o.year_label} Wrapped`,files:[s]});else{const c=URL.createObjectURL(l),b=document.createElement("a");b.href=c,b.download=s.name,b.click(),URL.revokeObjectURL(c)}}catch(i){console.warn("[Wrapped] Share error:",i)}e.remove()}function d(e,t,r){const n=document.createElement(e);return t&&(n.className=t),r&&(n.innerHTML=r),n}function p(e){return String(e||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function q(){const e=d("div","wr-center");return e.innerHTML=`
    <div class="wr-anim wr-logo-text">#WRAPPED</div>
    <div class="wr-anim wr-year-big">${p(o.year_label)}</div>
    <div class="wr-anim" style="margin:2rem 0">
      <div class="wr-avatar-ring-sp">
        <img src="${x(o.user_avatar_seed)}" class="wr-avatar-img" alt="">
      </div>
    </div>
    <div class="wr-anim wr-username">${p(o.user_name)}</div>
    <div class="wr-anim wr-scroll-hint">
      <span>Scroll to begin</span>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="6 9 12 15 18 9"/></svg>
    </div>
  `,e}function H(){const e=d("div","wr-center");return e.innerHTML=`
    <div class="wr-anim wr-section-label">You pressed play</div>
    <div class="wr-anim wr-mega-num" data-countup="${o.total_plays}">0</div>
    <div class="wr-anim wr-section-label">times this year</div>
    <div class="wr-anim wr-stat-pill" style="margin-top:2rem">
      That's about <strong>${Math.round(o.total_plays/12)}</strong> songs per month
    </div>
  `,e}function U(){const e=Math.round(o.total_minutes/60),t=e>24?`That's ${Math.round(e/24)} full days of music`:e>1?`That's ${e} hours of pure vibes`:"Just getting started!",r=d("div","wr-center");return r.innerHTML=`
    <div class="wr-anim wr-section-label">You listened for</div>
    <div class="wr-anim wr-mega-num" data-countup="${o.total_minutes}">0</div>
    <div class="wr-anim wr-section-label">minutes</div>
    <div class="wr-anim wr-stat-pill" style="margin-top:2rem">${t}</div>
  `,r}function W(){const e=d("div","wr-center");return e.innerHTML=`
    <div class="wr-anim wr-section-label">You explored</div>
    <div class="wr-anim wr-stats-row">
      <div class="wr-stat-block">
        <div class="wr-stat-big" data-countup="${o.unique_tracks}">0</div>
        <div class="wr-stat-tag">tracks</div>
      </div>
      <div class="wr-stat-block">
        <div class="wr-stat-big" data-countup="${o.unique_artists}">0</div>
        <div class="wr-stat-tag">artists</div>
      </div>
    </div>
    <div class="wr-anim wr-section-label" style="margin-top:1.5rem;opacity:0.45">That's a lot of exploring</div>
  `,e}function P(){const e=o.first_listen;if(!e)return d("div","wr-center",'<div class="wr-anim wr-section-label">Your first song awaits…</div>');const t=new Date(e.listened_at).toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"}),r=m.firstListen||"",n=d("div","wr-center");return n.innerHTML=`
    ${r?`<img class="wr-hero-bg wr-img-reveal" src="${r}" alt="" onerror="this.style.display='none'">`:""}
    <div class="wr-hero-color-overlay" style="background:linear-gradient(to top,rgba(18,18,18,0.95) 0%,rgba(29,185,84,0.3) 50%,rgba(18,18,18,0.7) 100%)"></div>
    <div class="wr-anim wr-section-label">Your year started with</div>
    <div class="wr-anim wr-track-name">${p(e.track_title)}</div>
    <div class="wr-anim wr-artist-sub">${p(e.artist_name)}</div>
    <div class="wr-anim wr-date-pill">${t}</div>
  `,n}function I(){const e=o.top_genres?.[0];if(!e)return d("div","wr-center",'<div class="wr-anim wr-section-label">No genre data yet</div>');const t=d("div","wr-center"),r=(o.top_genres||[]).slice(0,3).map(n=>{const i=o.top_genres[0]?.plays||1,l=Math.max(10,Math.round(n.plays/i*100));return`<div class="wr-genre-bar wr-anim">
      <div class="wr-genre-bar-info"><span class="wr-genre-bar-name">${p(n.genre)}</span><span class="wr-genre-bar-plays">${n.plays}</span></div>
      <div class="wr-genre-bar-track"><div class="wr-genre-bar-fill" style="width:${l}%"></div></div>
    </div>`}).join("");return t.innerHTML=`
    <div class="wr-anim wr-section-label-small">Your top genre was</div>
    <div class="wr-anim wr-genre-name-big">${p(e.genre)}</div>
    <div class="wr-anim wr-play-count">${e.plays} plays</div>
    ${r?`<div class="wr-anim wr-genre-bars">${r}</div>`:""}
  `,t}function N(){const e=o.top_artists?.[0];if(!e)return d("div","wr-center",'<div class="wr-anim wr-section-label">No artist data yet</div>');const t=m.artists[e.name]||"",r=d("div","wr-center");return r.innerHTML=`
    ${t?`<img class="wr-hero-bg wr-img-reveal" src="${t}" alt="" onerror="this.style.display='none'">`:""}
    <div class="wr-hero-color-overlay" style="background:linear-gradient(to top,rgba(18,18,18,0.92) 0%,rgba(29,185,84,0.12) 45%,rgba(18,18,18,0.5) 100%)"></div>
    <div class="wr-anim wr-section-label">Your #1 artist</div>
    <div class="wr-anim wr-artist-hero">${p(e.name)}</div>
    <div class="wr-anim wr-play-count" style="color:${a.green}">${e.plays} plays</div>
  `,r}function Y(){const e=o.top_tracks?.[0];if(!e)return d("div","wr-center",'<div class="wr-anim wr-section-label">No track data yet</div>');const t=`${e.title}|||${e.artist}`,r=m.tracks[t]||"",n=d("div","wr-center");return n.innerHTML=`
    ${r?`<img class="wr-hero-bg wr-img-reveal" src="${r}" alt="" onerror="this.style.display='none'">`:""}
    <div class="wr-hero-color-overlay" style="background:linear-gradient(to top,rgba(18,18,18,0.95) 0%,rgba(175,40,150,0.3) 45%,rgba(18,18,18,0.7) 100%)"></div>
    <div class="wr-anim wr-section-label">Your #1 song</div>
    <div class="wr-anim wr-track-name">${p(e.title)}</div>
    <div class="wr-anim wr-artist-sub">${p(e.artist)}</div>
    <div class="wr-anim wr-play-count" style="color:${a.magenta}">${e.plays} plays</div>
  `,n}function R(){const e=d("div","wr-center");return e.innerHTML=`
    <div class="wr-anim wr-section-label">Your milestones</div>
    <div class="wr-anim wr-stats-row">
      <div class="wr-stat-block">
        <div class="wr-stat-big" data-countup="${o.longest_streak}">0</div>
        <div class="wr-stat-tag">day streak</div>
      </div>
      <div class="wr-stat-block">
        <div class="wr-stat-big" data-countup="${o.new_artists_discovered}">0</div>
        <div class="wr-stat-tag">new artists</div>
      </div>
    </div>
    <div class="wr-anim wr-sub" style="margin-top:1.5rem;opacity:0.5">That's some serious exploring</div>
  `,e}function O(){const e=o.personality||{},t=d("div","wr-center");return t.innerHTML=`
    <div class="wr-anim" style="font-size:4rem;margin-bottom:0.5rem">${e.emoji||"🔥"}</div>
    <div class="wr-anim wr-section-label">Your listening personality</div>
    <div class="wr-anim wr-personality-name">${p(e.name||"The Listener")}</div>
    <div class="wr-anim wr-personality-desc">${p(e.description||"")}</div>
  `,t}function G(){const e=(o.top_artists||[]).slice(0,5);if(!e.length)return d("div","wr-center",'<div class="wr-anim wr-section-label">No artist data yet</div>');const t=d("div","wr-center"),r=e.map((n,i)=>{const l=m.artists[n.name]||"";return`
      <div class="wr-top5-item wr-anim">
        <div class="wr-top5-rank">${i+1}</div>
        ${l?`<img src="${l}" class="wr-top5-img" alt="" onerror="this.style.display='none'">`:'<div class="wr-top5-img-placeholder"></div>'}
        <div class="wr-top5-info">
          <div class="wr-top5-name">${p(n.name)}</div>
          <div class="wr-top5-plays">${n.plays} plays</div>
        </div>
      </div>
    `}).join("");return t.innerHTML=`
    <div class="wr-anim wr-section-label">Your top 5 artists</div>
    <div class="wr-top5-list">${r}</div>
  `,t}function K(){const e={};(o.top_tracks||[]).forEach(i=>{const l=`${i.title}|||${i.artist}`,s=f[l];if(!s||!s.title)return;const c=`${s.title}|||${s.artist}`;e[c]||(e[c]={name:s.title,artist:s.artist,cover:s.cover,plays:0,tracks:[]}),e[c].plays+=i.plays,e[c].tracks.push(i)});const t=Object.values(e).sort((i,l)=>l.plays-i.plays).slice(0,5);if(!t.length)return d("div","wr-center",'<div class="wr-anim wr-section-label">No album data yet</div>');const r=d("div","wr-center"),n=t.map((i,l)=>{const s=i.cover||"";return`
      <div class="wr-top5-item wr-anim">
        <div class="wr-top5-rank">${l+1}</div>
        ${s?`<img src="${s}" class="wr-top5-img" alt="" onerror="this.style.display='none'">`:'<div class="wr-top5-img-placeholder"></div>'}
        <div class="wr-top5-info">
          <div class="wr-top5-name">${p(i.name)}</div>
          <div class="wr-top5-artist">${p(i.artist)}</div>
          <div class="wr-top5-plays">${i.plays} plays</div>
        </div>
      </div>
    `}).join("");return r.innerHTML=`
    <div class="wr-anim wr-section-label">Your top 5 albums</div>
    <div class="wr-top5-list">${n}</div>
  `,r}function Z(){const e=(h||[]).slice(0,10).map((r,n)=>{const i=Number.isFinite(Number(r?.rank))?Number(r.rank):n+1,l=Number.isFinite(Number(r?.total_minutes))?Number(r.total_minutes):0,s=p(r?.display_name||"Listener"),c=x(r?.avatar_seed||"listener");return`
    <div class="wr-lb-row wr-anim">
      <span class="wr-lb-rank" style="${n<3?`color:${[a.orange,"#C0C0C0","#CD7F32"][n]}`:""}">#${i}</span>
      <img src="${c}" class="wr-lb-avatar" alt="">
      <span class="wr-lb-name">${s}</span>
      <span class="wr-lb-stat">${l.toLocaleString()} min</span>
    </div>
  `}).join(""),t=d("div","");return t.innerHTML=`
    <div class="wr-anim wr-section-label" style="text-align:center;margin-bottom:1.5rem">👑 Top Listeners</div>
    <div class="wr-lb-list">${e||'<div style="text-align:center;opacity:0.4">No data yet</div>'}</div>
    ${o.user_rank?`<div class="wr-anim" style="text-align:center;margin-top:1.5rem;font-size:0.9rem;opacity:0.6">You're <strong style="color:${a.green}">#${o.user_rank}</strong> out of ${o.total_app_users} listeners</div>`:""}
  `,t}function J(){const e=d("div","wr-center wr-confetti-trigger");let t="";return $?.auth.getSession().then(({data:{session:r}})=>{if(r?.user?.id){t=r.user.id;const n=e.querySelector(".wr-share-link");n&&(n.href=`${window.location.origin}/wrapped/share/${t}`)}}),e.innerHTML=`
    <div class="wr-anim wr-outro-title">That's a wrap!</div>
    <div class="wr-anim" style="font-size:1rem;opacity:0.6;margin:0.5rem 0;font-weight:500">${p(o.year_label)} · Tunes Wrapped</div>
    <div class="wr-anim" style="margin-top:2.5rem;display:flex;gap:0.8rem;flex-direction:column;align-items:center">
      <button class="wr-btn-sp wr-btn-sp-primary" onclick="document.querySelector('.wr-share-fab')?.click()">Share as Image</button>
      <button class="wr-btn-sp wr-btn-sp-ghost" onclick="window.history.back()">Done</button>
    </div>
  `,e}function ie(){return V(),`
    <div class="wrb-sp" data-navigate="/wrapped">
      <div class="wrb-sp-content">
        <div class="wrb-sp-tag">#WRAPPED</div>
        <div class="wrb-sp-title">Your 2025/26 Wrapped is here</div>
        <div class="wrb-sp-sub">See your year in music →</div>
      </div>
      <div class="wrb-sp-eq">
        <span></span><span></span><span></span><span></span><span></span>
      </div>
    </div>
  `}function V(){if(document.getElementById("wrb-sp-styles"))return;const e=document.createElement("style");e.id="wrb-sp-styles",e.textContent=`
.wrb-sp{position:relative;width:100%;border-radius:1.5rem;overflow:hidden;cursor:pointer;margin-bottom:1rem;background-color:rgba(9,9,11,0.65);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border:1px solid rgba(168,85,247,0.25);box-shadow:0 0 18px rgba(168,85,247,0.15),0 20px 50px rgba(0,0,0,0.5);padding:1.2rem 1.4rem;box-sizing:border-box;transition:transform 0.25s cubic-bezier(.22,1,.36,1),box-shadow 0.25s;display:flex;align-items:center;justify-content:space-between}
.wrb-sp:hover{transform:translateY(-2px) scale(1.01);box-shadow:0 0 28px rgba(168,85,247,0.25),0 20px 50px rgba(0,0,0,0.5)}
.wrb-sp:active{transform:scale(0.98)}
.wrb-sp-content{position:relative;z-index:1;display:flex;flex-direction:column;gap:0.1rem}
.wrb-sp-tag{font-size:0.65rem;font-weight:800;letter-spacing:-0.04em;color:rgba(168,85,247,0.8)}
.wrb-sp-title{font-size:1.25rem;font-weight:800;letter-spacing:-0.04em;color:#fff;line-height:1.3;margin-top:0.3rem}
.wrb-sp-sub{font-size:0.8rem;font-weight:400;letter-spacing:-0.04em;color:rgba(255,255,255,0.45);margin-top:0.2rem}
.wrb-sp-eq{display:flex;align-items:flex-end;gap:3px;height:40px;position:relative;z-index:1}
.wrb-sp-eq span{display:block;width:4px;border-radius:2px;background:rgba(168,85,247,0.7);animation:wrb-sp-eq 1s ease-in-out infinite alternate}
.wrb-sp-eq span:nth-child(1){height:40%;animation-delay:0s}
.wrb-sp-eq span:nth-child(2){height:75%;animation-delay:0.15s}
.wrb-sp-eq span:nth-child(3){height:50%;animation-delay:0.3s}
.wrb-sp-eq span:nth-child(4){height:90%;animation-delay:0.1s}
.wrb-sp-eq span:nth-child(5){height:60%;animation-delay:0.25s}
@keyframes wrb-sp-eq{0%{transform:scaleY(0.3);opacity:0.5}100%{transform:scaleY(1);opacity:1}}
  `,document.head.appendChild(e)}function se(e=!1,t=""){const r=new Date,n=r.getMonth(),i=r.getDate();return(e||t&&M.includes(t.toLowerCase()))&&n===1&&i>=12&&i<=20?!0:n!==8?!1:e?i>=4&&i<=14:i>=7&&i<=14}function X(){if(document.getElementById("wr-styles"))return;const e=document.createElement("style");e.id="wr-styles",e.textContent=`
/* ═══ Fullscreen takeover ═══ */
body.wrapped-active .now-playing-bar{display:none!important}
body.wrapped-active .bottom-nav{display:none!important}
body.wrapped-active .main-header{display:none!important}
body.wrapped-active #mobile-tab-bar,body.wrapped-active .mobile-tab-bar{display:none!important}
body.wrapped-active .main-content{padding:0!important;margin:0!important;height:100vh!important;max-height:100vh!important;overflow:hidden!important}
body.wrapped-active #page-wrapped{position:fixed!important;inset:0!important;z-index:999!important;padding:0!important;margin:0!important}

/* ═══ Base ═══ */
#${z}{position:relative;width:100%;height:100vh;overflow:hidden;font-family:Montserrat,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
.wr-loading{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;color:#fff;gap:1rem;background:${a.black};font-family:Montserrat,sans-serif}
.wr-loading p{font-size:0.85rem;opacity:0.5;font-weight:500}
.wr-spinner{width:44px;height:44px;border:3px solid rgba(29,185,84,0.15);border-top-color:${a.green};border-radius:50%;animation:wrspin 0.7s linear infinite}
@keyframes wrspin{to{transform:rotate(360deg)}}
.wr-err{color:rgba(255,255,255,0.5);text-align:center;padding:3rem 1.5rem;font-size:0.95rem;line-height:1.6;background:${a.black};min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:Montserrat,sans-serif}

/* ═══ Scroll Container ═══ */
.wr-scroller{width:100%;height:100%;overflow-y:auto;scroll-snap-type:y mandatory;-webkit-overflow-scrolling:touch}

/* ═══ Sections ═══ */
.wr-section{position:relative;min-height:100vh;width:100%;scroll-snap-align:start;display:flex;flex-direction:column;justify-content:center;padding:3rem 2rem;box-sizing:border-box;overflow:hidden;font-family:Montserrat,sans-serif;isolation:isolate}
.wr-center{align-items:center;text-align:center}

/* ═══ Content z-index (above patterns & images) ═══ */
.wr-anim{position:relative;z-index:1}
.wr-lb-list{position:relative;z-index:1}

/* ═══ Decorative Patterns (fine grain, visible) ═══ */
[data-pattern="dots"]::before{content:'';position:absolute;inset:0;background:radial-gradient(circle,rgba(255,255,255,0.28) 1px,transparent 1px);background-size:14px 14px;pointer-events:none;z-index:0}
[data-pattern="circles"]::before{content:'';position:absolute;top:-20%;right:-15%;width:60vw;height:60vw;border-radius:50%;border:3px solid rgba(0,0,0,0.28);pointer-events:none;z-index:0}
[data-pattern="circles"]::after{content:'';position:absolute;bottom:-25%;left:-20%;width:45vw;height:45vw;border-radius:50%;border:3px solid rgba(0,0,0,0.22);pointer-events:none;z-index:0}
[data-pattern="stripes"]::before{content:'';position:absolute;inset:0;background:repeating-linear-gradient(135deg,transparent,transparent 14px,rgba(255,255,255,0.18) 14px,rgba(255,255,255,0.18) 16px);pointer-events:none;z-index:0}
[data-pattern="squares"]::before{content:'';position:absolute;inset:0;background:linear-gradient(rgba(255,255,255,0.18) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.18) 1px,transparent 1px);background-size:22px 22px;pointer-events:none;z-index:0}
[data-pattern="waves"]::before{content:'';position:absolute;bottom:0;left:0;right:0;height:160px;background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1440 120'%3E%3Cpath fill='rgba(0,0,0,0.18)' d='M0,40 C360,120 720,0 1080,80 C1260,110 1380,60 1440,40 L1440,120 L0,120Z'/%3E%3C/svg%3E");background-size:cover;pointer-events:none;z-index:0}
[data-pattern="lines"]::before{content:'';position:absolute;inset:0;background:repeating-linear-gradient(0deg,transparent,transparent 18px,rgba(255,255,255,0.08) 18px,rgba(255,255,255,0.08) 19px);pointer-events:none;z-index:0}
[data-pattern="scattered"]::before{content:'';position:absolute;inset:0;background:radial-gradient(circle 4px at 10% 12%,rgba(0,0,0,0.3) 100%,transparent 100%),radial-gradient(circle 3px at 30% 45%,rgba(0,0,0,0.25) 100%,transparent 100%),radial-gradient(circle 5px at 55% 20%,rgba(0,0,0,0.28) 100%,transparent 100%),radial-gradient(circle 3px at 75% 65%,rgba(0,0,0,0.22) 100%,transparent 100%),radial-gradient(circle 4px at 45% 80%,rgba(0,0,0,0.25) 100%,transparent 100%),radial-gradient(circle 3.5px at 85% 35%,rgba(0,0,0,0.26) 100%,transparent 100%),radial-gradient(circle 3px at 20% 70%,rgba(0,0,0,0.2) 100%,transparent 100%),radial-gradient(circle 4px at 65% 90%,rgba(0,0,0,0.24) 100%,transparent 100%),radial-gradient(circle 2.5px at 5% 55%,rgba(0,0,0,0.18) 100%,transparent 100%),radial-gradient(circle 3px at 92% 80%,rgba(0,0,0,0.2) 100%,transparent 100%),radial-gradient(circle 4px at 40% 30%,rgba(0,0,0,0.15) 100%,transparent 100%),radial-gradient(circle 2px at 68% 50%,rgba(0,0,0,0.17) 100%,transparent 100%);pointer-events:none;z-index:0}
[data-pattern="waves"]::before{content:'';position:absolute;bottom:0;left:0;right:0;height:160px;background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1440 120'%3E%3Cpath fill='rgba(255,255,255,0.18)' d='M0,40 C360,120 720,0 1080,80 C1260,110 1380,60 1440,40 L1440,120 L0,120Z'/%3E%3C/svg%3E");background-size:cover;pointer-events:none;z-index:0}
[data-pattern="waves"]::after{content:'';position:absolute;top:0;left:0;right:0;height:160px;background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1440 120'%3E%3Cpath fill='rgba(255,255,255,0.12)' d='M0,80 C360,0 720,120 1080,40 C1260,10 1380,60 1440,80 L1440,0 L0,0Z'/%3E%3C/svg%3E");background-size:cover;pointer-events:none;z-index:0}

/* Light-theme pattern overrides (dark colors on light bg) */
[data-theme="light"][data-pattern="dots"]::before{background:radial-gradient(circle,rgba(0,0,0,0.2) 1px,transparent 1px);background-size:14px 14px}
[data-theme="light"][data-pattern="stripes"]::before{background:repeating-linear-gradient(135deg,transparent,transparent 14px,rgba(0,0,0,0.16) 14px,rgba(0,0,0,0.16) 16px)}
[data-theme="light"][data-pattern="squares"]::before{background:linear-gradient(rgba(0,0,0,0.15) 1px,transparent 1px),linear-gradient(90deg,rgba(0,0,0,0.15) 1px,transparent 1px);background-size:22px 22px}
[data-theme="light"][data-pattern="lines"]::before{background:repeating-linear-gradient(0deg,transparent,transparent 18px,rgba(0,0,0,0.07) 18px,rgba(0,0,0,0.07) 19px)}
[data-theme="light"][data-pattern="scattered"]::before{background:radial-gradient(circle 4px at 10% 12%,rgba(0,0,0,0.3) 100%,transparent 100%),radial-gradient(circle 3px at 30% 45%,rgba(0,0,0,0.25) 100%,transparent 100%),radial-gradient(circle 5px at 55% 20%,rgba(0,0,0,0.28) 100%,transparent 100%),radial-gradient(circle 3px at 75% 65%,rgba(0,0,0,0.22) 100%,transparent 100%),radial-gradient(circle 4px at 45% 80%,rgba(0,0,0,0.25) 100%,transparent 100%),radial-gradient(circle 3.5px at 85% 35%,rgba(0,0,0,0.26) 100%,transparent 100%),radial-gradient(circle 3px at 20% 70%,rgba(0,0,0,0.2) 100%,transparent 100%),radial-gradient(circle 4px at 65% 90%,rgba(0,0,0,0.24) 100%,transparent 100%),radial-gradient(circle 2.5px at 5% 55%,rgba(0,0,0,0.18) 100%,transparent 100%),radial-gradient(circle 3px at 92% 80%,rgba(0,0,0,0.2) 100%,transparent 100%),radial-gradient(circle 4px at 40% 30%,rgba(0,0,0,0.15) 100%,transparent 100%),radial-gradient(circle 2px at 68% 50%,rgba(0,0,0,0.17) 100%,transparent 100%)}
/* Red background with lighter lines pattern */
[style*="background-color: rgb(226, 33, 52)"][data-pattern="lines"]::before{background:repeating-linear-gradient(0deg,transparent,transparent 18px,rgba(255,255,255,0.12) 18px,rgba(255,255,255,0.12) 19px)}

/* ═══ Close & Share (fixed) ═══ */
.wr-close{position:fixed;top:16px;right:16px;width:38px;height:38px;display:flex;align-items:center;justify-content:center;font-size:1.5rem;color:rgba(255,255,255,0.7);cursor:pointer;z-index:1000;border-radius:50%;background:rgba(0,0,0,0.4);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);transition:all 0.2s}
.wr-close:hover{color:#fff;background:rgba(0,0,0,0.6)}
.wr-share-fab{position:fixed;bottom:24px;right:20px;width:50px;height:50px;display:flex;align-items:center;justify-content:center;color:#fff;cursor:pointer;z-index:1001;border-radius:50%;background:${a.green};box-shadow:0 4px 20px rgba(29,185,84,0.4);transition:all 0.2s}
.wr-share-fab:hover{transform:scale(1.08);box-shadow:0 6px 28px rgba(29,185,84,0.5)}
.wr-share-fab:active{transform:scale(0.95)}

/* ═══ Typography ═══ */
.wr-logo-text{font-size:0.85rem;font-weight:900;letter-spacing:0.25em;opacity:0.5;text-transform:uppercase}
.wr-year-big{font-size:clamp(3.5rem,12vw,6rem);font-weight:900;line-height:1;margin:0.5rem 0;color:${a.green};text-shadow:0 0 60px rgba(29,185,84,0.25)}
.wr-username{font-size:1.2rem;font-weight:500;opacity:0.6}
.wr-scroll-hint{display:flex;flex-direction:column;align-items:center;gap:0.3rem;font-size:0.8rem;font-weight:500;opacity:0.3;margin-top:3rem;animation:wr-bounce 2s ease-in-out infinite}
@keyframes wr-bounce{0%,100%{transform:translateY(0)}50%{transform:translateY(8px)}}
.wr-section-label{font-size:clamp(0.85rem,2.5vw,1.05rem);font-weight:500;text-transform:uppercase;letter-spacing:0.12em;opacity:0.65}
.wr-section-label-small{font-size:clamp(0.65rem,2vw,0.85rem);font-weight:500;text-transform:uppercase;letter-spacing:0.12em;opacity:0.5;margin-bottom:0.5rem}
.wr-mega-num{font-size:clamp(7rem,28vw,14rem);font-weight:900;line-height:0.85;margin:0.3rem 0;letter-spacing:-0.04em}
.wr-stat-pill{font-size:0.9rem;font-weight:500;opacity:0.6;padding:0.6rem 1.4rem;border-radius:50px;background:rgba(255,255,255,0.1)}

/* ═══ Stats Row ═══ */
.wr-stats-row{display:flex;gap:2rem;margin:1.5rem 0;justify-content:center;flex-wrap:wrap;position:relative;z-index:1}
.wr-stat-block{text-align:center}
.wr-stat-big{font-size:clamp(5rem,18vw,9rem);font-weight:900;line-height:0.9;letter-spacing:-0.03em}
.wr-stat-tag{font-size:0.85rem;font-weight:500;text-transform:uppercase;letter-spacing:0.15em;opacity:0.55;margin-top:0.3rem}

/* ═══ Full-bleed images ═══ */
.wr-hero-bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center 20%;z-index:0;opacity:0}
.wr-hero-color-overlay{position:absolute;inset:0;z-index:0}

/* ═══ Track / Artist names ═══ */
.wr-track-name{font-size:clamp(2rem,7vw,3.5rem);font-weight:900;line-height:1.1;margin:0.5rem 0}
.wr-artist-sub{font-size:clamp(1rem,3.5vw,1.5rem);font-weight:500;opacity:0.6}
.wr-artist-hero{font-size:clamp(2.5rem,9vw,5rem);font-weight:900;line-height:1;margin:0.5rem 0}
.wr-genre-name{font-size:clamp(3.5rem,14vw,7.5rem);font-weight:900;line-height:1;margin:0.5rem 0;text-transform:capitalize}
.wr-genre-name-big{font-size:clamp(5rem,18vw,9rem);font-weight:900;line-height:1;margin:0.8rem 0;text-transform:capitalize}
.wr-play-count{font-size:0.8rem;font-weight:400;opacity:0.4;margin-top:0.5rem;letter-spacing:0.05em}
.wr-date-pill{font-size:0.85rem;font-weight:500;opacity:0.45;margin-top:1.2rem;padding:0.5rem 1.2rem;border-radius:50px;background:rgba(255,255,255,0.08)}

/* ═══ Genre Bars ═══ */
.wr-genre-bars{width:100%;max-width:260px;margin-top:1.8rem}
.wr-genre-bar{margin-bottom:0.7rem}
.wr-genre-bar-info{display:flex;justify-content:space-between;font-size:0.7rem;font-weight:500;margin-bottom:0.25rem;opacity:0.7}
.wr-genre-bar-name{text-transform:capitalize}
.wr-genre-bar-plays{opacity:0.5}
.wr-genre-bar-track{height:4px;border-radius:2px;background:rgba(0,0,0,0.12);overflow:hidden}
.wr-genre-bar-fill{height:100%;border-radius:2px;background:currentColor;opacity:0.5;transition:width 1.5s ease-out}

/* ═══ Personality ═══ */
.wr-personality-name{font-size:clamp(2.2rem,8vw,3.5rem);font-weight:900;line-height:1.15;margin:0.5rem 0;color:${a.lavender}}
.wr-personality-desc{font-size:0.9rem;font-weight:500;opacity:0.55;line-height:1.7;max-width:320px;margin-top:1rem;position:relative;z-index:1}

/* ═══ Outro ═══ */
.wr-outro-title{font-size:clamp(2.5rem,8vw,4rem);font-weight:900;line-height:1.1}

/* ═══ Avatar ═══ */
.wr-avatar-ring-sp{width:88px;height:88px;border-radius:50%;padding:3px;background:${a.green}}
.wr-avatar-img{width:100%;height:100%;border-radius:50%;object-fit:cover;display:block}

/* ═══ Top 5 Artists & Albums ═══ */
.wr-top5-list{display:flex;flex-direction:column;gap:0.8rem;width:100%;max-width:360px;margin-top:2rem}
.wr-top5-item{display:flex;align-items:center;gap:1rem;padding:0.8rem;background:rgba(255,255,255,0.08);border-radius:16px;transition:all 0.3s;backdrop-filter:blur(8px)}
.wr-top5-item:hover{background:rgba(255,255,255,0.12);transform:translateX(4px)}
.wr-top5-rank{font-size:1.8rem;font-weight:900;min-width:40px;opacity:0.4;text-align:center}
.wr-top5-img{width:64px;height:64px;border-radius:12px;object-fit:cover;box-shadow:0 4px 12px rgba(0,0,0,0.3)}
.wr-top5-img-placeholder{width:64px;height:64px;border-radius:12px;background:rgba(255,255,255,0.1)}
.wr-top5-info{flex:1;display:flex;flex-direction:column;gap:0.2rem}
.wr-top5-name{font-size:1.1rem;font-weight:700;line-height:1.2}
.wr-top5-artist{font-size:0.85rem;font-weight:500;opacity:0.6}
.wr-top5-plays{font-size:0.75rem;font-weight:500;opacity:0.4;margin-top:0.2rem}

/* ═══ Leaderboard ═══ */
.wr-lb-list{display:flex;flex-direction:column;gap:0.5rem;padding:0 0.5rem;max-height:55vh;overflow-y:auto}
.wr-lb-row{display:flex;align-items:center;gap:0.7rem;padding:0.7rem 1rem;background:rgba(255,255,255,0.05);border-radius:12px;transition:background 0.2s}
.wr-lb-row:hover{background:rgba(255,255,255,0.08)}
.wr-lb-rank{font-weight:900;font-size:0.9rem;min-width:30px}
.wr-lb-avatar{width:34px;height:34px;border-radius:50%}
.wr-lb-name{flex:1;font-size:0.9rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wr-lb-stat{font-size:0.75rem;font-weight:500;opacity:0.4}

/* ═══ Buttons ═══ */
.wr-btn-sp{display:inline-block;padding:0.8rem 2.2rem;border-radius:50px;font-size:0.9rem;font-weight:700;cursor:pointer;border:none;text-decoration:none;text-align:center;font-family:Montserrat,sans-serif;transition:all 0.2s;color:#fff}
.wr-btn-sp-primary{background:${a.green};color:${a.black}}
.wr-btn-sp-primary:hover{background:${a.greenDk};transform:scale(1.03)}
.wr-btn-sp-outline{background:transparent;border:2px solid rgba(255,255,255,0.3)}
.wr-btn-sp-outline:hover{border-color:rgba(255,255,255,0.6)}
.wr-btn-sp-ghost{background:transparent;color:rgba(255,255,255,0.5)}
.wr-btn-sp-ghost:hover{color:rgba(255,255,255,0.8)}

/* ═══ Confetti ═══ */
.wr-confetti-dot{position:absolute;top:0;pointer-events:none;z-index:2}

/* ═══ Share Card ═══ */
.wr-share-card{font-family:Montserrat,sans-serif;color:#fff;overflow:hidden;border-radius:20px}
.wr-sc-bg{position:absolute;inset:0;background:linear-gradient(135deg,${a.green} 0%,${a.magenta} 100%)}
.wr-sc-content{position:relative;z-index:1;padding:2rem;display:flex;flex-direction:column;align-items:center;text-align:center;height:100%;box-sizing:border-box;justify-content:center}
.wr-sc-logo{font-size:0.7rem;font-weight:900;letter-spacing:0.2em;text-transform:uppercase;opacity:0.7;margin-bottom:0.3rem}
.wr-sc-year{font-size:1.8rem;font-weight:900;margin-bottom:1rem}
.wr-sc-avatar{width:56px;height:56px;border-radius:50%;overflow:hidden;margin-bottom:0.5rem;border:2px solid rgba(255,255,255,0.3)}
.wr-sc-avatar img{width:100%;height:100%;object-fit:cover}
.wr-sc-name{font-size:1rem;font-weight:700;margin-bottom:1.2rem}
.wr-sc-stats{display:flex;gap:2rem;margin-bottom:1.2rem}
.wr-sc-stat{text-align:center}
.wr-sc-num{display:block;font-size:2rem;font-weight:900}
.wr-sc-label{font-size:0.65rem;font-weight:500;text-transform:uppercase;letter-spacing:0.1em;opacity:0.7}
.wr-sc-row{display:flex;justify-content:space-between;width:100%;max-width:280px;padding:0.5rem 0;border-top:1px solid rgba(255,255,255,0.15);font-size:0.8rem}
.wr-sc-tag{font-weight:500;opacity:0.7}
.wr-sc-val{font-weight:900}

/* ═══ Responsive ═══ */
@media(max-width:380px){
  .wr-mega-num{font-size:clamp(5rem,22vw,8rem)}
  .wr-stat-big{font-size:clamp(4rem,16vw,7rem)}
  .wr-section{padding:2rem 1.2rem}
  .wr-stats-row{gap:1.2rem}
  .wr-genre-name{font-size:clamp(2.2rem,9vw,4rem)}
  .wr-artist-hero{font-size:clamp(2rem,8vw,3.5rem)}
}
  `,document.head.appendChild(e)}export{D as cleanupWrapped,ie as getWrappedBannerHTML,ne as initWrapped,se as isWrappedAvailable};
