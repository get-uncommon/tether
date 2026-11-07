- Fix: switching country through `select[tether-country-select]` or `Tether.setCountry(code)` to a
  country whose `markets.locales` entry has another language shows the country names, in the select
  and in `tether-country-bind="name"`, in that language instead of the previous one.
