// Runs in the page. Reads the window as it looks now into static HTML the canvas runtime can draw.
// It works on a clone and only reads the live DOM, so React carries on and the next state can follow.

export interface Serialised {
  html: string;
  /** Stylesheets the page added at run time (CodeMirror, sonner, Radix), as text. */
  runtimeCss: string[];
}

export async function serialise(aliases: [string, string][]): Promise<Serialised> {
  const ZWSP = '​';
  // Attributes that change on every run (ids) or mean nothing on a board. Ids inside SVG stay: gradients use them.
  const DROP = /^(data-testid|data-.*-id|data-state-id|aria-controls|aria-labelledby|aria-describedby|id|jsaction)$/;

  const isBlock = (node: Node | null): boolean =>
    !node || (node instanceof Element && !/^(inline|contents)/.test(getComputedStyle(node).display));

  /** The canvas runtime drops whitespace-only text, so decide here what each run of whitespace is worth. */
  const whitespace = (text: Text): 'keep' | 'drop' | 'pin' => {
    if (/\S/.test(text.data)) return 'keep';
    const parent = text.parentElement;
    if (!parent || parent.closest('svg')) return 'keep';
    const style = getComputedStyle(parent);
    if (/pre|break-spaces/.test(style.whiteSpace)) return 'pin';
    if (/flex|grid/.test(style.display)) return 'drop';
    return isBlock(text.previousSibling) && isBlock(text.nextSibling) ? 'drop' : 'pin';
  };

  const dataUrl = async (src: string): Promise<string | null> => {
    try {
      const blob = await (await fetch(src)).blob();
      return await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.readAsDataURL(blob);
      });
    } catch {
      return null;
    }
  };

  /** How far a sticky element sits from its place in the flow. */
  const stickyShift = (el: HTMLElement): { x: number; y: number } => {
    const before = el.getBoundingClientRect();
    const inline = el.style.cssText;
    el.style.position = 'relative';
    el.style.inset = 'auto';
    const after = el.getBoundingClientRect();
    el.style.cssText = inline;
    return { x: before.x - after.x, y: before.y - after.y };
  };

  const jobs: Promise<void>[] = [];
  const doomed: ChildNode[] = [];
  const hovered = new Set(document.querySelectorAll(':hover'));
  const focusWithin = new Set(document.querySelectorAll(':focus-within'));

  const copyElement = (live: Element, copy: Element): void => {
    for (const name of copy.getAttributeNames()) {
      if (DROP.test(name) && !(name === 'id' && live.closest('svg'))) copy.removeAttribute(name);
    }
    if (hovered.has(live)) copy.setAttribute('data-dcb-hover', '');
    if (live.matches(':focus')) copy.setAttribute('data-dcb-focus', '');
    if (live.matches(':focus-visible')) copy.setAttribute('data-dcb-focus-visible', '');
    if (focusWithin.has(live)) copy.setAttribute('data-dcb-focus-within', '');
    if (live instanceof HTMLTextAreaElement) copy.textContent = live.value;
    if (live instanceof HTMLInputElement) {
      if (live.type === 'checkbox' || live.type === 'radio') copy.toggleAttribute('checked', live.checked);
      else copy.setAttribute('value', live.value);
    }
    if (live instanceof HTMLImageElement && !live.currentSrc.startsWith('data:') && live.currentSrc) {
      copy.removeAttribute('srcset');
      jobs.push(
        dataUrl(live.currentSrc).then((url) => {
          if (url) copy.setAttribute('src', url);
        }),
      );
    }
    if (live instanceof HTMLCanvasElement && live.width > 0 && live.height > 0) {
      const image = document.createElement('img');
      image.className = live.className;
      image.style.cssText = live.style.cssText;
      image.src = live.toDataURL();
      copy.replaceWith(image);
      return;
    }
    if (!(live instanceof HTMLElement) || !(copy instanceof HTMLElement)) return;
    const style = getComputedStyle(live);
    if (style.position === 'sticky') {
      const shift = stickyShift(live);
      copy.style.position = 'relative';
      copy.style.inset = 'auto';
      if (shift.x) copy.style.left = `${shift.x}px`;
      if (shift.y) copy.style.top = `${shift.y}px`;
    }
    // A clone starts at scroll 0: move each scrolled area's content to where it sits on screen.
    if (live.scrollTop || live.scrollLeft) {
      copy.style.overflow = 'hidden';
      for (const child of copy.children) {
        if (child instanceof HTMLElement) child.style.translate = `${-live.scrollLeft}px ${-live.scrollTop}px`;
      }
    }
  };

  const walk = (live: Node, copy: Node): void => {
    const pairs = [...live.childNodes].map((child, i) => [child, copy.childNodes[i]!] as const);
    for (const [liveChild, copyChild] of pairs) {
      if (
        liveChild instanceof Comment ||
        (liveChild instanceof Element && /^(SCRIPT|STYLE|LINK)$/.test(liveChild.tagName))
      ) {
        doomed.push(copyChild);
      } else if (liveChild instanceof Text) {
        const verdict = whitespace(liveChild);
        if (verdict === 'drop') doomed.push(copyChild);
        if (verdict === 'pin') (copyChild as Text).data = ZWSP + liveChild.data;
      } else if (liveChild instanceof Element) {
        const hidden =
          liveChild instanceof HTMLElement && liveChild.matches('[hidden], .mf-scrollbar:not([data-visible])');
        if (hidden) {
          doomed.push(copyChild);
          continue;
        }
        walk(liveChild, copyChild);
        copyElement(liveChild, copyChild as Element);
      }
    }
  };

  // The body, not #root: menus, tooltips, dialogs and the scrollbar thumb are portalled beside it.
  const clone = document.body.cloneNode(true) as HTMLElement;
  walk(document.body, clone);
  for (const node of doomed) node.remove();
  await Promise.all(jobs);

  const runtime = [
    ...[...document.styleSheets].filter((sheet) => sheet.ownerNode instanceof HTMLStyleElement),
    ...document.adoptedStyleSheets,
  ];
  return {
    html: aliases.reduce((html, [from, to]) => html.replaceAll(from, to), clone.innerHTML),
    runtimeCss: runtime.map((sheet) => [...sheet.cssRules].map((rule) => rule.cssText).join('\n')).filter(Boolean),
  };
}
