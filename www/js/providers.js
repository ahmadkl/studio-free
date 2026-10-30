/* Settings + image / chat / Puter providers. window.Settings, window.Img, window.Chat, window.Puter */
(function () {
  /* ---------- settings (localStorage, wrapped: it can throw in private modes) ---------- */
  const DEFAULTS = {
    imageProvider: 'pollinations', chatProvider: 'pollinations',
    cfUrl: '', cfSecret: '', pollGap: 15, puterChatModel: '',
  };
  const Settings = {
    get(k) {
      try { const v = localStorage.getItem('as.' + k); return v == null ? DEFAULTS[k] : JSON.parse(v); }
      catch { return DEFAULTS[k]; }
    },
    set(k, v) { try { localStorage.setItem('as.' + k, JSON.stringify(v)); } catch { /* ignore */ } },
  };

  /* ---------- Puter ---------- */
  let puterP = null;
  const Puter = {
    load() {
      if (window.puter) return Promise.resolve(window.puter);
      if (puterP) return puterP;
      puterP = new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'https://js.puter.com/v2/';
        s.onload = () => res(window.puter);
        s.onerror = () => { puterP = null; rej(new Error('تعذّر تحميل Puter. تحقق من الاتصال بالإنترنت.')); };
        document.head.appendChild(s);
      });
      return puterP;
    },
    async signedIn() { try { const p = await Puter.load(); return !!(await p.auth.isSignedIn()); } catch { return false; } },
    async signIn() { const p = await Puter.load(); await p.auth.signIn(); },
    async signOut() { const p = await Puter.load(); await p.auth.signOut(); },
    async userName() { try { const p = await Puter.load(); return (await p.auth.getUser())?.username || ''; } catch { return ''; } },
  };

  /* ---------- rate limiter for the throttled free endpoint ---------- */
  const lastStart = {};
  async function paced(key, gapMs, signal, onStatus) {
    const wait = (lastStart[key] || 0) + gapMs - Date.now();
    if (wait > 0) {
      for (let left = Math.ceil(wait / 1000); left > 0; left--) {
        onStatus?.(`ننتظر دور الخدمة المجانية… ${left}ث`);
        await U.sleep(1000, signal);
      }
    }
    lastStart[key] = Date.now();
  }

  /* ---------- images ---------- */
  const NEGATIVE = 'blurry, low quality, deformed, extra fingers, text, watermark';
  const clamp64 = (n, max = 768) => Math.max(256, Math.min(max, Math.round(n / 64) * 64));

  async function pollinationsImage({ prompt, width, height, seed, signal, onStatus }) {
    const gap = Math.max(5, Number(Settings.get('pollGap')) || 15) * 1000;
    const q = new URLSearchParams({
      width, height, seed, model: 'flux', nologo: 'true', private: 'true', referrer: 'ai-studio-app',
    });
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt.slice(0, 1500))}?${q}`;
    for (let attempt = 0; attempt < 4; attempt++) {
      await paced('poll', gap, signal, onStatus);
      onStatus?.('نولّد الصورة…');
      const r = await fetch(url, { signal });
      if (r.status === 429 || r.status === 503) { onStatus?.('الخدمة مشغولة، نعيد المحاولة…'); await U.sleep(gap * (attempt + 1), signal); continue; }
      if (!r.ok) throw new Error(`Pollinations أعاد الخطأ ${r.status}`);
      const b = await r.blob();
      if (!b.type.startsWith('image/')) throw new Error('ردّ Pollinations ليس صورة.');
      return b;
    }
    throw new Error('Pollinations مشغول الآن. جرّب بعد قليل أو غيّر المزوّد من الإعدادات.');
  }

  async function hordeImage({ prompt, width, height, seed, signal, onStatus }) {
    const base = 'https://aihorde.net/api/v2';
    const headers = { apikey: '0000000000', 'Content-Type': 'application/json', 'Client-Agent': 'ai-studio-app:1.0:github' };
    const body = {
      prompt: `${prompt} ### ${NEGATIVE}`,
      params: { sampler_name: 'k_euler_a', cfg_scale: 7, width: clamp64(width), height: clamp64(height), steps: 25, n: 1, seed: String(seed) },
      nsfw: false, censor_nsfw: true, slow_workers: true,
    };
    const r = await fetch(`${base}/generate/async`, { method: 'POST', headers, body: JSON.stringify(body), signal });
    if (!r.ok) throw new Error(`AI Horde: ${r.status} ${(await r.text()).slice(0, 140)}`);
    const { id } = await r.json();
    const t0 = Date.now();
    for (;;) {
      await U.sleep(3500, signal);
      const c = await (await fetch(`${base}/generate/check/${id}`, { signal })).json();
      onStatus?.(`في الطابور: ${c.queue_position ?? '؟'} · متبقٍ ~${c.wait_time ?? '؟'}ث`);
      if (c.faulted) throw new Error('فشل التوليد في AI Horde.');
      if (c.done) break;
      if (Date.now() - t0 > 12 * 60 * 1000) throw new Error('انتهت مهلة AI Horde.');
    }
    const s = await (await fetch(`${base}/generate/status/${id}`, { signal })).json();
    const img = s.generations?.[0]?.img;
    if (!img) throw new Error('لم يُرجع AI Horde صورة.');
    if (/^https?:/.test(img)) { const rr = await fetch(img, { signal }); return await rr.blob(); }
    return U.base64ToBlob(img, 'image/webp');
  }

  async function cloudflareImage({ prompt, width, height, seed, signal }) {
    const url = Settings.get('cfUrl');
    if (!url) throw new Error('ضع رابط الـ Worker في الإعدادات أولًا.');
    const secret = Settings.get('cfSecret');
    const r = await fetch(url, {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', ...(secret ? { Authorization: `Bearer ${secret}` } : {}) },
      body: JSON.stringify({ prompt, width, height, seed }),
    });
    if (!r.ok) throw new Error(`Worker أعاد الخطأ ${r.status}`);
    const j = await r.json();
    if (!j.image) throw new Error('ردّ الـ Worker لا يحتوي صورة.');
    return U.base64ToBlob(j.image, 'image/jpeg');
  }

  async function puterImage({ prompt, signal, onStatus }) {
    onStatus?.('نتصل بـ Puter…');
    const p = await Puter.load();
    const img = await p.ai.txt2img(prompt);
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const src = img.src || String(img);
    const r = await fetch(src);
    return await r.blob();
  }

  const Img = {
    providerLabel() {
      return ({ pollinations: 'Pollinations', horde: 'AI Horde', cloudflare: 'Cloudflare', puter: 'Puter' })[Settings.get('imageProvider')] || '';
    },
    async generate(opts) {
      const p = Settings.get('imageProvider');
      const fn = { pollinations: pollinationsImage, horde: hordeImage, cloudflare: cloudflareImage, puter: puterImage }[p];
      const blob = await fn(opts);
      if (!blob || !blob.size) throw new Error('وصلت صورة فارغة.');
      return blob;
    },
  };

  /* ---------- chat ---------- */
  const textOf = r => {
    if (typeof r === 'string') return r;
    const c = r?.message?.content ?? r?.text ?? r?.content;
    if (Array.isArray(c)) return c.map(x => x.text || '').join('');
    return c ? String(c) : '';
  };

  const Chat = {
    providerLabel() { return Settings.get('chatProvider') === 'puter' ? 'Puter' : 'Pollinations'; },
    /* messages: [{role, content}] — returns the full text; onToken gets streamed pieces when supported */
    async send({ messages, onToken, signal }) {
      if (Settings.get('chatProvider') === 'puter') {
        const p = await Puter.load();
        const model = (Settings.get('puterChatModel') || '').trim();
        const opts = { stream: true, ...(model ? { model } : {}) };
        const res = await p.ai.chat(messages, opts);
        if (res && typeof res[Symbol.asyncIterator] === 'function') {
          let full = '';
          for await (const part of res) {
            if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
            if (part?.text) { full += part.text; onToken?.(part.text, full); }
          }
          return full;
        }
        const t = textOf(res); onToken?.(t, t); return t;
      }
      const r = await fetch('https://text.pollinations.ai/openai', {
        method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'openai', messages, stream: false, referrer: 'ai-studio-app' }),
      });
      if (!r.ok) throw new Error(`خدمة الدردشة أعادت الخطأ ${r.status}. جرّب Puter من الإعدادات.`);
      const j = await r.json();
      const t = textOf(j.choices?.[0]) || textOf(j);
      onToken?.(t, t);
      return t;
    },
    /* ask for JSON and parse it tolerantly */
    async json(messages, signal) {
      const t = await Chat.send({ messages, signal });
      const a = t.indexOf('{'), b = t.lastIndexOf('}');
      if (a < 0 || b <= a) throw new Error('لم يرجع النموذج بيانات صالحة. أعد المحاولة.');
      try { return JSON.parse(t.slice(a, b + 1)); }
      catch { throw new Error('تعذّر قراءة ردّ النموذج. أعد المحاولة.'); }
    },
  };

  window.Settings = Settings; window.Img = Img; window.Chat = Chat; window.Puter = Puter;
})();
