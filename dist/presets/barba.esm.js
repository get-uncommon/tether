// src/presets/barba.ts
var LINE_DURATION_SECONDS = 0.3;
var collapsed = () => ({
  height: 0,
  paddingTop: 0,
  paddingBottom: 0,
  borderBottomWidth: 0,
  opacity: 0,
  overflow: "hidden"
});
var ANIMATED_PROPS = "height,paddingTop,paddingBottom,borderBottomWidth,opacity,overflow";
var reducedMotion = () => typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
var GETTER_OPTIONS = ["gsap", "lenis", "scrollTrigger"];
function checkGetters(options) {
  for (const name of GETTER_OPTIONS) {
    const option = options[name];
    if (option !== void 0 && option !== null && typeof option !== "function") {
      throw new TypeError(`barbaPreset: ${name} must be a function that returns it, such as () => ${name}`);
    }
  }
}
function callIfPresent(target, method) {
  if (typeof target !== "object" && typeof target !== "function" || target === null) return;
  const fn = Reflect.get(target, method);
  if (typeof fn === "function") fn.call(target);
}
var isGsap = (value) => typeof value === "object" && value !== null && typeof Reflect.get(value, "fromTo") === "function" && typeof Reflect.get(value, "to") === "function";
function barbaPreset(options = {}) {
  checkGetters(options);
  const {
    gsap = () => Reflect.get(window, "gsap"),
    lenis = null,
    scrollTrigger = () => Reflect.get(window, "ScrollTrigger"),
    lockScroll = null,
    unlockScroll = null,
    onResize = null,
    onValueChange = null,
    animateLines = true,
    lineDuration = LINE_DURATION_SECONDS
  } = options;
  let locked = false;
  const animator = (node) => {
    if (!animateLines || reducedMotion() || node.offsetHeight <= 0) return null;
    const animation = gsap();
    return isGsap(animation) ? animation : null;
  };
  return {
    autoMount: false,
    onLayoutChange() {
      callIfPresent(lenis?.(), "resize");
      callIfPresent(scrollTrigger(), "refresh");
    },
    onCartOpen(drawers) {
      const drawer = drawers[0];
      if (locked || !lockScroll || !drawer) return;
      lockScroll(drawer);
      locked = true;
    },
    onCartClose() {
      if (locked && unlockScroll) unlockScroll();
      locked = false;
    },
    onLineEnter(node) {
      const animation = animator(node);
      if (!animation) return;
      const style = getComputedStyle(node);
      animation.fromTo(node, collapsed(), {
        height: node.offsetHeight,
        paddingTop: style.paddingTop,
        paddingBottom: style.paddingBottom,
        borderBottomWidth: style.borderBottomWidth,
        opacity: 1,
        duration: lineDuration,
        clearProps: ANIMATED_PROPS,
        onComplete: () => onResize?.()
      });
    },
    onLineLeave(node, done) {
      const animation = animator(node);
      if (!animation) {
        done();
        return;
      }
      animation.to(node, {
        ...collapsed(),
        duration: lineDuration,
        onComplete: () => {
          done();
          onResize?.();
        }
      });
    },
    onValueChange
  };
}
var barba_default = barbaPreset;
export {
  barbaPreset,
  barba_default as default
};
