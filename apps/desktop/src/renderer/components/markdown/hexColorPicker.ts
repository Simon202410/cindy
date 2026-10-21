import { EditorView } from '@codemirror/view';

import { formatHexColor, hsvToRgb, parseHexColor, rgbToHsv } from './plaintextEditorChrome';

const HIDE_DELAY_MS = 160;
const PICKER_GAP = 8;
const controllers = new WeakMap<EditorView, HexColorPickerController>();

export function bindHexColorSwatch(swatch: HTMLElement, view: EditorView): void {
  let controller = controllers.get(view);
  if (!controller) {
    controller = new HexColorPickerController(view);
    controllers.set(view, controller);
  }
  const owner = controller;

  swatch.tabIndex = 0;
  swatch.setAttribute('role', 'button');
  swatch.setAttribute('aria-haspopup', 'group');
  swatch.addEventListener('pointerenter', () => owner.hover(swatch));
  swatch.addEventListener('pointerleave', () => owner.scheduleClose(swatch));
  swatch.addEventListener('focus', () => owner.open(swatch, true));
  swatch.addEventListener('blur', () => owner.scheduleClose(swatch));
  swatch.addEventListener('mousedown', (event) => event.preventDefault());
  swatch.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    owner.toggle(swatch);
  });
  swatch.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      owner.close();
      return;
    }
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    owner.open(swatch, true);
    owner.focusPicker();
  });
}

export function destroyHexColorPicker(view: EditorView): void {
  controllers.get(view)?.destroy();
  controllers.delete(view);
}

function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  return element;
}

class HexColorPickerController {
  private readonly panel = createElement('div', 'cm-hex-picker');
  private readonly nativeInput = createElement('input', 'cm-hex-picker__native');
  private readonly hexInput = createElement('input', 'cm-hex-picker__hex');
  private readonly svArea = createElement('div', 'cm-hex-picker__sv');
  private readonly svHandle = createElement('span', 'cm-hex-picker__handle');
  private readonly hueArea = createElement('div', 'cm-hex-picker__hue');
  private readonly hueHandle = createElement('span', 'cm-hex-picker__handle');
  private anchor: HTMLElement | null = null;
  private pinned = false;
  private hideTimer: number | null = null;
  private flushFrame: number | null = null;
  private pendingHex: string | null = null;
  private documentHex = '';
  private currentHex = '';
  private hue = 0;
  private saturation = 0;
  private value = 0;
  private alpha = 255;
  private hasAlpha = false;
  private uppercase = false;

