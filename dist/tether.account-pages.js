"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };

  // src/account-pages.js
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

  // tether-core:config.js
  var m = window.Tether.__core["config.js"];
  var { DEFAULTS, cfg, configure, isConfigured, log, reportError, resolveConfig, toMetafieldIdentifier, warn } = m;

  // tether-core:dom.js
  var m2 = window.Tether.__core["dom.js"];
  var { attr, busy, cdnUrl, emit, formatDate, formatMoney, formatPercent, get, has, hasTemplate, imageUrl, notifyLayoutChanged, parseJSONAttr, productUrl, qsa, repeat, repeatKeyed, sameImage, scoped, sel, setImage, setSelected, setStoreHtml, setText, setTextTracked, show, toAttributes, watchImages } = m2;

  // tether-core:client.js
  var m3 = window.Tether.__core["client.js"];
  var { TetherError, endpoint, gql, request, unwrap, withContext } = m3;

  // server/src/shared/account-ops.js
  var InputError = class extends Error {
    /**
     * @param {string} message
     * @param {{ status?: number, userErrors?: UserError[] }} [details]
     */
    constructor(message, { status = 400, userErrors = [] } = {}) {
      super(message);
      this.name = "InputError";
      this.status = status;
      this.userErrors = userErrors;
    }
  };
  var MONEY = "amount currencyCode";
  var ADDRESS = "id firstName lastName company address1 address2 city province zoneCode zip country countryCode phoneNumber formatted";
  var USER_ERRORS = "userErrors { field message }";
  var QUERIES = {
    order: `query TetherOrder($id:ID!){order(id:$id){id name number processedAt cancelledAt financialStatus fulfillmentStatus statusPageUrl requiresShipping totalPrice{${MONEY}}subtotal{${MONEY}}totalShipping{${MONEY}}totalTax{${MONEY}}shippingAddress{${ADDRESS}}billingAddress{${ADDRESS}}lineItems(first:50){nodes{id name title variantTitle quantity sku image{url altText}price{${MONEY}}totalPrice{${MONEY}}suggestedReturnReasonDefinitions(first:10){nodes{id name handle}}}}fulfillments(first:10){nodes{id status createdAt estimatedDeliveryAt latestShipmentStatus trackingInformation{company number url}}}returnInformation{returnableLineItems(first:50){nodes{quantity lineItem{id}}}}returns(first:10){nodes{id status}}}}`,
    addresses: `query TetherAddresses{customer{defaultAddress{id}addresses(first:20){nodes{${ADDRESS}}}}}`,
    subscriptions: `query TetherSubscriptions{customer{subscriptionContracts(first:20,reverse:true){nodes{id status nextBillingDate currencyCode deliveryPrice{${MONEY}}deliveryPolicy{interval intervalCount{count}}lines(first:20){nodes{id name title variantTitle quantity sku currentPrice{${MONEY}}lineDiscountedPrice{${MONEY}}image{url altText}}}upcomingBillingCycles(first:3){nodes{cycleIndex skipped billingAttemptExpectedDate}}}}}}`,
    contract: `query TetherContract($id:ID!){customer{subscriptionContract(id:$id){id status upcomingBillingCycles(first:3){nodes{cycleIndex skipped}}}}}`
  };
  var MUTATIONS = {
    profile: `mutation TetherProfile($input:CustomerUpdateInput!){customerUpdate(input:$input){customer{firstName lastName}${USER_ERRORS}}}`,
    addressCreate: `mutation TetherAddressCreate($address:CustomerAddressInput!,$default:Boolean){customerAddressCreate(address:$address,defaultAddress:$default){customerAddress{${ADDRESS}}${USER_ERRORS}}}`,
    addressUpdate: `mutation TetherAddressUpdate($id:ID!,$address:CustomerAddressInput,$default:Boolean){customerAddressUpdate(addressId:$id,address:$address,defaultAddress:$default){customerAddress{${ADDRESS}}${USER_ERRORS}}}`,
    addressDelete: `mutation TetherAddressDelete($id:ID!){customerAddressDelete(addressId:$id){deletedAddressId ${USER_ERRORS}}}`,
    returnRequest: `mutation TetherReturn($orderId:ID!,$lines:[RequestedLineItemInput!]!){orderRequestReturn(orderId:$orderId,requestedLineItems:$lines){return{id status}${USER_ERRORS}}}`
  };
  var SUBSCRIPTION_ACTIONS = {
    pause: {
      document: `mutation TetherPause($id:ID!){subscriptionContractPause(subscriptionContractId:$id){contract{id status}${USER_ERRORS}}}`,
      payload: "subscriptionContractPause",
      input: "contract"
    },
    resume: {
      document: `mutation TetherResume($id:ID!){subscriptionContractActivate(subscriptionContractId:$id){contract{id status}${USER_ERRORS}}}`,
      payload: "subscriptionContractActivate",
      input: "contract"
    },
    cancel: {
      document: `mutation TetherCancel($id:ID!){subscriptionContractCancel(subscriptionContractId:$id){contract{id status}${USER_ERRORS}}}`,
      payload: "subscriptionContractCancel",
      input: "contract"
    },
    skip: {
      document: `mutation TetherSkip($input:SubscriptionBillingCycleInput!){subscriptionBillingCycleSkip(billingCycleInput:$input){billingCycle{cycleIndex skipped}${USER_ERRORS}}}`,
      payload: "subscriptionBillingCycleSkip",
      input: "billingCycle"
    },
    unskip: {
      document: `mutation TetherUnskip($input:SubscriptionBillingCycleInput!){subscriptionBillingCycleUnskip(billingCycleInput:$input){billingCycle{cycleIndex skipped}${USER_ERRORS}}}`,
      payload: "subscriptionBillingCycleUnskip",
      input: "billingCycle"
    }
  };
  function isSubscriptionAction(value) {
    return typeof value === "string" && Object.hasOwn(SUBSCRIPTION_ACTIONS, value);
  }
  function field(value, key) {
    if (value === null || typeof value !== "object") return void 0;
    return (
      /** @type {Record<string, unknown>} */
      value[key]
    );
  }
  function nodes(value) {
    const list = field(value, "nodes");
    return Array.isArray(list) ? list : [];
  }
  var NUMERIC_ID = /^\d{1,20}$/;
  function idOf(type, value) {
    const raw = typeof value === "string" || typeof value === "number" ? String(value) : "";
    const id = NUMERIC_ID.test(raw) ? `gid://shopify/${type}/${raw}` : raw;
    if (!new RegExp(`^gid://shopify/${type}/\\d+(\\?[\\w=&.-]{1,80})?$`).test(id)) throw new InputError(`${type} id`);
    return id;
  }
  var CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;
  function text(value, maxLength = 255) {
    if (value === null || value === void 0 || value === "") return void 0;
    if (typeof value !== "string" && typeof value !== "number") throw new InputError("text");
    const clean = String(value).replace(CONTROL_CHARACTERS, "").trim();
    if (clean.length > maxLength) throw new InputError("too long");
    return clean;
  }
  var ADDRESS_FIELDS = [
    "firstName",
    "lastName",
    "company",
    "address1",
    "address2",
    "city",
    "zip",
    "zoneCode",
    "phoneNumber"
  ];
  function addressInput(address, { clear = false } = {}) {
    if (address === null || typeof address !== "object" || Array.isArray(address)) throw new InputError("address");
    const source = (
      /** @type {Record<string, unknown>} */
      address
    );
    const out = {};
    for (const key of ADDRESS_FIELDS) {
      const value = text(source[key]);
      if (value !== void 0) out[key] = value;
      else if (clear && key in source && (source[key] === "" || source[key] === null)) out[key] = "";
    }
    const country = text(source["countryCode"]);
    if (country !== void 0) {
      const code = country.toUpperCase();
      if (!/^[A-Z]{2}$/.test(code)) throw new InputError("countryCode");
      out["countryCode"] = code;
    }
    return out;
  }
  function payloadOf(data, name) {
    const payload = field(data, name);
    const errors = field(payload, "userErrors");
    if (Array.isArray(errors) && errors.length) {
      const userErrors = (
        /** @type {UserError[]} */
        errors
      );
      throw new InputError(userErrors.map((error) => error.message).join(" | "), { userErrors });
    }
    return payload;
  }
  var ops = {
    async order(ask, { id }) {
      const data = await ask(QUERIES.order, { id: idOf("Order", id) });
      return { order: field(data, "order") ?? null };
    },
    async profile(ask, { firstName, lastName }) {
      const input = {};
      if (firstName !== void 0) input["firstName"] = text(firstName, 100) ?? "";
      if (lastName !== void 0) input["lastName"] = text(lastName, 100) ?? "";
      if (!Object.keys(input).length) throw new InputError("nothing to change");
      const payload = payloadOf(await ask(MUTATIONS.profile, { input }), "customerUpdate");
      return { customer: field(payload, "customer") };
    },
    async addresses(ask) {
      const customer = field(await ask(QUERIES.addresses, {}), "customer");
      const defaultId = field(field(customer, "defaultAddress"), "id") ?? null;
      const addresses2 = nodes(field(customer, "addresses")).map((address) => ({
        .../** @type {object} */
        address,
        isDefault: field(address, "id") === defaultId
      }));
      return { addresses: addresses2 };
    },
    async saveAddress(ask, { id, address, isDefault }) {
      const fields = addressInput(address ?? {}, { clear: Boolean(id) });
      const makeDefault = isDefault === true;
      if (!id) {
        const created = await ask(MUTATIONS.addressCreate, { address: fields, default: makeDefault });
        return { address: field(payloadOf(created, "customerAddressCreate"), "customerAddress") };
      }
      const updated = await ask(MUTATIONS.addressUpdate, {
        id: idOf("CustomerAddress", id),
        address: Object.keys(fields).length ? fields : null,
        default: makeDefault ? true : null
      });
      return { address: field(payloadOf(updated, "customerAddressUpdate"), "customerAddress") };
    },
    async deleteAddress(ask, { id }) {
      const data = await ask(MUTATIONS.addressDelete, { id: idOf("CustomerAddress", id) });
      return { deleted: field(payloadOf(data, "customerAddressDelete"), "deletedAddressId") };
    },
    async subscriptions(ask) {
      const contracts = field(field(await ask(QUERIES.subscriptions, {}), "customer"), "subscriptionContracts");
      return { subscriptions: nodes(contracts) };
    },
    async subscription(ask, { id, action }) {
      if (!isSubscriptionAction(action)) throw new InputError("action");
      const contractId = idOf("SubscriptionContract", id);
      const contract = field(field(await ask(QUERIES.contract, { id: contractId }), "customer"), "subscriptionContract");
      if (!contract) throw new InputError("not found", { status: 404 });
      const { document: document2, payload, input } = SUBSCRIPTION_ACTIONS[action];
      if (input === "contract") {
        return { contract: field(payloadOf(await ask(document2, { id: contractId }), payload), "contract") };
      }
      const cycles = nodes(field(contract, "upcomingBillingCycles"));
      const wantSkipped = action === "unskip";
      const cycle = cycles.find((candidate) => Boolean(field(candidate, "skipped")) === wantSkipped);
      if (!cycle) throw new InputError(wantSkipped ? "nothing skipped" : "no upcoming delivery to skip");
      const variables = { input: { contractId, selector: { index: field(cycle, "cycleIndex") } } };
      return { billingCycle: field(payloadOf(await ask(document2, variables), payload), "billingCycle") };
    },
    async requestReturn(ask, { orderId, lines }) {
      const order2 = idOf("Order", orderId);
      if (!Array.isArray(lines) || !lines.length || lines.length > 50) throw new InputError("lines");
      const requested = lines.map((line) => {
        const quantity = Number(field(line, "quantity"));
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1e3) throw new InputError("quantity");
        const out = { lineItemId: idOf("LineItem", field(line, "lineItemId")), quantity };
        const reason = field(line, "reasonId");
        if (reason) out["returnReasonDefinitionId"] = idOf("ReturnReasonDefinition", reason);
        const note = text(field(line, "note"), 300);
        if (note) out["customerNote"] = note;
        return out;
      });
      const data = await ask(MUTATIONS.returnRequest, { orderId: order2, lines: requested });
      return { return: field(payloadOf(data, "orderRequestReturn"), "return") };
    }
  };

  // src/account/operations.js
  var context = null;
  function setup(shared) {
    context = shared;
  }
  function pagesContext() {
    if (!context) throw new Error("account-pages: loaded without the account part");
    return context;
  }
  var ROUTE = {
    order: (input) => ["GET", `/order?id=${encodeURIComponent(String(input["id"]))}`],
    addresses: () => ["GET", "/addresses"],
    subscriptions: () => ["GET", "/subscriptions"],
    profile: () => ["POST", "/profile"],
    saveAddress: () => ["POST", "/address"],
    deleteAddress: () => ["POST", "/address/delete"],
    subscription: () => ["POST", "/subscription"],
    requestReturn: () => ["POST", "/return"]
  };
  async function run(name, input = {}) {
    const { serverBase, serverFetch, query } = pagesContext();
    if (serverBase()) {
      const [method, path] = ROUTE[name](input);
      const answer = await serverFetch(path, method === "POST" ? { method, body: input } : {});
      if (answer.kind === "logged-out") throw new TetherError("Not logged in", { code: "NOT_LOGGED_IN", status: 401 });
      return answer.data;
    }
    const operation = ops[name];
    if (!operation) throw new TetherError(`Customer accounts: no operation ${name}`);
    try {
      return await operation(
        async (document2, variables) => (
          /** @type {Record<string, unknown> | null} */
          await query(document2, variables)
        ),
        input
      );
    } catch (error) {
      if (!(error instanceof InputError)) throw error;
      throw new TetherError(error.message, { code: "INVALID", userErrors: error.userErrors });
    }
  }
  function changed(what) {
    pagesContext().reset();
    emit("account-updated", { what });
  }
  async function order(id) {
    const result = await run("order", { id });
    return (
      /** @type {OrderDetail | null} */
      result["order"] ?? null
    );
  }
  async function updateProfile({ firstName, lastName } = {}) {
    const result = await run("profile", { firstName, lastName });
    changed("profile");
    return (
      /** @type {{ firstName: string | null, lastName: string | null }} */
      result["customer"]
    );
  }
  async function addresses() {
    const result = await run("addresses");
    return (
      /** @type {CustomerAddress[]} */
      result["addresses"]
    );
  }
  async function saveAddress(address, { id, isDefault } = {}) {
    const result = await run("saveAddress", { id, address, isDefault });
    changed("addresses");
    return (
      /** @type {CustomerAddress} */
      result["address"]
    );
  }
  async function deleteAddress(id) {
    const result = await run("deleteAddress", { id });
    changed("addresses");
    return (
      /** @type {string} */
      result["deleted"]
    );
  }
  async function subscriptions() {
    const result = await run("subscriptions");
    return (
      /** @type {SubscriptionContract[]} */
      result["subscriptions"]
    );
  }
  async function subscriptionAction(id, action) {
    const result = await run("subscription", { id, action });
    changed("subscriptions");
    return result;
  }
  async function requestReturn(orderId, lines) {
    const result = await run("requestReturn", { orderId, lines });
    changed("orders");
    return (
      /** @type {{ id: string, status: string }} */
      result["return"]
    );
  }

  // tether-core:shopify-values.js
  var m4 = window.Tether.__core["shopify-values.js"];
  var { STORE_ENV_NAMES, formatMoney: formatMoney2, isHttpsUrl, isSecretShopifyToken, productKey, productUrl: productUrl2 } = m4;

  // src/account-links.js
  function localDate(iso) {
    try {
      return new Date(iso).toLocaleDateString(cfg.locale);
    } catch (error) {
      if (error instanceof RangeError) return iso;
      throw error;
    }
  }

  // src/account/markup.js
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
        const text2 = ownValue(texts, key);
        if (text2 !== void 0) setText(el, text2);
      });
      if (id && returnable !== null) fillReturnControls(row, { ...line, id }, returnable);
    });
  }

  // src/account/order-page.js
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
    name: detail.name,
    date: localDate(detail.processedAt),
    total: formatMoney(detail.totalPrice),
    subtotal: formatMoney(detail.subtotal),
    shipping: formatMoney(detail.totalShipping),
    tax: formatMoney(detail.totalTax),
    status: enumText(detail.financialStatus),
    fulfillment: enumText(detail.fulfillmentStatus),
    "shipping-address": addressText(detail.shippingAddress),
    "billing-address": addressText(detail.billingAddress),
    items: detail.lineItems.nodes.map((line) => `${line.quantity}\xD7 ${line.title || line.name}`).join(", "),
    cancelled: detail.cancelledAt ? localDate(detail.cancelledAt) : ""
  });
  function fillFulfillment(row, fulfillment) {
    const tracking = fulfillment.trackingInformation[0];
    const texts = {
      status: enumText(fulfillment.latestShipmentStatus || fulfillment.status),
      date: localDate(fulfillment.createdAt),
      eta: fulfillment.estimatedDeliveryAt ? localDate(fulfillment.estimatedDeliveryAt) : "",
      company: tracking?.company || "",
      number: tracking?.number || ""
    };
    bindsIn(row, "fulfillment-bind").forEach((el) => {
      const key = get(el, "fulfillment-bind") ?? "";
      if (key === "url") {
        const url = tracking?.url;
        const linked = isHttpsUrl(url);
        if (linked && url) el.setAttribute("href", url);
        show(el, linked);
        return;
      }
      const text2 = ownValue(texts, key);
      if (text2 !== void 0) setText(el, text2);
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
        if (detail.statusPageUrl && isHttpsUrl(detail.statusPageUrl)) bind.setAttribute("href", detail.statusPageUrl);
        return;
      }
      const text2 = ownValue(texts, key);
      if (text2 !== void 0) setText(bind, text2);
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

  // src/account/addresses-view.js
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
      const text2 = ownValue(texts, get(el, "address-bind") ?? "");
      if (text2 !== void 0) setText(el, text2);
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

  // src/account/subscriptions-view.js
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
    return count <= 1 ? unit : `${count} ${unit}s`;
  }
  function contractTexts(contract) {
    const lines = contract.lines.nodes;
    const total = lines.reduce((sum, line) => sum + Number.parseFloat(line.lineDiscountedPrice?.amount ?? "0"), 0);
    return {
      status: enumText(contract.status),
      next: contract.nextBillingDate ? localDate(contract.nextBillingDate) : "",
      interval: intervalText(contract),
      products: lines.map((line) => `${line.quantity}\xD7 ${line.title}`).join(", "),
      total: lines.length ? formatMoney({ amount: String(total), currencyCode: contract.currencyCode }) : "",
      delivery: formatMoney(contract.deliveryPrice)
    };
  }
  function fillLine(row, line) {
    const texts = {
      title: line.title,
      "variant-title": line.variantTitle || "",
      quantity: String(line.quantity),
      price: formatMoney(line.currentPrice)
    };
    bindsIn(row, "subscription-line").forEach((el) => {
      const key = get(el, "subscription-line") ?? "";
      if (key === "image") {
        if (line.image) setImage(el, line.image.url, line.image.altText || line.title);
        return;
      }
      const text2 = ownValue(texts, key);
      if (text2 !== void 0) setText(el, text2);
    });
  }
  function fillContract(row, contract) {
    row.dataset["tetherSubscription"] = contract.id;
    row.setAttribute(attr("subscription-status"), enumText(contract.status));
    const texts = contractTexts(contract);
    qsa(row, sel("subscription-bind")).forEach((el) => {
      const text2 = ownValue(texts, get(el, "subscription-bind") ?? "");
      if (text2 !== void 0) setText(el, text2);
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

  // src/account/page-events.js
  var SUBSCRIPTION_ACTIONS2 = ["pause", "resume", "skip", "unskip", "cancel"];
  var isSubscriptionAction2 = (value) => SUBSCRIPTION_ACTIONS2.some((action) => action === value);
  var isInput2 = (el) => el.tagName === "INPUT";
  var isForm = (el) => el.tagName === "FORM";
  function fieldsOf(form) {
    const fields = {};
    for (const field2 of form.elements) {
      if (!isInput2(field2) && field2.tagName !== "SELECT" && field2.tagName !== "TEXTAREA") continue;
      const input = (
        /** @type {HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement} */
        field2
      );
      if (!input.name || input.type === "submit" || input.type === "button" || input.type === "checkbox") continue;
      fields[input.name] = input.value;
    }
    return fields;
  }
  function messageOf(error) {
    const userErrors = error instanceof TetherError ? error.userErrors ?? [] : [];
    const message = userErrors.map((userError) => userError.message).join(" ");
    if (message) return message;
    const text2 = error instanceof Error && error.message ? error.message : "Something went wrong";
    return text2.replace(/^Customer accounts: /, "");
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
        setText(box, messageOf(error));
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
    for (const field2 of form.elements) {
      if (!isInput2(field2) && field2.tagName !== "SELECT" && field2.tagName !== "TEXTAREA") continue;
      const input = (
        /** @type {HTMLInputElement} */
        field2
      );
      if (input.name === "isDefault") input.checked = address.isDefault;
      else if (input.name && Object.hasOwn(address, input.name)) {
        const value = Object.entries(address).find(([key]) => key === input.name)?.[1];
        input.value = typeof value === "string" ? value : "";
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
    if (!(row instanceof window.HTMLElement) || !isSubscriptionAction2(action) || disabled || !confirmed(button)) return;
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
    const line = { lineItemId: row.dataset["tetherLine"] ?? "", quantity: Number.parseInt(valueOf(quantity) || "0", 10) };
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

  // src/account-pages.js
  var PROFILE_FIELDS = (
    /** @type {const} */
    ["firstName", "lastName"]
  );
  async function renderProfile(form) {
    const customer = await pagesContext().customer().catch((error) => {
      reportError(error, "account");
      return null;
    });
    if (!customer || form.tagName !== "FORM") return;
    const fields = (
      /** @type {HTMLFormElement} */
      form.elements
    );
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

  // src/parts/account-pages.js
  var { Tether } = (
    /** @type {Window & { Tether?: { __parts: Record<string, unknown> } }} */
    window
  );
  if (!Tether) throw new Error("tether.account-pages.js runs after the Tether script, which loads it");
  Tether.__parts["account-pages"] = account_pages_exports;
})();
