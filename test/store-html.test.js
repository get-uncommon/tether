import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { storeHtmlFragment } from '../src/store-html.ts';
import { find } from './fixtures.js';

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
    '<h2 style="color: red;">Coffee</h2><p style="margin: 0px 0px 1em;">Roasted <a href="https://shop.test/x">here</a></p>' +
    '<img src="https://cdn.shopify.com/a.jpg" alt="bag"><img src="data:image/png;base64,AAAA" alt="dot">' +
    '<iframe src="https://www.youtube.com/embed/abc" allowfullscreen=""></iframe>';
  const expected = html.replace('allowfullscreen="">', `allowfullscreen="" ${SANDBOX} ${REFERRER}>`);
  assert.equal(render(html).innerHTML, expected);
});

test('every text, list, table and media element is kept with the attributes the fixture gives it', () => {
  const html =
    '<h1>a</h1><h3 lang="de" dir="ltr" title="t" aria-label="l">b</h3><h4>c</h4><h5>d</h5><h6>e</h6>' +
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

test('embeds over http, relative or without a src are removed; the https one is sandboxed whatever it was written with', () => {
  const box = render(
    '<iframe src="http://video.test/e"></iframe><iframe src="/embed"></iframe><iframe></iframe>' +
      '<iframe src="https://player.vimeo.com/video/1" sandbox="allow-top-navigation allow-forms" allow="autoplay"></iframe>',
  );
  assert.equal(box.querySelectorAll('iframe').length, 1);
  const frame = box.querySelector('iframe');
  assert.ok(frame);
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
  const { setImage } = await import('../src/dom.ts');
  const el = find('#bg', dom.window.document);
  setImage(el, 'https://cdn.shopify.com/a.jpg?x=1"); background-color: red; ("');
  assert.doesNotMatch(el.getAttribute('style') ?? '', /background-color/);
  setImage(el, 'javascript:alert(1)');
  assert.doesNotMatch(el.getAttribute('style') ?? '', /javascript/);
});

test("an id is removed, so a description cannot clobber window.<id> or the site's own ids", () => {
  assert.equal(
    render('<div id="cart-drawer" title="x">a</div><a id="TETHER_CONFIG">b</a>').innerHTML,
    '<div title="x">a</div><a>b</a>',
  );
});

test("a class is removed, so a description cannot borrow the site's overlay or modal classes", () => {
  assert.equal(
    render('<div class="modal-overlay w--open"><a href="https://evil.test/login">Session expired, log in</a></div>')
      .innerHTML,
    '<div><a href="https://evil.test/login">Session expired, log in</a></div>',
  );
});

test('transforms, motion paths, negative margins and viewport sizes are removed; spacing and sizes in the flow stay', () => {
  const box = render(
    '<div style="transform: translateY(-100vh); width: 100vw; height: 100vh; background: #fff">a</div>' +
      '<div style="translate: 0 -500px; rotate: 1deg; scale: 2; offset-path: ray(45deg); color: blue">b</div>' +
      '<p style="margin-top: -2000px; margin: 0 -50px; padding: 8px">c</p>' +
      '<p style="margin: 1em auto; width: 50%; max-width: 600px; min-height: 10dvh">d</p>',
  );
  const styles = [...box.children].map((element) => element.getAttribute('style'));
  assert.deepEqual(styles, [
    'background: rgb(255, 255, 255);',
    'color: blue;',
    'padding: 8px;',
    'margin: 1em auto; width: 50%; max-width: 600px;',
  ]);
});

test('inline styles keep their look but cannot place content over the page or fetch anything', () => {
  const box = render(
    '<p style="color: red; position: fixed; inset: 0; top: 0; left: 0; z-index: 2147483647; font-weight: bold">a</p>' +
      '<p style="background-image: url(https://evil.test/track.gif); margin: 4px">b</p>' +
      '<p style="position: absolute; top: 0">c</p><p style="width: expression(alert(1))">d</p>',
  );
  const styles = [...box.querySelectorAll('p')].map((paragraph) => paragraph.getAttribute('style'));
  assert.deepEqual(styles, ['color: red; font-weight: bold;', 'margin: 4px;', null, null]);
});

test('an outline or shadow large enough to paint over the page is removed; the link it framed stays', () => {
  const box = render(
    '<p style="outline: 5000px solid #fff; box-shadow: 0 0 0 9999px #fff; font-size: 40px">Session expired. ' +
      '<a href="https://evil.example/login">Log in</a></p>',
  );
  assert.equal(
    box.innerHTML,
    '<p style="font-size: 40px;">Session expired. <a href="https://evil.example/login">Log in</a></p>',
  );
});

test('outlines, shadows, filters, outsets and text decoration are removed past a few dozen pixels or in any unit but px', () => {
  const declarations = [
    'outline-offset: 5000px',
    'outline: 5e3px solid red',
    'outline: 2em solid red',
    'box-shadow: 0 0 0 calc(1px * 9999) #fff',
    'box-shadow: 0 0 0 var(--spread) #fff',
    'box-shadow: -41px 0 #000',
    'text-shadow: 5000px 0 #000',
    'filter: drop-shadow(5000px 0 0 red)',
    'filter: blur(1rem)',
    'border-image-outset: 5000px',
    'border-image: linear-gradient(red, red) 1 / 1 / 5000px',
    'mask-border-outset: 5000px',
    'text-underline-offset: 5000px',
    'text-decoration-thickness: 5000px',
    '-webkit-text-stroke: 5000px red',
  ];
  const box = render(declarations.map((declaration) => `<p style="${declaration}; color: red">x</p>`).join(''));
  assert.deepEqual(
    [...box.children].map((element) => element.getAttribute('style')),
    declarations.map(() => 'color: red;'),
  );
});

test('a modest outline, shadow or filter on an image or a callout looks as written', () => {
  const styles = [
    'outline: 2px solid #c00; outline-offset: 4px;',
    'box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2), inset 0 0 0 1px #eee;',
    'text-shadow: 1px 1px 2px #000;',
    'filter: drop-shadow(0 2px 8px #0003) hue-rotate(90deg) brightness(110%);',
    'text-decoration: underline; text-underline-offset: 3px; text-decoration-thickness: 2px;',
    'box-shadow: -40px 0 #000;',
  ];
  const box = render(styles.map((style) => `<img src="https://cdn.shopify.com/a.png" style="${style}">`).join(''));
  assert.deepEqual(
    [...box.children].map((element) => element.getAttribute('style')),
    styles,
  );
});

const site = new JSDOM('<!doctype html><body></body>', { url: 'https://shop.test/products/coffee' }).window.document;
const renderOnSite = (html) => {
  const box = site.createElement('div');
  box.append(storeHtmlFragment(html, site));
  return box;
};

test("an embed from the site's own origin is removed, however its src is written", () => {
  const box = renderOnSite(
    '<iframe src="https://shop.test/pages/x"></iframe><iframe src="/pages/x"></iframe><iframe src="//shop.test/x"></iframe>' +
      '<iframe src="https://www.youtube.com/embed/abc"></iframe>',
  );
  assert.deepEqual(
    [...box.querySelectorAll('iframe')].map((frame) => frame.getAttribute('src')),
    ['https://www.youtube.com/embed/abc'],
  );
});

test('embeds are kept only from the built-in video players and the origins the site adds', () => {
  const players = [
    'https://www.youtube.com/embed/a',
    'https://www.youtube-nocookie.com/embed/a',
    'https://player.vimeo.com/video/1',
    'https://www.loom.com/embed/a',
    'https://fast.wistia.net/embed/iframe/a',
  ];
  const others = ['https://evil.test/login', 'https://youtube.com.evil.test/embed/a', 'https://vimeo.com/1'];
  const html = [...players, ...others, 'https://video.test/e', 'https://shop.test/e']
    .map((src) => `<iframe src="${src}" width="560" height="315"></iframe>`)
    .join('');
  const box = site.createElement('div');
  box.append(storeHtmlFragment(html, site, ['https://video.test', 'https://shop.test']));
  assert.deepEqual(
    [...box.querySelectorAll('iframe')].map((frame) => frame.getAttribute('src')),
    [...players, 'https://video.test/e'],
  );
  assert.deepEqual(
    [...renderOnSite(html).querySelectorAll('iframe')].map((frame) => frame.getAttribute('src')),
    players,
  );
});

test('an embed keeps only the player permissions it asks for: camera, microphone and the rest are dropped', () => {
  const box = renderOnSite(
    '<iframe src="https://www.youtube.com/embed/a" allow="camera; Autoplay *; microphone https://evil.test; fullscreen; ' +
      'geolocation; payment; encrypted-media; picture-in-picture"></iframe>' +
      '<iframe src="https://www.youtube.com/embed/b" allow="camera; microphone"></iframe>',
  );
  const [first, second] = box.querySelectorAll('iframe');
  assert.equal(first.getAttribute('allow'), 'autoplay; fullscreen; encrypted-media; picture-in-picture');
  assert.equal(second.hasAttribute('allow'), false);
});
