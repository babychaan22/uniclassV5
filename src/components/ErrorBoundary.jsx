
import { Component } from "react";

export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("[ErrorBoundary]", error, errorInfo);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-cream p-6 gap-6">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-clay-coral border-[4px] border-ink shadow-[4px_4px_0_#17162B]">
            <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <div className="text-center space-y-2">
            <h1 className="text-2xl font-display font-extrabold text-ink">Something went wrong</h1>
            <p className="text-ink/60 text-sm max-w-sm">
              The app hit an unexpected error. Try reloading — your data is safe.
            </p>
          </div>
          <button
            className="clay-btn bg-clay-purple text-white px-6 py-3 text-sm"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

