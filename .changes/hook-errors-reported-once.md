- Fix: an error a site hook throws (`formatMoney` for every price, `onLineEnter` for every line)
  reaches `onError` once per page load for each message, instead of on every call.
