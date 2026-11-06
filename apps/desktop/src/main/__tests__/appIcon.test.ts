import { app, nativeImage, type NativeImage } from 'electron';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createRuntimeAppIconController, initializeRuntimeAppIcon } from '../app-icon.js';

/* Runtime app-icon contract: test native Dock/window effects, reset, future
 * windows and decode failures through the production controller. No existing
 * test covers this OS projection. Tier: unit; no Electron or child process. */
const image = (empty = false) => ({ isEmpty: () => empty }) as NativeImage;
function fixture(platform: NodeJS.Platform) {
  const original = image(), custom = image();
  const dock = { setIcon: vi.fn() };
  const win = { isDestroyed: () => false, setIcon: vi.fn() };
  const decode = vi.fn(() => custom);
  const controller = createRuntimeAppIconController({ platform, original, decode, dock, windows: () => [win] });
  return { controller, dock, win, original, custom, decode };
}
describe('runtime application icon', () => {
  /* Regression for unsigned mac packages: initialization must project
   * Resources/icon.png instead of app.getFileIcon(), which returns the generic
   * bundle icon. Existing controller tests only covered injected images.
   * Minimal failing input: packaged darwin + generic getFileIcon. Tier: unit. */
  it('uses the packaged icon asset instead of the generic bundle icon', async () => {
    const original = image(), dock = { setIcon: vi.fn() };
    Object.assign(app, { isPackaged: true, dock, getFileIcon: vi.fn(async () => image(true)) });
    Object.defineProperty(process, 'resourcesPath', {
      configurable: true,
      value: '/tmp/Cindy.app/Contents/Resources',
    });
    const fromPath = vi.spyOn(nativeImage, 'createFromPath').mockReturnValue(original);

    await initializeRuntimeAppIcon();

    expect(fromPath).toHaveBeenCalledWith(path.join('/tmp/Cindy.app/Contents/Resources', 'icon.png'));
    expect(app.getFileIcon).not.toHaveBeenCalled();
    expect(dock.setIcon).toHaveBeenLastCalledWith(original);
  });
  it('changes the macOS Dock with the native API and restores the original icon', () => {
    const h = fixture('darwin');
    h.controller.set(Buffer.from('png')); expect(h.dock.setIcon).toHaveBeenLastCalledWith(h.custom);
    h.controller.set(null); expect(h.dock.setIcon).toHaveBeenLastCalledWith(h.original);
    expect(h.win.setIcon).not.toHaveBeenCalled();
  });
  it.each(['win32', 'linux'] as const)('updates running and later-created %s windows', platform => {
    const h = fixture(platform), later = { isDestroyed: () => false, setIcon: vi.fn() };
    h.controller.set(Buffer.from('png')); expect(h.win.setIcon).toHaveBeenLastCalledWith(h.custom);
    h.controller.applyToWindow(later); expect(later.setIcon).toHaveBeenLastCalledWith(h.custom);
    h.controller.set(null); expect(h.win.setIcon).toHaveBeenLastCalledWith(h.original);
    expect(h.dock.setIcon).not.toHaveBeenCalled();
  });
  it('rejects empty native images without replacing the last applied icon', () => {
    const h = fixture('win32'), later = { isDestroyed: () => false, setIcon: vi.fn() };
    h.controller.set(Buffer.from('png')); h.decode.mockReturnValue(image(true));
    expect(() => h.controller.set(Buffer.from('bad'))).toThrow('INVALID_ICON');
    h.controller.applyToWindow(later); expect(later.setIcon).toHaveBeenLastCalledWith(h.custom);
  });
  it('propagates native failures and leaves destroyed windows alone', () => {
    const h = fixture('darwin'); h.dock.setIcon.mockImplementation(() => { throw new Error('native failure'); });
    expect(() => h.controller.set(Buffer.from('png'))).toThrow('native failure');
    const destroyed = { isDestroyed: () => true, setIcon: vi.fn() };
    fixture('linux').controller.applyToWindow(destroyed); expect(destroyed.setIcon).not.toHaveBeenCalled();
  });
});
