// ============================================================================
// BROWSER 05 — The "every div is a component" bootstrap (what you noticed)
// ----------------------------------------------------------------------------
// You said "several divs each with web components." That's the vanilla-JS answer
// to React components: mark a block with `data-component="name"` and a tiny
// registry instantiates a class per element (confirmed pattern signals on his
// site: `querySelectorAll` ×35, `dataset.*` ×17). Each class owns its own
// element, state, animations, and a `destroy()` for page transitions.
//
// CONCEPT CHECK — answer first:
//   • Why a class-per-element instead of one big script? (encapsulation + a clean
//     `destroy()` so the router can tear a page down without leaks.)
//   • Why does each component need `destroy()`? (kill GSAP tweens/ScrollTriggers,
//     remove listeners, dispose Three meshes — or you leak on every SPA navigation.)
//   • How is this like a React component's mount/unmount, and how is it NOT
//     (no virtual DOM, no re-render — you mutate the real element directly)?
//   • Why read config from `data-*` attributes instead of hardcoding? (the same
//     class drives many blocks with per-block options, straight from the HTML.)
// ============================================================================

const registry = new Map();   // name -> Component class

export function register(name, Cls) {
    registry.set(name, Cls);
}

// Call on first load AND after every router swap (browser/04).
export function bootstrap(root = document) {
    const instances = [];
    // TODO:
    //   root.querySelectorAll("[data-component]").forEach((el) => {
    //     const Cls = registry.get(el.dataset.component);
    //     if (Cls) instances.push(new Cls(el));
    //   });
    return instances;   // keep these so the router can destroy() them on leave
}

// Base shape every component follows:
export class Component {
    constructor(el) {
        this.el = el;
        // read options: this.speed = Number(el.dataset.speed ?? 1)
        this.init();
    }
    init() {}       // set up tweens / ScrollTriggers / listeners
    destroy() {}    // MUST tear all of that down (called before a page swap)
}
