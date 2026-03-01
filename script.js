/* ================================================================
   REDDITSCOPE — script.js
   Advanced analytics · Canvas charts · Persona detection
   Pure vanilla JS — no external libraries
   ================================================================ */
'use strict';

// ── DOM shortcuts ────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const searchForm    = $('searchForm');
const usernameInput = $('usernameInput');
const analyzeBtn    = $('analyzeBtn');
const errorMsg      = $('errorMsg');
const hero          = $('hero');
const loadingSection= $('loadingSection');
const loadingLabel  = $('loadingLabel');
const results       = $('results');
const themeToggle   = $('themeToggle');
const analyzeAgain  = $('analyzeAgain');
const copyBtn       = $('copyBtn');
const downloadBtn   = $('downloadBtn');
const shareBtn      = $('shareBtn');

const steps = ['step1','step2','step3','step4'].map(id => $(id));

// ── CORS proxy chain (fallback for file:// origins) ─────────────
const CORS_PROXIES = [
  url => url,
  url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
];

async function fetchJSON(url) {
  let lastErr;
  for (const proxy of CORS_PROXIES) {
    try {
      const res = await fetch(proxy(url), {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout ? AbortSignal.timeout(9000) : undefined,
      });
      if (res.status === 429) throw new Error('Rate limited — please wait a moment.');
      if (!res.ok && res.status !== 404) { lastErr = new Error(`HTTP ${res.status}`); continue; }
      return await res.json();
    } catch(e) {
      if (e.message.includes('Rate')) throw e;
      lastErr = e;
    }
  }
  throw new Error('Could not reach Reddit API. Try hosting via a local server instead of file://');
}

// ── Theme ────────────────────────────────────────────────────────
themeToggle.addEventListener('click', () => {
  const t = document.documentElement.getAttribute('data-theme');
  document.documentElement.setAttribute('data-theme', t === 'dark' ? 'light' : 'dark');
});

// ── Star canvas background ───────────────────────────────────────
(function initStars() {
  const canvas = $('bgStars');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let stars = [];
  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    stars = Array.from({ length: 120 }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      r: Math.random() * 1.2 + 0.2,
      a: Math.random(),
      s: Math.random() * 0.003 + 0.001,
    }));
  }
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    stars.forEach(s => {
      s.a += s.s; if (s.a > 1) s.s = -s.s;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${Math.abs(s.a) * 0.6})`;
      ctx.fill();
    });
    requestAnimationFrame(draw);
  }
  resize(); draw();
  window.addEventListener('resize', resize);
})();

// ── Analyze Again ────────────────────────────────────────────────
analyzeAgain.addEventListener('click', () => {
  results.hidden = true;
  hero.hidden = false;
  hero.style.display = '';
  usernameInput.value = '';
  clearError();
  // Reset dig deep
  const ddPanel = document.getElementById('digDeepPanel');
  const ddBtn   = document.getElementById('digDeepBtn');
  if (ddPanel) ddPanel.hidden = true;
  if (ddBtn)   { ddBtn.disabled = false; ddBtn.innerHTML = '<span class="dig-deep-icon">🔍</span><span>Let\u2019s Dig Deep</span>'; }
  window._currentPosts    = [];
  window._currentComments = [];
  usernameInput.focus();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

// ── Form submit ──────────────────────────────────────────────────
searchForm.addEventListener('submit', async e => {
  e.preventDefault();
  const username = usernameInput.value.trim().replace(/^u\//i, '');
  if (!username) return showError('Please enter a Reddit username.');
  await analyzeUser(username);
});

// ── Main orchestrator ────────────────────────────────────────────
async function analyzeUser(username) {
  clearError();
  setLoading(true);
  resetSteps();

  try {
    setStep(0, 'active');
    const profile = await fetchProfile(username);
    setStep(0, 'done'); setStep(1, 'active');

    // Check if profile is hidden (posts hidden from /submitted endpoint)
    updateLoadingLabel('Checking profile visibility…');
    const profileIsHidden = await checkIfHidden(username);
    profile._isHidden = profileIsHidden;

    updateLoadingLabel('Fetching posts…');
    let posts = await fetchListing(username, 'submitted');

    // If hidden or fewer than 5 posts came back, try search-index fallback
    if (profileIsHidden || posts.length < 5) {
      updateLoadingLabel(profileIsHidden
        ? 'Hidden profile — searching index…'
        : 'Low results — searching index…');
      const searchPosts = await fetchListingBySearch(username);
      if (searchPosts.length > posts.length) {
        posts = searchPosts;
        profile._usedSearchFallback = true;
      }
    }
    setStep(1, 'done'); setStep(2, 'active');

    updateLoadingLabel('Fetching comments…');
    const comments = await fetchListing(username, 'comments');
    setStep(2, 'done'); setStep(3, 'active');

    updateLoadingLabel('Crunching numbers…');
    const analysis = analyzeData(profile, posts, comments);
    setStep(3, 'done');

    await sleep(400);
    renderResults(profile, posts, comments, analysis);

    setLoading(false);
    hero.style.display = 'none'; // keep hero hidden while showing results
    results.hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });

  } catch (err) {
    setLoading(false);
    hero.style.display = ''; // restore hero on error
    hero.hidden = false;
    showError(err.message || 'Something went wrong. Try again.');
    console.error('[RedditScope]', err);
  }
}

// ── API fetchers ─────────────────────────────────────────────────
async function fetchProfile(username) {
  updateLoadingLabel('Fetching profile…');
  const url = `https://www.reddit.com/user/${encodeURIComponent(username)}/about.json`;
  const res = await fetchJSON(url);
  if (res.error === 404 || res.message === 'Not Found') throw new Error(`u/${username} not found.`);
  if (res.data?.is_suspended) throw new Error(`u/${username} is suspended.`);
  if (!res.data || res.kind !== 't2') throw new Error('Invalid API response.');
  return res.data;
}

async function fetchListing(username, type) {
  const MAX_PAGES = 10;
  const base = `https://www.reddit.com/user/${encodeURIComponent(username)}/${type}.json?limit=100`;
  let items = [], after = null, page = 0;
  while (page < MAX_PAGES) {
    const url = after ? `${base}&after=${after}` : base;
    let res;
    try { res = await fetchJSON(url); } catch(e) { break; }
    if (!res?.data?.children?.length) break;
    const batch = res.data.children.map(c => c.data).filter(Boolean);
    items = items.concat(batch);
    page++;
    after = res.data.after;
    if (!after) break;
    await sleep(120);
  }
  return items;
}

// ── Hidden profile detection ──────────────────────────────────────
// When a user hides their profile, /submitted returns empty.
// But Reddit's search index still has their posts via author:"username".
async function checkIfHidden(username) {
  try {
    const url = `https://www.reddit.com/user/${encodeURIComponent(username)}/submitted.json?limit=10`;
    const res = await fetchJSON(url);
    if (!res?.data?.children) return true; // can't read → treat as hidden
    const children = res.data.children || [];
    if (children.length === 0) return true;
    // If all returned posts are in their own user-profile subreddit, they're hidden
    const nonProfile = children.filter(c => c.data && c.data.subreddit_type !== 'user');
    return nonProfile.length === 0;
  } catch (_) { return false; }
}

// ── Search-index post fetch (works on hidden profiles) ─────────────
// Uses /search.json?q=author:"username" — Reddit's search index
// indexes posts even when user profile is set to hidden.
async function fetchListingBySearch(username) {
  const q = `author:"${username}"`;
  const base = `https://www.reddit.com/search.json?q=${encodeURIComponent(q)}&sort=relevance&limit=100&type=link`;
  let items = [], after = null, page = 0, seenIds = new Set();
  const MAX = 10;

  while (page < MAX) {
    const url = after ? `${base}&after=${after}` : base;
    let res;
    try { res = await fetchJSON(url); } catch(e) { break; }
    if (!res?.data?.children?.length) break;

    const batch = res.data.children
      .filter(c => c.data && !seenIds.has(c.data.id))
      .map(c => { seenIds.add(c.data.id); return c.data; });

    items = items.concat(batch);
    page++;
    after = res.data.after;
    if (!after) break;
    await sleep(150);
  }
  return items;
}

// ── Data Analysis Engine ─────────────────────────────────────────
function analyzeData(profile, posts, comments) {
  const allItems = [...posts, ...comments];
  const now = Date.now() / 1000;

  // ── Subreddit frequency
  const subCount = {};
  allItems.forEach(item => {
    if (item.subreddit) subCount[item.subreddit] = (subCount[item.subreddit] || 0) + 1;
  });
  const topSubs = Object.entries(subCount).sort((a,b) => b[1]-a[1]).slice(0, 8)
    .map(([name, count]) => ({ name, count, pct: Math.round((count / allItems.length) * 100) }));

  // ── Hour-of-day distribution (0-23)
  const hourDist = new Array(24).fill(0);
  allItems.forEach(item => {
    if (item.created_utc) hourDist[new Date(item.created_utc * 1000).getHours()]++;
  });
  const peakHour = hourDist.indexOf(Math.max(...hourDist));

  // ── Day-of-week distribution (0=Sun, 6=Sat)
  const dowDist = new Array(7).fill(0);
  allItems.forEach(item => {
    if (item.created_utc) dowDist[new Date(item.created_utc * 1000).getDay()]++;
  });
  const peakDow = dowDist.indexOf(Math.max(...dowDist));

  // ── Content type breakdown
  const typeMap = { image: 0, link: 0, text: 0, video: 0, gallery: 0 };
  posts.forEach(p => {
    if (p.is_video) typeMap.video++;
    else if (p.is_gallery) typeMap.gallery++;
    else if (p.is_self) typeMap.text++;
    else if (p.url && /\.(jpg|jpeg|png|gif|webp)/i.test(p.url)) typeMap.image++;
    else typeMap.link++;
  });

  // ── Best post & comment
  const topPost    = posts.length    ? posts.reduce((a,b)    => b.score > a.score ? b : a)    : null;
  const topComment = comments.length ? comments.reduce((a,b) => b.score > a.score ? b : a) : null;

  // ── Post scores
  const avgPostScore = posts.length ? Math.round(posts.reduce((s,p) => s+(p.score||0),0)/posts.length) : 0;
  const avgComments  = posts.length ? (posts.reduce((s,p) => s+(p.num_comments||0),0)/posts.length).toFixed(1) : 0;

  // ── Posting frequency
  const ageMonths = (now - profile.created_utc) / (60*60*24*30);
  const postsPerMonth = ageMonths > 0 ? (posts.length / ageMonths).toFixed(1) : posts.length;

  // ── Comment/post ratio
  const ratio = posts.length > 0 ? (comments.length / posts.length).toFixed(1) : comments.length;

  // ── Controversiality score (0-100)
  const controversialPosts = posts.filter(p => p.upvote_ratio && p.upvote_ratio < 0.6).length;
  const controversiality = posts.length ? Math.round((controversialPosts / posts.length) * 100) : 0;

  // ── Sentiment analysis (simple lexicon)
  const sentimentScore = calcSentiment(posts, comments);

  // ── Word frequency
  const wordFreq = buildWordFrequency(posts, comments);

  // ── Most active day ever
  const dayMap = {};
  allItems.forEach(item => {
    if (!item.created_utc) return;
    const d = new Date(item.created_utc * 1000);
    const key = d.toDateString();
    dayMap[key] = (dayMap[key] || 0) + 1;
  });
  const mostActiveDay = Object.entries(dayMap).sort((a,b) => b[1]-a[1])[0] || null;

  // ── Award count
  const awards = allItems.reduce((sum, item) => sum + (item.total_awards_received || 0), 0);

  // ── Persona detection
  const persona = detectPersona(posts, comments, topSubs, ratio, avgPostScore, sentimentScore, hourDist);

  return {
    topSubs, hourDist, dowDist, typeMap,
    topPost, topComment, avgPostScore, avgComments,
    postsPerMonth, ratio, controversiality,
    sentimentScore, wordFreq, mostActiveDay,
    peakHour, peakDow, awards, persona,
    totalItems: (posts ? posts.length : 0) + (comments ? comments.length : 0),
  };
}

// ── Sentiment ────────────────────────────────────────────────────
function calcSentiment(posts, comments) {
  const POS = new Set(['good','great','best','love','awesome','amazing','excellent','wonderful','fantastic',
    'happy','glad','thanks','thank','helpful','nice','perfect','brilliant','beautiful','enjoy','enjoyed',
    'useful','interesting','incredible','impressive','outstanding','positive','agree','correct','right']);
  const NEG = new Set(['bad','worst','hate','awful','terrible','horrible','disgusting','wrong','broken',
    'stupid','idiot','dumb','annoying','fail','failed','disappointed','useless','pathetic','garbage',
    'trash','scam','lie','lying','fake','false','misleading','disagree','incorrect','evil']);

  let pos = 0, neg = 0;
  const addText = txt => {
    if (!txt) return;
    txt.toLowerCase().split(/\W+/).forEach(w => {
      if (POS.has(w)) pos++;
      if (NEG.has(w)) neg++;
    });
  };
  posts.forEach(p => addText(p.title));
  comments.forEach(c => addText(c.body));

  const total = pos + neg;
  if (!total) return 50;
  return Math.round((pos / total) * 100);
}

// ── Word frequency ────────────────────────────────────────────────
function buildWordFrequency(posts, comments) {
  const STOP = new Set([
    'the','a','an','and','or','but','in','on','at','to','for','of','with','is','are','was','were',
    'be','been','have','has','had','do','does','did','will','would','could','should','may','might',
    'this','that','these','those','i','my','me','we','our','you','your','he','his','she','her',
    'they','their','it','its','not','so','as','if','by','from','up','out','about','just','no',
    'more','when','what','all','one','can','get','like','than','then','there','also','into','after',
    'before','how','which','who','re','https','www','http','amp','gt','lt','edit','deleted','removed',
    'really','very','much','still','even','some','only','any','other','been','same','than','too',
    'most','over','such','back','well','know','think','want','need','dont','cant','wont','its',
    'here','just','now','people','time','year','make','made','use','used','going','come','see',
  ]);
  const freq = {};
  const add = txt => {
    if (!txt) return;
    txt.toLowerCase().replace(/[^a-z0-9\s]/g,' ').split(/\s+/)
      .filter(w => w.length > 3 && !STOP.has(w) && isNaN(w))
      .forEach(w => { freq[w] = (freq[w]||0)+1; });
  };
  posts.forEach(p => add(p.title));
  comments.forEach(c => add(c.body));
  return Object.entries(freq).sort((a,b) => b[1]-a[1]).slice(0,40);
}

