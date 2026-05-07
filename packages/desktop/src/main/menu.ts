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
      return {
        label: 'View',
        submenu: topItem.submenu.items
          .filter((sub) => sub.role !== 'toggleDevTools')
          .map((sub) => ({ role: sub.role, label: sub.label, accelerator: sub.accelerator ?? undefined })),
      };
    }
    if (topItem.role === 'help' && topItem.submenu) {
      const helpSubmenu = topItem.submenu.items.map((sub) => ({
        role: sub.role,
        label: sub.label,
        accelerator: sub.accelerator ?? undefined,
      }));
      return {
        label: topItem.label || 'Help',
        role: 'help' as const,
        submenu: [checkForUpdatesItem, { type: 'separator' as const }, ...helpSubmenu],
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
