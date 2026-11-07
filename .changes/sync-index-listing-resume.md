- Fix (sync Worker): a Webflow item index listing that a run stopped is continued for a day, or for
  `match.indexTtlMinutes` when that is longer. Before, it was continued only within the TTL, so with
  a short `match.indexTtlMinutes` a collection too big for one run started again at its first page
  each run, never finished, and every create waited on it. `/check` warns when
  `match.indexTtlMinutes` is under 60 minutes.
