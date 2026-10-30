/* Small helpers shared by every module. Everything lives on window.U */
(function () {
  const U = {};
  U.$ = (s, r = document) => r.querySelector(s);
  U.$$ = (s, r = document) => [...r.querySelectorAll(s)];
  U.sleep = (ms, signal) => new Promise((res, rej) => {
    if (signal?.aborted) return rej(new DOMException('Aborted', 'AbortError'));
    const t = setTimeout(res, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); rej(new DOMException('Aborted', 'AbortError')); }, { once: true });
  });
  U.uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  U.isAbort = e => e && (e.name === 'AbortError' || /abort/i.test(e.message || ''));

  U.toast = (msg, ms = 3200) => {
    const box = U.$('#toast');
    const d = document.createElement('div');
    d.textContent = msg;
    box.appendChild(d);
    setTimeout(() => d.remove(), ms);
  };

  U.blobToBase64 = blob => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1]);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
  U.blobToDataURL = blob => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
  U.base64ToBlob = (b64, type) => {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type });
  };

  U.extFor = blob => {
    const t = (blob.type || '').toLowerCase();
    if (t.includes('mp4')) return 'mp4';
    if (t.includes('webm')) return 'webm';
    if (t.includes('png')) return 'png';
    if (t.includes('webp')) return 'webp';
    if (t.includes('jpeg') || t.includes('jpg')) return 'jpg';
    return 'bin';
  };

  /* Save or share a file. Native app: write to cache then open the share sheet
     (user can pick "Save to gallery/files"). Browser: Web Share, else <a download>. */
  U.saveBlob = async (blob, baseName = 'studio') => {
    const name = `${baseName}-${Date.now()}.${U.extFor(blob)}`;
    const cap = window.Capacitor;
    if (cap?.isNativePlatform?.() && cap.Plugins?.Filesystem && cap.Plugins?.Share) {
      const data = await U.blobToBase64(blob);
      const w = await cap.Plugins.Filesystem.writeFile({ path: name, data, directory: 'CACHE' });
      await cap.Plugins.Share.share({ title: name, url: w.uri, dialogTitle: 'حفظ أو مشاركة' });
      return;
    }
    const file = new File([blob], name, { type: blob.type });
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return; }
      catch (e) { if (e.name === 'AbortError') return; }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  };

  U.fmtDur = s => {
    s = Math.round(s);
    return s >= 60 ? `${Math.floor(s / 60)}د ${s % 60}ث` : `${s}ث`;
  };

  U.setProgress = (sel, p) => {
    const box = U.$(sel);
    box.classList.toggle('hidden', p == null);
    if (p != null) box.firstElementChild.style.width = Math.max(0, Math.min(1, p)) * 100 + '%';
  };

  window.U = U;
})();