// ── Persona detection ─────────────────────────────────────────────
function detectPersona(posts, comments, topSubs, ratio, avgScore, sentiment, hourDist) {
  const nightPosts   = hourDist.slice(22).concat(hourDist.slice(0,5)).reduce((a,b)=>a+b,0);
  const morningPosts = hourDist.slice(6,10).reduce((a,b)=>a+b,0);
  const totalAct     = hourDist.reduce((a,b)=>a+b,0) || 1;
  const isNightOwl   = nightPosts / totalAct > 0.3;
  const isEarlyBird  = morningPosts / totalAct > 0.35;
  const freq = comments.length + posts.length;

  // Edge cases
  if (posts.length === 0 && comments.length > 10)
    return { icon: '👀', label: 'Silent Observer',    desc: 'Lurks and comments, never starts the conversation' };
  if (posts.length === 0 && comments.length <= 10)
    return { icon: '🕵️', label: 'Ghost',              desc: 'Barely leaves a trace on Reddit' };
  if (comments.length === 0 && posts.length > 0)
    return { icon: '📢', label: 'Broadcaster',        desc: 'Posts content but rarely engages in replies' };

  // Score-based archetypes
  if (avgScore > 5000)    return { icon: '🌟', label: 'Reddit Legend',      desc: 'Posts consistently dominate the frontpage' };
  if (avgScore > 1000)    return { icon: '🏆', label: 'Viral Creator',       desc: 'Content regularly goes viral across Reddit' };
  if (avgScore > 500)     return { icon: '🔥', label: 'Trending Machine',    desc: 'Consistently reaches hot with quality content' };

  // Behavior-based
  if (Number(ratio) > 25) return { icon: '💬', label: 'Comment Dynamo',     desc: 'Lives in the comments, almost never posts' };
  if (Number(ratio) > 10) return { icon: '🗣️', label: 'Conversationalist',   desc: 'Loves discussions far more than posting' };
  if (Number(ratio) < 0.5 && posts.length > 10)
                          return { icon: '📸', label: 'Pure Creator',        desc: 'Posts prolifically and rarely replies' };

  // Sentiment-based
  if (sentiment > 80)     return { icon: '☀️', label: 'Positivity Beacon',  desc: 'Relentlessly upbeat, a ray of sunshine on Reddit' };
  if (sentiment > 70)     return { icon: '😊', label: 'Positive Force',      desc: 'Spreads warmth and positivity across communities' };
  if (sentiment < 25)     return { icon: '⚔️', label: 'Edgelord',            desc: 'Deeply contrarian, thrives in debate and conflict' };
  if (sentiment < 35)     return { icon: '🌩️', label: 'Contrarian',          desc: 'Challenges prevailing views and loves a good argument' };

  // Time-based
  if (isNightOwl && Number(ratio) > 5)
                          return { icon: '🦉', label: 'Midnight Debater',   desc: 'Comes alive in comment sections after dark' };
  if (isNightOwl)         return { icon: '🦉', label: 'Night Owl',           desc: 'Most active during the late-night hours' };
  if (isEarlyBird)        return { icon: '🌅', label: 'Early Bird',          desc: 'Greets the Reddit day before most others wake up' };

  // Niche
  if (topSubs.length === 1)
                          return { icon: '🎯', label: 'Niche Specialist',   desc: `Laser-focused on r/${topSubs[0]?.name}` };
  if (topSubs.length === 2)
                          return { icon: '🎲', label: 'Dual Citizen',        desc: `Splits time between r/${topSubs[0]?.name} and r/${topSubs[1]?.name}` };

  // Frequency
  if (freq > 300 && avgScore > 200)
                          return { icon: '⭐', label: 'Power User',          desc: 'Prolific, high-quality contributor' };
  if (freq > 200)         return { icon: '⚡', label: 'Hyperactive',         desc: 'Posts and comments at a relentless pace' };

  // Community breadth
  if (topSubs.length >= 7)
                          return { icon: '🌐', label: 'Community Hopper',   desc: 'Deeply involved across a wide range of subreddits' };

  // Default
  return                  { icon: '🧭', label: 'Explorer',               desc: 'Curious generalist ranging across many communities' };
}

// ── Post-per-month calc ───────────────────────────────────────────
function calcPostsPerMonth(posts, createdUtc) {
  if (!posts.length) return 0;
  const ageM = (Date.now()/1000 - createdUtc) / (60*60*24*30);
  return ageM > 0 ? (posts.length / ageM).toFixed(1) : posts.length;
}

// ================================================================
//  RENDERING
// ================================================================
function renderResults(profile, posts, comments, analysis) {
  window._currentPosts    = posts;
  window._currentComments = comments;
  window._currentProfile  = profile;
  renderProfileHero(profile, posts, comments, analysis);
  renderTicker(profile, posts, comments, analysis);
  renderMetrics(profile, posts, comments, analysis);
  renderHourChart(analysis.hourDist, analysis.peakHour);
  renderTypeDonut(analysis.typeMap);
  renderHeatmap(analysis.dowDist);
  renderSubreddits(analysis.topSubs);
  renderBestContent(analysis);
  renderWordCloud(analysis.wordFreq);
  renderPersonalityType(profile, posts, comments, analysis);
  renderReportCard(profile, posts, comments, analysis);
  renderRoast(profile, posts, comments, analysis);
  renderSummary(profile, posts, comments, analysis);
  setupActions(profile, analysis);
  animateIn();
}

// ── Profile Hero ─────────────────────────────────────────────────
function renderProfileHero(profile, posts, comments, analysis) {
  // Avatar
  const av = $('profileAvatar');
  const img = profile.icon_img || profile.snoovatar_img || '';
  av.src = img ? img.split('?')[0] : defaultAvatar();
  av.onerror = () => { av.src = defaultAvatar(); };

  // Status dot color based on sentiment
  const statusEl = $('avatarStatus');
  statusEl.style.background = analysis.sentimentScore > 60 ? '#06d6a0' : analysis.sentimentScore > 40 ? '#f0b429' : '#ff6b6b';

  // Name
  $('profileUsername').textContent = `u/${profile.name}`;

  // Badges
  const badges = $('profileBadges');
  badges.innerHTML = '';
  const age = accountAge(profile.created_utc);
  badges.innerHTML += `<span class="badge badge-age">🎂 ${age} old</span>`;
  if (profile._isHidden)           badges.innerHTML += `<span class="badge badge-hidden">👻 Hidden Profile</span>`;
  if (profile.is_employee)         badges.innerHTML += `<span class="badge badge-employee">🏢 Reddit Employee</span>`;
  if (profile.is_gold)             badges.innerHTML += `<span class="badge badge-premium">★ Premium</span>`;
  if (profile.has_verified_email)  badges.innerHTML += `<span class="badge badge-verified">✓ Verified</span>`;

  // Since
  const cakeDay = new Date(profile.created_utc * 1000).toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });
  $('profileSince').textContent = `Member since ${cakeDay}`;

  // Show/update the hidden profile notice
  let hiddenNotice = document.getElementById('hiddenProfileNotice');
  if (profile._isHidden || profile._usedSearchFallback) {
    if (!hiddenNotice) {
      hiddenNotice = document.createElement('div');
      hiddenNotice.id = 'hiddenProfileNotice';
      hiddenNotice.className = 'hidden-profile-notice';
      const resultsEl = document.getElementById('results');
      const profileHeroEl = document.getElementById('profileHero');
      resultsEl.insertBefore(hiddenNotice, profileHeroEl.nextSibling);
    }
    const mode = profile._usedSearchFallback
      ? 'Posts were fetched via Reddit\'s search index'
      : 'Profile is hidden';
    const explanation = profile._isHidden
      ? 'This user has hidden their profile their posts are invisible on their profile page, but were recovered from Reddit\'s search index.'
      : 'Fewer posts were found via the profile endpoint, so the search index was used to recover more.';
    hiddenNotice.innerHTML = `
      <div class="hn-icon">👻</div>
      <div class="hn-body">
        <div class="hn-title">${mode}</div>
        <div class="hn-desc">${explanation} Comments from hidden profiles cannot be recovered.</div>
      </div>
    `;
    hiddenNotice.style.display = 'flex';
  } else if (hiddenNotice) {
    hiddenNotice.style.display = 'none';
  }

  // Karma donut
  const postK    = profile.link_karma || 0;
  const commentK = profile.comment_karma || 0;
  const total    = postK + commentK;
  drawDonut($('karmaDonut'), [
    { val: postK,    color: '#ff4500' },
    { val: commentK, color: '#9b5de5' },
  ], 6);

  const kcv = $('totalKarmaVal');
  kcv.innerHTML = `<div class="kv-num">${formatNumber(total)}</div><div class="kv-lbl">KARMA</div>`;

  $('karmaLegend').innerHTML = `
    <div class="kleg-item"><div class="kleg-dot" style="background:#ff4500"></div><span class="kleg-text">Post ${formatNumber(postK)}</span></div>
    <div class="kleg-item"><div class="kleg-dot" style="background:#9b5de5"></div><span class="kleg-text">Comment ${formatNumber(commentK)}</span></div>
  `;

  // Persona
  $('personaIcon').textContent  = analysis.persona.icon;
  $('personaLabel').textContent = analysis.persona.label;

  // BG gradient
  $('profileHeroBg').style.background = `linear-gradient(135deg, rgba(255,69,0,0.1) 0%, rgba(155,93,229,0.06) 100%)`;
}

// ── Stats Ticker ──────────────────────────────────────────────────
function renderTicker(profile, posts, comments, analysis) {
  const total = (profile.link_karma||0) + (profile.comment_karma||0);
  const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const items = [
    ['Total Karma',  formatNumber(total),              false],
    ['Posts',        formatNumber(posts.length),        false],
    ['Comments',     formatNumber(comments.length),     false],
    ['Avg Score',    formatNumber(analysis.avgPostScore), false],
    ['Persona',      analysis.persona.label,            true],
    ['Sentiment',    `${analysis.sentimentScore}% positive`, false],
    ['Peak Day',     analysis.peakDow !== undefined ? DAYS[analysis.peakDow] : '—', false],
    ['Posts/Month',  analysis.postsPerMonth,             false],
    ['Top Sub',      `r/${analysis.topSubs[0]?.name||'—'}`, true],
    ['Comment Ratio',`${analysis.ratio}:1`,              false],
    ['Awards',       formatNumber(analysis.awards),      false],
    ['Account Age',  accountAge(profile.created_utc),   false],
  ];

  const track = $('tickerTrack');
  const buildItems = () => items.map(([lbl, val, accent]) =>
    `<div class="ticker-item">
      <span class="ticker-item-label">${lbl}</span>
      <span class="${accent ? 'ticker-item-accent' : 'ticker-item-value'}">${val}</span>
    </div>`
  ).join('');
  // Duplicate for seamless loop
  track.innerHTML = buildItems() + buildItems();
}

// ── Metrics Grid ──────────────────────────────────────────────────
function renderMetrics(profile, posts, comments, analysis) {
  const scoreLabel = analysis.avgPostScore > 500 ? 'Exceptional' : analysis.avgPostScore > 100 ? 'Above average' : analysis.avgPostScore > 20 ? 'Moderate' : 'Modest';
  const scoreClass = analysis.avgPostScore > 100 ? 'good' : analysis.avgPostScore > 20 ? 'warn' : '';

  const sentiment = analysis.sentimentScore;
  const sentLabel = sentiment > 70 ? 'Very positive' : sentiment > 55 ? 'Positive' : sentiment > 45 ? 'Neutral' : sentiment > 30 ? 'Critical' : 'Very negative';
  const sentClass = sentiment > 55 ? 'good' : sentiment > 40 ? 'warn' : 'bad';

  const contClass = analysis.controversiality > 30 ? 'bad' : analysis.controversiality > 15 ? 'warn' : 'good';

  function setM(id, val, sub) {
    const el = $(id);
    if (!el) return;
    el.querySelector('.metric-val').textContent = val;
    const s = el.querySelector('.metric-sub');
    if (s) s.innerHTML = sub;
    animateCounter(el.querySelector('.metric-val'));
  }

  setM('mPosts',       formatNumber(posts.length),            `<span>${posts.length >= 1000 ? '1,000 max fetched' : 'All fetched'}</span>`);
  setM('mComments',    formatNumber(comments.length),         `<span>${comments.length >= 1000 ? '1,000 max fetched' : 'All fetched'}</span>`);
  setM('mAvgScore',    formatNumber(analysis.avgPostScore),   `<span class="${scoreClass}">${scoreLabel}</span>`);
  setM('mFreq',        analysis.postsPerMonth,                `<span>Per calendar month</span>`);
  setM('mEngagement',  analysis.avgComments,                  `<span>Avg discussion per post</span>`);
  setM('mRatio',       `${analysis.ratio}:1`,                 `<span>Comments vs posts</span>`);
  setM('mSentiment',   `${sentiment}%`,                       `<span class="${sentClass}">${sentLabel}</span>`);
  setM('mControversy', `${analysis.controversiality}%`,       `<span class="${contClass}">${analysis.controversiality > 20 ? 'Polarizing' : 'Uncontroversial'}</span>`);
}

// ── Hour Chart (bar) ──────────────────────────────────────────────
function renderHourChart(hourDist, peakHour) {
  const canvas = $('hourChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const maxVal = Math.max(...hourDist, 1);
  const barW = W / 24;
  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';

  ctx.clearRect(0, 0, W, H);

  hourDist.forEach((val, hour) => {
    const bh = Math.max((val / maxVal) * (H - 10), 2);
    const x = hour * barW;
    const isPeak = hour === peakHour;

    const grad = ctx.createLinearGradient(0, H - bh, 0, H);
    grad.addColorStop(0, isPeak ? 'rgba(255,69,0,0.95)' : 'rgba(255,69,0,0.45)');
    grad.addColorStop(1, isPeak ? 'rgba(255,140,90,0.4)' : 'rgba(255,69,0,0.1)');
    ctx.fillStyle = grad;

    const radius = Math.min(4, barW * 0.3);
    const bx = x + 1, by = H - bh, bw = barW - 2;
    ctx.beginPath();
    ctx.moveTo(bx + radius, by);
    ctx.lineTo(bx + bw - radius, by);
    ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + radius);
    ctx.lineTo(bx + bw, H);
    ctx.lineTo(bx, H);
    ctx.lineTo(bx, by + radius);
    ctx.quadraticCurveTo(bx, by, bx + radius, by);
    ctx.closePath();
    ctx.fill();

    if (isPeak) {
      ctx.fillStyle = 'rgba(255,69,0,0.15)';
      ctx.fillRect(x, 0, barW, H);
    }
  });

  // Peak label
  const peakLabel = `Peak: ${peakHour === 0 ? '12am' : peakHour < 12 ? `${peakHour}am` : peakHour === 12 ? '12pm' : `${peakHour-12}pm`}`;
  $('peakHourLabel').textContent = peakLabel;
}

