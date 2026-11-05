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
    subscriptionAction: () => subscriptionAction,
    subscriptions: () => subscriptions,
    updateProfile: () => updateProfile
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

  // server/src/account-ops.js
  var MONEY = "amount currencyCode";
  var ADDRESS = "id firstName lastName company address1 address2 city province zoneCode zip country countryCode phoneNumber formatted";
  var Q = {
    order: `query TetherOrder($id:ID!){order(id:$id){id name number processedAt cancelledAt financialStatus fulfillmentStatus statusPageUrl requiresShipping totalPrice{${MONEY}}subtotal{${MONEY}}totalShipping{${MONEY}}totalTax{${MONEY}}shippingAddress{${ADDRESS}}billingAddress{${ADDRESS}}lineItems(first:50){nodes{id name title variantTitle quantity sku image{url altText}price{${MONEY}}totalPrice{${MONEY}}suggestedReturnReasonDefinitions(first:10){nodes{id name handle}}}}fulfillments(first:10){nodes{id status createdAt estimatedDeliveryAt latestShipmentStatus trackingInformation{company number url}}}returnInformation{returnableLineItems(first:50){nodes{quantity lineItem{id}}}}returns(first:10){nodes{id status}}}}`,
    addresses: `query TetherAddresses{customer{defaultAddress{id}addresses(first:20){nodes{${ADDRESS}}}}}`,
    subscriptions: `query TetherSubscriptions{customer{subscriptionContracts(first:20,reverse:true){nodes{id status nextBillingDate currencyCode deliveryPrice{${MONEY}}deliveryPolicy{interval intervalCount{count}}lines(first:20){nodes{id name title variantTitle quantity sku currentPrice{${MONEY}}lineDiscountedPrice{${MONEY}}image{url altText}}}upcomingBillingCycles(first:3){nodes{cycleIndex skipped billingAttemptExpectedDate}}}}}}`,
    contract: `query TetherContract($id:ID!){customer{subscriptionContract(id:$id){id status upcomingBillingCycles(first:3){nodes{cycleIndex skipped}}}}}`
  };
  var M = {
    profile: "mutation TetherProfile($input: CustomerUpdateInput!) { customerUpdate(input: $input) { customer { firstName lastName } userErrors { field message } } }",
    addressCreate: `mutation TetherAddressCreate($address:CustomerAddressInput!,$default:Boolean){customerAddressCreate(address:$address,defaultAddress:$default){customerAddress{${ADDRESS}}userErrors{field message}}}`,
    addressUpdate: `mutation TetherAddressUpdate($id:ID!,$address:CustomerAddressInput,$default:Boolean){customerAddressUpdate(addressId:$id,address:$address,defaultAddress:$default){customerAddress{${ADDRESS}}userErrors{field message}}}`,
    addressDelete: "mutation TetherAddressDelete($id: ID!) { customerAddressDelete(addressId: $id) { deletedAddressId userErrors { field message } } }",
    pause: "mutation TetherPause($id: ID!) { subscriptionContractPause(subscriptionContractId: $id) { contract { id status } userErrors { field message } } }",
    resume: "mutation TetherResume($id: ID!) { subscriptionContractActivate(subscriptionContractId: $id) { contract { id status } userErrors { field message } } }",
    cancel: "mutation TetherCancel($id: ID!) { subscriptionContractCancel(subscriptionContractId: $id) { contract { id status } userErrors { field message } } }",
    skip: "mutation TetherSkip($input: SubscriptionBillingCycleInput!) { subscriptionBillingCycleSkip(billingCycleInput: $input) { billingCycle { cycleIndex skipped } userErrors { field message } } }",
    unskip: "mutation TetherUnskip($input: SubscriptionBillingCycleInput!) { subscriptionBillingCycleUnskip(billingCycleInput: $input) { billingCycle { cycleIndex skipped } userErrors { field message } } }",
    returnRequest: "mutation TetherReturn($orderId: ID!, $lines: [RequestedLineItemInput!]!) { orderRequestReturn(orderId: $orderId, requestedLineItems: $lines) { return { id status } userErrors { field message } } }"
  };
  var InputError = class extends Error {
  };
  var gid = (type) => new RegExp(`^gid://shopify/${type}/\\d+(\\?[\\w=&.-]{1,80})?$`);
  var IDS = {
    Order: gid("Order"),
    CustomerAddress: gid("CustomerAddress"),
    SubscriptionContract: gid("SubscriptionContract"),
    LineItem: gid("LineItem"),
    ReturnReasonDefinition: gid("ReturnReasonDefinition")
  };
  function idOf(type, value) {
    const v = /^\d{1,20}$/.test(String(value ?? "")) ? `gid://shopify/${type}/${value}` : String(value ?? "");
    if (!IDS[type].test(v)) throw new InputError(`${type} id`);
    return v;
  }
  var text = (v, max = 255) => {
    if (v == null || v === "") return void 0;
    if (typeof v !== "string" && typeof v !== "number") throw new InputError("text");
    const s = String(v).replace(/[\u0000-\u001f\u007f]/g, "").trim();
    if (s.length > max) throw new InputError("too long");
    return s;
  };
  var ADDRESS_FIELDS = ["firstName", "lastName", "company", "address1", "address2", "city", "zip", "zoneCode", "phoneNumber"];
  function addressInput(a = {}, { clear = false } = {}) {
    if (!a || typeof a !== "object" || Array.isArray(a)) throw new InputError("address");
    const out = {};
    ADDRESS_FIELDS.forEach((k) => {
      const v = text(a[k]);
      if (v !== void 0) out[k] = v;
      else if (clear && k in a && (a[k] === "" || a[k] === null)) out[k] = "";
    });
    if (a.countryCode != null && a.countryCode !== "") {
      const c = String(a.countryCode).toUpperCase();
      if (!/^[A-Z]{2}$/.test(c)) throw new InputError("countryCode");
      out.countryCode = c;
    }
    return out;
  }
  var userErrors = (payload) => {
    const errs = payload?.userErrors || [];
    if (errs.length) {
      const e = new InputError(errs.map((x) => x.message).join(" | "));
      e.userErrors = errs;
      throw e;
    }
    return payload;
  };
  var ops = {
    async order(ask, { id }) {
      const data = await ask(Q.order, { id: idOf("Order", id) });
      return { order: data?.order || null };
    },
    async profile(ask, { firstName, lastName }) {
      const input = {};
      if (firstName !== void 0) input.firstName = text(firstName, 100) ?? "";
      if (lastName !== void 0) input.lastName = text(lastName, 100) ?? "";
      if (!Object.keys(input).length) throw new InputError("nothing to change");
      const p = userErrors((await ask(M.profile, { input }))?.customerUpdate);
      return { customer: p.customer };
    },
    async addresses(ask) {
      const c = (await ask(Q.addresses, {}))?.customer;
      const def = c?.defaultAddress?.id || null;
      return { addresses: (c?.addresses?.nodes || []).map((a) => ({ ...a, isDefault: a.id === def })) };
    },
    async saveAddress(ask, { id, address, isDefault }) {
      const a = addressInput(address || {}, { clear: Boolean(id) });
      const def = isDefault === true ? true : void 0;
      const p = id ? userErrors((await ask(M.addressUpdate, { id: idOf("CustomerAddress", id), address: Object.keys(a).length ? a : null, default: def ?? null }))?.customerAddressUpdate) : userErrors((await ask(M.addressCreate, { address: a, default: def ?? false }))?.customerAddressCreate);
      return { address: p.customerAddress };
    },
    async deleteAddress(ask, { id }) {
      const p = userErrors((await ask(M.addressDelete, { id: idOf("CustomerAddress", id) }))?.customerAddressDelete);
      return { deleted: p.deletedAddressId };
    },
    async subscriptions(ask) {
      return { subscriptions: (await ask(Q.subscriptions, {}))?.customer?.subscriptionContracts?.nodes || [] };
    },
    async subscription(ask, { id, action }) {
      if (!["pause", "resume", "skip", "unskip", "cancel"].includes(action)) throw new InputError("action");
      const contractId = idOf("SubscriptionContract", id);
      const contract = (await ask(Q.contract, { id: contractId }))?.customer?.subscriptionContract;
      if (!contract) {
        const e = new InputError("not found");
        e.status = 404;
        throw e;
      }
      if (action === "skip" || action === "unskip") {
        const cycles = contract.upcomingBillingCycles?.nodes || [];
        const cycle = action === "skip" ? cycles.find((c) => !c.skipped) : cycles.find((c) => c.skipped);
        if (!cycle) throw new InputError(action === "skip" ? "no upcoming delivery to skip" : "nothing skipped");
        const p2 = userErrors((await ask(M[action], { input: { contractId, selector: { index: cycle.cycleIndex } } }))?.[action === "skip" ? "subscriptionBillingCycleSkip" : "subscriptionBillingCycleUnskip"]);
        return { billingCycle: p2.billingCycle };
      }
      const name = { pause: "subscriptionContractPause", resume: "subscriptionContractActivate", cancel: "subscriptionContractCancel" }[action];
      const p = userErrors((await ask(M[action], { id: contractId }))?.[name]);
      return { contract: p.contract };
    },
    async requestReturn(ask, { orderId, lines: lines2 }) {
      const oid = idOf("Order", orderId);
      if (!Array.isArray(lines2) || !lines2.length || lines2.length > 50) throw new InputError("lines");
      const requested = lines2.map((l) => {
        const q = Number(l?.quantity);
        if (!Number.isInteger(q) || q < 1 || q > 1e3) throw new InputError("quantity");
        const out = { lineItemId: idOf("LineItem", l.lineItemId), quantity: q };
        if (l.reasonId) out.returnReasonDefinitionId = idOf("ReturnReasonDefinition", l.reasonId);
        const note = text(l.note, 300);
        if (note) out.customerNote = note;
        return out;
      });
      const p = userErrors((await ask(M.returnRequest, { orderId: oid, lines: requested }))?.orderRequestReturn);
      return { return: p.return };
    }
  };

  // src/account-pages.js
  var ctx = null;
  var bound = false;
  function setup(c) {
    ctx = c;
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
  var ROUTE = {
    order: (i) => ["GET", `/order?id=${encodeURIComponent(i.id)}`],
    addresses: () => ["GET", "/addresses"],
    subscriptions: () => ["GET", "/subscriptions"],
    profile: () => ["POST", "/profile"],
    saveAddress: () => ["POST", "/address"],
    deleteAddress: () => ["POST", "/address/delete"],
    subscription: () => ["POST", "/subscription"],
    requestReturn: () => ["POST", "/return"]
  };
  async function run(name, input = {}) {
    const { server, serverFetch, query } = ctx;
    if (server()) {
      const [method, path] = ROUTE[name](input);
      const data = await serverFetch(path, method === "POST" ? { method, body: input } : {});
      if (data.loggedIn === false) throw new TetherError("Not logged in", { code: "NOT_LOGGED_IN", status: 401 });
      return data;
    }
    try {
      return await ops[name]((q, v) => query(q, v), input);
    } catch (err) {
      if (err instanceof InputError) throw new TetherError(err.message, { code: "INVALID", userErrors: err.userErrors });
      throw err;
    }
  }
  var changed = (what) => {
    ctx.reset();
    emit("account-updated", { what });
  };
  var order = (id) => run("order", { id }).then((r) => r.order);
  var updateProfile = ({ firstName, lastName } = {}) => run("profile", { firstName, lastName }).then((r) => {
    changed("profile");
    return r.customer;
  });
  var addresses = () => run("addresses").then((r) => r.addresses);
  var saveAddress = (address, { id, isDefault } = {}) => run("saveAddress", { id, address, isDefault }).then((r) => {
    changed("addresses");
    return r.address;
  });
  var deleteAddress = (id) => run("deleteAddress", { id }).then((r) => {
    changed("addresses");
    return r.deleted;
  });
  var subscriptions = () => run("subscriptions").then((r) => r.subscriptions);
  var subscriptionAction = (id, action) => run("subscription", { id, action }).then((r) => {
    changed("subscriptions");
    return r;
  });
  var requestReturn = (orderId, lines2) => run("requestReturn", { orderId, lines: lines2 }).then((r) => {
    changed("orders");
    return r.return;
  });
  var lower = (v) => v ? String(v).toLowerCase().replace(/_/g, " ") : "";
  var lines = (a) => (a?.formatted || []).join(", ");
  var showIn = (root, name, conds) => qsa(root, sel(name)).forEach((el) => {
    const k = get(el, name);
    if (k in conds) show(el, Boolean(conds[k]));
  });
  var showGlobal = (root, conds) => showIn(root, "show", conds);
  function fillLines(box, items, returnable = null) {
    repeat(box, items, (row, l) => {
      const can = returnable ? returnable.get(l.id) || 0 : 0;
      row.dataset.tetherLine = l.id;
      qsa(row, sel("order-line")).concat(row.matches(sel("order-line")) ? [row] : []).forEach((el) => {
        const k = get(el, "order-line");
        if (k === "image") {
          if (l.image) setImage(el, l.image.url, l.image.altText || l.title);
          return;
        }
        const v = { title: l.title || l.name, "variant-title": l.variantTitle || "", quantity: String(l.quantity), price: l.price ? formatMoney(l.price) : "", total: l.totalPrice ? formatMoney(l.totalPrice) : "", sku: l.sku || "", returnable: String(can) }[k];
        if (v != null) setText(el, v);
      });
      showIn(row, "order-line-show", { returnable: can > 0 });
      qsa(row, sel("return-quantity")).forEach((input) => {
        input.max = String(can);
        input.min = "0";
        if (!input.value) input.value = "0";
        input.disabled = can < 1;
      });
      qsa(row, `select${sel("return-reason")}`).forEach((select) => {
        const reasons = l.suggestedReturnReasonDefinitions?.nodes || [];
        if (select.dataset.tetherFilled !== l.id) {
          select.dataset.tetherFilled = l.id;
          reasons.forEach((r) => select.appendChild(new Option(r.name, r.id)));
        }
      });
    });
  }
  var SCOPE = { order: sel("order") };
  async function renderOrder(el) {
    const raw = get(el, "order") || "";
    const key = raw.startsWith("url:") ? new URL(window.location.href).searchParams.get(raw.slice(4) || "id") : raw;
    const state = (s) => el.setAttribute(attr("order-state"), s);
    if (!key) {
      state("not-found");
      showIn(el, "order-show", { "not-found": true });
      return;
    }
    state("loading");
    showIn(el, "order-show", { loading: true, ready: false, "not-found": false, error: false });
    let o;
    try {
      o = await order(key);
    } catch (err) {
      reportError(err, "order");
      state("error");
      showIn(el, "order-show", { loading: false, error: true });
      return;
    }
    if (!o) {
      state("not-found");
      showIn(el, "order-show", { loading: false, "not-found": true });
      return;
    }
    el.dataset.tetherOrderId = o.id;
    const returnable = new Map((o.returnInformation?.returnableLineItems?.nodes || []).map((r) => [r.lineItem?.id, r.quantity]));
    const ships = o.fulfillments?.nodes || [];
    qsa(el, sel("order-bind")).forEach((b) => {
      const k = get(b, "order-bind");
      if (k === "url") {
        if (https(o.statusPageUrl)) b.setAttribute("href", o.statusPageUrl);
        return;
      }
      const v = {
        name: o.name,
        date: date(o.processedAt),
        total: formatMoney(o.totalPrice),
        subtotal: o.subtotal ? formatMoney(o.subtotal) : "",
        shipping: o.totalShipping ? formatMoney(o.totalShipping) : "",
        tax: o.totalTax ? formatMoney(o.totalTax) : "",
        status: lower(o.financialStatus),
        fulfillment: lower(o.fulfillmentStatus),
        "shipping-address": lines(o.shippingAddress),
        "billing-address": lines(o.billingAddress),
        items: (o.lineItems?.nodes || []).map((l) => `${l.quantity}\xD7 ${l.title || l.name}`).join(", "),
        cancelled: o.cancelledAt ? date(o.cancelledAt) : ""
      }[k];
      if (v != null) setText(b, v);
    });
    qsa(el, sel("order-lines")).forEach((box) => fillLines(box, o.lineItems?.nodes || [], returnable));
    qsa(el, sel("order-fulfillments")).forEach((box) => repeat(box, ships, (row, f) => {
      const t = f.trackingInformation?.[0] || {};
      qsa(row, sel("fulfillment-bind")).concat(row.matches(sel("fulfillment-bind")) ? [row] : []).forEach((b) => {
        const k = get(b, "fulfillment-bind");
        if (k === "url") {
          const ok = https(t.url);
          if (ok) b.setAttribute("href", t.url);
          show(b, ok);
          return;
        }
        const v = { status: lower(f.latestShipmentStatus || f.status), date: date(f.createdAt), eta: f.estimatedDeliveryAt ? date(f.estimatedDeliveryAt) : "", company: t.company || "", number: t.number || "" }[k];
        if (v != null) setText(b, v);
      });
    }));
    showIn(el, "order-show", {
      loading: false,
      ready: true,
      error: false,
      "not-found": false,
      cancelled: Boolean(o.cancelledAt),
      shipped: ships.length > 0,
      returnable: [...returnable.values()].some((q) => q > 0),
      "has-returns": el.dataset.tetherReturned !== "1" && (o.returns?.nodes || []).length > 0,
      "return-requested": el.dataset.tetherReturned === "1"
    });
    state("ready");
  }
  async function renderProfile(form) {
    const c = await ctx.customer().catch(() => null);
    if (!c) return;
    ["firstName", "lastName"].forEach((n) => {
      const i = form.elements?.[n];
      if (i && !i.dataset.tetherTouched) i.value = c[n] || "";
    });
  }
  var addressCache = null;
  async function renderAddresses(root) {
    const boxes = qsa(root, sel("addresses"));
    if (!boxes.length) return;
    showGlobal(root, { "addresses-loading": true, "addresses-empty": false });
    let list;
    try {
      list = addressCache = await addresses();
    } catch (err) {
      reportError(err, "addresses");
      showGlobal(root, { "addresses-loading": false, "addresses-error": true });
      return;
    }
    showGlobal(root, { "addresses-loading": false, "addresses-empty": list.length === 0, "addresses-error": false });
    boxes.forEach((box) => repeat(box, list, (row, a) => {
      row.dataset.tetherAddress = a.id;
      qsa(row, sel("address-bind")).concat(row.matches(sel("address-bind")) ? [row] : []).forEach((b) => {
        const v = { formatted: lines(a), name: [a.firstName, a.lastName].filter(Boolean).join(" "), company: a.company || "", address1: a.address1 || "", address2: a.address2 || "", city: a.city || "", zip: a.zip || "", province: a.province || "", country: a.country || "", phone: a.phoneNumber || "" }[get(b, "address-bind")];
        if (v != null) setText(b, v);
      });
      showIn(row, "address-show", { default: a.isDefault, "not-default": !a.isDefault });
    }));
  }
  var SUB_ACTIONS = ["pause", "resume", "skip", "unskip", "cancel"];
  function subConds(c) {
    const next = c.upcomingBillingCycles?.nodes?.[0];
    const st = c.status;
    return {
      active: st === "ACTIVE",
      paused: st === "PAUSED",
      cancelled: st === "CANCELLED",
      expired: st === "EXPIRED",
      failed: st === "FAILED",
      skipped: Boolean(next?.skipped),
      "can-pause": st === "ACTIVE",
      "can-resume": st === "PAUSED" || st === "FAILED",
      "can-skip": st === "ACTIVE" && Boolean(next) && !next.skipped,
      "can-unskip": st === "ACTIVE" && Boolean(next?.skipped),
      "can-cancel": st === "ACTIVE" || st === "PAUSED" || st === "FAILED"
    };
  }
  async function renderSubscriptions(root) {
    const boxes = qsa(root, sel("subscriptions"));
    if (!boxes.length) return;
    showGlobal(root, { "subscriptions-loading": true, "subscriptions-empty": false });
    let list;
    try {
      list = await subscriptions();
    } catch (err) {
      reportError(err, "subscriptions");
      showGlobal(root, { "subscriptions-loading": false, "subscriptions-error": true });
      return;
    }
    showGlobal(root, { "subscriptions-loading": false, "subscriptions-empty": list.length === 0, "subscriptions-error": false });
    boxes.forEach((box) => repeat(box, list, (row, c) => {
      row.dataset.tetherSubscription = c.id;
      row.setAttribute(attr("subscription-status"), lower(c.status));
      const ls = c.lines?.nodes || [];
      const n = c.deliveryPolicy?.intervalCount?.count || 1;
      const unit = lower(c.deliveryPolicy?.interval);
      const total = ls.reduce((sum, l) => sum + parseFloat(l.lineDiscountedPrice?.amount || 0), 0);
      qsa(row, sel("subscription-bind")).forEach((b) => {
        const k = get(b, "subscription-bind");
        const v = {
          status: lower(c.status),
          next: c.nextBillingDate ? date(c.nextBillingDate) : "",
          interval: unit ? n === 1 ? unit : `${n} ${unit}s` : "",
          products: ls.map((l) => `${l.quantity}\xD7 ${l.title}`).join(", "),
          total: ls.length ? formatMoney({ amount: String(total), currencyCode: c.currencyCode }) : "",
          delivery: c.deliveryPrice ? formatMoney(c.deliveryPrice) : ""
        }[k];
        if (v != null) setText(b, v);
      });
      qsa(row, sel("subscription-lines")).forEach((lb) => repeat(lb, ls, (lr, l) => {
        qsa(lr, sel("subscription-line")).concat(lr.matches(sel("subscription-line")) ? [lr] : []).forEach((b) => {
          const k = get(b, "subscription-line");
          if (k === "image") {
            if (l.image) setImage(b, l.image.url, l.image.altText || l.title);
            return;
          }
          const v = { title: l.title, "variant-title": l.variantTitle || "", quantity: String(l.quantity), price: formatMoney(l.currentPrice) }[k];
          if (v != null) setText(b, v);
        });
      }));
      const conds = subConds(c);
      showIn(row, "subscription-show", conds);
      qsa(row, sel("subscription-action")).forEach((btn) => {
        const a = get(btn, "subscription-action");
        const ok = conds[`can-${a}`];
        btn.disabled = !ok;
        btn.classList.toggle("is-disabled", !ok);
      });
    }));
  }
  async function renderPages(root = document) {
    if (!bound) {
      bound = true;
      bindPages();
    }
    await Promise.all([
      ...qsa(root, sel("order")).map((el) => renderOrder(el)),
      ...qsa(root, sel("profile-form")).map((f) => renderProfile(f)),
      renderAddresses(root),
      renderSubscriptions(root)
    ]);
  }
  var fieldsOf = (form) => Object.fromEntries([...form.elements].filter((i) => i.name && i.type !== "submit" && i.type !== "button" && i.type !== "checkbox").map((i) => [i.name, i.value]));
  async function act(el, fn, { error } = {}) {
    if (el.getAttribute("aria-busy") === "true") return void 0;
    el.classList.add("is-busy");
    el.setAttribute("aria-busy", "true");
    el.setAttribute(attr("form-state"), "pending");
    qsa(el, sel("form-error")).forEach((e) => setText(e, ""));
    try {
      const out = await fn();
      el.setAttribute(attr("form-state"), "saved");
      return out;
    } catch (err) {
      el.setAttribute(attr("form-state"), "error");
      const msg = err?.userErrors?.map((u) => u.message).join(" ") || err?.message || "Something went wrong";
      qsa(el, sel("form-error")).forEach((e) => setText(e, msg.replace(/^Customer accounts: /, "")));
      if (error) reportError(err, error);
      return void 0;
    } finally {
      el.classList.remove("is-busy");
      el.removeAttribute("aria-busy");
    }
  }
  function bindPages() {
    document.addEventListener("submit", (e) => {
      const f = e.target;
      if (f.matches?.(sel("profile-form"))) {
        e.preventDefault();
        act(f, async () => {
          await updateProfile(fieldsOf(f));
          await ctx.bindCustomer?.(document);
        });
      } else if (f.matches?.(sel("address-form"))) {
        e.preventDefault();
        const id = f.dataset.tetherAddressId || void 0;
        const isDefault = Boolean(f.elements?.isDefault?.checked);
        act(f, async () => {
          await saveAddress(fieldsOf(f), { id, isDefault });
          f.reset();
          delete f.dataset.tetherAddressId;
          await renderAddresses(document);
        });
      }
    }, true);
    document.addEventListener("input", (e) => {
      if (e.target.closest?.(sel("profile-form"))) e.target.dataset.tetherTouched = "1";
    });
    document.addEventListener("click", (e) => {
      const t = e.target;
      const row = t.closest?.("[data-tether-address]");
      const confirmOk = (btn2) => {
        const q = get(btn2, "confirm");
        return !q || window.confirm(q);
      };
      let btn;
      if ((btn = t.closest?.(sel("address-delete"))) && row) {
        e.preventDefault();
        if (confirmOk(btn)) act(row, async () => {
          await deleteAddress(row.dataset.tetherAddress);
          await renderAddresses(document);
        });
      } else if ((btn = t.closest?.(sel("address-default"))) && row) {
        e.preventDefault();
        act(row, async () => {
          await saveAddress(null, { id: row.dataset.tetherAddress, isDefault: true });
          await renderAddresses(document);
        });
      } else if ((btn = t.closest?.(sel("address-edit"))) && row) {
        e.preventDefault();
        const a = (addressCache || []).find((x) => x.id === row.dataset.tetherAddress);
        const f = document.querySelector(sel("address-form"));
        if (a && f) {
          f.dataset.tetherAddressId = a.id;
          [...f.elements].forEach((i) => {
            if (i.name && i.name in a) i.value = a[i.name] ?? "";
            if (i.name === "isDefault") i.checked = a.isDefault;
          });
          f.scrollIntoView?.({ block: "nearest" });
        }
      } else if (btn = t.closest?.(sel("address-new"))) {
        const f = document.querySelector(sel("address-form"));
        if (f) {
          f.reset();
          delete f.dataset.tetherAddressId;
        }
      } else if (btn = t.closest?.(sel("subscription-action"))) {
        e.preventDefault();
        const sub = btn.closest("[data-tether-subscription]");
        const a = get(btn, "subscription-action");
        if (!sub || !SUB_ACTIONS.includes(a) || btn.disabled || !confirmOk(btn)) return;
        const id = sub.dataset.tetherSubscription;
        sub.setAttribute(attr("subscription-state"), "pending");
        act(sub, async () => {
          await subscriptionAction(id, a);
          await renderSubscriptions(document);
        }).then(() => {
          const state = sub.getAttribute(attr("form-state")) === "error" ? "error" : "done";
          qsa(document, "[data-tether-subscription]").filter((r) => r === sub || r.dataset.tetherSubscription === id).forEach((r) => r.setAttribute(attr("subscription-state"), state));
        });
      } else if (btn = t.closest?.(sel("order-return"))) {
        e.preventDefault();
        const scope = btn.closest(SCOPE.order);
        if (!scope?.dataset.tetherOrderId) return;
        const req = qsa(scope, "[data-tether-line]").map((r) => ({
          lineItemId: r.dataset.tetherLine,
          quantity: parseInt(r.querySelector(sel("return-quantity"))?.value || "0", 10),
          reasonId: r.querySelector(sel("return-reason"))?.value || void 0,
          note: r.querySelector(sel("return-note"))?.value || void 0
        })).filter((l) => l.quantity > 0);
        if (!req.length || !confirmOk(btn)) return;
        act(scope, async () => {
          await requestReturn(scope.dataset.tetherOrderId, req);
          scope.dataset.tetherReturned = "1";
          await renderOrder(scope);
        });
      }
    });
  }

  // src/parts/account-pages.js
  window.Tether.__parts["account-pages"] = account_pages_exports;
})();
