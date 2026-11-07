(() => {
  var __defProp = Object.defineProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };

  // src/account-pages.ts
  var account_pages_exports = {};
  __export(account_pages_exports, {
    addresses: () => addresses,
    deleteAddress: () => deleteAddress,
    order: () => order,
    renderPages: () => renderPages,
    requestReturn: () => requestReturn,
    saveAddress: () => saveAddress,
    setup: () => setup,
    showUnavailable: () => showUnavailable,
    subscriptionAction: () => subscriptionAction,
    subscriptions: () => subscriptions,
    updateProfile: () => updateProfile
  });

  // tether-core:config.ts
  var m = window.Tether.__core["config.ts"];
  var [cfg, isConfigured, log, MARKET_SOURCES, parseMarkets, reportError, warn] = m;

  // tether-core:dom.ts
  var m2 = window.Tether.__core["dom.ts"];
  var [ANALYTICS_EVENTS, attr, attributesFromJson, busy, emit, formatDate, formatMoney, get, has, hasTemplate, integerAttribute, isOwnEvent, notifyLayoutChanged, parseJSONAttr, productUrl, qsa, repeat, scoped, sel, setImage, setStoreHtml, setText, show] = m2;

  // tether-core:client.ts
  var m3 = window.Tether.__core["client.ts"];
  var [endpoint, gql, matches, orNull, shaped, TetherError] = m3;

  // server/src/shared/account-routes.ts
  var OPERATION_ROUTES = {
    order: { name: "order", method: "GET", path: "/order", fields: { id: true } },
    addresses: { name: "addresses", method: "GET", path: "/addresses", fields: {} },
    subscriptions: { name: "subscriptions", method: "GET", path: "/subscriptions", fields: {} },
    profile: { name: "profile", method: "POST", path: "/profile", fields: { firstName: true, lastName: true } },
    saveAddress: {
      name: "saveAddress",
      method: "POST",
      path: "/address",
      fields: { id: true, address: true, isDefault: true }
    },
    deleteAddress: { name: "deleteAddress", method: "POST", path: "/address/delete", fields: { id: true } },
    subscription: { name: "subscription", method: "POST", path: "/subscription", fields: { id: true, action: true } },
    requestReturn: { name: "requestReturn", method: "POST", path: "/return", fields: { orderId: true, lines: true } }
  };
  var ROUTE_BY_REQUEST = new Map(
    Object.values(OPERATION_ROUTES).map((route) => [
      `${route.method} ${route.path}`,
      { ...route, fields: Object.keys(route.fields) }
    ])
  );
  function operationRequest(name, input) {
    const route = OPERATION_ROUTES[name];
    if (route.method === "POST") return { method: "POST", path: route.path };
    const values = input;
    const query = new URLSearchParams();
    for (const fieldName of Object.keys(route.fields)) {
      const value = values[fieldName];
      if (typeof value === "string" || typeof value === "number") query.set(fieldName, String(value));
    }
    const search = query.toString();
    return { method: "GET", path: search ? `${route.path}?${search}` : route.path };
  }

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

  // src/account/answers.ts
  var unexpected = (what) => new TetherError(`Customer accounts: the answer has no ${what}`);
  function requiredId(value, what) {
    const id = textOrNull(value);
    if (!id) throw unexpected(what);
    return id;
  }

  // src/account/page-answers.ts
  function toMailingAddress(value) {
    const text = (name) => textOrNull(field(value, name));
    return {
      id: text("id"),
      firstName: text("firstName"),
      lastName: text("lastName"),
      company: text("company"),
      address1: text("address1"),
      address2: text("address2"),
      city: text("city"),
      province: text("province"),
      zoneCode: text("zoneCode"),
      zip: text("zip"),
      country: text("country"),
      countryCode: text("countryCode"),
      phoneNumber: text("phoneNumber"),
      formatted: textList(field(value, "formatted"))
    };
  }
  var mailingAddressOrNull = (value) => isRecord(value) ? toMailingAddress(value) : null;
  var toAccountAddress = (value) => ({
    ...toMailingAddress(value),
    id: requiredId(field(value, "id"), "address id")
  });
  var toCustomerAddresses = (value) => listOf(value, (address) => ({ ...toAccountAddress(address), isDefault: field(address, "isDefault") === true }));
  var toOrderDetailLine = (value) => ({
    ...toOrderLine(value),
    id: requiredId(field(value, "id"), "line item id"),
    name: textOrNull(field(value, "name")),
    sku: textOrNull(field(value, "sku")),
    price: moneyOrNull(field(value, "price")),
    totalPrice: moneyOrNull(field(value, "totalPrice")),
    suggestedReturnReasonDefinitions: nodesOf(field(value, "suggestedReturnReasonDefinitions"), (reason) => ({
      id: requiredId(field(reason, "id"), "return reason id"),
      name: textOrNull(field(reason, "name")),
      handle: textOrNull(field(reason, "handle"))
    }))
  });
  var toFulfillment = (value) => ({
    id: textOrNull(field(value, "id")),
    status: textOrNull(field(value, "status")),
    createdAt: textOrNull(field(value, "createdAt")),
    estimatedDeliveryAt: textOrNull(field(value, "estimatedDeliveryAt")),
    latestShipmentStatus: textOrNull(field(value, "latestShipmentStatus")),
    trackingInformation: listOf(field(value, "trackingInformation"), (tracking) => ({
      company: textOrNull(field(tracking, "company")),
      number: textOrNull(field(tracking, "number")),
      url: textOrNull(field(tracking, "url"))
    }))
  });
  function toReturnableLine(value) {
    const lineId = textOrNull(field(field(value, "lineItem"), "id"));
    return { quantity: countOrZero(field(value, "quantity")), lineItem: lineId === null ? null : { id: lineId } };
  }
  function toReturnInformation(value) {
    if (!isRecord(value)) return null;
    return { returnableLineItems: nodesOf(value["returnableLineItems"], toReturnableLine) };
  }
  function toOrderDetail(value) {
    if (!isRecord(value)) return null;
    const text = (name) => textOrNull(value[name]);
    const money = (name) => moneyOrNull(value[name]);
    const requiresShipping = value["requiresShipping"];
    return {
      id: requiredId(value["id"], "order id"),
      name: text("name"),
      number: numberOrNull(value["number"]),
      processedAt: text("processedAt"),
      cancelledAt: text("cancelledAt"),
      financialStatus: text("financialStatus"),
      fulfillmentStatus: text("fulfillmentStatus"),
      statusPageUrl: text("statusPageUrl"),
      requiresShipping: typeof requiresShipping === "boolean" ? requiresShipping : null,
      totalPrice: money("totalPrice"),
      subtotal: money("subtotal"),
      totalShipping: money("totalShipping"),
      totalTax: money("totalTax"),
      shippingAddress: mailingAddressOrNull(value["shippingAddress"]),
      billingAddress: mailingAddressOrNull(value["billingAddress"]),
      lineItems: nodesOf(value["lineItems"], toOrderDetailLine),
      fulfillments: nodesOf(value["fulfillments"], toFulfillment),
      returnInformation: toReturnInformation(value["returnInformation"]),
      returns: nodesOf(value["returns"], toReturn)
    };
  }
  var toSubscriptionLine = (value) => ({
    id: textOrNull(field(value, "id")),
    name: textOrNull(field(value, "name")),
    title: textOrNull(field(value, "title")),
    variantTitle: textOrNull(field(value, "variantTitle")),
    quantity: countOrZero(field(value, "quantity")),
    sku: textOrNull(field(value, "sku")),
    currentPrice: moneyOrNull(field(value, "currentPrice")),
    lineDiscountedPrice: moneyOrNull(field(value, "lineDiscountedPrice")),
    image: imageOrNull(field(value, "image"))
  });
  var toBillingCycle = (value) => ({
    cycleIndex: numberOrNull(field(value, "cycleIndex")),
    skipped: field(value, "skipped") === true,
    billingAttemptExpectedDate: textOrNull(field(value, "billingAttemptExpectedDate"))
  });
  function toDeliveryPolicy(value) {
    if (!isRecord(value)) return null;
    const intervalCount = value["intervalCount"];
    return {
      interval: textOrNull(value["interval"]),
      intervalCount: isRecord(intervalCount) ? { count: countOrZero(intervalCount["count"]) } : null
    };
  }
  var toSubscriptionContract = (value) => ({
    id: requiredId(field(value, "id"), "subscription id"),
    status: textOrNull(field(value, "status")),
    nextBillingDate: textOrNull(field(value, "nextBillingDate")),
    currencyCode: textOrNull(field(value, "currencyCode")),
    deliveryPrice: moneyOrNull(field(value, "deliveryPrice")),
    deliveryPolicy: toDeliveryPolicy(field(value, "deliveryPolicy")),
    lines: nodesOf(field(value, "lines"), toSubscriptionLine),
    upcomingBillingCycles: nodesOf(field(value, "upcomingBillingCycles"), toBillingCycle)
  });
  var toSubscriptionContracts = (value) => listOf(value, toSubscriptionContract);
  function toSubscriptionChange(result) {
    const { contract, billingCycle } = result;
    if (isRecord(contract)) {
      return { contract: { id: textOrNull(contract["id"]), status: textOrNull(contract["status"]) } };
    }
    if (isRecord(billingCycle)) {
      const { cycleIndex, skipped } = toBillingCycle(billingCycle);
      return { billingCycle: { cycleIndex, skipped } };
    }
    throw unexpected("changed subscription");
  }
  function toReturn(value) {
    return { id: requiredId(field(value, "id"), "return id"), status: textOrNull(field(value, "status")) };
  }
  var toDeletedId = (value) => requiredId(value, "deleted address id");
  var toProfile = (value) => ({
    firstName: textOrNull(field(value, "firstName")),
    lastName: textOrNull(field(value, "lastName"))
  });

  // src/account/operations.ts
  var context = null;
  function setup(shared) {
    context = shared;
  }
  function pagesContext() {
    if (!context) throw new Error("account-pages: loaded without the account part");
    return context;
  }
  async function run(name, input) {
    const { serverFetch } = pagesContext();
    const { method, path } = operationRequest(name, input);
    const answer = await serverFetch(path, method === "POST" ? { method, body: input } : {});
    if (answer.kind === "logged-out") throw new TetherError("Not logged in", { code: "NOT_LOGGED_IN", status: 401 });
    return answer.data;
  }
  function changed(what) {
    pagesContext().reset();
    emit("account-updated", { what });
  }
  async function order(id) {
    const result = await run("order", { id });
    return toOrderDetail(result["order"]);
  }
  async function updateProfile({
    firstName,
    lastName
  } = {}) {
    const result = await run("profile", { firstName, lastName });
    changed("profile");
    return toProfile(result["customer"]);
  }
  async function addresses() {
    const result = await run("addresses", {});
    return toCustomerAddresses(result["addresses"]);
  }
  async function saveAddress(address, { id, isDefault } = {}) {
    const result = await run("saveAddress", { id, address, isDefault });
    changed("addresses");
    return toAccountAddress(result["address"]);
  }
  async function deleteAddress(id) {
    const result = await run("deleteAddress", { id });
    changed("addresses");
    return toDeletedId(result["deleted"]);
  }
  async function subscriptions() {
    const result = await run("subscriptions", {});
    return toSubscriptionContracts(result["subscriptions"]);
  }
  async function subscriptionAction(id, action) {
    const result = await run("subscription", { id, action });
    changed("subscriptions");
    return toSubscriptionChange(result);
  }
  async function requestReturn(orderId, lines) {
    const result = await run("requestReturn", { orderId, lines });
    changed("orders");
    return toReturn(result["return"]);
  }

  // tether-core:shopify-values.ts
  var m4 = window.Tether.__core["shopify-values.ts"];
  var [isHttpsUrl, MAX_CONNECTION_SIZE] = m4;

  // src/account/markup.ts
  function showIn(root, name, conditions) {
    qsa(root, sel(name)).forEach((el) => {
      const key = get(el, name) ?? "";
      if (Object.hasOwn(conditions, key)) show(el, conditions[key] === true);
    });
  }
  var bindsIn = (row, name) => qsa(row, sel(name)).concat(row.matches(sel(name)) ? [row] : []);
  var enumText = (value) => value ? value.toLowerCase().replace(/_/g, " ") : "";
  var addressText = (address) => (address?.formatted ?? []).join(", ");
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

  // src/account/order-page.ts
  function orderKey(el) {
    const raw = get(el, "order") || "";
    if (!raw.startsWith("url:")) return raw;
    return new URL(window.location.href).searchParams.get(raw.slice("url:".length) || "id");
  }
  function showOrderState(el, state) {
    el.setAttribute(attr("order-state"), state);
    showIn(el, "order-show", {
      loading: state === "loading",
      ready: false,
      "not-found": state === "not-found",
      error: state === "error"
    });
  }
  var orderTexts = (detail) => ({
    name: detail.name ?? "",
    date: formatDate(detail.processedAt),
    total: formatMoney(detail.totalPrice),
    subtotal: formatMoney(detail.subtotal),
    shipping: formatMoney(detail.totalShipping),
    tax: formatMoney(detail.totalTax),
    status: enumText(detail.financialStatus),
    fulfillment: enumText(detail.fulfillmentStatus),
    "shipping-address": addressText(detail.shippingAddress),
    "billing-address": addressText(detail.billingAddress),
    items: detail.lineItems.nodes.map((line) => `${String(line.quantity)}\xD7 ${line.title || line.name || ""}`).join(", "),
    cancelled: formatDate(detail.cancelledAt)
  });
  function fillFulfillment(row, fulfillment) {
    const tracking = fulfillment.trackingInformation[0];
    const texts = {
      status: enumText(fulfillment.latestShipmentStatus || fulfillment.status),
      date: formatDate(fulfillment.createdAt),
      eta: formatDate(fulfillment.estimatedDeliveryAt),
      company: tracking?.company || "",
      number: tracking?.number || ""
    };
    bindsIn(row, "fulfillment-bind").forEach((el) => {
      const key = get(el, "fulfillment-bind") ?? "";
      if (key === "url") {
        const url = tracking?.url ?? null;
        const linked = url !== null && isHttpsUrl(url);
        if (linked) el.setAttribute("href", url);
        show(el, linked);
        return;
      }
      const text = ownValue(texts, key);
      if (text !== void 0) setText(el, text);
    });
  }
  function fillOrder(el, detail) {
    const returnable = new Map(
      (detail.returnInformation?.returnableLineItems.nodes ?? []).map((entry) => [
        entry.lineItem?.id ?? "",
        entry.quantity
      ])
    );
    const shipments = detail.fulfillments.nodes;
    const texts = orderTexts(detail);
    qsa(el, sel("order-bind")).forEach((bind) => {
      const key = get(bind, "order-bind") ?? "";
      if (key === "url") {
        const statusPage = detail.statusPageUrl;
        if (statusPage !== null && isHttpsUrl(statusPage)) bind.setAttribute("href", statusPage);
        return;
      }
      const text = ownValue(texts, key);
      if (text !== void 0) setText(bind, text);
    });
    qsa(el, sel("order-lines")).forEach((box) => {
      fillLines(box, detail.lineItems.nodes, returnable);
    });
    qsa(el, sel("order-fulfillments")).forEach((box) => {
      repeat(box, shipments, fillFulfillment);
    });
    const returnRequested = el.dataset["tetherReturned"] === "1";
    showIn(el, "order-show", {
      loading: false,
      ready: true,
      error: false,
      "not-found": false,
      cancelled: Boolean(detail.cancelledAt),
      shipped: shipments.length > 0,
      returnable: [...returnable.values()].some((quantity) => quantity > 0),
      "has-returns": !returnRequested && detail.returns.nodes.length > 0,
      "return-requested": returnRequested
    });
    el.setAttribute(attr("order-state"), "ready");
  }
  async function renderOrder(el) {
    const key = orderKey(el);
    if (!key) {
      el.setAttribute(attr("order-state"), "not-found");
      showIn(el, "order-show", { "not-found": true });
      return;
    }
    showOrderState(el, "loading");
    let detail;
    try {
      detail = await order(key);
    } catch (error) {
      reportError(error, "order");
      showOrderState(el, "error");
      return;
    }
    if (!detail) {
      showOrderState(el, "not-found");
      return;
    }
    el.dataset["tetherOrderId"] = detail.id;
    fillOrder(el, detail);
  }

  // src/account/addresses-view.ts
  var shown = [];
  var shownAddress = (id) => shown.find((address) => address.id === id);
  var addressTexts = (address) => ({
    formatted: addressText(address),
    name: [address.firstName, address.lastName].filter(Boolean).join(" "),
    company: address.company || "",
    address1: address.address1 || "",
    address2: address.address2 || "",
    city: address.city || "",
    zip: address.zip || "",
    province: address.province || "",
    country: address.country || "",
    phone: address.phoneNumber || ""
  });
  function fillAddress(row, address) {
    row.dataset["tetherAddress"] = address.id;
    const texts = addressTexts(address);
    bindsIn(row, "address-bind").forEach((el) => {
      const text = ownValue(texts, get(el, "address-bind") ?? "");
      if (text !== void 0) setText(el, text);
    });
    showIn(row, "address-show", { default: address.isDefault, "not-default": !address.isDefault });
  }
  async function renderAddresses(root) {
    const boxes = qsa(root, sel("addresses"));
    if (!boxes.length) return;
    showIn(root, "show", { "addresses-loading": true, "addresses-empty": false });
    let list;
    try {
      list = await addresses();
    } catch (error) {
      reportError(error, "addresses");
      showIn(root, "show", { "addresses-loading": false, "addresses-error": true });
      return;
    }
    shown = list;
    showIn(root, "show", { "addresses-loading": false, "addresses-empty": list.length === 0, "addresses-error": false });
    boxes.forEach((box) => {
      repeat(box, list, fillAddress);
    });
  }

  // src/account/subscriptions-view.ts
  function conditionsOf(contract) {
    const next = contract.upcomingBillingCycles.nodes[0];
    const status = contract.status;
    const active = status === "ACTIVE";
    return {
      active,
      paused: status === "PAUSED",
      cancelled: status === "CANCELLED",
      expired: status === "EXPIRED",
      failed: status === "FAILED",
      skipped: Boolean(next?.skipped),
      "can-pause": active,
      "can-resume": status === "PAUSED" || status === "FAILED",
      "can-skip": active && next !== void 0 && !next.skipped,
      "can-unskip": active && Boolean(next?.skipped),
      "can-cancel": active || status === "PAUSED" || status === "FAILED"
    };
  }
  function intervalText(contract) {
    const unit = enumText(contract.deliveryPolicy?.interval);
    if (!unit) return "";
    const count = contract.deliveryPolicy?.intervalCount?.count ?? 1;
    return count <= 1 ? unit : `${String(count)} ${unit}s`;
  }
  function contractTexts(contract) {
    const lines = contract.lines.nodes;
    const total = lines.reduce((sum, line) => sum + Number.parseFloat(line.lineDiscountedPrice?.amount ?? "0"), 0);
    return {
      status: enumText(contract.status),
      next: formatDate(contract.nextBillingDate),
      interval: intervalText(contract),
      products: lines.map((line) => `${String(line.quantity)}\xD7 ${line.title ?? ""}`).join(", "),
      total: formatMoney(
        lines.length && contract.currencyCode ? { amount: String(total), currencyCode: contract.currencyCode } : null
      ),
      delivery: formatMoney(contract.deliveryPrice)
    };
  }
  function fillLine(row, line) {
    const texts = {
      title: line.title ?? "",
      "variant-title": line.variantTitle || "",
      quantity: String(line.quantity),
      price: formatMoney(line.currentPrice)
    };
    bindsIn(row, "subscription-line").forEach((el) => {
      const key = get(el, "subscription-line") ?? "";
      if (key === "image") {
        if (line.image) setImage(el, line.image.url, line.image.altText || line.title || "");
        return;
      }
      const text = ownValue(texts, key);
      if (text !== void 0) setText(el, text);
    });
  }
  function fillContract(row, contract) {
    row.dataset["tetherSubscription"] = contract.id;
    row.setAttribute(attr("subscription-status"), enumText(contract.status));
    const texts = contractTexts(contract);
    qsa(row, sel("subscription-bind")).forEach((el) => {
      const text = ownValue(texts, get(el, "subscription-bind") ?? "");
      if (text !== void 0) setText(el, text);
    });
    qsa(row, sel("subscription-lines")).forEach((box) => {
      repeat(box, contract.lines.nodes, fillLine);
    });
    const conditions = conditionsOf(contract);
    showIn(row, "subscription-show", conditions);
    qsa(row, sel("subscription-action")).forEach((button) => {
      const allowed = ownValue(conditions, `can-${get(button, "subscription-action") ?? ""}`) === true;
      if ("disabled" in button) button.disabled = !allowed;
      button.classList.toggle("is-disabled", !allowed);
    });
  }
  async function renderSubscriptions(root) {
    const boxes = qsa(root, sel("subscriptions"));
    if (!boxes.length) return;
    showIn(root, "show", { "subscriptions-loading": true, "subscriptions-empty": false });
    let list;
    try {
      list = await subscriptions();
    } catch (error) {
      reportError(error, "subscriptions");
      showIn(root, "show", { "subscriptions-loading": false, "subscriptions-error": true });
      return;
    }
    showIn(root, "show", {
      "subscriptions-loading": false,
      "subscriptions-empty": list.length === 0,
      "subscriptions-error": false
    });
    boxes.forEach((box) => {
      repeat(box, list, fillContract);
    });
  }

  // src/account/page-events.ts
  var SUBSCRIPTION_ACTIONS = ["pause", "resume", "skip", "unskip", "cancel"];
  var isSubscriptionAction = (value) => SUBSCRIPTION_ACTIONS.some((action) => action === value);
  var isField = (el) => el instanceof window.HTMLInputElement || el instanceof window.HTMLSelectElement || el instanceof window.HTMLTextAreaElement;
  var isForm = (el) => el instanceof window.HTMLFormElement;
  function fieldsOf(form) {
    const fields = {};
    for (const field2 of form.elements) {
      if (!isField(field2)) continue;
      if (!field2.name || field2.type === "submit" || field2.type === "button" || field2.type === "checkbox") continue;
      fields[field2.name] = field2.value;
    }
    return fields;
  }
  function customerMessage(error) {
    const userErrors = error instanceof TetherError ? error.userErrors ?? [] : [];
    const message = userErrors.map((userError) => userError.message).join(" ");
    if (message) return message;
    const text = error instanceof Error && error.message ? error.message : "Something went wrong";
    return text.replace(/^Customer accounts: /, "");
  }
  async function act(el, change) {
    if (el.getAttribute("aria-busy") === "true") return "busy";
    el.classList.add("is-busy");
    el.setAttribute("aria-busy", "true");
    el.setAttribute(attr("form-state"), "pending");
    const errorBoxes = qsa(el, sel("form-error"));
    errorBoxes.forEach((box) => {
      setText(box, "");
    });
    try {
      await change();
      el.setAttribute(attr("form-state"), "saved");
      return "saved";
    } catch (error) {
      el.setAttribute(attr("form-state"), "error");
      errorBoxes.forEach((box) => {
        setText(box, customerMessage(error));
      });
      return "error";
    } finally {
      el.classList.remove("is-busy");
      el.removeAttribute("aria-busy");
    }
  }
  var confirmed = (button) => {
    const question = get(button, "confirm");
    return !question || window.confirm(question);
  };
  var addressFormReset = (form) => {
    form.reset();
    delete form.dataset["tetherAddressId"];
  };
  function onSubmit(event) {
    const form = event.target;
    if (!(form instanceof window.HTMLFormElement)) return;
    if (form.matches(sel("profile-form"))) {
      event.preventDefault();
      void act(form, async () => {
        await updateProfile(fieldsOf(form));
        await pagesContext().bindCustomer(document);
      });
    } else if (form.matches(sel("address-form"))) {
      event.preventDefault();
      const id = form.dataset["tetherAddressId"];
      const box = form.elements.namedItem("isDefault");
      const isDefault = box instanceof window.HTMLInputElement && box.checked;
      void act(form, async () => {
        await saveAddress(fieldsOf(form), { id, isDefault });
        addressFormReset(form);
        await renderAddresses(document);
      });
    }
  }
  function editAddress(id) {
    const address = shownAddress(id);
    const form = document.querySelector(sel("address-form"));
    if (!address || !form || !isForm(form)) return;
    form.dataset["tetherAddressId"] = address.id;
    const valuesByName = { ...address };
    for (const field2 of form.elements) {
      if (!isField(field2)) continue;
      if (field2.name === "isDefault") {
        if (field2 instanceof window.HTMLInputElement) field2.checked = address.isDefault;
      } else if (field2.name && Object.hasOwn(valuesByName, field2.name)) {
        const value = valuesByName[field2.name];
        field2.value = typeof value === "string" ? value : "";
      }
    }
    form.scrollIntoView({ block: "nearest" });
  }
  function onAddressClick(event, target) {
    const row = target.closest("[data-tether-address]");
    const id = row instanceof window.HTMLElement ? row.dataset["tetherAddress"] : void 0;
    if (target.closest(sel("address-new"))) {
      const form = document.querySelector(sel("address-form"));
      if (form && isForm(form)) addressFormReset(form);
      return true;
    }
    if (!(row instanceof window.HTMLElement) || !id) return false;
    const deleteButton = target.closest(sel("address-delete"));
    if (deleteButton) {
      event.preventDefault();
      if (!confirmed(deleteButton)) return true;
      void act(row, async () => {
        await deleteAddress(id);
        await renderAddresses(document);
      });
    } else if (target.closest(sel("address-default"))) {
      event.preventDefault();
      void act(row, async () => {
        await saveAddress(null, { id, isDefault: true });
        await renderAddresses(document);
      });
    } else if (target.closest(sel("address-edit"))) {
      event.preventDefault();
      editAddress(id);
    } else {
      return false;
    }
    return true;
  }
  function onSubscriptionAction(button) {
    const row = button.closest("[data-tether-subscription]");
    const action = get(button, "subscription-action");
    const disabled = "disabled" in button && button.disabled === true || button.classList.contains("is-disabled");
    if (!(row instanceof window.HTMLElement) || !isSubscriptionAction(action) || disabled || !confirmed(button)) return;
    const id = row.dataset["tetherSubscription"] ?? "";
    row.setAttribute(attr("subscription-state"), "pending");
    void act(row, async () => {
      await subscriptionAction(id, action);
      await renderSubscriptions(document);
    }).then((outcome) => {
      const state = outcome === "error" ? "error" : "done";
      qsa(document, "[data-tether-subscription]").filter((candidate) => candidate === row || candidate.dataset["tetherSubscription"] === id).forEach((candidate) => {
        candidate.setAttribute(attr("subscription-state"), state);
      });
    });
  }
  function returnLineOf(row) {
    const quantity = row.querySelector(sel("return-quantity"));
    const reason = row.querySelector(sel("return-reason"));
    const note = row.querySelector(sel("return-note"));
    const valueOf = (field2) => field2 && "value" in field2 && typeof field2.value === "string" ? field2.value : "";
    const line = {
      lineItemId: row.dataset["tetherLine"] ?? "",
      quantity: Number.parseInt(valueOf(quantity) || "0", 10)
    };
    const reasonId = valueOf(reason);
    if (reasonId) line.reasonId = reasonId;
    const noteText = valueOf(note);
    if (noteText) line.note = noteText;
    return line;
  }
  function onReturnRequest(button) {
    const scope = button.closest(sel("order"));
    if (!(scope instanceof window.HTMLElement)) return;
    const orderId = scope.dataset["tetherOrderId"];
    if (!orderId) return;
    const lines = qsa(scope, "[data-tether-line]").map(returnLineOf).filter((line) => line.quantity > 0);
    if (!lines.length || !confirmed(button)) return;
    void act(scope, async () => {
      await requestReturn(orderId, lines);
      scope.dataset["tetherReturned"] = "1";
      await renderOrder(scope);
    });
  }
  function onClick(event) {
    const target = event.target;
    if (!(target instanceof window.Element)) return;
    if (onAddressClick(event, target)) return;
    const subscriptionButton = target.closest(sel("subscription-action"));
    if (subscriptionButton instanceof window.HTMLElement) {
      event.preventDefault();
      onSubscriptionAction(subscriptionButton);
      return;
    }
    const returnButton = target.closest(sel("order-return"));
    if (returnButton instanceof window.HTMLElement) {
      event.preventDefault();
      onReturnRequest(returnButton);
    }
  }
  function listenToPages() {
    document.addEventListener("submit", onSubmit, true);
    document.addEventListener("input", (event) => {
      const target = event.target;
      if (target instanceof window.HTMLElement && target.closest(sel("profile-form"))) {
        target.dataset["tetherTouched"] = "1";
      }
    });
    document.addEventListener("click", onClick);
  }

  // src/account-pages.ts
  var PROFILE_FIELDS = ["firstName", "lastName"];
  async function renderProfile(form) {
    if (!(form instanceof window.HTMLFormElement)) return;
    let customer;
    try {
      customer = await pagesContext().customer();
    } catch (error) {
      reportError(error, "account");
      return;
    }
    if (!customer) return;
    const fields = form.elements;
    PROFILE_FIELDS.forEach((name) => {
      const input = fields.namedItem(name);
      const isTextField = input instanceof window.HTMLInputElement || input instanceof window.HTMLTextAreaElement;
      if (isTextField && !input.dataset["tetherTouched"]) input.value = customer[name] ?? "";
    });
  }
  var listening = false;
  async function renderPages(root = document) {
    if (!listening) {
      listening = true;
      listenToPages();
    }
    await Promise.all([
      ...qsa(root, sel("order")).map((el) => renderOrder(el)),
      ...qsa(root, sel("profile-form")).map((form) => renderProfile(form)),
      renderAddresses(root),
      renderSubscriptions(root)
    ]);
  }
  function showUnavailable(root) {
    qsa(root, sel("order")).forEach((el) => {
      showOrderState(el, "error");
    });
    showIn(root, "show", {
      "addresses-loading": false,
      "addresses-error": true,
      "subscriptions-loading": false,
      "subscriptions-error": true
    });
  }

  // src/part-registry.ts
  function isTetherInternals(value) {
    return isRecord(value) && isRecord(value["__core"]) && isRecord(value["__parts"]);
  }
  function registerPart(name, part) {
    const tether = Reflect.get(window, "Tether");
    if (!isTetherInternals(tether)) {
      throw new Error(`tether.${name}.js runs after the Tether script, which loads it, and needs its window.Tether`);
    }
    tether.__parts[name] = part;
  }

  // src/parts/account-pages.ts
  registerPart("account-pages", account_pages_exports);
})();
