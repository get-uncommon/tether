- Fix (sync Worker): an outage of Webflow or Shopify longer than about 40 minutes no longer makes
  the sync give up on the products it failed to update or delete meanwhile. Before, each cron run
  (every 10 minutes) retried every failed product and gave up after 5 failures, so after a longer
  outage those updates stayed stale, a deletion was lost for good, and a deletion that failed for a
  product already being retried got that product's spent attempts. A failed product is now retried
  on the next run, then 10 and 30 minutes later, then every hour, and given up on (with
  `giving up on product <id>` in the log) once it has failed for a day and at least 5 times; a
  webhook that fails for a product already on the retry list starts its day again. The retry list is
  written only in a run that changes it, so a run with no retry due writes nothing, and a product
  that keeps failing costs about 25 KV writes over its day. Entries only gain fields
  (`failingSince`, `retryAt`), so 0.11.1 still reads the list, and an entry 0.11.1 stored starts its
  day when this release first reads it.
