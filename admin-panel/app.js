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
  let state = { banners: { mode: "rotate", selected: 0, items: [] }, servers: {} };
  let pendingDeletes = [];
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
    items.forEach((item, index) => {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = `${index + 1}. ${item.name || `Banner ${index + 1}`}`;
      fixed.append(option);
      const row = document.createElement("div"); row.className = "banner-row";
      const image = document.createElement("img"); image.src = item.url; image.alt = item.name || `Banner ${index + 1}`; image.loading = "lazy";
      const title = document.createElement("div"); title.className = "banner-name"; title.textContent = `${index + 1}. ${item.name || "Banner"}${item.enabled === false ? " · desativado" : ""}`;
      const actions = document.createElement("div"); actions.className = "banner-actions";
      const active = document.createElement("input"); active.type = "checkbox"; active.checked = item.enabled !== false; active.title = "Mostrar no app";
      active.addEventListener("change", () => { item.enabled = active.checked; renderBanners(); });
      const up = button("↑", "Mover para cima", () => moveBanner(index, -1)); up.disabled = index === 0;
      const down = button("↓", "Mover para baixo", () => moveBanner(index, 1)); down.disabled = index === items.length - 1;
      const remove = button("×", "Remover banner", () => {
        const [removed] = state.banners.items.splice(index, 1);
        if (removed?.id) pendingDeletes.push(removed.id);
        state.banners.selected = Math.min(state.banners.selected, Math.max(0, state.banners.items.length - 1));
        renderBanners();
      }, true);
      const activeLabel = document.createElement("label"); activeLabel.className = "banner-name"; activeLabel.append(active, document.createTextNode(" Ativo"));
      actions.append(activeLabel, up, down, remove); row.append(image, title, actions); list.append(row);
    });
    fixed.value = String(Math.min(state.banners.selected || 0, Math.max(0, items.length - 1)));
    $("bannerMode").value = state.banners.mode === "fixed" ? "fixed" : "rotate";
  }
  function button(text, title, action, danger = false) {
    const el = document.createElement("button"); el.type = "button"; el.className = `icon-button${danger ? " remove" : ""}`; el.textContent = text; el.title = title; el.setAttribute("aria-label", title); el.addEventListener("click", action); return el;
  }
  function moveBanner(index, delta) {
    const next = index + delta;
    if (next < 0 || next >= state.banners.items.length) return;
    [state.banners.items[index], state.banners.items[next]] = [state.banners.items[next], state.banners.items[index]];
    if (state.banners.selected === index) state.banners.selected = next; else if (state.banners.selected === next) state.banners.selected = index;
    renderBanners();
  }
  async function loadConfig() {
    const rows = await api("/rest/v1/remote_app_config?app_id=eq.capivaraplay-block&select=config");
    if (!Array.isArray(rows) || !rows[0]?.config) throw new Error("Configuração inicial não encontrada. Aplique a migração do Supabase primeiro.");
    const source = rows[0].config;
    const items = Array.isArray(source.banners?.items) ? source.banners.items : [];
    state = {
      banners: { mode: source.banners?.mode === "fixed" ? "fixed" : "rotate", selected: Number(source.banners?.selected) || 0, items: items.filter(item => item && typeof item.url === "string").slice(0, 30) },
      servers: source.servers && typeof source.servers === "object" ? source.servers : {},
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
  $("fixedBanner").addEventListener("change", event => { state.banners.selected = Number(event.target.value) || 0; });
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
      const config = { banners: { mode: state.banners.mode, selected: Number($("fixedBanner").value) || 0, items: state.banners.items.map(item => ({ id: item.id, name: String(item.name || "Banner").slice(0, 120), url: item.url, enabled: item.enabled !== false })) }, servers };
      await api("/rest/v1/remote_app_config?app_id=eq.capivaraplay-block", { method: "PATCH", headers: { "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify({ config, updated_at: new Date().toISOString() }) });
      if (pendingDeletes.length) {
        await api("/storage/v1/object/capivara-banners", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: pendingDeletes }) });
        pendingDeletes = [];
      }
      state = config; renderBanners(); message(status, "Alterações publicadas. O app atualizará a configuração ao abrir ou voltar para primeiro plano.");
    } catch (error) { message(status, error.message, true); }
    finally { save.disabled = false; }
  });
  if (token && isAdminConfigValid()) enterPanel().catch(error => { clearSession(); message($("loginStatus"), error.message, true); });
})();

