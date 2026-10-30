/* On-device video maker: images + camera motion + subtitles -> recorded with MediaRecorder.
   Recording happens in real time (a 60s video takes ~60s). window.VideoMaker */
(function () {
  const SIZES = { '9:16': [720, 1280], '16:9': [1280, 720], '1:1': [720, 720] };
  const MOTIONS = {
    auto: 'تلقائي', 'zoom-in': 'تقريب', 'zoom-out': 'تبعيد',
    'pan-left': 'تحريك لليسار', 'pan-right': 'تحريك لليمين', 'pan-up': 'تحريك لأعلى', 'pan-down': 'تحريك لأسفل', none: 'ثابت',
  };
  const CYCLE = ['zoom-in', 'pan-left', 'zoom-out', 'pan-right', 'pan-up', 'pan-down'];
  const FONT = '"Noto Sans Arabic","Segoe UI",Tahoma,sans-serif';

  const ease = u => u * u * (3 - 2 * u);

  function pickMime() {
    if (typeof MediaRecorder === 'undefined') return '';
    const list = ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    return list.find(m => MediaRecorder.isTypeSupported(m)) || '';
  }

  /* decode and cap the size so 20+ scenes do not exhaust memory */
  async function prepare(blob, W, H) {
    const bm = await createImageBitmap(blob);
    const limit = Math.max(W, H) * 1.4;
    const k = Math.min(1, limit / Math.max(bm.width, bm.height));
    if (k >= 1) return bm;
    const c = document.createElement('canvas');
    c.width = Math.round(bm.width * k); c.height = Math.round(bm.height * k);
    c.getContext('2d').drawImage(bm, 0, 0, c.width, c.height);
    bm.close();
    return c;
  }

  function wrap(ctx, text, maxW) {
    const words = String(text).trim().split(/\s+/);
    const lines = []; let cur = '';
    for (const w of words) {
      const test = cur ? cur + ' ' + w : w;
      if (cur && ctx.measureText(test).width > maxW) { lines.push(cur); cur = w; } else cur = test;
    }
    if (cur) lines.push(cur);
    return lines;
  }

  function makePad(ac, dest, total) {
    const master = ac.createGain();
    const now = ac.currentTime;
    master.gain.setValueAtTime(0, now);
    master.gain.linearRampToValueAtTime(0.13, now + 3);
    master.gain.setValueAtTime(0.13, now + Math.max(3, total - 2.5));
    master.gain.linearRampToValueAtTime(0, now + total);
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
    const oscs = [];
    [164.81, 220, 277.18, 329.63].forEach((f, i) => {
      const o = ac.createOscillator(); o.type = i % 2 ? 'triangle' : 'sine'; o.frequency.value = f; o.detune.value = (i - 1.5) * 6;
      const g = ac.createGain(); g.gain.value = 0.25;
      const lfo = ac.createOscillator(); lfo.frequency.value = 0.07 + i * 0.03;
      const lg = ac.createGain(); lg.gain.value = 0.12;
      lfo.connect(lg); lg.connect(g.gain);
      o.connect(g); g.connect(lp);
      o.start(); lfo.start(); oscs.push(o, lfo);
    });
    lp.connect(master); master.connect(dest);
    return () => oscs.forEach(o => { try { o.stop(); } catch { /* already stopped */ } });
  }

  /* scenes: [{blob, text, seconds, motion}] */
  async function render({ scenes, aspect = '9:16', fps = 30, subtitles = true, music = false, fade = 0.6, onProgress, signal }) {
    if (!scenes.length) throw new Error('لا توجد مشاهد.');
    if (typeof MediaRecorder === 'undefined' || !HTMLCanvasElement.prototype.captureStream)
      throw new Error('متصفحك لا يدعم تسجيل الفيديو. جرّب Chrome حديثًا.');
    const [W, H] = SIZES[aspect] || SIZES['9:16'];
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d', { alpha: false });

    const bitmaps = [];
    for (let i = 0; i < scenes.length; i++) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      bitmaps.push(await prepare(scenes[i].blob, W, H));
      onProgress?.(0, `تجهيز الصور ${i + 1}/${scenes.length}`);
    }

    const starts = []; let total = 0;
    const durs = scenes.map(s => Math.max(1, Number(s.seconds) || 5));
    durs.forEach(d => { starts.push(total); total += d; });
    const motions = scenes.map((s, i) => (!s.motion || s.motion === 'auto') ? CYCLE[i % CYCLE.length] : s.motion);

    function drawScene(i, u, alpha) {
      const bm = bitmaps[i];
      const iw = bm.width, ih = bm.height;
      const s0 = Math.max(W / iw, H / ih);
      const m = motions[i], e = ease(Math.max(0, Math.min(1, u)));
      let z = 1, ox = 0, oy = 0;
      if (m === 'zoom-in') z = 1 + 0.16 * e;
      else if (m === 'zoom-out') z = 1.16 - 0.16 * e;
      else if (m.startsWith('pan')) z = 1.2;
      const sw = iw * s0 * z, sh = ih * s0 * z;
      const maxX = (sw - W) / 2, maxY = (sh - H) / 2;
      if (m === 'pan-left') ox = maxX * (1 - 2 * e);
      else if (m === 'pan-right') ox = -maxX * (1 - 2 * e);
      else if (m === 'pan-up') oy = maxY * (1 - 2 * e);
      else if (m === 'pan-down') oy = -maxY * (1 - 2 * e);
      ctx.globalAlpha = alpha;
      ctx.drawImage(bm, W / 2 + ox - sw / 2, H / 2 + oy - sh / 2, sw, sh);
      ctx.globalAlpha = 1;
    }

    function drawSubtitle(text, alpha) {
      if (!text || !text.trim()) return;
      const fs = Math.round(Math.min(W, H) * (aspect === '16:9' ? 0.05 : 0.056));
      ctx.save();
      ctx.font = `700 ${fs}px ${FONT}`;
      ctx.direction = 'rtl'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const lines = wrap(ctx, text, W * 0.84);
      const lh = fs * 1.5;
      const boxH = lines.length * lh + fs * 0.7;
      const boxW = Math.min(W * 0.94, Math.max(...lines.map(l => ctx.measureText(l).width)) + fs * 1.6);
      const y0 = H - boxH - H * 0.07;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = 'rgba(0,0,0,0.58)';
      const r = fs * 0.5, x0 = (W - boxW) / 2;
      ctx.beginPath();
      ctx.moveTo(x0 + r, y0); ctx.arcTo(x0 + boxW, y0, x0 + boxW, y0 + boxH, r);
      ctx.arcTo(x0 + boxW, y0 + boxH, x0, y0 + boxH, r); ctx.arcTo(x0, y0 + boxH, x0, y0, r);
      ctx.arcTo(x0, y0, x0 + boxW, y0, r); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#fff';
      lines.forEach((l, k) => ctx.fillText(l, W / 2, y0 + fs * 0.35 + lh * (k + 0.5)));
      ctx.restore();
    }

    function drawAt(t) {
      let i = scenes.length - 1;
      for (let k = 0; k < scenes.length; k++) if (t < starts[k] + durs[k]) { i = k; break; }
      const local = t - starts[i];
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
      if (i > 0 && local < fade) drawScene(i - 1, 1, 1);
      drawScene(i, local / durs[i], i > 0 ? Math.min(1, local / fade) : 1);
      if (subtitles) drawSubtitle(scenes[i].text, Math.min(1, local / 0.35));
    }

    drawAt(0);
    const stream = canvas.captureStream(fps);
    let ac = null, stopPad = null;
    if (music) {
      try {
        ac = new (window.AudioContext || window.webkitAudioContext)();
        const dest = ac.createMediaStreamDestination();
        stopPad = makePad(ac, dest, total);
        dest.stream.getAudioTracks().forEach(tr => stream.addTrack(tr));
      } catch { ac = null; }
    }

    const mime = pickMime();
    const rec = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: 4_500_000 });
    const chunks = [];
    rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    const stopped = new Promise(res => { rec.onstop = res; });

    let lock = null;
    try { lock = await navigator.wakeLock?.request('screen'); } catch { /* optional */ }

    rec.start(1000);
    const t0 = performance.now();
    try {
      await new Promise((resolve, reject) => {
        const frame = now => {
          if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
          const t = (now - t0) / 1000;
          if (t >= total) { drawAt(total - 0.001); onProgress?.(1, 'إنهاء…'); return resolve(); }
          drawAt(t);
          onProgress?.(t / total, `تسجيل ${U.fmtDur(t)} من ${U.fmtDur(total)}`);
          requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      });
    } finally {
      try { if (rec.state !== 'inactive') rec.stop(); } catch { /* ignore */ }
      await stopped;
      stream.getTracks().forEach(tr => tr.stop());
      stopPad?.();
      ac?.close?.();
      lock?.release?.().catch?.(() => {});
      bitmaps.forEach(b => b.close?.());
    }
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const blob = new Blob(chunks, { type: rec.mimeType || mime || 'video/webm' });
    if (!blob.size) throw new Error('خرج الفيديو فارغًا.');
    return blob;
  }

  window.VideoMaker = { render, MOTIONS, SIZES, pickMime };
})();