// ── Type Donut ────────────────────────────────────────────────────
function renderTypeDonut(typeMap) {
  const canvas = $('typeDonut');
  if (!canvas) return;
  const entries = Object.entries(typeMap).filter(([,v]) => v > 0);
  if (!entries.length) return;

  const COLORS = { text: '#ff4500', link: '#9b5de5', image: '#4cc9f0', video: '#f72585', gallery: '#f0b429' };
  const LABELS = { text: 'Text', link: 'Link', image: 'Image', video: 'Video', gallery: 'Gallery' };
  const total = entries.reduce((s,[,v]) => s+v, 0);
  const segments = entries.map(([k,v]) => ({ key: k, val: v, color: COLORS[k], pct: Math.round((v/total)*100) }));

  drawDonut(canvas, segments.map(s => ({ val: s.val, color: s.color })), 10);

  // Center
  const topType = segments.sort((a,b) => b.val-a.val)[0];
  $('typeDonutCenter').innerHTML = `<div class="td-val">${topType.pct}%</div><div class="td-lbl">${LABELS[topType.key]}</div>`;

  // Legend
  $('typeLegend').innerHTML = segments.sort((a,b) => b.val-a.val).map(s => `
    <div class="tleg">
      <div class="tleg-left"><div class="tleg-dot" style="background:${s.color}"></div><span class="tleg-name">${LABELS[s.key]}</span></div>
      <span class="tleg-pct">${s.pct}%</span>
    </div>
  `).join('');
}

// ── Donut draw helper ─────────────────────────────────────────────
function drawDonut(canvas, segments, gap = 4) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const cx = W / 2, cy = H / 2;
  const outerR = Math.min(cx, cy) - 4;
  const innerR = outerR * 0.62;
  const total = segments.reduce((s, seg) => s + seg.val, 0) || 1;

  ctx.clearRect(0, 0, W, H);

  let startAngle = -Math.PI / 2;
  const gapAngle = (gap / (2 * Math.PI * outerR)) * (2 * Math.PI);

  segments.forEach(seg => {
    const sliceAngle = (seg.val / total) * (Math.PI * 2) - gapAngle;
    if (sliceAngle <= 0) return;

    ctx.beginPath();
    ctx.arc(cx, cy, outerR, startAngle, startAngle + sliceAngle);
    ctx.arc(cx, cy, innerR, startAngle + sliceAngle, startAngle, true);
    ctx.closePath();
    ctx.fillStyle = seg.color;
    ctx.fill();
    startAngle += sliceAngle + gapAngle;
  });
}

// ── Weekly Heatmap ────────────────────────────────────────────────
function renderHeatmap(dowDist) {
  const DAYS  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const maxVal = Math.max(...dowDist, 1);
  const wrap = $('heatmapWrap');
  if (!wrap) return;

  // Build a richer 7-hour-group heatmap using all data
  // We have dowDist (7 values) — show them as colored blocks per day
  wrap.innerHTML = '';

  // Single row with 7 blocks
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:8px;';

  dowDist.forEach((count, i) => {
    const intensity = maxVal > 0 ? count / maxVal : 0;
    const el = document.createElement('div');
    el.style.cssText = `flex:1;display:flex;flex-direction:column;gap:6px;align-items:center;`;

    const bar = document.createElement('div');
    bar.style.cssText = `width:100%;border-radius:8px;background:rgba(255,69,0,${0.08 + intensity * 0.85});
      border:1px solid rgba(255,69,0,${0.15 + intensity * 0.5});
      height:60px;position:relative;transition:all 0.3s;cursor:default;`;
    bar.setAttribute('data-tip', `${DAYS[i]}: ${count} actions`);

    bar.addEventListener('mouseenter', () => { bar.style.transform = 'scaleY(1.05)'; });
    bar.addEventListener('mouseleave', () => { bar.style.transform = ''; });

    const lbl = document.createElement('div');
    lbl.style.cssText = `font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text-muted);`;
    lbl.textContent = DAYS[i];

    const cnt = document.createElement('div');
    cnt.style.cssText = `font-size:11px;color:${intensity > 0.5 ? 'var(--accent)' : 'var(--text-muted)'};font-weight:600;font-family:'JetBrains Mono',monospace;`;
    cnt.textContent = count;

    el.append(bar, lbl, cnt);
    row.appendChild(el);
  });

  wrap.appendChild(row);
}

// ── Subreddits ────────────────────────────────────────────────────
function renderSubreddits(topSubs) {
  const list = $('subredditList');
  list.innerHTML = '';
  if (!topSubs.length) { list.innerHTML = '<p style="color:var(--text-muted)">No activity found.</p>'; return; }

  const maxCount = topSubs[0].count;
  topSubs.forEach((sub, i) => {
    const relPct = maxCount > 0 ? Math.round((sub.count / maxCount) * 100) : 0;
    const el = document.createElement('div');
    el.className = 'sub-item';
    el.innerHTML = `
      <div class="sub-rank">${i+1}</div>
      <div class="sub-body">
        <div class="sub-name"><a href="https://reddit.com/r/${sub.name}" target="_blank" rel="noopener">r/${sub.name}</a></div>
        <div class="sub-bar-row">
          <div class="sub-bar-bg"><div class="sub-bar-fill" style="width:0%" data-target="${relPct}%"></div></div>
          <div class="sub-bar-lbl" data-count="${sub.count}">${sub.pct}% of activity</div>
        </div>
      </div>
      <div class="sub-count-badge">
        <span class="scb-n">${sub.count}</span>
        <span class="scb-l">interactions</span>
      </div>`;
    list.appendChild(el);
    requestAnimationFrame(() => setTimeout(() => {
      const fill = el.querySelector('.sub-bar-fill');
      if (fill) fill.style.width = fill.dataset.target;
    }, 100 + i * 80));
  });
}

// ── Best Content ──────────────────────────────────────────────────
function renderBestContent(analysis) {
  // Top post
  const tp = $('topPost');
  if (analysis.topPost) {
    const p = analysis.topPost;
    tp.innerHTML = `
      <div class="best-item-sub">r/${escapeHTML(p.subreddit)}</div>
      <div class="best-item-title">${escapeHTML(p.title)}</div>
      <div class="best-item-score">▲ ${formatNumber(p.score)} upvotes · ${formatNumber(p.num_comments||0)} comments</div>`;
  } else {
    tp.innerHTML = '<p style="color:var(--text-muted)">No posts found.</p>';
  }

  // Top comment
  const tc = $('topComment');
  if (analysis.topComment) {
    const c = analysis.topComment;
    const body = (c.body||'').substring(0, 240) + ((c.body||'').length > 240 ? '…' : '');
    tc.innerHTML = `
      <div class="best-item-sub">r/${escapeHTML(c.subreddit)}</div>
      <div class="best-item-body">${escapeHTML(body)}</div>
      <div class="best-item-score">▲ ${formatNumber(c.score)} upvotes</div>`;
  } else {
    tc.innerHTML = '<p style="color:var(--text-muted)">No comments found.</p>';
  }

  // Most active day
  const mad = $('mostActiveDay');
  if (analysis.mostActiveDay) {
    const [dateStr, count] = analysis.mostActiveDay;
    const d = new Date(dateStr);
    const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    mad.innerHTML = `
      <div class="best-day-name">${DAYS[d.getDay()]}</div>
      <div class="best-day-sub">${d.toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' })}</div>
      <div class="best-day-stat">${count} posts &amp; comments on this day</div>`;
  } else {
    mad.innerHTML = '<p style="color:var(--text-muted)">Not enough data.</p>';
  }
}

// ── Word Cloud ────────────────────────────────────────────────────
function renderWordCloud(wordFreq) {
  const wrap = $('wordCloud');
  wrap.innerHTML = '';
  if (!wordFreq.length) { wrap.innerHTML = '<p style="color:var(--text-muted)">Not enough text.</p>'; return; }
  const maxF = wordFreq[0][1];
  wordFreq.forEach(([word, freq], i) => {
    const size = 11 + Math.round((freq / maxF) * 18);
    const opacity = 0.5 + (freq / maxF) * 0.5;
    const el = document.createElement('span');
    el.className = 'word-pill';
    el.textContent = word;
    el.style.fontSize = `${size}px`;
    el.style.opacity = opacity;
    el.style.animationDelay = `${i * 0.02}s`;
    el.title = `"${word}" — used ${freq} time${freq !== 1 ? 's' : ''}`;
    wrap.appendChild(el);
  });
}

// ── AI Summary ────────────────────────────────────────────────────
function renderSummary(profile, posts, comments, analysis) {
  const name = `u/${profile.name}`;
  $('summaryUsername').textContent = name;

  // Influence score (0–100) from karma, engagement, and awards
  const total = (profile.link_karma||0) + (profile.comment_karma||0);
  const karmaScore   = Math.min(40, Math.round(Math.log10(Math.max(total,1)) / Math.log10(1e7) * 40));
  const engageScore  = Math.min(35, Math.round(Math.min(analysis.avgPostScore, 2000) / 2000 * 35));
  const awardScore   = Math.min(15, analysis.awards);
  const frequScore   = Math.min(10, Math.round(Math.min(parseFloat(analysis.postsPerMonth), 30) / 30 * 10));
  const influenceScore = karmaScore + engageScore + awardScore + frequScore;
  const scoreEl = $('summaryEngagementScore');
  if (scoreEl) {
    scoreEl.textContent = '0';
    animateCounter(scoreEl, influenceScore, '', 1200);
  }

  // Overview paragraph
  const overview = buildOverview(profile, posts, comments, analysis);
  $('summaryText').textContent = overview;
  window._currentSummary = overview;
  window._currentProfile = profile;
  window._currentAnalysis = analysis;

  // Personality bars
  renderPersonalityBars(profile, posts, comments, analysis);

  // Activity profile data
  renderActivityProfile(profile, posts, comments, analysis);

  // Content style data
  renderContentStyle(profile, posts, comments, analysis);

  // Behavioral insight
  const insight = buildBehavioralInsight(profile, posts, comments, analysis);
  const insightEl = $('behavioralInsight');
  if (insightEl) insightEl.textContent = insight;

  // Traits
  const traits = buildTraits(profile, posts, comments, analysis);
  $('summaryTraits').innerHTML = traits.map(t => `<span class="trait-chip">${t}</span>`).join('');

  // Animate personality bars after render
  setTimeout(() => {
    document.querySelectorAll('.pbar-fill').forEach(bar => {
      bar.style.width = bar.dataset.target || '0%';
    });
  }, 300);
}

function buildOverview(profile, posts, comments, analysis) {
  const name  = `u/${profile.name}`;
  const age   = accountAge(profile.created_utc);
  const total = (profile.link_karma||0) + (profile.comment_karma||0);
  const top3  = analysis.topSubs.slice(0,3).map(s => `r/${s.name}`);
  const topW  = analysis.wordFreq.slice(0,4).map(([w]) => w);

  const HOURS = ['midnight','the early hours','the morning','the morning','the morning','the early hours',
    'the morning','the morning','the morning','the morning','the morning','midday','midday',
    'the afternoon','the afternoon','the afternoon','the afternoon','the evening','the evening',
    'the evening','late night','late night','late night','the early hours'];
  const DAYS_FULL = ['Sundays','Mondays','Tuesdays','Wednesdays','Thursdays','Fridays','Saturdays'];

  const engagement = analysis.avgPostScore > 1000 ? 'viral-level' : analysis.avgPostScore > 500 ? 'exceptional' :
                     analysis.avgPostScore > 100  ? 'strong'      : analysis.avgPostScore > 20  ? 'moderate' : 'modest';
  const sentDesc   = analysis.sentimentScore > 75 ? 'unmistakably upbeat and constructive' :
                     analysis.sentimentScore > 60 ? 'generally warm and positive' :
                     analysis.sentimentScore > 45 ? 'balanced and even-handed' :
                     analysis.sentimentScore > 30 ? 'skeptical and critical by nature' : 'fiercely contrarian';
  const ratioDesc  = Number(analysis.ratio) > 20 ? 'a devoted commenter who rarely originates content' :
                     Number(analysis.ratio) > 8  ? 'someone who engages far more in discussion than in posting' :
                     Number(analysis.ratio) > 3  ? 'a balanced participant who both posts and comments' :
                     'a content creator at heart who posts far more than they comment';
  const freqDesc   = parseFloat(analysis.postsPerMonth) > 30 ? 'a relentless daily contributor' :
                     parseFloat(analysis.postsPerMonth) > 10 ? 'a highly active member' :
                     parseFloat(analysis.postsPerMonth) > 2  ? 'a regular contributor' : 'an occasional visitor';

  let s = `${name} is a ${age}-old Redditor and ${freqDesc} with ${formatNumber(total)} total karma`;
  if (top3.length) s += `, who calls ${top3.slice(0,-1).join(', ')}${top3.length > 1 ? ' and ' + top3[top3.length-1] : top3[0]} home`;
  s += `. Across ${formatNumber(posts.length)} posts and ${formatNumber(comments.length)} comments, they emerge as ${ratioDesc}`;
  if (analysis.avgPostScore > 0) s += `, achieving ${engagement} engagement with an average of ${formatNumber(analysis.avgPostScore)} upvotes per post`;
  s += `. Their voice is ${sentDesc}`;
  if (topW.length) s += `, and their writing gravitates toward themes of "${topW.join('", "')}"`;
  s += `. Most at home during ${HOURS[analysis.peakHour]}`;
  if (analysis.peakDow !== undefined) s += ` — especially on ${DAYS_FULL[analysis.peakDow]}`;
  s += ` — their Reddit identity aligns with the "${analysis.persona.label}" archetype: ${analysis.persona.desc.toLowerCase()}.`;
  return s;
}

