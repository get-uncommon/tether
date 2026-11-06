"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };

  // src/account.js
  var account_exports = {};
  __export(account_exports, {
    addresses: () => addresses,
    customer: () => customer,
    deleteAddress: () => deleteAddress,
    getToken: () => getToken,
    handleCallback: () => handleCallback,
    isLoggedIn: () => isLoggedIn,
    login: () => login,
    logout: () => logout,
    mountAccount: () => mountAccount,
    order: () => order,
    orders: () => orders,
    query: () => query2,
    render: () => render,
    requestReturn: () => requestReturn,
    saveAddress: () => saveAddress,
    subscriptionAction: () => subscriptionAction,
    subscriptions: () => subscriptions,
    updateProfile: () => updateProfile
  });

  // tether-core:config.js
  var m = window.Tether.__core["config.js"];
  var { DEFAULTS, cfg, configure, isConfigured, log, reportError, resolveConfig, toMetafieldIdentifier, warn } = m;

  // tether-core:client.js
  var m2 = window.Tether.__core["client.js"];
  var { TetherError, endpoint, gql, request, unwrap, withContext } = m2;

  // tether-core:dom.js
  var m3 = window.Tether.__core["dom.js"];
  var { attr, busy, cdnUrl, emit, formatDate, formatMoney, formatPercent, get, has, hasTemplate, imageUrl, notifyLayoutChanged, parseJSONAttr, productUrl, qsa, repeat, repeatKeyed, sameImage, scoped, sel, setImage, setSelected, setStoreHtml, setText, setTextTracked, show, toAttributes, watchImages } = m3;

  // tether-core:cart.js
  var m4 = window.Tether.__core["cart.js"];
  var { Cart, trapFocus } = m4;

  // tether-core:lazy.js
  var m5 = window.Tether.__core["lazy.js"];
  var { coreModules, loadPart } = m5;

  // server/src/shared/account-documents.js
  var MONEY = "amount currencyCode";
  var CUSTOMER_QUERY = "query TetherCustomer { customer { id firstName lastName displayName emailAddress { emailAddress } defaultAddress { formatted } } }";
  var ORDERS_QUERY = `query TetherOrders($first:Int!){customer{orders(first:$first,sortKey:PROCESSED_AT,reverse:true){nodes{id name processedAt financialStatus fulfillmentStatus statusPageUrl totalPrice{${MONEY}}lineItems(first:20){nodes{title variantTitle quantity image{url altText}}}}}}}`;

  // server/src/shared/base64url.js
  function toBase64Url(bytes) {
    return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function fromBase64Url(text) {
    const base64 = text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "=");
    return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  }
  function randomToken(bytes = 32) {
    return toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
  }

  // src/account/shared.js
  var sessionKey = () => `${cfg.prefix}:account:${cfg.domain}`;
  var pendingLoginKey = () => `${cfg.prefix}:account-login:${cfg.domain}`;
  var hintKey = () => `${cfg.prefix}:account-hint:${cfg.domain}`;
  var sessionArea = () => cfg.account?.remember ? "local" : "session";
  var storageOf = (area) => area === "local" ? window.localStorage : window.sessionStorage;
  function readJsonIfAllowed(area, key) {
    try {
      return JSON.parse(storageOf(area).getItem(key) ?? "null");
    } catch {
      return null;
    }
  }
  function writeJsonIfAllowed(area, key, value) {
    try {
      if (value === null) storageOf(area).removeItem(key);
      else storageOf(area).setItem(key, JSON.stringify(value));
    } catch {
    }
  }
  function setLoginHint(loggedIn) {
    writeJsonIfAllowed("local", hintKey(), loggedIn ? 1 : null);
  }
  var isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
  var textOrNull = (value) => typeof value === "string" ? value : null;
  async function readJsonObjectOrEmpty(response) {
    let json;
    try {
      json = await response.json();
    } catch {
      return {};
    }
    return isRecord(json) ? json : {};
  }
  function navigate(url) {
    const replacement = cfg.account?.navigate;
    if (replacement) replacement(url);
    else window.location.assign(url);
  }
  var loginLanguage = (locale) => locale || cfg.account?.locale || (cfg.locale || "").split("-")[0] || "";
  var loginCountry = () => cfg.country ? cfg.country.toUpperCase() : "";

  // src/account/shopify-auth.js
  var DEFAULT_TOKEN_SECONDS = 3600;
  var endpoints = null;
  async function wellKnown(document2) {
    const shop = cfg.account?.shopDomain || cfg.domain;
    const response = await fetch(`https://${shop}/.well-known/${document2}`);
    if (!response.ok) {
      throw new TetherError(`Customer accounts: ${document2} answered ${response.status}`, { status: response.status });
    }
    const json = (
      /** @type {unknown} */
      await response.json()
    );
    return isRecord(json) ? json : {};
  }
  function endpointIn(json, name) {
    const url = textOrNull(json[name]);
    if (!url) throw new TetherError(`Customer accounts: Shopify named no ${name}`);
    return url;
  }
  async function discover() {
    if (endpoints) return endpoints;
    const [openid, api] = await Promise.all([wellKnown("openid-configuration"), wellKnown("customer-account-api")]);
    endpoints = {
      issuer: endpointIn(openid, "issuer"),
      authorizationEndpoint: endpointIn(openid, "authorization_endpoint"),
      tokenEndpoint: endpointIn(openid, "token_endpoint"),
      endSessionEndpoint: endpointIn(openid, "end_session_endpoint"),
      graphql: endpointIn(api, "graphql_api")
    };
    return endpoints;
  }
  async function requestToken(params) {
    const { tokenEndpoint } = await discover();
    const response = await fetch(cfg.account?.tokenUrl || tokenEndpoint, {
      method: "POST",
      body: new URLSearchParams(params)
    });
    const data = await readJsonObjectOrEmpty(response);
    const access = textOrNull(data["access_token"]);
    if (!response.ok || !access) {
      const ended = response.status === 400 || response.status === 401;
      throw new TetherError(`Customer accounts: token ${response.status} ${textOrNull(data["error"]) ?? ""}`.trim(), {
        status: response.status,
        code: ended ? "SESSION_ENDED" : "TOKEN_FAILED"
      });
    }
    return {
      access,
      refresh: textOrNull(data["refresh_token"]) || null,
      idToken: textOrNull(data["id_token"]) || null,
      expiresInSeconds: Number(data["expires_in"]) || DEFAULT_TOKEN_SECONDS
    };
  }
  function idTokenClaims(idToken) {
    const payload = idToken.split(".")[1];
    if (!payload) return null;
    let claims;
    try {
      claims = JSON.parse(new TextDecoder().decode(fromBase64Url(payload)));
    } catch {
      return null;
    }
    return isRecord(claims) ? claims : null;
  }
  function answersLogin(idToken, { nonce, issuer, client }) {
    const claims = idToken ? idTokenClaims(idToken) : null;
    if (!claims) return false;
    const audience = claims["aud"];
    const audiences = Array.isArray(audience) ? audience : [audience];
    const expiresAt = claims["exp"];
    return claims["nonce"] === nonce && claims["iss"] === issuer && audiences.includes(client) && typeof expiresAt === "number" && expiresAt * 1e3 >= Date.now();
  }

  // src/account/browser-session.js
  var REFRESH_MARGIN_SECONDS = 120;
  var LOGIN_TIMEOUT_MS = 10 * 60 * 1e3;
  var session = null;
  var customerProfile = null;
  var refreshing = null;
  function toSession(value) {
    if (!isRecord(value)) return null;
    const access = value["access"];
    const expiresAt = value["expiresAt"];
    if (typeof access !== "string" || typeof expiresAt !== "number") return null;
    return { access, expiresAt, refresh: textOrNull(value["refresh"]), idToken: textOrNull(value["idToken"]) };
  }
  function toPendingLogin(value) {
    if (!isRecord(value)) return null;
    const { state, nonce, verifier, redirect, returnTo, at } = value;
    if (typeof state !== "string" || typeof nonce !== "string" || typeof verifier !== "string") return null;
    if (typeof redirect !== "string" || typeof returnTo !== "string" || typeof at !== "number") return null;
    return { state, nonce, verifier, redirect, returnTo, at };
  }
  var currentSession = () => session ?? toSession(readJsonIfAllowed(sessionArea(), sessionKey()));
  var accessToken = () => session?.access ?? null;
  var hasBrowserLogin = () => Boolean(session && (session.refresh || session.access && session.expiresAt > Date.now()));
  function clientId() {
    const id = cfg.account?.clientId;
    if (!id) throw new TetherError("Customer accounts: set account.clientId", { code: "NOT_CONFIGURED" });
    return id;
  }
  var sha256 = async (text) => toBase64Url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  async function browserLoginRedirect({ returnTo, locale }) {
    const client = clientId();
    const endpoints2 = await discover();
    const pending = {
      state: randomToken(),
      nonce: randomToken(),
      verifier: randomToken(),
      redirect: cfg.account?.callbackUrl || `${window.location.origin}${window.location.pathname}`,
      returnTo,
      at: Date.now()
    };
    writeJsonIfAllowed("session", pendingLoginKey(), pending);
    const url = new URL(endpoints2.authorizationEndpoint);
    const params = {
      client_id: client,
      scope: "openid email customer-account-api:full",
      response_type: "code",
      redirect_uri: pending.redirect,
      state: pending.state,
      nonce: pending.nonce,
      code_challenge: await sha256(pending.verifier),
      code_challenge_method: "S256"
    };
    const language = loginLanguage(locale);
    if (language) params["locale"] = language;
    const country = loginCountry();
    if (country) params["region_country"] = country;
    Object.entries(params).forEach(([name, value]) => {
      url.searchParams.set(name, value);
    });
    navigate(url.toString());
  }
  function keep(answer, previous) {
    session = {
      access: answer.access,
      expiresAt: Date.now() + Math.max(0, answer.expiresInSeconds - REFRESH_MARGIN_SECONDS) * 1e3,
      refresh: answer.refresh ?? previous?.refresh ?? null,
      idToken: answer.idToken ?? previous?.idToken ?? null
    };
    writeJsonIfAllowed(sessionArea(), sessionKey(), session);
  }
  async function handleCallback() {
    const params = new URLSearchParams(window.location.search);
    const pending = toPendingLogin(readJsonIfAllowed("session", pendingLoginKey()));
    if (!pending || !params.has("code") && !params.has("error") || params.get("state") !== pending.state) return false;
    writeJsonIfAllowed("session", pendingLoginKey(), null);
    const clean = new URL(window.location.href);
    ["code", "state", "iss", "error", "error_description"].forEach((name) => {
      clean.searchParams.delete(name);
    });
    window.history.replaceState(window.history.state, "", clean);
    const error = params.get("error");
    if (error !== null) {
      emit("account-error", { error });
      return false;
    }
    if (Date.now() - pending.at > LOGIN_TIMEOUT_MS) {
      throw new TetherError("Customer accounts: the login took too long, please try again");
    }
    const client = clientId();
    const answer = await requestToken({
      grant_type: "authorization_code",
      client_id: client,
      redirect_uri: pending.redirect,
      code: params.get("code") ?? "",
      code_verifier: pending.verifier
    });
    const { issuer } = await discover();
    if (!answersLogin(answer.idToken, { nonce: pending.nonce, issuer, client })) {
      throw new TetherError("Customer accounts: the login answer did not check out (nonce/issuer/audience)");
    }
    keep(answer, null);
    await linkCart();
    emit("account-login", {});
    const back = pending.returnTo ? new URL(pending.returnTo, window.location.href) : null;
    if (back?.origin === window.location.origin && back.href !== clean.href) navigate(back.href);
    return true;
  }
  function endSession() {
    session = null;
    customerProfile = null;
    writeJsonIfAllowed(sessionArea(), sessionKey(), null);
    Cart.setCustomer({ accessToken: null });
  }
  async function refresh(expired) {
    try {
      const answer = await requestToken({
        grant_type: "refresh_token",
        client_id: clientId(),
        refresh_token: expired.refresh ?? ""
      });
      keep(answer, expired);
      await linkCart();
    } catch (error) {
      if (error instanceof TetherError && error.code === "SESSION_ENDED") endSession();
      else throw error;
    }
  }
  async function getToken() {
    session = currentSession();
    if (!session) return null;
    if (session.access && session.expiresAt > Date.now()) return session.access;
    if (!session.refresh) {
      endSession();
      return null;
    }
    const expired = session;
    refreshing ?? (refreshing = refresh(expired).finally(() => {
      refreshing = null;
    }));
    await refreshing;
    return accessToken();
  }
  async function linkCart() {
    const token = accessToken();
    Cart.setCustomer({ accessToken: token });
    if (!Cart.id() || !token) return;
    try {
      await Cart.setBuyerIdentity({ customerAccessToken: token }, { create: false });
    } catch (error) {
      reportError(error, "account cart");
    }
  }
  async function unlinkCart() {
    if (!Cart.id()) return;
    try {
      await Cart.setBuyerIdentity({ customerAccessToken: null }, { create: false });
    } catch (error) {
      reportError(error, "account cart unlink");
      writeJsonIfAllowed("local", cfg.storageKey, null);
    }
  }
  async function browserLogout(returnTo) {
    const idToken = currentSession()?.idToken ?? null;
    await unlinkCart();
    endSession();
    emit("account-logout", {});
    if (!idToken) return "stayed";
    const url = new URL((await discover()).endSessionEndpoint);
    url.searchParams.set("id_token_hint", idToken);
    url.searchParams.set("post_logout_redirect_uri", returnTo);
    navigate(url.toString());
    return "redirected";
  }
  async function query(document2, variables = {}) {
    const token = await getToken();
    if (!token) throw new TetherError("Not logged in", { code: "NOT_LOGGED_IN" });
    const { graphql } = await discover();
    const send = (accessToken2) => fetch(graphql, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: accessToken2 },
      body: JSON.stringify({ query: document2, variables })
    });
    let response = await send(token);
    if (response.status === 401 && session?.refresh) {
      session.expiresAt = 0;
      response = await send(await getToken() ?? "");
    }
    const json = await readJsonObjectOrEmpty(response);
    const errors = Array.isArray(json["errors"]) ? json["errors"] : [];
    if (!response.ok || errors.length) {
      const messages = errors.map((error) => isRecord(error) ? textOrNull(error["message"]) : null).filter(Boolean);
      throw new TetherError(messages.join(" | ") || `Customer accounts: ${response.status}`, {
        status: response.status
      });
    }
    return (
      /** @type {T} */
      json["data"]
    );
  }
  async function browserCustomer() {
    if (customerProfile) return customerProfile;
    const data = await query(CUSTOMER_QUERY);
    customerProfile = data.customer;
    return customerProfile;
  }
  function forgetBrowserCustomer() {
    customerProfile = null;
  }

  // src/account/server-client.js
  var known = null;
  function serverBase() {
    const server = cfg.account?.server;
    if (!server) return "";
    return new URL(server, window.location.href).href.replace(/\/$/, "");
  }
  async function serverFetch(path, { method = "GET", body } = {}) {
    const init = { method, credentials: "include" };
    if (method === "POST") init.headers = { "Content-Type": "application/json", "X-Tether-Account": "1" };
    if (body) init.body = JSON.stringify(body);
    const response = await fetch(`${serverBase()}${path}`, init);
    if (response.status === 401) return { kind: "logged-out" };
    const data = await readJsonObjectOrEmpty(response);
    if (!response.ok) {
      const reason = textOrNull(data["error"]) ?? String(response.status);
      const userErrors = Array.isArray(data["userErrors"]) ? (
        // The Worker sends Shopify's own `userErrors` list unchanged.
        /** @type {UserError[]} */
        data["userErrors"]
      ) : void 0;
      throw new TetherError(`Customer accounts: ${reason}`, {
        status: response.status,
        ...userErrors && { userErrors }
      });
    }
    return { kind: "answer", data };
  }
  function toServerCustomer(value) {
    const customer2 = isRecord(value) ? value : {};
    const address = customer2["address"];
    return {
      firstName: textOrNull(customer2["firstName"]),
      lastName: textOrNull(customer2["lastName"]),
      displayName: textOrNull(customer2["displayName"]),
      email: textOrNull(customer2["email"]),
      address: Array.isArray(address) ? address.filter((line) => typeof line === "string") : null
    };
  }
  async function serverLogin() {
    if (!known) {
      const answer = await serverFetch("/me");
      known = answer.kind === "answer" && answer.data["loggedIn"] === true ? { loggedIn: true, customer: toServerCustomer(answer.data["customer"]) } : { loggedIn: false };
    }
    setLoginHint(known.loggedIn);
    return known;
  }
  var isServerLoggedIn = () => known?.loggedIn === true;
  function forgetServerLogin() {
    known = null;
  }
  function serverLoginRedirect({ returnTo, locale }) {
    const url = new URL(`${serverBase()}/login`);
    url.searchParams.set("returnTo", returnTo);
    const language = loginLanguage(locale);
    if (language) url.searchParams.set("locale", language);
    const country = loginCountry();
    if (country) url.searchParams.set("country", country);
    navigate(url.toString());
  }
  async function serverCheckoutUrl() {
    const cartId = Cart.id();
    if (!(await serverLogin()).loggedIn || !cartId) return null;
    const answer = await serverFetch("/cart", { method: "POST", body: { cartId } });
    if (answer.kind === "logged-out") return null;
    const url = textOrNull(answer.data["checkoutUrl"]);
    if (!url) return null;
    return `${url}${url.includes("?") ? "&" : "?"}logged_in=true`;
  }
  async function serverLogout(returnTo) {
    const answer = await serverFetch("/logout", { method: "POST", body: { returnTo, cartId: Cart.id() } });
    known = null;
    setLoginHint(false);
    emit("account-logout", {});
    const logoutUrl = answer.kind === "answer" ? textOrNull(answer.data["logoutUrl"]) : null;
    if (!logoutUrl) return "stayed";
    navigate(logoutUrl);
    return "redirected";
  }

  // tether-core:shopify-values.js
  var m6 = window.Tether.__core["shopify-values.js"];
  var { STORE_ENV_NAMES, formatMoney: formatMoney2, isHttpsUrl, isSecretShopifyToken, productKey, productUrl: productUrl2 } = m6;

  // src/account-links.js
  function localDate(iso) {
    try {
      return new Date(iso).toLocaleDateString(cfg.locale);
    } catch (error) {
      if (error instanceof RangeError) return iso;
      throw error;
    }
  }
  function orderUrl(order2) {
    const template = cfg.account?.orderUrl;
    if (template) {
      const numericId = order2.id.split("/").pop()?.split("?")[0] ?? "";
      return template.replace("{id}", encodeURIComponent(numericId));
    }
    return isHttpsUrl(order2.statusPageUrl) ? order2.statusPageUrl ?? null : null;
  }

  // src/account/markup.js
  function showIn(root, name, conditions) {
    qsa(root, sel(name)).forEach((el) => {
      const key = get(el, name) ?? "";
      if (Object.hasOwn(conditions, key)) show(el, conditions[key] === true);
    });
  }
  var bindsIn = (row, name) => qsa(row, sel(name)).concat(row.matches(sel(name)) ? [row] : []);
  var ownValue = (values, key) => Object.hasOwn(values, key) ? values[key] : void 0;

  // src/account/order-lines.js
  var lineTexts = (line, returnable) => ({
    title: line.title || line.name,
    "variant-title": line.variantTitle || "",
    quantity: String(line.quantity),
    price: formatMoney(line.price),
    total: formatMoney(line.totalPrice),
    sku: line.sku || "",
    returnable: returnable === null ? void 0 : String(returnable)
  });
  var isInput = (el) => el.tagName === "INPUT";
  function fillReturnControls(row, line, returnable) {
    showIn(row, "order-line-show", { returnable: returnable > 0 });
    qsa(row, sel("return-quantity")).forEach((input) => {
      if (!isInput(input)) return;
      input.max = String(returnable);
      input.min = "0";
      if (!input.value) input.value = "0";
      input.disabled = returnable < 1;
    });
    qsa(row, `select${sel("return-reason")}`).forEach((select) => {
      if (select.dataset["tetherFilled"] === line.id) return;
      select.dataset["tetherFilled"] = line.id;
      (line.suggestedReturnReasonDefinitions?.nodes ?? []).forEach((reason) => {
        select.appendChild(new Option(reason.name, reason.id));
      });
    });
  }
  function fillLines(box, lines, returns) {
    repeat(box, lines, (row, line) => {
      const id = line.id;
      const returnable = returns && id ? returns.get(id) ?? 0 : null;
      if (id) row.dataset["tetherLine"] = id;
      const texts = lineTexts(line, returnable);
      bindsIn(row, "order-line").forEach((el) => {
        const key = get(el, "order-line") ?? "";
        if (key === "image") {
          if (line.image) setImage(el, line.image.url, line.image.altText || line.title);
          return;
        }
        const text = ownValue(texts, key);
        if (text !== void 0) setText(el, text);
      });
      if (id && returnable !== null) fillReturnControls(row, { ...line, id }, returnable);
    });
  }

  // src/account/order-list.js
  var DEFAULT_ORDER_COUNT = 10;
  var orderTexts = (order2) => ({
    name: order2.name,
    date: localDate(order2.processedAt),
    total: formatMoney(order2.totalPrice),
    status: order2.financialStatus?.toLowerCase(),
    fulfillment: order2.fulfillmentStatus?.toLowerCase(),
    items: order2.lineItems.nodes.map((line) => `${line.quantity}\xD7 ${line.title}`).join(", ")
  });
  function fillOrder(node, order2) {
    const lines = order2.lineItems.nodes;
    const url = orderUrl(order2);
    const texts = orderTexts(order2);
    qsa(node, sel("order-bind")).forEach((el) => {
      const key = get(el, "order-bind") ?? "";
      if (key === "url") {
        if (url) el.setAttribute("href", url);
        return;
      }
      if (key === "image") {
        const image = lines.find((line) => line.image)?.image;
        if (image) setImage(el, image.url, image.altText || lines[0]?.title || "");
        return;
      }
      const text = ownValue(texts, key);
      if (text !== void 0) setText(el, text);
    });
    qsa(node, sel("order-lines")).forEach((box) => {
      fillLines(box, lines, null);
    });
    if (get(node, "order-bind") === "url" && url) node.setAttribute("href", url);
  }
  async function renderOrderList(root, loadOrders) {
    const lists = qsa(root, sel("orders"));
    const first = lists[0];
    if (!first) return;
    showIn(root, "show", { "orders-loading": true, "orders-empty": false });
    const limit = Number.parseInt(get(first, "limit") || String(DEFAULT_ORDER_COUNT), 10) || DEFAULT_ORDER_COUNT;
    const orders2 = await loadOrders(limit).catch((error) => {
      reportError(error, "orders");
      return null;
    });
    showIn(root, "show", { "orders-loading": false, "orders-empty": orders2?.length === 0 });
    lists.forEach((list) => {
      repeat(list, orders2 ?? [], fillOrder);
    });
  }

  // src/account.js
  var PAGE_ATTRIBUTES = ["order", "addresses", "subscriptions", "profile-form", "address-form"];
  function isLoggedIn() {
    return serverBase() ? isServerLoggedIn() : hasBrowserLogin();
  }
  async function login({ returnTo = window.location.href, locale } = {}) {
    if (serverBase()) serverLoginRedirect({ returnTo, locale });
    else await browserLoginRedirect({ returnTo, locale });
  }
  async function query2(document2, variables = {}) {
    if (serverBase()) {
      throw new TetherError("Customer accounts in server mode only answer customer() and orders()", {
        code: "NOT_ALLOWED"
      });
    }
    return query(document2, variables);
  }
  async function customer() {
    if (!serverBase()) return browserCustomer();
    const me = await serverLogin();
    if (!me.loggedIn) return null;
    return {
      ...me.customer,
      emailAddress: { emailAddress: me.customer.email },
      defaultAddress: { formatted: me.customer.address }
    };
  }
  async function orders({ first = 10 } = {}) {
    if (serverBase()) {
      const answer = await serverFetch(`/orders?first=${first}`);
      if (answer.kind === "logged-out") return [];
      const list = answer.data["orders"];
      return Array.isArray(list) ? (
        /** @type {AccountOrder[]} */
        list
      ) : [];
    }
    const data = await query(ORDERS_QUERY, { first });
    return data.customer?.orders.nodes ?? [];
  }
  async function logout({ returnTo = cfg.account?.logoutUrl || `${window.location.origin}/` } = {}) {
    const outcome = serverBase() ? await serverLogout(returnTo) : await browserLogout(returnTo);
    if (outcome === "stayed") await render(document);
  }
  async function loginState() {
    try {
      if (serverBase()) return (await serverLogin()).loggedIn ? { kind: "logged-in" } : { kind: "logged-out" };
      if (hasBrowserLogin() || await getToken()) return { kind: "logged-in" };
      return { kind: "logged-out" };
    } catch (error) {
      return { kind: "unknown", error };
    }
  }
  var usesPages = (root) => PAGE_ATTRIBUTES.some((name) => qsa(root, sel(name)).length > 0);
  function linkShopifyPages(root) {
    const account = cfg.account;
    qsa(root, sel("account-link")).forEach((link) => {
      const page = get(link, "account-link");
      const subscriptions2 = account?.subscriptionsUrl;
      const url = page === "payment" && (account?.paymentUrl || subscriptions2) || page === "subscriptions" && subscriptions2;
      link.setAttribute("href", url || `https://${cfg.domain}/account`);
    });
  }
  async function render(root = document) {
    const state = await loginState();
    if (state.kind === "unknown") reportError(state.error, "account");
    const loggedIn = state.kind === "logged-in";
    qsa(root, sel("show")).forEach((el) => {
      const condition = get(el, "show");
      if (condition === "logged-in") show(el, loggedIn);
      if (condition === "logged-out") show(el, !loggedIn);
    });
    linkShopifyPages(root);
    if (state.kind === "unknown" && usesPages(root)) {
      (await pages()).showUnavailable(root);
      return;
    }
    if (!loggedIn) return;
    await bindCustomer(root);
    await Promise.all([
      renderOrderList(root, (first) => orders({ first })),
      usesPages(root) ? pages().then((part) => part.renderPages(root)) : null
    ]);
  }
  async function bindCustomer(root) {
    const binds = qsa(root, sel("account-bind"));
    if (!binds.length) return;
    const profile = await customer().catch((error) => {
      reportError(error, "account");
      return null;
    });
    const texts = {
      "first-name": profile?.firstName,
      "last-name": profile?.lastName,
      name: profile?.displayName,
      email: profile?.emailAddress?.emailAddress,
      address: profile?.defaultAddress?.formatted?.join(", ")
    };
    binds.forEach((el) => {
      const text = ownValue(texts, get(el, "account-bind") ?? "");
      if (text != null) setText(el, text);
    });
  }
  var pagesPart = null;
  function pages() {
    pagesPart ?? (pagesPart = loadPart("account-pages").then((part) => {
      part.setup({
        serverBase,
        serverFetch,
        query: query2,
        customer,
        bindCustomer,
        reset: () => {
          forgetBrowserCustomer();
          forgetServerLogin();
        }
      });
      return part;
    }));
    return pagesPart;
  }
  var order = (id) => pages().then((part) => part.order(id));
  var updateProfile = (fields) => pages().then((part) => part.updateProfile(fields));
  var addresses = () => pages().then((part) => part.addresses());
  var saveAddress = (address, options) => pages().then((part) => part.saveAddress(address, options));
  var deleteAddress = (id) => pages().then((part) => part.deleteAddress(id));
  var subscriptions = () => pages().then((part) => part.subscriptions());
  var subscriptionAction = (id, action) => pages().then((part) => part.subscriptionAction(id, action));
  var requestReturn = (orderId, lines) => pages().then((part) => part.requestReturn(orderId, lines));
  function onClick(event) {
    const target = event.target;
    if (!(target instanceof window.Element)) return;
    if (target.closest(sel("account-login"))) {
      event.preventDefault();
      login().catch((error) => {
        reportError(error, "login");
      });
    } else if (target.closest(sel("account-logout"))) {
      event.preventDefault();
      logout().catch((error) => {
        reportError(error, "logout");
      });
    }
  }
  function startServerMode() {
    const url = new URL(window.location.href);
    if (url.searchParams.get("account")) {
      url.searchParams.delete("account");
      window.history.replaceState(window.history.state, "", url);
      emit("account-login", {});
    }
    Cart.setCustomer({ beforeCheckout: serverCheckoutUrl });
  }
  async function startBrowserMode() {
    try {
      await handleCallback();
    } catch (error) {
      reportError(error, "login");
    }
    if (Cart.customerAccessToken) return;
    try {
      const accessToken2 = await getToken();
      if (accessToken2) Cart.setCustomer({ accessToken: accessToken2 });
    } catch (error) {
      reportError(error, "account");
    }
  }
  var started = false;
  async function mountAccount(root = document) {
    if (!started) {
      started = true;
      document.addEventListener("click", onClick);
      if (serverBase()) startServerMode();
      else await startBrowserMode();
      log("account", isLoggedIn() ? "logged in" : "logged out");
    }
    await render(root);
  }

  // src/parts/account.js
  var { Tether } = (
    /** @type {Window & { Tether?: { __parts: Record<string, unknown> } }} */
    window
  );
  if (!Tether) throw new Error("tether.account.js runs after the Tether script, which loads it");
  Tether.__parts["account"] = account_exports;
})();
