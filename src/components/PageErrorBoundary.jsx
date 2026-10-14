import { Component } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

/** Keeps a page failure inside the app shell, with a safe retry path. */
export default class PageErrorBoundary extends Component {
  state = { error: null, attempt: 0 };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("[PageErrorBoundary]", error, errorInfo);
  }

  componentDidUpdate(previousProps) {
    if (previousProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null, attempt: 0 });
    }
  }

  retry = () => {
    this.setState((current) => ({ error: null, attempt: current.attempt + 1 }));
  };

  render() {
    if (this.state.error) {
      return (
        <main className="mx-auto flex min-h-[55vh] max-w-xl items-center px-4 py-10">
          <section className="w-full rounded-3xl border-2 border-ink/15 bg-cream p-6 text-center shadow-[0_10px_28px_rgba(23,22,43,.12)]">
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-clay-coral/15 text-clay-coral">
              <AlertTriangle className="h-7 w-7" aria-hidden="true" />
            </span>
            <h1 className="mt-4 font-display text-xl font-extrabold text-ink">This page needs another try</h1>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-ink/65">
              Your data is safe. Check your connection, then try loading this page again.
            </p>
            <button type="button" className="clay-btn mt-5 inline-flex items-center gap-2 bg-clay-purple px-5 py-3 text-sm text-white" onClick={this.retry}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" /> Try again
            </button>
          </section>
        </main>
      );
    }

    return <div key={this.state.attempt}>{this.props.children}</div>;
  }
}
