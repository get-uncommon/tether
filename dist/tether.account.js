(() => {
  var __defProp = Object.defineProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };

  // src/account.js
  var account_exports = {};
  __export(account_exports, {
    customer: () => customer,
    getToken: () => getToken,
    handleCallback: () => handleCallback,
    isLoggedIn: () => isLoggedIn,
    login: () => login,
    logout: () => logout,
    mountAccount: () => mountAccount,
    orders: () => orders,
    query: () => query,
    render: () => render
  });

  // tether-core:config.js
  var m = window.Tether.__core["config.js"];
  var { DEFAULTS, cfg, configure, isConfigured, log, reportError, warn } = m;

  // tether-core:client.js
  var m2 = window.Tether.__core["client.js"];
  var { TetherError, endpoint, gql, request, unwrap, withContext } = m2;

  // tether-core:dom.js
  var m3 = window.Tether.__core["dom.js"];
  var { attr, busy, cdnUrl, dataKey, emit, formatDate, formatMoney, formatPercent, get, has, hasTemplate, imageUrl, notifyLayoutChanged, parseJSONAttr, productUrl, qsa, readText, repeat, repeatKeyed, sameImage, scoped, sel, setImage, setSelected, setText, setTextTracked, show, toAttributes, watchImages } = m3;

  // tether-core:cart.js
  var m4 = window.Tether.__core["cart.js"];
  var { Cart, focusables, toLineInput } = m4;

  // src/account.js
  var KEY = () => `${cfg.prefix}:account:${cfg.domain}`;
  var PENDING = () => `${cfg.prefix}:account-login:${cfg.domain}`;
  var store = () => cfg.account?.remember ? window.localStorage : window.sessionStorage;
  var b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  var random = () => b64url(crypto.getRandomValues(new Uint8Array(32)));
  var sha256 = async (s) => b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  var go = (url) => (cfg.account?.navigate || ((u) => window.location.assign(u)))(url);
  var read = (s, k) => {
    try {
      return JSON.parse(s.getItem(k) || "null");
    } catch {
      return null;
    }
  };
  var write = (s, k, v) => {
    try {
      if (v) s.setItem(k, JSON.stringify(v));
      else s.removeItem(k);
    } catch {
    }
  };
  var discovery = null;
  var session = null;
  var refreshing = null;
  var customerCache = null;
  var server = () => cfg.account?.server ? String(cfg.account.server).replace(/\/$/, "") : "";
  var HINT = () => `${cfg.prefix}:account-hint:${cfg.domain}`;
  var serverState = null;
  async function serverFetch(path, { method = "GET", body } = {}) {
    const res = await fetch(`${server()}${path}`, {
      method,
      credentials: "include",
      headers: method === "POST" ? { "Content-Type": "application/json", "X-Tether-Account": "1" } : {},
      body: body ? JSON.stringify(body) : void 0
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok && res.status !== 401) throw new TetherError(`Customer accounts: ${data.error || res.status}`, { status: res.status });
    return data;
  }
  async function serverMe() {
    serverState || (serverState = await serverFetch("/me"));
    try {
      if (serverState.loggedIn) window.localStorage.setItem(HINT(), "1");
      else window.localStorage.removeItem(HINT());
    } catch {
    }
    return serverState;
  }
  async function discover() {
    if (discovery) return discovery;
    const shop = cfg.account?.shopDomain || cfg.domain;
    const get2 = (p) => fetch(`https://${shop}/.well-known/${p}`).then((r) => {
      if (!r.ok) throw new TetherError(`Customer accounts: ${p} answered ${r.status}`, { status: r.status });
      return r.json();
    });
    const [oidc, api] = await Promise.all([get2("openid-configuration"), get2("customer-account-api")]);
    discovery = { ...oidc, graphql: api.graphql_api };
    return discovery;
  }
  var callbackUrl = () => cfg.account?.callbackUrl || `${window.location.origin}${window.location.pathname}`;
  function isLoggedIn() {
    return server() ? Boolean(serverState?.loggedIn) : Boolean(session?.refresh || session?.access && session.expiresAt > Date.now());
  }
  async function login({ returnTo = window.location.href, locale } = {}) {
    if (server()) {
      const u2 = new URL(`${server()}/login`);
      u2.searchParams.set("returnTo", returnTo);
      const lang2 = locale || cfg.account.locale || (cfg.locale || "").split("-")[0];
      if (lang2) u2.searchParams.set("locale", lang2);
      if (cfg.country) u2.searchParams.set("country", String(cfg.country).toUpperCase());
      go(u2.toString());
      return;
    }
    if (!cfg.account?.clientId) throw new TetherError("Customer accounts: set account.clientId", { code: "NOT_CONFIGURED" });
    const d = await discover();
    const state = random();
    const nonce = random();
    const verifier = random();
    const redirect = callbackUrl();
    write(window.sessionStorage, PENDING(), { state, nonce, verifier, redirect, returnTo, at: Date.now() });
    const u = new URL(d.authorization_endpoint);
    const p = {
      client_id: cfg.account.clientId,
      scope: "openid email customer-account-api:full",
      response_type: "code",
      redirect_uri: redirect,
      state,
      nonce,
      code_challenge: await sha256(verifier),
      code_challenge_method: "S256"
    };
    const lang = locale || cfg.account.locale || (cfg.locale || "").split("-")[0];
    if (lang) p.locale = lang;
    if (cfg.country) p.region_country = String(cfg.country).toUpperCase();
    Object.entries(p).forEach(([k, v]) => u.searchParams.set(k, v));
    go(u.toString());
  }
  async function tokenRequest(params) {
    const d = await discover();
    const res = await fetch(cfg.account.tokenUrl || d.token_endpoint, { method: "POST", body: new URLSearchParams(params) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) throw new TetherError(`Customer accounts: token ${res.status} ${data.error || ""}`.trim(), { status: res.status, code: res.status === 400 || res.status === 401 ? "SESSION_ENDED" : "TOKEN_FAILED" });
    return data;
  }
  function decodeJwt(t) {
    try {
      return JSON.parse(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    } catch {
      return null;
    }
  }
  function keep(data, previous = session) {
    session = {
      access: data.access_token,
      expiresAt: Date.now() + Math.max(0, (Number(data.expires_in) || 3600) - 120) * 1e3,
      refresh: data.refresh_token || previous?.refresh,
      idToken: data.id_token || previous?.idToken
    };
    write(store(), KEY(), session);
  }
  async function handleCallback() {
    const q = new URLSearchParams(window.location.search);
    const pending = read(window.sessionStorage, PENDING());
    if (!pending || !q.has("code") && !q.has("error") || q.get("state") !== pending.state) return false;
    write(window.sessionStorage, PENDING(), null);
    const clean = new URL(window.location.href);
    ["code", "state", "iss", "error", "error_description"].forEach((k) => clean.searchParams.delete(k));
    window.history.replaceState(window.history.state, "", clean);
    if (q.has("error")) {
      emit("account-error", { error: q.get("error") });
      return false;
    }
    if (Date.now() - pending.at > 10 * 6e4) throw new TetherError("Customer accounts: the login took too long, please try again");
    const data = await tokenRequest({
      grant_type: "authorization_code",
      client_id: cfg.account.clientId,
      redirect_uri: pending.redirect,
      code: q.get("code"),
      code_verifier: pending.verifier
    });
    const d = await discover();
    const claims = decodeJwt(data.id_token || "");
    const aud = [].concat(claims?.aud || []);
    if (!claims || claims.nonce !== pending.nonce || claims.iss !== d.issuer || !aud.includes(cfg.account.clientId) || claims.exp * 1e3 < Date.now()) {
      throw new TetherError("Customer accounts: the login answer did not check out (nonce/issuer/audience)");
    }
    keep(data, null);
    await linkCart();
    emit("account-login", {});
    const back = pending.returnTo && new URL(pending.returnTo, window.location.href);
    if (back && back.origin === window.location.origin && back.href !== clean.href) go(back.href);
    return true;
  }
  async function getToken() {
    if (server()) return null;
    if (!session) session = read(store(), KEY());
    if (!session) return null;
    if (session.access && session.expiresAt > Date.now()) return session.access;
    if (!session.refresh) {
      endSession();
      return null;
    }
    refreshing || (refreshing = (async () => {
      try {
        keep(await tokenRequest({ grant_type: "refresh_token", client_id: cfg.account.clientId, refresh_token: session.refresh }));
        await linkCart();
      } catch (err) {
        if (err.code === "SESSION_ENDED") endSession();
        else throw err;
      } finally {
        refreshing = null;
      }
    })());
    await refreshing;
    return session?.access || null;
  }
  function endSession() {
    session = null;
    customerCache = null;
    write(store(), KEY(), null);
    Cart.customerAccessToken = null;
  }
  async function linkCart() {
    Cart.customerAccessToken = session?.access || null;
    if (Cart.id() && session?.access) {
      await Cart.setBuyerIdentity({ customerAccessToken: session.access }, { create: false }).catch((err) => reportError(err, "account cart"));
    }
  }
  async function query(q, variables = {}) {
    if (server()) throw new TetherError("Customer accounts in server mode only answer customer() and orders()", { code: "NOT_ALLOWED" });
    const token = await getToken();
    if (!token) throw new TetherError("Not logged in", { code: "NOT_LOGGED_IN" });
    const d = await discover();
    const run = (t) => fetch(d.graphql, { method: "POST", headers: { "Content-Type": "application/json", Authorization: t }, body: JSON.stringify({ query: q, variables }) });
    let res = await run(token);
    if (res.status === 401 && session?.refresh) {
      session.expiresAt = 0;
      res = await run(await getToken());
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.errors?.length) throw new TetherError(json.errors?.map((e) => e.message).join(" | ") || `Customer accounts: ${res.status}`, { status: res.status });
    return json.data;
  }
  async function customer() {
    if (server()) {
      const me = await serverMe();
      return me.loggedIn ? { ...me.customer, emailAddress: { emailAddress: me.customer.email }, defaultAddress: { formatted: me.customer.address } } : null;
    }
    if (customerCache) return customerCache;
    const data = await query(`query TetherCustomer{customer{id firstName lastName displayName emailAddress{emailAddress}defaultAddress{formatted}}}`);
    customerCache = data.customer;
    return customerCache;
  }
  async function orders({ first = 10 } = {}) {
    if (server()) return (await serverFetch(`/orders?first=${first}`)).orders || [];
    const data = await query(`query TetherOrders($first:Int!){customer{orders(first:$first,sortKey:PROCESSED_AT,reverse:true){nodes{id name processedAt financialStatus fulfillmentStatus statusPageUrl totalPrice{amount currencyCode}lineItems(first:20){nodes{title variantTitle quantity image{url altText}}}}}}}`, { first });
    return data.customer?.orders?.nodes || [];
  }
  async function logout({ returnTo = cfg.account?.logoutUrl || `${window.location.origin}/` } = {}) {
    if (server()) {
      const r = await serverFetch("/logout", { method: "POST", body: { returnTo, cartId: Cart.id() } });
      serverState = { loggedIn: false };
      try {
        window.localStorage.removeItem(HINT());
      } catch {
      }
      emit("account-logout", {});
      if (r.logoutUrl) go(r.logoutUrl);
      else render(document);
      return;
    }
    const idToken = session?.idToken || read(store(), KEY())?.idToken;
    if (Cart.id()) await Cart.setBuyerIdentity({ customerAccessToken: null }, { create: false }).catch(() => {
    });
    endSession();
    emit("account-logout", {});
    if (!idToken) {
      render(document);
      return;
    }
    const d = await discover();
    const u = new URL(d.end_session_endpoint);
    u.searchParams.set("id_token_hint", idToken);
    u.searchParams.set("post_logout_redirect_uri", returnTo);
    go(u.toString());
  }
  var https = (u) => {
    try {
      return new URL(u).protocol === "https:";
    } catch {
      return false;
    }
  };
  var date = (s) => {
    try {
      return new Date(s).toLocaleDateString(cfg.locale || void 0);
    } catch {
      return s;
    }
  };
  async function render(root = document) {
    const logged = server() ? Boolean((await serverMe().catch(() => ({ loggedIn: false }))).loggedIn) : isLoggedIn() || Boolean(await getToken().catch(() => null));
    qsa(root, sel("show")).forEach((el) => {
      const k = get(el, "show");
      if (k === "logged-in") show(el, logged);
      if (k === "logged-out") show(el, !logged);
    });
    if (!logged) return;
    const binds = qsa(root, sel("account-bind"));
    if (binds.length) {
      const c = await customer().catch((err) => {
        reportError(err, "account");
        return null;
      });
      binds.forEach((el) => {
        const v = { "first-name": c?.firstName, "last-name": c?.lastName, name: c?.displayName, email: c?.emailAddress?.emailAddress, address: c?.defaultAddress?.formatted?.join(", ") }[get(el, "account-bind")];
        if (v != null) setText(el, v);
      });
    }
    const lists = qsa(root, sel("orders"));
    if (lists.length) {
      const list = await orders({ first: parseInt(get(lists[0], "limit") || "10", 10) }).catch((err) => {
        reportError(err, "orders");
        return [];
      });
      lists.forEach((c) => repeat(c, list, (node, o) => {
        qsa(node, sel("order-bind")).forEach((el) => {
          const k = get(el, "order-bind");
          if (k === "url") {
            if (https(o.statusPageUrl)) el.setAttribute("href", o.statusPageUrl);
            return;
          }
          const v = { name: o.name, date: date(o.processedAt), total: formatMoney(o.totalPrice), status: o.financialStatus?.toLowerCase(), fulfillment: o.fulfillmentStatus?.toLowerCase(), items: o.lineItems.nodes.map((l) => `${l.quantity}\xD7 ${l.title}`).join(", ") }[k];
          if (v != null) setText(el, v);
        });
        if (get(node, "order-bind") === "url" && https(o.statusPageUrl)) node.setAttribute("href", o.statusPageUrl);
      }));
    }
  }
  var bound = false;
  async function mountAccount(root = document) {
    if (!bound) {
      bound = true;
      document.addEventListener("click", (e) => {
        const t = e.target;
        if (t.closest?.(sel("account-login"))) {
          e.preventDefault();
          login().catch((err) => reportError(err, "login"));
        } else if (t.closest?.(sel("account-logout"))) {
          e.preventDefault();
          logout().catch((err) => reportError(err, "logout"));
        }
      });
      if (server()) {
        const u = new URL(window.location.href);
        if (u.searchParams.get("account")) {
          u.searchParams.delete("account");
          window.history.replaceState(window.history.state, "", u);
          emit("account-login", {});
        }
        Cart.beforeCheckout = async () => {
          if (!(await serverMe()).loggedIn || !Cart.id()) return null;
          const r = await serverFetch("/cart", { method: "POST", body: { cartId: Cart.id() } }).catch(() => null);
          return r?.checkoutUrl ? `${r.checkoutUrl}${r.checkoutUrl.includes("?") ? "&" : "?"}logged_in=true` : null;
        };
      } else {
        try {
          await handleCallback();
        } catch (err) {
          reportError(err, "login");
        }
        if (!Cart.customerAccessToken && await getToken().catch(() => null)) Cart.customerAccessToken = session.access;
      }
      log("account", isLoggedIn() ? "logged in" : "logged out");
    }
    await render(root);
  }

  // src/parts/account.js
  window.Tether.__parts.account = account_exports;
})();