function buildBehavioralInsight(profile, posts, comments, analysis) {
  const total = (profile.link_karma||0) + (profile.comment_karma||0);
  const lines = [];

  // Engagement pattern
  if (analysis.avgPostScore > 500) {
    lines.push(`With an average of ${formatNumber(analysis.avgPostScore)} upvotes per post, this user has cracked the code on what resonates with Reddit communities — a rare skill that puts them in the top tier of content creators.`);
  } else if (analysis.avgPostScore > 50) {
    lines.push(`Their posts reliably accumulate upvotes above the community average, suggesting a good read on audience taste and consistent quality output.`);
  } else {
    lines.push(`Their posting style prioritizes participation over virality — the mark of someone who's here for the community conversation rather than the karma chase.`);
  }

  // Posting cadence insight
  const freq = parseFloat(analysis.postsPerMonth);
  if (freq > 30) {
    lines.push(`Posting multiple times daily, they are deeply embedded in Reddit's real-time culture — this level of consistency suggests Reddit is a primary media outlet for them.`);
  } else if (freq > 5) {
    lines.push(`Their steady cadence of ~${Math.round(freq)} posts/month reflects an engaged but intentional approach — they show up regularly without over-saturating their audience.`);
  }

  // Controversy / sentiment angle
  if (analysis.controversiality > 30) {
    lines.push(`A controversiality rate of ${analysis.controversiality}% reveals a user who doesn't shy away from divisive takes — they either love debate or simply aren't optimizing for consensus.`);
  }
  if (analysis.sentimentScore > 75) {
    lines.push(`Remarkably, ${analysis.sentimentScore}% of their language skews positive — in a platform often associated with cynicism, they stand out as a genuine force for good vibes.`);
  }

  // Community breadth
  if (analysis.topSubs.length >= 6) {
    lines.push(`Scattered across ${analysis.topSubs.length} distinct communities, their interests span a wide terrain — this breadth of engagement suggests intellectual curiosity and social versatility.`);
  } else if (analysis.topSubs.length === 1) {
    lines.push(`Nearly all their activity concentrates in a single subreddit — a deep specialist whose Reddit experience is tightly focused.`);
  }

  // Awards
  if (analysis.awards > 20) {
    lines.push(`${analysis.awards} awards accumulated across their history confirm that the community recognizes genuine value in their contributions.`);
  }

  return lines.slice(0, 3).join(' ');
}

function renderPersonalityBars(profile, posts, comments, analysis) {
  const wrap = $('personalityBars');
  if (!wrap) return;

  const total = (profile.link_karma||0) + (profile.comment_karma||0);

  // Define personality dimensions with calculated values
  const dims = [
    {
      label: 'Positivity',
      val: analysis.sentimentScore,
      color: 'linear-gradient(90deg, #06d6a0, #4cc9f0)',
      lo: 'Critical', hi: 'Positive',
    },
    {
      label: 'Engagement',
      val: Math.min(100, Math.round((analysis.avgPostScore / 2000) * 100)),
      color: 'linear-gradient(90deg, #ff4500, #ff8c5a)',
      lo: 'Low', hi: 'Viral',
    },
    {
      label: 'Discussion',
      val: Math.min(100, Math.round((parseFloat(analysis.ratio) / 20) * 100)),
      color: 'linear-gradient(90deg, #9b5de5, #f72585)',
      lo: 'Creator', hi: 'Commenter',
    },
    {
      label: 'Activity',
      val: Math.min(100, Math.round((parseFloat(analysis.postsPerMonth) / 30) * 100)),
      color: 'linear-gradient(90deg, #f0b429, #ff8c5a)',
      lo: 'Casual', hi: 'Power',
    },
    {
      label: 'Controversy',
      val: analysis.controversiality,
      color: 'linear-gradient(90deg, #4cc9f0, #f72585)',
      lo: 'Harmonious', hi: 'Divisive',
    },
    {
      label: 'Reach',
      val: Math.min(100, analysis.topSubs.length * 14),
      color: 'linear-gradient(90deg, #06d6a0, #9b5de5)',
      lo: 'Specialist', hi: 'Generalist',
    },
  ];

  wrap.innerHTML = dims.map(d => `
    <div class="pbar-row">
      <div class="pbar-label">${d.label}</div>
      <div class="pbar-track">
        <div class="pbar-fill" style="background:${d.color}" data-target="${d.val}%"></div>
      </div>
      <div class="pbar-val">${d.val}%</div>
    </div>
  `).join('');
}

function renderActivityProfile(profile, posts, comments, analysis) {
  const wrap = $('activityProfile');
  if (!wrap) return;

  const DAYS  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const HOURS = ['12am','1am','2am','3am','4am','5am','6am','7am','8am','9am','10am','11am',
                 '12pm','1pm','2pm','3pm','4pm','5pm','6pm','7pm','8pm','9pm','10pm','11pm'];
  const created = new Date(profile.created_utc * 1000);
  const cakeDay = created.toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' });

  const rows = [
    { k: 'Joined', v: cakeDay },
    { k: 'Account age', v: accountAge(profile.created_utc) },
    { k: 'Posts / month', v: `${analysis.postsPerMonth}` },
    { k: 'Peak hour', v: HOURS[analysis.peakHour] },
    { k: 'Peak day', v: analysis.peakDow !== undefined ? DAYS[analysis.peakDow] : '—' },
    { k: 'Total interactions', v: formatNumber(posts.length + comments.length) },
  ];
  wrap.innerHTML = rows.map(r => `
    <div class="ss-data-row">
      <span class="ss-data-key">${r.k}</span>
      <span class="ss-data-val">${r.v}</span>
    </div>`).join('');
}

function renderContentStyle(profile, posts, comments, analysis) {
  const wrap = $('contentStyle');
  if (!wrap) return;

  const types = analysis.typeMap;
  const total = Object.values(types).reduce((a,b)=>a+b, 0) || 1;
  const topType = Object.entries(types).sort((a,b)=>b[1]-a[1])[0];
  const topTypeLbl = topType ? `${topType[0]} (${Math.round((topType[1]/total)*100)}%)` : '—';

  // Avg comment length
  const avgComLen = comments.length ? Math.round(comments.reduce((s,c)=>(c.body||'').length+s,0)/comments.length) : 0;
  const lenDesc = avgComLen > 500 ? 'Long-form' : avgComLen > 200 ? 'Medium' : avgComLen > 50 ? 'Concise' : 'Brief';

  const rows = [
    { k: 'Avg post score', v: `▲ ${formatNumber(analysis.avgPostScore)}` },
    { k: 'Avg comments/post', v: analysis.avgComments },
    { k: 'C/P ratio', v: `${analysis.ratio}:1` },
    { k: 'Top content type', v: topTypeLbl },
    { k: 'Comment style', v: `${lenDesc} (~${avgComLen} chars)` },
    { k: 'Awards earned', v: analysis.awards || 0 },
  ];
  wrap.innerHTML = rows.map(r => `
    <div class="ss-data-row">
      <span class="ss-data-key">${r.k}</span>
      <span class="ss-data-val">${r.v}</span>
    </div>`).join('');
}

function buildTraits(profile, posts, comments, analysis) {
  const traits = [];
  if (analysis.sentimentScore > 70)            traits.push('😊 Positive Vibes');
  if (analysis.sentimentScore < 35)            traits.push('🌩 Contrarian');
  if (analysis.sentimentScore > 40 && analysis.sentimentScore <= 60) traits.push('⚖️ Balanced');
  if (analysis.avgPostScore > 1000)            traits.push('🚀 Viral Creator');
  else if (analysis.avgPostScore > 500)        traits.push('🔥 Top Performer');
  else if (analysis.avgPostScore > 100)        traits.push('⭐ High Engagement');
  if (Number(analysis.ratio) > 20)             traits.push('💬 Super Commenter');
  else if (Number(analysis.ratio) > 8)         traits.push('💬 Discussion Lover');
  if (Number(analysis.postsPerMonth) > 30)     traits.push('⚡ Power Poster');
  else if (Number(analysis.postsPerMonth) > 10) traits.push('📅 Active Contributor');
  if (analysis.topSubs.length === 1)           traits.push('🎯 Niche Specialist');
  else if (analysis.topSubs.length >= 6)       traits.push('🌐 Wide Reach');
  if (profile.is_gold)                         traits.push('★ Reddit Premium');
  if (profile.has_verified_email)              traits.push('✓ Verified');
  if (analysis.awards > 30)                    traits.push('🏆 Award Magnet');
  else if (analysis.awards > 10)               traits.push('🏅 Award Winner');
  if (analysis.controversiality > 35)          traits.push('⚡ Controversial');
  if (profile.is_employee)                     traits.push('🏢 Reddit Staff');
  // Night / morning
  const nightPosts = analysis.hourDist ? analysis.hourDist.slice(22).concat(analysis.hourDist.slice(0,5)).reduce((a,b)=>a+b,0) : 0;
  const totalAct   = analysis.hourDist ? analysis.hourDist.reduce((a,b)=>a+b,0) || 1 : 1;
  if (nightPosts/totalAct > 0.3)               traits.push('🦉 Night Owl');
  const morningPosts = analysis.hourDist ? analysis.hourDist.slice(6,10).reduce((a,b)=>a+b,0) : 0;
  if (morningPosts/totalAct > 0.35)            traits.push('🌅 Early Bird');
  return traits.slice(0, 10);
}
// ── Actions ───────────────────────────────────────────────────────
function setupActions(profile, analysis) {
  copyBtn.onclick = async () => {
    await navigator.clipboard.writeText(window._currentSummary || '').catch(() => {});
    const orig = copyBtn.innerHTML;
    copyBtn.innerHTML = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M5 10l4 4L15 6"/></svg> Copied!';
    setTimeout(() => { copyBtn.innerHTML = orig; }, 2000);
  };

  downloadBtn.onclick = () => generatePDF(profile, analysis);

  shareBtn.onclick = () => {
    const url = `https://www.reddit.com/user/${profile.name}`;
    if (navigator.share) {
      navigator.share({ title: `Reddit Profile: u/${profile.name}`, url }).catch(()=>{});
    } else {
      navigator.clipboard.writeText(url).catch(()=>{});
      const orig = shareBtn.innerHTML;
      shareBtn.innerHTML = '✓ URL Copied';
      setTimeout(() => { shareBtn.innerHTML = orig; }, 2000);
    }
  };
}

