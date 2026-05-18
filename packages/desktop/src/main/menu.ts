import { Menu, BrowserWindow } from 'electron';
import { createMainLogger } from './logger.js';
import { checkForUpdatesManual } from './auto-updater.js';

const log = createMainLogger('electron:menu');

export function buildApplicationMenu(getWindow: () => BrowserWindow | null): void {
  const menu = Menu.getApplicationMenu();
  if (!menu) {
    log.warn('buildApplicationMenu: no application menu found');
    return;
  }

  const isProduction = process.env.NODE_ENV !== 'development';

  const checkForUpdatesItem: Electron.MenuItemConstructorOptions = {
    label: 'Check for Updates…',
    enabled: isProduction,
    click: () => {
      const win = getWindow();
      if (win) void checkForUpdatesManual(win);
    },
  };

  const newItems = menu.items.map((topItem): Electron.MenuItemConstructorOptions | Electron.MenuItem => {
    if (topItem.label === 'View' && topItem.submenu && isProduction) {
      // Pass live MenuItem instances through; buildFromTemplate accepts MenuItem
      // at every nesting level, so we preserve type/click/submenu/etc. losslessly.
      // Electron normalizes role to lowercase at runtime, so we compare case-insensitively.
      return {
        label: 'View',
        submenu: topItem.submenu.items.filter(
          (sub) => (sub.role ?? '').toLowerCase() !== 'toggledevtools',
        ) as unknown as Electron.MenuItemConstructorOptions[],
      };
    }
    if (topItem.role === 'help' && topItem.submenu) {
      return {
        label: topItem.label || 'Help',
        role: 'help' as const,
        submenu: [
          checkForUpdatesItem,
          { type: 'separator' as const },
          ...topItem.submenu.items,
        ] as unknown as Electron.MenuItemConstructorOptions[],
      };
    }
    return topItem;
  });

  // If the default menu has no Help submenu (e.g. some Linux distros),
  // append one ourselves so the item is always reachable.
  const hasHelp = newItems.some((item) => item.role === 'help');
  if (!hasHelp) {
    newItems.push({ label: 'Help', role: 'help', submenu: [checkForUpdatesItem] });
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate(newItems));
}
