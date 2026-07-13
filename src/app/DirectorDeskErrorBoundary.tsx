import { Component, type ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { useDirectorStore } from "../editor/store/directorStore";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class DirectorDeskErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <main className="director-recovery" role="alert">
        <AlertTriangle aria-hidden="true" size={30} />
        <h1>当前布景无法渲染</h1>
        <p>已保留你导出的工程文件。恢复后会回到一个默认角色和机位。</p>
        <button
          type="button"
          onClick={() => {
            useDirectorStore.getState().resetDirectorDesk();
            this.setState({ hasError: false });
          }}
        >
          <RotateCcw aria-hidden="true" size={17} />
          恢复安全导演台
        </button>
      </main>
    );
  }
}
