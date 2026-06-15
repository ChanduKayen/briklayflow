import React from 'react';

/**
 * App-level error boundary. A single component throw (e.g. a Rules-of-Hooks
 * violation, a null access) would otherwise white-screen the whole app since
 * React unmounts the tree on an uncaught render error. This catches it, shows a
 * calm fallback with the real message, and offers a reload — so one page's bug
 * never blanks everything.
 */
type Props = { children: React.ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Surface for diagnostics; replace with a logger/Sentry when one exists.
    console.error('[ErrorBoundary] uncaught render error:', error, info.componentStack);
  }

  private handleReload = () => {
    this.setState({ error: null });
    window.location.reload();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        role="alert"
        style={{
          minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 24, background: '#FBF9F6',
          fontFamily: "'DM Sans', system-ui, sans-serif",
        }}
      >
        <div style={{ maxWidth: 420, textAlign: 'center' }}>
          <p style={{ color: '#1E1A15', fontFamily: "Georgia, 'Times New Roman', serif", fontSize: '1.3rem', margin: 0 }}>
            Something went wrong on this page
          </p>
          <p style={{ color: '#6B6258', fontSize: '0.9rem', lineHeight: 1.6, marginTop: 10 }}>
            The rest of your data is safe. Reload to continue — if it keeps happening, let us know.
          </p>
          <button
            onClick={this.handleReload}
            style={{
              marginTop: 18, padding: '10px 18px', borderRadius: 12, border: 'none',
              background: 'linear-gradient(135deg, #C75530 0%, #A93E1F 100%)', color: '#fff',
              fontWeight: 500, fontSize: '0.9rem', cursor: 'pointer',
            }}
          >
            Reload
          </button>
          {error.message && (
            <p style={{ color: '#9A9186', fontSize: '0.72rem', marginTop: 16, wordBreak: 'break-word' }}>
              {error.message}
            </p>
          )}
        </div>
      </div>
    );
  }
}
