import { Component, type ErrorInfo, type ReactNode } from "react";
import receiptStyles from "@/components/Receipt/HtmlReceipt.module.css";

type Props = {
  children: ReactNode;
  resetKey: string;
};

type State = {
  error: string | null;
};

export class ReceiptTemplatePreviewBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    const message = error instanceof Error ? error.message : "Template preview failed.";
    return { error: message };
  }

  componentDidUpdate(prevProps: Props): void {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error("Receipt template preview failed", error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className={receiptStyles.renderError} role="alert">
          {this.state.error}
        </div>
      );
    }

    return this.props.children;
  }
}