  constructor(private readonly view: EditorView) {
    this.panel.hidden = true;
    this.panel.setAttribute('role', 'group');
    this.panel.setAttribute('aria-label', 'HEX');

    const header = createElement('div', 'cm-hex-picker__header');
    this.nativeInput.type = 'color';
    this.nativeInput.setAttribute('aria-label', 'HEX');
    this.hexInput.type = 'text';
    this.hexInput.spellcheck = false;
    this.hexInput.autocomplete = 'off';
    this.hexInput.setAttribute('aria-label', 'HEX');
    header.append(this.nativeInput, this.hexInput);

    const body = createElement('div', 'cm-hex-picker__body');
    body.setAttribute('aria-hidden', 'true');
    this.svArea.append(this.svHandle);
    this.hueArea.append(this.hueHandle);
    body.append(this.svArea, this.hueArea);
    this.panel.append(header, body);
    document.body.append(this.panel);

    this.nativeInput.addEventListener('input', () => {
      const parsed = parseHexColor(this.nativeInput.value);
      if (!parsed) return;
      this.applyRgb(parsed.r, parsed.g, parsed.b, false);
    });
    this.nativeInput.addEventListener('change', () => this.commitPending());
    this.hexInput.addEventListener('input', () => {
      const raw = this.hexInput.value.trim();
      const next = raw.startsWith('#') ? raw : `#${raw}`;
      const parsed = parseHexColor(next);
      this.hexInput.setAttribute('aria-invalid', parsed ? 'false' : 'true');
      if (parsed) this.applyHex(next, 'hex');
    });
    this.hexInput.addEventListener('blur', () => {
      if (this.hexInput.getAttribute('aria-invalid') === 'true') {
        this.hexInput.value = this.currentHex;
        this.hexInput.setAttribute('aria-invalid', 'false');
      }
    });
    this.hexInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.hexInput.blur();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        this.close();
      }
    });

    this.svArea.addEventListener('pointerdown', (event) => {
      if (!this.isEditable()) return;
      event.preventDefault();
      event.stopPropagation();
      this.svArea.setPointerCapture(event.pointerId);
      this.updateSaturationValue(event);
    });
    this.svArea.addEventListener('pointermove', (event) => {
      if (!this.svArea.hasPointerCapture(event.pointerId)) return;
      this.updateSaturationValue(event);
    });
    this.svArea.addEventListener('pointerup', (event) => {
      if (this.svArea.hasPointerCapture(event.pointerId)) {
        this.svArea.releasePointerCapture(event.pointerId);
      }
      this.commitPending();
    });
    this.svArea.addEventListener('pointercancel', () => this.commitPending());
    this.hueArea.addEventListener('pointerdown', (event) => {
      if (!this.isEditable()) return;
      event.preventDefault();
      event.stopPropagation();
      this.hueArea.setPointerCapture(event.pointerId);
      this.updateHue(event);
    });
    this.hueArea.addEventListener('pointermove', (event) => {
      if (!this.hueArea.hasPointerCapture(event.pointerId)) return;
      this.updateHue(event);
    });
    this.hueArea.addEventListener('pointerup', (event) => {
      if (this.hueArea.hasPointerCapture(event.pointerId)) {
        this.hueArea.releasePointerCapture(event.pointerId);
      }
      this.commitPending();
    });
    this.hueArea.addEventListener('pointercancel', () => this.commitPending());

    this.panel.addEventListener('pointerenter', () => this.cancelScheduledClose());
    this.panel.addEventListener('pointerleave', () => this.scheduleClose());
    window.addEventListener('pointerdown', this.handleOutsidePointerDown, true);
    window.addEventListener('keydown', this.handleWindowKeyDown, true);
    window.addEventListener('resize', this.handleViewportChange);
    view.scrollDOM.addEventListener('scroll', this.handleViewportChange, { passive: true });
  }

  hover(anchor: HTMLElement): void {
    if (this.pinned && this.anchor !== anchor) return;
    this.open(anchor, false);
  }

  open(anchor: HTMLElement, pinned: boolean): void {
    const raw = anchor.dataset.color;
    const parsed = raw ? parseHexColor(raw) : null;
    if (!raw || !parsed) return;
    this.cancelScheduledClose();
    if (this.anchor && this.anchor !== anchor) {
      this.anchor.setAttribute('aria-expanded', 'false');
    }
    this.anchor = anchor;
    anchor.setAttribute('aria-expanded', 'true');
    this.pinned = this.pinned || pinned;
    this.documentHex = raw.startsWith('#') ? raw : `#${raw}`;
    this.currentHex = this.documentHex;
    this.uppercase = /[A-F]/.test(this.documentHex.slice(1));
    this.alpha = parsed.a;
    this.hasAlpha = parsed.hasAlpha;
    const hsv = rgbToHsv(parsed.r, parsed.g, parsed.b);
    this.hue = hsv.h;
    this.saturation = hsv.s;
    this.value = hsv.v;
    this.panel.dataset.readonly = String(!this.isEditable());
    this.nativeInput.disabled = !this.isEditable();
    this.hexInput.readOnly = !this.isEditable();
    this.hexInput.value = this.currentHex;
    this.hexInput.setAttribute('aria-invalid', 'false');
    this.renderPicker();
    this.panel.hidden = false;
    this.positionPanel();
  }

  toggle(anchor: HTMLElement): void {
    if (this.anchor === anchor && !this.panel.hidden) {
      if (!this.pinned) {
        this.pinned = true;
        this.cancelScheduledClose();
      } else {
        this.close();
      }
      return;
    }
    this.open(anchor, true);
  }

  focusPicker(): void {
    if (this.panel.hidden) return;
    if (!this.nativeInput.disabled) this.nativeInput.focus();
    else this.hexInput.focus();
  }

  scheduleClose(anchor?: HTMLElement): void {
    if (anchor && (this.anchor !== anchor || this.pinned)) return;
    this.cancelScheduledClose();
    this.hideTimer = window.setTimeout(() => {
      this.hideTimer = null;
      if (this.pinned) return;
      if (
        this.panel.matches(':hover') ||
        (document.activeElement instanceof Node && this.panel.contains(document.activeElement))
      ) {
        return;
      }
      this.close();
    }, HIDE_DELAY_MS);
  }

  close(): void {
    this.flush();
    this.cancelScheduledClose();
    this.anchor?.setAttribute('aria-expanded', 'false');
    this.anchor = null;
    this.pinned = false;
    this.panel.hidden = true;
  }

  destroy(): void {
    this.pendingHex = null;
    if (this.flushFrame !== null) cancelAnimationFrame(this.flushFrame);
    this.cancelScheduledClose();
    this.anchor?.setAttribute('aria-expanded', 'false');
    this.anchor = null;
    window.removeEventListener('pointerdown', this.handleOutsidePointerDown, true);
    window.removeEventListener('keydown', this.handleWindowKeyDown, true);
    window.removeEventListener('resize', this.handleViewportChange);
    this.view.scrollDOM.removeEventListener('scroll', this.handleViewportChange);
    this.panel.remove();
  }

  private readonly handleOutsidePointerDown = (event: PointerEvent): void => {
    if (this.panel.hidden) return;
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (this.panel.contains(target) || this.anchor?.contains(target)) return;
    this.close();
  };

  private readonly handleWindowKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && !this.panel.hidden) this.close();
  };

  private readonly handleViewportChange = (): void => {
    if (!this.panel.hidden) this.close();
  };

  private isEditable(): boolean {
    return this.view.state.facet(EditorView.editable);
  }

  private updateSaturationValue(event: PointerEvent): void {
    const rect = this.svArea.getBoundingClientRect();
    this.saturation = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    this.value = 1 - Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
    const rgb = hsvToRgb(this.hue, this.saturation, this.value);
    this.applyRgb(rgb.r, rgb.g, rgb.b, false);
  }

  private updateHue(event: PointerEvent): void {
    const rect = this.hueArea.getBoundingClientRect();
    this.hue = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)) * 360;
    const rgb = hsvToRgb(this.hue, this.saturation, this.value);
    this.applyRgb(rgb.r, rgb.g, rgb.b, false);
  }

  private applyRgb(r: number, g: number, b: number, commit = true): void {
    this.applyHex(
      formatHexColor({ r, g, b, a: this.alpha, hasAlpha: this.hasAlpha }, this.uppercase),
      'control',
      commit,
    );
  }

  private applyHex(
    nextHex: string,
    source: 'hex' | 'control',
    commit = true,
  ): void {
    const parsed = parseHexColor(nextHex);
    if (!parsed || !this.isEditable()) return;
    this.currentHex = nextHex;
    this.alpha = parsed.a;
    this.hasAlpha = parsed.hasAlpha;
    this.uppercase = /[A-F]/.test(nextHex.slice(1));
    const hsv = rgbToHsv(parsed.r, parsed.g, parsed.b);
    this.hue = hsv.h;
    this.saturation = hsv.s;
    this.value = hsv.v;
    if (source !== 'hex') this.hexInput.value = nextHex;
    this.renderPicker();
    if (commit) this.queueDocumentChange(nextHex);
    else this.stageColor(nextHex);
  }

  private renderPicker(): void {
    const pureHue = formatHexColor({
      ...hsvToRgb(this.hue, 1, 1),
      a: 255,
      hasAlpha: false,
    });
    this.svArea.style.background =
      `linear-gradient(to top, hsl(0 0% 0%), transparent), ` +
      `linear-gradient(to right, hsl(0 0% 100%), ${pureHue})`;
    this.svHandle.style.left = `${this.saturation * 100}%`;
    this.svHandle.style.top = `${(1 - this.value) * 100}%`;
    this.hueHandle.style.top = `${(this.hue / 360) * 100}%`;
    const parsed = parseHexColor(this.currentHex);
    this.nativeInput.value = formatHexColor({
      r: parsed?.r ?? 0,
      g: parsed?.g ?? 0,
      b: parsed?.b ?? 0,
      a: 255,
      hasAlpha: false,
    });
    this.anchor?.style.setProperty('background-color', this.currentHex);
    if (this.anchor) {
      this.anchor.dataset.color = this.currentHex;
      this.anchor.setAttribute('aria-label', this.currentHex);
    }
  }

  private queueDocumentChange(nextHex: string): void {
    this.stageColor(nextHex);
    this.commitPending();
  }

  private stageColor(nextHex: string): void {
    if (nextHex === this.documentHex && this.pendingHex === null) return;
    this.pendingHex = nextHex;
  }

  private commitPending(): void {
    if (this.pendingHex === null) return;
    if (this.flushFrame !== null) return;
    this.flushFrame = window.requestAnimationFrame(() => {
      this.flushFrame = null;
      this.flush();
    });
  }

  private flush(): void {
    const nextHex = this.pendingHex;
    this.pendingHex = null;
    if (!nextHex || !this.anchor || !this.isEditable()) return;
    try {
      const from = this.view.posAtDOM(this.anchor);
      const current = this.view.state.doc.sliceString(from, from + this.documentHex.length);
      if (!parseHexColor(current)) return;
      if (current !== nextHex) {
        this.view.dispatch({
          changes: { from, to: from + current.length, insert: nextHex },
          userEvent: 'input',
        });
      }
      this.documentHex = nextHex;
    } catch {
      this.close();
    }
  }

  private positionPanel(): void {
    if (!this.anchor || this.panel.hidden) return;
    const anchorRect = this.anchor.getBoundingClientRect();
    const panelRect = this.panel.getBoundingClientRect();
    if (
      anchorRect.bottom < 0 ||
      anchorRect.top > window.innerHeight ||
      anchorRect.right < 0 ||
      anchorRect.left > window.innerWidth
    ) {
      this.close();
      return;
    }
    const left = Math.min(
      Math.max(PICKER_GAP, anchorRect.left),
      Math.max(PICKER_GAP, window.innerWidth - panelRect.width - PICKER_GAP),
    );
    let top = anchorRect.bottom + PICKER_GAP;
    if (top + panelRect.height > window.innerHeight - PICKER_GAP) {
      top = anchorRect.top - panelRect.height - PICKER_GAP;
    }
    this.panel.style.left = `${left}px`;
    this.panel.style.top = `${Math.max(PICKER_GAP, top)}px`;
  }

  private cancelScheduledClose(): void {
    if (this.hideTimer === null) return;
    window.clearTimeout(this.hideTimer);
    this.hideTimer = null;
  }
}
