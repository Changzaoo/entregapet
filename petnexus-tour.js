/* ============================================================
   PetNexus - motor de TUTORIAL guiado (spotlight / coachmarks)
   Autossuficiente (injeta o próprio CSS). Funciona em qualquer app.
   API:
     PetNexusTour.start(steps, opts)
       steps: [{ sel?, title, text, pad?, place? }]
         - sel:   seletor CSS do alvo a destacar (se ausente/sem match -> card central)
         - title: título do passo
         - text:  explicação (foco no item destacado)
         - pad:   folga do recorte em px (padrão 8)
         - place: 'auto'|'top'|'bottom' (padrão 'auto')
       opts: { key?, onDone?, onSkip?, labelDone? }
         - key: chave de localStorage p/ marcar como visto (e não repetir sozinho)
     PetNexusTour.done(key)  -> bool (já concluiu?)
     PetNexusTour.reset(key) -> limpa a marca (para "ver de novo")
     PetNexusTour.active()   -> bool
   ============================================================ */
;(function () {
  if (window.PetNexusTour) return;
  var STYLE_ID = 'pntour-style';
  var spot, pop, steps = [], i = 0, cur = null, onDone = null, onSkip = null, labelDone = 'Concluir', running = false;

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style'); s.id = STYLE_ID;
    s.textContent =
      '.pntour-spot{position:fixed;z-index:2147483000;border-radius:16px;box-shadow:0 0 0 9999px rgba(8,15,25,.66);' +
      'transition:top .3s cubic-bezier(.2,.8,.2,1),left .3s,width .3s,height .3s;pointer-events:none}' +
      '.pntour-spot.nodim{box-shadow:0 0 0 9999px rgba(8,15,25,.72)}' +
      '.pntour-pop{position:fixed;z-index:2147483001;max-width:320px;width:calc(100vw - 32px);' +
      'background:#fff;color:#15242c;border-radius:18px;padding:16px 16px 14px;' +
      'box-shadow:0 24px 60px -16px rgba(0,0,0,.55);font-family:Inter,-apple-system,system-ui,sans-serif;' +
      'transition:top .28s cubic-bezier(.2,.8,.2,1),left .28s,opacity .2s;-webkit-font-smoothing:antialiased}' +
      '.pntour-pop.dark{background:#1c1c1e;color:#f5f5f7}' +
      '.pntour-pop h4{margin:0 0 6px;font-size:1.04rem;font-weight:800;letter-spacing:-.02em;display:flex;align-items:center;gap:8px;color:inherit}' +
      '.pntour-pop .pndot{width:24px;height:24px;border-radius:8px;background:linear-gradient(135deg,#16C0CC,#0E7C86);color:#fff;display:grid;place-items:center;font-size:.78rem;font-weight:800;flex:none}' +
      '.pntour-pop p{margin:0;font-size:.89rem;line-height:1.5;color:#4a575e}' +
      '.pntour-pop.dark p{color:#a1a1a6}' +
      '.pntour-bar{display:flex;align-items:center;justify-content:space-between;margin-top:15px;gap:10px}' +
      '.pntour-steps{font-size:.74rem;font-weight:700;color:#9aa4ab;font-variant-numeric:tabular-nums}' +
      '.pntour-btns{display:flex;gap:8px;align-items:center}' +
      '.pntour-btn{border:none;font-family:inherit;font-weight:700;font-size:.85rem;padding:9px 15px;border-radius:11px;cursor:pointer;transition:transform .15s}' +
      '.pntour-btn:active{transform:scale(.96)}' +
      '.pntour-skip{background:none;color:#9aa4ab;padding:9px 4px;font-size:.8rem}' +
      '.pntour-prev{background:#eef2f4;color:#48555c}' +
      '.pntour-pop.dark .pntour-prev{background:#2c2c2e;color:#d1d1d6}' +
      '.pntour-next{background:linear-gradient(135deg,#16C0CC,#0E7C86);color:#fff;box-shadow:0 8px 20px -8px rgba(14,124,134,.6)}';
    document.head.appendChild(s);
  }

  function build() {
    injectStyle();
    spot = document.createElement('div'); spot.className = 'pntour-spot';
    pop = document.createElement('div'); pop.className = 'pntour-pop';
    document.body.appendChild(spot); document.body.appendChild(pop);
    if ((document.documentElement.getAttribute('data-theme') || '') === 'dark') pop.classList.add('dark');
    window.addEventListener('resize', reposition, { passive: true });
  }

  function teardown() {
    window.removeEventListener('resize', reposition);
    if (spot && spot.parentNode) spot.parentNode.removeChild(spot);
    if (pop && pop.parentNode) pop.parentNode.removeChild(pop);
    spot = pop = null; running = false;
  }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>]/g, function (m) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[m]; }); }

  function render() {
    var st = steps[i]; if (!st) return finish(false);
    var first = i === 0, last = i === steps.length - 1;
    pop.innerHTML =
      '<h4><span class="pndot">' + (i + 1) + '</span>' + esc(st.title || '') + '</h4>' +
      '<p>' + esc(st.text || '') + '</p>' +
      '<div class="pntour-bar"><span class="pntour-steps">' + (i + 1) + ' / ' + steps.length + '</span>' +
      '<div class="pntour-btns">' +
      '<button class="pntour-btn pntour-skip" data-act="skip">Pular tudo</button>' +
      (first ? '' : '<button class="pntour-btn pntour-prev" data-act="prev">Voltar</button>') +
      '<button class="pntour-btn pntour-next" data-act="next">' + (last ? esc(labelDone) : 'Próximo') + '</button>' +
      '</div></div>';
    pop.querySelector('[data-act="skip"]').onclick = function () { finish(true); };
    var pv = pop.querySelector('[data-act="prev"]'); if (pv) pv.onclick = function () { i = Math.max(0, i - 1); render(); };
    pop.querySelector('[data-act="next"]').onclick = function () { if (last) finish(false); else { i++; render(); } };
    cur = st.sel ? document.querySelector(st.sel) : null;
    if (cur) { try { cur.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' }); } catch (e) { } }
    setTimeout(reposition, cur ? 240 : 0);
  }

  function reposition() {
    if (!pop) return;
    var vw = window.innerWidth, vh = window.innerHeight, st = steps[i] || {};
    var pad = st.pad == null ? 8 : st.pad;
    var r = cur ? cur.getBoundingClientRect() : null;
    if (r && r.width && r.height && r.bottom > 0 && r.top < vh) {
      spot.style.display = 'block';
      spot.style.top = (r.top - pad) + 'px'; spot.style.left = (r.left - pad) + 'px';
      spot.style.width = (r.width + pad * 2) + 'px'; spot.style.height = (r.height + pad * 2) + 'px';
      spot.classList.remove('nodim');
    } else {
      // sem alvo visível: escurece tudo, card no centro
      spot.style.display = 'block'; spot.classList.add('nodim');
      spot.style.top = '-9999px'; spot.style.left = '-9999px'; spot.style.width = '0'; spot.style.height = '0';
    }
    // posiciona o card
    var pr = pop.getBoundingClientRect(), ph = pr.height || 150, pwid = pr.width || 300;
    var top, left;
    if (r && r.width) {
      var place = st.place || 'auto';
      var below = r.bottom + 14, above = r.top - ph - 14;
      if (place === 'top') top = above;
      else if (place === 'bottom') top = below;
      else top = (below + ph < vh - 8) ? below : (above > 8 ? above : below);
      left = Math.min(Math.max(12, r.left + r.width / 2 - pwid / 2), vw - pwid - 12);
      top = Math.min(Math.max(12, top), vh - ph - 12);
    } else {
      top = (vh - ph) / 2; left = (vw - pwid) / 2;
    }
    pop.style.top = top + 'px'; pop.style.left = left + 'px'; pop.style.opacity = '1';
  }

  function finish(skipped) {
    if (cur != null) cur = null;
    var st = steps; teardown();
    if (window._pntourKey) { try { localStorage.setItem(window._pntourKey, '1'); } catch (e) { } }
    if (skipped && onSkip) try { onSkip(); } catch (e) { }
    if (onDone) try { onDone(skipped); } catch (e) { }
    onDone = onSkip = null;
  }

  window.PetNexusTour = {
    start: function (s, opts) {
      opts = opts || {};
      if (running) teardown();
      steps = (s || []).slice(); i = 0; onDone = opts.onDone || null; onSkip = opts.onSkip || null;
      labelDone = opts.labelDone || 'Concluir'; window._pntourKey = opts.key || null; running = true;
      if (!steps.length) { running = false; return; }
      build(); render();
    },
    done: function (key) { try { return localStorage.getItem(key) === '1'; } catch (e) { return false; } },
    reset: function (key) { try { localStorage.removeItem(key); } catch (e) { } },
    active: function () { return running; }
  };
})();
