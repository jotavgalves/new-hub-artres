(function(){
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>'"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[m]));

  function splitLines(value){
    return String(value || '').split('\n').flatMap(x => x.split(',')).map(x => x.trim()).filter(Boolean);
  }

  function readDraft(){
    const panel = $('catalogStructurePanel');
    const structure = { collections: [], transplants: [] };
    if (!panel) return structure;

    panel.querySelectorAll('[data-collection-row]').forEach(row => {
      const name = row.querySelector('[data-coll="name"]')?.value.trim() || '';
      const id = row.querySelector('[data-coll="id"]')?.value.trim() || '';
      const children = splitLines(row.querySelector('[data-coll="children"]')?.value || '');
      if (!name && !children.length) return;
      structure.collections.push({
        id,
        name,
        children,
        hideChildrenFromRoot: (row.querySelector('[data-coll="hideChildrenFromRoot"]')?.value || 'true') === 'true',
        order: Number(row.querySelector('[data-coll="order"]')?.value) || 0,
        active: (row.querySelector('[data-coll="active"]')?.value || 'true') === 'true'
      });
    });

    panel.querySelectorAll('[data-union-row]').forEach(row => {
      const from = row.querySelector('[data-union="from"]')?.value.trim() || '';
      const to = row.querySelector('[data-union="to"]')?.value.trim() || '';
      if (!from && !to) return;
      structure.transplants.push({
        from,
        to,
        mode: row.querySelector('[data-union="mode"]')?.value || 'mergeAll',
        hideSource: (row.querySelector('[data-union="hideSource"]')?.value || 'true') === 'true',
        active: (row.querySelector('[data-union="active"]')?.value || 'true') === 'true'
      });
    });
    return structure;
  }

  async function requestPreview(){
    const r = await fetch('/api/admin/catalog-preview', {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ catalogStructure: readDraft() })
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.ok === false) throw new Error(d.error || 'Erro ao validar');
    return d;
  }

  function makeCard(){
    const panel = $('catalogStructurePanel');
    if (!panel || $('catalogRealPreview')) return;
    const card = document.createElement('div');
    card.id = 'catalogRealPreview';
    card.className = 'card span-12';
    card.innerHTML = '<div class="sectionHead"><div><h3>Prévia real e validações</h3><p>Valida os nomes com o Drive e mostra a estrutura final do catálogo.</p></div><button id="refreshCatalogPreview" class="btn secondary" type="button">Atualizar prévia</button></div><div id="catalogPreviewBody" class="softCard"><p class="hint">Clique em Atualizar prévia.</p></div>';
    panel.appendChild(card);
    card.querySelector('#refreshCatalogPreview').onclick = loadPreview;
  }

  function render(data){
    const body = $('catalogPreviewBody');
    if (!body) return;
    const warnings = data.warnings || [];
    const info = data.info || [];
    const tree = data.tree || [];
    body.innerHTML = '<div class="catalogPreviewSummary"><b>' + (warnings.length ? warnings.length + ' alerta(s)' : 'Nenhum alerta') + '</b><span>' + (data.totalThemes || 0) + ' tema(s) no Drive · ' + tree.length + ' item(ns) na raiz final</span></div>' +
      warnings.map(w => '<div class="previewWarn">⚠ ' + esc(w) + '</div>').join('') +
      info.map(i => '<div class="previewOk">✓ ' + esc(i) + '</div>').join('') +
      '<div class="catalogTree">' + tree.map(node).join('') + '</div>';
  }

  function node(n){
    if (n.type === 'collection') {
      return '<div class="treeNode collection"><b>📁 ' + esc(n.label) + '</b><small>' + esc(n.status || 'Coleção') + '</small><div>' + (n.children || []).map(c => '<p class="treeChild ' + (c.exists ? '' : 'missing') + '">' + (c.exists ? '├ ' : '⚠ ') + esc(c.label) + (c.exists ? '' : ' · não encontrado') + '</p>').join('') + '</div></div>';
    }
    return '<div class="treeNode"><b>' + esc(n.label) + '</b><small>' + esc(n.status || 'Tema') + '</small>' + ((n.incoming || []).map(i => '<p class="treeChild ' + (i.exists ? '' : 'missing') + '">↳ recebe ' + esc(i.from) + (i.exists ? '' : ' · doador não encontrado') + '</p>').join('')) + '</div>';
  }

  async function loadPreview(){
    const btn = $('refreshCatalogPreview');
    const body = $('catalogPreviewBody');
    if (!btn || !body) return;
    const old = btn.textContent;
    btn.textContent = 'Validando...';
    btn.disabled = true;
    body.innerHTML = '<p class="hint">Lendo Drive...</p>';
    try { render(await requestPreview()); }
    catch (e) { body.innerHTML = '<div class="previewWarn">' + esc(e.message || 'Erro') + '</div>'; }
    finally { btn.textContent = old; btn.disabled = false; }
  }

  function style(){
    if ($('catalogPreviewStyle')) return;
    const s = document.createElement('style');
    s.id = 'catalogPreviewStyle';
    s.textContent = '.catalogPreviewSummary{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:12px}.previewWarn,.previewOk{border-radius:14px;padding:10px 12px;margin:7px 0;font-weight:900}.previewWarn{background:#fff1f1;color:#a52222}.previewOk{background:#eefbf6;color:#116b52}.catalogTree{display:grid;gap:10px;margin-top:12px}.treeNode{border:1px solid #eee2e4;background:#fff;border-radius:18px;padding:13px}.treeNode.collection{background:#fff8fb;border-color:#ffd6e5}.treeNode b{display:block;font-family:Montserrat}.treeNode small{color:#746d73;font-weight:900}.treeChild{margin:8px 0 0;padding:8px 10px;border-radius:12px;background:#f8f5f3;font-weight:800}.treeChild.missing{background:#fff1f1;color:#a52222}.softCard{border:1px solid #eee2e4;border-radius:18px;padding:14px;background:#fff}';
    document.head.appendChild(s);
  }

  function boot(){ style(); makeCard(); }
  document.addEventListener('click', e => { if (e.target && e.target.closest('[data-tab="catalogView"]')) setTimeout(boot, 1000); });
  new MutationObserver(boot).observe(document.body,{childList:true,subtree:true});
  setTimeout(boot, 2200);
})();
