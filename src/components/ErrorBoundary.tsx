import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  name: string;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[ErrorBoundary][${this.props.name}]`, error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="border border-red-200 bg-red-50 rounded-lg p-3 m-2 text-xs">
          <div className="font-medium text-red-700 mb-1">{this.props.name} crashed</div>
          <div className="text-red-500 font-mono">{this.state.error?.message}</div>
          <button
            onClick={() => this.setState({ hasError: false })}
            className="mt-1 text-accent hover:underline"
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
