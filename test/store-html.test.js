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

const SANDBOX = 'sandbox="allow-scripts allow-same-origin allow-popups allow-presentation"';
const REFERRER = 'referrerpolicy="strict-origin-when-cross-origin"';

test('markup, inline styles, images, links and video embeds are kept as written', () => {
  const html =
    '<h2 style="color:red">Coffee</h2><p class="lead">Roasted <a href="https://shop.test/x">here</a></p>' +
    '<img src="https://cdn.shopify.com/a.jpg" alt="bag"><img src="data:image/png;base64,AAAA" alt="dot">' +
    '<iframe src="https://www.youtube.com/embed/abc" allowfullscreen=""></iframe>';
  const expected = html.replace('allowfullscreen="">', `allowfullscreen="" ${SANDBOX} ${REFERRER}>`);
  assert.equal(render(html).innerHTML, expected);
});

test('every content element is kept with its attributes', () => {
  const html =
    '<h1>a</h1><h3 id="x" lang="de" dir="ltr" title="t" aria-label="l">b</h3><h4>c</h4><h5>d</h5><h6>e</h6>' +
    '<div align="center"><span>f</span><br><hr></div><blockquote cite="https://shop.test/q">g</blockquote>' +
    '<pre><code>h</code></pre><p><strong>i</strong><em>j</em><b>k</b><i>l</i><u>m</u><s>n</s><small>o</small>' +
    '<sub>p</sub><sup>q</sup></p><ul><li>r</li></ul><ol start="2" type="a" reversed=""><li value="3">s</li></ol>' +
    '<dl><dt>t</dt><dd>u</dd></dl>' +
    '<table border="1" cellpadding="2" cellspacing="0" width="100%"><caption>v</caption><colgroup span="2"><col span="1">' +
    '</colgroup><thead><tr><th colspan="2" scope="col">w</th></tr></thead><tbody><tr><td rowspan="1" valign="top">x</td>' +
    '</tr></tbody><tfoot><tr><td>y</td></tr></tfoot></table>' +
    '<figure><picture><source srcset="https://cdn.shopify.com/a.webp" type="image/webp" media="(min-width: 1px)">' +
    '<img src="https://cdn.shopify.com/a.jpg" srcset="https://cdn.shopify.com/a.jpg 2x" sizes="50vw" loading="lazy" ' +
    'decoding="async" width="10" height="10"></picture><figcaption>z</figcaption></figure>' +
    '<video src="https://cdn.shopify.com/v.mp4" poster="https://cdn.shopify.com/p.jpg" controls="" muted="" loop="" ' +
    'playsinline="" preload="none"><source src="https://cdn.shopify.com/v.webm" type="video/webm"></video>';
  assert.equal(render(html).innerHTML, html);
});

test('a link that opens a new tab gets no handle on the page and keeps its own rel', () => {
  const box = render(
    '<a href="https://shop.test/" target="_blank" rel="nofollow">x</a><a href="/y" target="_self">y</a>',
  );
  assert.equal(
    box.innerHTML,
    '<a href="https://shop.test/" target="_blank" rel="nofollow noopener noreferrer">x</a><a href="/y" target="_self">y</a>',
  );
});

test('embeds load only over https and always sandboxed, whatever sandbox they were written with', () => {
  const box = render(
    '<iframe src="http://video.test/e"></iframe><iframe src="/embed"></iframe><iframe></iframe>' +
      '<iframe src="https://player.vimeo.com/video/1" sandbox="allow-top-navigation allow-forms" allow="autoplay"></iframe>',
  );
  assert.equal(box.querySelectorAll('iframe').length, 1);
  const frame = box.querySelector('iframe');
  assert.equal(frame.getAttribute('sandbox'), 'allow-scripts allow-same-origin allow-popups allow-presentation');
  assert.equal(frame.getAttribute('referrerpolicy'), 'strict-origin-when-cross-origin');
  assert.equal(frame.getAttribute('allow'), 'autoplay');
});

test('page-wide styles and forms are removed; the text a form shows stays', () => {
  const box = render(
    '<style>body{display:none}</style><form action="https://evil.test/"><label>Name <input name="password"></label>' +
      '<button formaction="https://evil.test/">Send</button><select><option>o</option></select>' +
      '<textarea>t</textarea></form>',
  );
  assert.equal(box.innerHTML, 'Name Send');
});

test('elements and attributes outside the allow-list leave only their content', () => {
  const box = render(
    '<section data-x="1" tether-product="coffee" name="TETHER_CONFIG"><font color="red">kept</font></section>' +
      '<p onclick="steal()" tether-bind="price" data-barba="x">text</p><link rel="stylesheet" href="https://evil.test/">',
  );
  assert.equal(box.innerHTML, 'kept<p>text</p>');
});

test('script, handlers and script URLs are removed, however they are written', () => {
  const box = render(
    '<p onclick="steal()">a</p><script>steal()</script><img src=x onerror="steal()">' +
      '<a href="javascript:steal()">b</a><a href=" JaVa&#x09;ScRiPt:steal()">c</a><a href="data:text/html,<script>">d</a>' +
      '<a href="\u0001\u001fjavascript:steal()">e</a>' +
      '<iframe srcdoc="<script>steal()</script>"></iframe><iframe src="javascript:steal()"></iframe>' +
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
    '<svg',
    '<animate',
    'data:text',
    'javascript',
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
