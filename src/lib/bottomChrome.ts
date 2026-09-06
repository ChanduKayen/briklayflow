/**
 * Which routes own the bottom of the screen on mobile.
 *
 * Several pages render their own fixed bottom chrome — a full-width action bar (PO detail,
 * transaction detail, the /…/new forms) or a page-level create FAB (the PO list). The global
 * bottom tab bar and the global FloatingActionButton both live at the same corner, so without
 * this they stack on top of each other and clip the page's own buttons.
 *
 * Both predicates take a pathname and are shared by App's BottomTabBar and FloatingActionButton
 * so the two can never disagree about who owns the corner.
 */

/** Pages with their own fixed, full-width bottom action bar — the tab bar tucks away for these. */
export const ownsBottomBar = (pathname: string): boolean =>
  /\/new$/.test(pathname)
  || /^\/purchase-orders\/[^/]+$/.test(pathname)
  || /^\/ledger\/(?!new$|import$)[^/]+$/.test(pathname);

/** Pages with their own primary create button, which the generic FAB would sit on top of. */
export const ownsCreateAction = (pathname: string): boolean =>
  pathname === '/ledger'
  || pathname === '/purchase-orders'
  || /^\/projects\/[^/]+\/purchase-orders$/.test(pathname);

/** The generic FAB is redundant or in the way on any of the above. */
export const hidesGlobalFab = (pathname: string): boolean =>
  ownsBottomBar(pathname) || ownsCreateAction(pathname);
