/**
 * A mobile page rendered VERBATIM from a self-contained HTML artifact inside a full-viewport iframe —
 * the same pattern as /demo (DemoRecord) and /login (LoginRegister), but hosted INSIDE an in-app route
 * so the app's real MobileNavBar capsule (z-index 40, in the parent document) floats over it and stays
 * usable. The artifact's OWN bottom nav + FAB are hidden in the HTML (the app shell provides both);
 * its built-in bottom padding still reserves the strip the floating capsule sits in.
 *
 * VISUAL-FIRST: the artifacts run on their own sample data. Real data + the write-actions
 * (link-a-payment, party create/edit/delete, bill delete) are a later wiring pass over a postMessage
 * bridge, mirroring DemoRecord/LoginRegister.
 */
export default function MobileArtifactFrame({ html, title }: { html: string; title: string }) {
  return (
    <iframe
      title={title}
      srcDoc={html}
      style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', border: 0, zIndex: 0, display: 'block' }}
    />
  );
}
