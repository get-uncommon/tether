- Fix: a site hook whose errors carry data in their message (an amount, an id) no longer makes
  Tether remember every message for the page's lifetime: past 100 messages a new one is reported
  each time.
