// src/presets/barba.js
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
function current(option) {
  if (typeof option !== "function") return option;
  const getter = (
    /** @type {() => unknown} */
    option
  );
  return getter();
}
function callIfPresent(target, method) {
  if (typeof target !== "object" || target === null) return;
  const fn = Reflect.get(target, method);
  if (typeof fn === "function") fn.call(target);
}
var isGsap = (value) => typeof value === "object" && value !== null && typeof Reflect.get(value, "fromTo") === "function" && typeof Reflect.get(value, "to") === "function";
function barbaPreset(options = {}) {
  const {
    gsap = () => (
      /** @type {unknown} */
      Reflect.get(window, "gsap")
    ),
    lenis = null,
    scrollTrigger = () => (
      /** @type {unknown} */
      Reflect.get(window, "ScrollTrigger")
    ),
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
    const animation = current(gsap);
    return isGsap(animation) ? animation : null;
  };
  return {
    autoMount: false,
    onLayoutChange() {
      callIfPresent(current(lenis), "resize");
      callIfPresent(current(scrollTrigger), "refresh");
    },
    onCartOpen(drawers) {
      const drawer = drawers[0];
      if (locked || typeof lockScroll !== "function" || !drawer) return;
      lockScroll(drawer);
      locked = true;
    },
    onCartClose() {
      if (locked && typeof unlockScroll === "function") unlockScroll();
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
    onValueChange: typeof onValueChange === "function" ? onValueChange : null
  };
}
var barba_default = barbaPreset;
export {
  barbaPreset,
  barba_default as default
};
