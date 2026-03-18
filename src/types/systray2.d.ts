/**
 * Minimal ambient type declarations for the `systray2` package.
 * systray2 ships no TypeScript types.  Only the API surface used by
 * `src/tray.ts` is declared here; additional properties exist at runtime.
 */

declare module "systray2" {
  export interface MenuItem {
    title:    string;
    tooltip:  string;
    enabled:  boolean;
    checked?: boolean;
    items?:   MenuItem[];
  }

  export interface SysTrayOptions {
    menu: {
      icon:    string;
      title:   string;
      tooltip: string;
      items:   MenuItem[];
    };
    debug?:   boolean;
    copyDir?: boolean;
  }

  export type ClickAction = { item: MenuItem };

  export default class SysTray {
    /** A pre-built separator menu item. */
    static readonly separator: MenuItem;

    constructor(options: SysTrayOptions);

    /** Register a click/activate handler. */
    onClick(handler: (action: ClickAction) => void): void;

    /** Destroy the tray icon. Pass `false` to skip process.exit. */
    kill(exit: boolean): void;
  }
}
