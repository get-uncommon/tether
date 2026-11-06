(() => {
  var __defProp = Object.defineProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };

  // src/account.ts
  var account_exports = {};
  __export(account_exports, {
    addresses: () => addresses,
    customer: () => customer,
    deleteAddress: () => deleteAddress,
    isLoggedIn: () => isLoggedIn,
    login: () => login,
    logout: () => logout,
    mountAccount: () => mountAccount,
    order: () => order,
    orders: () => orders,
    render: () => render,
    requestReturn: () => requestReturn,
    saveAddress: () => saveAddress,
    subscriptionAction: () => subscriptionAction,
    subscriptions: () => subscriptions,
    updateProfile: () => updateProfile
  });

  // tether-core:config.ts
  var m = window.Tether.__core["config.ts"];
  var [cfg, isConfigured, log, MARKET_SOURCES, parseMarkets, reportError, warn] = m;

  // tether-core:client.ts
  var m2 = window.Tether.__core["client.ts"];
  var [endpoint, gql, orNull, shaped, TetherError] = m2;

  // tether-core:dom.ts
  var m3 = window.Tether.__core["dom.ts"];
  var [ANALYTICS_EVENTS, attr, attributesFromJson, emit, formatDate, formatMoney, get, has, hasTemplate, isOwnEvent, parseJSONAttr, productUrl, qsa, repeat, sel, setImage, setText, show] = m3;

  // tether-core:cart.ts
  var m4 = window.Tether.__core["cart.ts"];
  var [Cart] = m4;

  // tether-core:lazy.ts
  var m5 = window.Tether.__core["lazy.ts"];
  var [loadPart] = m5;

  // server/src/shared/json.ts
  function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }
  function field(value, key) {
    return isRecord(value) ? value[key] : void 0;
  }
  function asList(value) {
    return Array.isArray(value) ? value : [];
  }
  function textOrNull(value) {
    return typeof value === "string" && value !== "" ? value : null;
  }
  var numberOrNull = (value) => typeof value === "number" && Number.isFinite(value) ? value : null;
  var countOrZero = (value) => numberOrNull(value) ?? 0;
  var listOf = (value, read) => asList(value).map((item) => read(item));
  var nodesOf = (connection, read) => ({
    nodes: listOf(field(connection, "nodes"), read)
  });
  var textList = (value) => listOf(value, textOrNull).filter((line) => line !== null);

  // server/src/shared/error-message.ts
  function messageOf(error) {
    return error instanceof Error ? error.message : String(error);
  }

  // src/storage.ts
  function setStored(key, value, area = "localStorage") {
    try {
      window[area].setItem(key, value);
    } catch {
    }
  }
  function removeStored(key, area = "localStorage") {
    try {
      window[area].removeItem(key);
    } catch {
    }
  }

  // src/account-marks.ts
  var hintKey = () => `${cfg.prefix}:account-hint:${cfg.domain}`;
  var isLoginOutcome = (value) => value === "in" || value === "expired" || value === "error";

  // server/src/shared/account-orders.ts
  function moneyOrNull(value) {
    const amount = textOrNull(field(value, "amount"));
    const currencyCode = textOrNull(field(value, "currencyCode"));
    return amount === null || currencyCode === null ? null : { amount, currencyCode };
  }
  function imageOrNull(value) {
    const url = textOrNull(field(value, "url"));
    return url === null ? null : { url, altText: textOrNull(field(value, "altText")) };
  }
  var toOrderLine = (value) => ({
    title: textOrNull(field(value, "title")),
    variantTitle: textOrNull(field(value, "variantTitle")),
    quantity: countOrZero(field(value, "quantity")),
    image: imageOrNull(field(value, "image"))
  });
  var toAccountOrder = (value, id) => ({
    id,
    name: textOrNull(field(value, "name")),
    processedAt: textOrNull(field(value, "processedAt")),
    financialStatus: textOrNull(field(value, "financialStatus")),
    fulfillmentStatus: textOrNull(field(value, "fulfillmentStatus")),
    statusPageUrl: textOrNull(field(value, "statusPageUrl")),
    totalPrice: moneyOrNull(field(value, "totalPrice")),
    lineItems: nodesOf(field(value, "lineItems"), toOrderLine)
  });
  function readOrders(value) {
    const orders2 = [];
    for (const item of asList(value)) {
      const id = textOrNull(field(item, "id"));
      if (id === null) return { kind: "missing-id" };
      orders2.push(toAccountOrder(item, id));
    }
    return { kind: "read", orders: orders2 };
  }

  // src/account/answers.ts
  var unexpected = (what) => new TetherError(`Customer accounts: the answer has no ${what}`);
  function toAccountCustomer(value) {
    const customer2 = isRecord(value) ? value : {};
    const id = textOrNull(customer2["id"]);
    const email = textOrNull(customer2["email"]);
    const address = customer2["address"];
    return {
      ...id === null ? {} : { id },
      firstName: textOrNull(customer2["firstName"]),
      lastName: textOrNull(customer2["lastName"]),
      displayName: textOrNull(customer2["displayName"]),
      emailAddress: email === null ? null : { emailAddress: email },
      defaultAddress: Array.isArray(address) ? { formatted: textList(address) } : null
    };
  }
  function toAccountOrders(value) {
    const reading = readOrders(value);
    if (reading.kind === "missing-id") throw unexpected("order id");
    return reading.orders;
  }
  function toUserError(value) {
    const message = textOrNull(field(value, "message"));
    if (message === null) return null;
    const fieldPath = field(value, "field");
    return {
      message,
      field: Array.isArray(fieldPath) ? textList(fieldPath) : null,
      code: textOrNull(field(value, "code"))
    };
  }
  var toUserErrors = (value) => listOf(value, toUserError).filter((error) => error !== null);

  // src/account/server-client.ts
  var known = null;
  function serverBase() {
    const server = cfg.account?.server;
    if (!server) {
      throw new TetherError("Customer accounts need the Worker: set account.server", { code: "NOT_CONFIGURED" });
    }
    return new URL(server, window.location.href).href.replace(/\/$/, "");
  }
  function setLoginHint(loggedIn) {
    if (loggedIn) setStored(hintKey(), "1");
    else removeStored(hintKey());
  }
  async function fetchFromWorker(url, init) {
    try {
      return await fetch(url, init);
    } catch (error) {
      throw new TetherError(`Network error: ${messageOf(error)}`, {
        code: "NETWORK"
      });
    }
  }
  async function readJsonObjectOrEmpty(response) {
    let json;
    try {
      json = await response.json();
    } catch {
      return {};
    }
    return isRecord(json) ? json : {};
  }
  async function serverFetch(path, { method = "GET", body } = {}) {
    const init = { method, credentials: "include" };
    if (method === "POST") init.headers = { "Content-Type": "application/json", "X-Tether-Account": "1" };
    if (body) init.body = JSON.stringify(body);
    const response = await fetchFromWorker(`${serverBase()}${path}`, init);
    if (response.status === 401) return { kind: "logged-out" };
    const data = await readJsonObjectOrEmpty(response);
    if (!response.ok) {
      const reason = textOrNull(data["error"]) ?? String(response.status);
      const userErrors = toUserErrors(data["userErrors"]);
      throw new TetherError(`Customer accounts: ${reason}`, {
        status: response.status,
        ...userErrors.length > 0 && { userErrors },
        // The Worker marks refused input (a 400, or a 404 for a contract that isn't the customer's) with `code`.
        ...data["code"] === "INVALID" && { code: "INVALID" }
      });
    }
    return { kind: "answer", data };
  }
  async function serverLogin() {
    if (!known) {
      const answer = await serverFetch("/me");
      known = answer.kind === "answer" && answer.data["loggedIn"] === true ? { loggedIn: true, customer: toAccountCustomer(answer.data["customer"]) } : { loggedIn: false };
    }
    setLoginHint(known.loggedIn);
    return known;
  }
  var isServerLoggedIn = () => known?.loggedIn === true;
  function forgetServerLogin() {
    known = null;
  }
  function navigate(url) {
    const replacement = cfg.account?.navigate;
    if (replacement) replacement(url);
    else window.location.assign(url);
  }
  var loginLanguage = (locale) => locale || cfg.account?.locale || (cfg.locale || "").split("-")[0] || "";
  function serverLoginRedirect({ returnTo, locale }) {
    const url = new URL(`${serverBase()}/login`);
    url.searchParams.set("returnTo", returnTo);
    const language = loginLanguage(locale);
    if (language) url.searchParams.set("locale", language);
    if (cfg.country) url.searchParams.set("country", cfg.country.toUpperCase());
    navigate(url.toString());
  }
  async function serverCheckoutUrl() {
    const cartId = Cart.id();
    if (!(await serverLogin()).loggedIn || !cartId) return null;
    const answer = await serverFetch("/cart", { method: "POST", body: { cartId } });
    if (answer.kind === "logged-out") return null;
    return textOrNull(answer.data["checkoutUrl"]);
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

  // tether-core:shopify-values.ts
  var m6 = window.Tether.__core["shopify-values.ts"];
  var [isHttpsUrl] = m6;

  // src/account/markup.ts
  function showIn(root, name, conditions) {
    qsa(root, sel(name)).forEach((el) => {
      const key = get(el, name) ?? "";
      if (Object.hasOwn(conditions, key)) show(el, conditions[key] === true);
    });
  }
  var bindsIn = (row, name) => qsa(row, sel(name)).concat(row.matches(sel(name)) ? [row] : []);
  var ownValue = (values, key) => Object.hasOwn(values, key) ? values[key] : void 0;

  // src/account/order-lines.ts
  var lineTexts = (line, returnable) => ({
    title: line.title || line.name || "",
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
        select.appendChild(new Option(reason.name ?? "", reason.id));
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
          if (line.image) setImage(el, line.image.url, line.image.altText || line.title || "");
          return;
        }
        const text = ownValue(texts, key);
        if (text !== void 0) setText(el, text);
      });
      if (id && returnable !== null) fillReturnControls(row, { ...line, id }, returnable);
    });
  }

  // src/account/order-list.ts
  var DEFAULT_ORDER_COUNT = 10;
  var MAX_ORDER_COUNT = 50;
  var isOrderCount = (value) => typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_ORDER_COUNT;
  function listLimit(limit) {
    const asked = Number.parseInt(limit || String(DEFAULT_ORDER_COUNT), 10) || DEFAULT_ORDER_COUNT;
    return Math.min(Math.max(asked, 1), MAX_ORDER_COUNT);
  }
  var numericId = (gid) => gid.replace(/\?.*$/, "").replace(/^.*\//, "");
  function orderUrl(order2) {
    const template = cfg.account?.orderUrl;
    if (template) return template.replaceAll("{id}", encodeURIComponent(numericId(order2.id)));
    const statusPage = order2.statusPageUrl;
    return statusPage !== null && isHttpsUrl(statusPage) ? statusPage : null;
  }
  var orderTexts = (order2) => ({
    name: order2.name ?? "",
    date: formatDate(order2.processedAt),
    total: formatMoney(order2.totalPrice),
    status: order2.financialStatus?.toLowerCase(),
    fulfillment: order2.fulfillmentStatus?.toLowerCase(),
    items: order2.lineItems.nodes.map((line) => `${String(line.quantity)}\xD7 ${line.title ?? ""}`).join(", ")
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
    const limit = listLimit(get(first, "limit"));
    let orders2;
    try {
      orders2 = await loadOrders(limit);
    } catch (error) {
      reportError(error, "orders");
      orders2 = null;
    }
    showIn(root, "show", { "orders-loading": false, "orders-empty": orders2?.length === 0 });
    lists.forEach((list) => {
      repeat(list, orders2 ?? [], fillOrder);
    });
  }

  // src/account.ts
  var PAGE_ATTRIBUTES = ["order", "addresses", "subscriptions", "profile-form", "address-form"];
  var isLoggedIn = isServerLoggedIn;
  function login({
    returnTo = window.location.href,
    locale
  } = {}) {
    return new Promise((resolve) => {
      serverLoginRedirect({ returnTo, locale });
      resolve();
    });
  }
  async function customer() {
    const me = await serverLogin();
    return me.loggedIn ? me.customer : null;
  }
  async function orders({ first = DEFAULT_ORDER_COUNT } = {}) {
    if (!isOrderCount(first)) {
      throw new TetherError(`Customer accounts: orders() takes first from 1 to ${String(MAX_ORDER_COUNT)}`, {
        code: "INVALID"
      });
    }
    const answer = await serverFetch(`/orders?${new URLSearchParams({ first: String(first) }).toString()}`);
    return answer.kind === "logged-out" ? [] : toAccountOrders(answer.data["orders"]);
  }
  async function logout({
    returnTo = cfg.account?.logoutUrl || `${window.location.origin}/`
  } = {}) {
    if (await serverLogout(returnTo) === "stayed") await render(document);
  }
  async function loginState() {
    try {
      return (await serverLogin()).loggedIn ? { kind: "logged-in" } : { kind: "logged-out" };
    } catch (error) {
      return { kind: "unknown", error };
    }
  }
  var usesPages = (root) => PAGE_ATTRIBUTES.some((name) => qsa(root, sel(name)).length > 0);
  function linkShopifyPages(root) {
    qsa(root, sel("account-link")).forEach((link) => {
      link.setAttribute("href", shopifyPageUrl(get(link, "account-link")));
    });
  }
  function shopifyPageUrl(page) {
    const account = cfg.account;
    const fallback = `https://${cfg.domain}/account`;
    if (page === "payment") return account?.paymentUrl || account?.subscriptionsUrl || fallback;
    if (page === "subscriptions") return account?.subscriptionsUrl || fallback;
    return fallback;
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
    let profile;
    try {
      profile = await customer();
    } catch (error) {
      reportError(error, "account");
      return;
    }
    if (!profile) return;
    const texts = {
      "first-name": profile.firstName,
      "last-name": profile.lastName,
      name: profile.displayName,
      email: profile.emailAddress?.emailAddress,
      address: profile.defaultAddress?.formatted.join(", ")
    };
    binds.forEach((el) => {
      const text = ownValue(texts, get(el, "account-bind") ?? "");
      if (text != null) setText(el, text);
    });
  }
  var pagesPart = null;
  function pages() {
    pagesPart ?? (pagesPart = loadPart("account-pages").then((part) => {
      part.setup({ serverFetch, customer, bindCustomer, reset: forgetServerLogin });
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
  function finishServerLogin() {
    const url = new URL(window.location.href);
    const outcome = url.searchParams.get("account");
    if (!isLoginOutcome(outcome)) return;
    url.searchParams.delete("account");
    window.history.replaceState(window.history.state, "", url);
    switch (outcome) {
      case "in":
        emit("account-login", {});
        break;
      case "expired":
      case "error":
        emit("account-error", { error: outcome });
        break;
    }
  }
  var started = false;
  async function mountAccount(root = document) {
    if (started) {
      await render(root);
      return;
    }
    started = true;
    document.addEventListener("click", onClick);
    finishServerLogin();
    Cart.setCheckoutResolver(serverCheckoutUrl);
    await render(root);
    log("account", isLoggedIn() ? "logged in" : "logged out");
  }

  // src/parts/account.ts
  var { Tether } = window;
  if (!Tether) throw new Error("tether.account.js runs after the Tether script, which loads it");
  Tether.__parts.account = account_exports;
})();
