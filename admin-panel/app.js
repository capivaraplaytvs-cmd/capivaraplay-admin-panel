(() => {
  "use strict";
  const cfg = window.CAPIVARA_CONFIG || {};
  const base = String(cfg.supabaseUrl || "").trim().replace(/\/+$/, "");
  const key = String(cfg.publishableKey || "").trim();
  const $ = id => document.getElementById(id);
  const loginCard = $("loginCard"), admin = $("admin"), notice = $("setupNotice");
  let token = sessionStorage.getItem("capivara_admin_token") || "";
  let refreshToken = sessionStorage.getItem("capivara_admin_refresh_token") || "";
  let expiresAt = Number(sessionStorage.getItem("capivara_admin_expires_at")) || 0;
  let state = { banners: { mode: "rotate", selected: 0, items: [] }, servers: {}, appUpdate: null };
  let pendingDeletes = [];
  let pendingUpdateCleanup = [];
  let stagedUpdatePaths = [];
  const serverIds = ["srv_extreme", "srv_deluxe", "srv_lite"];

  function message(target, text, error = false) {
    target.textContent = text;
    target.classList.toggle("error", error);
  }
  function showSetup(text) { notice.textContent = text; notice.classList.remove("hidden"); }
  function storeSession(result) {
    token = result.access_token || "";
    refreshToken = result.refresh_token || refreshToken;
    const expiry = Number(result.expires_at);
    expiresAt = expiry > 0 ? expiry * 1000 : Date.now() + (Number(result.expires_in) || 3600) * 1000;
    sessionStorage.setItem("capivara_admin_token", token);
    sessionStorage.setItem("capivara_admin_refresh_token", refreshToken);
    sessionStorage.setItem("capivara_admin_expires_at", String(expiresAt));
  }
  function clearSession() {
    token = ""; refreshToken = ""; expiresAt = 0;
    sessionStorage.removeItem("capivara_admin_token");
    sessionStorage.removeItem("capivara_admin_refresh_token");
    sessionStorage.removeItem("capivara_admin_expires_at");
  }
  function showLoginAfterExpiry() {
    clearSession();
    admin.classList.add("hidden");
    loginCard.classList.remove("hidden");
    message($("loginStatus"), "A sessão do painel expirou. Entre novamente.", true);
  }
  async function refreshSession() {
    if (!refreshToken) {
      showLoginAfterExpiry();
      throw new Error("A sessão do painel expirou. Entre novamente.");
    }
    const response = await fetch(`${base}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { apikey: key, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    const body = await response.text();
    let result = null;
    try { result = body ? JSON.parse(body) : null; } catch (_) {}
    if (!response.ok || !result?.access_token) {
      if (response.status === 400 || response.status === 401) showLoginAfterExpiry();
      throw new Error(response.status === 400 || response.status === 401
        ? "A sessão do painel expirou. Entre novamente."
        : `Não foi possível renovar a sessão do Supabase (${response.status}).`);
    }
    storeSession(result);
  }
  async function authenticatedRequest(path, options = {}) {
    const requiresSession = !path.startsWith("/auth/v1/token");
    if (requiresSession && token && refreshToken && expiresAt && expiresAt <= Date.now() + 60000) await refreshSession();
    const send = () => {
      const headers = new Headers(options.headers || {});
      headers.set("apikey", key);
      headers.set("Accept", "application/json");
      if (requiresSession && token) headers.set("Authorization", `Bearer ${token}`);
      return fetch(`${base}${path}`, { ...options, headers });
    };
    let response = await send();
    if (response.status === 401 && requiresSession && token) {
      await refreshSession();
      response = await send();
    }
    return response;
  }
  async function api(path, options = {}) {
    const response = await authenticatedRequest(path, options);
    const body = await response.text();
    if (!response.ok) {
      let detail = body;
      try { detail = JSON.parse(body).message || JSON.parse(body).msg || body; } catch (_) {}
      throw new Error(`Supabase (${response.status}): ${detail.slice(0, 300)}`);
    }
    return body ? JSON.parse(body) : null;
  }
  function normalizeBaseUrl(value) {
    const url = new URL(value.trim());
    if (!/^https?:$/.test(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash) throw new Error("Informe um endereço base http:// ou https:// válido.");
    return url.toString().replace(/\/+$/, "");
  }
  function isAdminConfigValid() { return Boolean(base && key); }

  function renderBanners() {
    const list = $("bannerList");
    list.replaceChildren();
    const items = state.banners.items;
    const fixedWrap = $("fixedBannerWrap");
    fixedWrap.classList.toggle("hidden", state.banners.mode !== "fixed" || items.length === 0);
    const fixed = $("fixedBanner");
    fixed.replaceChildren();
    const enabledItems = items.filter(item => item.enabled !== false);
    const fallbackIndex = Math.min(Number(state.banners.selected) || 0, Math.max(0, enabledItems.length - 1));
    const rememberedIndex = enabledItems.findIndex(item => String(item.id || "") === String(state.banners.fixedId || ""));
    const selectedIndex = rememberedIndex >= 0 ? rememberedIndex : fallbackIndex;
    state.banners.selected = selectedIndex;
    state.banners.fixedId = String(enabledItems[selectedIndex]?.id || "");
    items.forEach((item, index) => {
      const enabledIndex = item.enabled === false ? -1 : enabledItems.indexOf(item);
      if (enabledIndex >= 0) {
        const option = document.createElement("option");
        option.value = String(enabledIndex);
        option.textContent = `${index + 1}. ${item.name || `Banner ${index + 1}`}`;
        fixed.append(option);
      }
      const row = document.createElement("div"); row.className = "banner-row";
      const image = document.createElement("img"); image.src = item.url; image.alt = item.name || `Banner ${index + 1}`; image.loading = "lazy";
      const title = document.createElement("div"); title.className = "banner-name"; title.textContent = `${index + 1}. ${item.name || "Banner"}${item.enabled === false ? " · desativado" : ""}`;
      const actions = document.createElement("div"); actions.className = "banner-actions";
      const active = document.createElement("input"); active.type = "checkbox"; active.checked = item.enabled !== false; active.title = "Mostrar no app";
      active.addEventListener("change", () => {
        const selectedId = state.banners.fixedId;
        item.enabled = active.checked;
        const current = items.filter(candidate => candidate.enabled !== false);
        const nextItem = current.find(candidate => String(candidate.id || "") === selectedId) || current[Math.min(selectedIndex, Math.max(0, current.length - 1))] || null;
        state.banners.selected = nextItem ? current.indexOf(nextItem) : 0;
        state.banners.fixedId = String(nextItem?.id || "");
        renderBanners();
      });
      const up = button("↑", "Mover para cima", () => moveBanner(index, -1)); up.disabled = index === 0;
      const down = button("↓", "Mover para baixo", () => moveBanner(index, 1)); down.disabled = index === items.length - 1;
      const remove = button("×", "Remover banner", () => {
        const [removed] = state.banners.items.splice(index, 1);
        if (removed?.id) pendingDeletes.push(removed.id);
        const current = state.banners.items.filter(item => item.enabled !== false);
        const found = current.findIndex(candidate => String(candidate.id || "") === String(state.banners.fixedId || ""));
        state.banners.selected = found >= 0 ? found : Math.min(selectedIndex, Math.max(0, current.length - 1));
        state.banners.fixedId = String(current[state.banners.selected]?.id || "");
        renderBanners();
      }, true);
      const activeLabel = document.createElement("label"); activeLabel.className = "banner-name"; activeLabel.append(active, document.createTextNode(" Ativo"));
      const makeFixed = document.createElement("button");
      makeFixed.type = "button";
      const isFixed = state.banners.mode === "fixed" && String(state.banners.fixedId || "") === String(item.id || "");
      makeFixed.className = `fixed-choice${isFixed ? " active" : ""}`;
      makeFixed.textContent = isFixed ? "Fixo ✓" : "Usar fixo";
      makeFixed.disabled = item.enabled === false;
      makeFixed.title = "Exibir somente este banner no app";
      makeFixed.addEventListener("click", () => { state.banners.mode = "fixed"; state.banners.selected = enabledIndex; state.banners.fixedId = String(item.id || ""); renderBanners(); });
      actions.append(activeLabel, makeFixed, up, down, remove); row.append(image, title, actions); list.append(row);
    });
    fixed.value = String(selectedIndex);
    $("bannerMode").value = state.banners.mode === "fixed" ? "fixed" : "rotate";
    renderUpdate();
  }
  function renderUpdate() {
    const release = state.appUpdate;
    $("currentUpdate").textContent = release
      ? `Publicada: ${release.versionName} (código ${release.versionCode}) · ${(Number(release.sizeBytes) / 1024 / 1024).toFixed(1)} MB`
      : "Nenhuma atualização publicada.";
    $("removeUpdate").classList.toggle("hidden", !release);
    const directUrl = base ? `${base}/functions/v1/capivaraplay-apk` : "";
    $("directApkLink").value = directUrl;
    $("copyDirectApk").disabled = !directUrl;
    $("directApkHelp").textContent = release
      ? `O link é fixo e já aponta para ${release.versionName}. Depois de enviar outra versão e salvar as alterações, este mesmo endereço baixará o APK novo como capivaraplay.apk.`
      : "O endereço é fixo. Envie e publique o primeiro APK para ativar o download como capivaraplay.apk.";
    if (release) {
      $("updateVersionName").value = release.versionName || "";
      $("updateVersionCode").value = String(release.versionCode || "");
      $("updateNotes").value = release.notes || "";
    }
  }
  function updateObjectPaths(release) {
    return Array.isArray(release?.parts) ? release.parts.map(part => String(part.path || "")).filter(Boolean) : [];
  }
  function button(text, title, action, danger = false) {
    const el = document.createElement("button"); el.type = "button"; el.className = `icon-button${danger ? " remove" : ""}`; el.textContent = text; el.title = title; el.setAttribute("aria-label", title); el.addEventListener("click", action); return el;
  }
  function moveBanner(index, delta) {
    const next = index + delta;
    if (next < 0 || next >= state.banners.items.length) return;
    const enabledBefore = state.banners.items.filter(item => item.enabled !== false);
    const selectedId = String(state.banners.fixedId || enabledBefore[state.banners.selected]?.id || "");
    [state.banners.items[index], state.banners.items[next]] = [state.banners.items[next], state.banners.items[index]];
    const enabled = state.banners.items.filter(item => item.enabled !== false);
    const selectedIndex = enabled.findIndex(item => String(item.id || "") === selectedId);
    if (selectedIndex >= 0) state.banners.selected = selectedIndex;
    state.banners.fixedId = String(enabled[Math.max(0, state.banners.selected)]?.id || "");
    renderBanners();
  }
  async function loadConfig() {
    const rows = await api("/rest/v1/remote_app_config?app_id=eq.capivaraplay-block&select=config");
    if (!Array.isArray(rows) || !rows[0]?.config) throw new Error("Configuração inicial não encontrada. Aplique a migração do Supabase primeiro.");
    const source = rows[0].config;
    const items = Array.isArray(source.banners?.items) ? source.banners.items : [];
    const enabledItems = items.filter(item => item && item.enabled !== false && typeof item.url === "string");
    const oldSelectedIndex = Math.min(Number(source.banners?.selected) || 0, Math.max(0, items.length - 1));
    const oldSelectedItem = items[oldSelectedIndex];
    const fixedId = String(source.banners?.fixedId || (oldSelectedItem?.enabled !== false ? oldSelectedItem?.id : "") || enabledItems[0]?.id || "");
    const selectedIndex = Math.max(0, enabledItems.findIndex(item => String(item.id || "") === fixedId));
    state = {
      banners: { mode: source.banners?.mode === "fixed" ? "fixed" : "rotate", selected: selectedIndex, fixedId, items: items.filter(item => item && typeof item.url === "string").slice(0, 30) },
      servers: source.servers && typeof source.servers === "object" ? source.servers : {},
      appUpdate: source.appUpdate && typeof source.appUpdate === "object" ? source.appUpdate : null,
    };
    serverIds.forEach(id => { $(id).value = state.servers[id] || ""; });
    renderBanners();
  }
  async function enterPanel() {
    const adminStatus = await api("/rest/v1/rpc/is_capivara_panel_admin", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    if (adminStatus !== true) throw new Error("Este usuário ainda não foi liberado como administrador. Adicione o UUID dele em app_panel_admins no Supabase.");
    await loadConfig(); loginCard.classList.add("hidden"); admin.classList.remove("hidden");
  }
  async function upload(file) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 12 * 1024 * 1024) throw new Error("Escolha JPG, PNG ou WebP com até 12 MB.");
    const ext = file.type === "image/jpeg" ? "jpg" : file.type.split("/")[1];
    const objectName = `${crypto.randomUUID()}.${ext}`;
    const response = await authenticatedRequest(`/storage/v1/object/capivara-banners/${objectName}`, {
      method: "POST", headers: { "Content-Type": file.type, "Cache-Control": "public, max-age=31536000", "x-upsert": "false" }, body: file,
    });
    if (!response.ok) throw new Error(`Falha ao enviar imagem (${response.status}).`);
    return { id: objectName, name: file.name, enabled: true, url: `${base}/storage/v1/object/public/capivara-banners/${objectName}` };
  }
  async function uploadUpdate(file) {
    if (!file.name.toLowerCase().endsWith(".apk") || file.size < 4 || file.size > 180 * 1024 * 1024) throw new Error("Escolha um APK válido de até 180 MB.");
    const versionName = $("updateVersionName").value.trim();
    const versionCode = Number($("updateVersionCode").value);
    if (!versionName || versionName.length > 40 || !Number.isSafeInteger(versionCode) || versionCode < 1) throw new Error("Preencha nome e número inteiro da versão antes de enviar o APK.");
    const header = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    if (header[0] !== 0x50 || header[1] !== 0x4b) throw new Error("O arquivo selecionado não parece ser um APK.");
    const hashBytes = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    const sha256 = [...new Uint8Array(hashBytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
    const releaseId = `${versionCode}-${crypto.randomUUID()}`;
    const chunkSize = 40 * 1024 * 1024;
    const parts = [];
    const uploaded = [];
    try {
      const count = Math.ceil(file.size / chunkSize);
      for (let index = 0; index < count; index++) {
        const path = `${versionCode}/${releaseId}/part-${String(index + 1).padStart(2, "0")}.bin`;
        const encodedPath = path.split("/").map(encodeURIComponent).join("/");
        const chunk = file.slice(index * chunkSize, Math.min(file.size, (index + 1) * chunkSize), "application/octet-stream");
        const response = await authenticatedRequest(`/storage/v1/object/capivara-updates/${encodedPath}`, {
          method: "POST", headers: { "Content-Type": "application/octet-stream", "Cache-Control": "public, max-age=31536000", "x-upsert": "false" }, body: chunk,
        });
        if (!response.ok) throw new Error(`Falha ao enviar parte ${index + 1} do APK (${response.status}). Confira a configuração de armazenamento do Supabase.`);
        uploaded.push(path);
        parts.push({ path, url: `${base}/storage/v1/object/public/capivara-updates/${encodedPath}` });
        message($("updateStatus"), `Enviando APK: parte ${index + 1} de ${count}…`);
      }
    } catch (error) {
      if (uploaded.length) await deleteUpdateObjects(uploaded).catch(() => {});
      throw error;
    }
    pendingUpdateCleanup.push(...updateObjectPaths(state.appUpdate), ...stagedUpdatePaths);
    stagedUpdatePaths = uploaded;
    state.appUpdate = { versionName, versionCode, notes: $("updateNotes").value.trim().slice(0, 5000), sizeBytes: file.size, sha256, parts };
    renderUpdate();
  }
  async function deleteUpdateObjects(paths) {
    const unique = [...new Set(paths.filter(Boolean))];
    if (!unique.length) return;
    await api("/storage/v1/object/capivara-updates", {
      method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: unique }),
    });
  }

  if (!isAdminConfigValid()) {
    showSetup("O painel está pronto. Para conectar, crie o projeto Supabase e configure SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY nas variáveis do repositório GitHub. Instruções em admin-panel/README.md.");
    $("loginForm").querySelector("button").disabled = true;
  }
  $("loginForm").addEventListener("submit", async event => {
    event.preventDefault(); if (!isAdminConfigValid()) return;
    const status = $("loginStatus"); message(status, "Conectando…");
    try {
      const result = await api("/auth/v1/token?grant_type=password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: $("email").value.trim(), password: $("password").value }) });
      storeSession(result);
      await enterPanel(); message(status, "");
    } catch (error) { clearSession(); message(status, error.message, true); }
  });
  $("logout").addEventListener("click", () => { clearSession(); admin.classList.add("hidden"); loginCard.classList.remove("hidden"); $("password").value = ""; });
  $("bannerMode").addEventListener("change", event => { state.banners.mode = event.target.value; renderBanners(); });
  $("fixedBanner").addEventListener("change", event => {
    const enabledItems = state.banners.items.filter(item => item.enabled !== false);
    state.banners.selected = Number(event.target.value) || 0;
    state.banners.fixedId = String(enabledItems[state.banners.selected]?.id || "");
    renderBanners();
  });
  $("updateFile").addEventListener("change", async event => {
    const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
    const input = $("updateFile"); input.disabled = true;
    try { message($("updateStatus"), "Preparando o APK…"); await uploadUpdate(file); message($("updateStatus"), "APK enviado. Clique em Salvar alterações para publicar a atualização."); }
    catch (error) { message($("updateStatus"), error.message, true); }
    finally { input.disabled = false; }
  });
  $("copyDirectApk").addEventListener("click", async () => {
    const input = $("directApkLink");
    if (!input.value) return;
    try {
      await navigator.clipboard.writeText(input.value);
      message($("directApkStatus"), "Link copiado.");
    } catch (_) {
      input.focus(); input.select();
      message($("directApkStatus"), "Link selecionado. Pressione Ctrl+C para copiar.");
    }
  });
  $("removeUpdate").addEventListener("click", () => {
    pendingUpdateCleanup.push(...updateObjectPaths(state.appUpdate), ...stagedUpdatePaths);
    stagedUpdatePaths = [];
    state.appUpdate = null;
    $("updateVersionName").value = ""; $("updateVersionCode").value = ""; $("updateNotes").value = "";
    renderUpdate(); message($("updateStatus"), "Versão marcada para retirada. Clique em Salvar alterações para publicar.");
  });
  $("bannerFile").addEventListener("change", async event => {
    const files = [...event.target.files]; event.target.value = ""; if (!files.length) return;
    const status = $("saveStatus"); message(status, "Enviando banners…");
    try { for (const file of files) state.banners.items.push(await upload(file)); renderBanners(); message(status, "Banners enviados. Salve para publicar as alterações."); }
    catch (error) { message(status, error.message, true); }
  });
  $("save").addEventListener("click", async () => {
    const status = $("saveStatus"), save = $("save"); save.disabled = true; message(status, "Salvando…");
    try {
      const servers = {};
      serverIds.forEach(id => { servers[id] = normalizeBaseUrl($(id).value); });
      const enabledItems = state.banners.items.filter(item => item.enabled !== false);
      const selected = Math.min(Number($("fixedBanner").value) || 0, Math.max(0, enabledItems.length - 1));
      const config = { banners: { mode: state.banners.mode, selected, fixedId: String(enabledItems[selected]?.id || ""), items: state.banners.items.map(item => ({ id: item.id, name: String(item.name || "Banner").slice(0, 120), url: item.url, enabled: item.enabled !== false })) }, servers, appUpdate: state.appUpdate };
      await api("/rest/v1/remote_app_config?app_id=eq.capivaraplay-block", { method: "PATCH", headers: { "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify({ config, updated_at: new Date().toISOString() }) });
      if (pendingDeletes.length) {
        await api("/storage/v1/object/capivara-banners", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: pendingDeletes }) });
        pendingDeletes = [];
      }
      let updateCleanupNotice = "";
      try { await deleteUpdateObjects(pendingUpdateCleanup); pendingUpdateCleanup = []; stagedUpdatePaths = []; }
      catch (_) { updateCleanupNotice = " A versão anterior permaneceu guardada no armazenamento."; }
      state = config; renderBanners(); message(status, `Alterações publicadas. O app atualizará a configuração ao abrir ou voltar para primeiro plano.${updateCleanupNotice}`);
    } catch (error) { message(status, error.message, true); }
    finally { save.disabled = false; }
  });
  if (token && isAdminConfigValid()) enterPanel().catch(error => { clearSession(); message($("loginStatus"), error.message, true); });
})();