// ── PDF Generation ────────────────────────────────────────────────
function generatePDF(profile, analysis) {
  const total  = (profile.link_karma||0) + (profile.comment_karma||0);
  const name   = profile.name;
  const DAYS   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const HOURS  = ['12am','1am','2am','3am','4am','5am','6am','7am','8am','9am','10am','11am',
                  '12pm','1pm','2pm','3pm','4pm','5pm','6pm','7pm','8pm','9pm','10pm','11pm'];

  // Personality type
  let ptCode = '—', ptName = '—', ptTagline = '';
  try {
    const axes = computePersonalityAxes(profile, window._currentPosts||[], window._currentComments||[], analysis);
    const type = derivePersonalityType(axes);
    ptCode    = type.code;
    ptName    = type.name;
    ptTagline = type.tagline;
  } catch(_) {}

  // Report card grades
  function scoreToGrade(s) {
    if (s >= 93) return { l:'A+', c:'#06d6a0' };
    if (s >= 90) return { l:'A',  c:'#06d6a0' };
    if (s >= 87) return { l:'A−', c:'#4cc9f0' };
    if (s >= 83) return { l:'B+', c:'#4cc9f0' };
    if (s >= 80) return { l:'B',  c:'#9b5de5' };
    if (s >= 77) return { l:'B−', c:'#9b5de5' };
    if (s >= 73) return { l:'C+', c:'#f0b429' };
    if (s >= 70) return { l:'C',  c:'#f0b429' };
    if (s >= 60) return { l:'D',  c:'#ff6b6b' };
    return              { l:'F',  c:'#ff4500' };
  }
  const cScore = Math.min(100, Math.round(Math.log10(Math.max(analysis.avgPostScore,1)+1)/Math.log10(5001)*100));
  const rScore = Math.min(100, Math.round(Math.min(parseFloat(analysis.postsPerMonth),30)/30*100));
  const cpScore= Math.min(100, Math.round(analysis.topSubs.length/10*100));
  const eScore = Math.min(100, Math.round(Math.min(Number(analysis.ratio),20)/20*100));
  const vScore = analysis.sentimentScore;
  const kScore = Math.min(100, Math.round(Math.log10(Math.max(total,1)+1)/Math.log10(1e7+1)*100));
  const rcSubjects = [
    { icon:'📄', name:'Content Quality',   score:cScore  },
    { icon:'📅', name:'Consistency',        score:rScore  },
    { icon:'🌐', name:'Community Presence', score:cpScore },
    { icon:'💬', name:'Engagement',         score:eScore  },
    { icon:'😊', name:'Positive Vibes',     score:vScore  },
    { icon:'⬆️', name:'Karma Accumulated',  score:kScore  },
  ];
  const avgGpa = (rcSubjects.reduce((s,x)=>{
    const g=scoreToGrade(x.score);
    const pts = g.l==='A+'?4:g.l==='A'?4:g.l==='A−'?3.7:g.l==='B+'?3.3:g.l==='B'?3:g.l==='B−'?2.7:g.l==='C+'?2.3:g.l==='C'?2:g.l==='D'?1:0;
    return s+pts;
  }, 0) / rcSubjects.length).toFixed(2);

  // Personality bars
  const pbars = [
    { label:'Positivity',  val:analysis.sentimentScore, color:'#06d6a0' },
    { label:'Engagement',  val:Math.min(100,Math.round((analysis.avgPostScore/2000)*100)), color:'#ff4500' },
    { label:'Discussion',  val:Math.min(100,Math.round((parseFloat(analysis.ratio)/20)*100)), color:'#9b5de5' },
    { label:'Activity',    val:Math.min(100,Math.round((parseFloat(analysis.postsPerMonth)/30)*100)), color:'#f0b429' },
    { label:'Controversy', val:analysis.controversiality, color:'#f72585' },
    { label:'Reach',       val:Math.min(100,analysis.topSubs.length*14), color:'#4cc9f0' },
  ];

  // Build trait chips html
  const traitsHTML = (() => {
    const el = document.getElementById('summaryTraits');
    return el ? Array.from(el.querySelectorAll('.trait-chip')).map(c =>
      `<span style="font-family:monospace;font-size:10px;padding:3px 10px;border-radius:100px;border:1px solid #333;color:#aaa;background:rgba(255,255,255,0.04);white-space:nowrap;">${c.textContent}</span>`
    ).join('') : '';
  })();

  // Top words
  const topWords = analysis.wordFreq.slice(0,20);

  // Avatar src
  const avSrc = document.getElementById('profileAvatar')?.src || '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>RedditScope Report — u/${name}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=JetBrains+Mono:wght@400;600&display=swap');
  *{box-sizing:border-box;margin:0;padding:0;}
  html{font-size:14px;}
  body{background:#07070d;color:#f0eee8;font-family:'DM Sans',system-ui,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  a{color:inherit;text-decoration:none;}

  /* ── Page layout ── */
  .page{max-width:820px;margin:0 auto;padding:40px 36px;}

  /* ── Cover ── */
  .cover{
    background:linear-gradient(135deg,rgba(255,69,0,0.12) 0%,rgba(155,93,229,0.08) 100%);
    border:1px solid rgba(255,69,0,0.25);border-radius:20px;
    padding:40px;margin-bottom:28px;
    display:flex;align-items:center;gap:28px;position:relative;overflow:hidden;
  }
  .cover::before{
    content:'';position:absolute;top:0;left:0;right:0;height:2px;
    background:linear-gradient(90deg,transparent,#ff4500,#9b5de5,transparent);
  }
  .cover-avatar{
    width:88px;height:88px;border-radius:50%;object-fit:cover;
    border:2px solid rgba(255,69,0,0.5);flex-shrink:0;
    background:#1a1a2e;
  }
  .cover-info{flex:1;min-width:0;}
  .cover-name{font-size:28px;font-weight:600;letter-spacing:-0.02em;margin-bottom:6px;color:#f0eee8;}
  .cover-badges{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;}
  .cover-badge{
    font-family:'JetBrains Mono',monospace;font-size:9px;letter-spacing:0.1em;
    padding:3px 9px;border-radius:100px;border:1px solid rgba(255,255,255,0.15);
    color:#aaa;
  }
  .cover-since{font-family:'JetBrains Mono',monospace;font-size:11px;color:#6e6a76;}
  .cover-karma{text-align:right;flex-shrink:0;}
  .cover-karma-num{font-size:30px;font-weight:700;color:#ff4500;line-height:1;}
  .cover-karma-lbl{font-family:'JetBrains Mono',monospace;font-size:9px;color:#6e6a76;letter-spacing:0.15em;margin-top:3px;}
  .persona-pill{
    position:absolute;top:16px;right:16px;
    background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);
    padding:4px 12px;border-radius:100px;
    font-family:'JetBrains Mono',monospace;font-size:10px;color:#c8c4bc;
    display:flex;align-items:center;gap:6px;
  }

  /* ── Generated stamp ── */
  .stamp{
    text-align:right;font-family:'JetBrains Mono',monospace;
    font-size:10px;color:#6e6a76;margin-bottom:24px;
    letter-spacing:0.06em;
  }

  /* ── Section header ── */
  .sec{margin-bottom:20px;margin-top:28px;}
  .sec-tag{font-family:'JetBrains Mono',monospace;font-size:9px;letter-spacing:0.28em;color:#ff4500;display:block;margin-bottom:3px;}
  .sec-title{font-size:18px;font-weight:600;color:#f0eee8;letter-spacing:-0.01em;}

  /* ── Metrics grid ── */
  .mgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:4px;}
  .mcard{
    background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);
    border-radius:12px;padding:14px 12px;
  }
  .mcard-icon{font-size:16px;margin-bottom:6px;}
  .mcard-val{font-size:20px;font-weight:700;color:#f0eee8;line-height:1;margin-bottom:3px;}
  .mcard-lbl{font-family:'JetBrains Mono',monospace;font-size:8px;letter-spacing:0.12em;color:#6e6a76;text-transform:uppercase;margin-bottom:3px;}
  .mcard-sub{font-size:10px;color:#6e6a76;}
  .good{color:#06d6a0;}.warn{color:#f0b429;}.bad{color:#ff6b6b;}

  /* ── Two-col layout ── */
  .two-col{display:grid;grid-template-columns:1fr 1fr;gap:16px;}

  /* ── Card ── */
  .card{
    background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);
    border-radius:14px;padding:20px;
  }
  .card-title{font-family:'JetBrains Mono',monospace;font-size:9px;letter-spacing:0.2em;color:#6e6a76;text-transform:uppercase;margin-bottom:14px;}

  /* ── Subreddits ── */
  .sub-row{display:flex;align-items:center;gap:10px;margin-bottom:10px;}
  .sub-row:last-child{margin-bottom:0;}
  .sub-rank{font-size:16px;font-weight:700;color:#ff4500;width:20px;text-align:center;flex-shrink:0;}
  .sub-name{font-weight:600;font-size:13px;color:#f0eee8;flex:1;}
  .sub-bar-bg{height:4px;background:rgba(255,255,255,0.08);border-radius:100px;flex:1;overflow:hidden;}
  .sub-bar-fill{height:100%;border-radius:100px;background:linear-gradient(90deg,#ff4500,#ff6b35);}
  .sub-pct{font-family:'JetBrains Mono',monospace;font-size:10px;color:#6e6a76;width:32px;text-align:right;flex-shrink:0;}

  /* ── Personality bars ── */
  .pbar-row{display:grid;grid-template-columns:90px 1fr 36px;align-items:center;gap:10px;margin-bottom:8px;}
  .pbar-row:last-child{margin-bottom:0;}
  .pbar-lbl{font-family:'JetBrains Mono',monospace;font-size:10px;color:#c8c4bc;text-align:right;}
  .pbar-track{height:5px;background:rgba(255,255,255,0.1);border-radius:100px;overflow:hidden;}
  .pbar-fill{height:100%;border-radius:100px;}
  .pbar-val{font-family:'JetBrains Mono',monospace;font-size:10px;color:#6e6a76;}

  /* ── PT card ── */
  .pt-box{
    background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);
    border-radius:14px;padding:20px;margin-bottom:4px;
  }
  .pt-code{font-family:'JetBrains Mono',monospace;font-size:36px;font-weight:700;
    background:linear-gradient(135deg,#ff4500,#9b5de5);-webkit-background-clip:text;
    -webkit-text-fill-color:transparent;background-clip:text;line-height:1;margin-bottom:6px;}
  .pt-name{font-size:20px;font-weight:600;color:#f0eee8;margin-bottom:4px;}
  .pt-tagline{font-size:12px;color:#6e6a76;font-style:italic;margin-bottom:16px;}
  .pt-two{display:grid;grid-template-columns:1fr 1fr;gap:16px;}
  .pt-block-lbl{font-family:'JetBrains Mono',monospace;font-size:9px;letter-spacing:0.2em;color:#6e6a76;text-transform:uppercase;margin-bottom:8px;}
  .pt-li{font-size:12px;color:#c8c4bc;padding-left:14px;position:relative;margin-bottom:4px;line-height:1.4;}
  .pt-li::before{content:'→';position:absolute;left:0;color:#ff4500;font-size:10px;}

  /* ── Report card ── */
  .rc-header{
    display:flex;align-items:center;gap:16px;
    background:linear-gradient(135deg,rgba(255,69,0,0.08),rgba(155,93,229,0.04));
    border-radius:14px 14px 0 0;padding:18px 22px;
    border:1px solid rgba(255,255,255,0.08);border-bottom:none;
  }
  .rc-school{font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:0.15em;color:#6e6a76;text-transform:uppercase;flex-shrink:0;}
  .rc-student{font-size:18px;font-weight:600;color:#f0eee8;flex:1;}
  .rc-gpa{font-family:'JetBrains Mono',monospace;font-size:32px;font-weight:700;line-height:1;}
  .rc-gpa-lbl{font-family:'JetBrains Mono',monospace;font-size:9px;color:#6e6a76;letter-spacing:0.2em;margin-top:2px;}
  .rc-body{
    border:1px solid rgba(255,255,255,0.08);border-radius:0 0 14px 14px;
    overflow:hidden;
  }
  .rc-row{display:grid;grid-template-columns:24px 1fr 160px 40px;align-items:center;gap:12px;padding:12px 22px;border-bottom:1px solid rgba(255,255,255,0.06);}
  .rc-row:last-child{border-bottom:none;}
  .rc-icon{font-size:16px;text-align:center;}
  .rc-sub-name{font-size:12px;font-weight:600;color:#f0eee8;}
  .rc-bar-bg{height:5px;background:rgba(255,255,255,0.08);border-radius:100px;overflow:hidden;}
  .rc-bar-fill{height:100%;border-radius:100px;}
  .rc-letter{font-family:'JetBrains Mono',monospace;font-size:16px;font-weight:700;text-align:center;}
  .rc-teacher{
    background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);
    border-radius:14px;padding:16px 20px;margin-top:10px;
  }
  .rc-tc-lbl{font-family:'JetBrains Mono',monospace;font-size:9px;letter-spacing:0.2em;color:#6e6a76;text-transform:uppercase;margin-bottom:8px;}
  .rc-tc-text{font-size:13px;color:#c8c4bc;line-height:1.7;font-style:italic;}

  /* ── Summary / overview ── */
  .overview-text{font-size:16px;line-height:1.85;color:#f0eee8;font-style:italic;margin:0;}
  .insight-text{font-size:13px;line-height:1.8;color:#c8c4bc;margin:0;}
  .traits-row{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px;}

  /* ── Word cloud ── */
  .wcloud{display:flex;flex-wrap:wrap;gap:7px;}
  .wpill{
    font-family:'JetBrains Mono',monospace;padding:4px 12px;border-radius:100px;
    border:1px solid rgba(255,255,255,0.12);color:#c8c4bc;background:rgba(255,255,255,0.04);
  }

  /* ── Best content ── */
  .best-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
  .best-card{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:16px;}
  .best-tag{font-family:'JetBrains Mono',monospace;font-size:9px;letter-spacing:0.15em;color:#6e6a76;text-transform:uppercase;margin-bottom:8px;}
  .best-sub{color:#ff4500;font-size:10px;font-family:'JetBrains Mono',monospace;margin-bottom:5px;}
  .best-title{font-size:13px;font-weight:600;color:#f0eee8;line-height:1.4;margin-bottom:8px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;}
  .best-body{font-size:12px;color:#c8c4bc;line-height:1.5;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;margin-bottom:8px;}
  .best-score{display:inline-flex;align-items:center;gap:5px;background:rgba(255,69,0,0.12);border:1px solid rgba(255,69,0,0.3);color:#ff4500;font-weight:700;font-size:11px;font-family:'JetBrains Mono',monospace;padding:3px 10px;border-radius:100px;}
  .best-day{font-size:38px;font-style:italic;color:#ff4500;line-height:1;margin-bottom:4px;}
  .best-day-sub{font-size:11px;color:#6e6a76;margin-bottom:8px;}
  .best-day-stat{font-size:12px;color:#c8c4bc;}

  /* ── Footer ── */
  .pdf-footer{
    margin-top:36px;padding-top:16px;border-top:1px solid rgba(255,255,255,0.08);
    display:flex;justify-content:space-between;align-items:center;
  }
  .pdf-footer-logo{font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:600;color:#6e6a76;}
  .pdf-footer-note{font-family:'JetBrains Mono',monospace;font-size:10px;color:#3a3840;}

  /* ── Print ── */
  @page{size:A4;margin:16mm;}
  @media print{
    body{background:#07070d!important;}
    .page{padding:0;}
    .cover,.card,.pt-box,.rc-header,.rc-body,.rc-teacher,.mcard,.best-card,.summary-card-pdf{
      -webkit-print-color-adjust:exact;print-color-adjust:exact;
    }
    .sec{page-break-inside:avoid;}
    .cover{page-break-after:avoid;}
  }
</style>
</head>
<body>
<div class="page">

  <!-- COVER -->
  <div class="cover">
    <img class="cover-avatar" src="${avSrc}" alt="avatar" onerror="this.style.display='none'"/>
    <div class="cover-info">
      <div class="cover-name">u/${escapeHTML(name)}</div>
      <div class="cover-badges">
        <span class="cover-badge">🎂 ${accountAge(profile.created_utc)} old</span>
        ${profile.is_gold ? '<span class="cover-badge" style="color:#f0b429;border-color:#f0b429;">★ Premium</span>' : ''}
        ${profile.has_verified_email ? '<span class="cover-badge" style="color:#06d6a0;border-color:#06d6a0;">✓ Verified</span>' : ''}
        ${profile.is_employee ? '<span class="cover-badge" style="color:#4cc9f0;border-color:#4cc9f0;">🏢 Reddit Staff</span>' : ''}
      </div>
      <div class="cover-since">Member since ${new Date(profile.created_utc*1000).toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'})}</div>
    </div>
    <div class="cover-karma">
      <div class="cover-karma-num">${formatNumber(total)}</div>
      <div class="cover-karma-lbl">TOTAL KARMA</div>
    </div>
    <div class="persona-pill">${analysis.persona.icon} ${analysis.persona.label}</div>
  </div>

  <div class="stamp">RedditScope Intelligence Report · Generated ${new Date().toLocaleString()}</div>

  <!-- ACTIVITY METRICS -->
  <div class="sec"><span class="sec-tag">ANALYTICS</span><div class="sec-title">Activity Metrics</div></div>
  <div class="mgrid">
    <div class="mcard"><div class="mcard-val">${formatNumber(analysis.avgPostScore)}</div><div class="mcard-lbl">Avg Post Score</div><div class="mcard-sub ${analysis.avgPostScore>100?'good':analysis.avgPostScore>20?'warn':''}">${analysis.avgPostScore>500?'Exceptional':analysis.avgPostScore>100?'Above avg':analysis.avgPostScore>20?'Moderate':'Modest'}</div></div>
    <div class="mcard"><div class="mcard-val">${analysis.postsPerMonth}</div><div class="mcard-lbl">Posts / Month</div><div class="mcard-sub">Per calendar month</div></div>
    <div class="mcard"><div class="mcard-val">${analysis.sentimentScore}%</div><div class="mcard-lbl">Sentiment</div><div class="mcard-sub ${analysis.sentimentScore>55?'good':analysis.sentimentScore>40?'warn':'bad'}">${analysis.sentimentScore>70?'Very positive':analysis.sentimentScore>55?'Positive':analysis.sentimentScore>40?'Neutral':'Critical'}</div></div>
    <div class="mcard"><div class="mcard-val">${analysis.controversiality}%</div><div class="mcard-lbl">Controversiality</div><div class="mcard-sub ${analysis.controversiality>30?'bad':analysis.controversiality>15?'warn':'good'}">${analysis.controversiality>25?'Polarizing':'Uncontroversial'}</div></div>
    <div class="mcard"><div class="mcard-val">${analysis.avgComments}</div><div class="mcard-lbl">Avg Comments/Post</div><div class="mcard-sub">Engagement depth</div></div>
    <div class="mcard"><div class="mcard-val">${analysis.ratio}:1</div><div class="mcard-lbl">C/P Ratio</div><div class="mcard-sub">Comments vs posts</div></div>
    <div class="mcard"><div class="mcard-val">${formatNumber(analysis.awards)}</div><div class="mcard-lbl">Awards Earned</div><div class="mcard-sub">Community recognition</div></div>
    <div class="mcard"><div class="mcard-val">${analysis.peakDow !== undefined ? DAYS[analysis.peakDow].slice(0,3) : '—'}</div><div class="mcard-lbl">Peak Day</div><div class="mcard-sub">${HOURS[analysis.peakHour]} peak hour</div></div>
  </div>

  <!-- TOP SUBREDDITS -->
  <div class="sec"><span class="sec-tag">COMMUNITIES</span><div class="sec-title">Top Subreddits</div></div>
  <div class="card">
    ${analysis.topSubs.map((s,i)=>{
      const maxC = analysis.topSubs[0].count;
      const relPct = Math.round((s.count/maxC)*100);
      return `<div class="sub-row">
        <div class="sub-rank">${i+1}</div>
        <div class="sub-name">r/${escapeHTML(s.name)}</div>
        <div class="sub-bar-bg" style="width:140px"><div class="sub-bar-fill" style="width:${relPct}%"></div></div>
        <div class="sub-pct">${s.pct}%</div>
        <div style="font-family:monospace;font-size:10px;color:#6e6a76;width:60px;text-align:right;">${s.count} actions</div>
      </div>`;
    }).join('')}
  </div>

  <!-- BEST CONTENT -->
  <div class="sec"><span class="sec-tag">HIGHLIGHTS</span><div class="sec-title">Best Content</div></div>
  <div class="best-grid">
    <div class="best-card">
      <div class="best-tag">🏆 Most Upvoted Post</div>
      ${analysis.topPost ? `
        <div class="best-sub">r/${escapeHTML(analysis.topPost.subreddit)}</div>
        <div class="best-title">${escapeHTML(analysis.topPost.title)}</div>
        <div class="best-score">▲ ${formatNumber(analysis.topPost.score)} upvotes</div>` :
        '<p style="color:#6e6a76">No posts found.</p>'}
    </div>
    <div class="best-card">
      <div class="best-tag">💎 Most Upvoted Comment</div>
      ${analysis.topComment ? `
        <div class="best-sub">r/${escapeHTML(analysis.topComment.subreddit)}</div>
        <div class="best-body">${escapeHTML((analysis.topComment.body||'').substring(0,220))}</div>
        <div class="best-score">▲ ${formatNumber(analysis.topComment.score)} upvotes</div>` :
        '<p style="color:#6e6a76">No comments found.</p>'}
    </div>
  </div>

  <!-- PERSONALITY DIMENSIONS -->
  <div class="sec"><span class="sec-tag">PSYCHOLOGY</span><div class="sec-title">Personality Dimensions</div></div>
  <div class="two-col">
    <div class="card">
      <div class="card-title">Personality Bars</div>
      ${pbars.map(p=>`
        <div class="pbar-row">
          <div class="pbar-lbl">${p.label}</div>
          <div class="pbar-track"><div class="pbar-fill" style="width:${p.val}%;background:${p.color};"></div></div>
          <div class="pbar-val">${p.val}%</div>
        </div>`).join('')}
    </div>
    <div class="card">
      <div class="card-title">Personality Type</div>
      <div class="pt-code">${ptCode}</div>
      <div class="pt-name">${escapeHTML(ptName)}</div>
      <div class="pt-tagline">${escapeHTML(ptTagline)}</div>
    </div>
  </div>

  <!-- REPORT CARD -->
  <div class="sec"><span class="sec-tag">GRADES</span><div class="sec-title">Reddit Report Card</div></div>
  <div class="rc-header">
    <div class="rc-school">⚡ RedditScope Academy</div>
    <div class="rc-student">u/${escapeHTML(name)}</div>
    <div style="text-align:center;">
      <div class="rc-gpa" style="color:${scoreToGrade(parseFloat(avgGpa)/4*100).c}">${avgGpa}</div>
      <div class="rc-gpa-lbl">GPA</div>
    </div>
  </div>
  <div class="rc-body">
    ${rcSubjects.map(s=>{
      const g = scoreToGrade(s.score);
      return `<div class="rc-row">
        <div class="rc-icon">${s.icon}</div>
        <div class="rc-sub-name">${s.name}</div>
        <div class="rc-bar-bg"><div class="rc-bar-fill" style="width:${s.score}%;background:${g.c}"></div></div>
        <div class="rc-letter" style="color:${g.c}">${g.l}</div>
      </div>`;
    }).join('')}
  </div>

  <!-- LANGUAGE FINGERPRINT -->
  <div class="sec"><span class="sec-tag">LINGUISTICS</span><div class="sec-title">Language Fingerprint</div></div>
  <div class="card">
    <div class="wcloud">
      ${topWords.map(([w,f],i)=>{
        const maxF = topWords[0][1];
        const sz = 10 + Math.round((f/maxF)*10);
        const op = 0.5 + (f/maxF)*0.5;
        return `<span class="wpill" style="font-size:${sz}px;opacity:${op}">${escapeHTML(w)}</span>`;
      }).join('')}
    </div>
  </div>

  <!-- AI OVERVIEW -->
  <div class="sec"><span class="sec-tag">AI ANALYSIS</span><div class="sec-title">Intelligence Overview</div></div>
  <div class="card">
    <p class="overview-text">${escapeHTML(window._currentSummary||'')}</p>
  </div>

  <!-- BEHAVIORAL INSIGHT -->
  <div class="sec"><span class="sec-tag">BEHAVIORAL INSIGHT</span></div>
  <div class="card">
    <p class="insight-text">${escapeHTML((document.getElementById('behavioralInsight')||{}).textContent||'')}</p>
    <div class="traits-row">${traitsHTML}</div>
  </div>

  <!-- FOOTER -->
  <div class="pdf-footer">
    <div class="pdf-footer-logo">RedditScope · Intelligence Report</div>
    <div class="pdf-footer-note">Powered by Reddit's public API · Not affiliated with Reddit, Inc.</div>
  </div>

</div>
<script>
  window.onload = () => {
    setTimeout(() => { window.print(); }, 600);
  };
<\/script>
</body>
</html>`;

  const popup = window.open('', `reddit-report-${name}`,
    'width=900,height=700,scrollbars=yes,resizable=yes');
  if (!popup) {
    alert('Pop-up blocked! Please allow pop-ups for this site and try again.');
    return;
  }
  popup.document.open();
  popup.document.write(html);
  popup.document.close();
}



// ================================================================
//  DIG DEEP — Full post + comment browser
// ================================================================
(function initDigDeep() {
  const btn = document.getElementById('digDeepBtn');
  if (!btn) return;

  let ddItems     = [];   // all items (posts + comments) for current user
  let ddFiltered  = [];   // after search + filter
  let ddFilter    = 'all';
  let ddSort      = 'date-desc';
  let ddPage      = 0;
  const DD_PAGE_SIZE = 25;

  // ── Open panel and populate ──────────────────────────────────────
  btn.addEventListener('click', async () => {
    const panel = document.getElementById('digDeepPanel');
    const posts    = window._currentPosts    || [];
    const comments = window._currentComments || [];
    const profile  = window._currentProfile  || {};

    if (!posts.length && !comments.length) return;

    // Show panel, scroll to it
    panel.hidden = false;
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    btn.textContent = '✓ Digging Deep';
    btn.disabled = true;

    // Build unified item list if not already built for this user
    if (!ddItems.length || ddItems[0]?._username !== profile.name) {
      ddItems = [];

      posts.forEach(p => {
        const link = p.permalink
          ? `https://reddit.com${p.permalink}`
          : `https://reddit.com/r/${p.subreddit}/comments/${p.id}`;
        ddItems.push({
          _username: profile.name,
          type:    'post',
          id:      p.id,
          title:   p.title || '(untitled)',
          body:    p.selftext || '',
          sub:     p.subreddit || '',
          score:   p.score || 0,
          comments:p.num_comments || 0,
          date:    p.created_utc || 0,
          link,
          upvoteRatio: p.upvote_ratio || null,
        });
      });

      comments.forEach(c => {
        const link = c.permalink
          ? `https://reddit.com${c.permalink}`
          : c.link_permalink
            ? c.link_permalink
            : `https://reddit.com/r/${c.subreddit}/comments/${c.link_id?.replace('t3_','')}`;
        ddItems.push({
          _username: profile.name,
          type:    'comment',
          id:      c.id,
          title:   c.link_title || '(context unavailable)',
          body:    c.body || '',
          sub:     c.subreddit || '',
          score:   c.score || 0,
          date:    c.created_utc || 0,
          link,
        });
      });
    }

    ddPage = 0;
    ddFilter = 'all';
    ddSort   = 'date-desc';

    // Reset filter buttons
    document.querySelectorAll('.dd-filter').forEach(b => {
      b.classList.toggle('active', b.dataset.filter === 'all');
    });
    const sortEl = document.getElementById('ddSort');
    if (sortEl) sortEl.value = 'date-desc';

    applyDDFilter();
  });

  // ── Filter buttons ───────────────────────────────────────────────
  document.addEventListener('click', e => {
    const fb = e.target.closest('.dd-filter');
    if (!fb) return;
    document.querySelectorAll('.dd-filter').forEach(b => b.classList.remove('active'));
    fb.classList.add('active');
    ddFilter = fb.dataset.filter;
    ddPage = 0;
    applyDDFilter();
  });

  // ── Sort select ──────────────────────────────────────────────────
  document.addEventListener('change', e => {
    if (e.target.id !== 'ddSort') return;
    ddSort = e.target.value;
    ddPage = 0;
    applyDDFilter();
  });

  // ── Search ───────────────────────────────────────────────────────
  let ddSearchTimer;
  document.addEventListener('input', e => {
    if (e.target.id !== 'ddSearch') return;
    clearTimeout(ddSearchTimer);
    ddSearchTimer = setTimeout(() => {
      ddPage = 0;
      applyDDFilter();
    }, 220);
  });

  // ── Core filter + sort + render pipeline ─────────────────────────
  function applyDDFilter() {
    const query = (document.getElementById('ddSearch')?.value || '').toLowerCase().trim();

    ddFiltered = ddItems.filter(item => {
      if (ddFilter === 'posts'    && item.type !== 'post')    return false;
      if (ddFilter === 'comments' && item.type !== 'comment') return false;
      if (query) {
        const haystack = `${item.title} ${item.body} ${item.sub}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });

    // Sort
    ddFiltered.sort((a, b) => {
      switch (ddSort) {
        case 'date-asc':   return a.date - b.date;
        case 'score-desc': return b.score - a.score;
        case 'score-asc':  return a.score - b.score;
        default:           return b.date - a.date; // date-desc
      }
    });

    renderDDStats();
    renderDDPage();
    renderDDPagination();
  }

  // ── Stats bar ────────────────────────────────────────────────────
  function renderDDStats() {
    const el = document.getElementById('ddStatsRow');
    if (!el) return;
    const posts    = ddFiltered.filter(i => i.type === 'post').length;
    const comments = ddFiltered.filter(i => i.type === 'comment').length;
    const totalScore = ddFiltered.reduce((s,i) => s + i.score, 0);
    const pages = Math.ceil(ddFiltered.length / DD_PAGE_SIZE);
    el.innerHTML = `
      <div class="dd-stat"><span class="dd-stat-val">${ddFiltered.length.toLocaleString()}</span><span class="dd-stat-lbl">Results</span></div>
      <div class="dd-stat-div"></div>
      <div class="dd-stat"><span class="dd-stat-val">${posts.toLocaleString()}</span><span class="dd-stat-lbl">Posts</span></div>
      <div class="dd-stat-div"></div>
      <div class="dd-stat"><span class="dd-stat-val">${comments.toLocaleString()}</span><span class="dd-stat-lbl">Comments</span></div>
      <div class="dd-stat-div"></div>
      <div class="dd-stat"><span class="dd-stat-val">${totalScore >= 1000 ? (totalScore/1000).toFixed(1)+'K' : totalScore}</span><span class="dd-stat-lbl">Total Score</span></div>
      ${pages > 1 ? `<div class="dd-stat-div"></div><div class="dd-stat"><span class="dd-stat-val">${ddPage+1}/${pages}</span><span class="dd-stat-lbl">Page</span></div>` : ''}
    `;
  }

  // ── Render current page of items ─────────────────────────────────
  function renderDDPage() {
    const list = document.getElementById('ddList');
    if (!list) return;

    const start = ddPage * DD_PAGE_SIZE;
    const slice = ddFiltered.slice(start, start + DD_PAGE_SIZE);

    if (!slice.length) {
      list.innerHTML = '<div class="dd-empty">No results found.</div>';
      return;
    }

    list.innerHTML = slice.map((item, idx) => {
      const isPost    = item.type === 'post';
      const dateStr   = item.date ? new Date(item.date * 1000).toLocaleDateString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric'
      }) : '';
      const bodyPreview = item.body
        ? item.body.replace(/\n+/g, ' ').substring(0, 200) + (item.body.length > 200 ? '…' : '')
        : '';

      return `<div class="dd-item dd-item--${item.type}" style="animation-delay:${idx * 0.02}s">
        <div class="dd-item-header">
          <span class="dd-type-badge dd-type-badge--${item.type}">${isPost ? '📄 Post' : '💬 Comment'}</span>
          <span class="dd-sub">r/${escapeHTML(item.sub)}</span>
          <span class="dd-date">${dateStr}</span>
        </div>
        ${isPost
          ? `<div class="dd-title">${escapeHTML(item.title)}</div>`
          : `<div class="dd-context-title">In: <em>${escapeHTML(item.title)}</em></div>`
        }
        ${bodyPreview ? `<div class="dd-body">${escapeHTML(bodyPreview)}</div>` : ''}
        <div class="dd-item-foot">
          <span class="dd-score">▲ ${item.score.toLocaleString()}</span>
          ${isPost && item.comments !== undefined
            ? `<span class="dd-comments">💬 ${item.comments.toLocaleString()}</span>`
            : ''}
          ${isPost && item.upvoteRatio != null
            ? `<span class="dd-ratio">${Math.round(item.upvoteRatio * 100)}% upvoted</span>`
            : ''}
          <a class="dd-link" href="${escapeHTML(item.link)}" target="_blank" rel="noopener noreferrer">
            View on Reddit ↗
          </a>
        </div>
      </div>`;
    }).join('');
  }

  // ── Pagination controls ──────────────────────────────────────────
  function renderDDPagination() {
    const el = document.getElementById('ddPagination');
    if (!el) return;
    const total = Math.ceil(ddFiltered.length / DD_PAGE_SIZE);
    if (total <= 1) { el.innerHTML = ''; return; }

    const maxBtns = 7;
    let start = Math.max(0, ddPage - 3);
    let end   = Math.min(total, start + maxBtns);
    if (end - start < maxBtns) start = Math.max(0, end - maxBtns);

    const btns = [];
    if (ddPage > 0) btns.push(`<button class="dd-pg-btn" data-pg="${ddPage-1}">← Prev</button>`);
    for (let i = start; i < end; i++) {
      btns.push(`<button class="dd-pg-btn${i === ddPage ? ' active' : ''}" data-pg="${i}">${i+1}</button>`);
    }
    if (ddPage < total - 1) btns.push(`<button class="dd-pg-btn" data-pg="${ddPage+1}">Next →</button>`);
    el.innerHTML = btns.join('');
  }

  // Pagination click delegation
  document.addEventListener('click', e => {
    const pgBtn = e.target.closest('.dd-pg-btn');
    if (!pgBtn) return;
    ddPage = parseInt(pgBtn.dataset.pg, 10);
    renderDDStats();
    renderDDPage();
    renderDDPagination();
    document.getElementById('digDeepPanel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

})();
// ── UI Helpers ────────────────────────────────────────────────────
function setLoading(active) {
  analyzeBtn.disabled = active;
  if (active) {
    hero.style.display = 'none';
    loadingSection.hidden = false;
    results.hidden = true;
  } else {
    loadingSection.hidden = true;
    // Caller is responsible for what comes next — don't restore hero here
  }
}

function resetSteps() { steps.forEach(s => { s.className = 'pipe-step'; }); }

function setStep(index, state) {
  steps.forEach((s, i) => {
    if (i < index)        s.className = 'pipe-step done';
    else if (i === index) s.className = `pipe-step ${state}`;
    else                  s.className = 'pipe-step';
  });
}

function updateLoadingLabel(t) { if (loadingLabel) loadingLabel.textContent = t; }
function showError(msg) { errorMsg.textContent = msg; }
function clearError()   { errorMsg.textContent = ''; }

function animateIn() {
  // CSS class animation — never sets inline opacity/transform which breaks grid/flex on mobile
  const els = results.querySelectorAll(
    '.profile-hero, .stats-ticker, .section-header, ' +
    '.metrics-grid, .metric-card, .charts-row, .chart-card, ' +
    '.chart-heatmap, .card, .subs-card, .words-card, ' +
    '.best-grid, .best-card, .pt-card, .rc-card, .roast-card, .summary-card, .back-row'
  );
  els.forEach((el, i) => {
    el.classList.remove('anim-ready', 'anim-done');
    // Force a reflow so transition fires even if class was already present
    void el.offsetWidth;
    el.classList.add('anim-ready');
    setTimeout(() => el.classList.add('anim-done'), 50 + i * 40);
  });
}

function animateCounter(el, targetNum, suffix, duration) {
  if (!el) return;
  // If called with just element (legacy), read from textContent
  if (targetNum === undefined) {
    const val = el.textContent;
    targetNum = parseFloat(val.replace(/[^0-9.]/g,''));
    if (isNaN(targetNum) || targetNum < 10) return;
    suffix = val.replace(/[0-9.,]/g,'');
    duration = 800;
  }
  suffix = suffix || '';
  duration = duration || 800;
  const fps = 60, steps = duration / (1000 / fps);
  let step = 0;
  const tick = () => {
    step++;
    const progress = step / steps;
    const eased = 1 - Math.pow(1 - progress, 3);
    const cur = Math.round(targetNum * eased);
    el.textContent = cur + suffix;
    if (step < steps) requestAnimationFrame(tick);
    else el.textContent = targetNum + suffix;
  };
  requestAnimationFrame(tick);
}

// ── Utilities ─────────────────────────────────────────────────────
function accountAge(ts) {
  const s = Date.now()/1000 - ts;
  const y = Math.floor(s / (60*60*24*365));
  const m = Math.floor((s % (60*60*24*365)) / (60*60*24*30));
  if (y === 0) return `${m} month${m!==1?'s':''}`;
  if (m === 0) return `${y} year${y!==1?'s':''}`;
  return `${y} year${y!==1?'s':''}, ${m} month${m!==1?'s':''}`;
}

function formatNumber(n) {
  n = Number(n);
  if (isNaN(n)) return '0';
  if (n >= 1e6) return (n/1e6).toFixed(1)+'M';
  if (n >= 1e3) return (n/1e3).toFixed(1)+'K';
  return n.toString();
}

function escapeHTML(str) {
  return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function defaultAvatar() {
  return `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="88" height="88" viewBox="0 0 88 88"><circle cx="44" cy="44" r="44" fill="%23ff4500"/><text x="50%25" y="56%25" dominant-baseline="middle" text-anchor="middle" font-size="40" fill="white" font-family="serif">?</text></svg>`;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ================================================================
//  PERSONALITY TYPE SYSTEM
// ================================================================
function computePersonalityAxes(profile, posts, comments, analysis) {
  // Axis 1: Creator (C) vs Commenter (K) — based on post/comment ratio
  const ratio = Number(analysis.ratio);
  const creatorScore = Math.round(Math.max(0, Math.min(100, 100 - (ratio / 20) * 100)));

  // Axis 2: Viral (V) vs Intimate (I) — based on avg score & comment engagement
  const viralScore = Math.round(Math.min(100, (analysis.avgPostScore / 500) * 100));

  // Axis 3: Positive (P) vs Critical (X) — sentiment
  const positiveScore = analysis.sentimentScore;

  // Axis 4: Focused (F) vs Broad (B) — subreddit diversity
  const focusedScore = Math.round(Math.max(0, Math.min(100, 100 - (analysis.topSubs.length / 10) * 100)));

  return { creatorScore, viralScore, positiveScore, focusedScore };
}

function derivePersonalityType(axes) {
  const C = axes.creatorScore >= 50; // Creator vs Commenter
  const V = axes.viralScore >= 50;   // Viral vs Intimate
  const P = axes.positiveScore >= 50;// Positive vs Critical
  const F = axes.focusedScore >= 50; // Focused vs Broad

  const code = `${C?'C':'K'}${V?'V':'I'}${P?'P':'X'}${F?'F':'B'}`;

  const TYPES = {
    'CVPF': { name: 'The Vanguard',      tagline: 'A trailblazing creator who dominates their niche with viral positivity.',
               strengths: ['Consistently high upvote counts','Focused expertise builds real authority','Positivity attracts loyal followers'],
               weaknesses: ['May miss trends outside their comfort zone','Can come across as a sycophant','Niche focus limits broader influence'],
               similar: ['GallowBoob','MrPeanutbutter'] },
    'CVPB': { name: 'The Social Architect', tagline: 'A popular creator spreading good vibes across many communities.',
               strengths: ['Wide reach across Reddit','High engagement and likability','Sets the tone in multiple subs'],
               weaknesses: ['Spread thin — depth suffers for breadth','Risk of becoming a content machine','May lack a dedicated audience'],
               similar: ['spez','a viral meme creator'] },
    'CVXF': { name: 'The Provocateur',   tagline: 'A niche creator who thrives on controversy and heated takes.',
               strengths: ['Commands attention in their domain','Fearless opinions generate discussion','Creates memorable content'],
               weaknesses: ['Alienates potential allies','Reputation for negativity lingers','High risk of ban in sensitive subs'],
               similar: ['A hot-take specialist','debate sub regular'] },
    'CVXB': { name: 'The Firestarter',   tagline: 'Drops controversial content across Reddit and watches it burn.',
               strengths: ['Excellent at generating discussion','Fearless and uncensored voice','High virality potential'],
               weaknesses: ['Leaves a trail of drama','Banned in more subs than average','Hard to build long-term credibility'],
               similar: ['A classic internet troll','AMA bomb thrower'] },
    'CIVPF': { name: 'The Craftsman',    tagline: 'Quietly crafts quality niche content that earns loyal respect.',
               strengths: ['Deep expertise in their field','Consistent and reliable output','Trusted voice in their community'],
               weaknesses: ['Struggles to break out of niche','Low virality ceiling','Often underappreciated by outsiders'],
               similar: ['A subreddit wiki maintainer','hobby expert'] },
    'CIVPB': { name: 'The Wanderer',     tagline: 'A curious creator who posts good stuff wherever inspiration strikes.',
               strengths: ['Versatile and adaptable','Always fresh perspective','Good across many topics'],
               weaknesses: ['Jack of all trades, master of none','No consistent audience','Posts can feel scattered'],
               similar: ['A casual Redditor','hobbyist poster'] },
    'CIVXF': { name: 'The Specialist',   tagline: 'A focused, low-key creator who takes no prisoners in their niche.',
               strengths: ['Deep niche knowledge','Straightforward and no-nonsense','Highly respected by insiders'],
               weaknesses: ['Can come off as dismissive','Low crossover appeal','Critical tone repels newcomers'],
               similar: ['A technical sub expert','contrarian hobbyist'] },
    'CIVXB': { name: 'The Drifter',      tagline: 'Floats across Reddit, leaving critical opinions in the wake.',
               strengths: ['Broad knowledge base','Honest and unfiltered','Always has an opinion'],
               weaknesses: ['No real community home','Reputation for negativity','Posts often go unnoticed'],
               similar: ['A serial lurker turned critic','thread hopper'] },
    'KVPF': { name: 'The Ambassador',    tagline: 'The warmest presence in their subreddit — everyone loves them.',
               strengths: ['Deep community roots','Uplifting and supportive tone','Go-to person for advice'],
               weaknesses: ['Rarely creates original content','Can be seen as an enabler','Low individual name recognition'],
               similar: ['A longtime sub moderator','community pillar'] },
    'KVPB': { name: 'The Butterfly',     tagline: 'Spreads positivity across every subreddit they visit.',
               strengths: ['Universally liked','Breaks echo chambers','High comment karma magnet'],
               weaknesses: ['Comments without deep context','Surface-level engagement','Hard to pin down a specialty'],
               similar: ['A casual commenter','friendly generalist'] },
    'KVXF': { name: 'The Gatekeeper',    tagline: 'The niche community\'s fiercest defender and harshest critic.',
               strengths: ['Enforces high community standards','Deep sub knowledge','Cuts through bad takes fast'],
               weaknesses: ['Intimidates newcomers','Reputation for gatekeeping','Gets into comment wars often'],
               similar: ['A sub veteran','r/gatekeeping regular'] },
    'KVXB': { name: 'The Contrarian',    tagline: 'Roams Reddit unpacking bad takes and delivering hard truths.',
               strengths: ['Fearless in calling out BS','Broad knowledge base','Keeps discussions honest'],
               weaknesses: ['Gets downvoted frequently','Can be exhausting to interact with','Rarely wins karma'],
               similar: ['A debate sub regular','devil\'s advocate'] },
    'KIPF': { name: 'The Sage',          tagline: 'A quiet, focused commenter whose words carry real weight.',
               strengths: ['Highly trusted perspective','Thoughtful and nuanced','In-depth comment quality'],
               weaknesses: ['Low output limits influence','Can seem elitist','Hard to discover organically'],
               similar: ['A subreddit elder','expert lurker'] },
    'KIPB': { name: 'The Explorer',      tagline: 'Wanders across Reddit, leaving thoughtful observations everywhere.',
               strengths: ['Broad curiosity and knowledge','Uplifting presence','Well-regarded in many communities'],
               weaknesses: ['No persistent identity','Easy to forget','Rarely builds a following'],
               similar: ['A casual helpful commenter','curious generalist'] },
    'KIXF': { name: 'The Purist',        tagline: 'The uncompromising voice of standards in their chosen community.',
               strengths: ['Crystal-clear standards','Sub experts respect them','Never sugarcoats'],
               weaknesses: ['Abrasive to newcomers','Often misread as hostile','Low karma for the effort'],
               similar: ['A strict sub regular','rules enforcer'] },
    'KIXB': { name: 'The Phantom',       tagline: 'Appears from nowhere with a sharp comment, then vanishes.',
               strengths: ['Unpredictable and interesting','Cuts through noise efficiently','No tribal loyalty'],
               weaknesses: ['No community investment','Often misunderstood','Hard to build on reputation'],
               similar: ['A ghost account','thread sniper'] },
  };

  return { code, ...(TYPES[code] || TYPES['KIPB']) };
}

function renderPersonalityType(profile, posts, comments, analysis) {
  const axes = computePersonalityAxes(profile, posts, comments, analysis);
  const type = derivePersonalityType(axes);

  const ptCode = document.getElementById('ptCode');
  const ptName = document.getElementById('ptName');
  const ptTagline = document.getElementById('ptTagline');
  const ptAxes = document.getElementById('ptAxes');
  const ptStrengths = document.getElementById('ptStrengths');
  const ptWeaknesses = document.getElementById('ptWeaknesses');
  const ptSimilar = document.getElementById('ptSimilar');

  if (!ptCode) return;

  ptCode.textContent = type.code;
  ptName.textContent = type.name;
  ptTagline.textContent = type.tagline;

  const axisData = [
    { lo: 'Commenter', hi: 'Creator',   val: axes.creatorScore,  color: '#ff4500' },
    { lo: 'Intimate',  hi: 'Viral',     val: axes.viralScore,    color: '#9b5de5' },
    { lo: 'Critical',  hi: 'Positive',  val: axes.positiveScore, color: '#06d6a0' },
    { lo: 'Broad',     hi: 'Focused',   val: axes.focusedScore,  color: '#4cc9f0' },
  ];

  ptAxes.innerHTML = axisData.map(a => `
    <div class="pt-axis-row">
      <span class="pt-axis-lo">${a.lo}</span>
      <div class="pt-axis-track">
        <div class="pt-axis-fill" style="background:${a.color};width:0%" data-target="${a.val}%"></div>
        <div class="pt-axis-knob" style="left:${a.val}%"></div>
      </div>
      <span class="pt-axis-hi">${a.hi}</span>
      <span class="pt-axis-val">${a.val}%</span>
    </div>
  `).join('');

  // Animate axis bars
  setTimeout(() => {
    ptAxes.querySelectorAll('.pt-axis-fill').forEach(el => {
      el.style.width = el.dataset.target;
    });
    ptAxes.querySelectorAll('.pt-axis-knob').forEach((el, i) => {
      el.style.left = axisData[i].val + '%';
    });
  }, 400);

  ptStrengths.innerHTML = type.strengths.map(s => `<li>${s}</li>`).join('');
  ptWeaknesses.innerHTML = type.weaknesses.map(w => `<li>${w}</li>`).join('');
  ptSimilar.innerHTML = type.similar.map(s =>
    `<span class="pt-similar-chip">${s}</span>`
  ).join('');
}

// ================================================================
//  REPORT CARD
// ================================================================
function renderReportCard(profile, posts, comments, analysis) {
  const rcGrades = document.getElementById('rcGrades');
  const rcTeacher = document.getElementById('rcTeacherComment');
  const rcStudent = document.getElementById('rcStudent');
  const rcTerm = document.getElementById('rcTerm');
  const rcGpa = document.getElementById('rcGpa');
  const rcGpaDesc = document.getElementById('rcGpaDesc');
  if (!rcGrades) return;

  const name = profile.name;
  rcStudent.textContent = `u/${name}`;
  const joined = new Date(profile.created_utc * 1000);
  rcTerm.textContent = `Since ${joined.toLocaleDateString('en-US', { year:'numeric', month:'long' })}`;

  function scoreToGrade(score) {
    if (score >= 93) return { letter: 'A+', color: '#06d6a0', gpa: 4.0 };
    if (score >= 90) return { letter: 'A',  color: '#06d6a0', gpa: 4.0 };
    if (score >= 87) return { letter: 'A−', color: '#4cc9f0', gpa: 3.7 };
    if (score >= 83) return { letter: 'B+', color: '#4cc9f0', gpa: 3.3 };
    if (score >= 80) return { letter: 'B',  color: '#9b5de5', gpa: 3.0 };
    if (score >= 77) return { letter: 'B−', color: '#9b5de5', gpa: 2.7 };
    if (score >= 73) return { letter: 'C+', color: '#f0b429', gpa: 2.3 };
    if (score >= 70) return { letter: 'C',  color: '#f0b429', gpa: 2.0 };
    if (score >= 67) return { letter: 'C−', color: '#f0b429', gpa: 1.7 };
    if (score >= 60) return { letter: 'D',  color: '#ff6b6b', gpa: 1.0 };
    return                   { letter: 'F',  color: '#ff4500', gpa: 0.0 };
  }

  // Compute scores for each subject
  const contentScore   = Math.min(100, Math.round(Math.log10(Math.max(analysis.avgPostScore,1)+1) / Math.log10(5001) * 100));
  const consistScore   = Math.min(100, Math.round(Math.min(parseFloat(analysis.postsPerMonth), 30) / 30 * 100));
  const communityScore = Math.min(100, Math.round(analysis.topSubs.length / 10 * 100));
  const engageScore    = Math.min(100, Math.round(Math.min(Number(analysis.ratio), 20) / 20 * 100));
  const vibesScore     = analysis.sentimentScore;
  const karmaTotal     = (profile.link_karma||0) + (profile.comment_karma||0);
  const karmaScore     = Math.min(100, Math.round(Math.log10(Math.max(karmaTotal,1)+1) / Math.log10(1e7+1) * 100));

  const subjects = [
    { name: 'Content Quality',   icon: '📄', score: contentScore,   comment: 'How upvoted your posts are on average' },
    { name: 'Consistency',        icon: '📅', score: consistScore,   comment: 'Posting frequency vs. maximum cadence' },
    { name: 'Community Presence', icon: '🌐', score: communityScore, comment: 'Breadth of subreddit involvement' },
    { name: 'Engagement',         icon: '💬', score: engageScore,    comment: 'Comment-to-post ratio and interaction depth' },
    { name: 'Positive Vibes',     icon: '😊', score: vibesScore,     comment: 'Sentiment positivity across all content' },
    { name: 'Karma Accumulated',  icon: '⬆️', score: karmaScore,     comment: 'Total karma earned over account lifetime' },
  ];

  const grades = subjects.map(s => ({ ...s, grade: scoreToGrade(s.score) }));
  const gpa = (grades.reduce((sum, g) => sum + g.grade.gpa, 0) / grades.length).toFixed(2);
  const gpaGrade = scoreToGrade(parseFloat(gpa) / 4.0 * 100);

  rcGpa.textContent = gpa;
  rcGpa.style.color = gpaGrade.color;
  rcGpaDesc.textContent = parseFloat(gpa) >= 3.5 ? 'Dean\'s List' : parseFloat(gpa) >= 3.0 ? 'Honors' : parseFloat(gpa) >= 2.0 ? 'Passing' : 'Needs Improvement';

  rcGrades.innerHTML = grades.map(g => `
    <div class="rc-grade-row">
      <span class="rc-subject-icon">${g.icon}</span>
      <div class="rc-subject-info">
        <div class="rc-subject-name">${g.name}</div>
        <div class="rc-subject-comment">${g.comment}</div>
      </div>
      <div class="rc-bar-wrap">
        <div class="rc-bar-fill" style="background:${g.grade.color};width:0%" data-target="${g.score}%"></div>
      </div>
      <div class="rc-grade-letter" style="color:${g.grade.color}">${g.grade.letter}</div>
    </div>
  `).join('');

  setTimeout(() => {
    rcGrades.querySelectorAll('.rc-bar-fill').forEach(el => {
      el.style.width = el.dataset.target;
    });
  }, 400);

  // Teacher's comment
  const bestSubject = grades.reduce((a, b) => a.score > b.score ? a : b);
  const worstSubject = grades.reduce((a, b) => a.score < b.score ? a : b);
  const gpaNum = parseFloat(gpa);

  let comment;
  if (gpaNum >= 3.7) {
    comment = `${name} is an exceptional student of Reddit. Their ${bestSubject.name.toLowerCase()} is frankly outstanding, and it shows in everything they do. If they keep this up, they may qualify for the Reddit Hall of Fame. A delight to have in class.`;
  } else if (gpaNum >= 3.0) {
    comment = `${name} demonstrates solid academic performance with notable strengths in ${bestSubject.name.toLowerCase()}. There's real potential here. Could achieve even more by working on their ${worstSubject.name.toLowerCase()}. Solid student, bright future.`;
  } else if (gpaNum >= 2.0) {
    comment = `${name} is passing, but barely meeting expectations in several areas. Their ${bestSubject.name.toLowerCase()} shows promise, however their ${worstSubject.name.toLowerCase()} drags their overall performance down. Recommend office hours.`;
  } else {
    comment = `${name} needs to seriously reflect on their Reddit journey. Poor ${worstSubject.name.toLowerCase()} is holding back what little potential exists. Participation is the bare minimum — we expect more. See faculty advisor immediately.`;
  }
  rcTeacher.textContent = comment;
}

// ================================================================
//  THE ROAST
// ================================================================
function renderRoast(profile, posts, comments, analysis) {
  const roastLines = document.getElementById('roastLines');
  const roastRedemption = document.getElementById('roastRedemption');
  const roastSubtitle = document.getElementById('roastSubtitle');
  const roastHeatVal = document.getElementById('roastHeatVal');
  const roastHeatBar = document.getElementById('roastHeatBar');
  if (!roastLines) return;

  const name = `u/${profile.name}`;
  const ratio = Number(analysis.ratio);
  const freq = parseFloat(analysis.postsPerMonth);
  const sentiment = analysis.sentimentScore;
  const avgScore = analysis.avgPostScore;
  const controversy = analysis.controversiality;
  const total = (profile.link_karma||0) + (profile.comment_karma||0);
  const ageYears = (Date.now()/1000 - profile.created_utc) / (60*60*24*365);
  const avgComLen = comments.length ? Math.round(comments.reduce((s,c)=>(c.body||'').length+s,0)/comments.length) : 0;
  const topSub = analysis.topSubs[0]?.name || 'unknown';
  const nightPosts = analysis.hourDist.slice(22).concat(analysis.hourDist.slice(0,5)).reduce((a,b)=>a+b,0);
  const totalAct = analysis.hourDist.reduce((a,b)=>a+b,0) || 1;
  const isNightOwl = nightPosts / totalAct > 0.3;
  const HOURS = ['midnight','1am','2am','3am','4am','5am','6am','7am','8am','9am','10am','11am',
                 'noon','1pm','2pm','3pm','4pm','5pm','6pm','7pm','8pm','9pm','10pm','11pm'];
  const peakTime = HOURS[analysis.peakHour];

  const lines = [];
  let heat = 0;

  // Account age roasts
  if (ageYears > 10) {
    lines.push({ icon: '🧓', text: `${name} has been on Reddit for over ${Math.floor(ageYears)} years. For context, that's longer than most marriages last. At this point Reddit isn't a hobby — it's an identity crisis.` });
    heat += 15;
  } else if (ageYears < 0.5) {
    lines.push({ icon: '🐣', text: `${name}'s account is barely ${Math.round(ageYears*12)} months old and already leaving a footprint. We admire the commitment. Most people last two weeks before abandoning their account like a New Year's gym membership.` });
    heat += 8;
  }

  // Ratio roasts
  if (ratio > 30) {
    lines.push({ icon: '💬', text: `With a ${ratio}:1 comment-to-post ratio, ${name} has never once started a conversation in their life — but they'll happily insert themselves into yours. The parasocial commenter in their natural habitat.` });
    heat += 20;
  } else if (ratio < 0.3 && posts.length > 20) {
    lines.push({ icon: '📣', text: `${name} posts ${posts.length} times but rarely comments. Basically screaming into a void and walking away. The textbook definition of "doesn't read the replies."` });
    heat += 15;
  }

  // Score roasts
  if (avgScore < 5 && posts.length > 20) {
    lines.push({ icon: '📉', text: `An average post score of ${avgScore} upvotes. That's not just below average — that's "the algorithm actively hiding you" territory. Reddit's recommendation engine has quietly put ${name} on a list.` });
    heat += 25;
  } else if (avgScore > 2000) {
    lines.push({ icon: '🤩', text: `Averaging ${formatNumber(avgScore)} upvotes per post is actually impressive. Not that we'd say it to their face, but ${name} clearly knows what Reddit wants. Probably spent too long figuring that out, but here we are.` });
    heat += 5;
  }

  // Posting frequency roasts
  if (freq > 60) {
    lines.push({ icon: '⚡', text: `${freq} posts per month. That's roughly twice a day, every day. At what point does this become a clinical condition? ${name}'s search history is probably just "how to add more hours to a day."` });
    heat += 20;
  } else if (freq < 0.5 && posts.length > 0) {
    lines.push({ icon: '🦥', text: `Less than one post per month on average. ${name} treats Reddit like a gym membership — pays the attention, shows up twice a year, wonders why nothing changes.` });
    heat += 12;
  }

  // Night owl roast
  if (isNightOwl) {
    lines.push({ icon: '🦉', text: `Most active at ${peakTime}. At that hour, the only other things awake are raccoons and people making terrible decisions. ${name} has found their tribe.` });
    heat += 15;
  }

  // Sentiment roasts
  if (sentiment < 25) {
    lines.push({ icon: '😤', text: `A sentiment score of ${sentiment}% positive. To put that in perspective, even tech support bots score higher. ${name} sees Reddit as a battleground, and everyone else as combatants.` });
    heat += 22;
  } else if (sentiment > 90) {
    lines.push({ icon: '🌈', text: `${sentiment}% positive sentiment. Either ${name} is the most genuinely wholesome person online, or they've mastered the art of performative positivity so thoroughly that even the algorithm is fooled.` });
    heat += 8;
  }

  // Controversy roast
  if (controversy > 40) {
    lines.push({ icon: '🌊', text: `${controversy}% of posts are controversial (sub-60% upvote ratio). ${name} doesn't just push buttons — they rearrange the entire keyboard. Communities probably have a secret alert system for when they post.` });
    heat += 20;
  }

  // Top sub roast
  if (topSub) {
    lines.push({ icon: '🏠', text: `Their spiritual home is r/${topSub}. No further questions at this time.` });
    heat += 5;
  }

  // Comment length roast
  if (avgComLen > 800) {
    lines.push({ icon: '📜', text: `Average comment length: ${avgComLen} characters. ${name} doesn't comment — they deliver closing arguments. Reddit has TLDRs for a reason, and this person is the reason.` });
    heat += 15;
  } else if (avgComLen < 30 && comments.length > 50) {
    lines.push({ icon: '🫥', text: `Average comment is just ${avgComLen} characters long. "${name} has entered the chat" is immediately followed by "${name} has added nothing." A true ghost of the comment section.` });
    heat += 18;
  }

  // Karma roast
  if (total < 100 && ageYears > 2) {
    lines.push({ icon: '🪨', text: `After ${Math.floor(ageYears)} years on Reddit, ${name} has accumulated ${formatNumber(total)} karma. That's not a hobby — that's a grudge match between a person and the internet, and the internet is winning.` });
    heat += 20;
  }

  // Cap heat at 100
  heat = Math.min(100, Math.max(10, heat));

  roastSubtitle.textContent = heat >= 70 ? 'This one is scorched 🔥' : heat >= 40 ? 'Medium well done' : 'A light singe';

  // Redemption arc
  let redemption = '';
  if (avgScore > 500) redemption = `But in all seriousness — ${name} consistently creates content people actually upvote. That's genuinely harder than it looks, and not everyone can do it. Respect.`;
  else if (analysis.awards > 10) redemption = `Jokes aside, ${name} has earned ${analysis.awards} awards over their time here. That means real people appreciated their content enough to spend actual money on it. That's not nothing.`;
  else if (sentiment > 70) redemption = `In fairness, ${name}'s positivity is a genuine contribution to a platform that desperately needs more of it. The internet is already dark enough without them adding to it.`;
  else if (comments.length > 200) redemption = `At the end of the day, ${name} has shown up and engaged — hundreds of times. That kind of consistency is rarer than it sounds, and Reddit genuinely runs on people like that.`;
  else redemption = `Look — everyone's on Reddit for their own reasons. ${name}'s reasons may be deeply mysterious to the rest of us, but who are we to judge. They're here, they're real, they're… something.`;

  // Render
  roastLines.innerHTML = lines.map((l, i) => `
    <div class="roast-line" style="animation-delay:${i * 0.08}s">
      <span class="roast-line-icon">${l.icon}</span>
      <p class="roast-line-text">${l.text}</p>
    </div>
  `).join('');

  roastRedemption.innerHTML = `
    <div class="roast-redeem-icon">✨</div>
    <p class="roast-redeem-text">${redemption}</p>
  `;

  // Animate heat bar
  roastHeatVal.textContent = '0';
  animateCounter(roastHeatVal, heat, '', 1000);
  setTimeout(() => {
    if (roastHeatBar) {
      roastHeatBar.style.width = heat + '%';
      const heatColor = heat >= 70 ? '#ff4500' : heat >= 40 ? '#f0b429' : '#06d6a0';
      roastHeatBar.style.background = heatColor;
    }
  }, 200);
}



