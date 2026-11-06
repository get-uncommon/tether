// Store HTML (product and collection descriptions): content stays, script goes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { storeHtmlFragment } from '../src/store-html.js';

const { document } = new JSDOM('<!doctype html><body></body>').window;
const render = (html) => {
  const box = document.createElement('div');
  box.append(storeHtmlFragment(html, document));
  return box;
};

test('markup, styles, images, links and video embeds are kept as written', () => {
  const html =
    '<h2 style="color:red">Coffee</h2><p class="lead">Roasted <a href="https://shop.test/x" target="_blank">here</a></p>' +
    '<img src="https://cdn.shopify.com/a.jpg" alt="bag"><img src="data:image/png;base64,AAAA" alt="dot">' +
    '<iframe src="https://www.youtube.com/embed/abc" allowfullscreen></iframe><style>.lead{font-weight:bold}</style>';
  assert.equal(render(html).innerHTML, html.replace('allowfullscreen>', 'allowfullscreen="">'));
});

test('script, handlers and script URLs are removed, however they are written', () => {
  const box = render(
    '<p onclick="steal()">a</p><script>steal()</script><img src=x onerror="steal()">' +
      '<a href="javascript:steal()">b</a><a href=" JaVa&#x09;ScRiPt:steal()">c</a><a href="data:text/html,<script>">d</a>' +
      '<iframe srcdoc="<script>steal()</script>"></iframe><iframe src="javascript:steal()"></iframe>' +
      '<form action="javascript:steal()"><button formaction="javascript:steal()">e</button></form>' +
      '<object data="evil.swf"></object><embed src="evil"><base href="https://evil.test/"><meta http-equiv="refresh">' +
      '<svg><a xlink:href="javascript:steal()"><text>f</text></a><animate attributeName="href" to="javascript:steal()"/></svg>',
  );
  const html = box.innerHTML;
  for (const banned of [
    'steal',
    '<script',
    'onerror',
    'onclick',
    'srcdoc',
    '<object',
    '<embed',
    '<base',
    '<meta',
    '<animate',
    'data:text',
  ]) {
    assert.ok(!html.includes(banned), `${banned} removed: ${html}`);
  }
  assert.equal(box.textContent, 'abcdef', 'the text stays');
});

test('a background image URL cannot end the CSS string or use another scheme', async () => {
  const dom = new JSDOM('<!doctype html><body><div id="bg"></div></body>', { url: 'https://site.test/' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document });
  const { setImage } = await import('../src/dom.js');
  const el = dom.window.document.getElementById('bg');
  setImage(el, 'https://cdn.shopify.com/a.jpg?x=1"); background-color: red; ("');
  assert.doesNotMatch(el.getAttribute('style') ?? '', /background-color/);
  setImage(el, 'javascript:alert(1)');
  assert.doesNotMatch(el.getAttribute('style') ?? '', /javascript/);
});
