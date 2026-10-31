(() => {
  if (globalThis.__captureStudio) return;
  globalThis.__captureStudio = true;
  let saved, timer, selectionCleanup, selectedTarget, selectedElement;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const ownershipAttribute = "data-capture-studio-owned";
  function inlineStyle(text) {
    const style = document.createElement("div").style;
    style.cssText = text || "";
    return style;
  }
  function styleRecord(node) {
    return {
      attribute: node.getAttribute("style"),
      applied: inlineStyle(node.style.cssText),
    };
  }
  function sameProperty(a, b, name) {
    return (
      a.getPropertyValue(name) === b.getPropertyValue(name) &&
      a.getPropertyPriority(name) === b.getPropertyPriority(name)
    );
  }
  function restoreOwnedStyle(node, entry) {
    const original = inlineStyle(entry.attribute),
      restored = inlineStyle(entry.attribute),
      current = node.style,
      applied = entry.applied;
    // CSSOM longhands separate a changed inset/margin from the other sides still
    // owned by capture. Begin with the original shorthand so var() survives.
    for (const name of new Set([...original, ...applied, ...current])) {
      if (
        !sameProperty(current, original, name) &&
        (!sameProperty(current, applied, name) ||
          sameProperty(applied, original, name))
      ) {
        const value = current.getPropertyValue(name);
        if (value)
          restored.setProperty(name, value, current.getPropertyPriority(name));
        else restored.removeProperty(name);
      }
    }
    // Variable shorthands expose empty pending-substitution longhands. Preserve
    // a newly authored shorthand through its serialized declaration instead.
    for (const [name, value, priority] of declarations(node))
      if (/var\(/.test(value) && !sameProperty(current, applied, name))
        restored.setProperty(name, value, priority);
    if (restored.cssText === original.cssText) {
      if (entry.attribute === null) {
        node.style.cssText = "";
        void node.getAttribute("style");
        node.removeAttribute("style");
      } else node.setAttribute("style", entry.attribute);
    } else node.style.cssText = restored.cssText;
  }
  function restoreMarker(node, attribute, value, original) {
    if (node.getAttribute(attribute) !== value) return;
    if (original === null) node.removeAttribute(attribute);
    else node.setAttribute(attribute, original);
  }
  function ownNode(node) {
    let owner = saved.owners.get(node);
    if (!owner) {
      owner = {
        node,
        original: node.getAttribute(ownershipAttribute),
        revision: null,
      };
      saved.owners.set(node, owner);
    }
    if (owner.token && node.getAttribute(ownershipAttribute) !== owner.token)
      owner.original = node.getAttribute(ownershipAttribute);
    if (owner.revision?.epoch !== saved.ownershipEpoch) {
      // Keep immutable phase deltas, not complete CSS snapshots per write. A
      // detached clone can be inserted after its source has moved many times.
      const token = `${saved.paintPrefix}-o-${saved.ownershipTokens.size}`;
      owner.revision = {
        owner,
        original: owner.original,
        epoch: saved.ownershipEpoch,
        previous: owner.revision,
        writes: new Map(),
        paint: saved.paintStyles.get(node),
        paintMarker: saved.paintMarkers.get(node),
      };
      owner.token = token;
      saved.ownershipTokens.set(token, owner.revision);
      node.setAttribute(ownershipAttribute, token);
    }
    return owner.revision;
  }
  function adoptClone(node) {
    const token = node.getAttribute(ownershipAttribute),
      revision = saved.ownershipTokens.get(token);
    if (!revision || revision.owner.node === node) return;
    if (revision.paint) restoreOwnedStyle(node, revision.paint);
    const history = [];
    for (let item = revision; item; item = item.previous) history.push(item);
    const initial = history.find((item) => item.attribute !== undefined);
    if (initial) {
      const applied = inlineStyle(initial.attribute);
      for (const item of history.reverse())
        for (const [property, value] of item.writes)
          applied.setProperty(property, value, "important");
      restoreOwnedStyle(node, { attribute: initial.attribute, applied });
    }
    const marker = revision.paintMarker;
    if (marker)
      restoreMarker(
        node,
        "data-capture-studio-paint",
        marker.value,
        marker.original,
      );
    restoreMarker(node, ownershipAttribute, token, revision.original);
  }
  function adoptClones(records) {
    if (!saved) return;
    const roots = new Set();
    for (const record of records)
      for (const node of record.addedNodes)
        if (node.nodeType === Node.ELEMENT_NODE) roots.add(node);
    for (const root of roots) {
      adoptClone(root);
      for (const node of root.querySelectorAll(`[${ownershipAttribute}]`))
        adoptClone(node);
    }
  }
  function restore() {
    clearTimeout(timer);
    selectionCleanup?.();
    selectedTarget = null;
    selectedElement = null;
    if (!saved) return;
    // Drain pending insertions before disconnecting, including clones inserted just
    // before cancellation. Ownership is scoped to this capture session only.
    adoptClones(saved.cloneObserver.takeRecords());
    saved.cloneObserver.disconnect();
    releasePaneStyles();
    saved.style.remove();
    for (const [node, original] of saved.changed)
      restoreOwnedStyle(node, original);
    for (const [node, marker] of saved.paintMarkers || []) {
      if (node.getAttribute("data-capture-studio-paint") !== marker.value)
        continue;
      if (marker.original === null)
        node.removeAttribute("data-capture-studio-paint");
      else node.setAttribute("data-capture-studio-paint", marker.original);
    }
    for (const owner of saved.owners.values())
      restoreMarker(
        owner.node,
        ownershipAttribute,
        owner.token,
        owner.original,
      );
    for (const [node, offset] of [...saved.scrolls].reverse())
      if (node.isConnected) node.scrollTo({ ...offset, behavior: "instant" });
    window.scrollTo({ left: saved.x, top: saved.y, behavior: "instant" });
    saved = null;
  }
  function arm() {
    clearTimeout(timer);
    timer = setTimeout(restore, 15000);
  }
  function dimensions() {
    if (saved?.target) {
      const source = paneBox(saved.target);
      return {
        kind: "pane",
        originalPane: saved.originalPane,
        width: saved.target.scrollWidth,
        height: saved.target.scrollHeight,
        captureViewportWidth: source.width,
        captureViewportHeight: source.height,
        source,
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
        dpr: devicePixelRatio,
      };
    }
    const root = document.documentElement,
      body = document.body;
    return {
      ...(saved?.element ? { element: elementBox(saved.element) } : {}),
      rootPosition: { x: scrollX, y: scrollY },
      rootRTL: document.scrollingElement
        ? rtlScroller(document.scrollingElement)
        : false,
      rootMaxX: Math.max(0, root.scrollWidth - root.clientWidth),
      width: Math.max(
        root.scrollWidth,
        root.clientWidth,
        body?.scrollWidth || 0,
      ),
      height: Math.max(
        root.scrollHeight,
        root.clientHeight,
        body?.scrollHeight || 0,
      ),
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      dpr: devicePixelRatio,
    };
  }
  function clientBox(node) {
    const rect = node.getBoundingClientRect();
    return {
      x: rect.left + node.clientLeft,
      y: rect.top + node.clientTop,
      width: node.clientWidth,
      height: node.clientHeight,
    };
  }
  function paneBox(target) {
    if (
      !target.isConnected ||
      !target.clientWidth ||
      !target.clientHeight ||
      !target.checkVisibility({
        opacityProperty: true,
        visibilityProperty: true,
        contentVisibilityAuto: true,
      })
    )
      throw new Error(
        "The scrolling area was removed or hidden. Please try again.",
      );
    const box = clientBox(target);
    const escaping = new Set();
    // Out-of-flow elements escape overflow clips between them and their containing block.
    for (let node = target; node; node = node.parentElement) {
      const position = getComputedStyle(node).position;
      if (!["fixed", "absolute"].includes(position)) continue;
      let block = node.parentElement;
      while (block) {
        const css = getComputedStyle(block);
        if (
          establishesFixedBlock(css) ||
          (position === "absolute" && css.position !== "static")
        )
          break;
        block = block.parentElement;
      }
      for (
        let parent = node.parentElement;
        parent && parent !== block;
        parent = parent.parentElement
      )
        escaping.add(parent);
    }
    let left = Math.max(0, box.x),
      top = Math.max(0, box.y),
      right = Math.min(innerWidth, box.x + box.width),
      bottom = Math.min(innerHeight, box.y + box.height);
    for (let node = target; node; node = node.parentElement) {
      const css = getComputedStyle(node),
        rect = node.getBoundingClientRect();
      if (
        css.clipPath !== "none" ||
        css.maskImage !== "none" ||
        css.clip !== "auto"
      )
        throw new Error(
          "This scrolling area uses a custom clipping mask. Use a visible-area capture instead.",
        );
      const matrix = new DOMMatrixReadOnly(
        css.transform === "none" ? undefined : css.transform,
      );
      if (
        [
          matrix.m13,
          matrix.m14,
          matrix.m23,
          matrix.m24,
          matrix.m31,
          matrix.m32,
          matrix.m34,
        ].some((value) => Math.abs(value) > 0.0001) ||
        Math.abs(matrix.m33 - 1) > 0.0001 ||
        Math.abs(matrix.m44 - 1) > 0.0001 ||
        css.perspective !== "none" ||
        Math.abs(matrix.a - 1) > 0.0001 ||
        Math.abs(matrix.d - 1) > 0.0001 ||
        Math.abs(matrix.b) > 0.0001 ||
        Math.abs(matrix.c) > 0.0001 ||
        (css.scale !== "none" && css.scale !== "1" && css.scale !== "1 1") ||
        (css.rotate !== "none" && css.rotate !== "0deg") ||
        Math.abs(rect.width - node.offsetWidth) > 1.1 ||
        Math.abs(rect.height - node.offsetHeight) > 1.1
      )
        throw new Error(
          "This scrolling area is scaled or rotated. Reset its layout or use a visible-area capture.",
        );
      if (node !== target && !escaping.has(node)) {
        const clip = clientBox(node);
        const paintClip =
          /paint|strict|content/.test(css.contain) ||
          css.contentVisibility === "auto";
        if (
          paintClip ||
          /auto|scroll|hidden|clip|overlay/.test(css.overflowX)
        ) {
          left = Math.max(left, clip.x);
          right = Math.min(right, clip.x + clip.width);
        }
        if (
          paintClip ||
          /auto|scroll|hidden|clip|overlay/.test(css.overflowY)
        ) {
          top = Math.max(top, clip.y);
          bottom = Math.min(bottom, clip.y + clip.height);
        }
      }
    }
    if (
      left > box.x + 0.01 ||
      top > box.y + 0.01 ||
      right < box.x + box.width - 0.01 ||
      bottom < box.y + box.height - 0.01
    )
      throw new Error(
        "The scrolling area is partly clipped. Bring the entire pane into view or choose a smaller scrolling area.",
      );
    return box;
  }
  function rtlScroller(target) {
    // Chromium's viewport scroll origin follows the body's direction, including
    // documents whose body explicitly overrides the root element's direction.
    return (
      getComputedStyle(
        target === document.scrollingElement ? document.body || target : target,
      ).direction === "rtl"
    );
  }
  function scrollOffset(target) {
    const max = Math.max(0, target.scrollWidth - target.clientWidth);
    return {
      x: rtlScroller(target) ? max + target.scrollLeft : target.scrollLeft,
      y: target.scrollTop,
    };
  }
  function moveTo(x, y) {
    const target = saved.target || document.scrollingElement;
    if (!target) return scrollTo({ left: x, top: y, behavior: "instant" });
    target.scrollTo({
      left: rtlScroller(target)
        ? x - Math.max(0, target.scrollWidth - target.clientWidth)
        : x,
      top: y,
      behavior: "instant",
    });
  }
  function captureView() {
    if (!saved?.target) {
      const offset = document.scrollingElement
        ? scrollOffset(document.scrollingElement)
        : { x: scrollX, y: scrollY };
      return {
        left: 0,
        top: 0,
        width: innerWidth,
        height: innerHeight,
        ...offset,
      };
    }
    const box = paneBox(saved.target);
    return {
      left: box.x,
      top: box.y,
      width: box.width,
      height: box.height,
      ...scrollOffset(saved.target),
    };
  }
  function captureNodes() {
    return saved.target
      ? saved.target.querySelectorAll("*")
      : document.querySelectorAll("body *");
  }
  function contentRect(node, view = captureView()) {
    const rect = node.getBoundingClientRect();
    return {
      left: rect.left - view.left,
      right: rect.right - view.left,
      top: rect.top - view.top,
      bottom: rect.bottom - view.top,
      width: rect.width,
      height: rect.height,
    };
  }
  function scrollingCandidates() {
    const candidates = [];
    for (const node of document.querySelectorAll("body *")) {
      if (
        node === document.scrollingElement ||
        node === document.body ||
        /^(TEXTAREA|INPUT|SELECT|IFRAME)$/.test(node.tagName) ||
        node.clientWidth < 80 ||
        node.clientHeight < 60
      )
        continue;
      const css = getComputedStyle(node);
      if (
        !(
          (/auto|scroll|overlay/.test(css.overflowY) &&
            node.scrollHeight > node.clientHeight + 4) ||
          (/auto|scroll|overlay/.test(css.overflowX) &&
            node.scrollWidth > node.clientWidth + 4)
        ) ||
        css.visibility !== "visible" ||
        !node.checkVisibility({
          opacityProperty: true,
          visibilityProperty: true,
          contentVisibilityAuto: true,
        })
      )
        continue;
      const box = clientBox(node);
      const width = Math.max(
          0,
          Math.min(innerWidth, box.x + box.width) - Math.max(0, box.x),
        ),
        height = Math.max(
          0,
          Math.min(innerHeight, box.y + box.height) - Math.max(0, box.y),
        );
      if (width < 80 || height < 60) continue;
      const semantic = node.closest(
        'main,article,[role="main"],[role="document"]',
      )
        ? 1.35
        : 1;
      const navigation = node.closest(
        'nav,aside,[role="navigation"],[role="menu"]',
      )
        ? 0.2
        : 1;
      candidates.push({
        node,
        box,
        visibleWidth: width,
        visibleHeight: height,
        navigation: navigation < 1,
        score:
          width *
          height *
          semantic *
          navigation *
          Math.min(
            1.35,
            0.8 +
              Math.log2(
                1 +
                  Math.max(
                    node.scrollHeight / node.clientHeight - 1,
                    node.scrollWidth / node.clientWidth - 1,
                  ),
              ) *
                0.25,
          ),
      });
    }
    return candidates.sort((a, b) => b.score - a.score);
  }
  function resolveTarget(scope) {
    restore();
    if (scope === "page") return { kind: "document" };
    const candidates = scrollingCandidates();
    if (scope === "pick") {
      if (!candidates.length)
        throw new Error(
          "No visible scrolling area found. Try Full page or Visible area.",
        );
      return { kind: "choose" };
    }
    const page = dimensions();
    if (
      page.height > innerHeight + Math.max(80, innerHeight * 0.15) ||
      page.width > innerWidth + 80
    )
      return { kind: "document" };
    const large = candidates.filter(
      (item) =>
        !item.navigation &&
        item.visibleWidth >= Math.max(240, innerWidth * 0.28) &&
        item.visibleHeight >= Math.min(240, innerHeight * 0.4),
    );
    if (!large.length) return { kind: "document" };
    const first = large[0],
      second = large.find(
        (item) =>
          item !== first &&
          !first.node.contains(item.node) &&
          !item.node.contains(first.node),
      );
    if (second && second.score >= first.score * 0.8) return { kind: "choose" };
    selectedTarget = first.node;
    return { kind: "pane" };
  }
  function elementBox(node) {
    if (
      !node?.isConnected ||
      !node.checkVisibility({ opacityProperty: true, visibilityProperty: true })
    )
      throw new Error("The selected element was removed or hidden.");
    const rect = node.getBoundingClientRect();
    for (
      let parent = node;
      parent && parent !== document.documentElement && parent !== document.body;
      parent = parent.parentElement
    ) {
      const css = getComputedStyle(parent);
      if (
        css.transform !== "none" ||
        css.rotate !== "none" ||
        css.scale !== "none" ||
        css.clipPath !== "none" ||
        css.maskImage !== "none"
      )
        throw new Error(
          "This element is transformed or masked. Use a visible-region capture instead.",
        );
      if (
        parent !== node &&
        /auto|scroll|hidden|clip|overlay/.test(
          `${css.overflowX} ${css.overflowY}`,
        )
      ) {
        const clip = parent.getBoundingClientRect();
        if (
          rect.left < clip.left - 0.5 ||
          rect.right > clip.right + 0.5 ||
          rect.top < clip.top - 0.5 ||
          rect.bottom > clip.bottom + 0.5
        )
          throw new Error(
            "This element is clipped by a scrolling ancestor. Capture that scrolling area instead.",
          );
      }
    }
    if (rect.width < 1 || rect.height < 1)
      throw new Error("Choose a visible element.");
    return {
      x: rect.left + captureView().x,
      y: rect.top + scrollY,
      width: rect.width,
      height: rect.height,
    };
  }
  function selectElement() {
    return new Promise((resolve, reject) => {
      const host = document.createElement("div");
      host.dataset.captureStudioPicker = "element";
      host.style.cssText =
        "position:fixed;inset:0;z-index:2147483647;cursor:crosshair";
      const shadow = host.attachShadow({ mode: "closed" }),
        box = document.createElement("div"),
        hint = document.createElement("div");
      box.style.cssText =
        "position:fixed;border:3px solid #8b5cf6;background:#8b5cf618;box-sizing:border-box;pointer-events:none";
      hint.style.cssText =
        "position:fixed;top:16px;left:50%;transform:translateX(-50%);padding:14px;background:#111827;color:white;font:14px system-ui;border-radius:10px;pointer-events:none";
      hint.textContent =
        "Choose a page element · click/Enter to capture · ↑ parent · ↓ child · Esc cancel";
      shadow.append(box, hint);
      document.documentElement.append(host);
      let target,
        finished = false;
      function update() {
        if (!target) return;
        const r = target.getBoundingClientRect();
        Object.assign(box.style, {
          left: `${r.left}px`,
          top: `${r.top}px`,
          width: `${r.width}px`,
          height: `${r.height}px`,
        });
      }
      function cleanup() {
        clearTimeout(timeout);
        host.remove();
        window.removeEventListener("keydown", key, true);
        selectionCleanup = null;
        if (!finished) {
          finished = true;
          reject(new Error("Element selection cancelled."));
        }
      }
      function choose() {
        if (!target) return;
        try {
          const css = getComputedStyle(target),
            scrollable =
              /auto|scroll|overlay/.test(`${css.overflowX} ${css.overflowY}`) &&
              (target.scrollHeight > target.clientHeight + 2 ||
                target.scrollWidth > target.clientWidth + 2);
          if (scrollable) {
            paneBox(target);
            selectedTarget = target;
            selectedElement = null;
          } else {
            elementBox(target);
            selectedElement = target;
            selectedTarget = null;
          }
          finished = true;
          cleanup();
          resolve({ kind: scrollable ? "pane" : "element" });
        } catch (error) {
          hint.textContent = error.message;
        }
      }
      function key(event) {
        if (!["Escape", "Enter", "ArrowUp", "ArrowDown"].includes(event.key))
          return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.key === "Escape") cleanup();
        else if (event.key === "Enter") choose();
        else {
          target =
            event.key === "ArrowUp"
              ? target?.parentElement || target
              : target?.firstElementChild || target;
          update();
        }
      }
      host.onpointermove = (event) => {
        host.style.pointerEvents = "none";
        target = document.elementFromPoint(event.clientX, event.clientY);
        host.style.pointerEvents = "auto";
        update();
      };
      host.onpointerdown = (event) => {
        event.preventDefault();
        event.stopPropagation();
      };
      host.onpointerup = (event) => {
        event.preventDefault();
        event.stopPropagation();
        choose();
      };
      window.addEventListener("keydown", key, true);
      const timeout = setTimeout(cleanup, 120000);
      selectionCleanup = cleanup;
    });
  }
  function selectPane() {
    const candidates = scrollingCandidates();
    if (!candidates.length)
      throw new Error(
        "No visible scrolling area found. Try Full page or Visible area.",
      );
    return new Promise((resolve, reject) => {
      const host = document.createElement("div");
      host.dataset.captureStudioPicker = "pane";
      host.style.cssText =
        "position:fixed;inset:0;z-index:2147483647;cursor:crosshair;touch-action:none";
      const shadow = host.attachShadow({ mode: "closed" });
      shadow.innerHTML =
        '<style>:host{all:initial}.box{position:fixed;pointer-events:none;box-sizing:border-box;border:3px solid #8b5cf6;background:#8b5cf618;box-shadow:0 0 0 100vmax #11182755}.hint{position:fixed;top:16px;left:50%;transform:translateX(-50%);max-width:90vw;border:1px solid #ffffff33;border-radius:12px;padding:14px 20px;background:#141826;color:white;font:14px/1.5 system-ui;text-align:center;pointer-events:none}</style><div class="box"></div><div class="hint" role="status"></div>';
      document.documentElement.append(host);
      let index = 0,
        finished = false;
      const box = shadow.querySelector(".box"),
        hint = shadow.querySelector(".hint");
      const update = () => {
        const candidate = candidates[index],
          rect = candidate.node.getBoundingClientRect();
        Object.assign(box.style, {
          left: `${rect.left}px`,
          top: `${rect.top}px`,
          width: `${rect.width}px`,
          height: `${rect.height}px`,
        });
        hint.textContent = `Choose a scrolling area · ${index + 1} of ${candidates.length} · ${candidate.node.scrollWidth.toLocaleString()} × ${candidate.node.scrollHeight.toLocaleString()} px. Click or Enter to capture; Tab / arrows to switch; Esc to cancel.`;
      };
      const cleanup = () => {
        clearTimeout(timeout);
        host.remove();
        window.removeEventListener("keydown", key, true);
        if (!finished) {
          finished = true;
          reject(new Error("Scrolling-area selection cancelled."));
        }
        selectionCleanup = null;
      };
      const choose = () => {
        finished = true;
        const target = candidates[index].node;
        cleanup();
        selectedTarget = target;
        resolve({ kind: "pane" });
      };
      const key = (event) => {
        if (
          ![
            "Escape",
            "Enter",
            "Tab",
            "ArrowDown",
            "ArrowUp",
            "ArrowLeft",
            "ArrowRight",
          ].includes(event.key)
        )
          return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.key === "Escape") cleanup();
        else if (event.key === "Enter") choose();
        else {
          const backwards =
            event.shiftKey || ["ArrowUp", "ArrowLeft"].includes(event.key);
          index =
            (index + (backwards ? -1 : 1) + candidates.length) %
            candidates.length;
          update();
        }
      };
      const timeout = setTimeout(cleanup, 120000);
      selectionCleanup = cleanup;
      window.addEventListener("keydown", key, true);
      host.onpointermove = (event) => {
        const matches = candidates
          .filter(({ node }) => {
            const rect = node.getBoundingClientRect();
            return (
              event.clientX >= rect.left &&
              event.clientX < rect.right &&
              event.clientY >= rect.top &&
              event.clientY < rect.bottom
            );
          })
          .sort(
            (a, b) => a.box.width * a.box.height - b.box.width * b.box.height,
          );
        if (matches.length) {
          index = candidates.indexOf(matches[0]);
          update();
        }
      };
      host.onpointerdown = (event) => {
        event.preventDefault();
        event.stopPropagation();
      };
      host.onpointerup = (event) => {
        event.preventDefault();
        event.stopPropagation();
      };
      host.onclick = (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        const rect = candidates[index].node.getBoundingClientRect();
        if (
          event.button === 0 &&
          event.clientX >= rect.left &&
          event.clientX < rect.right &&
          event.clientY >= rect.top &&
          event.clientY < rect.bottom
        )
          choose();
      };
      host.addEventListener("wheel", (event) => event.preventDefault(), {
        passive: false,
      });
      update();
    });
  }
  function panePaintRule(node, pseudo, declarations) {
    const revision = ownNode(node);
    if (!saved.paintMarkers.has(node)) {
      const value = `${saved.paintPrefix}-${saved.paintMarkers.size}`;
      saved.paintMarkers.set(node, {
        value,
        original: node.getAttribute("data-capture-studio-paint"),
      });
      node.setAttribute("data-capture-studio-paint", value);
    }
    revision.paintMarker = saved.paintMarkers.get(node);
    const marker = saved.paintMarkers.get(node).value,
      key = `${marker}${pseudo}`;
    clearPanePaintRule(node, pseudo);
    // The unused ID branch gives these temporary rules enough specificity to
    // override author-important pseudo styles without touching other elements.
    const selector = `:is([data-capture-studio-paint="${marker}"],#cs-paint-a#cs-paint-b#cs-paint-c)${pseudo}`;
    saved.style.sheet.insertRule(
      `${selector}{${declarations}}`,
      saved.style.sheet.cssRules.length,
    );
    saved.paintRules.set(key, {
      node,
      pseudo,
      rule: saved.style.sheet.cssRules[saved.style.sheet.cssRules.length - 1],
    });
  }
  function clearPanePaintRule(node, pseudo) {
    const marker = saved.paintMarkers.get(node);
    if (!marker) return;
    const key = `${marker.value}${pseudo}`,
      entry = saved.paintRules.get(key);
    if (!entry) return;
    const index = [...saved.style.sheet.cssRules].indexOf(entry.rule);
    if (index >= 0) saved.style.sheet.deleteRule(index);
    saved.paintRules.delete(key);
  }
  function paneStyle(node, property, value) {
    if (
      node.style.getPropertyValue(property) === value &&
      node.style.getPropertyPriority(property) === "important"
    )
      return;
    const revision = ownNode(node);
    if (!saved.paintStyles.has(node))
      saved.paintStyles.set(node, styleRecord(node));
    const entry = saved.paintStyles.get(node);
    revision.paint = entry;
    node.style.setProperty(property, value, "important");
    entry.applied.setProperty(property, value, "important");
  }
  function releasePaneStyles() {
    for (const [node, entry] of saved.paintStyles || [])
      restoreOwnedStyle(node, entry);
    saved.paintStyles?.clear();
  }
  function withoutInsetShadow(value) {
    const shadows = [];
    let depth = 0,
      start = 0;
    for (let i = 0; i <= value.length; i++) {
      if (value[i] === "(") depth++;
      else if (value[i] === ")") depth--;
      else if ((value[i] === "," || i === value.length) && !depth) {
        const shadow = value.slice(start, i).trim();
        if (!/\binset\b/i.test(shadow)) shadows.push(shadow);
        start = i + 1;
      }
    }
    return shadows.join(", ") || "none";
  }
  function opaquePane() {
    const target = saved.target,
      css = getComputedStyle(target);
    if (/content-box|text/.test(css.backgroundClip)) return false;
    const probe = document.createElement("canvas");
    probe.width = probe.height = 1;
    const ctx = probe.getContext("2d");
    ctx.fillStyle = css.backgroundColor;
    ctx.fillRect(0, 0, 1, 1);
    if (ctx.getImageData(0, 0, 1, 1).data[3] !== 255) return false;
    for (let node = target; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (
        Number(style.opacity) !== 1 ||
        style.mixBlendMode !== "normal" ||
        style.filter !== "none" ||
        style.backdropFilter !== "none"
      )
        return false;
    }
    return true;
  }
  function paintOrderFor(target) {
    const styles = new WeakMap(),
      chains = new WeakMap();
    const style = (node) => {
      if (!styles.has(node)) styles.set(node, getComputedStyle(node));
      return styles.get(node);
    };
    const isContext = (node, css = style(node)) => {
      const positioned = css.position !== "static",
        item =
          node.parentElement &&
          /flex|grid/.test(style(node.parentElement).display);
      return (
        node === document.documentElement ||
        ["fixed", "sticky"].includes(css.position) ||
        ((positioned || item) && css.zIndex !== "auto") ||
        Number(css.opacity) < 1 ||
        css.isolation === "isolate" ||
        css.mixBlendMode !== "normal" ||
        establishesFixedBlock(css) ||
        css.clipPath !== "none" ||
        css.maskImage !== "none" ||
        /opacity|clip-path|mask/.test(css.willChange)
      );
    };
    const chain = (node) => {
      if (!node) return [];
      if (!chains.has(node)) {
        const result = [...chain(node.parentElement)];
        if (isContext(node)) result.push({ node, css: style(node) });
        chains.set(node, result);
      }
      return chains.get(node);
    };
    const targetChain = chain(target);
    return {
      style,
      isContext,
      behind(node, pseudoStyle) {
        const source = pseudoStyle
          ? [...chain(node), { node, css: pseudoStyle }]
          : chain(node);
        let i = 0;
        while (
          source[i]?.node === targetChain[i]?.node &&
          source[i] &&
          targetChain[i]
        )
          i++;
        const a = source[i] || { node, css: style(node) },
          b = targetChain[i] || { node: target, css: style(target) },
          levelA = Number(a.css.zIndex) || 0,
          levelB = Number(b.css.zIndex) || 0;
        if (levelA !== levelB) return levelA < levelB;
        const bucketA = source[i] || a.css.position !== "static" ? 1 : 0,
          bucketB = targetChain[i] || b.css.position !== "static" ? 1 : 0;
        if (bucketA !== bucketB) return bucketA < bucketB;
        return Boolean(
          a.node.compareDocumentPosition(b.node) &
          Node.DOCUMENT_POSITION_FOLLOWING,
        );
      },
    };
  }
  function thinPanePseudo(css, box) {
    const width = parseFloat(css.width),
      height = parseFloat(css.height);
    return (
      !["none", "normal"].includes(css.content) &&
      ["fixed", "sticky", "absolute"].includes(css.position) &&
      ((height <= 8 && width >= box.width * 0.5) ||
        (width <= 8 && height >= box.height * 0.5))
    );
  }
  function hidePaneOverlays() {
    if (!saved.target) return;
    // Reclassify from the site's live styles, not our last frame's suppression.
    // Also preserve page-authored changes to opacity or shadow mid-capture.
    releasePaneStyles();
    for (const entry of [...saved.paintRules.values()])
      if (!saved.target.contains(entry.node))
        clearPanePaintRule(entry.node, entry.pseudo);
    const target = saved.target,
      box = paneBox(target),
      targetStyle = getComputedStyle(target),
      branches = [];
    // Top-layer elements escape ancestor stacking contexts and opacity. Hide
    // external dialogs/popovers directly, including their independent backdrops,
    // while leaving their open state and pane-owned content intact.
    for (const node of document.querySelectorAll(":modal,:popover-open"))
      if (!target.contains(node) && !node.contains(target)) {
        paneStyle(node, "opacity", "0");
        panePaintRule(
          node,
          "::backdrop",
          "opacity:0!important;visibility:hidden!important",
        );
      }
    if (/\binset\b/i.test(targetStyle.boxShadow))
      paneStyle(
        target,
        "box-shadow",
        withoutInsetShadow(targetStyle.boxShadow),
      );
    // Sibling branches cannot contribute background pixels through an opaque pane.
    // Composite them out without changing layout, including their shadows, filters,
    // pseudo-elements and children that explicitly override inherited visibility.
    const opaque = opaquePane();
    for (
      let branch = target;
      branch.parentElement;
      branch = branch.parentElement
    )
      for (const sibling of branch.parentElement.children)
        if (
          sibling !== branch &&
          !sibling.hasAttribute("data-capture-studio-presentation") &&
          !sibling.hasAttribute("data-capture-studio-inline") &&
          !/^(HEAD|STYLE|SCRIPT|LINK|META)$/.test(sibling.tagName)
        ) {
          branches.push(sibling);
          if (opaque) paneStyle(sibling, "opacity", "0");
        }
    // Ancestor edge pseudo-elements are pane chrome. Keep full-size backgrounds
    // and ordinary generated content, especially behind transparent reading panes.
    for (let node = target.parentElement; node; node = node.parentElement)
      for (const pseudo of ["::before", "::after"]) {
        const css = getComputedStyle(node, pseudo);
        if (!(Number(css.zIndex) < 0) && thinPanePseudo(css, box))
          panePaintRule(
            node,
            pseudo,
            "opacity:0!important;visibility:hidden!important",
          );
      }
    if (opaque) return;
    // A transparent pane may intentionally reveal a sibling background. Retain
    // backgrounds behind it and remove only nearby foreground overlay paint.
    const order = paintOrderFor(target);
    while (branches.length) {
      const node = branches.pop(),
        css = order.style(node),
        behind = order.behind(node);
      // Children cannot escape a stacking context behind the captured pane, even
      // if their own z-index is numerically higher than the pane's z-index.
      if (behind && order.isContext(node)) continue;
      for (const pseudo of ["::before", "::after"]) {
        const generated = getComputedStyle(node, pseudo);
        if (thinPanePseudo(generated, box) && !order.behind(node, generated))
          panePaintRule(
            node,
            pseudo,
            "opacity:0!important;visibility:hidden!important",
          );
      }
      if (
        !behind &&
        (css.position !== "static" ||
          css.boxShadow !== "none" ||
          css.filter !== "none")
      ) {
        const rect = node.getBoundingClientRect(),
          reach = Math.max(
            1,
            [
              ...`${css.boxShadow} ${css.filter}`.matchAll(/-?[\d.]+px/g),
            ].reduce((sum, match) => sum + Math.abs(parseFloat(match[0])), 0),
          );
        if (
          rect.right + reach >= box.x &&
          rect.left - reach <= box.x + box.width &&
          rect.bottom + reach >= box.y &&
          rect.top - reach <= box.y + box.height
        ) {
          paneStyle(node, "opacity", "0");
          continue;
        }
      }
      branches.push(...node.children);
    }
  }
  function styleGroup(name) {
    if (name === "margin" || name.startsWith("margin-")) return "margin";
    if (
      name === "border-radius" ||
      /^border-(top|bottom)-(left|right)-radius$/.test(name)
    )
      return "border-radius";
    if (
      ["top", "right", "bottom", "left", "inset"].includes(name) ||
      name.startsWith("inset-")
    )
      return "inset";
    return name;
  }
  function declarations(node) {
    // CSSOM iteration expands variable shorthands into empty pending-substitution
    // longhands. Read serialized declaration names so their original values survive.
    const names = [];
    const text = node.style.cssText;
    if (typeof text === "string") {
      let start = 0,
        depth = 0,
        quote = "",
        comment = false;
      for (let i = 0; i <= text.length; i++) {
        const char = text[i];
        if (comment) {
          if (char === "*" && text[i + 1] === "/") {
            comment = false;
            i++;
          }
        } else if (char === "\\") i++;
        else if (quote) {
          if (char === quote) quote = "";
        } else if (char === "/" && text[i + 1] === "*") {
          comment = true;
          i++;
        } else if (char === '"' || char === "'") quote = char;
        else if (["(", "[", "{"].includes(char)) depth++;
        else if (")]}".includes(char)) depth--;
        else if ((char === ";" || i === text.length) && !depth) {
          const declaration = text.slice(start, i);
          const colon = declaration.indexOf(":");
          if (colon >= 0) names.push(declaration.slice(0, colon).trim());
          start = i + 1;
        }
      }
    } else names.push(...node.style);
    return names.map((name) => [
      name,
      node.style.getPropertyValue(name),
      node.style.getPropertyPriority(name),
    ]);
  }
  function setStyle(node, property, value) {
    if (
      node.style.getPropertyValue(property) === value &&
      node.style.getPropertyPriority(property) === "important"
    )
      return;
    const revision = ownNode(node);
    if (!saved.changed.has(node)) saved.changed.set(node, styleRecord(node));
    const entry = saved.changed.get(node);
    if (entry.rebasedEpoch !== saved.ownershipEpoch) {
      entry.rebasedEpoch = saved.ownershipEpoch;
      entry.rebased = new Set();
    }
    const group = styleGroup(property);
    if (
      !sameProperty(node.style, entry.applied, property) &&
      !entry.rebased.has(group)
    ) {
      // Rebase the whole shorthand before any of its sides are overwritten.
      // A variable shorthand's pending longhands serialize as empty strings.
      const probe = document.createElement("div"),
        original = inlineStyle(entry.attribute);
      probe.style.cssText = node.style.cssText;
      restoreOwnedStyle(probe, entry);
      for (const name of [...original])
        if (styleGroup(name) === group) original.removeProperty(name);
      for (const declaration of declarations(probe))
        if (styleGroup(declaration[0]) === group)
          original.setProperty(...declaration);
      entry.attribute =
        original.cssText || (entry.attribute === null ? null : "");
      entry.rebased.add(group);
    }
    node.style.setProperty(property, value, "important");
    entry.applied.setProperty(property, value, "important");
    revision.attribute = entry.attribute;
    revision.writes.set(property, value);
  }
  function absoluteBlockInPane(node) {
    for (let parent = node; parent; parent = parent.parentElement) {
      const css = getComputedStyle(parent);
      if (css.position !== "static" || establishesFixedBlock(css))
        return saved.target.contains(parent);
    }
    return false;
  }
  function releasePanePseudo(node, pseudo) {
    clearPanePaintRule(node, pseudo);
    const css = getComputedStyle(node, pseudo);
    if (["none", "normal"].includes(css.content)) return;
    if (css.position === "sticky")
      panePaintRule(
        node,
        pseudo,
        "position:relative!important;inset:auto!important;inset-block:auto!important;inset-inline:auto!important",
      );
    else if (
      /^['"]\s*['"]$/.test(css.content) &&
      thinPanePseudo(css, { width: 160, height: 160 }) &&
      ((css.position === "fixed" &&
        !establishesFixedBlock(getComputedStyle(node)) &&
        !hasFixedContainingBlock(node)) ||
        (css.position === "absolute" && !absoluteBlockInPane(node)))
    )
      panePaintRule(
        node,
        pseudo,
        "opacity:0!important;visibility:hidden!important",
      );
  }
  function releaseSticky() {
    saved.ownershipEpoch++;
    for (const node of captureNodes()) {
      if (saved.target)
        for (const pseudo of ["::before", "::after"])
          releasePanePseudo(node, pseudo);
      if (getComputedStyle(node).position !== "sticky") continue;
      // Keep the containing block for absolutely positioned children, without pinning it.
      setStyle(node, "position", "relative");
      for (const inset of ["top", "right", "bottom", "left"])
        setStyle(node, inset, "auto");
    }
    if (saved.target)
      for (const pseudo of ["::before", "::after"])
        releasePanePseudo(saved.target, pseudo);
  }
  function rememberFlow() {
    const view = captureView();
    for (const node of captureNodes()) {
      const css = getComputedStyle(node),
        rect = contentRect(node, view);
      saved.initial.set(node, {
        position: css.position,
        display: css.display,
        x: rect.left + view.x,
        y: rect.top + view.y,
        width: node.offsetWidth || rect.width,
        height: node.offsetHeight || rect.height,
        next: node.nextElementSibling,
        margins: ["top", "right", "bottom", "left"].map((side) =>
          css.getPropertyValue(`margin-${side}`),
        ),
      });
    }
  }
  function establishesFixedBlock(css) {
    return (
      css.transform !== "none" ||
      css.scale !== "none" ||
      css.rotate !== "none" ||
      css.translate !== "none" ||
      css.perspective !== "none" ||
      css.filter !== "none" ||
      css.backdropFilter !== "none" ||
      ["auto", "hidden"].includes(css.contentVisibility) ||
      /paint|layout|strict|content/.test(css.contain) ||
      /transform|scale|rotate|translate|perspective|filter/.test(css.willChange)
    );
  }
  function hasFixedContainingBlock(node) {
    for (
      let parent = node.parentElement;
      parent && parent !== document.documentElement;
      parent = parent.parentElement
    ) {
      const css = getComputedStyle(parent);
      if (establishesFixedBlock(css))
        return !saved?.target || saved.target.contains(parent);
    }
    return false;
  }
  function placeFixed(mode) {
    saved.ownershipEpoch++;
    // Keep viewport-fixed positioning: converting to absolute would make overflow
    // ancestors clip bars that previously escaped them. Move them with document scroll.
    const view = captureView();
    const candidates = [...captureNodes()]
      .filter(
        (node) =>
          !saved.fixed.has(node) &&
          getComputedStyle(node).position === "fixed" &&
          !hasFixedContainingBlock(node),
      )
      .map((node) => {
        const css = getComputedStyle(node);
        return {
          node,
          rect: contentRect(node, view),
          css: {
            bottom: css.bottom,
            visibility: css.visibility,
            display: css.display,
          },
        };
      });
    for (const { node, rect, css } of candidates) {
      if (
        !rect.width ||
        !rect.height ||
        css.visibility === "hidden" ||
        css.display === "none"
      )
        continue;
      // Hidden drawers must never become visible in a wider or taller capture.
      const offscreen =
        rect.right <= 0 ||
        rect.left >= view.width ||
        rect.bottom <= 0 ||
        rect.top >= view.height;
      if (mode === "hide" || offscreen) {
        setStyle(node, "visibility", "hidden");
        continue;
      }
      const original = saved.initial.get(node);
      const absoluteSource =
        original?.position === "absolute" && original.width && original.height;
      const flowSource =
        original &&
        !["fixed", "absolute"].includes(original.position) &&
        original.width &&
        original.height;
      if (flowSource) {
        const next = original.next,
          anchor = saved.initial.get(next),
          current = next && contentRect(next, view);
        const flowRetained =
          anchor &&
          current &&
          Math.abs(current.top + view.y - anchor.y) < 2 &&
          Math.abs(current.left + view.x - anchor.x) < 2;
        if (!flowRetained) {
          // A scroll-triggered header left flow without a placeholder. Keep its original slot.
          for (const [property, value] of Object.entries({
            position: "relative",
            top: "auto",
            right: "auto",
            bottom: "auto",
            left: "auto",
            width: `${original.width}px`,
            height: `${original.height}px`,
            "box-sizing": "border-box",
            display: original.display,
          }))
            setStyle(node, property, value);
          ["top", "right", "bottom", "left"].forEach((side, index) =>
            setStyle(node, `margin-${side}`, original.margins[index]),
          );
          continue;
        }
      }
      const borderWidth = node.offsetWidth || rect.width,
        borderHeight = node.offsetHeight || rect.height;
      const sidebar =
        !flowSource &&
        rect.height >= view.height * 0.8 &&
        rect.width < view.width * 0.5 &&
        (rect.left < 24 || rect.right > view.width - 24);
      const footer =
        !flowSource &&
        !sidebar &&
        rect.bottom >= view.height - 24 &&
        rect.height < view.height * 0.5 &&
        (css.bottom !== "auto" || rect.top > view.height * 0.6);
      saved.fixed.set(node, {
        // A newly inserted viewport-fixed bar belongs to the first viewport,
        // even when first observed during prewarming or a later capture frame.
        // Existing page content retains its known document-space anchor.
        left: flowSource || absoluteSource ? original.x : rect.left,
        top: flowSource || absoluteSource ? original.y : rect.top,
        sidebar,
        footer,
        right: sidebar && rect.right > view.width - 24,
        rightGap: Math.max(0, view.width - rect.right),
        bottomGap: Math.max(0, view.height - rect.bottom),
        visualWidth: rect.width,
        visualHeight: rect.height,
        borderWidth,
        borderHeight,
        scaleY: rect.height / borderHeight,
      });
    }
    const page = dimensions(),
      placements = [];
    for (const [node, item] of saved.fixed) {
      const css = getComputedStyle(node);
      if (css.display === "none" || css.visibility === "hidden") continue;
      const left = item.right
        ? page.width - item.rightGap - item.visualWidth
        : item.left;
      const top = item.footer
        ? page.height - item.bottomGap - item.visualHeight
        : item.top;
      const height = item.sidebar
        ? Math.max(
            item.visualHeight,
            page.height - Math.max(0, top) - item.bottomGap,
          ) / item.scaleY
        : item.borderHeight;
      const viewportLeft = view.left + left - view.x,
        viewportTop = view.top + top - view.y;
      placements.push({ node, item, viewportLeft, viewportTop, height });
    }
    // Read computed styles before writing, then batch placement and transform corrections.
    // Alternating writes and geometry reads here forces one full layout per fixed element.
    for (const {
      node,
      item,
      viewportLeft,
      viewportTop,
      height,
    } of placements) {
      for (const [property, value] of Object.entries({
        position: "fixed",
        left: `${viewportLeft}px`,
        top: `${viewportTop}px`,
        right: "auto",
        bottom: "auto",
        width: `${item.borderWidth}px`,
        height: `${height}px`,
        "box-sizing": "border-box",
        "margin-top": "0",
        "margin-right": "0",
        "margin-bottom": "0",
        "margin-left": "0",
        "min-width": "0",
        "max-width": "none",
        "min-height": "0",
        "max-height": "none",
      }))
        setStyle(node, property, value);
    }
    const corrections = placements.map(
      ({ node, viewportLeft, viewportTop }) => {
        // Own transforms remain intact; dimensions above are pre-transform border boxes.
        const placed = node.getBoundingClientRect();
        return {
          node,
          left: viewportLeft + viewportLeft - placed.left,
          top: viewportTop + viewportTop - placed.top,
        };
      },
    );
    for (const { node, left, top } of corrections) {
      setStyle(node, "left", `${left}px`);
      setStyle(node, "top", `${top}px`);
    }
    hidePaneOverlays();
  }
  async function prepare(message) {
    const target = message.mode === "full" ? selectedTarget : null;
    const element = message.mode === "full" ? selectedElement : null;
    restore();
    if (message.preserveLayout && message.mode !== "full") return dimensions();
    const style = document.createElement("style");
    style.textContent =
      "html{scroll-behavior:auto!important;scroll-snap-type:none!important}*{animation-play-state:paused!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important;scroll-snap-type:none!important}::-webkit-scrollbar{display:none!important}";
    saved = {
      x: scrollX,
      y: scrollY,
      style,
      changed: new Map(),
      owners: new Map(),
      ownershipTokens: new Map(),
      ownershipEpoch: 0,
      initial: new Map(),
      fixed: new Map(),
      paintMarkers: new Map(),
      paintRules: new Map(),
      paintStyles: new Map(),
      paintPrefix: `cs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
      target,
      originalPane: target
        ? {
            box: clientBox(target),
            scroll: scrollOffset(target),
            rootX: scrollX,
            rootY: scrollY,
          }
        : null,
      element,
      scrolls: new Map(),
      bars: message.bars || "smart",
    };
    const session = saved;
    saved.cloneObserver = new MutationObserver(adoptClones);
    saved.cloneObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    if (target)
      for (let node = target; node; node = node.parentElement)
        saved.scrolls.set(node, { left: node.scrollLeft, top: node.scrollTop });
    document.documentElement.append(style);
    if (message.clean) {
      style.textContent +=
        "*{pointer-events:none!important} [role=tooltip]{visibility:hidden!important}";
      for (const node of document.querySelectorAll("body *")) {
        if (node.hasAttribute("data-capture-studio-picker")) continue;
        const css = getComputedStyle(node),
          r = node.getBoundingClientRect();
        if (
          css.position === "fixed" &&
          r.width > 0 &&
          r.height > 0 &&
          r.width < innerWidth * 0.35 &&
          r.height < innerHeight * 0.35 &&
          (r.right > innerWidth - 70 || r.left < 70) &&
          (r.bottom > innerHeight - 100 || r.top < 100)
        )
          setStyle(node, "visibility", "hidden");
      }
    }
    arm();
    if (target) {
      target.scrollIntoView({
        block: "nearest",
        inline: "nearest",
        behavior: "instant",
      });
      paneBox(target);
      for (let node = target; node; node = node.parentElement) {
        const css = getComputedStyle(node);
        if (
          node === target ||
          /auto|scroll|hidden|clip|overlay/.test(
            `${css.overflowX} ${css.overflowY}`,
          ) ||
          /paint|strict|content/.test(css.contain) ||
          css.contentVisibility === "auto"
        )
          setStyle(node, "border-radius", "0");
      }
      setStyle(target, "overflow-anchor", "none");
    }
    if (message.mode === "full") {
      moveTo(0, 0);
      await wait(120);
      if (saved !== session) throw new Error("Capture was cancelled.");
      rememberFlow();
      releaseSticky();
      arm();
      const initial = dimensions();
      const viewportHeight = initial.captureViewportHeight || innerHeight;
      const viewportWidth = initial.captureViewportWidth || innerWidth;
      const steps = target
        ? 40
        : Math.min(40, Math.ceil(initial.height / innerHeight));
      let x = 0,
        y = 0;
      for (let i = 0; i < steps; i++) {
        if (saved !== session) throw new Error("Capture was cancelled.");
        moveTo(target ? x : 0, target ? y : i * innerHeight);
        await wait(70);
        if (saved !== session) throw new Error("Capture was cancelled.");
        if (target) await visibleImages(350);
        if (saved !== session) throw new Error("Capture was cancelled.");
        releaseSticky();
        placeFixed(message.bars || "smart");
        arm();
        if (target) {
          const height = target.scrollHeight,
            width = target.scrollWidth;
          if (x + viewportWidth < width)
            x = Math.min(x + viewportWidth, width - viewportWidth);
          else if (y + viewportHeight < height) {
            x = 0;
            y = Math.min(y + viewportHeight, height - viewportHeight);
          } else break;
        }
      }
      if (saved !== session) throw new Error("Capture was cancelled.");
      moveTo(0, 0);
    }
    await Promise.race([document.fonts?.ready || Promise.resolve(), wait(700)]);
    await wait(120);
    if (saved !== session) throw new Error("Capture was cancelled.");
    if (message.mode === "full") {
      releaseSticky();
      placeFixed(message.bars || "smart");
      await wait(100);
    }
    if (saved !== session) throw new Error("Capture was cancelled.");
    return dimensions();
  }
  async function scroll(message) {
    if (!saved)
      throw new Error("The capture session expired. Please try again.");
    const session = saved;
    arm();
    moveTo(message.x, message.y);
    await wait(180);
    if (saved !== session) throw new Error("Capture was cancelled.");
    releaseSticky();
    placeFixed(saved.bars);
    // Restoring a scroll-triggered bar's flow slot can expand the document after the
    // browser clamped the initial scroll. Reapply the requested coordinate before capture.
    moveTo(message.x, message.y);
    await wait(60);
    if (saved !== session) throw new Error("Capture was cancelled.");
    placeFixed(saved.bars);
    await visibleImages(700);
    if (saved !== session) throw new Error("Capture was cancelled.");
    return frame();
  }
  function visibleImages(timeout) {
    return Promise.race([
      Promise.all(
        [
          ...(saved.target
            ? saved.target.querySelectorAll("img")
            : document.images),
        ]
          .filter((img) => {
            const rect = img.getBoundingClientRect();
            return !img.complete && rect.bottom > 0 && rect.top < innerHeight;
          })
          .map((img) => img.decode().catch(() => {})),
      ),
      wait(timeout),
    ]);
  }
  function frame() {
    if (!saved)
      throw new Error("The capture session expired. Please try again.");
    arm();
    const { x, y } = captureView();
    return {
      ...dimensions(),
      x,
      y,
    };
  }
  function selectRegion() {
    return new Promise((resolve, reject) => {
      const host = document.createElement("div");
      host.style.cssText =
        "position:fixed;inset:0;z-index:2147483647;cursor:crosshair;touch-action:none;";
      const shadow = host.attachShadow({ mode: "closed" });
      shadow.innerHTML =
        '<style>:host{all:initial}.shade{position:fixed;inset:0;background:#11182755}.box{position:fixed;border:2px solid #a5b4fc;background:transparent;box-shadow:0 0 0 100vmax #11182766;display:none;pointer-events:none}.hint{position:fixed;top:20px;left:50%;transform:translateX(-50%);background:#141826;color:white;border:1px solid #ffffff33;border-radius:12px;padding:12px 20px;font:14px system-ui;pointer-events:none}</style><div class="shade"></div><div class="box"></div><div class="hint">Drag to capture a region · Esc to cancel</div>';
      document.documentElement.append(host);
      let start,
        finished = false;
      const box = shadow.querySelector(".box");
      const cleanup = () => {
        clearTimeout(timeout);
        host.remove();
        window.removeEventListener("keydown", key, true);
        if (!finished) {
          finished = true;
          reject(new Error("Region capture cancelled."));
        }
        selectionCleanup = null;
      };
      selectionCleanup = cleanup;
      const key = (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopImmediatePropagation();
          cleanup();
        }
      };
      const timeout = setTimeout(cleanup, 120000);
      window.addEventListener("keydown", key, true);
      host.onpointerdown = (event) => {
        if (event.button !== 0) return;
        start = { x: event.clientX, y: event.clientY };
        host.setPointerCapture(event.pointerId);
      };
      host.onpointermove = (event) => {
        if (!start) return;
        box.style.display = "block";
        box.style.left = `${Math.min(start.x, event.clientX)}px`;
        box.style.top = `${Math.min(start.y, event.clientY)}px`;
        box.style.width = `${Math.abs(event.clientX - start.x)}px`;
        box.style.height = `${Math.abs(event.clientY - start.y)}px`;
      };
      host.onpointerup = async (event) => {
        if (!start) return;
        const x = Math.max(0, Math.min(start.x, event.clientX)),
          y = Math.max(0, Math.min(start.y, event.clientY));
        const region = {
          x,
          y,
          width: Math.min(innerWidth, Math.max(start.x, event.clientX)) - x,
          height: Math.min(innerHeight, Math.max(start.y, event.clientY)) - y,
        };
        if (region.width < 5 || region.height < 5) {
          start = null;
          return;
        }
        finished = true;
        cleanup();
        await wait(120);
        resolve(region);
      };
    });
  }
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (
      sender.id !== chrome.runtime.id ||
      !message.type?.startsWith("CS_PAGE_")
    )
      return;
    const execute = async () => {
      if (message.type === "CS_PAGE_PING")
        return {
          presentationActive: Boolean(globalThis.__captureStudioPresentation),
        };
      if (message.type === "CS_PAGE_SELECT_ELEMENT") return selectElement();
      if (message.type === "CS_PAGE_PREPARE") return prepare(message);
      if (message.type === "CS_PAGE_TARGET")
        return resolveTarget(message.scope);
      if (message.type === "CS_PAGE_SELECT_PANE") return selectPane();
      if (message.type === "CS_PAGE_SCROLL") return scroll(message);
      if (message.type === "CS_PAGE_FRAME") return frame();
      if (message.type === "CS_PAGE_SELECT") return selectRegion();
      if (message.type === "CS_PAGE_RESTORE") {
        restore();
        return true;
      }
      throw new Error("Unknown capture instruction.");
    };
    execute().then(
      (data) => respond({ ok: true, data }),
      (error) => respond({ ok: false, error: error.message }),
    );
    return true;
  });
  window.addEventListener("pagehide", restore);
})();
