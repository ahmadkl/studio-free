/* UI wiring. Depends on U, DB, Settings, Img, Chat, Puter, VideoMaker */
(function () {
  const { $, $$, toast, sleep } = U;
  const on = (sel, ev, fn) => $(sel).addEventListener(ev, fn);
  const rand = () => Math.floor(Math.random() * 2 ** 31);
  const fail = e => { if (!U.isAbort(e)) toast(e.message || 'حدث خطأ غير متوقع', 5000); };

  const STYLES = [
    { id: 'none', label: 'بدون', en: '' },
    { id: 'cinematic', label: 'سينمائي واقعي', en: 'photorealistic cinematic film still, dramatic lighting, shallow depth of field, 35mm' },
    { id: 'anime', label: 'أنمي', en: 'anime style, detailed illustration, vibrant colors, studio quality' },
    { id: '3d', label: 'ثلاثي الأبعاد', en: '3D animated movie style, soft lighting, detailed render' },
    { id: 'watercolor', label: 'ألوان مائية', en: 'watercolor painting, soft washes, paper texture' },
    { id: 'digital', label: 'فن رقمي', en: 'digital concept art, highly detailed' },
  ];
  const styleEn = id => STYLES.find(s => s.id === id)?.en || '';
  const DIMS = { '1:1': [1024, 1024], '9:16': [720, 1280], '16:9': [1280, 720], '3:4': [768, 1024] };

  /* ---------- generic controls ---------- */
  function seg(sel, initial, onChange) {
    const box = $(sel); let val = initial;
    const paint = () => $$('button', box).forEach(b => b.classList.toggle('on', b.dataset.v === val));
    box.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      val = b.dataset.v; paint(); onChange?.(val);
    });
    paint();
    return { get: () => val, set: v => { val = v; paint(); onChange?.(v); } };
  }
  function chips(sel, initial, onChange) {
    const box = $(sel); let val = initial;
    const paint = () => $$('button', box).forEach(b => b.classList.toggle('on', b.dataset.v === val));
    box.innerHTML = '';
    STYLES.forEach(s => { const b = document.createElement('button'); b.type = 'button'; b.dataset.v = s.id; b.textContent = s.label; box.appendChild(b); });
    box.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; val = b.dataset.v; paint(); onChange?.(val); });
    paint();
    return { get: () => val, set: v => { val = v; paint(); } };
  }
  const busy = (ids, flag) => ids.forEach(id => $(id).classList.toggle('hidden', !flag));

  /* ---------- tabs ---------- */
  function showTab(name) {
    $$('.tab').forEach(t => t.classList.toggle('active', t.id === 'tab-' + name));
    $$('nav.bottom button').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
    try { localStorage.setItem('as.tab', name); } catch { /* ignore */ }
    if (name === 'library') refreshLib();
    window.scrollTo(0, 0);
  }
  $$('nav.bottom button').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
  const updateChip = () => {
    const a = Img.providerLabel(), b = Chat.providerLabel();
    $('#providerChip').textContent = a === b ? a : `${a} + ${b}`;
  };

  /* ---------- library + viewer + picker ---------- */
  let libFilter = 'all', libUrls = [];
  const filterSeg = seg('#libFilter', 'all', v => { libFilter = v; refreshLib(); });

  function thumb(it, urls) {
    const url = URL.createObjectURL(it.blob); urls.push(url);
    const b = document.createElement('button'); b.className = 'it'; b.type = 'button';
    if (it.type === 'video') {
      const v = document.createElement('video'); v.src = url + '#t=0.1'; v.muted = true; v.preload = 'metadata'; v.playsInline = true; b.appendChild(v);
      const t = document.createElement('span'); t.className = 'tag'; t.textContent = 'فيديو'; b.appendChild(t);
    } else { const i = document.createElement('img'); i.src = url; i.alt = ''; b.appendChild(i); }
    return b;
  }

  async function refreshLib() {
    libUrls.forEach(URL.revokeObjectURL); libUrls = [];
    const all = await DB.allItems();
    const items = all.filter(i => libFilter === 'all' || i.type === libFilter);
    const grid = $('#libGrid'); grid.innerHTML = '';
    $('#libEmpty').classList.toggle('hidden', items.length > 0);
    items.forEach(it => { const b = thumb(it, libUrls); b.addEventListener('click', () => openViewer(it)); grid.appendChild(b); });
  }

  let viewing = null, viewerUrl = null;
  function openViewer(it) {
    viewing = it;
    if (viewerUrl) URL.revokeObjectURL(viewerUrl);
    viewerUrl = URL.createObjectURL(it.blob);
    const box = $('#viewerMedia'); box.innerHTML = '';
    const m = document.createElement(it.type === 'video' ? 'video' : 'img');
    m.src = viewerUrl; if (it.type === 'video') { m.controls = true; m.playsInline = true; }
    box.appendChild(m);
    $('#viewerMeta').textContent = (it.prompt ? it.prompt + ' · ' : '') + new Date(it.created).toLocaleString('ar');
    $('#vwAnimate').classList.toggle('hidden', it.type !== 'image');
    $('#viewer').showModal();
  }
  on('#vwClose', 'click', () => $('#viewer').close());
  $('#viewer').addEventListener('close', () => { $('#viewerMedia').innerHTML = ''; });
  on('#vwSave', 'click', () => viewing && U.saveBlob(viewing.blob, viewing.type === 'video' ? 'video' : 'image').catch(fail));
  on('#vwDel', 'click', async () => { if (!viewing) return; await DB.delItem(viewing.id); $('#viewer').close(); refreshLib(); toast('تم الحذف'); });
  on('#vwAnimate', 'click', () => { if (!viewing) return; const b = viewing.blob; $('#viewer').close(); useForAnimate(b); });
  on('#libClear', 'click', async () => { if (confirm('حذف كل الصور والفيديوهات المحفوظة؟')) { await DB.clearItems(); refreshLib(); toast('تم حذف المكتبة'); } });

  function pickImage() {
    return new Promise(async resolve => {
      const items = (await DB.allItems()).filter(i => i.type === 'image');
      if (!items.length) { toast('المكتبة لا تحتوي صورًا بعد.'); return resolve(null); }
      const urls = [], grid = $('#pickGrid'); grid.innerHTML = '';
      const dlg = $('#picker'); let chosen = null;
      items.forEach(it => { const b = thumb(it, urls); b.addEventListener('click', () => { chosen = it.blob; dlg.close(); }); grid.appendChild(b); });
      dlg.addEventListener('close', () => { urls.forEach(URL.revokeObjectURL); resolve(chosen); }, { once: true });
      $('#pickClose').onclick = () => dlg.close();
      dlg.showModal();
    });
  }

  /* ---------- image tab ---------- */
  const imgStyle = chips('#imgStyles', 'none');
  const imgAspect = seg('#imgAspect', '1:1');
  let imgAC = null, lastImg = null, lastSeed = null, imgUrl = null;

  async function genImage() {
    const raw = $('#imgPrompt').value.trim();
    if (!raw) return toast('اكتب وصف الصورة أولًا');
    const st = styleEn(imgStyle.get());
    const prompt = st ? `${raw}, ${st}` : raw;
    const [width, height] = DIMS[imgAspect.get()];
    const seed = parseInt($('#imgSeed').value, 10) || rand();
    imgAC = new AbortController(); busy(['#imgGo'], false); busy(['#imgStop'], true);
    try {
      const blob = await Img.generate({ prompt, width, height, seed, signal: imgAC.signal, onStatus: s => { $('#imgStatus').textContent = s; } });
      lastImg = blob; lastSeed = seed;
      if (imgUrl) URL.revokeObjectURL(imgUrl);
      imgUrl = URL.createObjectURL(blob);
      $('#imgOut').src = imgUrl; $('#imgResult').classList.remove('hidden');
      $('#imgStatus').textContent = `تم. البذرة: ${seed}`;
      await DB.addItem({ type: 'image', blob, prompt: raw, meta: { seed, aspect: imgAspect.get(), style: imgStyle.get() } });
    } catch (e) { $('#imgStatus').textContent = ''; fail(e); }
    finally { busy(['#imgGo'], true); busy(['#imgStop'], false); }
  }
  on('#imgGo', 'click', genImage);
  on('#imgStop', 'click', () => imgAC?.abort());
  on('#imgSave', 'click', () => lastImg && U.saveBlob(lastImg, 'image').catch(fail));
  on('#imgSame', 'click', () => { if (lastSeed != null) { $('#imgSeed').value = lastSeed; toast('ثُبّتت البذرة. عدّل الوصف وولّد من جديد.'); } });
  on('#imgAnimate', 'click', () => lastImg && useForAnimate(lastImg));
  on('#imgEnhance', 'click', async () => {
    const raw = $('#imgPrompt').value.trim(); if (!raw) return toast('اكتب فكرة أولًا');
    const btn = $('#imgEnhance'); btn.disabled = true; $('#imgStatus').textContent = 'نحسّن الوصف…';
    try {
      const t = await Chat.send({ messages: [
        { role: 'system', content: 'Rewrite the user idea as ONE detailed English image-generation prompt (max 60 words): subject, setting, lighting, camera angle, mood. Output only the prompt, no quotes.' },
        { role: 'user', content: raw }] });
      if (t.trim()) $('#imgPrompt').value = t.trim().replace(/^["']|["']$/g, '');
      $('#imgStatus').textContent = '';
    } catch (e) { $('#imgStatus').textContent = ''; fail(e); }
    finally { btn.disabled = false; }
  });

  /* ---------- chat tab ---------- */
  const SYS = { role: 'system', content: 'أنت مساعد ذكي يتحدث العربية بوضوح. أجب بإيجاز ودقة. إن طُلبت قصة أو سيناريو فاكتبه بأسلوب سينمائي بصري.' };
  let hist = [];
  try { hist = JSON.parse(localStorage.getItem('as.chatHist') || '[]'); } catch { hist = []; }
  const saveHist = () => { try { localStorage.setItem('as.chatHist', JSON.stringify(hist.slice(-60))); } catch { /* ignore */ } };
  function bubble(role, text) {
    const d = document.createElement('div'); d.className = 'msg ' + (role === 'user' ? 'user' : 'bot'); d.textContent = text;
    $('#chatLog').appendChild(d); d.scrollIntoView({ block: 'end' }); return d;
  }
  hist.forEach(m => bubble(m.role, m.content));
  async function sendChat() {
    const inp = $('#chatIn'), text = inp.value.trim(); if (!text) return;
    inp.value = ''; hist.push({ role: 'user', content: text }); bubble('user', text);
    const bot = bubble('bot', '…'); $('#chatSend').disabled = true;
    try {
      const out = await Chat.send({ messages: [SYS, ...hist.slice(-20)], onToken: (_, full) => { bot.textContent = full; bot.scrollIntoView({ block: 'end' }); } });
      bot.textContent = out || '(لا يوجد ردّ)'; hist.push({ role: 'assistant', content: out }); saveHist();
    } catch (e) { bot.textContent = 'تعذّر الحصول على ردّ: ' + (e.message || ''); hist.pop(); }
    finally { $('#chatSend').disabled = false; }
  }
  on('#chatSend', 'click', sendChat);
  on('#chatIn', 'keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) sendChat(); });
  on('#chatNew', 'click', () => { hist = []; saveHist(); $('#chatLog').innerHTML = ''; });

  /* ---------- video: mode switch ---------- */
  const vidMode = seg('#vidMode', 'story', v => ['story', 'animate', 'ai'].forEach(m => $('#vm-' + m).classList.toggle('hidden', m !== v)));
  function useForAnimate(blob) { setAnimateImage(blob); showTab('video'); vidMode.set('animate'); }

  /* ---------- video: story ---------- */
  const story = { aspect: '9:16', style: 'cinematic', seed: rand(), characters: [], scenes: [] };
  const sceneUrls = new Map();
  const stAspect = seg('#stAspect', '9:16', v => { story.aspect = v; renderScenes(); save(); });
  const stStyle = chips('#stStyles', 'cinematic', v => { story.style = v; save(); });
  let saveT = null;
  const save = () => {
    clearTimeout(saveT);
    saveT = setTimeout(() => {
      DB.kvSet('story', { ...story, text: $('#stText').value, scenes: story.scenes.map(s => ({ ...s })) }).catch(() => {});
    }, 500);
  };
  $('#stText').addEventListener('input', save);

  function sceneUrl(sc) {
    if (!sc.blob) return null;
    if (!sceneUrls.has(sc.id) || sceneUrls.get(sc.id).blob !== sc.blob) {
      if (sceneUrls.has(sc.id)) URL.revokeObjectURL(sceneUrls.get(sc.id).url);
      sceneUrls.set(sc.id, { blob: sc.blob, url: URL.createObjectURL(sc.blob) });
    }
    return sceneUrls.get(sc.id).url;
  }

  function renderChars() {
    const box = $('#chList'); box.innerHTML = '';
    if (!story.characters.length) { box.innerHTML = '<p class="hint">لا توجد شخصيات بعد. تُستخرج تلقائيًا عند تحليل القصة، أو أضفها يدويًا.</p>'; return; }
    story.characters.forEach((c, i) => {
      const d = document.createElement('div'); d.className = 'char';
      d.innerHTML = '<input type="text" placeholder="الاسم"><textarea rows="2" dir="ltr" placeholder="Fixed look: age, hair, clothes, build…"></textarea><button class="btn sm danger" aria-label="حذف"><svg class="i"><use href="#i-trash"/></svg></button>';
      const [n, l, del] = [d.children[0], d.children[1], d.children[2]];
      n.value = c.name; l.value = c.look;
      n.oninput = () => { c.name = n.value; save(); };
      l.oninput = () => { c.look = l.value; save(); };
      del.onclick = () => { story.characters.splice(i, 1); renderChars(); save(); };
      box.appendChild(d);
    });
  }
  on('#chAdd', 'click', () => { story.characters.push({ name: '', look: '' }); renderChars(); save(); });

  function totalSecs() { return story.scenes.reduce((a, s) => a + (Number(s.seconds) || 0), 0); }
  function renderScenes() {
    const box = $('#scList'); box.innerHTML = '';
    $('#stTotal').textContent = story.scenes.length ? `(${story.scenes.length} مشهد · ${U.fmtDur(totalSecs())})` : '';
    if (!story.scenes.length) { box.innerHTML = '<p class="hint">لا توجد مشاهد. حلّل القصة أو أضف مشهدًا يدويًا.</p>'; return; }
    story.scenes.forEach((sc, i) => {
      const d = document.createElement('div');
      d.className = 'scene' + (story.aspect === '16:9' ? ' land' : story.aspect === '1:1' ? ' sq' : '');
      const url = sceneUrl(sc);
      d.innerHTML = `<div class="thumb">${url ? `<img src="${url}" alt="">` : 'بلا صورة'}</div>
        <div class="fields">
          <div class="no">مشهد ${i + 1}</div>
          <textarea class="t-text" placeholder="النص الظاهر كترجمة"></textarea>
          <textarea class="t-prompt" dir="ltr" placeholder="Image prompt (English works best)"></textarea>
          <input type="text" class="t-chars" placeholder="الشخصيات في المشهد (أسماء مفصولة بفاصلة)">
          <div class="row"><input type="number" class="t-secs" min="1" max="60" style="width:76px" inputmode="numeric" aria-label="الثواني">
            <select class="t-motion grow"></select></div>
          <div class="row"><button class="btn sm b-gen"><svg class="i"><use href="#i-image"/></svg> ${sc.blob ? 'أعد الصورة' : 'ولّد الصورة'}</button>
            <button class="btn sm danger b-del" aria-label="حذف"><svg class="i"><use href="#i-trash"/></svg></button></div>
          <div class="status s-status"></div></div>`;
      const q = s => d.querySelector(s);
      q('.t-text').value = sc.text; q('.t-prompt').value = sc.prompt; q('.t-chars').value = (sc.chars || []).join('، ');
      q('.t-secs').value = sc.seconds;
      Object.entries(VideoMaker.MOTIONS).forEach(([k, v]) => { const o = document.createElement('option'); o.value = k; o.textContent = v; q('.t-motion').appendChild(o); });
      q('.t-motion').value = sc.motion || 'auto';
      q('.t-text').oninput = e => { sc.text = e.target.value; save(); };
      q('.t-prompt').oninput = e => { sc.prompt = e.target.value; save(); };
      q('.t-chars').oninput = e => { sc.chars = e.target.value.split(/[,،]/).map(x => x.trim()).filter(Boolean); save(); };
      q('.t-secs').oninput = e => { sc.seconds = Math.max(1, Number(e.target.value) || 1); $('#stTotal').textContent = `(${story.scenes.length} مشهد · ${U.fmtDur(totalSecs())})`; save(); };
      q('.t-motion').onchange = e => { sc.motion = e.target.value; save(); };
      q('.b-del').onclick = () => { story.scenes.splice(i, 1); renderScenes(); save(); };
      q('.b-gen').onclick = async () => {
        const ac = new AbortController(); q('.b-gen').disabled = true;
        try { await genScene(sc, ac.signal, s => { q('.s-status').textContent = s; }); renderScenes(); }
        catch (e) { q('.s-status').textContent = ''; fail(e); q('.b-gen').disabled = false; }
      };
      box.appendChild(d);
    });
  }
  on('#scAdd', 'click', () => {
    story.scenes.push({ id: U.uid(), text: '', prompt: '', chars: [], seconds: Number($('#stSecs').value) || 6, motion: 'auto', blob: null });
    renderScenes(); save();
  });

  function scenePrompt(sc) {
    const looks = (sc.chars || []).map(n => story.characters.find(c => c.name.trim() === n.trim())?.look).filter(Boolean).join('; ');
    return [styleEn(story.style), sc.prompt || sc.text, looks, 'highly detailed'].filter(Boolean).join(', ');
  }
  function sceneSeed(sc, idx) {
    // scenes with the same cast share a seed: gives a closer look for recurring characters
    const key = (sc.chars || []).map(s => s.trim()).filter(Boolean).sort().join('|');
    if (!key) return story.seed + idx;
    let h = 0; for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) | 0;
    return Math.abs(h + story.seed) % 2 ** 31;
  }
  async function genScene(sc, signal, onStatus) {
    const [width, height] = DIMS[story.aspect === '1:1' ? '1:1' : story.aspect];
    sc.blob = await Img.generate({ prompt: scenePrompt(sc), width, height, seed: sceneSeed(sc, story.scenes.indexOf(sc)), signal, onStatus });
    save();
  }

  let genAC = null;
  on('#scGenAll', 'click', async () => {
    const todo = story.scenes.filter(s => !s.blob);
    if (!story.scenes.length) return toast('لا توجد مشاهد بعد.');
    if (!todo.length) return toast('كل المشاهد لها صور بالفعل.');
    genAC = new AbortController(); busy(['#scGenAll', '#scExtend'], false); busy(['#scStop'], true);
    let done = 0;
    try {
      for (const sc of todo) {
        U.setProgress('#scProg', done / todo.length);
        await genScene(sc, genAC.signal, s => { $('#scStatus').textContent = `صورة ${done + 1}/${todo.length}: ${s}`; });
        done++; renderScenes();
      }
      $('#scStatus').textContent = 'اكتمل توليد الصور.';
    } catch (e) { $('#scStatus').textContent = U.isAbort(e) ? 'أُوقف التوليد.' : ''; fail(e); }
    finally { busy(['#scGenAll', '#scExtend'], true); busy(['#scStop'], false); U.setProgress('#scProg', null); renderScenes(); }
  });
  on('#scStop', 'click', () => genAC?.abort());

  const DIRECTOR = 'You are a film director assistant. Reply with ONLY valid JSON, no markdown fences.';
  const SCHEMA = '{"title":"Arabic title","characters":[{"name":"name exactly as in story","look":"English fixed visual description: age, face, hair, clothes, build"}],"scenes":[{"text":"Arabic subtitle, 1-2 short sentences","image_prompt":"English shot description: setting, action, camera angle, lighting. No character appearance details.","characters":["names present"]}]}';

  function localSplit(text, n) {
    let parts = text.split(/\n\s*\n|(?<=[.!?؟۔])\s+/).map(s => s.trim()).filter(Boolean);
    if (n && parts.length > n) {
      const per = Math.ceil(parts.length / n), out = [];
      for (let i = 0; i < parts.length; i += per) out.push(parts.slice(i, i + per).join(' '));
      parts = out;
    }
    return parts;
  }
  const mkScene = (s, secs) => ({
    id: U.uid(), text: String(s.text || ''), prompt: String(s.image_prompt || s.prompt || ''),
    chars: Array.isArray(s.characters) ? s.characters.map(String) : [], seconds: secs, motion: 'auto', blob: null,
  });

  on('#stAnalyze', 'click', async () => {
    const text = $('#stText').value.trim(); if (!text) return toast('اكتب القصة أولًا');
    const n = Number($('#stCount').value), secs = Math.max(2, Number($('#stSecs').value) || 6);
    const btn = $('#stAnalyze'); btn.disabled = true; $('#stStatus').textContent = 'نحلّل القصة…';
    story.seed = rand();
    try {
      const j = await Chat.json([
        { role: 'system', content: DIRECTOR },
        { role: 'user', content: `Split this story into ${n ? 'exactly ' + n : 'between 6 and 10'} visually distinct scenes for a short video. Schema: ${SCHEMA}\n\nStory:\n${text}` }]);
      story.characters = (j.characters || []).map(c => ({ name: String(c.name || ''), look: String(c.look || '') }));
      story.scenes = (j.scenes || []).map(s => mkScene(s, secs));
      if (!story.scenes.length) throw new Error('لم يرجع النموذج مشاهد.');
      $('#stStatus').textContent = `تم: ${story.scenes.length} مشهد. راجعها وعدّلها ثم ولّد الصور.`;
    } catch (e) {
      const parts = localSplit(text, n);
      story.scenes = parts.map(p => mkScene({ text: p, image_prompt: p }, secs));
      $('#stStatus').textContent = `تعذّر التحليل الذكي (${e.message}). قسمنا النص محليًا إلى ${parts.length} مشهد، وعدّل أوصاف الصور بنفسك.`;
    } finally { btn.disabled = false; renderChars(); renderScenes(); save(); }
  });

  on('#scExtend', 'click', async () => {
    if (!story.scenes.length) return toast('حلّل القصة أو أضف مشاهد أولًا.');
    const secs = Math.max(2, Number($('#stSecs').value) || 6);
    const btn = $('#scExtend'); btn.disabled = true; $('#scStatus').textContent = 'نكتب تتمة القصة…';
    try {
      const ctx = story.scenes.map((s, i) => `${i + 1}. ${s.text}`).join('\n');
      const chars = story.characters.map(c => `${c.name}: ${c.look}`).join('\n');
      const j = await Chat.json([
        { role: 'system', content: DIRECTOR },
        { role: 'user', content: `Continue this story with 4 more scenes that follow naturally. Keep the same characters.\nCharacters:\n${chars}\nStory so far:\n${ctx}\n\nReturn JSON: {"scenes":[{"text":"Arabic subtitle","image_prompt":"English shot description","characters":["names"]}]}` }]);
      const more = (j.scenes || []).map(s => mkScene(s, secs));
      if (!more.length) throw new Error('لم يرجع النموذج مشاهد جديدة.');
      story.scenes.push(...more); renderScenes(); save();
      $('#scStatus').textContent = `أُضيف ${more.length} مشاهد. ولّد صورها ثم ركّب الفيديو.`;
    } catch (e) { $('#scStatus').textContent = ''; fail(e); }
    finally { btn.disabled = false; }
  });

  /* ---------- render helpers shared by story + animate ---------- */
  let rdAC = null, rdBlob = null, rdUrl = null;
  function showVideo(videoSel, resultSel, blob) {
    const v = $(videoSel);
    if (v.dataset.url) URL.revokeObjectURL(v.dataset.url);
    const url = URL.createObjectURL(blob); v.dataset.url = url; v.src = url;
    $(resultSel).classList.remove('hidden');
  }

  on('#rdGo', 'click', async () => {
    if (!story.scenes.length) return toast('لا توجد مشاهد.');
    if (story.scenes.some(s => !s.blob)) return toast('ولّد صور كل المشاهد أولًا.');
    rdAC = new AbortController(); busy(['#rdGo'], false); busy(['#rdStop'], true); $('#rdResult').classList.add('hidden');
    try {
      const blob = await VideoMaker.render({
        scenes: story.scenes.map(s => ({ blob: s.blob, text: s.text, seconds: s.seconds, motion: s.motion })),
        aspect: story.aspect, fps: Number($('#rdFps').value), subtitles: $('#rdSubs').checked, music: $('#rdMusic').checked,
        signal: rdAC.signal, onProgress: (p, msg) => { U.setProgress('#rdProg', p); $('#rdStatus').textContent = msg; },
      });
      rdBlob = blob; showVideo('#rdVideo', '#rdResult', blob);
      $('#rdStatus').textContent = 'تم تركيب الفيديو وحُفظ في المكتبة.';
      await DB.addItem({ type: 'video', blob, prompt: $('#stText').value.slice(0, 120), meta: { scenes: story.scenes.length } });
    } catch (e) { $('#rdStatus').textContent = U.isAbort(e) ? 'أُلغي التركيب.' : ''; fail(e); }
    finally { busy(['#rdGo'], true); busy(['#rdStop'], false); U.setProgress('#rdProg', null); }
  });
  on('#rdStop', 'click', () => rdAC?.abort());
  on('#rdSave', 'click', () => rdBlob && U.saveBlob(rdBlob, 'story-video').catch(fail));

  /* ---------- video: animate one image ---------- */
  const anAspect = seg('#anAspect', '9:16');
  let anBlob = null, anOut = null;
  Object.entries(VideoMaker.MOTIONS).forEach(([k, v]) => { const o = document.createElement('option'); o.value = k; o.textContent = v; $('#anMotion').appendChild(o); });
  function setAnimateImage(blob) {
    anBlob = blob; const img = $('#anImg'); if (img.dataset.url) URL.revokeObjectURL(img.dataset.url);
    img.dataset.url = URL.createObjectURL(blob); img.src = img.dataset.url; img.classList.remove('hidden');
  }
  on('#anPick', 'click', async () => { const b = await pickImage(); if (b) setAnimateImage(b); });
  on('#anFile', 'change', e => { const f = e.target.files[0]; if (f) setAnimateImage(f); e.target.value = ''; });
  on('#anGo', 'click', async () => {
    if (!anBlob) return toast('اختر صورة أولًا.');
    const btn = $('#anGo'); btn.disabled = true; $('#anResult').classList.add('hidden');
    try {
      const blob = await VideoMaker.render({
        scenes: [{ blob: anBlob, text: $('#anText').value, seconds: Math.max(2, Number($('#anSecs').value) || 8), motion: $('#anMotion').value }],
        aspect: anAspect.get(), fps: 30, subtitles: true, music: false, fade: 0.01,
        onProgress: (p, msg) => { U.setProgress('#anProg', p); $('#anStatus').textContent = msg; },
      });
      anOut = blob; showVideo('#anVideo', '#anResult', blob); $('#anStatus').textContent = 'تم، وحُفظ في المكتبة.';
      await DB.addItem({ type: 'video', blob, prompt: $('#anText').value, meta: { animate: true } });
    } catch (e) { $('#anStatus').textContent = ''; fail(e); }
    finally { btn.disabled = false; U.setProgress('#anProg', null); }
  });
  on('#anSave', 'click', () => anOut && U.saveBlob(anOut, 'animated').catch(fail));

  /* ---------- video: real AI video through Puter (uses the user's Puter credits) ---------- */
  let aiBlob = null, aiSrc = null, aiRef = null;
  on('#aiPick', 'click', async () => { const b = await pickImage(); if (b) setAiRef(b); });
  on('#aiFile', 'change', e => { const f = e.target.files[0]; if (f) setAiRef(f); e.target.value = ''; });
  function setAiRef(blob) {
    aiRef = blob; const img = $('#aiImg'); if (img.dataset.url) URL.revokeObjectURL(img.dataset.url);
    img.dataset.url = URL.createObjectURL(blob); img.src = img.dataset.url; img.classList.remove('hidden');
  }
  async function frameOf(url) {
    const v = document.createElement('video'); v.crossOrigin = 'anonymous'; v.muted = true; v.src = url;
    await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(new Error('video')); });
    v.currentTime = Math.max(0, v.duration - 0.1);
    await new Promise(res => { v.onseeked = res; });
    const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    return c.toDataURL('image/jpeg', 0.9);
  }
  async function aiRun(prompt, reference) {
    const btns = ['#aiGo', '#aiExtend'].map(s => $(s)); btns.forEach(b => { b.disabled = true; });
    $('#aiStatus').textContent = 'نولّد الفيديو… قد يستغرق دقائق.';
    try {
      const p = await Puter.load();
      const opts = { seconds: Number($('#aiSecs').value) || 5, size: $('#aiSize').value, test_mode: $('#aiTest').checked };
      if ($('#aiModel').value) opts.model = $('#aiModel').value;
      if (reference) opts.input_reference = reference;
      const vid = await p.ai.txt2vid(prompt, opts);
      aiSrc = vid.src || String(vid);
      const v = $('#aiVideo'); v.src = aiSrc; $('#aiResult').classList.remove('hidden');
      aiBlob = null; $('#aiStatus').textContent = 'تم.';
      try {
        aiBlob = await (await fetch(aiSrc)).blob();
        await DB.addItem({ type: 'video', blob: aiBlob, prompt, meta: { ai: true } });
        $('#aiStatus').textContent = 'تم، وحُفظ في المكتبة.';
      } catch { $('#aiStatus').textContent = 'تم، لكن تعذّر نسخه للمكتبة. اضغط «حفظ» لفتح الرابط (مؤقت).'; }
    } catch (e) {
      $('#aiStatus').textContent = '';
      if (e?.code === 'insufficient_funds') toast('رصيدك في Puter لا يكفي. جرّب وضع التجربة أو اشحن الرصيد.', 6000);
      else if (e?.errorCode === 'moderation_flagged') toast('رُفض الوصف من مرشّح المحتوى. غيّر صياغته.', 6000);
      else toast(e?.message || (typeof e === 'string' ? e : 'فشل توليد الفيديو'), 6000);
    } finally { btns.forEach(b => { b.disabled = false; }); }
  }
  on('#aiGo', 'click', async () => {
    const prompt = $('#aiPrompt').value.trim(); if (!prompt) return toast('اكتب وصف المقطع أولًا.');
    const ref = aiRef ? await U.blobToDataURL(aiRef) : null;
    aiRun(prompt, ref);
  });
  on('#aiExtend', 'click', async () => {
    if (!aiSrc) return;
    const prompt = $('#aiPrompt').value.trim() || 'continue the scene';
    let ref = null;
    try { ref = await frameOf(aiBlob ? URL.createObjectURL(aiBlob) : aiSrc); }
    catch { toast('تعذّر أخذ آخر لقطة، سنكمل بالوصف فقط.'); }
    aiRun(`${prompt}. Continue directly from the previous shot.`, ref);
  });
  on('#aiSave', 'click', () => {
    if (aiBlob) U.saveBlob(aiBlob, 'ai-video').catch(fail);
    else if (aiSrc) window.open(aiSrc, '_blank');
  });

  /* ---------- settings ---------- */
  function loadSettings() {
    $('#setImgProvider').value = Settings.get('imageProvider');
    $('#setChatProvider').value = Settings.get('chatProvider');
    $('#setCfUrl').value = Settings.get('cfUrl'); $('#setCfSecret').value = Settings.get('cfSecret');
    $('#setGap').value = Settings.get('pollGap'); $('#setPuterChat').value = Settings.get('puterChatModel');
    $('#setCf').classList.toggle('hidden', Settings.get('imageProvider') !== 'cloudflare');
    updateChip();
  }
  const bindSet = (sel, key, num) => $(sel).addEventListener('change', e => { Settings.set(key, num ? Number(e.target.value) : e.target.value.trim()); loadSettings(); });
  bindSet('#setImgProvider', 'imageProvider'); bindSet('#setChatProvider', 'chatProvider');
  bindSet('#setCfUrl', 'cfUrl'); bindSet('#setCfSecret', 'cfSecret'); bindSet('#setGap', 'pollGap', true); bindSet('#setPuterChat', 'puterChatModel');

  on('#testImg', 'click', async () => {
    const b = $('#testImg'); b.disabled = true; b.textContent = 'نختبر…';
    try {
      const blob = await Img.generate({ prompt: 'a red apple on a wooden table, studio light', width: 512, height: 512, seed: 7, signal: undefined, onStatus: s => { b.textContent = s; } });
      toast(`نجح الاتصال ✓ (${Math.round(blob.size / 1024)} ك.ب)`);
    } catch (e) { fail(e); }
    finally { b.disabled = false; b.textContent = 'اختبار توليد الصور'; }
  });
  on('#testChat', 'click', async () => {
    const b = $('#testChat'); b.disabled = true; b.textContent = 'نختبر…';
    try { const t = await Chat.send({ messages: [{ role: 'user', content: 'قل مرحبا بجملة واحدة.' }] }); toast('ردّ: ' + t.slice(0, 80)); }
    catch (e) { fail(e); }
    finally { b.disabled = false; b.textContent = 'اختبار الدردشة'; }
  });
  async function puterState() {
    $('#puterState').textContent = 'نتحقق…';
    try {
      if (await Puter.signedIn()) $('#puterState').textContent = `متصل: ${await Puter.userName() || 'حسابك'}`;
      else $('#puterState').textContent = 'غير متصل.';
    } catch (e) { $('#puterState').textContent = e.message; }
  }
  on('#puterIn', 'click', async () => { try { await Puter.signIn(); } catch (e) { fail(e); } puterState(); });
  on('#puterOut', 'click', async () => { try { await Puter.signOut(); } catch (e) { fail(e); } puterState(); });

  let deferredInstall = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; $('#installBtn').classList.remove('hidden'); });
  on('#installBtn', 'click', async () => { if (!deferredInstall) return; deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; $('#installBtn').classList.add('hidden'); });

  /* ---------- boot ---------- */
  (async function boot() {
    loadSettings(); renderChars(); renderScenes();
    try {
      const s = await DB.kvGet('story');
      if (s) {
        Object.assign(story, { aspect: s.aspect || '9:16', style: s.style || 'cinematic', seed: s.seed || rand(), characters: s.characters || [], scenes: s.scenes || [] });
        $('#stText').value = s.text || ''; stAspect.set(story.aspect); stStyle.set(story.style);
        renderChars(); renderScenes();
      }
    } catch { /* first run */ }
    let t = 'image'; try { t = localStorage.getItem('as.tab') || 'image'; } catch { /* ignore */ }
    showTab($('#tab-' + t) ? t : 'image');
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(() => {});
  })();
})();
