- Size: the minified `<script>` files are smaller, with the same behaviour: the build passes them
  through terser after esbuild, and the core no longer bundles the checks on list answers, which
  only the lists part uses. Gzipped, against 0.10.0: the core `tether.min.js` is 29,378 bytes, down
  from 30,459 (28.7 KB from 29.7); account 4,101 (4,430), account pages 6,009 (6,240), diagnose
  5,124 (5,254), analytics 3,060 (3,144), markets 2,618 (2,725), search 2,569 (2,641), lists 2,593
  (2,678), extras 1,462 (1,511). The ES modules and the unminified files are built as before.
