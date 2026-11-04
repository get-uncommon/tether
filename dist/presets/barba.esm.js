// src/presets/barba.js
var LINE_DURATION = 0.3;
var reducedMotion = () => typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
function barbaPreset(options = {}) {
  const {
    gsap = () => window.gsap,
    lenis = null,
    scrollTrigger = () => window.ScrollTrigger,
    lockScroll = null,
    unlockScroll = null,
    onResize = null,
    onValueChange = null,
    animateLines = true,
    lineDuration = LINE_DURATION
  } = options;
  const get = (v) => typeof v === "function" ? v() : v;
  let locked = false;
  const canAnimate = (node) => animateLines && get(gsap) && !reducedMotion() && node.offsetHeight > 0;
  return {
    autoMount: false,
    onLayoutChange() {
      var _a, _b, _c, _d;
      (_b = (_a = get(lenis)) == null ? void 0 : _a.resize) == null ? void 0 : _b.call(_a);
      (_d = (_c = get(scrollTrigger)) == null ? void 0 : _c.refresh) == null ? void 0 : _d.call(_c);
    },
    onCartOpen(drawers) {
      if (!locked && typeof lockScroll === "function" && drawers[0]) {
        lockScroll(drawers[0]);
        locked = true;
      }
    },
    onCartClose() {
      if (locked && typeof unlockScroll === "function") unlockScroll();
      locked = false;
    },
    onLineEnter(node) {
      const g = get(gsap);
      if (!canAnimate(node)) return;
      const st = getComputedStyle(node);
      g.fromTo(node, {
        height: 0,
        paddingTop: 0,
        paddingBottom: 0,
        borderBottomWidth: 0,
        opacity: 0,
        overflow: "hidden"
      }, {
        height: node.offsetHeight,
        paddingTop: st.paddingTop,
        paddingBottom: st.paddingBottom,
        borderBottomWidth: st.borderBottomWidth,
        opacity: 1,
        duration: lineDuration,
        clearProps: "height,paddingTop,paddingBottom,borderBottomWidth,opacity,overflow",
        onComplete: () => onResize == null ? void 0 : onResize()
      });
    },
    onLineLeave(node, done) {
      const g = get(gsap);
      if (!canAnimate(node)) {
        done();
        return;
      }
      g.to(node, {
        height: 0,
        paddingTop: 0,
        paddingBottom: 0,
        borderBottomWidth: 0,
        opacity: 0,
        overflow: "hidden",
        duration: lineDuration,
        onComplete: () => {
          done();
          onResize == null ? void 0 : onResize();
        }
      });
    },
    onValueChange: typeof onValueChange === "function" ? onValueChange : null
  };
}
var barba_default = barbaPreset;
export {
  barbaPreset,
  barba_default as default
};
