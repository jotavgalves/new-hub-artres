(function(){
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>'"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[m]));
  let config = null;

  async function api(url, opts = {}) {
    const r = await fetch(url, { credentials:'include', cache:'no-store', headers:{ 'Content-Type':'application/json', 'Cache-Control':'no-store', ...(opts.headers || {}) }, ...opts });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.ok === false) throw new Error(d.error || 'Erro');
    return d;
  }

  function toast(msg, type = 'ok') {
    const el = $('status');
    if (!el) return;
    el.textContent = msg;
    el.className = 'status ' + type;
    el.classList.remove('hidden');
  }
  function busy(btn, text = 'Salvando...') {
    if (!btn) return () => {};
    const old = btn.textContent;
    btn.textContent = text;
    btn.disabled = true;
    return () => { btn.textContent = old; btn.disabled = false; };
  }
  function lines(v) { return String(v || '').split('\n').flatMap(x => x.split(',')).map(x => x.trim()).filter(Boolean); }
  function slug(v) { return String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,''); }
  function now() { return new Date().toISOString(); }
  function by() { return 'Helena/Admin'; }
  function digits(v) { return String(v || '').replace(/\D/g, ''); }
  function norm(v) { return String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[_-]+/g,' ').replace(/\s+/g,' ').trim(); }
  function fmt(v) { if (!v) return ''; try { return new Date(v).toLocaleString('pt-BR'); } catch (_) { return v; } }

  function controls() {
    config.catalogControls = config.catalogControls || {};
    const c = config.catalogControls;
    c.artBlocks = normalizeArtBlocks(c);
    c.themeBlocks = normalizeThemeBlocks(c);
    c.themeOverrides = Array.isArray(c.themeOverrides) ? c.themeOverrides : [];
    c.subthemeOverrides = Array.isArray(c.subthemeOverrides) ? c.subthemeOverrides : [];
    c.catalogHistory = Array.isArray(c.catalogHistory) ? c.catalogHistory : [];
    syncLegacy(c);
    return c;
  }
  function structure() {
    config.catalogStructure = config.catalogStructure || { collections:[], transplants:[] };
    config.catalogStructure.collections = config.catalogStructure.collections || [];
    config.catalogStructure.transplants = config.catalogStructure.transplants || [];
    return config.catalogStructure;
  }
  function normalizeArtBlocks(c) {
    const map = new Map();
    (Array.isArray(c.artBlocks) ? c.artBlocks : []).forEach(b => {
      const code = digits(b.code);
      if (!code) return;
      map.set(code, { code, theme:b.theme || '', product:b.product || b.productName || '', image:b.image || '', found:b.found, active:b.active !== false, blockedAt:b.blockedAt || '', blockedBy:b.blockedBy || 'Admin', reason:b.reason || '' });
    });
    (Array.isArray(c.hiddenArtCodes) ? c.hiddenArtCodes : []).forEach(code => {
      code = digits(code);
      if (code && !map.has(code)) map.set(code, { code, theme:'', product:'', image:'', found:undefined, active:true, blockedAt:'', blockedBy:'Migração', reason:'' });
    });
    return [...map.values()];
  }
  function normalizeThemeBlocks(c) {
    const map = new Map();
    (Array.isArray(c.themeBlocks) ? c.themeBlocks : []).forEach(b => {
      const name = String(b.name || b.theme || '').trim();
      if (!name) return;
      map.set(norm(name), { name, found:b.found, active:b.active !== false, blockedAt:b.blockedAt || '', blockedBy:b.blockedBy || 'Admin', reason:b.reason || '' });
    });
    (Array.isArray(c.hiddenThemes) ? c.hiddenThemes : []).forEach(name => {
      name = String(name || '').trim();
      if (name && !map.has(norm(name))) map.set(norm(name), { name, found:undefined, active:true, blockedAt:'', blockedBy:'Migração', reason:'' });
    });
    return [...map.values()];
  }
  function activeArts() { return controls().artBlocks.filter(b => b && b.active !== false && digits(b.code)); }
  function activeThemes() { return controls().themeBlocks.filter(b => b && b.active !== false && String(b.name || '').trim()); }
  function syncLegacy(c) {
    c.hiddenArtCodes = (c.artBlocks || []).filter(b => b && b.active !== false && digits(b.code)).map(b => digits(b.code));
    c.hiddenThemes = (c.themeBlocks || []).filter(b => b && b.active !== false && String(b.name || '').trim()).map(b => b.name);
    return c;
  }
  function pushHistory(entry) {
    const c = controls();
    c.catalogHistory = [{ at:now(), by:by(), ...entry }, ...(c.catalogHistory || [])].slice(0, 80);
  }

  async function load() {
    try {
      const d = await api('/api/admin/config?ts=' + Date.now());
      config = d.config;
      controls();
      structure();
      renderCatalog();
      renderUsers();
      patchOrders();
      patchSaveButtons();
      polishAdmin();
    } catch (e) {}
  }
  async function save(msg, reloadAfter = false) {
    config.ui = config.ui || {};
    config.ui.cacheVersion = Number(config.ui.cacheVersion || 1) + 1;
    syncLegacy(controls());
    await api('/api/admin/config', { method:'POST', body:JSON.stringify({ config }) });
    try { await api('/api/admin/cache', { method:'POST' }); } catch (_) {}
    toast(msg || 'Salvo com sucesso. Catálogo atualizado.');
    if (reloadAfter) setTimeout(() => location.reload(), 700);
  }

  function renderCatalog() {
    const p = $('catalogPanel');
    if (!p || !config) return;
    const c = controls();
    const s = structure();
    p.innerHTML = `
      <div class="card span-12 catalogControlHeader">
        <div class="sectionHead catalogHeadLine">
          <div><h3>Bloqueios do catálogo</h3><p>Controle visual de artes e temas. A lista técnica é gerada automaticamente, sem duas fontes brigando.</p></div>
          <button id="saveCatalogControl" class="btn green" type="button">Salvar e atualizar catálogo</button>
        </div>
        <div class="catalogQuickGrid">
          <section class="catalogActionBox">
            <div class="actionText"><label>Bloquear arte por ID</label><p>Digite o código da arte. Depois valide para puxar imagem, tema e produto.</p></div>
            <div class="actionControls"><input id="newArtBlock" placeholder="2670" inputmode="numeric"><button id="addArtBlock" class="btn secondary" type="button">Bloquear ID</button></div>
          </section>
          <section class="catalogActionBox">
            <div class="actionText"><label>Ocultar tema</label><p>O tema deixa de aparecer no site e nas buscas.</p></div>
            <div class="actionControls"><input id="newThemeBlock" placeholder="Minnie"><button id="addThemeBlock" class="btn secondary" type="button">Ocultar tema</button></div>
          </section>
        </div>
      </div>
      <div class="card span-12"><div class="sectionHead"><div><h3>Artes bloqueadas</h3><p>${activeArts().length} bloqueio(s) ativo(s).</p></div><button id="validateBlocksTop" class="btn secondary" type="button">Validar bloqueios</button></div><div id="blockedArtsList" class="blockGrid">${activeArts().map(artBlockHtml).join('') || '<p class="hint">Nenhuma arte bloqueada.</p>'}</div></div>
      <div class="card span-12"><div class="sectionHead"><div><h3>Temas ocultos</h3><p>${activeThemes().length} tema(s) oculto(s).</p></div></div><div id="blockedThemesList" class="blockGrid">${activeThemes().map(themeBlockHtml).join('') || '<p class="hint">Nenhum tema oculto.</p>'}</div></div>
      <div class="card span-12"><div class="sectionHead"><div><h3>Prévia real e validações</h3><p>Mostra apenas resumo, alertas e bloqueios. A árvore completa fica recolhida.</p></div><button id="refreshCatalogPreview" class="btn secondary" type="button">Atualizar prévia</button></div><div id="catalogPreviewBody"><p class="hint">Clique em Atualizar prévia para validar antes de salvar.</p></div></div>
      <div class="card span-12"><div class="sectionHead"><div><h3>Organização avançada</h3><p>Coleções virtuais e união de conteúdo.</p></div></div><div class="grid"><div class="card span-12 softCard"><div class="sectionHead"><div><h3>Coleções de temas</h3><p>Ex.: Disney contendo Minnie e Mickey.</p></div><button id="addCollection" class="btn secondary" type="button">Adicionar coleção</button></div><div id="collectionsList">${(s.collections || []).map(collectionHtml).join('') || '<p class="hint">Nenhuma coleção criada.</p>'}</div></div><div class="card span-12 softCard"><div class="sectionHead"><div><h3>Unir conteúdo de temas</h3><p>Ex.: Quadrado aparece dentro de Polígonos e Quadrado some da raiz.</p></div><button id="addTransplant" class="btn secondary" type="button">Adicionar união</button></div><div id="transplantsList">${(s.transplants || []).map(transplantHtml).join('') || '<p class="hint">Nenhuma união criada.</p>'}</div></div></div></div>
      <div class="card span-12"><div class="sectionHead"><div><h3>Renomear, ocultar e ordenar temas</h3><p>Use o nome original da pasta no Drive.</p></div><button id="addThemeRule" class="btn secondary" type="button">Adicionar regra</button></div><div id="themeRules">${(c.themeOverrides || []).map(ruleHtml).join('') || '<p class="hint">Nenhuma regra criada.</p>'}</div></div>
      <div class="card span-12"><div class="sectionHead"><div><h3>Histórico de bloqueios</h3><p>Últimas alterações feitas na aba Catálogo.</p></div></div><div class="historyList">${(c.catalogHistory || []).slice(0, 20).map(historyHtml).join('') || '<p class="hint">Nenhuma alteração registrada ainda.</p>'}</div></div>`;
    bindCatalog();
  }

  function artBlockHtml(b) {
    const status = b.found === true ? '<em class="ok">Encontrada</em>' : b.found === false ? '<em class="warn">Não encontrada</em>' : '<em>Não validada</em>';
    const img = b.image ? `<img src="${esc(b.image)}" alt="Arte #${esc(b.code)}">` : `<div class="thumbEmpty">#${esc(b.code)}</div>`;
    return `<div class="blockCard artBlockCard"><div class="blockThumb">${img}</div><div class="blockInfo"><b>ID ${esc(b.code)}</b><span>${esc(b.theme || 'Tema não validado')} · ${esc(b.product || 'Produto não validado')}</span><small>${status} · Bloqueado em: ${esc(fmt(b.blockedAt) || 'não informado')} · Por: ${esc(b.blockedBy || 'Admin')}</small></div><button class="btn danger" data-unblock-art="${esc(b.code)}" type="button">Desbloquear</button></div>`;
  }
  function themeBlockHtml(b) {
    const status = b.found === true ? '<em class="ok">Encontrado</em>' : b.found === false ? '<em class="warn">Não encontrado</em>' : '<em>Não validado</em>';
    return `<div class="blockCard"><div class="blockInfo"><b>${esc(b.name)}</b><span>Tema oculto no catálogo</span><small>${status} · Oculto em: ${esc(fmt(b.blockedAt) || 'não informado')} · Por: ${esc(b.blockedBy || 'Admin')}</small></div><button class="btn danger" data-unblock-theme="${esc(norm(b.name))}" type="button">Reativar</button></div>`;
  }
  function historyHtml(h) { return `<div class="historyItem"><b>${esc(h.type || 'alteração')}</b><span>${esc(h.code ? '#' + h.code : (h.name || ''))}</span><small>${esc(fmt(h.at))} · ${esc(h.by || 'Admin')}</small></div>`; }

  function bindCatalog() {
    const c = controls();
    const s = structure();
    $('addArtBlock').onclick = () => {
      const code = digits($('newArtBlock').value);
      if (!code) return toast('Informe o ID da arte.', 'err');
      const existing = c.artBlocks.find(b => digits(b.code) === code);
      if (existing) { existing.active = true; existing.blockedAt = existing.blockedAt || now(); existing.blockedBy = existing.blockedBy || by(); }
      else c.artBlocks.push({ code, theme:'', product:'', image:'', active:true, blockedAt:now(), blockedBy:by(), reason:'' });
      pushHistory({ type:'bloqueou arte', code });
      syncLegacy(c);
      renderCatalog();
    };
    $('addThemeBlock').onclick = () => {
      const name = String($('newThemeBlock').value || '').trim();
      if (!name) return toast('Informe o tema.', 'err');
      const existing = c.themeBlocks.find(b => norm(b.name) === norm(name));
      if (existing) { existing.active = true; existing.blockedAt = existing.blockedAt || now(); existing.blockedBy = existing.blockedBy || by(); }
      else c.themeBlocks.push({ name, active:true, blockedAt:now(), blockedBy:by(), reason:'' });
      pushHistory({ type:'ocultou tema', name });
      syncLegacy(c);
      renderCatalog();
    };
    $('validateBlocksTop').onclick = loadPreview;
    $('refreshCatalogPreview').onclick = loadPreview;
    $('saveCatalogControl').onclick = async e => {
      const done = busy(e.currentTarget);
      try { readCatalogForm(); await save('Regras do catálogo salvas. Você continua na aba Catálogo.', false); }
      catch (err) { toast(err.message || 'Erro ao salvar', 'err'); }
      finally { done(); }
    };
    $('addThemeRule').onclick = () => { c.themeOverrides.push({ match:'', displayName:'', order:0, hidden:false }); renderCatalog(); };
    $('addCollection').onclick = () => { s.collections.push({ id:'', name:'Nova coleção', children:[], hideChildrenFromRoot:true, order:0, active:true }); renderCatalog(); };
    $('addTransplant').onclick = () => { s.transplants.push({ from:'', to:'', mode:'mergeAll', hideSource:true, active:true }); renderCatalog(); };
    document.querySelectorAll('[data-unblock-art]').forEach(b => b.onclick = () => { const code = digits(b.dataset.unblockArt); const row = c.artBlocks.find(x => digits(x.code) === code); if (row) row.active = false; pushHistory({ type:'desbloqueou arte', code }); syncLegacy(c); renderCatalog(); });
    document.querySelectorAll('[data-unblock-theme]').forEach(b => b.onclick = () => { const row = c.themeBlocks.find(x => norm(x.name) === b.dataset.unblockTheme); if (row) row.active = false; pushHistory({ type:'reativou tema', name:row && row.name }); syncLegacy(c); renderCatalog(); });
    document.querySelectorAll('[data-rm-theme-rule]').forEach(b => b.onclick = () => { c.themeOverrides.splice(+b.dataset.rmThemeRule, 1); renderCatalog(); });
    document.querySelectorAll('[data-rm-collection]').forEach(b => b.onclick = () => { s.collections.splice(+b.dataset.rmCollection, 1); renderCatalog(); });
    document.querySelectorAll('[data-rm-transplant]').forEach(b => b.onclick = () => { s.transplants.splice(+b.dataset.rmTransplant, 1); renderCatalog(); });
  }

  function readCatalogForm() {
    const c = controls();
    const s = structure();
    syncLegacy(c);
    c.themeOverrides = [];
    document.querySelectorAll('[data-theme-rule]').forEach(row => {
      const r = { match:row.querySelector('[data-r="match"]').value.trim(), displayName:row.querySelector('[data-r="displayName"]').value.trim(), order:Number(row.querySelector('[data-r="order"]').value) || 0, hidden:row.querySelector('[data-r="hidden"]').value === 'true' };
      if (r.match || r.displayName) c.themeOverrides.push(r);
    });
    s.collections = [];
    document.querySelectorAll('[data-collection-row]').forEach(row => {
      const name = row.querySelector('[data-coll="name"]').value.trim();
      const children = lines(row.querySelector('[data-coll="children"]').value);
      if (name && children.length) s.collections.push({ id:row.querySelector('[data-coll="id"]').value.trim() || slug(name), name, children, hideChildrenFromRoot:row.querySelector('[data-coll="hideChildrenFromRoot"]').value === 'true', order:Number(row.querySelector('[data-coll="order"]').value) || 0, active:row.querySelector('[data-coll="active"]').value === 'true' });
    });
    s.transplants = [];
    document.querySelectorAll('[data-transplant-row]').forEach(row => {
      const from = row.querySelector('[data-tr="from"]').value.trim();
      const to = row.querySelector('[data-tr="to"]').value.trim();
      if (from && to) s.transplants.push({ from, to, mode:row.querySelector('[data-tr="mode"]').value, hideSource:row.querySelector('[data-tr="hideSource"]').value === 'true', active:row.querySelector('[data-tr="active"]').value === 'true' });
    });
    return { catalogControls:c, catalogStructure:s };
  }

  async function loadPreview() {
    const body = $('catalogPreviewBody');
    const btn = $('refreshCatalogPreview') || $('validateBlocksTop');
    if (!body || !btn) return;
    const done = busy(btn, 'Validando...');
    body.innerHTML = '<p class="hint">Validando bloqueios e estrutura...</p>';
    try {
      const draft = readCatalogForm();
      const [treeData, blockData] = await Promise.all([
        api('/api/admin/catalog-preview', { method:'POST', body:JSON.stringify({ catalogStructure:draft.catalogStructure }) }),
        api('/api/admin/catalog-blocks-preview', { method:'POST', body:JSON.stringify({ catalogControls:draft.catalogControls }) })
      ]);
      applyBlockPreview(blockData);
      refreshBlockSections();
      renderPreview(treeData, blockData);
    } catch (e) { body.innerHTML = `<div class="previewWarn">${esc(e.message || 'Erro')}</div>`; }
    finally { done(); }
  }
  function applyBlockPreview(data) {
    const c = controls();
    (data.blockedArts || []).forEach(p => {
      const row = c.artBlocks.find(x => digits(x.code) === digits(p.code));
      if (!row) return;
      const first = p.matches && p.matches[0] || {};
      row.found = !!p.found;
      row.theme = p.theme || first.theme || row.theme || '';
      row.product = p.product || first.product || row.product || '';
      row.image = first.image || p.image || row.image || '';
    });
    (data.blockedThemes || []).forEach(p => {
      const row = c.themeBlocks.find(x => norm(x.name) === norm(p.name));
      if (row) row.found = !!p.found;
    });
    syncLegacy(c);
  }
  function refreshBlockSections() {
    const arts = $('blockedArtsList');
    const themes = $('blockedThemesList');
    if (arts) arts.innerHTML = activeArts().map(artBlockHtml).join('') || '<p class="hint">Nenhuma arte bloqueada.</p>';
    if (themes) themes.innerHTML = activeThemes().map(themeBlockHtml).join('') || '<p class="hint">Nenhum tema oculto.</p>';
    document.querySelectorAll('[data-unblock-art]').forEach(b => b.onclick = () => { const c = controls(); const code = digits(b.dataset.unblockArt); const row = c.artBlocks.find(x => digits(x.code) === code); if (row) row.active = false; pushHistory({ type:'desbloqueou arte', code }); syncLegacy(c); renderCatalog(); });
    document.querySelectorAll('[data-unblock-theme]').forEach(b => b.onclick = () => { const c = controls(); const row = c.themeBlocks.find(x => norm(x.name) === b.dataset.unblockTheme); if (row) row.active = false; pushHistory({ type:'reativou tema', name:row && row.name }); syncLegacy(c); renderCatalog(); });
  }
  function renderPreview(treeData, blockData) {
    const body = $('catalogPreviewBody');
    const warnings = [...(blockData.warnings || []), ...(treeData.warnings || [])];
    const info = [...(blockData.info || []), ...(treeData.info || [])];
    const tree = treeData.tree || [];
    const foundArts = (blockData.blockedArts || []).filter(x => x.found).length;
    const missingArts = (blockData.blockedArts || []).filter(x => !x.found).length;
    const foundThemes = (blockData.blockedThemes || []).filter(x => x.found).length;
    const missingThemes = (blockData.blockedThemes || []).filter(x => !x.found).length;
    body.innerHTML = `<div class="catalogPreviewCards"><div><b>${warnings.length}</b><span>alerta(s)</span></div><div><b>${foundArts}</b><span>arte(s) encontrada(s)</span></div><div><b>${missingArts}</b><span>arte(s) não encontrada(s)</span></div><div><b>${foundThemes}</b><span>tema(s) encontrado(s)</span></div><div><b>${missingThemes}</b><span>tema(s) não encontrado(s)</span></div></div>${warnings.map(w => `<div class="previewWarn">⚠ ${esc(w)}</div>`).join('')}${info.slice(0, 12).map(i => `<div class="previewOk">✓ ${esc(i)}</div>`).join('')}${info.length > 12 ? `<p class="hint">+ ${info.length - 12} validação(ões) ocultas para não poluir a tela.</p>` : ''}<details class="catalogDetails"><summary>Ver amostra técnica da árvore do catálogo (${tree.length} itens)</summary><div class="catalogTree">${tree.slice(0, 60).map(nodeHtml).join('')}${tree.length > 60 ? `<p class="hint">Mostrando 60 de ${tree.length} itens. A lista completa foi ocultada para não virar uma parede vertical.</p>` : ''}</div></details>`;
  }
  function nodeHtml(n) {
    if (n.type === 'collection') return `<div class="treeNode collection"><b>📁 ${esc(n.label)}</b><small>${esc(n.status || 'Coleção')}</small>${(n.children || []).map(c => `<p class="treeChild ${c.exists ? '' : 'missing'}">${c.exists ? '├' : '⚠'} ${esc(c.label)}${c.exists ? '' : ' · não encontrado'}</p>`).join('')}</div>`;
    return `<div class="treeNode"><b>${esc(n.label)}</b><small>${esc(n.status || 'Tema')}</small>${(n.incoming || []).map(i => `<p class="treeChild ${i.exists ? '' : 'missing'}">↳ recebe ${esc(i.from)}${i.exists ? '' : ' · doador não encontrado'}</p>`).join('')}</div>`;
  }

  function collectionHtml(r, i) { return `<div class="item" data-collection-row="${i}"><div class="grid"><div class="field span-3"><label>Nome da coleção</label><input data-coll="name" value="${esc(r.name || '')}"></div><div class="field span-2"><label>ID interno</label><input data-coll="id" value="${esc(r.id || '')}"></div><div class="field span-4"><label>Temas dentro</label><textarea data-coll="children" placeholder="Minnie\nMickey">${esc((r.children || []).join('\n'))}</textarea></div><div class="field span-1"><label>Ordem</label><input data-coll="order" value="${esc(r.order || 0)}"></div><div class="field span-1"><label>Ocultar filhos</label><select data-coll="hideChildrenFromRoot"><option value="true" ${r.hideChildrenFromRoot !== false ? 'selected' : ''}>Sim</option><option value="false" ${r.hideChildrenFromRoot === false ? 'selected' : ''}>Não</option></select></div><div class="field span-1"><label>Status</label><select data-coll="active"><option value="true" ${r.active !== false ? 'selected' : ''}>Ativa</option><option value="false" ${r.active === false ? 'selected' : ''}>Inativa</option></select></div><div class="field span-12"><button class="btn danger" data-rm-collection="${i}" type="button">Remover coleção</button></div></div></div>`; }
  function transplantHtml(r, i) { return `<div class="item" data-transplant-row="${i}"><div class="grid"><div class="field span-3"><label>Tema doador</label><input data-tr="from" value="${esc(r.from || '')}"></div><div class="field span-3"><label>Tema receptor</label><input data-tr="to" value="${esc(r.to || '')}"></div><div class="field span-2"><label>Tipo</label><select data-tr="mode"><option value="mergeAll" ${r.mode !== 'mergeItems' && r.mode !== 'mergeFolders' ? 'selected' : ''}>Juntar tudo</option><option value="mergeItems" ${r.mode === 'mergeItems' ? 'selected' : ''}>Só artes diretas</option><option value="mergeFolders" ${r.mode === 'mergeFolders' ? 'selected' : ''}>Só subpastas</option></select></div><div class="field span-2"><label>Ocultar doador</label><select data-tr="hideSource"><option value="true" ${r.hideSource !== false ? 'selected' : ''}>Sim</option><option value="false" ${r.hideSource === false ? 'selected' : ''}>Não</option></select></div><div class="field span-1"><label>Status</label><select data-tr="active"><option value="true" ${r.active !== false ? 'selected' : ''}>Ativa</option><option value="false" ${r.active === false ? 'selected' : ''}>Inativa</option></select></div><div class="field span-1"><label>Ação</label><button class="btn danger" data-rm-transplant="${i}" type="button">Remover</button></div></div></div>`; }
  function ruleHtml(r, i) { return `<div class="item" data-theme-rule="${i}"><div class="grid"><div class="field span-3"><label>Tema original</label><input data-r="match" value="${esc(r.match || '')}"></div><div class="field span-3"><label>Nome exibido</label><input data-r="displayName" value="${esc(r.displayName || '')}"></div><div class="field span-2"><label>Ordem</label><input data-r="order" value="${esc(r.order || 0)}"></div><div class="field span-2"><label>Oculto</label><select data-r="hidden"><option value="false" ${!r.hidden ? 'selected' : ''}>Não</option><option value="true" ${r.hidden ? 'selected' : ''}>Sim</option></select></div><div class="field span-2"><label>Ação</label><button class="btn danger" data-rm-theme-rule="${i}" type="button">Remover</button></div></div></div>`; }

  function renderUsers() {
    const p = $('usersPanel') || $('permissionsPanel');
    if (!p || !config) return;
    config.permissions = config.permissions || { users:[], roles:['admin','vendedora','editor','visualizador'] };
    const users = config.permissions.users || [];
    p.innerHTML = `<div class="card span-12"><div class="sectionHead"><div><h3>Usuários e permissões</h3><p>Cadastro administrativo interno. O acesso principal por ADMIN_SECRET_KEY continua ativo.</p></div><button id="addUser" class="btn secondary" type="button">Adicionar usuário</button></div><div id="usersList">${users.map(userHtml).join('') || '<p class="hint">Nenhum usuário criado.</p>'}</div><button id="saveUsers" class="btn green" type="button">Salvar usuários</button><p class="hint">Por segurança, não coloque senhas reais enquanto a autenticação individual não estiver totalmente ativada no backend.</p></div>`;
    $('addUser').onclick = () => { users.push({ username:'novo', name:'Novo usuário', role:'visualizador', active:true }); renderUsers(); };
    $('saveUsers').onclick = async e => { const done = busy(e.currentTarget); try { config.permissions.users = []; document.querySelectorAll('[data-user-row]').forEach(row => { const u = { username:row.querySelector('[data-u="username"]').value.trim(), name:row.querySelector('[data-u="name"]').value.trim(), role:row.querySelector('[data-u="role"]').value, active:row.querySelector('[data-u="active"]').value === 'true' }; if (u.username) config.permissions.users.push(u); }); await save('Usuários salvos.'); } catch (err) { toast(err.message || 'Erro', 'err'); } finally { done(); } };
    document.querySelectorAll('[data-rm-user]').forEach(b => b.onclick = () => { users.splice(+b.dataset.rmUser, 1); renderUsers(); });
  }
  function userHtml(u, i) { const roles = config.permissions.roles || ['admin','vendedora','editor','visualizador']; return `<div class="item" data-user-row="${i}"><div class="grid"><div class="field span-3"><label>Usuário</label><input data-u="username" value="${esc(u.username || '')}"></div><div class="field span-3"><label>Nome</label><input data-u="name" value="${esc(u.name || '')}"></div><div class="field span-2"><label>Perfil</label><select data-u="role">${roles.map(r => `<option value="${esc(r)}" ${u.role === r ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select></div><div class="field span-2"><label>Status</label><select data-u="active"><option value="true" ${u.active !== false ? 'selected' : ''}>Ativo</option><option value="false" ${u.active === false ? 'selected' : ''}>Inativo</option></select></div><div class="field span-2"><label>Ação</label><button class="btn danger" data-rm-user="${i}" type="button">Remover</button></div></div></div>`; }

  function patchOrders() { if (document.body.dataset.ordersDeletePatched) return; document.body.dataset.ordersDeletePatched = '1'; document.addEventListener('click', async e => { const btn = e.target && e.target.closest('[data-delete-order]'); if (!btn) return; const id = btn.dataset.deleteOrder; if (!confirm('Excluir este pedido?')) return; const done = busy(btn, 'Excluindo...'); try { const d = await api('/api/orders/delete', { method:'POST', body:JSON.stringify({ id }) }); toast(d.alreadyMissing ? 'Pedido já não existia no banco. Removi da tela.' : 'Pedido excluído.'); btn.closest('.item')?.remove(); } catch (err) { toast(err.message, 'err'); } finally { done(); } }); }
  function enhanceOrdersPanel() { const list = $('ordersList'); if (!list) return; list.querySelectorAll('.item').forEach(item => { if (item.querySelector('[data-delete-order]')) return; const sel = item.querySelector('[data-order-status]'); const id = sel && sel.dataset.orderStatus; if (!id) return; const wrap = document.createElement('div'); wrap.className = 'actions orderActions'; wrap.innerHTML = `<button class="btn danger" data-delete-order="${esc(id)}" type="button">Excluir pedido</button>`; item.appendChild(wrap); }); }
  function patchSaveButtons() { ['saveBtn','saveBtnTop'].forEach(id => { const b = $(id); if (!b || b.dataset.progressPatched) return; b.dataset.progressPatched = '1'; b.addEventListener('click', () => { const old = b.textContent; b.textContent = 'Salvando...'; b.disabled = true; setTimeout(() => { b.textContent = old; b.disabled = false; }, 2200); }, true); }); }
  function polishAdmin() { document.querySelectorAll('#permissionsPanel > .card,.softCard').forEach(card => card.classList.add('softCard')); }
  function injectStyle() {
    if ($('catalogUnifiedStyle')) return;
    const s = document.createElement('style');
    s.id = 'catalogUnifiedStyle';
    s.textContent = '.catalogHeadLine{align-items:center}.catalogQuickGrid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px}.catalogActionBox{border:1px solid #eee2e4;border-radius:22px;background:#fff;padding:16px;display:grid;gap:12px}.catalogActionBox label{display:block;text-transform:uppercase;letter-spacing:.05em;font-size:12px;font-weight:950;color:#6b6268;margin-bottom:6px}.catalogActionBox p{margin:0;color:#6f6872;font-weight:750;font-size:13px}.actionControls{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center}.actionControls input{min-height:48px}.actionControls .btn{white-space:nowrap;min-height:48px;padding:0 18px}.catalogPreviewCards{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:14px}.catalogPreviewCards div{border:1px solid #eee2e4;background:#fff;border-radius:16px;padding:12px}.catalogPreviewCards b{display:block;font-family:Montserrat;font-size:22px}.catalogPreviewCards span{font-size:12px;font-weight:900;color:#6f6872}.catalogDetails{margin-top:14px;border:1px solid #eee2e4;border-radius:16px;background:#fff;padding:12px}.catalogDetails summary{cursor:pointer;font-weight:950;color:#2f2930}.catalogPreviewSummary{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:12px}.previewWarn,.previewOk{border-radius:14px;padding:10px 12px;margin:7px 0;font-weight:900}.previewWarn{background:#fff1f1;color:#a52222}.previewOk{background:#eefbf6;color:#116b52}.catalogTree{display:grid;gap:10px;margin-top:12px}.treeNode{border:1px solid #eee2e4;background:#fff;border-radius:18px;padding:13px}.treeNode.collection{background:#fff8fb;border-color:#ffd6e5}.treeNode b{display:block;font-family:Montserrat}.treeNode small{color:#746d73;font-weight:900}.treeChild{margin:8px 0 0;padding:8px 10px;border-radius:12px;background:#f8f5f3;font-weight:800}.treeChild.missing{background:#fff1f1;color:#a52222}.softCard{border:1px solid #eee2e4!important;border-radius:18px!important;background:#fff!important}.blockGrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(310px,1fr));gap:12px}.blockCard{display:grid;grid-template-columns:1fr auto;align-items:center;gap:12px;border:1px solid #eee2e4;border-radius:18px;background:#fff;padding:14px}.artBlockCard{grid-template-columns:74px 1fr auto}.blockThumb{width:74px;height:74px;border-radius:14px;overflow:hidden;background:#f8f5f3;display:flex;align-items:center;justify-content:center;font-weight:950;color:#6b6268}.blockThumb img{width:100%;height:100%;object-fit:cover;display:block}.thumbEmpty{font-family:Montserrat}.blockInfo b{display:block;font-family:Montserrat}.blockInfo span,.blockInfo small{display:block;color:#716a71;font-weight:800;margin-top:4px}.blockInfo em{font-style:normal;font-weight:950}.blockInfo em.ok{color:#116b52}.blockInfo em.warn{color:#a52222}.historyList{display:grid;gap:8px}.historyItem{display:flex;align-items:center;justify-content:space-between;gap:10px;border:1px solid #eee2e4;background:#fff;border-radius:14px;padding:10px 12px;flex-wrap:wrap}.historyItem b{font-family:Montserrat}.historyItem small{color:#716a71;font-weight:800}@media(max-width:900px){.catalogQuickGrid{grid-template-columns:1fr}.actionControls{grid-template-columns:1fr}.actionControls .btn{width:100%;justify-content:center}.artBlockCard{grid-template-columns:64px 1fr}.artBlockCard .btn{grid-column:1/-1;width:100%}.blockCard{grid-template-columns:1fr}.blockCard .btn{width:100%}}';
    document.head.appendChild(s);
  }

  new MutationObserver(() => { enhanceOrdersPanel(); polishAdmin(); }).observe(document.body, { childList:true, subtree:true });
  document.addEventListener('click', e => { const tab = e.target && e.target.closest('[data-tab]'); if (!tab) return; setTimeout(() => { if (tab.dataset.tab === 'catalogView') renderCatalog(); if (tab.dataset.tab === 'permissionsView') renderUsers(); enhanceOrdersPanel(); patchSaveButtons(); polishAdmin(); }, 250); });
  injectStyle();
  setTimeout(load, 900);
})();
